package registry

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/swm8023/wheelmaker/internal/portrelay"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/security"
	speechprovider "github.com/swm8023/wheelmaker/internal/speech"
	ttsprovider "github.com/swm8023/wheelmaker/internal/tts"
)

const (
	defaultProtocolVersion = rp.DefaultProtocolVersion
	defaultServerVersion   = "0.1.0"
	defaultRequestTimeout  = 10 * time.Second
	clientIdleTimeout      = 5 * time.Minute
	removedChatSendMethod  = rp.LegacyRegistryMethodChatSend
	maxDebugUploadLogBytes = 512 * 1024
	asyncQueueBuffer       = 64
	priorityWriteQueueSize = 64
	terminalWriteQueueSize = 128
	asyncWorkerCount       = 8
	maxPendingForwards     = 1024
)

var (
	errPeerClosed      = errors.New("registry peer is closed")
	errTerminalBacklog = errors.New("terminal output backlog is full")
	errPriorityBacklog = errors.New("registry priority write backlog is full")
	errPendingFull     = errors.New("registry pending forward limit reached")
)

const codeBusy = "busy"

// Config configures the project registry server.
type Config struct {
	Addr               string
	Token              string
	ProtocolVersion    string
	ServerVersion      string
	RelayPort          int
	RelayPortProvider  portrelay.RelayPortProvider
	LogDir             string
	StateDir           string
	ServerData         ServerDataStore
	IPLocationResolver IPLocationResolver
}

type peerConn struct {
	ws websocketWriter

	priorityWrites chan queuedWrite
	terminalWrites chan queuedWrite
	closed         chan struct{}
	writerDone     chan struct{}
	closeOnce      sync.Once

	metaMu sync.RWMutex
	id     string
	role   string
	hubID  string

	pendingMu sync.Mutex
	pending   map[int64]chan envelope
}

type queuedWrite struct {
	value any
	done  chan error
}

func newPeerConn(ws websocketWriter, id string) *peerConn {
	p := &peerConn{
		id:             id,
		ws:             ws,
		pending:        make(map[int64]chan envelope),
		priorityWrites: make(chan queuedWrite, priorityWriteQueueSize),
		terminalWrites: make(chan queuedWrite, terminalWriteQueueSize),
		closed:         make(chan struct{}),
		writerDone:     make(chan struct{}),
	}
	go p.runWriter()
	return p
}

func (p *peerConn) setMeta(role, hubID string) {
	p.metaMu.Lock()
	p.role = role
	p.hubID = hubID
	p.metaMu.Unlock()
}

func (p *peerConn) logEnvelope(direction string, env envelope) {
	log := registryLogger("")
	if !log.VerboseEnabled() {
		return
	}
	p.metaMu.RLock()
	id := p.id
	role := p.role
	hubID := p.hubID
	p.metaMu.RUnlock()
	if env.HubID != "" {
		hubID = env.HubID
	}
	log.Verbose("envelope dir=%s peer=%s role=%s type=%s requestId=%d method=%s hubId=%s projectId=%s", direction, id, role, env.Type, env.RequestID, env.Method, hubID, env.ProjectID)
}

func (p *peerConn) write(v any) error {
	item := queuedWrite{value: v, done: make(chan error, 1)}
	select {
	case p.priorityWrites <- item:
	case <-p.closed:
		return errPeerClosed
	default:
		p.shutdown()
		return errPriorityBacklog
	}
	select {
	case err := <-item.done:
		return err
	case <-p.closed:
		select {
		case err := <-item.done:
			return err
		default:
			return errPeerClosed
		}
	}
}

func (p *peerConn) writeTerminal(v any) error {
	select {
	case <-p.closed:
		return errPeerClosed
	default:
	}
	select {
	case p.terminalWrites <- queuedWrite{value: v}:
		return nil
	default:
		p.shutdown()
		return errTerminalBacklog
	}
}

func (p *peerConn) runWriter() {
	defer close(p.writerDone)
	for {
		select {
		case item := <-p.priorityWrites:
			p.writeItem(item)
			continue
		default:
		}
		select {
		case item := <-p.priorityWrites:
			p.writeItem(item)
		case item := <-p.terminalWrites:
			p.writeItem(item)
		case <-p.closed:
			return
		}
	}
}

func (p *peerConn) writeItem(item queuedWrite) {
	if env, ok := item.value.(envelope); ok {
		p.logEnvelope("out", env)
	}
	err := p.ws.WriteJSON(item.value)
	if item.done != nil {
		item.done <- err
	}
	if err != nil {
		p.shutdown()
	}
}

func (p *peerConn) shutdown() {
	p.closeOnce.Do(func() {
		close(p.closed)
		_ = p.ws.Close()
	})
}

func (p *peerConn) close() {
	p.shutdown()
	<-p.writerDone
}

func (p *peerConn) registerPending(id int64) (chan envelope, error) {
	ch := make(chan envelope, 1)
	p.pendingMu.Lock()
	defer p.pendingMu.Unlock()
	if len(p.pending) >= maxPendingForwards {
		return nil, errPendingFull
	}
	p.pending[id] = ch
	return ch, nil
}

func (p *peerConn) resolvePending(id int64, msg envelope) bool {
	p.pendingMu.Lock()
	ch, ok := p.pending[id]
	if ok {
		delete(p.pending, id)
	}
	p.pendingMu.Unlock()
	if ok {
		ch <- msg
		close(ch)
	}
	return ok
}

func (p *peerConn) dropAllPending() {
	p.pendingMu.Lock()
	for id, ch := range p.pending {
		delete(p.pending, id)
		close(ch)
	}
	p.pendingMu.Unlock()
}

type websocketWriter interface {
	WriteJSON(v any) error
	Close() error
}

// Server accepts client/hub connections and routes client requests to hub responders.
type Server struct {
	cfg Config

	mu                 sync.RWMutex
	hubs               map[string]rp.HubSnapshot
	projectToHub       map[string]string
	hubPeers           map[string]*peerConn
	hubDescriptors     map[string]rp.HubListItem
	clientPeers        map[string]*connectionState
	debugWebTransferMu sync.Mutex
	debugWebTransfers  map[string]debugWebTransferSession

	nextConnID    atomic.Int64
	nextForwardID atomic.Int64
	nextConnEpoch atomic.Int64

	relay                      *portrelay.Controller
	relayInitErr               error
	webSessions                *webSessionStore
	fileDownloads              *fileDownloadCapabilityStore
	loginLimiter               *loginLimiter
	ipLocation                 IPLocationResolver
	serverData                 ServerDataStore
	codexRadarEfficiencyLoader func(context.Context) (json.RawMessage, error)
	codexRadarEfficiencyCache  codexRadarEfficiencyCache

	speech *speechService
	tts    *ttsService

	shareStore *shareStore
}

type connectionState struct {
	id               string
	role             string
	hubID            string
	scopeHubID       string
	relayHost        string
	relaySecure      bool
	initialized      bool
	connectionEpoch  int64
	peer             *peerConn
	browserSession   bool
	browserDeviceID  string
	browserBasePath  string
	browserCSRFToken string
	clientName       string
	protocolVersion  string
	connectionMode   rp.RegistryConnectionMode
	seenRequestIDs   *requestIDWindow
	lastProjectSeq   map[string]int64
}

