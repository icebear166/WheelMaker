package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

// zcodeAppProvider launches the ZCode desktop's bundled app-server (node +
// zcode.cjs) and bridges the ZCode Protocol to ACP. Unlike the standard ACP
// providers, ZCode speaks its own JSON-RPC dialect (no jsonrpc key, async
// session/send), so it cannot use ownedConn and must translate.
type zcodeAppProvider struct {
	lookPath func(file string) (string, error)
}

func NewZCodeAppProvider() *zcodeAppProvider {
	return &zcodeAppProvider{lookPath: exec.LookPath}
}

func NewZCodeProvider() *zcodeAppProvider { return NewZCodeAppProvider() }

func (p *zcodeAppProvider) Name() string {
	return string(protocol.ACPProviderZCode)
}

// zcodeDefaultBaseURL is the Z.AI Anthropic-compatible endpoint used when the
// desktop config does not specify one.
const zcodeDefaultBaseURL = "https://api.z.ai/api/anthropic"
const zcodeDefaultModel = "zai/glm-5.2"

// zcodeProviderEnvKey is the desktop config key holding the reusable API key.
const zcodeDesktopConfigKey = "builtin:zai"

func (p *zcodeAppProvider) Launch() (string, []string, []string, error) {
	lookPath := p.lookPath
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	nodeExe, err := lookPath("node")
	if err != nil {
		return "", nil, nil, fmt.Errorf("zcode: node not found on PATH: %w", err)
	}
	scriptPath, err := zcodeResolveScriptPath()
	if err != nil {
		return "", nil, nil, err
	}
	env := zcodeBuildEnv()
	return nodeExe, []string{scriptPath, "app-server"}, env, nil
}

// zcodeResolveScriptPath locates the bundled zcode.cjs entrypoint under the
// ZCode desktop install directory. Returns an error if not found.
func zcodeResolveScriptPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("zcode: cannot resolve home dir: %w", err)
	}
	candidates := []string{}
	switch runtime.GOOS {
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			local = filepath.Join(home, "AppData", "Local")
		}
		candidates = append(candidates, filepath.Join(local, "Programs", "ZCode", "resources", "glm", "zcode.cjs"))
	case "darwin":
		candidates = append(candidates, "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs")
		candidates = append(candidates, filepath.Join(home, "Applications", "ZCode.app", "Contents", "Resources", "glm", "zcode.cjs"))
	default:
		candidates = append(candidates, filepath.Join(home, ".local", "share", "ZCode", "resources", "glm", "zcode.cjs"))
		candidates = append(candidates, "/opt/ZCode/resources/glm/zcode.cjs")
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("zcode: zcode.cjs not found under any known install path; install the ZCode desktop app (checked: %s)", strings.Join(candidates, ", "))
}

// zcodeBuildEnv reads the desktop config (~/.zcode/v2/config.json) to obtain the
// reusable API key and base URL, then returns the ZCODE_* env vars the app-server
// subprocess needs. On any read failure it returns env that lets the server use
// its own defaults (which will then surface a model_config_missing error to the
// caller rather than crash here).
func zcodeBuildEnv() []string {
	key, baseURL := zcodeReadDesktopCredentials()
	env := []string{
		"ZCODE_MODEL=" + zcodeDefaultModel,
		"ZCODE_BASE_URL=" + zcodeDefaultBaseURL,
	}
	if baseURL != "" {
		env[1] = "ZCODE_BASE_URL=" + baseURL
	}
	if key != "" {
		env = append(env, "ZCODE_API_KEY="+key)
	}
	return env
}

// zcodeReadDesktopCredentials reads the builtin:zai provider entry from the
// desktop's ~/.zcode/v2/config.json. Returns ("", "") on any failure.
func zcodeReadDesktopCredentials() (apiKey string, baseURL string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}
	path := filepath.Join(home, ".zcode", "v2", "config.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", ""
	}
	var cfg struct {
		Provider map[string]struct {
			Enabled bool `json:"enabled"`
			Options struct {
				APIKey  string `json:"apiKey"`
				BaseURL string `json:"baseURL"`
			} `json:"options"`
		} `json:"provider"`
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return "", ""
	}
	if p, ok := cfg.Provider[zcodeDesktopConfigKey]; ok && p.Enabled && p.Options.APIKey != "" {
		return p.Options.APIKey, p.Options.BaseURL
	}
	return "", ""
}

func zcodeappInstanceCreator(provider *zcodeAppProvider) InstanceCreator {
	if provider == nil {
		provider = NewZCodeAppProvider()
	}
	pool := newZcodeappRuntimePool(func(_ context.Context, cwd string, projectName string) (*zcodeappRuntime, error) {
		return newZcodeappRuntime(provider, cwd, projectName)
	})
	return func(ctx context.Context, cwd string) (Instance, error) {
		exe, args, env, err := provider.Launch()
		if err != nil {
			return nil, err
		}
		lease, err := pool.acquire(ctx, ProjectNameFromContext(ctx), cwd, zcodeappLaunchFingerprint(exe, args, env))
		if err != nil {
			return nil, err
		}
		conn := newZcodeappConnWithRuntimeAndProject(lease.Runtime(), cwd, ProjectNameFromContext(ctx))
		conn.lease = lease
		return NewInstance(provider.Name(), conn), nil
	}
}

