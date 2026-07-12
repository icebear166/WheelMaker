package terminal

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

type fakePTYResult struct {
	code int
	err  error
}

type fakePTY struct {
	reader *io.PipeReader
	writer *io.PipeWriter

	inputMu sync.Mutex
	input   bytes.Buffer
	resize  [][2]int

	exitOnce sync.Once
	exitCh   chan fakePTYResult
	killed   chan struct{}
}

func newFakePTY() *fakePTY {
	reader, writer := io.Pipe()
	return &fakePTY{
		reader: reader,
		writer: writer,
		exitCh: make(chan fakePTYResult, 1),
		killed: make(chan struct{}),
	}
}

func (p *fakePTY) Read(data []byte) (int, error) { return p.reader.Read(data) }

func (p *fakePTY) Write(data []byte) (int, error) {
	p.inputMu.Lock()
	defer p.inputMu.Unlock()
	return p.input.Write(data)
}

func (p *fakePTY) Resize(cols, rows int) error {
	p.inputMu.Lock()
	defer p.inputMu.Unlock()
	p.resize = append(p.resize, [2]int{cols, rows})
	return nil
}

func (p *fakePTY) Wait() (int, error) {
	result := <-p.exitCh
	return result.code, result.err
}

func (p *fakePTY) Kill() error {
	p.exit(-1, nil)
	return nil
}

func (p *fakePTY) Close() error {
	_ = p.reader.Close()
	_ = p.writer.Close()
	return nil
}

func (p *fakePTY) emit(data string) { _, _ = p.writer.Write([]byte(data)) }

func (p *fakePTY) exit(code int, err error) {
	p.exitOnce.Do(func() {
		_ = p.writer.Close()
		p.exitCh <- fakePTYResult{code: code, err: err}
		close(p.killed)
	})
}

func (p *fakePTY) inputBytes() []byte {
	p.inputMu.Lock()
	defer p.inputMu.Unlock()
	return append([]byte(nil), p.input.Bytes()...)
}

type fakePTYFactory struct {
	mu      sync.Mutex
	started []*fakePTY
}

func (f *fakePTYFactory) Start(_ context.Context, _, _ string, _, _ int) (PTY, error) {
	p := newFakePTY()
	f.mu.Lock()
	f.started = append(f.started, p)
	f.mu.Unlock()
	return p, nil
}

func (f *fakePTYFactory) latest() *fakePTY {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.started[len(f.started)-1]
}

type publishedEvent struct {
	method  string
	payload any
}

func newTestManager(t *testing.T) (*Manager, *fakePTYFactory, chan publishedEvent) {
	t.Helper()
	factory := &fakePTYFactory{}
	published := make(chan publishedEvent, 64)
	manager := NewManager(Config{
		HubID: "hub-a",
		ResolveProject: func(id string) (Project, bool) {
			return Project{ID: id, Name: "wheelmaker", Root: `C:\src\wheelmaker`}, id == "hub-a:wheelmaker"
		},
		ResolveShell: func() (string, error) { return `C:\Program Files\PowerShell\7\pwsh.exe`, nil },
		PTYFactory:   factory,
		ScreenFactory: func(cols, rows int) Screen {
			return newXTermScreen(cols, rows)
		},
		Publish: func(method string, payload any) error {
			published <- publishedEvent{method: method, payload: payload}
			return nil
		},
	})
	t.Cleanup(func() { _ = manager.Close() })
	return manager, factory, published
}

func waitForOutput(t *testing.T, published <-chan publishedEvent) rp.TerminalOutputEvent {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case event := <-published:
			if event.method == rp.RegistryMethodTerminalOutput {
				return event.payload.(rp.TerminalOutputEvent)
			}
		case <-deadline:
			t.Fatal("timed out waiting for terminal output")
		}
	}
}

func TestManagerCreateInputOutputAndSnapshot(t *testing.T) {
	manager, factory, published := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 100, Rows: 30})
	if err != nil {
		t.Fatal(err)
	}
	if created.Terminal.InitialCWD != `C:\src\wheelmaker` || created.ResizeToken == "" {
		t.Fatalf("create=%+v", created)
	}
	if created.Terminal.Status != rp.TerminalStatusRunning || created.Terminal.RunID == "" {
		t.Fatalf("terminal=%+v", created.Terminal)
	}

	pty := factory.latest()
	manager.Input(rp.TerminalInputEvent{
		TerminalID: created.Terminal.TerminalID,
		RunID:      created.Terminal.RunID,
		Data:       base64.StdEncoding.EncodeToString([]byte("dir\r")),
	})
	if got := pty.inputBytes(); !bytes.Equal(got, []byte("dir\r")) {
		t.Fatalf("input=%q", got)
	}

	pty.emit("hello")
	output := waitForOutput(t, published)
	if output.Seq != 1 || output.RunID != created.Terminal.RunID {
		t.Fatalf("output=%+v", output)
	}
	snapshot, err := manager.Get(rp.TerminalGetRequest{TerminalID: created.Terminal.TerminalID})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SnapshotSeq != output.Seq {
		t.Fatalf("snapshot seq=%d, want %d", snapshot.SnapshotSeq, output.Seq)
	}
	decoded, err := base64.StdEncoding.DecodeString(snapshot.Snapshot)
	if err != nil || !bytes.Contains(decoded, []byte("hello")) {
		t.Fatalf("snapshot=%q err=%v", decoded, err)
	}
}

