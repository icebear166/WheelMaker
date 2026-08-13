package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

var codexappANSIEscapePattern = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)

// codexAppProvider launches the native Codex app-server ACP bridge.
type codexAppProviderOptions struct {
	Provider       protocol.ACPProvider
	Title          string
	AllowImages    bool
	CodexHome      string
	SessionMapPath string
	Environment    []string
}

type codexAppProvider struct {
	options            codexAppProviderOptions
	lookPath           func(file string) (string, error)
	minimumVersion     string
	versionOutput      func(string) ([]byte, error)
	materializeCatalog func(string) (string, error)
	configArgs         func(string) []string
	configurationErr   error
	availabilityOnce   sync.Once
	availabilityErr    error
	resolvedExecutable string
}

func newCodexAppProvider(options codexAppProviderOptions) *codexAppProvider {
	return &codexAppProvider{
		options:  options,
		lookPath: exec.LookPath,
	}
}

func NewCodexAppProvider() *codexAppProvider {
	return newCodexAppProvider(codexAppProviderOptions{
		Provider:    protocol.ACPProviderCodex,
		Title:       "Codex App Server",
		AllowImages: true,
	})
}

func (p *codexAppProvider) Name() string {
	return string(p.options.Provider)
}

func (p *codexAppProvider) CheckAvailable() error {
	p.availabilityOnce.Do(func() {
		if p.configurationErr != nil {
			p.availabilityErr = p.configurationErr
			return
		}
		lookPath := p.lookPath
		if lookPath == nil {
			lookPath = exec.LookPath
		}
		executable, err := lookPath("codex")
		if err != nil {
			if p.minimumVersion != "" {
				p.availabilityErr = fmt.Errorf("%s requires Codex CLI >= %s; codex not found: %w", p.Name(), p.minimumVersion, err)
			} else {
				p.availabilityErr = fmt.Errorf("%s: codex not found: %w", p.Name(), err)
			}
			return
		}
		p.resolvedExecutable = executable
		if p.minimumVersion == "" {
			return
		}
		output, err := p.versionOutput(executable)
		if err != nil {
			p.availabilityErr = fmt.Errorf("%s requires Codex CLI >= %s; codex --version failed: %w", p.Name(), p.minimumVersion, err)
			return
		}
		version, err := parseCodexCLIVersion(output)
		if err != nil {
			p.availabilityErr = fmt.Errorf("%s requires Codex CLI >= %s: %w", p.Name(), p.minimumVersion, err)
			return
		}
		minimum, err := parseSemanticVersion(p.minimumVersion)
		if err != nil {
			p.availabilityErr = fmt.Errorf("%s: invalid minimum Codex version: %w", p.Name(), err)
			return
		}
		if version.lessThan(minimum) {
			p.availabilityErr = fmt.Errorf("%s requires Codex CLI >= %s; found %s", p.Name(), p.minimumVersion, version)
		}
	})
	return p.availabilityErr
}

func (p *codexAppProvider) Launch() (string, []string, []string, error) {
	if err := p.CheckAvailable(); err != nil {
		return "", nil, nil, err
	}
	args := []string{"app-server", "--listen", "stdio://"}
	if p.materializeCatalog != nil {
		catalogPath, err := p.materializeCatalog(p.options.CodexHome)
		if err != nil {
			return "", nil, nil, fmt.Errorf("%s: prepare model catalog: %w", p.Name(), err)
		}
		if p.configArgs == nil {
			return "", nil, nil, fmt.Errorf("%s: model provider overrides are unavailable", p.Name())
		}
		args = append(args, p.configArgs(catalogPath)...)
	}
	return p.resolvedExecutable, args, append([]string(nil), p.options.Environment...), nil
}

func codexappInstanceCreator(provider *codexAppProvider) InstanceCreator {
	return codexappInstanceCreatorWithStarter(provider, nil)
}

func codexappInstanceCreatorWithStarter(provider *codexAppProvider, starter codexappRuntimeStarter) InstanceCreator {
	if provider == nil {
		provider = NewCodexAppProvider()
	}
	if starter == nil {
		starter = func(_ context.Context, cwd string, projectName string) (*codexappRuntime, error) {
			return newCodexappRuntime(provider, cwd, projectName)
		}
	}
	pool := newCodexappRuntimePool(starter)
	return func(ctx context.Context, cwd string) (Instance, error) {
		exe, args, _, err := provider.Launch()
		if err != nil {
			return nil, err
		}
		projectName := ProjectNameFromContext(ctx)
		lease, err := pool.acquire(ctx, projectName, cwd, codexappLaunchFingerprint(exe, args))
		if err != nil {
			return nil, err
		}
		conn := newCodexappConnWithRuntimeAndProfile(lease.Runtime(), cwd, projectName, provider.connectionProfile())
		conn.lease = lease
		return NewInstance(provider.Name(), conn), nil
	}
}

func (p *codexAppProvider) connectionProfile() codexappConnProfile {
	profile := nativeCodexappConnProfile()
	if p == nil {
		return profile
	}
	if p.options.Provider != "" {
		profile.Provider = p.options.Provider
	}
	if strings.TrimSpace(p.options.Title) != "" {
		profile.Title = p.options.Title
	}
	profile.AllowImages = p.options.AllowImages
	if strings.TrimSpace(p.options.SessionMapPath) != "" {
		path := p.options.SessionMapPath
		profile.SessionMapPath = func() (string, error) { return path, nil }
	}
	return profile
}

type codexappTransport interface {
	SendMessage(v any) error
	OnMessage(h func(json.RawMessage))
	Done() <-chan struct{}
	Close() error
	Alive() bool
}

var codexappSessionMapPathFunc = func() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".wheelmaker", "codexapp-sessions.json"), nil
}

type codexappConnProfile struct {
	Provider       protocol.ACPProvider
	Title          string
	AllowImages    bool
	SessionMapPath func() (string, error)
}

func nativeCodexappConnProfile() codexappConnProfile {
	return codexappConnProfile{
		Provider:       protocol.ACPProviderCodex,
		Title:          "Codex App Server",
		AllowImages:    true,
		SessionMapPath: codexappSessionMapPathFunc,
	}
}

type codexappSessionMapFile struct {
	Sessions map[string]string `json:"sessions"`
}

func codexappMappedThreadID(sessionMapPath func() (string, error), acpSessionID string) string {
	acpSessionID = strings.TrimSpace(acpSessionID)
	if acpSessionID == "" {
		return ""
	}
	if sessionMapPath == nil {
		return ""
	}
	path, err := sessionMapPath()
	if err != nil || strings.TrimSpace(path) == "" {
		return ""
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var file codexappSessionMapFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return ""
	}
	return strings.TrimSpace(file.Sessions[acpSessionID])
}

func codexappStoreThreadMapping(sessionMapPath func() (string, error), acpSessionID string, runtimeThreadID string) {
	acpSessionID = strings.TrimSpace(acpSessionID)
	runtimeThreadID = strings.TrimSpace(runtimeThreadID)
	if acpSessionID == "" || runtimeThreadID == "" || acpSessionID == runtimeThreadID {
		return
	}
	if sessionMapPath == nil {
		return
	}
	path, err := sessionMapPath()
	if err != nil || strings.TrimSpace(path) == "" {
		return
	}
	file := codexappSessionMapFile{Sessions: map[string]string{}}
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &file)
		if file.Sessions == nil {
			file.Sessions = map[string]string{}
		}
	}
	file.Sessions[acpSessionID] = runtimeThreadID
	raw, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(path, raw, 0o600)
}

func newCodexappRuntime(provider *codexAppProvider, cwd string, projectName string) (*codexappRuntime, error) {
	exe, args, env, err := provider.Launch()
	if err != nil {
		return nil, err
	}
	raw := NewACPProcess(provider.Name(), exe, env, args...)
	raw.SetDir(cwd)
	if err := raw.Start(); err != nil {
		return nil, err
	}
	return newCodexappRuntimeWithTransport(raw), nil
}

type codexappRuntime struct {
	transport codexappTransport

	mu       sync.Mutex
	nextID   int64
	pending  map[string]chan codexappRPCResponse
	conns    map[string]*codexappConn
	queues   map[string]*codexappThreadQueue
	closed   bool
	closeErr error
	done     chan struct{}
	onStop   func(*codexappRuntime)

	initializeMu      sync.Mutex
	initialized       bool
	initializeAttempt *codexappInitializeAttempt
}

type codexappInitializeAttempt struct {
	done chan struct{}
	err  error
}

func newCodexappRuntimeWithTransport(transport codexappTransport) *codexappRuntime {
	rt := &codexappRuntime{
		transport: transport,
		pending:   map[string]chan codexappRPCResponse{},
		conns:     map[string]*codexappConn{},
		queues:    map[string]*codexappThreadQueue{},
		done:      make(chan struct{}),
	}
	if transport != nil {
		transport.OnMessage(rt.handleMessage)
		go rt.watchTransport()
	}
	return rt
}

type codexappThreadQueue struct {
	ch chan codexappRuntimeEvent
}

type codexappRuntimeEvent struct {
	msg     codexappRPCEnvelope
	request bool
}

type codexappRPCRequestError struct {
	Method  string
	Code    int
	Message string
}

func (e *codexappRPCRequestError) Error() string {
	return fmt.Sprintf("codexapp %s: %s", e.Method, e.Message)
}

func (r *codexappRuntime) request(ctx context.Context, method string, params any, out any) error {
	if r == nil || r.transport == nil {
		return errors.New("codexapp runtime is not ready")
	}
	id := atomic.AddInt64(&r.nextID, 1)
	idRaw, _ := json.Marshal(id)
	key := string(idRaw)
	ch := make(chan codexappRPCResponse, 1)

	r.mu.Lock()
	if r.closed {
		err := r.closeErr
		r.mu.Unlock()
		if err == nil {
			err = errors.New("codexapp runtime closed")
		}
		return err
	}
	r.pending[key] = ch
	r.mu.Unlock()

	req := codexappRPCRequest{ID: id, Method: method, Params: codexappParams(params)}
	if err := r.transport.SendMessage(req); err != nil {
		r.removePending(key)
		return err
	}

	select {
	case resp := <-ch:
		if resp.Error != nil {
			return &codexappRPCRequestError{
				Method:  method,
				Code:    resp.Error.Code,
				Message: resp.Error.Message,
			}
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
			return fmt.Errorf("codexapp %s: decode result: %w", method, err)
		}
		return nil
	case <-ctx.Done():
		r.removePending(key)
		return ctx.Err()
	case <-r.transport.Done():
		r.removePending(key)
		return errors.New("codexapp runtime stopped")
	}
}

func (r *codexappRuntime) notify(method string, params any) error {
	if r == nil || r.transport == nil {
		return errors.New("codexapp runtime is not ready")
	}
	r.mu.Lock()
	closed := r.closed
	closeErr := r.closeErr
	r.mu.Unlock()
	if closed {
		if closeErr == nil {
			closeErr = errors.New("codexapp runtime closed")
		}
		return closeErr
	}
	return r.transport.SendMessage(codexappRPCNotification{Method: method, Params: codexappParams(params)})
}

func (r *codexappRuntime) register(threadID string, conn *codexappConn) {
	threadID = strings.TrimSpace(threadID)
	if r == nil || threadID == "" || conn == nil {
		return
	}
	r.mu.Lock()
	r.conns[threadID] = conn
	r.mu.Unlock()
}

func (r *codexappRuntime) unregister(threadID string, conn *codexappConn) {
	threadID = strings.TrimSpace(threadID)
	if r == nil || threadID == "" {
		return
	}
	r.mu.Lock()
	if r.conns[threadID] == conn {
		delete(r.conns, threadID)
	}
	r.mu.Unlock()
}

func (r *codexappRuntime) watchTransport() {
	if r == nil || r.transport == nil {
		return
	}
	<-r.transport.Done()
	_ = r.terminate(errors.New("codexapp runtime stopped"), false)
}

func (r *codexappRuntime) setOnStop(onStop func(*codexappRuntime)) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.onStop = onStop
	r.mu.Unlock()
}

func (r *codexappRuntime) close() error {
	return r.terminate(errors.New("codexapp runtime closed"), true)
}

func (r *codexappRuntime) terminate(err error, closeTransport bool) error {
	if r == nil {
		return nil
	}
	if err == nil {
		err = errors.New("codexapp runtime stopped")
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
		ch <- codexappRPCResponse{Error: &codexappRPCError{Code: -32000, Message: r.closeErr.Error()}}
	}
	conns := make([]*codexappConn, 0, len(r.conns))
	for _, conn := range r.conns {
		conns = append(conns, conn)
	}
	onStop := r.onStop
	r.mu.Unlock()
	for _, conn := range conns {
		conn.failActivePrompt(r.closeErr)
		conn.failActiveCompact(r.closeErr)
	}
	if onStop != nil {
		onStop(r)
	}
	if !closeTransport || r.transport == nil {
		return nil
	}
	return r.transport.Close()
}