// --- transport interface (mirrors codexappTransport) ---

type zcodeappTransport interface {
	SendMessage(v any) error
	OnMessage(h func(json.RawMessage))
	Done() <-chan struct{}
	Close() error
	Alive() bool
}

func newZcodeappRuntime(provider *zcodeAppProvider, cwd string, projectName string) (*zcodeappRuntime, error) {
	exe, args, env, err := provider.Launch()
	if err != nil {
		return nil, err
	}
	raw := NewACPProcess(provider.Name(), exe, env, args...)
	raw.SetDir(cwd)
	if err := raw.Start(); err != nil {
		return nil, err
	}
	return newZcodeappRuntimeWithTransport(raw), nil
}

// --- runtime: one OS process, RPC matching, per-sessionId event routing ---

type zcodeappRuntime struct {
	transport zcodeappTransport

	mu       sync.Mutex
	nextID   int64
	pending  map[string]chan zcodeappRPCResponse
	conns    map[string]*zcodeappConn
	queues   map[string]*zcodeappSessionQueue
	closed   bool
	closeErr error
	done     chan struct{}
	onStop   func(*zcodeappRuntime)
}

type zcodeappSessionQueue struct {
	ch chan zcodeappRuntimeEvent
}

type zcodeappRuntimeEvent struct {
	msg     zcodeappRPCEnvelope
	request bool
}

func newZcodeappRuntimeWithTransport(transport zcodeappTransport) *zcodeappRuntime {
	rt := &zcodeappRuntime{
		transport: transport,
		pending:   map[string]chan zcodeappRPCResponse{},
		conns:     map[string]*zcodeappConn{},
		queues:    map[string]*zcodeappSessionQueue{},
		done:      make(chan struct{}),
	}
	if transport != nil {
		transport.OnMessage(rt.handleMessage)
		go rt.watchTransport()
	}
	return rt
}

func (r *zcodeappRuntime) request(ctx context.Context, method string, params any, out any) error {
	if r == nil || r.transport == nil {
		return errors.New("zcodeapp runtime is not ready")
	}
	id := atomic.AddInt64(&r.nextID, 1)
	idRaw, _ := json.Marshal(id)
	key := string(idRaw)
	ch := make(chan zcodeappRPCResponse, 1)

	r.mu.Lock()
	if r.closed {
		err := r.closeErr
		r.mu.Unlock()
		if err == nil {
			err = errors.New("zcodeapp runtime closed")
		}
		return err
	}
	r.pending[key] = ch
	r.mu.Unlock()

	req := zcodeappRPCRequest{ID: idRaw, Method: method, Params: zcodeappParams(params)}
	if err := r.transport.SendMessage(req); err != nil {
		r.removePending(key)
		return err
	}

	select {
	case resp := <-ch:
		if resp.Error != nil {
			return fmt.Errorf("zcodeapp %s: %s", method, resp.Error.Message)
		}
		if out == nil {
			return nil
		}
		if len(resp.Result) == 0 {
			resp.Result = json.RawMessage(`null`)
		}
		if raw, ok := out.(*json.RawMessage); ok {
			*raw = append((*raw)[:0], resp.Result...)
			return nil
		}
		if err := json.Unmarshal(resp.Result, out); err != nil {
			return fmt.Errorf("zcodeapp %s: decode result: %w", method, err)
		}
		return nil
	case <-ctx.Done():
		r.removePending(key)
		return ctx.Err()
	case <-r.transport.Done():
		r.removePending(key)
		return errors.New("zcodeapp runtime stopped")
	}
}

func (r *zcodeappRuntime) notify(method string, params any) error {
	if r == nil || r.transport == nil {
		return errors.New("zcodeapp runtime is not ready")
	}
	r.mu.Lock()
	closed := r.closed
	closeErr := r.closeErr
	r.mu.Unlock()
	if closed {
		if closeErr == nil {
			closeErr = errors.New("zcodeapp runtime closed")
		}
		return closeErr
	}
	return r.transport.SendMessage(zcodeappRPCNotification{Method: method, Params: zcodeappParams(params)})
}

// sendServerResponse replies to a server-initiated request (e.g. permission).
func (r *zcodeappRuntime) sendServerResponse(id json.RawMessage, result any, errResp *zcodeappRPCError) error {
	resp := zcodeappRPCServerResponse{ID: id}
	if errResp != nil {
		resp.Error = errResp
	} else {
		resp.Result = result
	}
	return r.transport.SendMessage(resp)
}

func (r *zcodeappRuntime) register(sessionID string, conn *zcodeappConn) {
	sessionID = strings.TrimSpace(sessionID)
	if r == nil || sessionID == "" || conn == nil {
		return
	}
	r.mu.Lock()
	r.conns[sessionID] = conn
	r.mu.Unlock()
}