type requestDispatcher struct {
	server *Server
	state  *connectionState

	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	queues map[string]chan envelope
	async  chan envelope
}

func newRequestDispatcher(parent context.Context, server *Server, state *connectionState) *requestDispatcher {
	ctx, cancel := context.WithCancel(parent)
	dispatcher := &requestDispatcher{
		server: server,
		state:  state,
		ctx:    ctx,
		cancel: cancel,
		queues: make(map[string]chan envelope),
		async:  make(chan envelope, asyncQueueBuffer),
	}
	for index := 0; index < asyncWorkerCount; index++ {
		go dispatcher.runQueue(dispatcher.async)
	}
	return dispatcher
}

func (d *requestDispatcher) stop() {
	d.cancel()
}

func (d *requestDispatcher) dispatch(in envelope) bool {
	queueKey := registryRequestQueueKey(in.Method)
	if queueKey == "" {
		return tryEnqueueRequest(d.async, in)
	}

	queue := d.queue(queueKey)
	return tryEnqueueRequest(queue, in)
}

func tryEnqueueRequest(queue chan<- envelope, in envelope) bool {
	select {
	case queue <- in:
		return true
	default:
		return false
	}
}

func (d *requestDispatcher) queue(key string) chan envelope {
	d.mu.Lock()
	defer d.mu.Unlock()
	if queue := d.queues[key]; queue != nil {
		return queue
	}
	queue := make(chan envelope, asyncQueueBuffer)
	d.queues[key] = queue
	go d.runQueue(queue)
	return queue
}

func (d *requestDispatcher) runQueue(queue <-chan envelope) {
	for {
		select {
		case <-d.ctx.Done():
			return
		case in := <-queue:
			d.handle(in)
		}
	}
}

func (d *requestDispatcher) handle(in envelope) {
	select {
	case <-d.ctx.Done():
		return
	default:
		d.server.handleRequest(d.state, in)
	}
}

// New creates a registry server instance.
func New(cfg Config) *Server {
	if cfg.Addr == "" {
		cfg.Addr = ":9630"
	}
	if cfg.ProtocolVersion == "" {
		cfg.ProtocolVersion = defaultProtocolVersion
	}
	if cfg.ServerVersion == "" {
		cfg.ServerVersion = defaultServerVersion
	}
	if cfg.LogDir == "" {
		cfg.LogDir = defaultDebugUploadLogDir()
	}
	s := &Server{
		cfg:               cfg,
		hubs:              make(map[string]rp.HubSnapshot),
		projectToHub:      make(map[string]string),
		hubPeers:          make(map[string]*peerConn),
		hubDescriptors:    make(map[string]rp.HubListItem),
		clientPeers:       make(map[string]*connectionState),
		debugWebTransfers: make(map[string]debugWebTransferSession),
		webSessions: newWebSessionStore(
			rand.Reader,
			time.Now,
			cfg.Token,
			webSessionStatePath(cfg.StateDir),
		),
		fileDownloads: newFileDownloadCapabilityStore(fileDownloadCapabilityStoreOptions{}),
		loginLimiter:  newLoginLimiter(time.Now),
		ipLocation:    cfg.IPLocationResolver,
		serverData:    cfg.ServerData,
	}
	codexRadarFetcher := newCodexRadarEfficiencyFetcher()
	s.codexRadarEfficiencyLoader = codexRadarFetcher.load
	s.speech = newSpeechService(speechprovider.NewVolcengineProvider(), s.resolveVolcengineASRSecret)
	s.tts = newTTSService(ttsprovider.NewClient(), s.resolveMiMoTTSSecret)
	if strings.TrimSpace(cfg.StateDir) != "" {
		s.shareStore = newShareStore(shareStoreConfig{stateDir: cfg.StateDir})
	}
	relayPortProvider := cfg.RelayPortProvider
	if relayPortProvider == nil {
		configuredRelayPort := cfg.RelayPort
		relayPortProvider = func() (int, error) {
			if configuredRelayPort == 0 {
				return 0, portrelay.ErrRelayPortClientManaged
			}
			return configuredRelayPort, nil
		}
	}
	relay, relayErr := portrelay.NewController(portrelay.ControllerConfig{
		RegistryAddr:      cfg.Addr,
		ForwardHubRequest: s.forwardRelayHubRequest,
		RelayPortProvider: relayPortProvider,
	})
	s.relay = relay
	s.relayInitErr = relayErr
	return s
}

// Handler returns the HTTP handler for this server.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.handleHTTP)
}

