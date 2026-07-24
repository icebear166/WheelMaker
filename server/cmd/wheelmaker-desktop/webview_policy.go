package main

import (
	"context"
	"errors"
	"net/url"
	"path"
	"strings"
	"sync"
)

type desktopPageMode uint8

const (
	desktopBootstrapPage desktopPageMode = iota
	desktopTrustedRemotePage
	desktopTrustedLocalDevPage
)

type desktopBridgeAction uint8

const (
	desktopBridgeGetState desktopBridgeAction = iota
	desktopBridgeSaveBaseURL
	desktopBridgeRetry
	desktopBridgeReset
	desktopBridgeGetDeviceName
	desktopBridgeStartDrag
	desktopBridgeMinimize
	desktopBridgeToggleMaximize
	desktopBridgeClose
	desktopBridgeRequestServerChange
	desktopBridgeOpenProjectFileInVSCode
	desktopBridgeShowProjectFileInFolder
	desktopBridgeOpenFileInVSCode
	desktopBridgeShowFileInFolder
	desktopBridgeEnterLocalDev
	desktopBridgeGetLocalDevState
	desktopBridgeSaveLocalDevSource
	desktopBridgeRunLocalDevOperation
	desktopBridgeGetUpdateInfo
	desktopBridgeRequestUpdate
)

type desktopNavigationAction uint8

const (
	desktopNavigationBlock desktopNavigationAction = iota
	desktopNavigationAllow
	desktopNavigationOpenExternal
)

type desktopWebViewPolicy struct {
	baseURL  *url.URL
	localDev bool
}

func newDesktopWebViewPolicy(baseURL string) (*desktopWebViewPolicy, error) {
	normalized, err := normalizeDesktopBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return nil, err
	}
	return &desktopWebViewPolicy{baseURL: parsed}, nil
}

func newDesktopLocalDevWebViewPolicy() (*desktopWebViewPolicy, error) {
	baseURL, err := url.Parse(desktopLocalDevURL)
	if err != nil {
		return nil, err
	}
	return &desktopWebViewPolicy{baseURL: baseURL, localDev: true}, nil
}

func (p *desktopWebViewPolicy) AllowsBridge(mode desktopPageMode, rawURL string, mainFrame bool, action desktopBridgeAction) bool {
	if !mainFrame {
		return false
	}
	if mode == desktopBootstrapPage {
		if !isDesktopBootstrapDocumentURL(rawURL) {
			return false
		}
		return desktopBootstrapActionAllowed(action)
	}
	if (mode != desktopTrustedRemotePage && mode != desktopTrustedLocalDevPage) || !p.contains(rawURL) {
		return false
	}
	if mode == desktopTrustedLocalDevPage {
		switch action {
		case desktopBridgeGetDeviceName,
			desktopBridgeStartDrag,
			desktopBridgeMinimize,
			desktopBridgeToggleMaximize,
			desktopBridgeClose:
			return true
		case desktopBridgeGetLocalDevState,
			desktopBridgeSaveLocalDevSource,
			desktopBridgeRunLocalDevOperation:
			return true
		default:
			return false
		}
	}
	switch action {
	case desktopBridgeGetDeviceName,
		desktopBridgeStartDrag,
		desktopBridgeMinimize,
		desktopBridgeToggleMaximize,
		desktopBridgeClose,
		desktopBridgeRequestServerChange,
		desktopBridgeEnterLocalDev,
		desktopBridgeOpenProjectFileInVSCode,
		desktopBridgeShowProjectFileInFolder,
		desktopBridgeOpenFileInVSCode,
		desktopBridgeShowFileInFolder,
		desktopBridgeGetUpdateInfo,
		desktopBridgeRequestUpdate:
		return true
	default:
		return false
	}
}

func (p *desktopWebViewPolicy) DecideNavigation(rawURL string, mainFrame bool, certificateError bool) desktopNavigationAction {
	if certificateError {
		return desktopNavigationBlock
	}
	if p.contains(rawURL) {
		return desktopNavigationAllow
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return desktopNavigationBlock
	}
	if mainFrame {
		return desktopNavigationOpenExternal
	}
	return desktopNavigationBlock
}

func (p *desktopWebViewPolicy) contains(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	if p.localDev {
		return parsed.Scheme == "http" && parsed.Host == "127.0.0.1:4173" &&
			parsed.RawQuery == "" && parsed.Fragment == "" &&
			(cleanURLPath(parsed.Path) == "/" || strings.HasPrefix(cleanURLPath(parsed.Path), "/"))
	}
	if parsed.Scheme != "https" {
		return false
	}
	if !strings.EqualFold(parsed.Scheme, p.baseURL.Scheme) || !strings.EqualFold(parsed.Host, p.baseURL.Host) {
		return false
	}
	basePath := cleanURLPath(p.baseURL.Path)
	targetPath := cleanURLPath(parsed.Path)
	return targetPath == strings.TrimSuffix(basePath, "/") || strings.HasPrefix(targetPath, basePath)
}

func cleanURLPath(value string) string {
	cleaned := path.Clean("/" + strings.TrimPrefix(value, "/"))
	if cleaned == "." {
		return "/"
	}
	if strings.HasSuffix(value, "/") && !strings.HasSuffix(cleaned, "/") {
		cleaned += "/"
	}
	return cleaned
}

type desktopWebViewSecurityState struct {
	mu             sync.RWMutex
	policy         *desktopWebViewPolicy
	mode           desktopPageMode
	epoch          uint64
	committedEpoch uint64
	committedURL   string
}