func (r *zcodeappRuntime) unregister(sessionID string, conn *zcodeappConn) {
	sessionID = strings.TrimSpace(sessionID)
	if r == nil || sessionID == "" {
		return
	}
	r.mu.Lock()
	if r.conns[sessionID] == conn {
		delete(r.conns, sessionID)
	}
	r.mu.Unlock()
}

func (r *zcodeappRuntime) watchTransport() {
	if r == nil || r.transport == nil {
		return
	}
	<-r.transport.Done()
	_ = r.terminate(errors.New("zcodeapp runtime stopped"), false)
}

func (r *zcodeappRuntime) setOnStop(onStop func(*zcodeappRuntime)) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.onStop = onStop
	r.mu.Unlock()
}

func (r *zcodeappRuntime) close() error {
	return r.terminate(errors.New("zcodeapp runtime closed"), true)
}

func (r *zcodeappRuntime) terminate(err error, closeTransport bool) error {
	if r == nil {
		return nil
	}
	if err == nil {
		err = errors.New("zcodeapp runtime stopped")
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil
	}
	r.closed = true
	r.closeErr = err
	close(r.done)
	for key, ch := range r.pending {
		delete(r.pending, key)
		ch <- zcodeappRPCResponse{Error: &zcodeappRPCError{Code: -32000, Message: r.closeErr.Error()}}
	}
	conns := make([]*zcodeappConn, 0, len(r.conns))
	for _, conn := range r.conns {
		conns = append(conns, conn)
	}
	onStop := r.onStop
	r.mu.Unlock()
	for _, conn := range conns {
		conn.failActivePrompt(r.closeErr)
	}
	if onStop != nil {
		onStop(r)
	}
	if !closeTransport || r.transport == nil {
		return nil
	}
	return r.transport.Close()
}

func (r *zcodeappRuntime) alive() bool {
	return r != nil && r.transport != nil && r.transport.Alive()
}

func (r *zcodeappRuntime) removePending(key string) {
	r.mu.Lock()
	delete(r.pending, key)
	r.mu.Unlock()
}

func (r *zcodeappRuntime) handleMessage(raw json.RawMessage) {
	var msg zcodeappRPCEnvelope
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}
	if len(msg.ID) > 0 && msg.Method == "" {
		r.resolveResponse(msg)
		return
	}
	if msg.Method == "" {
		return
	}
	if len(msg.ID) > 0 {
		r.enqueueSessionEvent(zcodeSessionIDFromParams(msg.Params), zcodeappRuntimeEvent{msg: msg, request: true})
		return
	}
	r.enqueueSessionEvent(zcodeSessionIDFromParams(msg.Params), zcodeappRuntimeEvent{msg: msg})
}

func (r *zcodeappRuntime) enqueueSessionEvent(sessionID string, event zcodeappRuntimeEvent) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	queue := r.sessionQueue(sessionID)
	if queue == nil {
		return
	}
	select {
	case queue.ch <- event:
	case <-r.done:
	}
}

func (r *zcodeappRuntime) sessionQueue(sessionID string) *zcodeappSessionQueue {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	if queue := r.queues[sessionID]; queue != nil {
		return queue
	}
	queue := &zcodeappSessionQueue{ch: make(chan zcodeappRuntimeEvent, 64)}
	r.queues[sessionID] = queue
	go r.runSessionQueue(queue)
	return queue
}

func (r *zcodeappRuntime) runSessionQueue(queue *zcodeappSessionQueue) {
	for {
		select {
		case event := <-queue.ch:
			if event.request {
				r.handleServerRequest(event.msg)
			} else {
				r.handleNotification(event.msg)
			}
		case <-r.done:
			return
		}
	}
}

func (r *zcodeappRuntime) resolveResponse(msg zcodeappRPCEnvelope) {
	key := string(msg.ID)
	r.mu.Lock()
	ch := r.pending[key]
	delete(r.pending, key)
	r.mu.Unlock()
	if ch == nil {
		return
	}
	ch <- zcodeappRPCResponse{Result: msg.Result, Error: msg.Error}
}

func (r *zcodeappRuntime) handleNotification(msg zcodeappRPCEnvelope) {
	sessionID := zcodeSessionIDFromParams(msg.Params)
	if sessionID == "" {
		return
	}
	conn := r.connForSession(sessionID)
	if conn == nil {
		return
	}
	conn.handleZcodeNotification(msg.Method, msg.Params)
}

func (r *zcodeappRuntime) handleServerRequest(msg zcodeappRPCEnvelope) {
	sessionID := zcodeSessionIDFromParams(msg.Params)
	conn := r.connForSession(sessionID)
	if conn == nil {
		_ = r.sendServerResponse(msg.ID, nil, &zcodeappRPCError{Code: -32601, Message: "method not found: " + msg.Method})
		return
	}
	result, err := conn.handleZcodeRequest(context.Background(), msg.Method, msg.Params)
	if err != nil {
		_ = r.sendServerResponse(msg.ID, nil, &zcodeappRPCError{Code: -32000, Message: err.Error()})
		return
	}
	_ = r.sendServerResponse(msg.ID, result, nil)
}

