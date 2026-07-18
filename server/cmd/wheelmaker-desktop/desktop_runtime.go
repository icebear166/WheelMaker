package main

import (
	"context"
	"errors"
	"sync"
	"time"
)

type desktopBootstrapResult struct {
	OK      bool   `json:"ok"`
	BaseURL string `json:"baseUrl"`
	Error   string `json:"error"`
	Busy    bool   `json:"busy"`
}

type desktopRuntimeSurface interface {
	desktopSessionLogout
	desktopSiteDataProfile
	Navigate(baseURL string)
	ShowBootstrapHTML(html string)
}

type desktopRuntime struct {
	mu       sync.RWMutex
	store    desktopConfigStore
	prober   desktopBaseURLProber
	config   desktopConfig
	state    desktopBootstrapState
	security *desktopWebViewSecurityState
	surface  desktopRuntimeSurface
}

func newDesktopRuntime(
	store desktopConfigStore,
	prober desktopBaseURLProber,
	config desktopConfig,
	state desktopBootstrapState,
	security *desktopWebViewSecurityState,
) *desktopRuntime {
	return &desktopRuntime{store: store, prober: prober, config: config, state: state, security: security}
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
	normalized, err := normalizeDesktopBaseURL(raw)
	if err != nil {
		return r.fail("Enter a valid HTTPS server address.")
	}
	if err := r.prober.Probe(ctx, normalized); err != nil {
		return r.fail("Unable to connect securely: " + err.Error())
	}
	config := desktopConfig{BaseURL: normalized}
	if err := r.store.Save(config); err != nil {
		return r.fail("Unable to save the server address.")
	}
	if err := r.security.SetTrustedBaseURL(normalized); err != nil {
		return r.fail("Unable to authorize the server address.")
	}

	r.mu.Lock()
	r.config = config
	r.state = desktopBootstrapState{BaseURL: normalized}
	surface := r.surface
	r.mu.Unlock()
	if surface == nil {
		return r.fail("Desktop WebView is not ready.")
	}
	surface.Navigate(normalized)
	return desktopBootstrapResult{OK: true, BaseURL: normalized}
}

func (r *desktopRuntime) Retry(ctx context.Context) desktopBootstrapResult {
	r.mu.RLock()
	baseURL := r.config.BaseURL
	r.mu.RUnlock()
	if baseURL == "" {
		return r.fail("Enter a server address first.")
	}
	return r.SaveBaseURL(ctx, baseURL)
}

func (r *desktopRuntime) Reset(ctx context.Context) desktopBootstrapResult {
	r.mu.Lock()
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
		err := switchDesktopServer(cleanupContext, baseURL, surface, surface, r.store, r)
		if err != nil {
			r.mu.Lock()
			r.state.Error = "Local site data cleanup failed: " + err.Error()
			r.state.Busy = false
			r.mu.Unlock()
		}
	}()
	return desktopBootstrapResult{OK: true, BaseURL: baseURL, Busy: true}
}

func (r *desktopRuntime) HandleNavigationFailure(message string) {
	r.mu.Lock()
	r.state.BaseURL = r.config.BaseURL
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
	r.config = desktopConfig{}
	r.state = desktopBootstrapState{}
	surface := r.surface
	r.mu.Unlock()
	r.security.ShowBootstrap()
	if surface != nil {
		surface.ShowBootstrapHTML(desktopBootstrapHTML)
	}
}

func (r *desktopRuntime) EnterLocalDev() error {
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
	baseURL := r.config.BaseURL
	surface := r.surface
	r.mu.RUnlock()
	if surface == nil {
		return errors.New("Desktop WebView is not ready")
	}
	if baseURL == "" {
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

func (r *desktopRuntime) fail(message string) desktopBootstrapResult {
	r.mu.Lock()
	r.state.Error = message
	r.state.Busy = false
	state := r.state
	r.mu.Unlock()
	return desktopBootstrapResult{BaseURL: state.BaseURL, Error: state.Error, Busy: state.Busy}
}