// Run starts HTTP server and blocks until context cancellation.
func (s *Server) Run(ctx context.Context) error {
	if s.relayInitErr != nil {
		return fmt.Errorf("registry relay initialization: %w", s.relayInitErr)
	}
	if err := security.ValidateRegistryToken(s.cfg.Token); err != nil {
		return fmt.Errorf("registry authentication: %w", err)
	}
	if err := security.RequireLoopbackAddress(s.cfg.Addr); err != nil {
		return fmt.Errorf("registry listen address: %w", err)
	}
	if err := s.webSessions.Load(); err != nil {
		return fmt.Errorf("registry sessions: %w", err)
	}
	if s.shareStore != nil {
		if err := s.shareStore.start(ctx); err != nil {
			return fmt.Errorf("registry shares: %w", err)
		}
	}
	registryLogger("").Info("listening on %s", s.cfg.Addr)
	srv := newRegistryHTTPServer(s.cfg.Addr, s.Handler())
	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		return srv.Shutdown(context.Background())
	case err := <-errCh:
		return fmt.Errorf("registry server: %w", err)
	}
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	browserSession := false
	browserDeviceID := ""
	browserBasePath := ""
	browserCSRFToken := ""
	if origin != "" {
		if !security.RequestOriginMatchesHost(r) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		session, ok := s.authenticateWebRequest(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		browserSession = true
		browserDeviceID = session.DeviceID
		browserBasePath = session.BasePath
		browserCSRFToken = session.CSRFToken
	}
	upgrader := websocket.Upgrader{
		CheckOrigin:       func(_ *http.Request) bool { return true },
		EnableCompression: true,
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()
	ws.SetReadLimit(maxRegistryMessageBytes)

	connID := fmt.Sprintf("conn-%d", s.nextConnID.Add(1))
	state := &connectionState{
		id:               connID,
		peer:             newPeerConn(ws, connID),
		relayHost:        relayControlHost(r),
		relaySecure:      relayControlSecure(r),
		seenRequestIDs:   newRequestIDWindow(maxSeenRequestIDs),
		lastProjectSeq:   map[string]int64{},
		browserSession:   browserSession,
		browserDeviceID:  browserDeviceID,
		browserBasePath:  browserBasePath,
		browserCSRFToken: browserCSRFToken,
	}
	registryLogger("").Info("ws connected id=%s remote=%s", state.id, r.RemoteAddr)
	defer registryLogger("").Info("ws disconnected id=%s role=%s hub=%s remote=%s", state.id, state.role, state.hubID, r.RemoteAddr)
	defer s.unregisterHub(state.peer, state)
	defer s.unregisterClient(state)
	defer s.speech.cancelConnection(state.id)
	defer state.peer.dropAllPending()
	defer state.peer.close()

	dispatcher := newRequestDispatcher(context.Background(), s, state)
	defer dispatcher.stop()

	var idleTimer *time.Timer
	resetIdleTimer := func() {
		if !state.initialized || state.role != string(rp.RegistryRoleClient) {
			return
		}
		if idleTimer == nil {
			idleTimer = time.AfterFunc(clientIdleTimeout, func() {
				_ = state.peer.write(envelope{
					Type:   rp.RegistryEnvelopeTypeEvent,
					Method: rp.RegistryMethodConnectClose,
					Payload: rp.MustRaw(map[string]any{
						"reason": "idle_timeout",
					}),
				})
				_ = ws.Close()
			})
			return
		}
		idleTimer.Reset(clientIdleTimeout)
	}
	defer func() {
		if idleTimer != nil {
			idleTimer.Stop()
		}
	}()

	for {
		in, invalidRequestID, err := readEnvelope(ws)
		if err != nil {
			if errors.Is(err, errRegistryInputTooLarge) {
				_ = s.writeError(state.peer, in.RequestID, in.Method, codePayloadTooLarge, "payload too large", nil)
			}
			return
		}
		state.peer.logEnvelope("in", in)
		if invalidRequestID {
			_ = s.writeError(state.peer, 0, in.Method, codeInvalidArgument, "requestId must be integer", nil)
			continue
		}
		resetIdleTimer()
		if in.Type == rp.RegistryEnvelopeTypeResponse || in.Type == rp.RegistryEnvelopeTypeError {
			if state.peer.resolvePending(in.RequestID, in) {
				continue
			}
		}
		if in.Type == rp.RegistryEnvelopeTypeEvent {
			if !state.initialized {
				_ = s.writeError(state.peer, 0, in.Method, codeUnauthorized, "connect.init required", nil)
				continue
			}
			if in.RequestID != 0 {
				_ = s.writeError(state.peer, in.RequestID, in.Method, codeInvalidArgument, "event must not include requestId", nil)
				continue
			}
			if state.role == string(rp.RegistryRoleHub) && state.connectionMode == rp.RegistryConnectionModeUpdateOnly {
				continue
			}
			if state.role == string(rp.RegistryRoleClient) && s.isUpdateOnlyHub(in.HubID) {
				_ = s.writeError(state.peer, 0, in.Method, codeForbidden, "hub is update-only", map[string]any{"hubId": in.HubID})
				continue
			}
			if !methodAllowed(state.role, in.Method) {
				_ = s.writeError(state.peer, 0, in.Method, codeForbidden, "event method not allowed for role", map[string]any{"role": state.role})
				continue
			}
			s.handleTerminalEvent(state, in)
			continue
		}
		if in.Type != rp.RegistryEnvelopeTypeRequest {
			_ = s.writeError(state.peer, in.RequestID, in.Method, codeInvalidArgument, "type must be request", nil)
			continue
		}
		if in.RequestID < 1 {
			_ = s.writeError(state.peer, in.RequestID, in.Method, codeInvalidArgument, "requestId must be >= 1", nil)
			continue
		}
		if state.seenRequestIDs.Add(in.RequestID) {
			_ = s.writeError(state.peer, in.RequestID, in.Method, codeConflict, "duplicate requestId", nil)
			continue
		}

		if !state.initialized {
			if in.Method != rp.RegistryMethodConnectInit {
				_ = s.writeError(state.peer, in.RequestID, in.Method, codeUnauthorized, "connect.init required", nil)
				continue
			}
			if !s.handleConnectInit(state.peer, state, in) {
				return
			}
			resetIdleTimer()
			continue
		}
		if state.role == string(rp.RegistryRoleClient) && isRemovedClientRequestMethod(in.Method) {
			_ = s.writeError(state.peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported method", map[string]any{"method": in.Method})
			continue
		}
		if !methodAllowed(state.role, in.Method) {
			_ = s.writeError(state.peer, in.RequestID, in.Method, codeForbidden, "method not allowed for role", map[string]any{"role": state.role})
			continue
		}
		if s.handleUpdateOnlyHubRequest(state, in) {
			continue
		}
		if state.role == string(rp.RegistryRoleClient) && s.isUpdateOnlyHub(in.HubID) && !updateOnlyHubRequestAllowed(in) {
			_ = s.writeError(state.peer, in.RequestID, in.Method, codeForbidden, "hub is update-only", map[string]any{"hubId": in.HubID})
			continue
		}

		if shouldHandleRegistryRequestAsync(in.Method) {
			if !dispatcher.dispatch(in) {
				_ = s.writeError(state.peer, in.RequestID, in.Method, codeBusy, "request queue is full", nil)
			}
			continue
		}
		s.handleRequest(state, in)
	}
}

func (s *Server) handleUpdateOnlyHubRequest(state *connectionState, in envelope) bool {
	if state.role != string(rp.RegistryRoleHub) || state.connectionMode != rp.RegistryConnectionModeUpdateOnly {
		return false
	}
	_ = s.writeResponse(state.peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
	return true
}

func (s *Server) isUpdateOnlyHub(hubID string) bool {
	hubID = strings.TrimSpace(hubID)
	if hubID == "" {
		return false
	}
	s.mu.RLock()
	descriptor := s.hubDescriptors[hubID]
	s.mu.RUnlock()
	return descriptor.ConnectionMode == rp.RegistryConnectionModeUpdateOnly
}

func updateOnlyHubRequestAllowed(in envelope) bool {
	var payload map[string]json.RawMessage
	if err := decodePayload(in.Payload, &payload); err != nil || payload == nil {
		return false
	}
	switch in.Method {
	case rp.RegistryMethodHubStateRefresh:
		if len(payload) != 1 {
			return false
		}
		var sections []string
		if err := json.Unmarshal(payload["sections"], &sections); err != nil {
			return false
		}
		return len(sections) == 1 && (sections[0] == "wheelmakerUpdate" || sections[0] == "gatewayUpdate")
	case rp.RegistryMethodHubStateAction:
		if len(payload) < 2 || len(payload) > 3 {
			return false
		}
		for key := range payload {
			if key != "section" && key != "action" && key != "params" {
				return false
			}
		}
		var section string
		var action string
		if err := json.Unmarshal(payload["section"], &section); err != nil {
			return false
		}
		if err := json.Unmarshal(payload["action"], &action); err != nil {
			return false
		}
		if paramsRaw, ok := payload["params"]; ok {
			var params map[string]json.RawMessage
			if err := json.Unmarshal(paramsRaw, &params); err != nil || len(params) != 0 {
				return false
			}
		}
		return (section == "wheelmakerUpdate" || section == "gatewayUpdate") && action == "requestUpdate"
	default:
		return false
	}
}

func shouldHandleRegistryRequestAsync(method string) bool {
	return rp.RegistryRelayControlMethod(method) ||
		rp.RegistryMethodHasRoute(method, rp.RegistryRouteFileDownload) ||
		rp.RegistryServerDataMethod(method) ||
		rp.RegistryTTSMethod(method) ||
		rp.RegistryMethodHasRoute(method, rp.RegistryRouteHubReleaseNotify) ||
		rp.RegistryMethodHasRoute(method, rp.RegistryRouteHubDebugWebTransfer) ||
		rp.RegistryHubStateMethod(method) ||
		rp.RegistryMethodHasRoute(method, rp.RegistryRouteReleasePublish) ||
		rp.RegistryMethodHasRoute(method, rp.RegistryRouteShare) ||
		isTerminalHubRequestMethod(method) ||
		isClientForwardMethod(method)
}

func registryRequestQueueKey(method string) string {
	if rp.RegistryMethodHasRoute(method, rp.RegistryRouteHubDebugWebTransfer) {
		return "hub.debugWeb.transfer"
	}
	if rp.RegistryRelayControlMethod(method) {
		return "registry.relay"
	}
	if rp.RegistryServerDataMethod(method) {
		return "server.data"
	}
	if rp.RegistryMethodHasRoute(method, rp.RegistryRouteShare) {
		return "share"
	}
	return ""
}

func (s *Server) handleRequest(state *connectionState, in envelope) {
	switch {
	case in.Method == rp.RegistryMethodHubReportProjects:
		s.handleHubReportProjects(state.peer, state, in)
	case in.Method == rp.RegistryMethodHubReportProject:
		s.handleHubUpdateProject(state.peer, state, in)
	case registrySessionEventMethod(in.Method) != "":
		s.handleHubSessionEvent(state.peer, state, in, registrySessionEventMethod(in.Method))
	case in.Method == rp.RegistryMethodRegistryProjectList:
		s.handleProjectList(state.peer, state, in)
	case in.Method == rp.RegistryMethodDebugUploadLog:
		s.handleDebugUploadLog(state.peer, in)
	case rp.RegistrySecuritySessionMethod(in.Method):
		s.handleDeviceSessionRequest(state.peer, state, in)
	case rp.RegistryServerDataMethod(in.Method):
		s.handleServerDataRequest(state.peer, state, in)
	case rp.RegistryMethodHasRoute(in.Method, rp.RegistryRouteFileDownload):
		s.handleFileDownloadPrepare(state.peer, state, in)
	case in.Method == rp.RegistryMethodHubPing:
		_ = s.writeResponse(state.peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
	case rp.RegistryMethodHasRoute(in.Method, rp.RegistryRouteHubReleaseNotify):
		s.handleHubReleaseNotify(state.peer, state, in)
	case rp.RegistryMethodHasRoute(in.Method, rp.RegistryRouteHubDebugWebTransfer):
		s.handleHubDebugWebTransfer(state.peer, state, in)
	case rp.RegistryMethodHasRoute(in.Method, rp.RegistryRouteShare):
		s.handleShareRequest(state, in)
	case rp.RegistryRelayControlMethod(in.Method):
		s.handleRelayRequest(state.peer, state, in)
	case rp.RegistryHubStateMethod(in.Method) ||
		rp.RegistryMethodHasRoute(in.Method, rp.RegistryRouteReleasePublish) ||
		isTerminalHubRequestMethod(in.Method):
		s.handleHubStateForwardRequest(state.peer, state, in)
	case isSpeechRequestMethod(in.Method):
		s.speech.handleRequest(state.peer, state, in)
	case rp.RegistryTTSMethod(in.Method):
		s.tts.handleRequest(state.peer, in)
	case isClientForwardMethod(in.Method):
		s.handleForwardRequest(state.peer, state, in)
	default:
		_ = s.writeError(state.peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported method", map[string]any{"method": in.Method})
	}
}

func readEnvelope(ws *websocket.Conn) (envelope, bool, error) {
	messageType, message, err := ws.ReadMessage()
	if err != nil {
		return envelope{}, false, err
	}
	if messageType != websocket.TextMessage {
		return envelope{}, false, errors.New("registry websocket message must be text")
	}
	return decodeEnvelopeMessage(message)
}

func newRegistryHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func methodAllowed(role string, method string) bool {
	return rp.RegistryMethodAllowed(role, method)
}

func isRemovedClientRequestMethod(method string) bool {
	return method == removedChatSendMethod
}

func isClientForwardMethod(method string) bool {
	return rp.RegistryClientForwardMethod(method) || rp.RegistryMethodHasRoute(method, rp.RegistryRouteTerminalProjectRequest)
}

func isTerminalHubRequestMethod(method string) bool {
	return rp.RegistryMethodHasRoute(method, rp.RegistryRouteTerminalHubRequest)
}

func (s *Server) handleTerminalEvent(state *connectionState, in envelope) {
	switch in.Method {
	case rp.RegistryMethodTerminalInput:
		s.forwardTerminalInput(state, in)
	case rp.RegistryMethodTerminalOutput, rp.RegistryMethodTerminalChanged,
		rp.RegistryMethodHubStateUpdated, rp.RegistryMethodReleasePublishUpdated:
		s.broadcastHubEvent(state, in)
	default:
		_ = s.writeError(state.peer, 0, in.Method, codeInvalidArgument, "unsupported event method", map[string]any{"method": in.Method})
	}
}

func (s *Server) forwardTerminalInput(state *connectionState, in envelope) {
	hubID := strings.TrimSpace(in.HubID)
	if hubID == "" {
		_ = s.writeError(state.peer, 0, in.Method, codeInvalidArgument, "hubId is required", nil)
		return
	}
	if state.scopeHubID != "" && state.scopeHubID != hubID {
		_ = s.writeError(state.peer, 0, in.Method, codeForbidden, "hub out of client scope", map[string]any{"hubId": hubID})
		return
	}
	s.mu.RLock()
	hubPeer := s.hubPeers[hubID]
	s.mu.RUnlock()
	if hubPeer == nil {
		_ = s.writeError(state.peer, 0, in.Method, codeUnavailable, "hub offline", map[string]any{"hubId": hubID})
		return
	}
	if err := hubPeer.write(envelope{
		Type:    rp.RegistryEnvelopeTypeEvent,
		Method:  in.Method,
		HubID:   hubID,
		Payload: in.Payload,
	}); err != nil {
		_ = s.writeError(state.peer, 0, in.Method, codeInternal, "forward event write failed", nil)
	}
}

func (s *Server) broadcastHubEvent(state *connectionState, in envelope) {
	hubID := strings.TrimSpace(in.HubID)
	if hubID == "" {
		_ = s.writeError(state.peer, 0, in.Method, codeInvalidArgument, "hubId is required", nil)
		return
	}
	if state.hubID == "" || state.hubID != hubID {
		_ = s.writeError(state.peer, 0, in.Method, codeForbidden, "hubId mismatch", nil)
		return
	}
	s.mu.RLock()
	peers := make([]*peerConn, 0, len(s.clientPeers))
	for _, client := range s.clientPeers {
		if client == nil || client.peer == nil {
			continue
		}
		if client.scopeHubID != "" && client.scopeHubID != hubID {
			continue
		}
		peers = append(peers, client.peer)
	}
	s.mu.RUnlock()
	msg := envelope{
		Type:    rp.RegistryEnvelopeTypeEvent,
		Method:  in.Method,
		HubID:   hubID,
		Payload: in.Payload,
	}
	for _, peer := range peers {
		if in.Method == rp.RegistryMethodTerminalOutput {
			_ = peer.writeTerminal(msg)
		} else {
			_ = peer.write(msg)
		}
	}
}

func registrySessionEventMethod(method string) string {
	clientEventMethod, ok := rp.RegistryHubSessionEventMethod(method)
	if !ok {
		return ""
	}
	return clientEventMethod
}

func (s *Server) handleRelayRequest(peer *peerConn, state *connectionState, in envelope) {
	if s.relay == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "relay controller unavailable", nil)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), defaultRequestTimeout)
	defer cancel()
	resp, errPayload := s.relay.Handle(ctx, in.Method, in.Payload, state.relayHost, state.relaySecure)
	if errPayload != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, errPayload.Code, errPayload.Message, errPayload.Details)
		return
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", resp)
}

func (s *Server) forwardRelayHubRequest(ctx context.Context, hubID string, method string, payload any) portrelay.ControlResult {
	hubID = strings.TrimSpace(hubID)
	if hubID == "" {
		return portrelay.ControlResult{Code: codeInvalidArgument, Message: "hubId is required"}
	}
	if s.isUpdateOnlyHub(hubID) {
		return portrelay.ControlResult{Code: codeForbidden, Message: "hub is update-only", Details: map[string]any{"hubId": hubID}}
	}
	s.mu.RLock()
	hub := s.hubs[hubID]
	hubPeer := s.hubPeers[hubID]
	s.mu.RUnlock()
	if hub.HubID == "" {
		return portrelay.ControlResult{Code: codeNotFound, Message: "hub not found", Details: map[string]any{"hubId": hubID}}
	}
	if hubPeer == nil {
		return portrelay.ControlResult{Code: codeUnavailable, Message: "hub offline", Details: map[string]any{"hubId": hubID}}
	}

	forwardID := s.nextForwardID.Add(1)
	waitCh, err := hubPeer.registerPending(forwardID)
	if err != nil {
		return portrelay.ControlResult{Code: codeBusy, Message: "hub request backlog is full"}
	}
	if err := hubPeer.write(envelope{
		RequestID: forwardID,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    method,
		Payload:   rp.MustRaw(payload),
	}); err != nil {
		hubPeer.resolvePending(forwardID, envelope{})
		return portrelay.ControlResult{Code: codeInternal, Message: "forward request write failed"}
	}

	select {
	case resp, ok := <-waitCh:
		if !ok {
			return portrelay.ControlResult{Code: codeInternal, Message: "hub disconnected"}
		}
		if resp.Type == rp.RegistryEnvelopeTypeError {
			var errPayload errorPayload
			if err := decodePayload(resp.Payload, &errPayload); err == nil {
				return portrelay.ControlResult{
					Code:    errPayload.Code,
					Message: errPayload.Message,
					Details: errPayload.Details,
				}
			}
			return portrelay.ControlResult{Code: codeInternal, Message: "hub relay request failed"}
		}
		return portrelay.ControlResult{Payload: resp.Payload}
	case <-ctx.Done():
		hubPeer.resolvePending(forwardID, envelope{})
		return portrelay.ControlResult{Code: codeTimeout, Message: "hub response timeout"}
	}
}
func (s *Server) handleConnectInit(peer *peerConn, state *connectionState, in envelope) bool {
	var payload connectInitPayload
	if err := decodePayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid connect.init payload", nil)
		return true
	}
	role := strings.TrimSpace(payload.Role)
	clientName := strings.TrimSpace(payload.ClientName)
	if clientName == "" || len(clientName) > 80 {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "clientName must be between 1 and 80 bytes", nil)
		return true
	}
	if state.browserSession && (role != string(rp.RegistryRoleClient) || strings.TrimSpace(payload.Token) != "") {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "browser session requires client role without token", nil)
		return false
	}
	if role == "monitor" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "monitor role has been retired", nil)
		return true
	}
	if role != string(rp.RegistryRoleHub) && role != string(rp.RegistryRoleClient) {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "role must be hub or client", nil)
		return true
	}
	if role == string(rp.RegistryRoleHub) && strings.TrimSpace(payload.HubID) == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "hubId is required for hub role", nil)
		return true
	}
	if !state.browserSession && s.cfg.Token != "" && subtle.ConstantTimeCompare([]byte(strings.TrimSpace(payload.Token)), []byte(s.cfg.Token)) != 1 {
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnauthorized, "invalid token", nil)
		return false
	}
	protocolVersion := strings.TrimSpace(payload.ProtocolVersion)
	comparison, comparable := compareProtocolVersions(protocolVersion, s.cfg.ProtocolVersion)
	updateOnlyHub := role == string(rp.RegistryRoleHub) &&
		s.cfg.ProtocolVersion == rp.DefaultProtocolVersion &&
		protocolVersion == rp.PreviousUpdateOnlyProtocolVersion
	if !comparable || (protocolVersion != s.cfg.ProtocolVersion && !updateOnlyHub) {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported protocolVersion", map[string]any{"protocolVersion": payload.ProtocolVersion, "supported": s.cfg.ProtocolVersion})
		return true
	}

	connectionMode := rp.RegistryConnectionModeNormal
	if updateOnlyHub && comparison < 0 {
		connectionMode = rp.RegistryConnectionModeUpdateOnly
	}
	state.initialized = true
	state.clientName = clientName
	state.role = role
	state.hubID = strings.TrimSpace(payload.HubID)
	state.scopeHubID = strings.TrimSpace(payload.HubID)
	state.protocolVersion = protocolVersion
	state.connectionMode = connectionMode
	state.connectionEpoch = s.nextConnEpoch.Add(1)
	peer.setMeta(state.role, state.hubID)
	if state.role == string(rp.RegistryRoleClient) {
		s.mu.Lock()
		s.clientPeers[state.id] = state
		s.mu.Unlock()
	} else {
		s.mu.Lock()
		s.hubPeers[state.hubID] = peer
		s.hubDescriptors[state.hubID] = rp.HubListItem{
			HubID:          state.hubID,
			ConnectionMode: state.connectionMode,
		}
		s.mu.Unlock()
	}

	resp := connectInitResponsePayload{
		OK: true,
		Principal: rp.ConnectPrincipal{
			Role:            role,
			HubID:           strings.TrimSpace(payload.HubID),
			ConnectionEpoch: state.connectionEpoch,
		},
		ServerInfo: rp.ConnectServerInfo{
			ServerVersion:   s.cfg.ServerVersion,
			ProtocolVersion: s.cfg.ProtocolVersion,
		},
		Features: rp.ConnectFeatures{
			HubReportProjects:       true,
			PushHint:                false,
			PingPong:                true,
			SupportsHashNegotiation: true,
		},
		HashAlgorithms: []string{"sha256"},
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", resp)
	return true
}

