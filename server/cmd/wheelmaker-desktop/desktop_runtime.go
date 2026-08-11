package main

import (
	"context"
	"errors"
	"sync"
	"time"
)

type desktopBootstrapResult struct {
	OK                bool                  `json:"ok"`
	ConnectionMode    desktopConnectionMode `json:"connectionMode,omitempty"`
	BaseURL           string                `json:"baseUrl"`
	SupportsLocalhost bool                  `json:"supportsLocalhost"`
	Error             string                `json:"error"`
	Busy              bool                  `json:"busy"`
}

type desktopRuntimeSurface interface {
	desktopSessionLogout
	desktopSiteDataProfile
	Navigate(baseURL string)
	ShowBootstrapHTML(html string)
}

type desktopRuntime struct {
	mu                   sync.RWMutex
	store                desktopConfigStore
	prober               desktopBaseURLProber
	config               desktopConfig
	state                desktopBootstrapState
	security             *desktopWebViewSecurityState
	surface              desktopRuntimeSurface
	localhostEdgeFactory desktopLocalhostEdgeFactory
	localhostEdge        desktopLocalhostRuntimeEdge
	localhostURL         string
}

type desktopRuntimeOptions struct {
	LocalhostEdgeFactory desktopLocalhostEdgeFactory
	LocalhostEdge        desktopLocalhostRuntimeEdge
	LocalhostURL         string
}

func newDesktopRuntime(
	store desktopConfigStore,
	prober desktopBaseURLProber,
	config desktopConfig,
	state desktopBootstrapState,
	security *desktopWebViewSecurityState,
) *desktopRuntime {
	return newDesktopRuntimeWithOptions(store, prober, config, state, security, desktopRuntimeOptions{
		LocalhostEdgeFactory: newDefaultDesktopLocalhostEdge,
	})
}

func newDesktopRuntimeWithOptions(
	store desktopConfigStore,
	prober desktopBaseURLProber,
	config desktopConfig,
	state desktopBootstrapState,
	security *desktopWebViewSecurityState,
	options desktopRuntimeOptions,
) *desktopRuntime {
	state.SupportsLocalhost = true
	return &desktopRuntime{
		store:                store,
		prober:               prober,
		config:               config,
		state:                state,
		security:             security,
		localhostEdgeFactory: options.LocalhostEdgeFactory,
		localhostEdge:        options.LocalhostEdge,
		localhostURL:         options.LocalhostURL,
	}
}

func (r *desktopRuntime) AttachSurface(surface desktopRuntimeSurface) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.surface = surface
}

func (r *desktopRuntime) GetState() desktopBootstrapState {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state
}

func (r *desktopRuntime) SaveBaseURL(ctx context.Context, raw string) desktopBootstrapResult {
	r.mu.Lock()
	r.state.ConnectionMode = desktopConnectionGateway
	r.state.BaseURL = raw
	r.state.SupportsLocalhost = true
	r.state.Busy = true
	r.mu.Unlock()
	normalized, err := normalizeDesktopBaseURL(raw)
	if err != nil {
		return r.fail("Enter a valid HTTPS server address.")
	}
	candidate := desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: normalized}
	r.mu.Lock()
	r.config = candidate
	r.state.BaseURL = normalized
	r.mu.Unlock()
	if err := r.prober.Probe(ctx, normalized); err != nil {
		return r.fail("Unable to connect securely: " + err.Error())
	}
	config := candidate
	if err := r.store.Save(config); err != nil {
		return r.fail("Unable to save the server address.")
	}
	if err := r.security.SetTrustedBaseURL(normalized); err != nil {
		return r.fail("Unable to authorize the server address.")
	}

	r.mu.Lock()
	r.config = config
	r.state = desktopBootstrapState{
		ConnectionMode:    desktopConnectionGateway,
		BaseURL:           normalized,
		SupportsLocalhost: true,
	}
	surface := r.surface
	localhostEdge := r.localhostEdge
	r.localhostEdge = nil
	r.localhostURL = ""
	r.mu.Unlock()
	if surface == nil {
		return r.fail("Desktop WebView is not ready.")
	}
	if localhostEdge != nil {
		_ = localhostEdge.Close()
		_ = localhostEdge.DeleteState()
	}
	surface.Navigate(normalized)
	return desktopBootstrapResult{
		OK:                true,
		ConnectionMode:    desktopConnectionGateway,
		BaseURL:           normalized,
		SupportsLocalhost: true,
	}
}