func (r *codexappRuntime) alive() bool {
	return r != nil && r.transport != nil && r.transport.Alive()
}

func (r *codexappRuntime) removePending(key string) {
	r.mu.Lock()
	delete(r.pending, key)
	r.mu.Unlock()
}

func (r *codexappRuntime) handleMessage(raw json.RawMessage) {
	var msg codexappRPCEnvelope
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
		r.enqueueThreadEvent(codexappThreadIDFromParams(msg.Params), codexappRuntimeEvent{msg: msg, request: true})
		return
	}
	r.enqueueThreadEvent(codexappThreadIDFromParams(msg.Params), codexappRuntimeEvent{msg: msg})
}

func (r *codexappRuntime) enqueueThreadEvent(threadID string, event codexappRuntimeEvent) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return
	}
	queue := r.threadQueue(threadID)
	if queue == nil {
		return
	}
	select {
	case queue.ch <- event:
	case <-r.done:
	}
}

func (r *codexappRuntime) threadQueue(threadID string) *codexappThreadQueue {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	if queue := r.queues[threadID]; queue != nil {
		return queue
	}
	queue := &codexappThreadQueue{ch: make(chan codexappRuntimeEvent, 64)}
	r.queues[threadID] = queue
	go r.runThreadQueue(queue)
	return queue
}

func (r *codexappRuntime) runThreadQueue(queue *codexappThreadQueue) {
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

func (r *codexappRuntime) resolveResponse(msg codexappRPCEnvelope) {
	key := string(msg.ID)
	r.mu.Lock()
	ch := r.pending[key]
	delete(r.pending, key)
	r.mu.Unlock()
	if ch == nil {
		return
	}
	ch <- codexappRPCResponse{Result: msg.Result, Error: msg.Error}
}

func (r *codexappRuntime) handleNotification(msg codexappRPCEnvelope) {
	threadID := codexappThreadIDFromParams(msg.Params)
	if threadID == "" {
		return
	}
	conn := r.connForThread(threadID)
	if conn == nil {
		return
	}
	conn.handleAppServerNotification(msg.Method, msg.Params)
}

func (r *codexappRuntime) handleServerRequest(msg codexappRPCEnvelope) {
	threadID := codexappThreadIDFromParams(msg.Params)
	conn := r.connForThread(threadID)
	if conn == nil {
		_ = r.transport.SendMessage(codexappRPCServerResponse{
			ID:    msg.ID,
			Error: &codexappRPCError{Code: -32601, Message: "method not found: " + msg.Method},
		})
		return
	}
	result, err := conn.handleAppServerRequest(context.Background(), msg.Method, msg.Params)
	if err != nil {
		code := -32000
		var methodNotFound codexappMethodNotFoundError
		if errors.As(err, &methodNotFound) {
			code = -32601
		}
		_ = r.transport.SendMessage(codexappRPCServerResponse{
			ID:    msg.ID,
			Error: &codexappRPCError{Code: code, Message: err.Error()},
		})
		return
	}
	_ = r.transport.SendMessage(codexappRPCServerResponse{ID: msg.ID, Result: result})
}

func (r *codexappRuntime) connForThread(threadID string) *codexappConn {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.conns[threadID]
}

type codexappConn struct {
	runtime   *codexappRuntime
	lease     *codexappRuntimeLease
	profile   codexappConnProfile
	cwd       string
	closeOnce sync.Once
	closeErr  error

	mu                sync.Mutex
	reqHandler        ACPRequestHandler
	respHandler       ACPResponseHandler
	acpSessionID      string
	threadID          string
	projectName       string
	config            codexappConfigState
	activeTurnID      string
	lastTurnID        string
	promptDone        chan codexappPromptResult
	compactDone       chan SessionCompactResult
	compactTurnID     string
	compactItemID     string
	compactGen        uint64
	startedTools      map[string]bool
	messagePhases     map[string]string
	completedMessages map[string]bool
	goal              *protocol.SessionGoal
	goalTurnActive    bool
	wmInitialized     bool
	wmExtensions      protocol.WMNegotiatedExtensions

	pendingPromptStops   map[string]string
	pendingPromptUpdates map[string][]protocol.SessionUpdateParams
	pendingTurnDiffs     map[string]string
	pendingSteers        map[string]*codexappSteerTracker
}

type codexappSteerTracker struct {
	turnID string
	blocks []protocol.ContentBlock
}

type codexappPromptResult struct {
	stopReason string
	turnID     string
	artifacts  []protocol.SessionPromptArtifactPayload
	err        error
}

var codexappCancelCompletionTimeout = 3 * time.Second
var codexappCompactCompletionTimeout = 2 * time.Minute

func newCodexappConnWithRuntime(runtime *codexappRuntime, cwd string) *codexappConn {
	return newCodexappConnWithRuntimeAndProject(runtime, cwd, "")
}

func newCodexappConnWithRuntimeAndProject(runtime *codexappRuntime, cwd string, projectName string) *codexappConn {
	return newCodexappConnWithRuntimeAndProfile(runtime, cwd, projectName, nativeCodexappConnProfile())
}

func newCodexappConnWithRuntimeAndProfile(runtime *codexappRuntime, cwd string, projectName string, profile codexappConnProfile) *codexappConn {
	if profile.Provider == "" {
		profile = nativeCodexappConnProfile()
	} else {
		if strings.TrimSpace(profile.Title) == "" {
			profile.Title = string(profile.Provider)
		}
		if profile.SessionMapPath == nil {
			profile.SessionMapPath = codexappSessionMapPathFunc
		}
	}
	return &codexappConn{
		runtime:     runtime,
		profile:     profile,
		cwd:         cwd,
		projectName: strings.TrimSpace(projectName),
		config:      newCodexappConfigState(),
	}
}

func (c *codexappConn) mappedThreadID(acpSessionID string) string {
	return codexappMappedThreadID(c.profile.SessionMapPath, acpSessionID)
}

func (c *codexappConn) storeThreadMapping(acpSessionID, runtimeThreadID string) {
	codexappStoreThreadMapping(c.profile.SessionMapPath, acpSessionID, runtimeThreadID)
}

func (c *codexappConn) promptToInputWithArtifacts(sessionID string, blocks []protocol.ContentBlock) ([]appServerUserInput, error) {
	if !c.profile.AllowImages {
		for _, block := range blocks {
			usesImage, err := codexappPromptBlockUsesImage(block)
			if err != nil {
				return nil, err
			}
			if usesImage {
				return nil, fmt.Errorf("%s does not support image prompt content", c.profile.Provider)
			}
		}
	}
	return codexappPromptToInputWithArtifacts(c.projectName, sessionID, blocks)
}

func codexappPromptBlockUsesImage(block protocol.ContentBlock) (bool, error) {
	switch block.Type {
	case protocol.ContentBlockTypeImage:
		return true, nil
	case protocol.ContentBlockTypeResourceLink:
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(block.MimeType)), "image/") {
			return true, nil
		}
		path, isFile, err := codexappResourceLinkFilePath(block)
		if err != nil {
			return false, err
		}
		return isFile && codexappResourceLinkIsImage(block, path), nil
	default:
		return false, nil
	}
}

var _ Conn = (*codexappConn)(nil)

func (c *codexappConn) Send(ctx context.Context, method string, params any, result any) error {
	switch method {
	case protocol.MethodInitialize:
		var p protocol.InitializeParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		return c.sendInitialize(ctx, p, result)
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
	case protocol.MethodSessionSteering:
		var p protocol.SessionSteeringParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		messageID := protocol.WMSessionSteeringMessageID(p.Meta)
		if messageID == "" {
			messageID = fmt.Sprintf("native-steer-%d", time.Now().UnixNano())
		}
		out, err := c.SteerSession(ctx, p.SessionID, messageID, p.Prompt)
		if err != nil {
			return err
		}
		return assignResult(result, protocol.SessionSteeringResponse{
			Outcome:        protocol.SessionSteeringOutcomeInjected,
			ProviderTurnID: out.ProviderTurnID,
		})
	case protocol.MethodSessionFork:
		var p protocol.SessionForkParams
		if err := remarshal(params, &p); err != nil {
			return err
		}
		var forked protocol.SessionForkResult
		var err error
		extension, historical := protocol.WMSessionForkExtensionFromMeta(p.Meta)
		if historical {
			forked, err = c.ForkSession(ctx, p.SessionID, extension.Ref, extension.Prompts)
		} else {
			forked, err = c.ForkCurrentSession(ctx, p.SessionID)
		}
		if err != nil {
			return err
		}
		response := protocol.SessionForkResponse{
			SessionID:     forked.SessionID,
			ConfigOptions: append([]protocol.ConfigOption(nil), forked.ConfigOptions...),
		}
		if historical {
			response.Meta = protocol.BuildWMSessionForkResultMeta(nil, protocol.WMSessionForkResultExtension{
				Title:      forked.Title,
				ForkPoints: forked.ForkPoints,
			})
		}
		return assignResult(result, response)
	case protocol.MethodSetConfigOption:
		var request protocol.SetSessionConfigOptionRequest
		if err := remarshal(params, &request); err != nil {
			return err
		}
		p := protocol.SessionSetConfigOptionParams{SessionID: request.SessionID, ConfigID: request.ConfigID, Meta: request.Meta}
		switch value := request.Variant.(type) {
		case protocol.SetSessionConfigValueID:
			p.Value = value.Value
		case protocol.SetSessionConfigBoolean:
			if value.Value {
				p.Value = "true"
			} else {
				p.Value = "false"
			}
		default:
			return fmt.Errorf("unsupported config value %T", request.Variant)
		}
		return c.sendSetConfigOption(result, p)
	case protocol.MethodWMSessionSteer:
		var p protocol.WMSessionSteerParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		out, err := c.SteerSession(ctx, p.SessionID, p.MessageID, p.Prompt)
		if err != nil {
			return codexappWMActionError(err)
		}
		return assignResult(result, protocol.WMSessionSteerResult{TurnID: out.ProviderTurnID})
	case protocol.MethodWMSessionCompact:
		var p protocol.WMSessionCompactParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		done, err := c.CompactSession(ctx, p.SessionID)
		if err != nil {
			return codexappWMActionError(err)
		}
		select {
		case outcome, ok := <-done:
			if !ok {
				return errors.New("compact ended without a result")
			}
			if outcome.Err != nil {
				return codexappWMActionError(outcome.Err)
			}
			return assignResult(result, protocol.WMSessionCompactResult{})
		case <-ctx.Done():
			return ctx.Err()
		}
	case protocol.MethodWMSessionGoalSet:
		var p protocol.WMSessionGoalSetParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		goal, err := c.SessionGoalSet(ctx, protocol.SessionGoalSetParams{SessionID: p.SessionID, Objective: p.Objective, Status: p.Status, TokenBudget: p.TokenBudget})
		if err != nil {
			return codexappWMActionError(err)
		}
		return assignResult(result, protocol.WMSessionGoalResult{Goal: &goal})
	case protocol.MethodWMSessionGoalGet:
		var p protocol.WMSessionGoalParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		goal, err := c.SessionGoalGet(ctx, p.SessionID)
		if err != nil {
			return codexappWMActionError(err)
		}
		return assignResult(result, protocol.WMSessionGoalResult{Goal: goal})
	case protocol.MethodWMSessionGoalClear:
		var p protocol.WMSessionGoalParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		if err := c.SessionGoalClear(ctx, p.SessionID); err != nil {
			return codexappWMActionError(err)
		}
		return assignResult(result, protocol.WMSessionOKResult{OK: true})
	case protocol.MethodWMSessionForkResolve:
		var p protocol.WMSessionForkResolveParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		points, err := c.ResolveForkPoints(ctx, p.SessionID, p.Prompts)
		if err != nil {
			return codexappWMActionError(err)
		}
		return assignResult(result, protocol.WMSessionForkResolveResult{ForkPoints: points})
	case protocol.MethodWMSessionFork:
		var p protocol.WMSessionForkParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		forked, err := c.ForkSession(ctx, p.SessionID, p.Ref, p.Prompts)
		if err != nil {
			return codexappWMActionError(err)
		}
		return assignResult(result, protocol.WMSessionForkResult{SessionID: forked.SessionID, Title: forked.Title, ForkPoints: forked.ForkPoints})
	case protocol.MethodWMSessionArchive:
		var p protocol.WMSessionArchiveParams
		if err := remarshalWM(params, &p); err != nil {
			return err
		}
		var err error
		if p.Archived {
			err = c.ArchiveSession(ctx, p.SessionID)
		} else {
			err = c.UnarchiveSession(ctx, p.SessionID)
		}
		if err != nil {
			return codexappWMActionError(err)
		}
		return assignResult(result, protocol.WMSessionOKResult{OK: true})
	default:
		return fmt.Errorf("codexapp: unsupported ACP method %s", method)
	}
}