func compareProtocolVersions(left, right string) (int, bool) {
	parse := func(value string) ([]int, bool) {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, false
		}
		parts := strings.Split(value, ".")
		components := make([]int, len(parts))
		for index, part := range parts {
			if part == "" {
				return nil, false
			}
			component, err := strconv.Atoi(part)
			if err != nil || component < 0 {
				return nil, false
			}
			components[index] = component
		}
		return components, true
	}
	leftComponents, leftOK := parse(left)
	rightComponents, rightOK := parse(right)
	if !leftOK || !rightOK {
		return 0, false
	}
	length := len(leftComponents)
	if len(rightComponents) > length {
		length = len(rightComponents)
	}
	for index := 0; index < length; index++ {
		leftComponent := 0
		if index < len(leftComponents) {
			leftComponent = leftComponents[index]
		}
		rightComponent := 0
		if index < len(rightComponents) {
			rightComponent = rightComponents[index]
		}
		if leftComponent < rightComponent {
			return -1, true
		}
		if leftComponent > rightComponent {
			return 1, true
		}
	}
	return 0, true
}

func (s *Server) handleHubReportProjects(peer *peerConn, state *connectionState, in envelope) {
	var payload hubReportProjectsPayload
	if err := decodePayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid hub.report.projects payload", nil)
		return
	}
	envelopeHubID := strings.TrimSpace(in.HubID)
	if envelopeHubID == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "hubId is required", nil)
		return
	}
	if envelopeHubID != state.hubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "hubId mismatch", nil)
		return
	}
	if strings.TrimSpace(payload.HubID) != "" && strings.TrimSpace(payload.HubID) != envelopeHubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "payload hubId must match envelope hubId", nil)
		return
	}
	payload.HubID = envelopeHubID
	if payload.ConnectionEpoch != state.connectionEpoch {
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "connectionEpoch mismatch", nil)
		return
	}

	s.mu.RLock()
	currentPeer := s.hubPeers[payload.HubID]
	currentHubSnapshot, hasCurrentHubSnapshot := s.hubs[payload.HubID]
	s.mu.RUnlock()
	if currentPeer != peer {
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "stale hub connection", map[string]any{"hubId": payload.HubID})
		return
	}
	if hasCurrentHubSnapshot && payload.ConnectionEpoch < currentHubSnapshot.ConnectionEpoch {
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "stale connectionEpoch", map[string]any{
			"hubId":           payload.HubID,
			"connectionEpoch": payload.ConnectionEpoch,
			"currentEpoch":    currentHubSnapshot.ConnectionEpoch,
		})
		return
	}

	sort.Slice(payload.Projects, func(i, j int) bool {
		return payload.Projects[i].Name < payload.Projects[j].Name
	})
	state.lastProjectSeq = map[string]int64{}

	s.mu.Lock()
	previous := s.hubs[payload.HubID]
	s.hubPeers[payload.HubID] = peer
	for projectID, hubID := range s.projectToHub {
		if hubID == payload.HubID {
			delete(s.projectToHub, projectID)
		}
	}
	for _, p := range payload.Projects {
		projectID := rp.ProjectID(payload.HubID, p.Name)
		if strings.TrimSpace(projectID) != "" {
			s.projectToHub[projectID] = payload.HubID
		}
	}
	s.hubs[payload.HubID] = rp.HubSnapshot{
		HubID:           payload.HubID,
		ConnectionEpoch: payload.ConnectionEpoch,
		Projects:        payload.Projects,
		UpdatedAt:       time.Now().UTC().Format(time.RFC3339),
	}
	s.mu.Unlock()
	s.emitProjectSnapshotEvents(payload.HubID, previous.Projects, payload.Projects)

	_ = s.writeResponse(peer, in.RequestID, in.Method, "", map[string]any{
		"ok":           true,
		"hubId":        payload.HubID,
		"projectCount": len(payload.Projects),
	})
}