func (r *desktopRuntime) SelectLocalhost(ctx context.Context) desktopBootstrapResult {
	config := desktopConfig{ConnectionMode: desktopConnectionLocalhost}
	if err := r.store.Save(config); err != nil {
		return r.fail("Unable to save the Localhost connection.")
	}
	r.mu.Lock()
	r.config = config
	r.state = desktopBootstrapState{
		ConnectionMode:    desktopConnectionLocalhost,
		SupportsLocalhost: true,
		Busy:              true,
	}
	r.mu.Unlock()
	return r.startLocalhost(ctx)
}

func (r *desktopRuntime) Retry(ctx context.Context) desktopBootstrapResult {
	r.mu.RLock()
	mode := r.config.ConnectionMode
	baseURL := r.config.BaseURL
	r.mu.RUnlock()
	switch mode {
	case desktopConnectionGateway:
		return r.SaveBaseURL(ctx, baseURL)
	case desktopConnectionLocalhost:
		return r.startLocalhost(ctx)
	default:
		if baseURL != "" {
			return r.SaveBaseURL(ctx, baseURL)
		}
		return r.fail("Choose a connection first.")
	}
}

func (r *desktopRuntime) Reset(ctx context.Context) desktopBootstrapResult {
	r.mu.Lock()
	connectionURL := r.connectionURLLocked()
	mode := r.config.ConnectionMode
	baseURL := r.config.BaseURL
	r.state.Busy = true
	surface := r.surface
	r.mu.Unlock()
	if surface == nil {
		return r.fail("Desktop WebView is not ready.")
	}
	go func() {
		cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		err := switchDesktopServer(cleanupContext, connectionURL, surface, surface, r.store, r)
		if err != nil {
			r.mu.Lock()
			r.state.Error = "Local site data cleanup failed: " + err.Error()
			r.state.Busy = false
			r.mu.Unlock()
		}
	}()
	return desktopBootstrapResult{
		OK:                true,
		ConnectionMode:    mode,
		BaseURL:           baseURL,
		SupportsLocalhost: true,
		Busy:              true,
	}
}

func (r *desktopRuntime) HandleNavigationFailure(message string) {
	r.mu.Lock()
	r.state.ConnectionMode = r.config.ConnectionMode
	r.state.BaseURL = r.config.BaseURL
	r.state.SupportsLocalhost = true
	r.state.Error = message
	r.state.Busy = false
	surface := r.surface
	r.mu.Unlock()
	r.security.ClearAuthorization()
	r.security.ShowBootstrap()
	if surface != nil {
		surface.ShowBootstrapHTML(desktopBootstrapHTML)
	}
}

func (r *desktopRuntime) TrustedLocalhostURL() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.config.ConnectionMode != desktopConnectionLocalhost || r.security.Mode() != desktopTrustedLocalhostPage {
		return ""
	}
	return r.localhostURL
}

func (r *desktopRuntime) NavigationFailureMessage() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.config.ConnectionMode == desktopConnectionLocalhost {
		return "The Localhost navigation failed. Retry or change the connection."
	}
	return "The secure server navigation failed. Retry or change the address."
}

func (r *desktopRuntime) RequestServerChange(ctx context.Context) error {
	result := r.Reset(ctx)
	if !result.OK {
		return errors.New(result.Error)
	}
	return nil
}

func (r *desktopRuntime) ClearAuthorization() {
	r.security.ClearAuthorization()
}

func (r *desktopRuntime) ShowBootstrap() {
	r.mu.Lock()
	localhostEdge := r.localhostEdge
	r.localhostEdge = nil
	r.localhostURL = ""
	r.config = desktopConfig{}
	r.state = desktopBootstrapState{SupportsLocalhost: true}
	surface := r.surface
	r.mu.Unlock()
	if localhostEdge != nil {
		_ = localhostEdge.Close()
		_ = localhostEdge.DeleteState()
	}
	r.security.ShowBootstrap()
	if surface != nil {
		surface.ShowBootstrapHTML(desktopBootstrapHTML)
	}
}

