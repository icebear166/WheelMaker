package portrelay

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	internalHubPath           = "/__wheelmaker/relay/hub"
	internalLoginPath         = "/__wheelmaker/relay/login"
	internalLogoutPath        = "/__wheelmaker/relay/logout"
	internalStatusPath        = "/__wheelmaker/relay/status"
	internalClearSiteDataPath = "/__wheelmaker/relay/clear-site-data"

	relayCookieName   = "wm_port_relay"
	relayURLCodeParam = "__wm_relay_code"
	relayTargetHost   = "127.0.0.1"
	defaultTunnelWait = 2 * time.Second
	defaultStreamWait = 10 * time.Second

	BrowserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

	RelayMarkerHeader = "X-WheelMaker-Relay"
	RelayMarkerValue  = "1"
)

// ErrRelayPortClientManaged tells the controller that an edge proxy such as
// Nginx owns the public port and the client supplies it for each enable.
var ErrRelayPortClientManaged = errors.New("relay port is client-managed")

type ControlResult struct {
	Payload json.RawMessage
	Code    string
	Message string
	Details map[string]any
}

type ForwardHubRequestFunc func(ctx context.Context, hubID string, method string, payload any) ControlResult

type RelayPortProvider func() (int, error)

type ControllerConfig struct {
	RegistryAddr      string
	ForwardHubRequest ForwardHubRequestFunc
	RelayPortProvider RelayPortProvider
	TunnelWait        time.Duration
	Random            io.Reader
	Now               func() time.Time
}

type Controller struct {
	cfg          ControllerConfig
	standardPort int
	secret       []byte
	random       io.Reader
	loginGuard   *loginGuard

	mu             sync.RWMutex
	slot           relaySlot
	tunnel         *registryTunnel
	configuredPort int
	clientManaged  bool
	clientPort     int
	providerError  string
}

type relaySlot struct {
	Enabled              bool
	Status               rp.RelayStatus
	ListenPort           int
	HubID                string
	TargetHost           string
	TargetPort           int
	AccessCode           string
	AccessCodeGeneration int64
	RelayID              string
	RelayURL             string
	TunnelURL            string
	Nonce                string
	TunnelConnectedAt    string
	Error                string
	Ready                chan struct{}
	readyOnce            sync.Once
}

func NewController(cfg ControllerConfig) (*Controller, error) {
	if cfg.TunnelWait <= 0 {
		cfg.TunnelWait = defaultTunnelWait
	}
	if cfg.Random == nil {
		cfg.Random = rand.Reader
	}
	if cfg.RelayPortProvider == nil {
		cfg.RelayPortProvider = func() (int, error) { return 0, ErrRelayPortClientManaged }
	}
	secret := make([]byte, 32)
	if _, err := io.ReadFull(cfg.Random, secret); err != nil {
		return nil, fmt.Errorf("generate relay controller secret: %w", err)
	}
	guard := newLoginGuard(cfg.Now)
	guard.reset(0)
	return &Controller{
		cfg:          cfg,
		standardPort: parsePort(cfg.RegistryAddr, 9630),
		secret:       secret,
		random:       cfg.Random,
		loginGuard:   guard,
		slot: relaySlot{
			Status: rp.RelayStatusDisabled,
		},
	}, nil
}

func (c *Controller) reconcileGatewayPort() {
	port, err := c.cfg.RelayPortProvider()
	clientManaged := errors.Is(err, ErrRelayPortClientManaged)
	providerError := ""
	if clientManaged {
		err = nil
		port = 0
	} else if err != nil {
		providerError = err.Error()
		port = 0
	} else if port != 0 && !validPort(port) {
		providerError = fmt.Sprintf("relay listen port must be in 1..65535, got %d", port)
		port = 0
	}

	var oldSlot relaySlot
	var oldTunnel *registryTunnel
	closeReason := "gateway_port_changed"
	c.mu.Lock()
	modeChanged := c.clientManaged != clientManaged
	c.configuredPort = port
	c.clientManaged = clientManaged
	c.providerError = providerError
	if modeChanged {
		c.clientPort = 0
	}
	if c.slot.Enabled && (providerError != "" || modeChanged || (!clientManaged && (port == 0 || c.slot.ListenPort != port))) {
		oldSlot = c.slot
		oldTunnel = c.tunnel
		c.tunnel = nil
		c.slot = relaySlot{Status: rp.RelayStatusDisabled}
		c.loginGuard.reset(0)
		if providerError != "" || port == 0 {
			closeReason = "gateway_port_unavailable"
		}
	}
	c.mu.Unlock()

	if oldTunnel != nil {
		oldTunnel.Close()
	}
	if oldSlot.Enabled && oldSlot.HubID != "" && oldSlot.RelayID != "" {
		go c.forwardClose(context.Background(), oldSlot.HubID, oldSlot.RelayID, closeReason)
	}
}