func (r *zcodeappRuntime) connForSession(sessionID string) *zcodeappConn {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.conns[sessionID]
}

// --- conn: ACP-facing Conn implementation, per session ---

type zcodeappConn struct {
	runtime   *zcodeappRuntime
	lease     *zcodeappRuntimeLease
	cwd       string
	closeOnce sync.Once
	closeErr  error

	mu           sync.Mutex
	reqHandler   ACPRequestHandler
	respHandler  ACPResponseHandler
	acpSessionID string
	projectName  string

	activeTurnID string
	promptDone   chan zcodeappPromptResult

	pendingPromptStops   map[string]string
	pendingPromptUpdates []protocol.SessionUpdateParams
}

type zcodeappPromptResult struct {
	stopReason string
	err        error
}

var zcodeappCancelCompletionTimeout = 5 * time.Second

func newZcodeappConnWithRuntime(runtime *zcodeappRuntime, cwd string) *zcodeappConn {
	return newZcodeappConnWithRuntimeAndProject(runtime, cwd, "")
}

func newZcodeappConnWithRuntimeAndProject(runtime *zcodeappRuntime, cwd string, projectName string) *zcodeappConn {
	return &zcodeappConn{
		runtime:     runtime,
		cwd:         cwd,
		projectName: strings.TrimSpace(projectName),
	}
}

var _ Conn = (*zcodeappConn)(nil)

func (c *zcodeappConn) Send(ctx context.Context, method string, params any, result any) error {
	switch method {
	case protocol.MethodInitialize:
		return c.sendInitialize(ctx, result)
	case protocol.MethodSessionNew:
		var p protocol.SessionNewParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		return c.sendSessionNew(ctx, p, result)
	case protocol.MethodSessionLoad:
		var p protocol.SessionLoadParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		return c.sendSessionLoad(ctx, p, result)
	case protocol.MethodSessionList:
		var p protocol.SessionListParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		return c.sendSessionList(ctx, p, result)
	case protocol.MethodSessionPrompt:
		var p protocol.SessionPromptParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		return c.sendSessionPrompt(ctx, p, result)
	case protocol.MethodSetConfigOption:
		var p protocol.SessionSetConfigOptionParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		return c.sendSetConfigOption(ctx, p, result)
	default:
		return fmt.Errorf("zcodeapp: unsupported ACP method %s", method)
	}
}

func (c *zcodeappConn) Notify(method string, params any) error {
	switch method {
	case protocol.MethodSessionCancel:
		var p protocol.SessionCancelParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		return c.cancel(p.SessionID)
	default:
		return nil
	}
}

func (c *zcodeappConn) OnACPRequest(h ACPRequestHandler) {
	c.mu.Lock()
	c.reqHandler = h
	c.mu.Unlock()
}

func (c *zcodeappConn) OnACPResponse(h ACPResponseHandler) {
	c.mu.Lock()
	c.respHandler = h
	c.mu.Unlock()
}

func (c *zcodeappConn) Close() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		c.mu.Lock()
		sid := c.acpSessionID
		c.mu.Unlock()
		if c.runtime != nil {
			c.runtime.unregister(sid, c)
		}
		c.failActivePrompt(errors.New("zcodeapp connection closed"))
		if c.lease != nil {
			c.closeErr = c.lease.Release()
			return
		}
		if c.runtime != nil {
			c.closeErr = c.runtime.close()
		}
	})
	return c.closeErr
}

func (c *zcodeappConn) Alive() bool {
	return c != nil && c.runtime != nil && c.runtime.alive()
}

func (c *zcodeappConn) BindSessionID(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	c.mu.Lock()
	old := c.acpSessionID
	c.acpSessionID = sessionID
	c.mu.Unlock()
	if old != sessionID {
		if old != "" && c.runtime != nil {
			c.runtime.unregister(old, c)
		}
		if c.runtime != nil {
			c.runtime.register(sessionID, c)
		}
	}
}

// --- ACP method implementations ---

func (c *zcodeappConn) sendInitialize(ctx context.Context, result any) error {
	// ZCode has no initialize handshake (initialize returns method-not-found);
	// session/create is the first real call. We return a static ACP profile.
	return assignResult(result, protocol.InitializeResult{
		ProtocolVersion: json.Number("1"),
		AgentInfo:       &protocol.AgentInfo{Name: string(protocol.ACPProviderZCode), Title: "ZCode App Server"},
		AgentCapabilities: protocol.AgentCapabilities{
			LoadSession: true,
			SessionCapabilities: &protocol.SessionCapabilities{
				List: &protocol.SessionListCapability{},
			},
		},
	})
}