func (s *Server) handleHubUpdateProject(peer *peerConn, state *connectionState, in envelope) {
	var payload hubUpdateProjectPayload
	if err := decodePayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid hub.report.project payload", nil)
		return
	}
	envelopeHubID := strings.TrimSpace(in.HubID)
	if envelopeHubID == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "hubId is required", nil)
		return
	}
	if envelopeHubID != state.hubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "hubId mismatch", nil)
		return
	}
	if strings.TrimSpace(payload.HubID) != "" && strings.TrimSpace(payload.HubID) != envelopeHubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "payload hubId must match envelope hubId", nil)
		return
	}
	payload.HubID = envelopeHubID
	if payload.ConnectionEpoch != state.connectionEpoch {
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "connectionEpoch mismatch", nil)
		return
	}
	s.mu.RLock()
	currentPeer := s.hubPeers[payload.HubID]
	s.mu.RUnlock()
	if currentPeer != peer {
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "stale hub connection", map[string]any{"hubId": payload.HubID})
		return
	}
	if payload.Seq < 1 {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "seq must be >= 1", nil)
		return
	}
	projectName := strings.TrimSpace(payload.Project.Name)
	if projectName == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "project.name is required", nil)
		return
	}
	if strings.TrimSpace(payload.UpdatedAt) == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "updatedAt is required", nil)
		return
	}
	if _, err := time.Parse(time.RFC3339, payload.UpdatedAt); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "updatedAt must be RFC3339", nil)
		return
	}
	lastSeq := state.lastProjectSeq[projectName]
	if payload.Seq <= lastSeq {
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "stale project update seq", map[string]any{
			"projectName": projectName,
			"lastSeq":     lastSeq,
			"seq":         payload.Seq,
		})
		return
	}

	s.mu.Lock()
	hub := s.hubs[payload.HubID]
	if hub.HubID == "" {
		s.mu.Unlock()
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "hub snapshot not initialized", nil)
		return
	}
	if hub.ConnectionEpoch != state.connectionEpoch {
		s.mu.Unlock()
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "connectionEpoch mismatch", nil)
		return
	}

	var previous *rp.ProjectInfo
	replaced := false
	for index := range hub.Projects {
		if strings.TrimSpace(hub.Projects[index].Name) != projectName {
			continue
		}
		prev := hub.Projects[index]
		previous = &prev
		hub.Projects[index] = payload.Project
		replaced = true
		break
	}
	if !replaced {
		hub.Projects = append(hub.Projects, payload.Project)
	}
	sort.Slice(hub.Projects, func(i, j int) bool {
		return hub.Projects[i].Name < hub.Projects[j].Name
	})
	hub.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	s.hubs[payload.HubID] = hub
	state.lastProjectSeq[projectName] = payload.Seq
	projectID := rp.ProjectID(payload.HubID, payload.Project.Name)
	if strings.TrimSpace(projectID) != "" {
		s.projectToHub[projectID] = payload.HubID
	}
	s.mu.Unlock()

	s.emitProjectUpdateEvents(payload.HubID, previous, payload.Project)
	_ = s.writeResponse(peer, in.RequestID, in.Method, projectID, map[string]any{
		"ok":        true,
		"projectId": projectID,
	})
}

