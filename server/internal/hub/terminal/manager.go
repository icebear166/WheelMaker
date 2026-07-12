package terminal

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sort"
	"sync"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	outputFlushInterval = 16 * time.Millisecond
	minTerminalCols     = 2
	maxTerminalCols     = 500
	minTerminalRows     = 1
	maxTerminalRows     = 200
)

var (
	ErrManagerClosed    = errors.New("terminal manager is closed")
	ErrProjectNotFound  = errors.New("terminal project not found")
	ErrTerminalNotFound = errors.New("terminal not found")
	ErrTerminalRunning  = errors.New("terminal is still running")
	ErrResizeOwnership  = errors.New("terminal resize ownership is required")
)

type Project struct {
	ID   string
	Name string
	Root string
}

type Config struct {
	HubID          string
	ResolveProject func(string) (Project, bool)
	ResolveShell   func() (string, error)
	PTYFactory     PTYFactory
	ScreenFactory  func(int, int) Screen
	Publish        func(method string, payload any) error
}

type Manager struct {
	cfg Config

	mu       sync.RWMutex
	sessions map[string]*session
	closed   bool
}

type session struct {
	mu      sync.Mutex
	inputMu sync.Mutex

	meta        rp.TerminalMetadata
	resizeToken string
	seq         uint64
	pty         PTY
	screen      Screen
	closed      bool
}

func NewManager(cfg Config) *Manager {
	if cfg.ScreenFactory == nil {
		cfg.ScreenFactory = newXTermScreen
	}
	if cfg.Publish == nil {
		cfg.Publish = func(string, any) error { return nil }
	}
	return &Manager{cfg: cfg, sessions: make(map[string]*session)}
}

func (m *Manager) List() rp.TerminalListResponse {
	m.mu.RLock()
	sessions := make([]*session, 0, len(m.sessions))
	for _, item := range m.sessions {
		sessions = append(sessions, item)
	}
	m.mu.RUnlock()

	terminals := make([]rp.TerminalMetadata, 0, len(sessions))
	for _, item := range sessions {
		item.mu.Lock()
		terminals = append(terminals, cloneMetadata(item.meta))
		item.mu.Unlock()
	}
	sort.Slice(terminals, func(i, j int) bool {
		if terminals[i].CreatedAt == terminals[j].CreatedAt {
			return terminals[i].TerminalID < terminals[j].TerminalID
		}
		return terminals[i].CreatedAt < terminals[j].CreatedAt
	})
	return rp.TerminalListResponse{Terminals: terminals}
}