func (c *zcodeappConn) sendSessionNew(ctx context.Context, p protocol.SessionNewParams, result any) error {
	if len(p.MCPServers) > 0 {
		return errors.New("zcodeapp: mcpServers not supported in phase 1")
	}
	workspacePath := firstNonEmptyString(p.CWD, c.cwd)
	params := zcodeSessionCreateParams{
		Workspace: zcodeWorkspace{WorkspacePath: workspacePath, WorkspaceKey: workspacePath},
		Mode:      "yolo",
	}
	var resp zcodeSessionSnapshot
	if err := c.runtime.request(ctx, "session/create", params, &resp); err != nil {
		return err
	}
	sid := strings.TrimSpace(resp.Session.SessionID)
	if sid == "" {
		return errors.New("zcodeapp: session/create returned empty sessionId")
	}
	c.BindSessionID(sid)
	return assignResult(result, protocol.SessionNewResult{
		SessionID:     sid,
		Title:         resp.Session.Title,
		ConfigOptions: zcodeSettingsToConfigOptions(resp.Settings),
	})
}

func (c *zcodeappConn) sendSessionLoad(ctx context.Context, p protocol.SessionLoadParams, result any) error {
	sid := strings.TrimSpace(p.SessionID)
	if sid == "" {
		return errors.New("zcodeapp: session/load requires sessionId")
	}
	c.BindSessionID(sid)
	var resp zcodeSessionSnapshot
	if err := c.runtime.request(ctx, "session/resume", zcodeSessionTargetParams{SessionID: sid}, &resp); err != nil {
		return err
	}
	// replay history as session/update notifications
	c.replayMessages(sid, resp.Messages)
	return assignResult(result, protocol.SessionLoadResult{
		ConfigOptions: zcodeSettingsToConfigOptions(resp.Settings),
	})
}

func (c *zcodeappConn) sendSessionList(ctx context.Context, p protocol.SessionListParams, result any) error {
	var resp zcodeSessionListResult
	if err := c.runtime.request(ctx, "session/list", zcodeSessionTargetParams{}, &resp); err != nil {
		return err
	}
	sessions := make([]protocol.SessionInfo, 0, len(resp.Sessions))
	for _, s := range resp.Sessions {
		sessions = append(sessions, protocol.SessionInfo{
			SessionID: s.SessionID,
			CWD:       s.Workspace.WorkspacePath,
			Title:     s.Title,
		})
	}
	return assignResult(result, protocol.SessionListResult{Sessions: sessions})
}

// sendSessionPrompt bridges the async ZCode session/send into a synchronous
// ACP session/prompt. session/send returns immediately with {accepted}; the
// model output arrives as session/event notifications. We register a promptDone
// channel, send the prompt, then block until turn.completed/turn.failed arrives.
func (c *zcodeappConn) sendSessionPrompt(ctx context.Context, p protocol.SessionPromptParams, result any) error {
	sid := strings.TrimSpace(p.SessionID)
	if sid == "" {
		return errors.New("zcodeapp: session/prompt requires sessionId")
	}
	text, err := zcodeContentToText(p.Prompt)
	if err != nil {
		return err
	}
	done := make(chan zcodeappPromptResult, 1)
	c.mu.Lock()
	if c.promptDone != nil {
		c.mu.Unlock()
		return errors.New("zcodeapp session already has an active turn")
	}
	c.promptDone = done
	c.activeTurnID = ""
	c.pendingPromptStops = nil
	c.pendingPromptUpdates = nil
	c.mu.Unlock()

	var resp zcodeSessionSendResult
	if err := c.runtime.request(ctx, "session/send", zcodeSessionSendParams{SessionID: sid, Content: text}, &resp); err != nil {
		c.clearPromptDone(done)
		return err
	}

	select {
	case promptResult := <-done:
		if promptResult.err != nil {
			return promptResult.err
		}
		return assignResult(result, protocol.SessionPromptResult{StopReason: promptResult.stopReason})
	case <-ctx.Done():
		c.clearPromptDone(done)
		return ctx.Err()
	}
}

func (c *zcodeappConn) sendSetConfigOption(ctx context.Context, p protocol.SessionSetConfigOptionParams, result any) error {
	sid := c.currentSessionID()
	if sid == "" {
		return errors.New("zcodeapp: set_config_option requires an active session")
	}
	switch p.ConfigID {
	case protocol.ConfigOptionIDApprovalPreset, protocol.ConfigOptionIDMode:
		mode := zcodeApprovalPresetToMode(p.Value)
		var resp zcodeSessionSnapshot
		if err := c.runtime.request(ctx, "session/setMode", zcodeSetModeParams{SessionID: sid, Mode: mode}, &resp); err != nil {
			return err
		}
		return assignResult(result, zcodeSettingsToConfigOptions(resp.Settings))
	case protocol.ConfigOptionIDModel:
		ref := zcodeParseModelRef(p.Value)
		var resp zcodeSessionSnapshot
		if err := c.runtime.request(ctx, "session/setModel", zcodeSetModelParams{SessionID: sid, Model: ref}, &resp); err != nil {
			return err
		}
		return assignResult(result, zcodeSettingsToConfigOptions(resp.Settings))
	default:
		return fmt.Errorf("zcodeapp: unsupported config option %q", p.ConfigID)
	}
}

func (c *zcodeappConn) cancel(sessionID string) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || c.runtime == nil {
		return nil
	}
	done := make(chan struct{})
	go func() {
		_ = c.runtime.notify("session/stop", zcodeSessionTargetParams{SessionID: sessionID})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(zcodeappCancelCompletionTimeout):
	}
	c.synthesizeCancel()
	return nil
}