func codexappWMActionError(err error) error {
	if err == nil {
		return nil
	}
	code := ""
	switch {
	case errors.Is(err, ErrSessionSteerInactive):
		code = protocol.WMActionErrorInactive
	case errors.Is(err, ErrSessionBusy):
		code = protocol.WMActionErrorBusy
	case errors.Is(err, ErrSessionSteerUnavailable):
		code = protocol.WMActionErrorUnavailable
	case errors.Is(err, ErrSessionActionUnsupported), errors.Is(err, ErrSessionArchiveUnsupported):
		code = protocol.WMActionErrorUnsupported
	case errors.Is(err, ErrSessionActionInvalid):
		code = protocol.WMActionErrorInvalid
	default:
		return err
	}
	return protocol.NewWMActionRPCError(code, err.Error())
}

func (c *codexappConn) Notify(method string, params any) error {
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

func (c *codexappConn) OnACPRequest(h ACPRequestHandler) {
	c.mu.Lock()
	c.reqHandler = h
	c.mu.Unlock()
}

func (c *codexappConn) OnACPResponse(h ACPResponseHandler) {
	c.mu.Lock()
	c.respHandler = h
	c.mu.Unlock()
}

func (c *codexappConn) Close() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		c.mu.Lock()
		threadID := c.threadID
		c.mu.Unlock()
		if c.runtime == nil {
			return
		}
		c.runtime.unregister(threadID, c)
		c.failActivePrompt(errors.New("codexapp connection closed"))
		c.failActiveCompact(errors.New("codexapp connection closed"))
		if c.lease != nil {
			c.closeErr = c.lease.Release()
			return
		}
		c.closeErr = c.runtime.close()
	})
	return c.closeErr
}

func (c *codexappConn) Alive() bool {
	return c != nil && c.runtime != nil && c.runtime.alive()
}

func (c *codexappConn) BindSessionID(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	c.mu.Lock()
	runtimeThreadID := c.threadID
	c.mu.Unlock()
	if runtimeThreadID == "" {
		runtimeThreadID = sessionID
	}
	c.bindSessionIDs(sessionID, runtimeThreadID)
}

func (c *codexappConn) bindSessionIDs(acpSessionID string, runtimeThreadID string) {
	acpSessionID = strings.TrimSpace(acpSessionID)
	runtimeThreadID = strings.TrimSpace(runtimeThreadID)
	if acpSessionID == "" || runtimeThreadID == "" {
		return
	}
	c.mu.Lock()
	old := c.threadID
	c.acpSessionID = acpSessionID
	c.threadID = runtimeThreadID
	c.mu.Unlock()
	if c.runtime != nil {
		if old != "" && old != runtimeThreadID {
			c.runtime.unregister(old, c)
		}
		c.runtime.register(runtimeThreadID, c)
	}
}

func (c *codexappConn) runtimeThreadIDForSession(acpSessionID string) string {
	acpSessionID = strings.TrimSpace(acpSessionID)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.threadID != "" && (acpSessionID == "" || c.acpSessionID == "" || c.acpSessionID == acpSessionID || c.threadID == acpSessionID) {
		return c.threadID
	}
	return acpSessionID
}

func (c *codexappConn) outboundSessionID(runtimeThreadID string) string {
	runtimeThreadID = strings.TrimSpace(runtimeThreadID)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.threadID == runtimeThreadID && c.acpSessionID != "" {
		return c.acpSessionID
	}
	if c.acpSessionID != "" && runtimeThreadID == "" {
		return c.acpSessionID
	}
	return runtimeThreadID
}

func (c *codexappConn) sendInitialize(ctx context.Context, params protocol.InitializeParams, result any) error {
	if err := c.runtime.initialize(ctx, func(ctx context.Context) error {
		var ignored json.RawMessage
		if err := c.runtime.request(ctx, "initialize", appServerInitializeParams{
			ClientInfo: appServerClientInfo{Name: "wheelmaker", Title: "WheelMaker", Version: "0.1.0"},
		}, &ignored); err != nil {
			return err
		}
		return c.runtime.notify("initialized", nil)
	}); err != nil {
		return err
	}
	out := protocol.InitializeResult{
		ProtocolVersion: json.Number("1"),
		AgentInfo:       &protocol.AgentInfo{Name: string(c.profile.Provider), Title: c.profile.Title},
		AgentCapabilities: protocol.AgentCapabilities{
			LoadSession: true,
			PromptCapabilities: &protocol.PromptCapabilities{
				Image:           c.profile.AllowImages,
				Audio:           false,
				EmbeddedContext: false,
			},
			SessionCapabilities: &protocol.SessionCapabilities{
				List: &protocol.SessionListCapability{},
				Fork: &protocol.SessionForkCapability{},
			},
			Meta: protocol.BuildWMAgentCapabilitiesMeta(nil, protocol.WMAgentExtensionCapabilities{
				MessageLifecycle: true,
				GoalLifecycle:    true,
				SessionActions: protocol.WMSessionActionCapabilities{
					Steer: true, Compact: true, Goal: true, Fork: true, Archive: true,
				},
			}),
		},
		Meta: json.RawMessage(`{"steering":{"supported":true}}`),
	}
	c.mu.Lock()
	c.wmInitialized = true
	c.wmExtensions = protocol.NegotiateWMExtensions(params.ClientCapabilities.Meta, out.AgentCapabilities.Meta)
	c.mu.Unlock()
	return assignResult(result, out)
}

func (c *codexappConn) sendSessionNew(ctx context.Context, p protocol.SessionNewParams, result any) error {
	if len(p.MCPServers) > 0 {
		return errors.New("codexapp phase 1 does not support MCP servers")
	}
	if err := c.refreshModels(ctx); err != nil {
		return err
	}
	req := c.config.threadStartParams(firstNonEmptyString(p.CWD, c.cwd))
	var resp appServerThreadStartResponse
	if err := c.runtime.request(ctx, "thread/start", req, &resp); err != nil {
		return err
	}
	threadID := strings.TrimSpace(resp.Thread.ID)
	if threadID == "" {
		return errors.New("codexapp thread/start returned empty thread id")
	}
	c.bindSessionIDs(threadID, threadID)
	threadTitle := strings.TrimSpace(resp.Thread.displayTitle())
	if threadTitle != "" {
		c.emitSessionUpdate(protocol.SessionUpdateParams{
			SessionID: threadID,
			Update: protocol.SessionUpdate{
				SessionUpdate: protocol.SessionUpdateSessionInfoUpdate,
				Title:         threadTitle,
			},
		})
	}
	return assignResult(result, protocol.SessionNewResult{
		SessionID:     threadID,
		ConfigOptions: c.config.options(),
	})
}

func (c *codexappConn) sendSessionLoad(ctx context.Context, p protocol.SessionLoadParams, result any) error {
	if len(p.MCPServers) > 0 {
		return errors.New("codexapp phase 1 does not support MCP servers")
	}
	acpSessionID := strings.TrimSpace(p.SessionID)
	if acpSessionID == "" {
		return errors.New("codexapp session/load requires sessionId")
	}
	if err := c.refreshModels(ctx); err != nil {
		return err
	}
	cwd := firstNonEmptyString(p.CWD, c.cwd)
	runtimeThreadID := firstNonEmptyString(c.mappedThreadID(acpSessionID), acpSessionID)
	// Resume can immediately emit Goal and Turn notifications. Register the
	// stable/runtime mapping before the request so those notifications are not
	// dropped by the shared runtime dispatcher.
	c.bindSessionIDs(acpSessionID, runtimeThreadID)
	req := c.config.threadResumeParams(runtimeThreadID, cwd)
	var resp appServerThreadStartResponse
	recreatedThread := false
	if err := c.runtime.request(ctx, "thread/resume", req, &resp); err != nil {
		if !codexappNoRolloutError(err) {
			return err
		}
		startReq := c.config.threadStartParams(cwd)
		if err := c.runtime.request(ctx, "thread/start", startReq, &resp); err != nil {
			return err
		}
		recreatedThread = true
	}
	if resp.Thread.ID != "" {
		runtimeThreadID = strings.TrimSpace(resp.Thread.ID)
	}
	if runtimeThreadID == "" {
		return errors.New("codexapp thread/resume returned empty thread id")
	}
	if !recreatedThread && codexappThreadNeedsFullRead(resp.Thread.Turns) {
		readReq := appServerThreadReadParams{ThreadID: runtimeThreadID, IncludeTurns: true}
		if err := c.runtime.request(ctx, "thread/read", readReq, &resp); err != nil {
			return err
		}
		if resp.Thread.ID != "" {
			runtimeThreadID = strings.TrimSpace(resp.Thread.ID)
		}
	}
	c.bindSessionIDs(acpSessionID, runtimeThreadID)
	c.storeThreadMapping(acpSessionID, runtimeThreadID)
	threadTitle := strings.TrimSpace(resp.Thread.displayTitle())
	if threadTitle != "" {
		c.emitSessionUpdate(protocol.SessionUpdateParams{
			SessionID: acpSessionID,
			Update: protocol.SessionUpdate{
				SessionUpdate: protocol.SessionUpdateSessionInfoUpdate,
				Title:         threadTitle,
			},
		})
	}
	c.replayThreadTurns(acpSessionID, resp.Thread.Turns)
	return assignResult(result, protocol.SessionLoadResult{ConfigOptions: c.config.options()})
}

func (c *codexappConn) sendSessionList(ctx context.Context, p protocol.SessionListParams, result any) error {
	var resp appServerThreadListResponse
	if err := c.runtime.request(ctx, "thread/list", appServerThreadListParams{CWD: p.CWD, Cursor: p.Cursor}, &resp); err != nil {
		return err
	}
	out := protocol.SessionListResult{NextCursor: resp.NextCursor}
	for _, thread := range resp.Data {
		out.Sessions = append(out.Sessions, protocol.SessionInfo{
			SessionID: thread.ID,
			CWD:       thread.CWD,
			Title:     thread.displayTitle(),
			UpdatedAt: string(thread.UpdatedAt),
		})
	}
	return assignResult(result, out)
}

func (c *codexappConn) ArchiveSession(ctx context.Context, sessionID string) error {
	return c.sendThreadArchiveState(ctx, sessionID, true)
}

func (c *codexappConn) UnarchiveSession(ctx context.Context, sessionID string) error {
	return c.sendThreadArchiveState(ctx, sessionID, false)
}

func (c *codexappConn) SessionGoalSet(ctx context.Context, params protocol.SessionGoalSetParams) (protocol.SessionGoal, error) {
	sessionID := strings.TrimSpace(params.SessionID)
	threadID := firstNonEmptyString(c.runtimeThreadIDForSession(sessionID), c.mappedThreadID(sessionID), sessionID)
	if threadID == "" {
		return protocol.SessionGoal{}, errors.New("codexapp goal set requires sessionId")
	}
	request := map[string]any{"threadId": threadID}
	if params.Objective != nil {
		request["objective"] = *params.Objective
	}
	if params.Status != nil {
		request["status"] = *params.Status
	}
	if params.TokenBudget.Present {
		request["tokenBudget"] = params.TokenBudget.Value
	}
	var response appServerThreadGoalSetResponse
	if err := c.runtime.request(ctx, "thread/goal/set", request, &response); err != nil {
		return protocol.SessionGoal{}, err
	}
	return normalizeCodexappGoal(response.Goal, firstNonEmptyString(sessionID, c.outboundSessionID(threadID))), nil
}

func (c *codexappConn) SessionGoalGet(ctx context.Context, sessionID string) (*protocol.SessionGoal, error) {
	sessionID = strings.TrimSpace(sessionID)
	threadID := firstNonEmptyString(c.runtimeThreadIDForSession(sessionID), c.mappedThreadID(sessionID), sessionID)
	if threadID == "" {
		return nil, errors.New("codexapp goal get requires sessionId")
	}
	var response appServerThreadGoalGetResponse
	if err := c.runtime.request(ctx, "thread/goal/get", appServerThreadGoalClearParams{ThreadID: threadID}, &response); err != nil {
		return nil, err
	}
	if response.Goal == nil {
		return nil, nil
	}
	goal := normalizeCodexappGoal(*response.Goal, firstNonEmptyString(sessionID, c.outboundSessionID(threadID)))
	return &goal, nil
}

func (c *codexappConn) SessionGoalClear(ctx context.Context, sessionID string) error {
	sessionID = strings.TrimSpace(sessionID)
	threadID := firstNonEmptyString(c.runtimeThreadIDForSession(sessionID), c.mappedThreadID(sessionID), sessionID)
	if threadID == "" {
		return errors.New("codexapp goal clear requires sessionId")
	}
	var response appServerThreadGoalClearResponse
	return c.runtime.request(ctx, "thread/goal/clear", appServerThreadGoalClearParams{ThreadID: threadID}, &response)
}