func (s *Server) handleHubSessionEvent(peer *peerConn, state *connectionState, in envelope, eventMethod string) {
	projectID := strings.TrimSpace(in.ProjectID)
	if projectID == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "projectId is required", nil)
		return
	}
	if state.hubID != "" && !strings.HasPrefix(projectID, state.hubID+":") {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "project out of hub scope", map[string]any{"projectId": projectID})
		return
	}

	s.mu.RLock()
	hubID := s.projectToHub[projectID]
	s.mu.RUnlock()
	if hubID == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeNotFound, "project not found", map[string]any{"projectId": projectID})
		return
	}
	if state.hubID != "" && hubID != state.hubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "project not owned by connected hub", map[string]any{"projectId": projectID})
		return
	}

	s.broadcastProjectEvent(hubID, projectID, eventMethod, json.RawMessage(in.Payload))
	_ = s.writeResponse(peer, in.RequestID, in.Method, projectID, map[string]any{"ok": true})
}

func (s *Server) handleProjectList(peer *peerConn, state *connectionState, in envelope) {
	items := s.snapshotProjects(state.scopeHubID)
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", map[string]any{
		"projects": items,
		"hubs":     s.snapshotProjectListHubs(state.scopeHubID),
	})
}

func (s *Server) handleDebugUploadLog(peer *peerConn, in envelope) {
	resp := s.debugUploadLogEnvelope(in)
	resp.RequestID = in.RequestID
	_ = peer.write(resp)
}