func (c *Controller) Handle(ctx context.Context, method string, raw json.RawMessage, controlHost string, secure bool) (any, *rp.ErrorPayload) {
	switch method {
	case rp.RegistryMethodRegistryRelayEnable:
		var payload rp.RelayEnablePayload
		if err := decodePayload(raw, &payload); err != nil {
			return nil, relayError(rp.CodeInvalidArgument, "invalid registry.relay.enable payload", nil)
		}
		return c.Enable(ctx, payload, controlHost, secure)
	case rp.RegistryMethodRegistryRelayDisable:
		return c.Disable(ctx)
	case rp.RegistryMethodRegistryRelayStatus:
		snapshot := c.Status()
		return snapshot, nil
	case rp.RegistryMethodRegistryRelayRegenerateAccessCode:
		var payload rp.RelayRegenerateAccessCodePayload
		if err := decodePayload(raw, &payload); err != nil {
			return nil, relayError(rp.CodeInvalidArgument, "invalid registry.relay.regenerateAccessCode payload", nil)
		}
		return c.RegenerateAccessCode(payload.AccessCode)
	default:
		return nil, relayError(rp.CodeInvalidArgument, "unsupported relay method", map[string]any{"method": method})
	}
}

func (c *Controller) Enable(ctx context.Context, payload rp.RelayEnablePayload, controlHost string, secure bool) (rp.RelaySnapshot, *rp.ErrorPayload) {
	payload.HubID = strings.TrimSpace(payload.HubID)
	payload.TargetHost = strings.TrimSpace(payload.TargetHost)
	payload.AccessCode = strings.TrimSpace(payload.AccessCode)
	if payload.HubID == "" {
		return c.Status(), relayError(rp.CodeInvalidArgument, "hubId is required", nil)
	}
	if payload.TargetHost == "" {
		return c.Status(), relayError(rp.CodeInvalidArgument, "targetHost is required", nil)
	}
	if payload.TargetHost != relayTargetHost {
		return c.Status(), relayError(rp.CodeInvalidArgument, "targetHost must be 127.0.0.1", nil)
	}
	if !validPort(payload.ListenPort) || !validPort(payload.TargetPort) {
		return c.Status(), relayError(rp.CodeInvalidArgument, "listenPort and targetPort must be in 1..65535", nil)
	}
	if payload.ListenPort == c.standardPort {
		return c.Status(), relayError(rp.CodeInvalidArgument, "listenPort must not equal registry port", nil)
	}
	if !validAccessCode(payload.AccessCode) {
		return c.Status(), relayError(rp.CodeInvalidArgument, "accessCode must be 6 digits", nil)
	}
	if c.cfg.ForwardHubRequest == nil {
		return c.Status(), relayError(rp.CodeInternal, "relay forwarder is not configured", nil)
	}

	c.reconcileGatewayPort()
	c.mu.RLock()
	configuredPort := c.configuredPort
	providerError := c.providerError
	c.mu.RUnlock()
	if providerError != "" {
		return c.Status(), relayError(rp.CodeUnavailable, "relay port configuration is unavailable", map[string]any{"error": providerError})
	}
	clientManaged := false
	c.mu.RLock()
	clientManaged = c.clientManaged
	c.mu.RUnlock()
	if !clientManaged && configuredPort == 0 {
		return c.Status(), relayError(rp.CodeUnavailable, "relay port is not configured", nil)
	}
	listenPort := configuredPort
	if clientManaged {
		listenPort = payload.ListenPort
	} else if payload.ListenPort != configuredPort {
		return c.Status(), relayError(rp.CodeInvalidArgument, fmt.Sprintf("listenPort must equal configured Gateway Relay port %d", configuredPort), map[string]any{"configuredPort": configuredPort})
	}

	relayID, err := randomToken(c.random, "relay_", 16)
	if err != nil {
		return c.Status(), relayError(rp.CodeInternal, "generate relay id failed", nil)
	}
	nonce, err := randomToken(c.random, "", 24)
	if err != nil {
		return c.Status(), relayError(rp.CodeInternal, "generate relay nonce failed", nil)
	}
	publicHost := hostOnly(controlHost)
	if publicHost == "" {
		publicHost = hostOnly(c.cfg.RegistryAddr)
	}
	if publicHost == "" {
		publicHost = "127.0.0.1"
	}
	relayURL := buildPublicRelayURL(publicHost, listenPort, secure)
	tunnelURL := buildTunnelRelayURL(publicHost, listenPort, secure)

	var oldTunnel *registryTunnel

	c.mu.Lock()
	oldSlot := c.slot
	oldGeneration := oldSlot.AccessCodeGeneration
	ready := make(chan struct{})
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		ListenPort:           listenPort,
		HubID:                payload.HubID,
		TargetHost:           payload.TargetHost,
		TargetPort:           payload.TargetPort,
		AccessCode:           payload.AccessCode,
		AccessCodeGeneration: oldGeneration + 1,
		RelayID:              relayID,
		RelayURL:             relayURL,
		TunnelURL:            tunnelURL,
		Nonce:                nonce,
		Ready:                ready,
	}
	if clientManaged {
		c.clientPort = listenPort
	}
	c.loginGuard.reset(c.slot.AccessCodeGeneration)
	if c.tunnel != nil {
		oldTunnel = c.tunnel
		c.tunnel = nil
	}
	snapshot := c.snapshotLocked()
	c.mu.Unlock()

	if oldTunnel != nil {
		oldTunnel.Close()
	}
	if oldSlot.Enabled && oldSlot.HubID != "" && oldSlot.RelayID != "" {
		go c.forwardClose(context.Background(), oldSlot.HubID, oldSlot.RelayID, "replaced")
	}

	result := c.cfg.ForwardHubRequest(ctx, payload.HubID, rp.RegistryMethodHubRelayOpen, rp.RelayOpenPayload{
		RelayID:    relayID,
		RelayURL:   tunnelURL,
		Nonce:      nonce,
		TargetHost: payload.TargetHost,
		TargetPort: payload.TargetPort,
		UserAgent:  BrowserUserAgent,
		OpenedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	if result.Code != "" {
		c.markError(relayID, result.Message)
		return c.Status(), relayError(result.Code, result.Message, result.Details)
	}

	select {
	case <-ready:
		return c.Status(), nil
	case <-time.After(c.cfg.TunnelWait):
		return snapshot, nil
	case <-ctx.Done():
		return c.Status(), relayError(rp.CodeTimeout, "relay.enable canceled", nil)
	}
}

func (c *Controller) Disable(ctx context.Context) (rp.RelaySnapshot, *rp.ErrorPayload) {
	c.reconcileGatewayPort()
	c.mu.Lock()
	oldSlot := c.slot
	oldTunnel := c.tunnel
	c.slot = relaySlot{Status: rp.RelayStatusDisabled}
	c.tunnel = nil
	c.loginGuard.reset(0)
	snapshot := c.snapshotLocked()
	c.mu.Unlock()

	if oldTunnel != nil {
		oldTunnel.Close()
	}
	if oldSlot.Enabled && oldSlot.HubID != "" && oldSlot.RelayID != "" {
		c.forwardClose(ctx, oldSlot.HubID, oldSlot.RelayID, "disabled")
	}
	return snapshot, nil
}

func (c *Controller) RegenerateAccessCode(accessCode string) (rp.RelaySnapshot, *rp.ErrorPayload) {
	c.reconcileGatewayPort()
	accessCode = strings.TrimSpace(accessCode)
	if !validAccessCode(accessCode) {
		return c.Status(), relayError(rp.CodeInvalidArgument, "accessCode must be 6 digits", nil)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.slot.Enabled {
		return c.snapshotLocked(), relayError(rp.CodeInvalidArgument, "relay is not enabled", nil)
	}
	c.slot.AccessCode = accessCode
	c.slot.AccessCodeGeneration++
	c.loginGuard.reset(c.slot.AccessCodeGeneration)
	return c.snapshotLocked(), nil
}

func (c *Controller) Status() rp.RelaySnapshot {
	c.reconcileGatewayPort()
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshotLocked()
}

func (c *Controller) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.reconcileGatewayPort()
	c.handleDataPlane(w, r)
}

func (c *Controller) acceptTunnel(relayID string, nonce string, conn *websocket.Conn) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.slot.Enabled || c.slot.RelayID != relayID || c.slot.Nonce != nonce {
		return false
	}
	if c.tunnel != nil {
		c.tunnel.Close()
	}
	tunnel := newRegistryTunnel(conn, func() {
		c.markTunnelClosed(relayID)
	})
	c.tunnel = tunnel
	c.slot.Status = rp.RelayStatusUp
	c.slot.Error = ""
	c.slot.TunnelConnectedAt = time.Now().UTC().Format(time.RFC3339)
	c.slot.readyOnce.Do(func() { close(c.slot.Ready) })
	go tunnel.readLoop()
	return true
}