func normalizeCodexappGoal(goal appServerThreadGoal, sessionID string) protocol.SessionGoal {
	return protocol.SessionGoal{
		SessionID:       strings.TrimSpace(sessionID),
		Objective:       goal.Objective,
		Status:          goal.Status,
		TokenBudget:     goal.TokenBudget,
		TokensUsed:      goal.TokensUsed,
		TimeUsedSeconds: goal.TimeUsedSeconds,
		CreatedAt:       goal.CreatedAt,
		UpdatedAt:       goal.UpdatedAt,
	}
}

func (c *codexappConn) sendThreadArchiveState(ctx context.Context, sessionID string, archived bool) error {
	sessionID = strings.TrimSpace(sessionID)
	threadID := firstNonEmptyString(c.mappedThreadID(sessionID), c.runtimeThreadIDForSession(sessionID), sessionID)
	if threadID == "" {
		return errors.New("codexapp archive requires sessionId")
	}
	method := "thread/unarchive"
	if archived {
		method = "thread/archive"
	}
	var ignored json.RawMessage
	return c.runtime.request(ctx, method, appServerThreadArchiveParams{ThreadID: threadID}, &ignored)
}

func (c *codexappConn) SteerSession(
	ctx context.Context,
	sessionID string,
	clientMessageID string,
	blocks []protocol.ContentBlock,
) (SessionSteerResult, error) {
	threadID := c.runtimeThreadIDForSession(sessionID)
	if threadID == "" {
		return SessionSteerResult{}, errors.New("codexapp steer requires sessionId")
	}
	input, err := c.promptToInputWithArtifacts(sessionID, blocks)
	if err != nil {
		return SessionSteerResult{}, err
	}

	c.mu.Lock()
	expectedTurnID := strings.TrimSpace(c.activeTurnID)
	if (c.promptDone == nil && !c.goalTurnActive) || expectedTurnID == "" {
		c.mu.Unlock()
		return SessionSteerResult{}, ErrSessionSteerInactive
	}
	if c.pendingSteers == nil {
		c.pendingSteers = make(map[string]*codexappSteerTracker)
	}
	tracker := &codexappSteerTracker{
		turnID: expectedTurnID,
		blocks: cloneCodexappContentBlocks(blocks),
	}
	c.pendingSteers[clientMessageID] = tracker
	c.mu.Unlock()

	var response appServerTurnSteerResponse
	err = c.runtime.request(ctx, "turn/steer", appServerTurnSteerParams{
		ThreadID:            threadID,
		ExpectedTurnID:      expectedTurnID,
		ClientUserMessageID: clientMessageID,
		Input:               input,
	}, &response)
	if err != nil {
		c.removePendingSteer(clientMessageID, tracker)
		return SessionSteerResult{}, classifyCodexappSteerError(err)
	}
	if strings.TrimSpace(response.TurnID) != expectedTurnID {
		c.removePendingSteer(clientMessageID, tracker)
		return SessionSteerResult{}, fmt.Errorf(
			"codexapp turn/steer accepted turn %q, expected %q",
			response.TurnID,
			expectedTurnID,
		)
	}
	return SessionSteerResult{ProviderTurnID: response.TurnID}, nil
}

func (c *codexappConn) removePendingSteer(clientMessageID string, tracker *codexappSteerTracker) {
	c.mu.Lock()
	if c.pendingSteers[clientMessageID] == tracker {
		delete(c.pendingSteers, clientMessageID)
	}
	c.mu.Unlock()
}

func classifyCodexappSteerError(err error) error {
	var requestErr *codexappRPCRequestError
	if !errors.As(err, &requestErr) {
		return err
	}
	message := strings.ToLower(strings.TrimSpace(requestErr.Message))
	switch {
	case message == "no active turn to steer",
		strings.HasPrefix(message, "expected active turn id"):
		return fmt.Errorf("%w: %s", ErrSessionSteerInactive, requestErr.Message)
	case strings.Contains(message, "not steerable"):
		return fmt.Errorf("%w: %s", ErrSessionSteerUnavailable, requestErr.Message)
	default:
		return err
	}
}

func (c *codexappConn) CompactSession(ctx context.Context, sessionID string) (<-chan SessionCompactResult, error) {
	threadID := firstNonEmptyString(c.runtimeThreadIDForSession(sessionID), c.mappedThreadID(sessionID))
	if strings.TrimSpace(threadID) == "" {
		return nil, errors.New("codexapp compact requires sessionId")
	}
	done := make(chan SessionCompactResult, 1)
	c.mu.Lock()
	if c.promptDone != nil || c.compactDone != nil {
		c.mu.Unlock()
		return nil, ErrSessionBusy
	}
	c.compactGen++
	generation := c.compactGen
	c.compactDone = done
	c.compactTurnID = ""
	c.compactItemID = ""
	c.mu.Unlock()

	var ignored json.RawMessage
	if err := c.runtime.request(ctx, "thread/compact/start", appServerThreadCompactStartParams{ThreadID: threadID}, &ignored); err != nil {
		c.clearCompactDone(done)
		return nil, err
	}
	go c.waitForCompactTimeout(done, generation)
	return done, nil
}

func (c *codexappConn) ResolveForkPoints(ctx context.Context, sessionID string, prompts []protocol.SessionForkPrompt) (map[int64]protocol.SessionForkPoint, error) {
	threadID := firstNonEmptyString(c.runtimeThreadIDForSession(sessionID), c.mappedThreadID(sessionID), strings.TrimSpace(sessionID))
	if threadID == "" {
		return nil, errors.New("codexapp fork point resolution requires sessionId")
	}
	var resp appServerThreadStartResponse
	if err := c.runtime.request(ctx, "thread/read", appServerThreadReadParams{
		ThreadID:     threadID,
		IncludeTurns: true,
	}, &resp); err != nil {
		return nil, err
	}
	points, matched, err := c.matchForkPromptTurns(sessionID, prompts, resp.Thread.Turns)
	if err != nil {
		return nil, err
	}
	if !matched {
		return map[int64]protocol.SessionForkPoint{}, nil
	}
	return points, nil
}

func (c *codexappConn) ForkSession(ctx context.Context, sessionID string, lastTurnID string, prompts []protocol.SessionForkPrompt) (protocol.SessionForkResult, error) {
	threadID := firstNonEmptyString(c.runtimeThreadIDForSession(sessionID), c.mappedThreadID(sessionID), strings.TrimSpace(sessionID))
	lastTurnID = strings.TrimSpace(lastTurnID)
	if threadID == "" || lastTurnID == "" {
		return protocol.SessionForkResult{}, errors.New("codexapp fork requires sessionId and last turn id")
	}
	var resp appServerThreadStartResponse
	if err := c.runtime.request(ctx, "thread/fork", appServerThreadForkParams{
		ThreadID:   threadID,
		LastTurnID: lastTurnID,
	}, &resp); err != nil {
		return protocol.SessionForkResult{}, err
	}
	targetThreadID := strings.TrimSpace(resp.Thread.ID)
	if targetThreadID == "" {
		return protocol.SessionForkResult{}, errors.New("codexapp thread/fork returned empty thread id")
	}
	if codexappThreadNeedsFullRead(resp.Thread.Turns) {
		if err := c.runtime.request(ctx, "thread/read", appServerThreadReadParams{
			ThreadID:     targetThreadID,
			IncludeTurns: true,
		}, &resp); err != nil {
			_ = c.archiveForkTarget(context.Background(), targetThreadID)
			return protocol.SessionForkResult{}, err
		}
	}
	points, matched, err := c.matchForkPromptTurns(sessionID, prompts, resp.Thread.Turns)
	if err != nil || !matched {
		_ = c.archiveForkTarget(context.Background(), targetThreadID)
		if err != nil {
			return protocol.SessionForkResult{}, err
		}
		return protocol.SessionForkResult{}, errors.New("codexapp forked thread turns do not match source prompts")
	}
	return protocol.SessionForkResult{
		SessionID:  targetThreadID,
		Title:      strings.TrimSpace(resp.Thread.displayTitle()),
		ForkPoints: points,
	}, nil
}

func (c *codexappConn) ForkCurrentSession(ctx context.Context, sessionID string) (protocol.SessionForkResult, error) {
	threadID := firstNonEmptyString(c.runtimeThreadIDForSession(sessionID), c.mappedThreadID(sessionID), strings.TrimSpace(sessionID))
	if threadID == "" {
		return protocol.SessionForkResult{}, errors.New("codexapp current fork requires sessionId")
	}
	c.mu.Lock()
	lastTurnID := strings.TrimSpace(c.lastTurnID)
	c.mu.Unlock()
	if lastTurnID == "" {
		var resp appServerThreadStartResponse
		if err := c.runtime.request(ctx, "thread/read", appServerThreadReadParams{ThreadID: threadID, IncludeTurns: true}, &resp); err != nil {
			return protocol.SessionForkResult{}, err
		}
		for index := len(resp.Thread.Turns) - 1; index >= 0; index-- {
			turn := resp.Thread.Turns[index]
			if strings.TrimSpace(turn.ID) != "" && strings.EqualFold(strings.TrimSpace(turn.Status), "completed") {
				lastTurnID = strings.TrimSpace(turn.ID)
				break
			}
		}
	}
	if lastTurnID == "" {
		return protocol.SessionForkResult{}, errors.New("codexapp current fork requires a completed turn")
	}
	var resp appServerThreadStartResponse
	if err := c.runtime.request(ctx, "thread/fork", appServerThreadForkParams{ThreadID: threadID, LastTurnID: lastTurnID}, &resp); err != nil {
		return protocol.SessionForkResult{}, err
	}
	targetThreadID := strings.TrimSpace(resp.Thread.ID)
	if targetThreadID == "" {
		return protocol.SessionForkResult{}, errors.New("codexapp thread/fork returned empty thread id")
	}
	return protocol.SessionForkResult{
		SessionID: targetThreadID,
		Title:     strings.TrimSpace(resp.Thread.displayTitle()),
	}, nil
}

func (c *codexappConn) archiveForkTarget(ctx context.Context, threadID string) error {
	var ignored json.RawMessage
	return c.runtime.request(ctx, "thread/archive", appServerThreadArchiveParams{ThreadID: threadID}, &ignored)
}

func (c *codexappConn) matchForkPromptTurns(sessionID string, prompts []protocol.SessionForkPrompt, turns []appServerTurn) (map[int64]protocol.SessionForkPoint, bool, error) {
	nativeInputs := make([][]appServerUserInput, 0, len(turns))
	nativeTurnIDs := make([]string, 0, len(turns))
	for _, turn := range turns {
		if codexappTurnIsCancelled(turn) {
			continue
		}
		inputs, ok := codexappTurnUserInputs(turn)
		if !ok {
			continue
		}
		turnID := strings.TrimSpace(turn.ID)
		if turnID == "" {
			continue
		}
		nativeInputs = append(nativeInputs, inputs)
		nativeTurnIDs = append(nativeTurnIDs, turnID)
	}
	if len(nativeInputs) != len(prompts) {
		return map[int64]protocol.SessionForkPoint{}, false, nil
	}
	points := make(map[int64]protocol.SessionForkPoint, len(prompts))
	for index, prompt := range prompts {
		if prompt.DoneTurnIndex <= 0 {
			return map[int64]protocol.SessionForkPoint{}, false, nil
		}
		expected, err := c.promptToInputWithArtifacts(sessionID, prompt.ContentBlocks)
		if err != nil {
			return nil, false, err
		}
		expectedJSON, err := json.Marshal(expected)
		if err != nil {
			return nil, false, err
		}
		actualJSON, err := json.Marshal(nativeInputs[index])
		if err != nil {
			return nil, false, err
		}
		if !bytes.Equal(expectedJSON, actualJSON) {
			return map[int64]protocol.SessionForkPoint{}, false, nil
		}
		points[prompt.DoneTurnIndex] = protocol.SessionForkPoint{
			Provider: string(c.profile.Provider),
			Ref:      nativeTurnIDs[index],
		}
	}
	return points, true, nil
}

func codexappTurnIsCancelled(turn appServerTurn) bool {
	switch strings.ToLower(strings.TrimSpace(turn.Status)) {
	case "cancelled", "canceled", "interrupted":
		return true
	default:
		return false
	}
}

func codexappTurnUserInputs(turn appServerTurn) ([]appServerUserInput, bool) {
	var inputs []appServerUserInput
	found := false
	for _, item := range turn.Items {
		if item.Type != "userMessage" || len(item.Content) == 0 {
			continue
		}
		var itemInputs []appServerUserInput
		if err := json.Unmarshal(item.Content, &itemInputs); err != nil {
			return nil, false
		}
		inputs = append(inputs, itemInputs...)
		found = true
	}
	return inputs, found
}