func (s *Server) debugUploadLogEnvelope(in envelope) envelope {
	var payload debugUploadLogPayload
	if err := decodePayload(in.Payload, &payload); err != nil {
		return s.errorEnvelope(in.Method, codeInvalidArgument, "invalid debug.uploadLog payload", nil)
	}
	if payload.Text == "" {
		return s.errorEnvelope(in.Method, codeInvalidArgument, "text is required", nil)
	}
	if len([]byte(payload.Text)) > maxDebugUploadLogBytes {
		return s.errorEnvelope(in.Method, codeInvalidArgument, "text is too large", map[string]any{
			"maxBytes": maxDebugUploadLogBytes,
		})
	}
	now := time.Now().UTC()
	fileName := fmt.Sprintf(
		"%s-diagnostics-%s-%d-%d.log",
		sanitizeDebugLogSource(payload.Source),
		now.Format("20060102-150405.000"),
		now.UnixNano(),
		in.RequestID,
	)
	if err := writeDebugUpload(s.cfg.LogDir, fileName, []byte(payload.Text)); err != nil {
		return s.errorEnvelope(in.Method, codeInternal, "write debug log failed", nil)
	}

	return envelope{
		Type:   rp.RegistryEnvelopeTypeResponse,
		Method: in.Method,
		Payload: rp.MustRaw(debugUploadLogResponsePayload{
			OK:       true,
			FileName: fileName,
		}),
	}
}

func (s *Server) handleHubStateForwardRequest(clientPeer *peerConn, state *connectionState, in envelope) {
	resp := s.executeHubStateRequest(state, in)
	resp.RequestID = in.RequestID
	_ = clientPeer.write(resp)
}

func hubStateRequestTimeout(method string) time.Duration {
	switch method {
	case rp.RegistryMethodHubStateRefresh, rp.RegistryMethodHubStateAction:
		return 60 * time.Second
	default:
		return defaultRequestTimeout
	}
}

func projectForwardRequestTimeout(method string) time.Duration {
	switch method {
	case rp.RegistryMethodSessionCreate:
		return 120 * time.Second
	case rp.RegistryMethodSessionRead:
		return 30 * time.Second
	default:
		return defaultRequestTimeout
	}
}

func (s *Server) executeHubStateRequest(state *connectionState, in envelope) envelope {
	hubID := strings.TrimSpace(in.HubID)
	if hubID == "" {
		return s.errorEnvelope(in.Method, codeInvalidArgument, "hubId is required", nil)
	}
	if state.scopeHubID != "" && hubID != state.scopeHubID {
		resp := s.errorEnvelope(in.Method, codeForbidden, "hub out of client scope", map[string]any{"hubId": hubID})
		resp.HubID = hubID
		return resp
	}
	preparedPayload := s.prepareHubStatePayload(in)
	s.mu.RLock()
	hubPeer := s.hubPeers[hubID]
	s.mu.RUnlock()
	if hubPeer == nil {
		resp := s.errorEnvelope(in.Method, codeNotFound, "hub not found", map[string]any{"hubId": hubID})
		resp.HubID = hubID
		return resp
	}

	forwardID := s.nextForwardID.Add(1)
	waitCh, err := hubPeer.registerPending(forwardID)
	if err != nil {
		resp := s.errorEnvelope(in.Method, codeBusy, "hub request backlog is full", nil)
		resp.HubID = hubID
		return resp
	}
	err = hubPeer.write(envelope{
		RequestID: forwardID,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    in.Method,
		HubID:     hubID,
		Payload:   preparedPayload,
	})
	if err != nil {
		hubPeer.resolvePending(forwardID, envelope{})
		resp := s.errorEnvelope(in.Method, codeInternal, "forward request write failed", nil)
		resp.HubID = hubID
		return resp
	}

	select {
	case resp, ok := <-waitCh:
		if !ok {
			resp := s.errorEnvelope(in.Method, codeInternal, "hub disconnected", nil)
			resp.HubID = hubID
			return resp
		}
		resp.HubID = hubID
		resp.ProjectID = ""
		return resp
	case <-time.After(hubStateRequestTimeout(in.Method)):
		hubPeer.resolvePending(forwardID, envelope{})
		resp := s.errorEnvelope(in.Method, codeTimeout, "hub response timeout", nil)
		resp.HubID = hubID
		return resp
	}
}

// prepareHubStatePayload deliberately keeps the Registry transport-only. HubState
// payloads, including provider-specific sections, are forwarded byte-for-byte.
func (s *Server) prepareHubStatePayload(in envelope) json.RawMessage {
	return in.Payload
}

func (s *Server) handleForwardRequest(clientPeer *peerConn, state *connectionState, in envelope) {
	resp := s.executeClientRequest(state, in)
	resp.RequestID = in.RequestID
	_ = clientPeer.write(resp)
}

func (s *Server) executeClientRequest(state *connectionState, in envelope) envelope {
	return s.executeProjectRequest(context.Background(), state.scopeHubID, in)
}

func (s *Server) executeProjectRequest(ctx context.Context, scopeHubID string, in envelope) envelope {
	projectID := strings.TrimSpace(in.ProjectID)
	if projectID == "" {
		return s.errorEnvelope(in.Method, codeInvalidArgument, "projectId is required", nil)
	}
	if scopeHubID != "" && !strings.HasPrefix(projectID, scopeHubID+":") {
		return s.errorEnvelope(in.Method, codeForbidden, "project out of client scope", map[string]any{"projectId": projectID})
	}

	s.mu.RLock()
	hubID := s.projectToHub[projectID]
	hubPeer := s.hubPeers[hubID]
	s.mu.RUnlock()
	if hubID == "" {
		return s.errorEnvelope(in.Method, codeNotFound, "project not found", map[string]any{"projectId": projectID})
	}
	if hubPeer == nil {
		return s.errorEnvelope(in.Method, codeUnavailable, "hub offline", map[string]any{"projectId": projectID})
	}

	forwardID := s.nextForwardID.Add(1)
	waitCh, err := hubPeer.registerPending(forwardID)
	if err != nil {
		return s.errorEnvelope(in.Method, codeBusy, "hub request backlog is full", nil)
	}
	err = hubPeer.write(envelope{
		RequestID: forwardID,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    in.Method,
		ProjectID: projectID,
		Payload:   in.Payload,
	})
	if err != nil {
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeInternal, "forward request write failed", nil)
	}

	timer := time.NewTimer(projectForwardRequestTimeout(in.Method))
	defer timer.Stop()
	select {
	case resp, ok := <-waitCh:
		if !ok {
			return s.errorEnvelope(in.Method, codeInternal, "hub disconnected", nil)
		}
		resp.ProjectID = projectID
		return resp
	case <-ctx.Done():
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeTimeout, "request cancelled", nil)
	case <-timer.C:
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeTimeout, "hub response timeout", nil)
	}
}