func (m *Manager) Create(ctx context.Context, projectID string, req rp.TerminalCreateRequest) (rp.TerminalCreateResponse, error) {
	if err := validateDimensions(req.Cols, req.Rows); err != nil {
		return rp.TerminalCreateResponse{}, err
	}
	if m.cfg.ResolveProject == nil {
		return rp.TerminalCreateResponse{}, ErrProjectNotFound
	}
	project, ok := m.cfg.ResolveProject(projectID)
	if !ok || project.Root == "" {
		return rp.TerminalCreateResponse{}, ErrProjectNotFound
	}
	if m.cfg.ResolveShell == nil || m.cfg.PTYFactory == nil {
		return rp.TerminalCreateResponse{}, errors.New("terminal runtime is not configured")
	}
	shell, err := m.cfg.ResolveShell()
	if err != nil {
		return rp.TerminalCreateResponse{}, err
	}
	pty, err := m.cfg.PTYFactory.Start(ctx, shell, project.Root, req.Cols, req.Rows)
	if err != nil {
		return rp.TerminalCreateResponse{}, fmt.Errorf("start terminal PTY: %w", err)
	}

	terminalID, err := randomID()
	if err != nil {
		_ = pty.Close()
		return rp.TerminalCreateResponse{}, err
	}
	runID, err := randomID()
	if err != nil {
		_ = pty.Close()
		return rp.TerminalCreateResponse{}, err
	}
	resizeToken, err := randomID()
	if err != nil {
		_ = pty.Close()
		return rp.TerminalCreateResponse{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	s := &session{
		meta: rp.TerminalMetadata{
			TerminalID: terminalID, RunID: runID, HubID: m.cfg.HubID,
			ProjectID: project.ID, ProjectName: project.Name, InitialCWD: project.Root,
			Shell: shell, Status: rp.TerminalStatusRunning, Cols: req.Cols, Rows: req.Rows,
			CreatedAt: now,
		},
		resizeToken: resizeToken,
		pty:         pty,
		screen:      m.cfg.ScreenFactory(req.Cols, req.Rows),
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		_ = pty.Kill()
		_ = pty.Close()
		s.screen.Close()
		return rp.TerminalCreateResponse{}, ErrManagerClosed
	}
	m.sessions[terminalID] = s
	m.mu.Unlock()

	m.startRun(s, runID, pty)
	m.publishChanged("created", s)
	return rp.TerminalCreateResponse{Terminal: cloneMetadata(s.meta), ResizeToken: resizeToken}, nil
}

func (m *Manager) Get(req rp.TerminalGetRequest) (rp.TerminalGetResponse, error) {
	s, ok := m.lookup(req.TerminalID)
	if !ok {
		return rp.TerminalGetResponse{}, ErrTerminalNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return rp.TerminalGetResponse{
		Terminal:    cloneMetadata(s.meta),
		SnapshotSeq: s.seq,
		Snapshot:    base64.StdEncoding.EncodeToString(s.screen.Snapshot()),
	}, nil
}

func (m *Manager) Input(event rp.TerminalInputEvent) {
	data, err := rp.DecodeTerminalData(event.Data)
	if err != nil {
		return
	}
	s, ok := m.lookup(event.TerminalID)
	if !ok {
		return
	}
	s.inputMu.Lock()
	defer s.inputMu.Unlock()
	s.mu.Lock()
	if s.closed || s.meta.Status != rp.TerminalStatusRunning || s.meta.RunID != event.RunID {
		s.mu.Unlock()
		return
	}
	pty := s.pty
	s.mu.Unlock()
	_, _ = pty.Write(data)
}

func (m *Manager) Resize(req rp.TerminalResizeRequest) (rp.TerminalResizeResponse, error) {
	if err := validateDimensions(req.Cols, req.Rows); err != nil {
		return rp.TerminalResizeResponse{}, err
	}
	s, ok := m.lookup(req.TerminalID)
	if !ok {
		return rp.TerminalResizeResponse{}, ErrTerminalNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.meta.Status != rp.TerminalStatusRunning {
		return rp.TerminalResizeResponse{}, ErrTerminalRunning
	}
	if !req.Claim && (req.ResizeToken == "" || req.ResizeToken != s.resizeToken) {
		return rp.TerminalResizeResponse{}, ErrResizeOwnership
	}
	if err := s.pty.Resize(req.Cols, req.Rows); err != nil {
		return rp.TerminalResizeResponse{}, fmt.Errorf("resize terminal PTY: %w", err)
	}
	s.screen.Resize(req.Cols, req.Rows)
	s.meta.Cols = req.Cols
	s.meta.Rows = req.Rows
	response := rp.TerminalResizeResponse{Terminal: cloneMetadata(s.meta)}
	if req.Claim {
		token, err := randomID()
		if err != nil {
			return rp.TerminalResizeResponse{}, err
		}
		s.resizeToken = token
		response.ResizeToken = token
	}
	go m.publishChanged("resized", s)
	return response, nil
}

func (m *Manager) CloseTerminal(req rp.TerminalRefRequest) error {
	m.mu.Lock()
	s, ok := m.sessions[req.TerminalID]
	if ok {
		delete(m.sessions, req.TerminalID)
	}
	m.mu.Unlock()
	if !ok {
		return nil
	}
	m.closeSession(s)
	m.publish(rp.RegistryMethodTerminalChanged, rp.TerminalChangedEvent{Change: "closed", TerminalID: req.TerminalID})
	return nil
}

func (m *Manager) Restart(ctx context.Context, req rp.TerminalRefRequest) (rp.TerminalCreateResponse, error) {
	s, ok := m.lookup(req.TerminalID)
	if !ok {
		return rp.TerminalCreateResponse{}, ErrTerminalNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.meta.Status == rp.TerminalStatusRunning {
		return rp.TerminalCreateResponse{}, ErrTerminalRunning
	}
	shell, err := m.cfg.ResolveShell()
	if err != nil {
		return rp.TerminalCreateResponse{}, err
	}
	pty, err := m.cfg.PTYFactory.Start(ctx, shell, s.meta.InitialCWD, s.meta.Cols, s.meta.Rows)
	if err != nil {
		return rp.TerminalCreateResponse{}, fmt.Errorf("restart terminal PTY: %w", err)
	}
	runID, err := randomID()
	if err != nil {
		_ = pty.Close()
		return rp.TerminalCreateResponse{}, err
	}
	resizeToken, err := randomID()
	if err != nil {
		_ = pty.Close()
		return rp.TerminalCreateResponse{}, err
	}
	oldScreen := s.screen
	s.screen = m.cfg.ScreenFactory(s.meta.Cols, s.meta.Rows)
	s.pty = pty
	s.seq = 0
	s.resizeToken = resizeToken
	s.meta.RunID = runID
	s.meta.Shell = shell
	s.meta.Status = rp.TerminalStatusRunning
	s.meta.ExitCode = nil
	s.meta.ExitedAt = ""
	meta := cloneMetadata(s.meta)
	oldScreen.Close()
	m.startRun(s, runID, pty)
	go m.publishChanged("restarted", s)
	return rp.TerminalCreateResponse{Terminal: meta, ResizeToken: resizeToken}, nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	sessions := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.sessions = make(map[string]*session)
	m.mu.Unlock()
	for _, s := range sessions {
		m.closeSession(s)
	}
	return nil
}

func (m *Manager) startRun(s *session, runID string, pty PTY) {
	outputDone := make(chan struct{})
	go m.pumpOutput(s, runID, pty, outputDone)
	go func() {
		exitCode, waitErr := pty.Wait()
		<-outputDone
		m.finishRun(s, runID, pty, exitCode, waitErr)
	}()
}

func (m *Manager) pumpOutput(s *session, runID string, pty PTY, done chan<- struct{}) {
	defer close(done)
	chunks := make(chan []byte, 16)
	go func() {
		defer close(chunks)
		buf := make([]byte, 32*1024)
		for {
			n, err := pty.Read(buf)
			if n > 0 {
				chunk := append([]byte(nil), buf[:n]...)
				chunks <- chunk
			}
			if err != nil {
				return
			}
		}
	}()

	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	var batch []byte
	flush := func() {
		for len(batch) > 0 {
			n := len(batch)
			if n > rp.MaxTerminalEventBytes {
				n = rp.MaxTerminalEventBytes
			}
			m.commitOutput(s, runID, append([]byte(nil), batch[:n]...))
			batch = batch[n:]
		}
	}
	for {
		select {
		case chunk, ok := <-chunks:
			if !ok {
				flush()
				return
			}
			batch = append(batch, chunk...)
			if len(batch) >= rp.MaxTerminalEventBytes {
				flush()
				continue
			}
			timer.Reset(outputFlushInterval)
		case <-timer.C:
			flush()
		}
	}
}

func (m *Manager) commitOutput(s *session, runID string, data []byte) {
	s.mu.Lock()
	if s.closed || s.meta.RunID != runID || s.meta.Status != rp.TerminalStatusRunning {
		s.mu.Unlock()
		return
	}
	_, _ = s.screen.Write(data)
	s.seq++
	event := rp.TerminalOutputEvent{
		TerminalID: s.meta.TerminalID,
		RunID:      runID,
		Seq:        s.seq,
		Data:       base64.StdEncoding.EncodeToString(data),
	}
	s.mu.Unlock()
	m.publish(rp.RegistryMethodTerminalOutput, event)
}

func (m *Manager) finishRun(s *session, runID string, pty PTY, exitCode int, waitErr error) {
	s.mu.Lock()
	if s.closed || s.meta.RunID != runID || s.pty != pty {
		s.mu.Unlock()
		return
	}
	status := rp.TerminalStatusExited
	change := "exited"
	if waitErr != nil {
		status = rp.TerminalStatusError
		change = "error"
	}
	s.meta.Status = status
	s.meta.ExitCode = intPointer(exitCode)
	s.meta.ExitedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.mu.Unlock()
	_ = pty.Close()
	m.publishChanged(change, s)
}

func (m *Manager) closeSession(s *session) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	pty := s.pty
	screen := s.screen
	s.mu.Unlock()
	_ = pty.Kill()
	_ = pty.Close()
	screen.Close()
}

func (m *Manager) lookup(id string) (*session, bool) {
	m.mu.RLock()
	s, ok := m.sessions[id]
	m.mu.RUnlock()
	return s, ok
}

func (m *Manager) publishChanged(change string, s *session) {
	s.mu.Lock()
	meta := cloneMetadata(s.meta)
	s.mu.Unlock()
	m.publish(rp.RegistryMethodTerminalChanged, rp.TerminalChangedEvent{
		Change: change, TerminalID: meta.TerminalID, Terminal: &meta,
	})
}

func (m *Manager) publish(method string, payload any) {
	_ = m.cfg.Publish(method, payload)
}

func validateDimensions(cols, rows int) error {
	if cols < minTerminalCols || cols > maxTerminalCols || rows < minTerminalRows || rows > maxTerminalRows {
		return fmt.Errorf("terminal dimensions out of range: cols=%d rows=%d", cols, rows)
	}
	return nil
}

func randomID() (string, error) {
	raw := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", fmt.Errorf("generate terminal id: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func cloneMetadata(meta rp.TerminalMetadata) rp.TerminalMetadata {
	copy := meta
	if meta.ExitCode != nil {
		copy.ExitCode = intPointer(*meta.ExitCode)
	}
	return copy
}

func intPointer(value int) *int {
	return &value
}