func (c *codexappConn) sendSessionPrompt(ctx context.Context, p protocol.SessionPromptParams, result any) error {
	threadID := c.runtimeThreadIDForSession(p.SessionID)
	if threadID == "" {
		return errors.New("codexapp session/prompt requires sessionId")
	}
	input, err := c.promptToInputWithArtifacts(p.SessionID, p.Prompt)
	if err != nil {
		return err
	}
	done := make(chan codexappPromptResult, 1)
	c.mu.Lock()
	if c.promptDone != nil {
		c.mu.Unlock()
		return errors.New("codexapp session already has an active turn")
	}
	c.promptDone = done
	c.activeTurnID = ""
	c.pendingPromptStops = nil
	c.pendingPromptUpdates = nil
	c.pendingTurnDiffs = nil
	c.messagePhases = nil
	c.mu.Unlock()

	var resp appServerTurnStartResponse
	if err := c.runtime.request(ctx, "turn/start", c.config.turnStartParams(threadID, firstNonEmptyString(c.cwd), input), &resp); err != nil {
		c.clearPromptDone(done)
		return err
	}
	if resp.Turn.ID != "" {
		c.setActiveTurnID(resp.Turn.ID)
	}

	select {
	case promptResult := <-done:
		if promptResult.err != nil {
			return promptResult.err
		}
		return assignResult(result, protocol.PromptOutcome{
			StopReason: promptResult.stopReason,
			Artifacts:  promptResult.artifacts,
			ForkPoint: &protocol.SessionForkPoint{
				Provider: string(c.profile.Provider),
				Ref:      promptResult.turnID,
			},
		})
	case <-ctx.Done():
		c.clearPromptDone(done)
		return ctx.Err()
	}
}

func (c *codexappConn) sendSetConfigOption(result any, p protocol.SessionSetConfigOptionParams) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.config.set(p.ConfigID, p.Value); err != nil {
		return err
	}
	return assignResult(result, protocol.SetSessionConfigOptionResponse{
		ConfigOptions: protocol.WireSessionConfigOptions(c.config.options()),
	})
}

func (c *codexappConn) refreshModels(ctx context.Context) error {
	var resp appServerModelListResponse
	if err := c.runtime.request(ctx, "model/list", nil, &resp); err != nil {
		return err
	}
	c.mu.Lock()
	c.config.setModels(resp.Models)
	c.mu.Unlock()
	return nil
}

func (c *codexappConn) cancel(sessionID string) error {
	c.mu.Lock()
	acpSessionID := firstNonEmptyString(strings.TrimSpace(sessionID), c.acpSessionID)
	turnID := firstNonEmptyString(c.activeTurnID, c.lastTurnID)
	done := c.promptDone
	c.mu.Unlock()
	threadID := c.runtimeThreadIDForSession(acpSessionID)
	if threadID == "" {
		c.synthesizePromptCancelled(done)
		return nil
	}
	if turnID == "" {
		c.synthesizePromptCancelled(done)
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var ignored json.RawMessage
	_ = c.runtime.request(ctx, "turn/interrupt", appServerTurnInterruptParams{ThreadID: threadID, TurnID: turnID}, &ignored)
	c.waitForPromptCompletionOrCancel(done)
	return nil
}

type codexappMethodNotFoundError struct {
	method string
}

func (e codexappMethodNotFoundError) Error() string {
	return "method not found: " + e.method
}

func (c *codexappConn) handleAppServerNotification(method string, params json.RawMessage) {
	switch method {
	case "thread/goal/updated":
		var p appServerThreadGoalUpdatedParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" {
			goal := normalizeCodexappGoal(p.Goal, c.outboundSessionID(p.ThreadID))
			c.mu.Lock()
			c.goal = &goal
			c.mu.Unlock()
			c.emitWMGoalNotification(protocol.WMGoalNotification{
				SessionID: goal.SessionID, Event: protocol.WMGoalEventUpdated, Goal: &goal,
				Meta: json.RawMessage(`{"wm":{"goalLifecycleVersion":1}}`),
			})
			if p.TurnID != nil && goal.Status == protocol.SessionGoalStatusActive {
				c.setActiveTurnID(*p.TurnID)
			}
		}
	case "thread/goal/cleared":
		var p appServerThreadGoalClearedParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" {
			c.mu.Lock()
			c.goal = nil
			c.mu.Unlock()
			c.emitWMGoalNotification(protocol.WMGoalNotification{
				SessionID: c.outboundSessionID(p.ThreadID), Event: protocol.WMGoalEventCleared,
				Meta: json.RawMessage(`{"wm":{"goalLifecycleVersion":1}}`),
			})
		}
	case "item/agentMessage/delta":
		var p appServerAgentMessageDeltaParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" && p.Delta != "" {
			if c.messageCompleted(p.TurnID, p.ItemID) {
				return
			}
			c.emitTurnTextUpdateWithMeta(
				p.ThreadID,
				p.TurnID,
				protocol.SessionUpdateAgentMessageChunk,
				p.Delta,
				protocol.BuildSessionUpdateMetaMessagePhase(c.messagePhase(p.TurnID, p.ItemID)),
				p.ItemID,
			)
		}
	case "item/reasoning/textDelta", "item/reasoning/summaryTextDelta":
		var p appServerAgentMessageDeltaParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" && p.Delta != "" {
			c.emitTurnTextUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdateAgentThoughtChunk, p.Delta)
		}
	case "item/started", "item/completed":
		var p appServerItemEventParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" {
			completed := method == "item/completed"
			if !completed && p.Item.Type == "agentMessage" {
				c.rememberMessagePhase(p.TurnID, p.Item.ID, p.Item.Phase)
			}
			if !completed && c.handleSteerUserMessage(p) {
				return
			}
			if c.handleCompactionItem(p, completed) {
				return
			}
			if completed && p.Item.Type == "agentMessage" {
				phase := c.completeMessagePhase(p.TurnID, p.Item.ID, p.Item.Phase)
				c.emitTurnMessageCompletion(p.ThreadID, p.TurnID, p.Item.ID, phase)
				return
			}
			c.emitItemUpdate(p, completed)
		}
	case "item/commandExecution/outputDelta", "item/fileChange/outputDelta":
		var p appServerAgentMessageDeltaParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" && p.Delta != "" {
			kind := protocol.ToolKindExecute
			if method == "item/fileChange/outputDelta" {
				kind = protocol.ToolKindWrite
			}
			toolCallID := firstNonEmptyString(p.ItemID, p.TurnID)
			title := codexappToolFallbackTitle(kind)
			c.emitToolCallStart(p.ThreadID, p.TurnID, toolCallID, title, kind)
			c.emitTurnUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdate{
				SessionUpdate:   protocol.SessionUpdateToolCallUpdate,
				ToolCallID:      toolCallID,
				Title:           title,
				Kind:            kind,
				Status:          protocol.ToolCallStatusInProgress,
				ToolCallContent: []protocol.ToolCallContent{textToolCallContent(p.Delta)},
			})
		}
	case "item/fileChange/patchUpdated":
		var p appServerFileChangePatchUpdatedParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" && p.ItemID != "" {
			title := codexappFileChangesTitle("", p.Changes)
			c.emitToolCallStart(p.ThreadID, p.TurnID, p.ItemID, title, protocol.ToolKindWrite)
			c.emitTurnUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdate{
				SessionUpdate:   protocol.SessionUpdateToolCallUpdate,
				ToolCallID:      p.ItemID,
				Title:           title,
				Kind:            protocol.ToolKindWrite,
				Status:          protocol.ToolCallStatusInProgress,
				ToolCallContent: codexappFileChangeContents(p.Changes),
			})
		}
	case "turn/plan/updated":
		var p appServerTurnPlanUpdatedParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" {
			c.emitTurnUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdate{
				SessionUpdate: protocol.SessionUpdatePlan,
				Entries:       codexappPlanEntries(p.Plan),
			})
		}
	case "turn/diff/updated":
		var p appServerTurnDiffUpdatedParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" && p.TurnID != "" && p.Diff != "" {
			c.cacheTurnDiff(p.TurnID, p.Diff)
		}
	case "turn/started":
		var p appServerTurnEventParams
		if json.Unmarshal(params, &p) == nil {
			if c.markCompactTurn(p.turnID()) {
				return
			}
			c.setActiveTurnID(p.turnID())
		}
	case "turn/completed":
		var p appServerTurnCompletedParams
		if json.Unmarshal(params, &p) == nil {
			if c.completeCompactTurn(p.turnID(), p.status()) {
				return
			}
			c.completePrompt(p.turnID(), codexappStopReason(p.status()))
		}
	case "thread/compacted":
		var p appServerTurnEventParams
		if json.Unmarshal(params, &p) == nil {
			c.completeCompact(nil)
		}
	case "thread/name/updated":
		var p appServerThreadNameUpdatedParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" {
			c.emitSessionUpdate(protocol.SessionUpdateParams{
				SessionID: c.outboundSessionID(p.ThreadID),
				Update: protocol.SessionUpdate{
					SessionUpdate: protocol.SessionUpdateSessionInfoUpdate,
					Title:         p.displayName(),
				},
			})
		}
	case "thread/tokenUsage/updated":
		var p appServerThreadTokenUsageUpdatedParams
		if json.Unmarshal(params, &p) == nil && p.ThreadID != "" {
			// tokenUsage.total is cumulative session accounting. The context
			// window display uses the latest active context size.
			used := p.TokenUsage.Last.TotalTokens
			c.emitSessionUpdate(protocol.SessionUpdateParams{
				SessionID: c.outboundSessionID(p.ThreadID),
				Update: protocol.SessionUpdate{
					SessionUpdate: protocol.SessionUpdateUsageUpdate,
					Used:          &used,
					Size:          p.TokenUsage.ModelContextWindow,
					UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
				},
			})
		}
	}
}

func (c *codexappConn) handleSteerUserMessage(p appServerItemEventParams) bool {
	clientID := strings.TrimSpace(p.Item.ClientID)
	if p.Item.Type != "userMessage" || clientID == "" {
		return false
	}
	c.mu.Lock()
	tracker := c.pendingSteers[clientID]
	if tracker != nil && tracker.turnID == strings.TrimSpace(p.TurnID) {
		delete(c.pendingSteers, clientID)
	}
	c.mu.Unlock()
	if tracker == nil || tracker.turnID != strings.TrimSpace(p.TurnID) {
		return false
	}
	blocks := cloneCodexappContentBlocks(tracker.blocks)
	for i, block := range blocks {
		var meta json.RawMessage
		if i == len(blocks)-1 {
			meta = protocol.BuildSessionUpdateMetaLifecycle("", true, true)
		}
		c.emitTurnUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdate{
			SessionUpdate: protocol.SessionUpdateUserMessageChunk,
			Content:       mustRaw(block),
			MessageID:     clientID,
			Meta:          meta,
		})
	}
	return true
}

func (c *codexappConn) handleCompactionItem(p appServerItemEventParams, completed bool) bool {
	if p.Item.Type != "contextCompaction" {
		return false
	}
	c.mu.Lock()
	if c.compactDone == nil {
		c.mu.Unlock()
		return false
	}
	if strings.TrimSpace(p.TurnID) != "" {
		c.compactTurnID = strings.TrimSpace(p.TurnID)
	}
	if strings.TrimSpace(p.Item.ID) != "" {
		c.compactItemID = strings.TrimSpace(p.Item.ID)
	}
	c.mu.Unlock()
	if completed {
		status := strings.ToLower(strings.TrimSpace(p.Item.Status))
		if status == "failed" || status == "error" || status == "cancelled" || status == "canceled" || status == "declined" {
			c.completeCompact(fmt.Errorf("context compaction %s", status))
		} else {
			c.completeCompact(nil)
		}
	}
	return true
}

func (c *codexappConn) markCompactTurn(turnID string) bool {
	turnID = strings.TrimSpace(turnID)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.compactDone == nil {
		return false
	}
	if turnID != "" {
		c.compactTurnID = turnID
	}
	return true
}

func (c *codexappConn) completeCompactTurn(turnID string, status string) bool {
	turnID = strings.TrimSpace(turnID)
	c.mu.Lock()
	pending := c.compactDone != nil
	expectedTurnID := c.compactTurnID
	c.mu.Unlock()
	if !pending || (expectedTurnID != "" && turnID != "" && expectedTurnID != turnID) {
		return false
	}
	normalized := strings.ToLower(strings.TrimSpace(status))
	if normalized == "failed" || normalized == "error" || normalized == "cancelled" || normalized == "canceled" {
		c.completeCompact(fmt.Errorf("context compaction %s", normalized))
	} else {
		c.completeCompact(nil)
	}
	return true
}