func (c *Controller) activeTunnel() (*registryTunnel, rp.RelaySnapshot) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.tunnel, c.snapshotLocked()
}

func (c *Controller) markError(relayID string, message string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.slot.RelayID != relayID {
		return
	}
	c.slot.Status = rp.RelayStatusError
	c.slot.Error = message
}

func (c *Controller) markTunnelClosed(relayID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.slot.RelayID != relayID {
		return
	}
	c.tunnel = nil
	if c.slot.Enabled && c.slot.Status == rp.RelayStatusUp {
		c.slot.Status = rp.RelayStatusError
		c.slot.Error = "relay tunnel disconnected"
	}
}

func (c *Controller) snapshotLocked() rp.RelaySnapshot {
	if !c.slot.Enabled {
		listenPort := c.configuredPort
		if c.clientManaged {
			listenPort = c.clientPort
		}
		errorMessage := c.providerError
		if listenPort == 0 && errorMessage == "" && !c.clientManaged {
			errorMessage = "relay port is not configured"
		}
		return rp.RelaySnapshot{
			OK:                true,
			Enabled:           false,
			Status:            rp.RelayStatusDisabled,
			ListenPort:        listenPort,
			ListenPortManaged: !c.clientManaged,
			Error:             errorMessage,
		}
	}
	return rp.RelaySnapshot{
		OK:                   true,
		Enabled:              c.slot.Enabled,
		Status:               c.slot.Status,
		ListenPort:           c.slot.ListenPort,
		ListenPortManaged:    !c.clientManaged,
		HubID:                c.slot.HubID,
		TargetHost:           c.slot.TargetHost,
		TargetPort:           c.slot.TargetPort,
		AccessCodeGeneration: c.slot.AccessCodeGeneration,
		RelayURL:             c.slot.RelayURL,
		TunnelConnectedAt:    c.slot.TunnelConnectedAt,
		Error:                c.slot.Error,
	}
}