// --- inbound notification handling ---

func (c *zcodeappConn) handleZcodeNotification(method string, params json.RawMessage) {
	switch method {
	case "session/event":
		c.handleSessionEvent(params)
	case "state.updated":
		// state.updated carries projection patches; we currently derive prompt
		// completion from session/event turn.completed, so state patches are
		// observed but not translated individually.
	}
}

func (c *zcodeappConn) handleSessionEvent(params json.RawMessage) {
	var env zcodeEventEnvelope
	if json.Unmarshal(params, &env) != nil {
		return
	}
	// ZCode's session/send response carries no turn id; the turn id appears only
	// on subsequent events. When a prompt is active and we don't yet know the turn
	// id, latch it from the first event so buffered updates/stops can be flushed.
	if env.TurnID != "" {
		c.setActiveTurnID(env.TurnID)
	}
	sid := c.outboundSessionID(env.SessionID)
	switch env.Type {
	case "model.streaming":
		var pl zcodeStreamingPayload
		if json.Unmarshal(env.Payload, &pl) != nil {
			return
		}
		if pl.Kind == "text_delta" && pl.Delta != "" {
			c.emitOrDeferUpdate(protocol.SessionUpdateParams{
				SessionID: sid,
				Update: protocol.SessionUpdate{
					SessionUpdate: protocol.SessionUpdateAgentMessageChunk,
					Content:       mustRaw(protocol.ContentBlock{Type: protocol.ContentBlockTypeText, Text: pl.Delta}),
				},
			}, env.TurnID)
		}
	case "tool.updated":
		var pl zcodeToolUpdatePayload
		if json.Unmarshal(env.Payload, &pl) != nil {
			return
		}
		c.handleToolUpdate(sid, env.TurnID, pl)
	case "session.titleUpdated":
		// best-effort title decode
		var pl struct {
			Title string `json:"title"`
		}
		_ = json.Unmarshal(env.Payload, &pl)
		if pl.Title != "" {
			c.emitSessionUpdateSingle(protocol.SessionUpdateParams{
				SessionID: sid,
				Update: protocol.SessionUpdate{
					SessionUpdate: protocol.SessionUpdateSessionInfoUpdate,
					Title:         pl.Title,
				},
			})
		}
	case "turn.completed":
		var pl zcodeCompletedPayload
		_ = json.Unmarshal(env.Payload, &pl)
		c.completePrompt(env.TurnID, zcodeStopReason(pl.ResultType))
	case "turn.failed":
		c.completePrompt(env.TurnID, protocol.StopReasonRefusal)
	}
}

func (c *zcodeappConn) handleToolUpdate(sid string, turnID string, pl zcodeToolUpdatePayload) {
	if pl.ToolCallID == "" {
		// batch completion has no toolCallId; ignore the aggregate.
		return
	}
	status := zcodeToolStatus(pl.Kind)
	title := pl.ToolName
	update := protocol.SessionUpdate{
		SessionUpdate: protocol.SessionUpdateToolCallUpdate,
		ToolCallID:    pl.ToolCallID,
		Status:        status,
	}
	if pl.Kind == "scheduled" {
		// emit a pending tool_call first so the lifecycle is pending -> in_progress -> completed
		c.emitOrDeferUpdate(protocol.SessionUpdateParams{
			SessionID: sid,
			Update: protocol.SessionUpdate{
				SessionUpdate: protocol.SessionUpdateToolCall,
				ToolCallID:    pl.ToolCallID,
				Kind:          zcodePermissionKind(pl.ToolName),
				Title:         title,
				Status:        protocol.ToolCallStatusPending,
			},
		}, turnID)
		return
	}
	if pl.Kind == "result" && pl.Result != nil {
		status = protocol.ToolCallStatusCompleted
		if !pl.Result.Success {
			status = protocol.ToolCallStatusFailed
		}
		update.Status = status
	}
	c.emitOrDeferUpdate(protocol.SessionUpdateParams{
		SessionID: sid,
		Update:    update,
	}, turnID)
}

func (c *zcodeappConn) handleZcodeRequest(ctx context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "interaction/requestPermission":
		return c.handlePermissionRequest(ctx, params)
	case "interaction/requestUserInput", "interaction/requestProviderRuntimeHeaders":
		// Phase 1: decline gracefully so the turn does not hang.
		return nil, nil
	default:
		return nil, fmt.Errorf("zcodeapp: unsupported server request %s", method)
	}
}