func (r *desktopRuntime) EnterLocalDev() error {
	r.mu.RLock()
	localhostEdge := r.localhostEdge
	r.mu.RUnlock()
	if localhostEdge != nil {
		if err := localhostEdge.Close(); err != nil {
			return err
		}
	}
	if err := r.security.SetTrustedLocalDevPage(); err != nil {
		return err
	}
	r.mu.RLock()
	surface := r.surface
	r.mu.RUnlock()
	if surface == nil {
		return errors.New("Desktop WebView is not ready")
	}
	surface.Navigate(desktopLocalDevURL)
	return nil
}

func (r *desktopRuntime) ExitLocalDev() error {
	r.mu.RLock()
	mode := r.config.ConnectionMode
	baseURL := r.config.BaseURL
	surface := r.surface
	r.mu.RUnlock()
	if surface == nil {
		return errors.New("Desktop WebView is not ready")
	}
	if mode == desktopConnectionLocalhost {
		result := r.startLocalhost(context.Background())
		if !result.OK {
			return errors.New(result.Error)
		}
		return nil
	}
	if mode != desktopConnectionGateway || baseURL == "" {
		r.security.ShowBootstrap()
		surface.ShowBootstrapHTML(desktopBootstrapHTML)
		return nil
	}
	if err := r.security.SetTrustedBaseURL(baseURL); err != nil {
		return err
	}
	surface.Navigate(baseURL)
	return nil
}

func (r *desktopRuntime) Close() error {
	r.mu.RLock()
	localhostEdge := r.localhostEdge
	r.mu.RUnlock()
	if localhostEdge == nil {
		return nil
	}
	return localhostEdge.Close()
}

func (r *desktopRuntime) startLocalhost(ctx context.Context) desktopBootstrapResult {
	r.mu.RLock()
	edge := r.localhostEdge
	factory := r.localhostEdgeFactory
	surface := r.surface
	r.mu.RUnlock()
	if surface == nil {
		return r.fail("Desktop WebView is not ready.")
	}
	if edge == nil {
		if factory == nil {
			return r.fail("Unable to start Localhost: Desktop Localhost is unavailable.")
		}
		created, err := factory()
		if err != nil {
			return r.fail("Unable to start Localhost: " + err.Error())
		}
		edge = created
		r.mu.Lock()
		r.localhostEdge = edge
		r.mu.Unlock()
	}
	targetURL, err := edge.Start(ctx)
	if err != nil {
		return r.fail("Unable to start Localhost: " + err.Error())
	}
	if err := r.security.SetTrustedLocalhostPage(targetURL); err != nil {
		_ = edge.Close()
		return r.fail("Unable to authorize Localhost.")
	}
	r.mu.Lock()
	r.localhostURL = targetURL
	r.state = desktopBootstrapState{
		ConnectionMode:    desktopConnectionLocalhost,
		SupportsLocalhost: true,
	}
	r.mu.Unlock()
	surface.Navigate(targetURL)
	return desktopBootstrapResult{
		OK:                true,
		ConnectionMode:    desktopConnectionLocalhost,
		SupportsLocalhost: true,
	}
}

func (r *desktopRuntime) connectionURLLocked() string {
	if r.config.ConnectionMode == desktopConnectionLocalhost {
		return r.localhostURL
	}
	return r.config.BaseURL
}

func (r *desktopRuntime) fail(message string) desktopBootstrapResult {
	r.mu.Lock()
	r.state.Error = message
	r.state.Busy = false
	state := r.state
	r.mu.Unlock()
	return desktopBootstrapResult{
		ConnectionMode:    state.ConnectionMode,
		BaseURL:           state.BaseURL,
		SupportsLocalhost: state.SupportsLocalhost,
		Error:             state.Error,
		Busy:              state.Busy,
	}
}