func (s *Server) snapshotProjects(scopeHubID string) []rp.ProjectListItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]rp.ProjectListItem, 0, len(s.projectToHub))
	for hubID, hub := range s.hubs {
		if scopeHubID != "" && hubID != scopeHubID {
			continue
		}
		for _, p := range hub.Projects {
			agents := append([]string(nil), p.Agents...)
			items = append(items, rp.ProjectListItem{
				ProjectID:  rp.ProjectID(hubID, p.Name),
				Name:       strings.TrimSpace(p.Name),
				Path:       strings.TrimSpace(p.Path),
				Online:     p.Online,
				Agent:      p.Agent,
				Agents:     agents,
				ProjectRev: p.ProjectRev,
				Git:        p.Git,
			})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].ProjectID < items[j].ProjectID
	})
	return items
}

func (s *Server) snapshotProjectListHubs(scopeHubID string) []rp.HubListItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]rp.HubListItem, 0, len(s.hubDescriptors))
	for hubID, descriptor := range s.hubDescriptors {
		if scopeHubID != "" && hubID != scopeHubID {
			continue
		}
		items = append(items, descriptor)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].HubID < items[j].HubID
	})
	return items
}

func (s *Server) emitProjectSnapshotEvents(hubID string, previous, current []rp.ProjectInfo) {
	prevByName := make(map[string]rp.ProjectInfo, len(previous))
	for _, item := range previous {
		name := strings.TrimSpace(item.Name)
		if name != "" {
			prevByName[name] = item
		}
	}
	for _, item := range current {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		prev, ok := prevByName[name]
		if ok {
			s.emitProjectUpdateEvents(hubID, &prev, item)
		} else {
			s.emitProjectUpdateEvents(hubID, nil, item)
		}
		delete(prevByName, name)
	}
	for _, item := range prevByName {
		offline := item
		offline.Online = false
		s.emitProjectUpdateEvents(hubID, &item, offline)
	}
}

func (s *Server) emitProjectUpdateEvents(hubID string, previous *rp.ProjectInfo, current rp.ProjectInfo) {
	projectID := rp.ProjectID(hubID, current.Name)
	if strings.TrimSpace(projectID) == "" {
		return
	}
	s.broadcastProjectReport(hubID, current)
}

func (s *Server) broadcastProjectReport(hubID string, project rp.ProjectInfo) {
	projectID := rp.ProjectID(hubID, project.Name)
	if strings.TrimSpace(projectID) == "" {
		return
	}
	s.broadcastProjectEvent(hubID, projectID, rp.RegistryMethodRegistryProjectReport, map[string]any{
		"hubId":     hubID,
		"projectId": projectID,
		"project":   project,
	})
}

func (s *Server) broadcastProjectEvent(hubID, projectID, method string, payload any) {
	s.mu.RLock()
	peers := make([]*peerConn, 0, len(s.clientPeers))
	for _, client := range s.clientPeers {
		if client == nil || client.peer == nil {
			continue
		}
		if client.scopeHubID != "" && client.scopeHubID != hubID {
			continue
		}
		peers = append(peers, client.peer)
	}
	s.mu.RUnlock()

	msg := envelope{
		Type:      rp.RegistryEnvelopeTypeEvent,
		Method:    method,
		ProjectID: projectID,
		Payload:   rp.MustRaw(payload),
	}
	for _, peer := range peers {
		_ = peer.write(msg)
	}
}

func decodePayload(raw []byte, out any) error {
	if len(raw) == 0 {
		return nil
	}
	if strings.TrimSpace(string(raw)) == "" {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func (s *Server) unregisterHub(peer *peerConn, state *connectionState) {
	if strings.TrimSpace(state.hubID) == "" {
		return
	}
	s.mu.Lock()
	if s.hubPeers[state.hubID] != peer {
		s.mu.Unlock()
		return
	}
	projects := append([]rp.ProjectInfo(nil), s.hubs[state.hubID].Projects...)
	delete(s.hubPeers, state.hubID)
	delete(s.hubDescriptors, state.hubID)
	delete(s.hubs, state.hubID)
	for projectID, hubID := range s.projectToHub {
		if hubID == state.hubID {
			delete(s.projectToHub, projectID)
		}
	}
	s.mu.Unlock()
	s.abortDebugWebTransfersForHub(state.hubID)
	for _, item := range projects {
		if strings.TrimSpace(item.Name) == "" || !item.Online {
			continue
		}
		offline := item
		offline.Online = false
		s.broadcastProjectReport(state.hubID, offline)
	}
}

func (s *Server) unregisterClient(state *connectionState) {
	if state == nil || state.role != string(rp.RegistryRoleClient) {
		return
	}
	s.mu.Lock()
	delete(s.clientPeers, state.id)
	s.mu.Unlock()
}

func (s *Server) writeResponse(peer *peerConn, requestID int64, method, projectID string, payload any) error {
	return peer.write(envelope{
		RequestID: requestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    method,
		ProjectID: projectID,
		Payload:   rp.MustRaw(payload),
	})
}

func (s *Server) writeError(peer *peerConn, requestID int64, method, code, message string, details map[string]any) error {
	errEnv := s.errorEnvelope(method, code, message, details)
	errEnv.RequestID = requestID
	return peer.write(errEnv)
}

func (s *Server) errorEnvelope(method, code, message string, details map[string]any) envelope {
	return envelope{
		Type:   rp.RegistryEnvelopeTypeError,
		Method: method,
		Payload: rp.MustRaw(errorPayload{
			Code:    code,
			Message: message,
			Details: details,
		}),
	}
}

func relayControlHost(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwarded != "" {
		return forwarded
	}
	return r.Host
}

func relayControlSecure(r *http.Request) bool {
	proto := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")))
	if proto == "https" || proto == "wss" {
		return true
	}
	return r.TLS != nil
}

func defaultDebugUploadLogDir() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return filepath.Join(".", "log")
	}
	return filepath.Join(home, ".wheelmaker", "log")
}

func sanitizeDebugLogSource(source string) string {
	source = strings.ToLower(strings.TrimSpace(source))
	var b strings.Builder
	for _, r := range source {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
		if b.Len() >= 48 {
			break
		}
	}
	cleaned := strings.Trim(b.String(), "-_.")
	if cleaned == "" {
		return "client"
	}
	return cleaned
}
