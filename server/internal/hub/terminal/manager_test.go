//go:build windows

package terminal

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

	inputMu   sync.Mutex
	input     bytes.Buffer
	resize    [][2]int
	resizeErr error

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
	if p.resizeErr != nil {
		return p.resizeErr
	}
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

func (p *fakePTY) setResizeError(err error) {
	p.inputMu.Lock()
	p.resizeErr = err
	p.inputMu.Unlock()
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

func TestConPTYResizeRepaintFilterHandlesFragmentedFrame(t *testing.T) {
	var filter conPTYResizeRepaintFilter
	filter.Arm()
	input := []byte("before\x1b[?25l\x1b[Hrepaint\x1b[K\r\n\x1b[18;42H\x1b[?25hafter")
	var got []byte
	for _, value := range input {
		got = append(got, filter.Filter([]byte{value})...)
	}
	if want := []byte("beforeafter"); !bytes.Equal(got, want) {
		t.Fatalf("filtered=%q, want %q", got, want)
	}
}

func TestConPTYResizeRepaintFilterHandlesMultiplePendingFrames(t *testing.T) {
	var filter conPTYResizeRepaintFilter
	filter.Arm()
	filter.Arm()
	got := filter.Filter([]byte(
		"\x1b[?25l\x1b[Hfirst\x1b[1;1H\x1b[?25h" +
			"between" +
			"\x1b[?25l\x1b[Hsecond\x1b[2;2H\x1b[?25h" +
			"after",
	))
	if want := []byte("betweenafter"); !bytes.Equal(got, want) {
		t.Fatalf("filtered=%q, want %q", got, want)
	}
}

func TestConPTYResizeRepaintFilterCancelAndOverflowFailOpen(t *testing.T) {
	var filter conPTYResizeRepaintFilter
	filter.Arm()
	filter.Cancel()
	frame := []byte("\x1b[?25l\x1b[Hnormal\x1b[1;1H\x1b[?25h")
	if got := filter.Filter(frame); !bytes.Equal(got, frame) {
		t.Fatalf("cancelled filter=%q, want %q", got, frame)
	}

	filter.Arm()
	oversized := append([]byte("\x1b[?25l\x1b[H"), bytes.Repeat([]byte{'x'}, maxConPTYResizeRepaintBytes+1)...)
	if got := filter.Filter(oversized); !bytes.Equal(got, oversized) {
		t.Fatalf("overflow filter returned %d bytes, want %d", len(got), len(oversized))
	}
	tail := []byte("still-normal")
	if got := filter.Filter(tail); !bytes.Equal(got, tail) {
		t.Fatalf("fail-open tail=%q, want %q", got, tail)
	}
}

func TestConPTYResizeRepaintFilterFlushesIncompleteCandidate(t *testing.T) {
	var filter conPTYResizeRepaintFilter
	filter.Arm()
	candidate := []byte("\x1b[?25l\x1b[Hincomplete")
	if got := filter.Filter(candidate); len(got) != 0 {
		t.Fatalf("candidate leaked before flush: %q", got)
	}
	if got := filter.Flush(); !bytes.Equal(got, candidate) {
		t.Fatalf("flush=%q, want %q", got, candidate)
	}
	if got := filter.Filter([]byte("after")); !bytes.Equal(got, []byte("after")) {
		t.Fatalf("post-flush=%q", got)
	}
}

func TestConPTYResizeRepaintFilterExpiredArmFailsOpen(t *testing.T) {
	var filter conPTYResizeRepaintFilter
	filter.Arm()
	filter.expiresAt = time.Now().Add(-time.Second)
	frame := []byte("\x1b[?25l\x1b[Happlication-redraw\x1b[1;1H\x1b[?25h")
	if got := filter.Filter(frame); !bytes.Equal(got, frame) {
		t.Fatalf("expired filter=%q, want %q", got, frame)
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

func TestManagerFiltersResizeRepaintFromOutputAndSnapshot(t *testing.T) {
	requireWindowsConPTYRepaintFilter(t)
	manager, factory, published := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Resize(rp.TerminalResizeRequest{
		TerminalID: created.Terminal.TerminalID, Cols: 42, Rows: 18, ResizeToken: created.ResizeToken,
	}); err != nil {
		t.Fatal(err)
	}
	repaint := "\x1b[?25l\x1b[Hstale-history\x1b[K\r\n\x1b[18;42H\x1b[?25h"
	factory.latest().emit(repaint + "normal-output")
	output := waitForOutput(t, published)
	data, err := base64.StdEncoding.DecodeString(output.Data)
	if err != nil {
		t.Fatal(err)
	}
	if want := []byte("normal-output"); !bytes.Equal(data, want) {
		t.Fatalf("output=%q, want %q", data, want)
	}
	snapshot, err := manager.Get(rp.TerminalGetRequest{TerminalID: created.Terminal.TerminalID})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.StdEncoding.DecodeString(snapshot.Snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(decoded, []byte("stale-history")) || !bytes.Contains(decoded, []byte("normal-output")) {
		t.Fatalf("snapshot=%q", decoded)
	}
}

func TestManagerPassesResizeRepaintForAlternateScreen(t *testing.T) {
	requireWindowsConPTYRepaintFilter(t)
	manager, factory, published := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	factory.latest().emit("\x1b[?1049h")
	_ = waitForOutput(t, published)
	if _, err := manager.Resize(rp.TerminalResizeRequest{
		TerminalID: created.Terminal.TerminalID, Cols: 42, Rows: 18, ResizeToken: created.ResizeToken,
	}); err != nil {
		t.Fatal(err)
	}
	repaint := []byte("\x1b[?25l\x1b[Hfull-screen-redraw\x1b[18;42H\x1b[?25h")
	factory.latest().emit(string(repaint))
	output := waitForOutput(t, published)
	data, err := base64.StdEncoding.DecodeString(output.Data)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, repaint) {
		t.Fatalf("output=%q, want %q", data, repaint)
	}
}

func TestManagerResizeRepaintArmIsCancelledOnResizeFailure(t *testing.T) {
	requireWindowsConPTYRepaintFilter(t)
	manager, factory, published := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	pty := factory.latest()
	pty.setResizeError(errors.New("resize failed"))
	if _, err := manager.Resize(rp.TerminalResizeRequest{
		TerminalID: created.Terminal.TerminalID, Cols: 42, Rows: 18, ResizeToken: created.ResizeToken,
	}); err == nil {
		t.Fatal("resize unexpectedly succeeded")
	}
	pty.setResizeError(nil)
	frame := []byte("\x1b[?25l\x1b[Hnormal-after-failure\x1b[18;42H\x1b[?25h")
	pty.emit(string(frame))
	output := waitForOutput(t, published)
	data, err := base64.StdEncoding.DecodeString(output.Data)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, frame) {
		t.Fatalf("output=%q, want %q", data, frame)
	}
}

func TestManagerBoundsFailOpenResizeRepaintOutputEvents(t *testing.T) {
	requireWindowsConPTYRepaintFilter(t)
	manager, _, published := newTestManager(t)
	created, err := manager.Create(context.Background(), "hub-a:wheelmaker", rp.TerminalCreateRequest{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Resize(rp.TerminalResizeRequest{
		TerminalID: created.Terminal.TerminalID, Cols: 42, Rows: 18, ResizeToken: created.ResizeToken,
	}); err != nil {
		t.Fatal(err)
	}
	s, ok := manager.lookup(created.Terminal.TerminalID)
	if !ok {
		t.Fatal("terminal session not found")
	}
	candidate := append([]byte("\x1b[?25l\x1b[H"), bytes.Repeat([]byte{'x'}, maxConPTYResizeRepaintBytes+1)...)
	for offset := 0; offset < len(candidate); {
		end := min(offset+rp.MaxTerminalEventBytes, len(candidate))
		manager.commitOutput(s, created.Terminal.RunID, candidate[offset:end])
		offset = end
	}

	var restored []byte
	deadline := time.After(2 * time.Second)
	for len(restored) < len(candidate) {
		select {
		case event := <-published:
			if event.method != rp.RegistryMethodTerminalOutput {
				continue
			}
			payload := event.payload.(rp.TerminalOutputEvent)
			data, err := base64.StdEncoding.DecodeString(payload.Data)
			if err != nil {
				t.Fatal(err)
			}
			if len(data) > rp.MaxTerminalEventBytes {
				t.Fatalf("terminal.output contains %d bytes, max %d", len(data), rp.MaxTerminalEventBytes)
			}
			restored = append(restored, data...)
		case <-deadline:
			t.Fatalf("timed out after restoring %d of %d bytes", len(restored), len(candidate))
		}
	}
	if !bytes.Equal(restored, candidate) {
		t.Fatal("fail-open output changed")
	}
}

func requireWindowsConPTYRepaintFilter(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("ConPTY resize repaint filtering is Windows-only")
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

func TestDetectWindowsShellUsesPreferredOrder(t *testing.T) {
	var calls []string
	lookPath := func(name string) (string, error) {
		calls = append(calls, name)
		if name == "powershell.exe" {
			return `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, nil
		}
		return "", errors.New("missing")
	}
	got, err := DetectShell(lookPath)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(got) != "powershell.exe" {
		t.Fatalf("shell=%q", got)
	}
	want := []string{"pwsh.exe", "powershell.exe"}
	if strings.Join(calls, ",") != strings.Join(want, ",") {
		t.Fatalf("calls=%v, want %v", calls, want)
	}
}

func TestWindowsPTYRunsShellInRequestedDirectory(t *testing.T) {
	shell, err := DetectShell(defaultLookPath)
	if err != nil {
		t.Skip(err)
	}
	cwd := t.TempDir()
	pty, err := NewPlatformPTYFactory().Start(context.Background(), shell, cwd, 100, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer pty.Close()

	var output bytes.Buffer
	var outputMu sync.Mutex
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		buf := make([]byte, 4096)
		for {
			n, readErr := pty.Read(buf)
			if n > 0 {
				outputMu.Lock()
				_, _ = output.Write(buf[:n])
				outputMu.Unlock()
			}
			if readErr != nil {
				return
			}
		}
	}()
	command := "Write-Output 'wm-pty-marker'; (Get-Location).Path; exit\r"
	if strings.EqualFold(filepath.Base(shell), "cmd.exe") {
		command = "echo wm-pty-marker & cd & exit\r"
	}
	if _, err := pty.Write([]byte(command)); err != nil {
		t.Fatal(err)
	}
	code, err := pty.Wait()
	if err != nil || code != 0 {
		t.Fatalf("wait code=%d err=%v", code, err)
	}
	_ = pty.Close()
	select {
	case <-readDone:
	case <-time.After(5 * time.Second):
		t.Fatal("PTY output did not close")
	}
	outputMu.Lock()
	got := output.String()
	outputMu.Unlock()
	if !strings.Contains(got, "wm-pty-marker") || !strings.Contains(strings.ToLower(got), strings.ToLower(cwd)) {
		t.Fatalf("output=%q", got)
	}
}

func TestWindowsPTYKillStopsShell(t *testing.T) {
	shell, err := DetectShell(defaultLookPath)
	if err != nil {
		t.Skip(err)
	}
	pty, err := NewPlatformPTYFactory().Start(context.Background(), shell, os.TempDir(), 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitDone := make(chan struct{})
	go func() {
		_, _ = pty.Wait()
		close(waitDone)
	}()
	if err := pty.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = pty.Close()
	select {
	case <-waitDone:
	case <-time.After(5 * time.Second):
		t.Fatal("killed PTY did not exit")
	}
}

func TestWindowsConPTYRepeatedResizePreservesLongOutput(t *testing.T) {
	shell, err := DetectShell(defaultLookPath)
	if err != nil {
		t.Skip(err)
	}
	if strings.EqualFold(filepath.Base(shell), "cmd.exe") {
		t.Skip("PowerShell is required for the long-line resize regression")
	}
	pty, err := NewPlatformPTYFactory().Start(context.Background(), shell, os.TempDir(), 80, 36)
	if err != nil {
		t.Fatal(err)
	}
	defer pty.Kill()
	defer pty.Close()

	screen := newXTermScreen(80, 36)
	defer screen.Close()
	var mu sync.Mutex
	var filter conPTYResizeRepaintFilter
	var outputGeneration uint64
	lastOutput := time.Now()
	go func() {
		buffer := make([]byte, 32*1024)
		for {
			n, readErr := pty.Read(buffer)
			if n > 0 {
				mu.Lock()
				filtered := filter.Filter(buffer[:n])
				if len(filtered) > 0 {
					_, _ = screen.Write(filtered)
				}
				outputGeneration++
				lastOutput = time.Now()
				mu.Unlock()
			}
			if readErr != nil {
				return
			}
		}
	}()

	command := "1..200 | ForEach-Object { ('__WM_LINE_{0:D4}__' -f $_) + ('x' * 140) }; Write-Output ('__WM_' + 'READY__')\r"
	if _, err := pty.Write([]byte(command)); err != nil {
		t.Fatal(err)
	}
	waitForScreenCondition(t, &mu, screen, func(snapshot []byte) bool {
		return bytes.Contains(snapshot, []byte("__WM_READY__"))
	})

	for _, size := range [][2]int{{42, 18}, {126, 72}, {58, 24}, {104, 64}, {76, 32}, {132, 80}, {48, 20}, {96, 60}} {
		mu.Lock()
		generationBeforeResize := outputGeneration
		filter.Arm()
		if err := pty.Resize(size[0], size[1]); err != nil {
			filter.Cancel()
			mu.Unlock()
			t.Fatal(err)
		}
		screen.Resize(size[0], size[1])
		mu.Unlock()
		waitForConPTYResizeOutput(t, &mu, &outputGeneration, &lastOutput, generationBeforeResize)
	}

	mu.Lock()
	snapshot := screen.Snapshot()
	mu.Unlock()
	for index := 1; index <= 200; index++ {
		marker := []byte(fmt.Sprintf("__WM_LINE_%04d__", index))
		if count := bytes.Count(snapshot, marker); count != 1 {
			t.Fatalf("snapshot contains marker %d %d times after repeated ConPTY resize", index, count)
		}
	}
}

func waitForScreenCondition(t *testing.T, mu *sync.Mutex, screen Screen, ready func([]byte) bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		snapshot := screen.Snapshot()
		mu.Unlock()
		if ready(snapshot) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("timed out waiting for terminal output")
}

func waitForConPTYResizeOutput(
	t *testing.T,
	mu *sync.Mutex,
	generation *uint64,
	lastOutput *time.Time,
	previousGeneration uint64,
) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		complete := *generation > previousGeneration && time.Since(*lastOutput) >= 75*time.Millisecond
		mu.Unlock()
		if complete {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("timed out waiting for ConPTY resize repaint")
}

func TestXTermScreenSnapshotRestoresExactly(t *testing.T) {
	screen := newXTermScreen(20, 4)
	defer screen.Close()
	_, _ = screen.Write([]byte("normal\r\n\x1b[31mred\x1b[0m\r\n\x1b[?1049halt界\x1b[2;3H!"))
	screen.Resize(30, 6)
	snapshot := screen.Snapshot()

	restored := newXTermScreen(30, 6)
	defer restored.Close()
	_, _ = restored.Write(snapshot)
	if got := restored.Snapshot(); !bytes.Equal(got, snapshot) {
		t.Fatalf("restored snapshot differs\nwant=%q\ngot=%q", snapshot, got)
	}
}

func TestXTermScreenKeepsOnlyConfiguredScrollback(t *testing.T) {
	screen := newXTermScreen(20, 4)
	defer screen.Close()
	for i := 0; i < 10050; i++ {
		_, _ = screen.Write([]byte(fmt.Sprintf("line-%05d\r\n", i)))
	}
	snapshot := screen.Snapshot()
	if bytes.Contains(snapshot, []byte("line-00000")) {
		t.Fatal("snapshot retained a line older than the 10,000-line scrollback")
	}
	if !bytes.Contains(snapshot, []byte("line-10049")) {
		t.Fatal("snapshot omitted the newest line")
	}
}

func TestXTermScreenPreservesHistoryWhenConPTYRepaintsAfterGrowingRows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("ConPTY compatibility is enabled only on Windows")
	}
	screen := newXTermScreen(80, 36)
	defer screen.Close()
	for index := 1; index <= 200; index++ {
		_, _ = screen.Write([]byte(fmt.Sprintf("__WM_LINE_%04d__\r\n", index)))
	}

	screen.Resize(80, 80)
	_, _ = screen.Write([]byte("\x1b[?25l\x1b[H"))
	for index := 166; index <= 200; index++ {
		_, _ = screen.Write([]byte(fmt.Sprintf("__WM_LINE_%04d__\x1b[K\r\n", index)))
	}

	snapshot := screen.Snapshot()
	for index := 1; index <= 200; index++ {
		marker := []byte(fmt.Sprintf("__WM_LINE_%04d__", index))
		if !bytes.Contains(snapshot, marker) {
			t.Fatalf("snapshot lost line %d after ConPTY repaint", index)
		}
	}
}