func (c *Controller) forwardClose(ctx context.Context, hubID string, relayID string, reason string) {
	if c.cfg.ForwardHubRequest == nil {
		return
	}
	_ = c.cfg.ForwardHubRequest(ctx, hubID, rp.RegistryMethodHubRelayClose, rp.RelayClosePayload{RelayID: relayID, Reason: reason})
}

func relayError(code string, message string, details map[string]any) *rp.ErrorPayload {
	return &rp.ErrorPayload{Code: code, Message: message, Details: details}
}

func decodePayload(raw []byte, out any) error {
	if len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func validPort(port int) bool {
	return port >= 1 && port <= 65535
}

func validAccessCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func randomToken(random io.Reader, prefix string, size int) (string, error) {
	buf := make([]byte, size)
	if _, err := io.ReadFull(random, buf); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func parsePort(addr string, fallback int) int {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return fallback
	}
	if strings.HasPrefix(addr, ":") {
		if port, err := strconv.Atoi(strings.TrimPrefix(addr, ":")); err == nil {
			return port
		}
	}
	_, portText, err := net.SplitHostPort(addr)
	if err != nil {
		return fallback
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		return fallback
	}
	return port
}

func hostOnly(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "ws://") || strings.HasPrefix(value, "wss://") {
		withoutScheme := value[strings.Index(value, "://")+3:]
		value = strings.SplitN(withoutScheme, "/", 2)[0]
	}
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	if strings.HasPrefix(value, ":") {
		return "127.0.0.1"
	}
	if strings.Contains(value, ":") {
		return ""
	}
	return value
}

func buildPublicRelayURL(host string, port int, secure bool) string {
	scheme := "http"
	if secure {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s:%d/", scheme, host, port)
}

func buildTunnelRelayURL(host string, port int, secure bool) string {
	scheme := "ws"
	if secure {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s:%d%s", scheme, host, port, internalHubPath)
}