func (s *desktopWebViewSecurityState) Mode() desktopPageMode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.mode
}

func newDesktopWebViewSecurityState(baseURL string, mode desktopPageMode) (*desktopWebViewSecurityState, error) {
	state := &desktopWebViewSecurityState{mode: mode}
	if mode == desktopTrustedRemotePage {
		policy, err := newDesktopWebViewPolicy(baseURL)
		if err != nil {
			return nil, err
		}
		state.policy = policy
	} else if mode == desktopTrustedLocalDevPage {
		policy, err := newDesktopLocalDevWebViewPolicy()
		if err != nil {
			return nil, err
		}
		state.policy = policy
	}
	return state, nil
}

func (s *desktopWebViewSecurityState) BeginTopLevelNavigation(rawURL string) uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.epoch++
	s.committedEpoch = 0
	s.committedURL = rawURL
	return s.epoch
}

func (s *desktopWebViewSecurityState) CommitTopLevelNavigation(epoch uint64, rawURL string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if epoch != s.epoch || !s.allowsTopLevelNavigation(rawURL) {
		return
	}
	s.committedEpoch = epoch
	s.committedURL = rawURL
}

func (s *desktopWebViewSecurityState) allowsTopLevelNavigation(rawURL string) bool {
	if s.mode == desktopBootstrapPage {
		return isDesktopBootstrapDocumentURL(rawURL)
	}
	return s.policy != nil && s.policy.DecideNavigation(rawURL, true, false) == desktopNavigationAllow
}

func (s *desktopWebViewSecurityState) DecideNavigation(rawURL string, mainFrame bool, certificateError bool) desktopNavigationAction {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.mode == desktopBootstrapPage {
		if mainFrame && isDesktopBootstrapDocumentURL(rawURL) && !certificateError {
			return desktopNavigationAllow
		}
		return desktopNavigationBlock
	}
	if s.policy == nil {
		return desktopNavigationBlock
	}
	return s.policy.DecideNavigation(rawURL, mainFrame, certificateError)
}

func (s *desktopWebViewSecurityState) RejectTopLevelNavigation(epoch uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if epoch == s.epoch {
		s.committedEpoch = 0
	}
}

func (s *desktopWebViewSecurityState) Authorize(epoch uint64, mainFrame bool, action desktopBridgeAction) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if epoch == 0 || epoch != s.committedEpoch {
		return false
	}
	if s.mode == desktopBootstrapPage {
		return mainFrame && isDesktopBootstrapDocumentURL(s.committedURL) && desktopBootstrapActionAllowed(action)
	}
	return s.policy != nil && s.policy.AllowsBridge(s.mode, s.committedURL, mainFrame, action)
}

func (s *desktopWebViewSecurityState) SetTrustedLocalDevPage() error {
	policy, err := newDesktopLocalDevWebViewPolicy()
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.policy = policy
	s.mode = desktopTrustedLocalDevPage
	s.epoch++
	s.committedEpoch = 0
	s.committedURL = ""
	return nil
}

func desktopBootstrapActionAllowed(action desktopBridgeAction) bool {
	switch action {
	case desktopBridgeGetState,
		desktopBridgeSaveBaseURL,
		desktopBridgeRetry,
		desktopBridgeReset,
		desktopBridgeGetDeviceName,
		desktopBridgeStartDrag,
		desktopBridgeMinimize,
		desktopBridgeToggleMaximize,
		desktopBridgeClose:
		return true
	default:
		return false
	}
}

func (s *desktopWebViewSecurityState) AuthorizeCurrent(action desktopBridgeAction) bool {
	s.mu.RLock()
	epoch := s.committedEpoch
	s.mu.RUnlock()
	return s.Authorize(epoch, true, action)
}

func (s *desktopWebViewSecurityState) SetTrustedBaseURL(baseURL string) error {
	policy, err := newDesktopWebViewPolicy(baseURL)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.policy = policy
	s.mode = desktopTrustedRemotePage
	s.epoch++
	s.committedEpoch = 0
	s.committedURL = ""
	return nil
}

func (s *desktopWebViewSecurityState) ClearAuthorization() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.epoch++
	s.committedEpoch = 0
	s.committedURL = ""
	s.mode = desktopBootstrapPage
}

func (s *desktopWebViewSecurityState) ShowBootstrap() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mode = desktopBootstrapPage
	s.policy = nil
	s.committedURL = "about:blank"
}

type desktopSessionLogout interface {
	Logout(ctx context.Context, baseURL string) error
}

type desktopSiteDataProfile interface {
	ClearSiteData(ctx context.Context, baseURL string) error
}

type desktopSwitchState interface {
	ClearAuthorization()
	ShowBootstrap()
}

func switchDesktopServer(
	ctx context.Context,
	oldBaseURL string,
	logout desktopSessionLogout,
	profile desktopSiteDataProfile,
	store desktopConfigStore,
	state desktopSwitchState,
) error {
	_ = logout.Logout(ctx, oldBaseURL)
	var switchErrors []error
	if err := profile.ClearSiteData(ctx, oldBaseURL); err != nil {
		switchErrors = append(switchErrors, err)
	}
	state.ClearAuthorization()
	if err := store.Save(desktopConfig{}); err != nil {
		switchErrors = append(switchErrors, err)
	}
	state.ShowBootstrap()
	return errors.Join(switchErrors...)
}