func (c *codexappConn) waitForCompactTimeout(done chan SessionCompactResult, generation uint64) {
	timer := time.NewTimer(codexappCompactCompletionTimeout)
	defer timer.Stop()
	select {
	case <-timer.C:
		c.mu.Lock()
		matches := c.compactDone == done && c.compactGen == generation
		c.mu.Unlock()
		if matches {
			c.completeCompact(errors.New("context compaction timed out"))
		}
	case <-c.runtime.done:
		c.failActiveCompact(errors.New("codexapp runtime stopped"))
	}
}

func (c *codexappConn) completeCompact(err error) {
	c.mu.Lock()
	done := c.compactDone
	if done == nil {
		c.mu.Unlock()
		return
	}
	c.compactDone = nil
	c.compactTurnID = ""
	c.compactItemID = ""
	c.compactGen++
	c.mu.Unlock()
	done <- SessionCompactResult{Err: err}
	close(done)
}

func (c *codexappConn) failActiveCompact(err error) {
	if err == nil {
		err = errors.New("codexapp runtime stopped")
	}
	c.completeCompact(err)
}

func (c *codexappConn) clearCompactDone(done chan SessionCompactResult) {
	c.mu.Lock()
	if c.compactDone == done {
		c.compactDone = nil
		c.compactTurnID = ""
		c.compactItemID = ""
		c.compactGen++
	}
	c.mu.Unlock()
}

func (c *codexappConn) emitItemUpdate(p appServerItemEventParams, completed bool) {
	item := p.Item
	switch item.Type {
	case "reasoning":
		if completed {
			if text := codexappItemText(item.Summary, item.Content, item.Text); text != "" {
				c.emitTurnTextUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdateAgentThoughtChunk, text)
			}
		}
	case "plan":
		text := codexappItemText(nil, item.Content, item.Text)
		if text == "" {
			return
		}
		c.emitTurnUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdate{
			SessionUpdate: protocol.SessionUpdatePlan,
			Entries: []protocol.PlanEntry{{
				Content:  text,
				Priority: "medium",
				Status:   protocol.ToolCallStatusCompleted,
			}},
		})
	case "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "imageView":
		if !completed {
			c.emitToolCallStart(p.ThreadID, p.TurnID, item.ID, codexappItemTitle(item), codexappItemToolKind(item.Type))
		}
		update := codexappItemToolUpdate(item, completed)
		if update.ToolCallID != "" && (completed || update.Status != protocol.ToolCallStatusPending) {
			c.emitTurnUpdate(p.ThreadID, p.TurnID, update)
		}
	}
}

func (c *codexappConn) emitToolCallStart(threadID string, turnID string, toolCallID string, title string, kind string) {
	toolCallID = strings.TrimSpace(toolCallID)
	if toolCallID == "" || !c.markToolStarted(toolCallID) {
		return
	}
	c.emitTurnUpdate(threadID, turnID, protocol.SessionUpdate{
		SessionUpdate: protocol.SessionUpdateToolCall,
		ToolCallID:    toolCallID,
		Title:         codexappSafeToolTitle(title, kind),
		Kind:          kind,
		Status:        protocol.ToolCallStatusPending,
	})
}

func (c *codexappConn) markToolStarted(toolCallID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.startedTools == nil {
		c.startedTools = map[string]bool{}
	}
	if c.startedTools[toolCallID] {
		return false
	}
	c.startedTools[toolCallID] = true
	return true
}

func codexappItemToolUpdate(item appServerThreadItem, completed bool) protocol.SessionUpdate {
	kind := codexappItemToolKind(item.Type)
	status := codexappToolStatus(item.Status, completed)
	update := protocol.SessionUpdate{
		SessionUpdate: protocol.SessionUpdateToolCallUpdate,
		ToolCallID:    item.ID,
		Title:         codexappItemTitle(item),
		Kind:          kind,
		Status:        status,
	}
	if len(item.Arguments) > 0 && string(item.Arguments) != "null" {
		update.RawInput = append(update.RawInput[:0], item.Arguments...)
	}
	if len(item.Result) > 0 && string(item.Result) != "null" {
		update.RawOutput = append(update.RawOutput[:0], item.Result...)
	}
	if item.AggregatedOutput != "" {
		update.ToolCallContent = append(update.ToolCallContent, textToolCallContent(item.AggregatedOutput))
	}
	for _, change := range item.Changes {
		content := protocol.ToolCallContent{Type: "diff", Path: change.Path}
		if change.Diff != "" {
			content.NewText = change.Diff
		} else {
			content.OldText = change.OldText
			content.NewText = change.NewText
		}
		update.ToolCallContent = append(update.ToolCallContent, content)
	}
	if len(update.ToolCallContent) == 0 && len(item.Error) > 0 && string(item.Error) != "null" {
		update.ToolCallContent = append(update.ToolCallContent, textToolCallContent(codexappJSONText(item.Error)))
	}
	return update
}

func codexappItemToolKind(itemType string) string {
	switch itemType {
	case "commandExecution":
		return protocol.ToolKindExecute
	case "fileChange":
		return protocol.ToolKindWrite
	case "webSearch", "imageView":
		return protocol.ToolKindRead
	default:
		return protocol.ToolKindOther
	}
}

func codexappToolStatus(status string, completed bool) string {
	switch status {
	case "pending":
		return protocol.ToolCallStatusPending
	case "inProgress", "running":
		return protocol.ToolCallStatusInProgress
	case "completed", "success":
		return protocol.ToolCallStatusCompleted
	case "failed", "error":
		return protocol.ToolCallStatusFailed
	case "declined", "cancelled", "canceled":
		return protocol.ToolCallStatusFailed
	default:
		if completed {
			return protocol.ToolCallStatusCompleted
		}
		return protocol.ToolCallStatusInProgress
	}
}

func codexappItemTitle(item appServerThreadItem) string {
	switch item.Type {
	case "commandExecution":
		if title := codexappCommandTitle(item.Command); title != "" {
			return title
		}
		return codexappToolFallbackTitle(protocol.ToolKindExecute)
	case "fileChange":
		return codexappFileChangesTitle(item.Path, item.Changes)
	case "mcpToolCall":
		server := codexappDisplayText(item.Server)
		tool := codexappDisplayText(item.Tool)
		if server != "" && tool != "" {
			return server + "/" + tool
		}
		return firstNonEmptyString(tool, server, codexappNonOpaqueID(item.ID), codexappToolFallbackTitle(protocol.ToolKindOther))
	case "dynamicToolCall":
		if tool := codexappDisplayText(item.Tool); tool != "" {
			return tool
		}
		if command := codexappCommandFromArguments(item.Arguments); command != "" {
			return command
		}
		return codexappToolFallbackTitle(protocol.ToolKindOther)
	case "webSearch":
		return firstNonEmptyString(codexappDisplayText(item.Query), codexappToolFallbackTitle(protocol.ToolKindRead))
	case "imageView":
		return firstNonEmptyString(codexappDisplayText(item.Path), codexappToolFallbackTitle(protocol.ToolKindRead))
	default:
		return firstNonEmptyString(codexappNonOpaqueID(item.ID), codexappDisplayText(item.Type), codexappToolFallbackTitle(protocol.ToolKindOther))
	}
}

func codexappSafeToolTitle(title string, kind string) string {
	title = codexappDisplayText(title)
	if title == "" || codexappOpaqueCallID(title) {
		return codexappToolFallbackTitle(kind)
	}
	if kind == protocol.ToolKindExecute {
		if command := codexappPowerShellCommand(title); command != "" {
			return command
		}
	}
	return title
}

func codexappToolFallbackTitle(kind string) string {
	switch kind {
	case protocol.ToolKindExecute:
		return "Command"
	case protocol.ToolKindWrite:
		return "Edit files"
	case protocol.ToolKindRead:
		return "Read"
	default:
		return "Tool call"
	}
}

func codexappFileChangesTitle(path string, changes []appServerFileChange) string {
	path = codexappDisplayText(path)
	if path != "" {
		return "Edit " + path
	}
	paths := make(map[string]bool, len(changes))
	for _, change := range changes {
		changePath := codexappDisplayText(change.Path)
		if changePath != "" {
			paths[changePath] = true
		}
	}
	switch len(paths) {
	case 0:
		return "Edit files"
	case 1:
		for changePath := range paths {
			return "Edit " + changePath
		}
	}
	return fmt.Sprintf("Edit %d files", len(paths))
}

func codexappCommandTitle(command string) string {
	command = codexappDisplayText(command)
	if command == "" {
		return ""
	}
	if inner := codexappPowerShellCommand(command); inner != "" {
		return inner
	}
	return command
}

func codexappCommandFromArguments(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return codexappCommandFromAny(value)
}

func codexappCommandFromAny(value any) string {
	switch v := value.(type) {
	case string:
		return codexappCommandTitle(v)
	case map[string]any:
		for _, key := range []string{"command", "cmd"} {
			if command := codexappCommandFromAny(v[key]); command != "" {
				return command
			}
		}
	}
	return ""
}

func codexappDisplayText(value string) string {
	return strings.TrimSpace(codexappANSIEscapePattern.ReplaceAllString(value, ""))
}

func codexappNonOpaqueID(value string) string {
	value = codexappDisplayText(value)
	if codexappOpaqueCallID(value) {
		return ""
	}
	return value
}

func codexappOpaqueCallID(value string) bool {
	value = codexappDisplayText(value)
	return strings.HasPrefix(value, "call_")
}

func codexappPowerShellCommand(command string) string {
	fields := codexappCommandFields(command)
	if len(fields) < 3 || !codexappIsPowerShellExecutable(fields[0]) {
		return ""
	}
	for i := 1; i < len(fields)-1; i++ {
		if strings.EqualFold(fields[i], "-Command") || strings.EqualFold(fields[i], "-c") {
			return codexappDisplayText(strings.Join(fields[i+1:], " "))
		}
	}
	return ""
}

func codexappIsPowerShellExecutable(value string) bool {
	base := strings.ToLower(filepath.Base(value))
	switch base {
	case "pwsh", "pwsh.exe", "powershell", "powershell.exe":
		return true
	default:
		return false
	}
}

func codexappCommandFields(value string) []string {
	var fields []string
	var builder strings.Builder
	var quote rune
	flush := func() {
		if builder.Len() == 0 {
			return
		}
		fields = append(fields, builder.String())
		builder.Reset()
	}
	for _, r := range value {
		if quote != 0 {
			if r == quote {
				quote = 0
				continue
			}
			builder.WriteRune(r)
			continue
		}
		switch r {
		case '"', '\'':
			quote = r
		case ' ', '\t', '\r', '\n':
			flush()
		default:
			builder.WriteRune(r)
		}
	}
	flush()
	return fields
}

func codexappItemText(values ...any) string {
	for _, value := range values {
		switch v := value.(type) {
		case string:
			if v != "" {
				return v
			}
		case json.RawMessage:
			if text := codexappJSONText(v); text != "" {
				return text
			}
		}
	}
	return ""
}

func codexappJSONText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return codexappTextFromAny(value)
}

func codexappTextFromAny(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []any:
		var builder strings.Builder
		for _, item := range v {
			builder.WriteString(codexappTextFromAny(item))
		}
		return builder.String()
	case map[string]any:
		for _, key := range []string{"text", "content", "summary", "message"} {
			if text := codexappTextFromAny(v[key]); text != "" {
				return text
			}
		}
		return ""
	default:
		return ""
	}
}

func textToolCallContent(text string) protocol.ToolCallContent {
	return protocol.ToolCallContent{
		Type:    "content",
		Content: &protocol.ContentBlock{Type: protocol.ContentBlockTypeText, Text: text},
	}
}

func codexappFileChangeContents(changes []appServerFileChange) []protocol.ToolCallContent {
	out := make([]protocol.ToolCallContent, 0, len(changes))
	for _, change := range changes {
		content := protocol.ToolCallContent{Type: "diff", Path: change.Path}
		if change.Diff != "" {
			content.NewText = change.Diff
		} else {
			content.OldText = change.OldText
			content.NewText = change.NewText
		}
		out = append(out, content)
	}
	return out
}

func codexappPlanEntries(steps []appServerPlanStep) []protocol.PlanEntry {
	out := make([]protocol.PlanEntry, 0, len(steps))
	for _, step := range steps {
		if strings.TrimSpace(step.Step) == "" {
			continue
		}
		out = append(out, protocol.PlanEntry{
			Content:  step.Step,
			Priority: "medium",
			Status:   codexappPlanStatus(step.Status),
		})
	}
	return out
}

func codexappPlanStatus(status string) string {
	switch status {
	case "completed":
		return protocol.ToolCallStatusCompleted
	case "inProgress", "in_progress":
		return protocol.ToolCallStatusInProgress
	default:
		return protocol.ToolCallStatusPending
	}
}