func (c *zcodeappConn) handlePermissionRequest(ctx context.Context, params json.RawMessage) (any, error) {
	var p zcodePermissionRequestParams
	if err := json.Unmarshal(params, &p); err != nil {
		return zcodePermissionReply{Decision: "deny", Reason: "malformed request"}, nil
	}
	c.mu.Lock()
	h := c.reqHandler
	sid := c.acpSessionID
	c.mu.Unlock()
	if h == nil {
		return zcodePermissionReply{Decision: "deny", Reason: "no handler"}, nil
	}
	title := zcodePermissionTitle(p.ToolName, p.Input)
	resp, err := h(ctx, time.Now().UnixNano(), protocol.MethodRequestPermission, mustRaw(protocol.PermissionRequestParams{
		SessionID: c.outboundSessionID(sid),
		ToolCall: protocol.ToolCallRef{
			ToolCallID: p.ToolCallID,
			Title:      title,
			Kind:       zcodePermissionKind(p.ToolName),
			Status:     protocol.ToolCallStatusPending,
		},
		Options: []protocol.PermissionOption{
			{OptionID: "allow_once", Name: "Allow once", Kind: "allow_once"},
			{OptionID: "allow_always", Name: "Allow for session", Kind: "allow_always"},
			{OptionID: "reject", Name: "Reject", Kind: "reject_once"},
		},
	}))
	if err != nil {
		return zcodePermissionReply{Decision: "deny", Reason: err.Error()}, nil
	}
	var permission protocol.PermissionResponse
	if err := remarshal(resp, &permission); err != nil {
		return zcodePermissionReply{Decision: "deny", Reason: "malformed response"}, nil
	}
	decision := zcodePermissionDecision(firstNonEmptyString(permission.Outcome.OptionID, permission.Outcome.Outcome))
	return zcodePermissionReply{Decision: decision}, nil
}

// setActiveTurnID latches the active turn id from the first inbound event of a
// prompt (ZCode does not return a turn id in the session/send response). Once
// latched, buffered updates and pending stop signals are flushed.
func (c *zcodeappConn) setActiveTurnID(turnID string) {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return
	}
	c.mu.Lock()
	if c.promptDone == nil {
		c.mu.Unlock()
		return
	}
	if c.activeTurnID != "" {
		c.mu.Unlock()
		return
	}
	c.activeTurnID = turnID
	updates := c.pendingPromptUpdates
	c.pendingPromptUpdates = nil
	stopReason := ""
	if c.pendingPromptStops != nil {
		stopReason = c.pendingPromptStops[turnID]
		delete(c.pendingPromptStops, turnID)
	}
	c.mu.Unlock()
	for _, u := range updates {
		c.emitSessionUpdateSingle(u)
	}
	if stopReason != "" {
		c.completePrompt(turnID, stopReason)
	}
}

// --- prompt completion state machine ---

func (c *zcodeappConn) emitSessionUpdate(updates []protocol.SessionUpdateParams) {
	c.mu.Lock()
	h := c.respHandler
	c.mu.Unlock()
	if h == nil {
		return
	}
	for _, u := range updates {
		h(context.Background(), protocol.MethodSessionUpdate, mustRaw(u))
	}
}

func (c *zcodeappConn) emitSessionUpdateSingle(update protocol.SessionUpdateParams) {
	c.mu.Lock()
	h := c.respHandler
	c.mu.Unlock()
	if h == nil {
		return
	}
	h(context.Background(), protocol.MethodSessionUpdate, mustRaw(update))
}

// emitOrDeferUpdate buffers updates until the active turn id is known, then emits.
func (c *zcodeappConn) emitOrDeferUpdate(update protocol.SessionUpdateParams, turnID string) {
	c.mu.Lock()
	done := c.promptDone
	active := c.activeTurnID
	if done == nil {
		c.mu.Unlock()
		// no active prompt; emit directly (e.g. mid-flight after load)
		c.emitSessionUpdateSingle(update)
		return
	}
	if active == "" {
		c.pendingPromptUpdates = append(c.pendingPromptUpdates, update)
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	c.emitSessionUpdateSingle(update)
}

func (c *zcodeappConn) completePrompt(turnID string, stopReason string) {
	turnID = strings.TrimSpace(turnID)
	c.mu.Lock()
	done := c.promptDone
	if done == nil {
		c.mu.Unlock()
		return
	}
	if c.activeTurnID == "" {
		if c.pendingPromptStops == nil {
			c.pendingPromptStops = map[string]string{}
		}
		c.pendingPromptStops[turnID] = stopReason
		c.mu.Unlock()
		return
	}
	if c.activeTurnID != turnID && turnID != "" {
		c.mu.Unlock()
		return
	}
	c.promptDone = nil
	c.activeTurnID = ""
	c.mu.Unlock()
	select {
	case done <- zcodeappPromptResult{stopReason: stopReason}:
	default:
	}
}

func (c *zcodeappConn) clearPromptDone(done chan zcodeappPromptResult) {
	c.mu.Lock()
	if c.promptDone == done {
		c.promptDone = nil
		c.activeTurnID = ""
		c.pendingPromptStops = nil
		c.pendingPromptUpdates = nil
	}
	c.mu.Unlock()
}

func (c *zcodeappConn) failActivePrompt(err error) {
	if err == nil {
		err = errors.New("zcodeapp runtime stopped")
	}
	c.mu.Lock()
	done := c.promptDone
	c.promptDone = nil
	c.activeTurnID = ""
	c.pendingPromptStops = nil
	c.pendingPromptUpdates = nil
	c.mu.Unlock()
	if done != nil {
		select {
		case done <- zcodeappPromptResult{err: err}:
		default:
		}
	}
}

func (c *zcodeappConn) synthesizeCancel() {
	c.mu.Lock()
	done := c.promptDone
	c.promptDone = nil
	c.activeTurnID = ""
	c.mu.Unlock()
	if done != nil {
		select {
		case done <- zcodeappPromptResult{stopReason: protocol.StopReasonCancelled}:
		default:
		}
	}
}

func (c *zcodeappConn) currentSessionID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.acpSessionID
}