func TestManagerDropsInvalidAndStaleInput(t *testing.T) {
	manager, factory, _ := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	manager.Input(rp.TerminalInputEvent{TerminalID: created.Terminal.TerminalID, RunID: "stale", Data: "b2xk"})
	manager.Input(rp.TerminalInputEvent{TerminalID: created.Terminal.TerminalID, RunID: created.Terminal.RunID, Data: "not-base64"})
	if got := factory.latest().inputBytes(); len(got) != 0 {
		t.Fatalf("unexpected input=%q", got)
	}
}

func TestManagerRotatesResizeOwnership(t *testing.T) {
	manager, factory, _ := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	resized, err := manager.Resize(rp.TerminalResizeRequest{
		TerminalID: created.Terminal.TerminalID, Cols: 120, Rows: 40, ResizeToken: created.ResizeToken,
	})
	if err != nil || resized.ResizeToken != "" {
		t.Fatalf("resize=%+v err=%v", resized, err)
	}
	claimed, err := manager.Resize(rp.TerminalResizeRequest{
		TerminalID: created.Terminal.TerminalID, Cols: 90, Rows: 28, Claim: true,
	})
	if err != nil || claimed.ResizeToken == "" || claimed.ResizeToken == created.ResizeToken {
		t.Fatalf("claim=%+v err=%v", claimed, err)
	}
	if _, err := manager.Resize(rp.TerminalResizeRequest{
		TerminalID: created.Terminal.TerminalID, Cols: 81, Rows: 25, ResizeToken: created.ResizeToken,
	}); !errors.Is(err, ErrResizeOwnership) {
		t.Fatalf("old token err=%v", err)
	}
	if got := factory.latest().resize; len(got) != 2 || got[1] != [2]int{90, 28} {
		t.Fatalf("resize calls=%v", got)
	}
}

func TestManagerRetainsExitRestartsAndCloses(t *testing.T) {
	manager, factory, published := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	factory.latest().emit("final")
	factory.latest().exit(7, nil)
	_ = waitForOutput(t, published)

	deadline := time.Now().Add(2 * time.Second)
	for manager.List().Terminals[0].Status == rp.TerminalStatusRunning && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	listed := manager.List().Terminals
	if len(listed) != 1 || listed[0].Status != rp.TerminalStatusExited || listed[0].ExitCode == nil || *listed[0].ExitCode != 7 {
		t.Fatalf("listed=%+v", listed)
	}
	restarted, err := manager.Restart(context.Background(), rp.TerminalRefRequest{TerminalID: created.Terminal.TerminalID})
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Terminal.TerminalID != created.Terminal.TerminalID || restarted.Terminal.RunID == created.Terminal.RunID {
		t.Fatalf("restarted=%+v", restarted)
	}
	if err := manager.CloseTerminal(rp.TerminalRefRequest{TerminalID: created.Terminal.TerminalID}); err != nil {
		t.Fatal(err)
	}
	if err := manager.CloseTerminal(rp.TerminalRefRequest{TerminalID: created.Terminal.TerminalID}); err != nil {
		t.Fatalf("idempotent close: %v", err)
	}
	if got := manager.List().Terminals; len(got) != 0 {
		t.Fatalf("terminals=%+v", got)
	}
}

func TestManagerHasNoIdleExpiryAndDoesNotRestoreAcrossManagerRestart(t *testing.T) {
	manager, _, _ := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(3 * outputFlushInterval)
	listed := manager.List().Terminals
	if len(listed) != 1 || listed[0].TerminalID != created.Terminal.TerminalID || listed[0].Status != rp.TerminalStatusRunning {
		t.Fatalf("idle terminal changed unexpectedly: %+v", listed)
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	restartedManager := NewManager(Config{HubID: "hub-a"})
	defer restartedManager.Close()
	if got := restartedManager.List().Terminals; len(got) != 0 {
		t.Fatalf("new manager restored process-local terminals: %+v", got)
	}
}