func codexappNoRolloutError(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "no rollout found for thread id")
}

func codexappThreadNeedsFullRead(turns []appServerTurn) bool {
	if len(turns) == 0 {
		return true
	}
	for _, turn := range turns {
		if turn.ItemsView != "full" {
			return true
		}
	}
	return false
}

func (c *codexappConn) replayThreadTurns(acpSessionID string, turns []appServerTurn) {
	acpSessionID = strings.TrimSpace(acpSessionID)
	if acpSessionID == "" || len(turns) == 0 {
		return
	}
	for _, turn := range turns {
		seenUserMessage := false
		for _, item := range turn.Items {
			steered := item.Type == "userMessage" && seenUserMessage
			c.replayThreadItem(acpSessionID, item, steered)
			if item.Type == "userMessage" {
				seenUserMessage = true
			}
		}
	}
}

func (c *codexappConn) replayThreadItem(acpSessionID string, item appServerThreadItem, steered bool) {
	switch item.Type {
	case "userMessage":
		var inputs []appServerUserInput
		if len(item.Content) == 0 || json.Unmarshal(item.Content, &inputs) != nil {
			return
		}
		blocks := codexappReplayInputBlocks(inputs)
		if len(blocks) == 0 {
			return
		}
		messageID := strings.TrimSpace(item.ID)
		if steered && strings.TrimSpace(item.ClientID) != "" {
			messageID = strings.TrimSpace(item.ClientID)
		}
		if messageID == "" {
			messageID = strings.TrimSpace(item.ClientID)
		}
		for i, block := range blocks {
			var meta json.RawMessage
			if i == len(blocks)-1 {
				meta = protocol.BuildSessionUpdateMetaLifecycle("", true, steered)
			}
			c.emitSessionUpdate(protocol.SessionUpdateParams{
				SessionID: acpSessionID,
				Update: protocol.SessionUpdate{
					SessionUpdate: protocol.SessionUpdateUserMessageChunk,
					Content:       mustRaw(block),
					MessageID:     messageID,
					Meta:          meta,
				},
			})
		}
	case "agentMessage":
		if item.Text != "" {
			c.emitReplayText(
				acpSessionID,
				protocol.SessionUpdateAgentMessageChunk,
				item.Text,
				protocol.BuildSessionUpdateMetaMessagePhase(item.Phase),
				item.ID,
				true,
			)
		}
	case "reasoning":
		if text := codexappItemText(item.Summary, item.Content, item.Text); text != "" {
			c.emitReplayText(acpSessionID, protocol.SessionUpdateAgentThoughtChunk, text, nil, item.ID, true)
		}
	case "plan":
		if text := codexappItemText(nil, item.Content, item.Text); text != "" {
			c.emitSessionUpdate(protocol.SessionUpdateParams{
				SessionID: acpSessionID,
				Update: protocol.SessionUpdate{
					SessionUpdate: protocol.SessionUpdatePlan,
					Entries: []protocol.PlanEntry{{
						Content:  text,
						Priority: "medium",
						Status:   protocol.ToolCallStatusCompleted,
					}},
				},
			})
		}
	case "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "imageView":
		start := protocol.SessionUpdate{
			SessionUpdate: protocol.SessionUpdateToolCall,
			ToolCallID:    item.ID,
			Title:         codexappItemTitle(item),
			Kind:          codexappItemToolKind(item.Type),
			Status:        protocol.ToolCallStatusPending,
		}
		c.emitSessionUpdate(protocol.SessionUpdateParams{SessionID: acpSessionID, Update: start})
		update := codexappItemToolUpdate(item, true)
		if update.ToolCallID != "" {
			c.emitSessionUpdate(protocol.SessionUpdateParams{SessionID: acpSessionID, Update: update})
		}
	}
}

func (c *codexappConn) emitReplayText(
	acpSessionID string,
	updateType string,
	text string,
	meta json.RawMessage,
	messageID string,
	complete bool,
) {
	if complete {
		lifecycle := protocol.BuildSessionUpdateMetaLifecycle(protocol.SessionUpdateMetaMessagePhase(meta), true, false)
		if merged, err := protocol.MergeSessionUpdateMeta(meta, lifecycle); err == nil {
			meta = merged
		}
	}
	c.emitSessionUpdate(protocol.SessionUpdateParams{
		SessionID: acpSessionID,
		Update: protocol.SessionUpdate{
			SessionUpdate: updateType,
			Content:       mustRaw(protocol.ContentBlock{Type: protocol.ContentBlockTypeText, Text: text}),
			Meta:          protocol.CloneSessionUpdateMeta(meta),
			MessageID:     strings.TrimSpace(messageID),
		},
	})
}

func (c *codexappConn) handleAppServerRequest(ctx context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "item/commandExecution/requestApproval":
		return c.handleApprovalRequest(ctx, params, protocol.ToolKindExecute)
	case "item/fileChange/requestApproval":
		return c.handleApprovalRequest(ctx, params, protocol.ToolKindWrite)
	case "item/permissions/requestApproval":
		return c.handlePermissionsApprovalRequest(ctx, params)
	case "mcpServer/elicitation/request":
		return appServerMcpElicitationResponse{Action: "cancel", Content: nil, Meta: nil}, nil
	default:
		return nil, codexappMethodNotFoundError{method: method}
	}
}

func (c *codexappConn) handleApprovalRequest(ctx context.Context, params json.RawMessage, kind string) (any, error) {
	var p appServerApprovalRequestParams
	if err := json.Unmarshal(params, &p); err != nil {
		return appServerApprovalDecision{Decision: "cancel"}, nil
	}
	c.mu.Lock()
	h := c.reqHandler
	c.mu.Unlock()
	if h == nil {
		return appServerApprovalDecision{Decision: "cancel"}, nil
	}
	title := firstNonEmptyString(p.Command, p.Path, p.GrantRoot, "Approval requested")
	resp, err := h(ctx, time.Now().UnixNano(), protocol.MethodRequestPermission, mustRaw(protocol.PermissionRequestParams{
		SessionID: c.outboundSessionID(p.ThreadID),
		ToolCall: protocol.ToolCallRef{
			ToolCallID: p.ItemID,
			Title:      title,
			Kind:       kind,
			Status:     protocol.ToolCallStatusPending,
		},
		Options: []protocol.PermissionOption{
			{OptionID: "allow_once", Name: "Allow once", Kind: "allow_once"},
			{OptionID: "allow_always", Name: "Allow for session", Kind: "allow_always"},
			{OptionID: "reject", Name: "Reject", Kind: "reject_once"},
		},
	}))
	if err != nil {
		return appServerApprovalDecision{Decision: "cancel"}, nil
	}
	var permission protocol.PermissionResponse
	if err := remarshal(resp, &permission); err != nil {
		return appServerApprovalDecision{Decision: "cancel"}, nil
	}
	return appServerApprovalDecision{Decision: codexappApprovalDecision(permission.Outcome)}, nil
}

func (c *codexappConn) handlePermissionsApprovalRequest(ctx context.Context, params json.RawMessage) (any, error) {
	var p appServerApprovalRequestParams
	if err := json.Unmarshal(params, &p); err != nil {
		return appServerPermissionsApprovalResponse{Permissions: json.RawMessage(`{}`), Scope: "turn"}, nil
	}
	c.mu.Lock()
	h := c.reqHandler
	c.mu.Unlock()
	if h == nil {
		return appServerPermissionsApprovalResponse{Permissions: json.RawMessage(`{}`), Scope: "turn"}, nil
	}
	title := firstNonEmptyString(p.Reason, p.CWD, "Additional permissions requested")
	resp, err := h(ctx, time.Now().UnixNano(), protocol.MethodRequestPermission, mustRaw(protocol.PermissionRequestParams{
		SessionID: c.outboundSessionID(p.ThreadID),
		ToolCall: protocol.ToolCallRef{
			ToolCallID: p.ItemID,
			Title:      title,
			Kind:       protocol.ToolKindOther,
			Status:     protocol.ToolCallStatusPending,
		},
		Options: []protocol.PermissionOption{
			{OptionID: "allow_once", Name: "Allow once", Kind: "allow_once"},
			{OptionID: "allow_always", Name: "Allow for session", Kind: "allow_always"},
			{OptionID: "reject", Name: "Reject", Kind: "reject_once"},
		},
	}))
	if err != nil {
		return appServerPermissionsApprovalResponse{Permissions: json.RawMessage(`{}`), Scope: "turn"}, nil
	}
	var permission protocol.PermissionResponse
	if err := remarshal(resp, &permission); err != nil {
		return appServerPermissionsApprovalResponse{Permissions: json.RawMessage(`{}`), Scope: "turn"}, nil
	}
	value := firstNonEmptyString(permission.Outcome.OptionID, permission.Outcome.Outcome)
	switch value {
	case "allow_once":
		return appServerPermissionsApprovalResponse{Permissions: nonEmptyJSON(p.Permissions), Scope: "turn"}, nil
	case "allow_always":
		return appServerPermissionsApprovalResponse{Permissions: nonEmptyJSON(p.Permissions), Scope: "session"}, nil
	default:
		return appServerPermissionsApprovalResponse{Permissions: json.RawMessage(`{}`), Scope: "turn"}, nil
	}
}

func (c *codexappConn) emitTurnTextUpdate(sessionID string, turnID string, updateType string, text string) {
	c.emitTurnTextUpdateWithMeta(sessionID, turnID, updateType, text, nil, "")
}

func (c *codexappConn) emitTurnTextUpdateWithMeta(
	sessionID string,
	turnID string,
	updateType string,
	text string,
	meta json.RawMessage,
	messageID string,
) {
	update := protocol.SessionUpdateParams{
		SessionID: c.outboundSessionID(sessionID),
		Update: protocol.SessionUpdate{
			SessionUpdate: updateType,
			Content:       mustRaw(protocol.ContentBlock{Type: protocol.ContentBlockTypeText, Text: text}),
			Meta:          protocol.CloneSessionUpdateMeta(meta),
			MessageID:     strings.TrimSpace(messageID),
		},
	}
	if c.deferOrDropTurnUpdate(turnID, update) {
		return
	}
	c.emitSessionUpdate(update)
}

func (c *codexappConn) emitTurnMessageCompletion(sessionID string, turnID string, messageID string, phase string) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return
	}
	update := protocol.SessionUpdateParams{
		SessionID: c.outboundSessionID(sessionID),
		Update: protocol.SessionUpdate{
			SessionUpdate: protocol.SessionUpdateAgentMessageChunk,
			Content:       mustRaw(protocol.ContentBlock{Type: protocol.ContentBlockTypeText, Text: ""}),
			MessageID:     messageID,
			Meta:          protocol.BuildSessionUpdateMetaLifecycle(phase, true, false),
		},
	}
	if c.deferOrDropTurnUpdate(turnID, update) {
		return
	}
	c.emitSessionUpdate(update)
}

func codexappMessagePhaseKey(turnID string, itemID string) string {
	turnID = strings.TrimSpace(turnID)
	itemID = strings.TrimSpace(itemID)
	if turnID == "" || itemID == "" {
		return ""
	}
	return turnID + "\x00" + itemID
}

func (c *codexappConn) rememberMessagePhase(turnID string, itemID string, phase string) {
	key := codexappMessagePhaseKey(turnID, itemID)
	phase = protocol.NormalizeSessionMessagePhase(phase)
	if key == "" || phase == "" {
		return
	}
	c.mu.Lock()
	if c.messagePhases == nil {
		c.messagePhases = map[string]string{}
	}
	c.messagePhases[key] = phase
	delete(c.completedMessages, key)
	c.mu.Unlock()
}