func (c *zcodeappConn) outboundSessionID(sessionID string) string {
	// ZCode sessionId == ACP sessionId (1:1), so echo back the ACP session id.
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.acpSessionID != "" {
		return c.acpSessionID
	}
	return sessionID
}

// replayMessages converts ZCode message history into ACP session/update
// notifications during session/load.
func (c *zcodeappConn) replayMessages(sid string, messages []zcodeMessage) {
	var updates []protocol.SessionUpdateParams
	for _, msg := range messages {
		role := msg.Info.Role
		for _, part := range msg.Parts {
			switch part.Type {
			case "text":
				upd := protocol.SessionUpdateAgentMessageChunk
				if role == "user" {
					upd = protocol.SessionUpdateUserMessageChunk
				}
				updates = append(updates, protocol.SessionUpdateParams{
					SessionID: sid,
					Update: protocol.SessionUpdate{
						SessionUpdate: upd,
						Content:       mustRaw(protocol.ContentBlock{Type: protocol.ContentBlockTypeText, Text: part.Text}),
					},
				})
			case "tool":
				if part.CallID == "" {
					continue
				}
				updates = append(updates, protocol.SessionUpdateParams{
					SessionID: sid,
					Update: protocol.SessionUpdate{
						SessionUpdate: protocol.SessionUpdateToolCall,
						ToolCallID:    part.CallID,
						Kind:          zcodePermissionKind(part.Tool),
						Title:         part.Tool,
						Status:        protocol.ToolCallStatusPending,
					},
				})
				status := protocol.ToolCallStatusCompleted
				updates = append(updates, protocol.SessionUpdateParams{
					SessionID: sid,
					Update: protocol.SessionUpdate{
						SessionUpdate: protocol.SessionUpdateToolCallUpdate,
						ToolCallID:    part.CallID,
						Status:        status,
						RawInput:      part.State.Input,
						RawOutput:     part.State.Output,
					},
				})
			}
		}
	}
	c.emitSessionUpdate(updates)
}

// --- helpers ---

func zcodeSessionIDFromParams(raw json.RawMessage) string {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return ""
	}
	return strings.TrimSpace(p.SessionID)
}

// zcodeSettingsToConfigOptions projects the ZCode settings block back into the
// ACP config option list. ZCode has no model/list RPC; the available models come
// from the settings block returned by session/create.
func zcodeSettingsToConfigOptions(s zcodeSettings) []protocol.ConfigOption {
	opts := []protocol.ConfigOption{}
	// approval preset / permission mode
	modeValues := []protocol.ConfigOptionValue{}
	for _, m := range []string{"yolo", "build", "edit", "plan"} {
		modeValues = append(modeValues, protocol.ConfigOptionValue{Value: m, Name: m, Description: zcodeModeDescription(m)})
	}
	opts = append(opts, protocol.ConfigOption{
		ID:           protocol.ConfigOptionIDApprovalPreset,
		Name:         "Approval",
		Category:     protocol.ConfigOptionCategoryApprovalPreset,
		Type:         "select",
		CurrentValue: s.Permission.Mode,
		Options:      modeValues,
	})
	// model
	modelValues := make([]protocol.ConfigOptionValue, 0, len(s.Model.Available))
	for _, m := range s.Model.Available {
		label := m.Label
		if label == "" {
			label = m.ModelID
		}
		modelValues = append(modelValues, protocol.ConfigOptionValue{Value: m.String(), Name: label, Description: m.ProviderID})
	}
	opts = append(opts, protocol.ConfigOption{
		ID:           protocol.ConfigOptionIDModel,
		Name:         "Model",
		Category:     protocol.ConfigOptionCategoryModel,
		Type:         "select",
		CurrentValue: s.Model.Current.String(),
		Options:      modelValues,
	})
	return opts
}

func zcodeModeDescription(mode string) string {
	switch mode {
	case "yolo":
		return "No approval required"
	case "build":
		return "Approve risky actions"
	case "edit":
		return "Approve non-edit actions"
	case "plan":
		return "Read-only"
	default:
		return mode
	}
}

func zcodeApprovalPresetToMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "yolo", "full", "full_access":
		return "yolo"
	case "read_only", "read-only", "plan":
		return "plan"
	case "edit":
		return "edit"
	default:
		return "build"
	}
}

func zcodeParseModelRef(value string) zcodeModelRef {
	value = strings.TrimSpace(value)
	if idx := strings.Index(value, "/"); idx > 0 {
		return zcodeModelRef{ProviderID: value[:idx], ModelID: value[idx+1:]}
	}
	return zcodeModelRef{ModelID: value}
}