func (c *codexappConn) messagePhase(turnID string, itemID string) string {
	key := codexappMessagePhaseKey(turnID, itemID)
	if key == "" {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.messagePhases[key]
}

func (c *codexappConn) completeMessagePhase(turnID string, itemID string, phase string) string {
	key := codexappMessagePhaseKey(turnID, itemID)
	if key == "" {
		return protocol.NormalizeSessionMessagePhase(phase)
	}
	c.mu.Lock()
	phase = protocol.NormalizeSessionMessagePhase(phase)
	if phase == "" {
		phase = c.messagePhases[key]
	}
	delete(c.messagePhases, key)
	if c.completedMessages == nil {
		c.completedMessages = map[string]bool{}
	}
	c.completedMessages[key] = true
	c.mu.Unlock()
	return phase
}

func (c *codexappConn) messageCompleted(turnID string, itemID string) bool {
	key := codexappMessagePhaseKey(turnID, itemID)
	if key == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.completedMessages[key]
}

func (c *codexappConn) emitTurnUpdate(sessionID string, turnID string, update protocol.SessionUpdate) {
	params := protocol.SessionUpdateParams{
		SessionID: c.outboundSessionID(sessionID),
		Update:    update,
	}
	if c.deferOrDropTurnUpdate(turnID, params) {
		return
	}
	c.emitSessionUpdate(params)
}

func (c *codexappConn) emitSessionUpdate(update protocol.SessionUpdateParams) {
	c.mu.Lock()
	h := c.respHandler
	wmInitialized := c.wmInitialized
	messageLifecycle := c.wmExtensions.MessageLifecycle
	c.mu.Unlock()
	if h == nil {
		return
	}
	if wmInitialized && !messageLifecycle {
		update.Update.Meta = protocol.WithoutSessionUpdateLifecycle(update.Update.Meta)
	}
	wire, err := codexappWireSessionUpdate(update)
	if err != nil {
		panic(fmt.Errorf("encode Codex ACP session update: %w", err))
	}
	h(context.Background(), protocol.MethodSessionUpdate, mustRaw(wire))
}

func (c *codexappConn) emitWMGoalNotification(notification protocol.WMGoalNotification) {
	c.mu.Lock()
	h := c.respHandler
	wmInitialized := c.wmInitialized
	goalLifecycle := c.wmExtensions.GoalLifecycle
	c.mu.Unlock()
	if h == nil || (wmInitialized && !goalLifecycle) {
		return
	}
	if _, err := protocol.DecodeWMGoalNotification(mustRaw(notification)); err != nil {
		panic(fmt.Errorf("encode Codex Goal notification: %w", err))
	}
	h(context.Background(), protocol.MethodWMSessionGoal, mustRaw(notification))
}

func codexappWireSessionUpdate(params protocol.SessionUpdateParams) (protocol.SessionUpdateParamsWire, error) {
	update := params.Update
	wire := protocol.SessionUpdateParamsWire{SessionID: params.SessionID, Meta: protocol.CloneSessionUpdateMeta(params.Meta)}
	switch update.SessionUpdate {
	case protocol.SessionUpdateAgentMessageChunk, protocol.SessionUpdateAgentThoughtChunk, protocol.SessionUpdateUserMessageChunk:
		var content protocol.ContentBlock
		if err := json.Unmarshal(update.Content, &content); err != nil {
			return protocol.SessionUpdateParamsWire{}, fmt.Errorf("%s content: %w", update.SessionUpdate, err)
		}
		wire.Update = protocol.MessageChunkUpdate{
			SessionUpdate: update.SessionUpdate,
			Content:       content,
			MessageID:     strings.TrimSpace(update.MessageID),
			Meta:          protocol.CloneSessionUpdateMeta(update.Meta),
		}
	case protocol.SessionUpdateToolCall, protocol.SessionUpdateToolCallUpdate:
		wire.Update = protocol.ToolCallUpdate{
			SessionUpdate: update.SessionUpdate,
			ToolCallID:    update.ToolCallID,
			Title:         update.Title,
			Kind:          update.Kind,
			Status:        update.Status,
			Content:       append([]protocol.ToolCallContent(nil), update.ToolCallContent...),
			Locations:     append([]protocol.ToolCallLocation(nil), update.Locations...),
			RawInput:      append(json.RawMessage(nil), update.RawInput...),
			RawOutput:     append(json.RawMessage(nil), update.RawOutput...),
			Meta:          protocol.CloneSessionUpdateMeta(update.Meta),
		}
	case protocol.SessionUpdatePlan:
		wire.Update = protocol.PlanUpdate{SessionUpdate: update.SessionUpdate, Entries: append([]protocol.PlanEntry(nil), update.Entries...), Meta: protocol.CloneSessionUpdateMeta(update.Meta)}
	case protocol.SessionUpdateAvailableCommandsUpdate:
		wire.Update = protocol.AvailableCommandsUpdate{SessionUpdate: update.SessionUpdate, AvailableCommands: append([]protocol.AvailableCommand(nil), update.AvailableCommands...), Meta: protocol.CloneSessionUpdateMeta(update.Meta)}
	case protocol.SessionUpdateCurrentModeUpdate:
		wire.Update = protocol.CurrentModeUpdate{SessionUpdate: update.SessionUpdate, CurrentModeID: update.ModeID, Meta: protocol.CloneSessionUpdateMeta(update.Meta)}
	case protocol.SessionUpdateConfigOptionUpdate:
		wire.Update = protocol.ConfigOptionUpdate{SessionUpdate: update.SessionUpdate, ConfigOptions: protocol.WireSessionConfigOptions(update.ConfigOptions), Meta: protocol.CloneSessionUpdateMeta(update.Meta)}
	case protocol.SessionUpdateSessionInfoUpdate:
		var title, updatedAt *string
		if strings.TrimSpace(update.Title) != "" {
			value := update.Title
			title = &value
		}
		if strings.TrimSpace(update.UpdatedAt) != "" {
			value := update.UpdatedAt
			updatedAt = &value
		}
		wire.Update = protocol.SessionInfoUpdate{SessionUpdate: update.SessionUpdate, Title: title, UpdatedAt: updatedAt, Meta: protocol.CloneSessionUpdateMeta(update.Meta)}
	case protocol.SessionUpdateUsageUpdate:
		var size, used int64
		if update.Size != nil {
			size = *update.Size
		}
		if update.Used != nil {
			used = *update.Used
		}
		if size < 0 || used < 0 {
			return protocol.SessionUpdateParamsWire{}, errors.New("usage values must be non-negative")
		}
		wire.Update = protocol.UsageUpdate{SessionUpdate: update.SessionUpdate, Size: uint64(size), Used: uint64(used), Meta: protocol.CloneSessionUpdateMeta(update.Meta)}
	default:
		return protocol.SessionUpdateParamsWire{}, fmt.Errorf("unsupported update %q", update.SessionUpdate)
	}
	return wire, nil
}

func (c *codexappConn) setActiveTurnID(turnID string) {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return
	}
	c.mu.Lock()
	goalActive := c.goal != nil && c.goal.Status == protocol.SessionGoalStatusActive
	if c.promptDone == nil && !goalActive {
		c.lastTurnID = turnID
		c.mu.Unlock()
		return
	}
	goalTurnStarted := goalActive && (!c.goalTurnActive || c.activeTurnID != turnID)
	c.activeTurnID = turnID
	c.lastTurnID = turnID
	if goalActive {
		c.goalTurnActive = true
	}
	updates := append([]protocol.SessionUpdateParams(nil), c.pendingPromptUpdates[turnID]...)
	if c.pendingPromptUpdates != nil {
		delete(c.pendingPromptUpdates, turnID)
	}
	stopReason := ""
	if c.pendingPromptStops != nil {
		stopReason = c.pendingPromptStops[turnID]
		delete(c.pendingPromptStops, turnID)
	}
	c.mu.Unlock()

	if goalTurnStarted {
		c.emitWMGoalNotification(protocol.WMGoalNotification{
			SessionID: c.outboundSessionID(""), Event: protocol.WMGoalEventTurnStarted, TurnID: turnID,
			Meta: json.RawMessage(`{"wm":{"goalLifecycleVersion":1}}`),
		})
	}
	for _, update := range updates {
		c.emitSessionUpdate(update)
	}
	if stopReason != "" {
		c.completePrompt(turnID, stopReason)
	}
}

func (c *codexappConn) deferOrDropTurnUpdate(turnID string, update protocol.SessionUpdateParams) bool {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.promptDone == nil {
		return c.lastTurnID != "" && c.lastTurnID != turnID
	}
	if c.activeTurnID == "" {
		if c.pendingPromptUpdates == nil {
			c.pendingPromptUpdates = map[string][]protocol.SessionUpdateParams{}
		}
		c.pendingPromptUpdates[turnID] = append(c.pendingPromptUpdates[turnID], update)
		return true
	}
	return c.activeTurnID != turnID
}

func (c *codexappConn) completePrompt(turnID string, stopReason string) {
	turnID = strings.TrimSpace(turnID)
	c.mu.Lock()
	done := c.promptDone
	goalTurn := c.goalTurnActive
	if (done == nil && !goalTurn) || turnID == "" {
		c.mu.Unlock()
		return
	}
	if c.activeTurnID == "" {
		if done != nil {
			if c.pendingPromptStops == nil {
				c.pendingPromptStops = map[string]string{}
			}
			c.pendingPromptStops[turnID] = stopReason
		}
		c.mu.Unlock()
		return
	}
	if c.activeTurnID != turnID {
		c.mu.Unlock()
		return
	}
	diff := ""
	if c.pendingTurnDiffs != nil {
		diff = c.pendingTurnDiffs[turnID]
	}
	if done != nil {
		c.promptDone = nil
		c.pendingPromptStops = nil
		c.pendingPromptUpdates = nil
		c.pendingTurnDiffs = nil
	}
	c.messagePhases = nil
	c.activeTurnID = ""
	c.goalTurnActive = false
	sessionID := c.acpSessionID
	c.mu.Unlock()
	if goalTurn {
		c.emitWMGoalNotification(protocol.WMGoalNotification{
			SessionID: sessionID, Event: protocol.WMGoalEventTurnCompleted, TurnID: turnID,
			Meta: json.RawMessage(`{"wm":{"goalLifecycleVersion":1}}`),
		})
	}
	if done == nil {
		return
	}
	artifacts := codexappPromptDiffArtifacts(diff)
	result := codexappPromptResult{stopReason: stopReason, turnID: turnID, artifacts: artifacts}
	if stopReason == protocol.SessionTurnStopReasonFailed {
		result.stopReason = ""
		result.err = errors.New("Codex turn failed")
	}
	select {
	case done <- result:
	default:
	}
}

func (c *codexappConn) cacheTurnDiff(turnID string, diff string) {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" || diff == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.promptDone == nil {
		return
	}
	if c.pendingTurnDiffs == nil {
		c.pendingTurnDiffs = map[string]string{}
	}
	c.pendingTurnDiffs[turnID] = diff
}

func codexappPromptDiffArtifacts(diff string) []protocol.SessionPromptArtifactPayload {
	if diff == "" {
		return nil
	}
	return []protocol.SessionPromptArtifactPayload{{
		Type:    "diff",
		Format:  "unified-diff",
		Content: diff,
	}}
}

func (c *codexappConn) waitForPromptCompletionOrCancel(done chan codexappPromptResult) {
	if done == nil {
		return
	}
	timer := time.NewTimer(codexappCancelCompletionTimeout)
	defer timer.Stop()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		c.mu.Lock()
		matches := c.promptDone == done
		c.mu.Unlock()
		if !matches {
			return
		}
		select {
		case <-ticker.C:
		case <-timer.C:
			c.synthesizePromptCancelled(done)
			return
		}
	}
}

func (c *codexappConn) synthesizePromptCancelled(done chan codexappPromptResult) {
	if done == nil {
		return
	}
	c.mu.Lock()
	if c.promptDone != done {
		c.mu.Unlock()
		return
	}
	c.promptDone = nil
	c.activeTurnID = ""
	c.pendingPromptStops = nil
	c.pendingPromptUpdates = nil
	c.pendingTurnDiffs = nil
	c.messagePhases = nil
	c.mu.Unlock()
	select {
	case done <- codexappPromptResult{stopReason: protocol.StopReasonCancelled}:
	default:
	}
}

func (c *codexappConn) failActivePrompt(err error) {
	if err == nil {
		err = errors.New("codexapp runtime stopped")
	}
	c.mu.Lock()
	done := c.promptDone
	c.promptDone = nil
	c.activeTurnID = ""
	c.pendingPromptStops = nil
	c.pendingPromptUpdates = nil
	c.pendingTurnDiffs = nil
	c.messagePhases = nil
	c.mu.Unlock()
	if done != nil {
		select {
		case done <- codexappPromptResult{err: err}:
		default:
		}
	}
}

func (c *codexappConn) clearPromptDone(done chan codexappPromptResult) {
	c.mu.Lock()
	if c.promptDone == done {
		c.promptDone = nil
		c.pendingPromptStops = nil
		c.pendingPromptUpdates = nil
		c.pendingTurnDiffs = nil
		c.messagePhases = nil
	}
	c.mu.Unlock()
}

func assignResult(result any, value any) error {
	if result == nil {
		return nil
	}
	if out, ok := result.(*protocol.PromptOutcome); ok {
		if typed, ok := value.(protocol.PromptOutcome); ok {
			*out = typed
			return nil
		}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if out, ok := result.(*json.RawMessage); ok {
		*out = append((*out)[:0], raw...)
		return nil
	}
	return protocol.DecodeACPJSON(raw, result)
}

func remarshal(in any, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	if err := protocol.DecodeACPJSON(raw, out); err != nil {
		return err
	}
	return nil
}

func remarshalWM(in any, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return protocol.DecodeWMJSON(raw, out)
}

func mustRaw(v any) json.RawMessage {
	raw, _ := json.Marshal(v)
	return raw
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func nonEmptyJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(`{}`)
	}
	return raw
}
