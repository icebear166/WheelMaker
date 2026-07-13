package main

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type recordingDesktopRuntimeSurface struct {
	navigatedURL string
	bootstrap    string
}

func (s *recordingDesktopRuntimeSurface) Navigate(baseURL string) { s.navigatedURL = baseURL }
func (s *recordingDesktopRuntimeSurface) ShowBootstrapHTML(html string) {
	s.bootstrap = html
}
func (*recordingDesktopRuntimeSurface) Logout(context.Context, string) error        { return nil }
func (*recordingDesktopRuntimeSurface) ClearSiteData(context.Context, string) error { return nil }

func TestDesktopBridgeAuthorization(t *testing.T) {
	policy, err := newDesktopWebViewPolicy("https://example.com/wheelmaker/")
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name      string
		mode      desktopPageMode
		url       string
		mainFrame bool
		action    desktopBridgeAction
		want      bool
	}{
		{name: "bootstrap get state", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeGetState, want: true},
		{name: "bootstrap save", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeSaveBaseURL, want: true},
		{name: "bootstrap retry", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeRetry, want: true},
		{name: "bootstrap reset", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeReset, want: true},
		{name: "bootstrap cannot control window", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeClose},
		{name: "remote window control", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeClose, want: true},
		{name: "remote server change", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeRequestServerChange, want: true},
		{name: "remote cannot save bootstrap URL", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeSaveBaseURL},
		{name: "old origin", mode: desktopTrustedRemotePage, url: "https://old.example.com/wheelmaker/", mainFrame: true, action: desktopBridgeClose},
		{name: "same origin outside base path", mode: desktopTrustedRemotePage, url: "https://example.com/admin/", mainFrame: true, action: desktopBridgeClose},
		{name: "same origin prefix confusion", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker-evil/", mainFrame: true, action: desktopBridgeClose},
		{name: "iframe", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeClose},
		{name: "javascript URL", mode: desktopTrustedRemotePage, url: "javascript:alert(1)", mainFrame: true, action: desktopBridgeClose},
		{name: "data URL", mode: desktopTrustedRemotePage, url: "data:text/html,evil", mainFrame: true, action: desktopBridgeClose},
		{name: "file URL", mode: desktopTrustedRemotePage, url: "file:///tmp/evil", mainFrame: true, action: desktopBridgeClose},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := policy.AllowsBridge(tt.mode, tt.url, tt.mainFrame, tt.action); got != tt.want {
				t.Fatalf("AllowsBridge()=%v, want %v", got, tt.want)
			}
		})
	}
}

func TestDesktopNavigationPolicy(t *testing.T) {
	policy, err := newDesktopWebViewPolicy("https://example.com/wheelmaker/")
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name             string
		url              string
		mainFrame        bool
		certificateError bool
		want             desktopNavigationAction
	}{
		{name: "base", url: "https://example.com/wheelmaker/", mainFrame: true, want: desktopNavigationAllow},
		{name: "base child", url: "https://example.com/wheelmaker/projects/1", mainFrame: true, want: desktopNavigationAllow},
		{name: "trusted iframe", url: "https://example.com/wheelmaker/embed", want: desktopNavigationAllow},
		{name: "external origin", url: "https://docs.example.net/help", mainFrame: true, want: desktopNavigationOpenExternal},
		{name: "same origin outside base", url: "https://example.com/admin/", mainFrame: true, want: desktopNavigationOpenExternal},
		{name: "untrusted iframe", url: "https://docs.example.net/help", want: desktopNavigationBlock},
		{name: "http", url: "http://example.com/wheelmaker/", mainFrame: true, want: desktopNavigationBlock},
		{name: "javascript", url: "javascript:alert(1)", mainFrame: true, want: desktopNavigationBlock},
		{name: "data", url: "data:text/html,evil", mainFrame: true, want: desktopNavigationBlock},
		{name: "file", url: "file:///tmp/evil", mainFrame: true, want: desktopNavigationBlock},
		{name: "certificate error", url: "https://example.com/wheelmaker/", mainFrame: true, certificateError: true, want: desktopNavigationBlock},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := policy.DecideNavigation(tt.url, tt.mainFrame, tt.certificateError); got != tt.want {
				t.Fatalf("DecideNavigation()=%v, want %v", got, tt.want)
			}
		})
	}
}

func TestDesktopBridgeNavigationEpoch(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("https://example.com/wheelmaker/", desktopTrustedRemotePage)
	if err != nil {
		t.Fatal(err)
	}
	epoch := state.BeginTopLevelNavigation("https://example.com/wheelmaker/projects")
	state.CommitTopLevelNavigation(epoch, "https://example.com/wheelmaker/projects")
	if !state.Authorize(epoch, true, desktopBridgeClose) {
		t.Fatal("current committed epoch should be authorized")
	}
	if state.Authorize(epoch-1, true, desktopBridgeClose) {
		t.Fatal("stale navigation epoch was authorized")
	}
	next := state.BeginTopLevelNavigation("https://old.example.com/wheelmaker/")
	if state.Authorize(next, true, desktopBridgeClose) {
		t.Fatal("uncommitted navigation epoch was authorized")
	}
	state.RejectTopLevelNavigation(next)
	if state.Authorize(next, true, desktopBridgeClose) {
		t.Fatal("rejected navigation epoch was authorized")
	}
}

func TestDesktopBootstrapRuntimeSavesBeforeRemoteNavigation(t *testing.T) {
	store := &memoryDesktopConfigStore{}
	prober := &recordingDesktopProber{}
	security, err := newDesktopWebViewSecurityState("", desktopBootstrapPage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntime(store, prober, desktopConfig{}, desktopBootstrapState{}, security)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)

	result := runtime.SaveBaseURL(context.Background(), "https://example.com/app")
	if !result.OK || result.BaseURL != "https://example.com/app/" {
		t.Fatalf("result=%+v", result)
	}
	if prober.url != result.BaseURL || store.config.BaseURL != result.BaseURL || surface.navigatedURL != result.BaseURL {
		t.Fatalf("probe=%q store=%q navigation=%q", prober.url, store.config.BaseURL, surface.navigatedURL)
	}
}

func TestDesktopRemoteNavigationFailureReturnsToBootstrap(t *testing.T) {
	store := &memoryDesktopConfigStore{config: desktopConfig{BaseURL: "https://example.com/app/"}}
	security, err := newDesktopWebViewSecurityState(store.config.BaseURL, desktopTrustedRemotePage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntime(store, &recordingDesktopProber{}, store.config, desktopBootstrapState{BaseURL: store.config.BaseURL}, security)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)

	runtime.HandleNavigationFailure("The secure connection failed.")
	state := runtime.GetState()
	if state.BaseURL != store.config.BaseURL || state.Error != "The secure connection failed." {
		t.Fatalf("state=%+v", state)
	}
	if surface.bootstrap != desktopBootstrapHTML {
		t.Fatal("Bootstrap was not shown after remote navigation failure")
	}
	if security.AuthorizeCurrent(desktopBridgeClose) {
		t.Fatal("remote Bridge remained authorized after navigation failure")
	}
}

type recordingDesktopSwitchDependency struct {
	events    *[]string
	logoutErr error
}

func (d recordingDesktopSwitchDependency) Logout(context.Context, string) error {
	*d.events = append(*d.events, "logout")
	return d.logoutErr
}

func (d recordingDesktopSwitchDependency) ClearSiteData(context.Context, string) error {
	*d.events = append(*d.events, "clear-site-data")
	return nil
}

type recordingDesktopSwitchState struct {
	events *[]string
}

func (s recordingDesktopSwitchState) ClearAuthorization() {
	*s.events = append(*s.events, "clear-authorization")
}

func (s recordingDesktopSwitchState) ShowBootstrap() {
	*s.events = append(*s.events, "show-bootstrap")
}

type recordingDesktopSwitchStore struct {
	events *[]string
}

func (s recordingDesktopSwitchStore) Load() (desktopConfig, error) { return desktopConfig{}, nil }
func (s recordingDesktopSwitchStore) Save(config desktopConfig) error {
	if config != (desktopConfig{}) {
		return errors.New("expected empty config")
	}
	*s.events = append(*s.events, "clear-config")
	return nil
}

func TestDesktopServerSwitchClearsSiteDataAfterBestEffortLogout(t *testing.T) {
	for _, logoutErr := range []error{nil, errors.New("server unavailable")} {
		t.Run(func() string {
			if logoutErr == nil {
				return "logout succeeds"
			}
			return "logout fails"
		}(), func(t *testing.T) {
			var events []string
			dependency := recordingDesktopSwitchDependency{events: &events, logoutErr: logoutErr}
			state := recordingDesktopSwitchState{events: &events}
			store := recordingDesktopSwitchStore{events: &events}
			if err := switchDesktopServer(context.Background(), "https://example.com/wheelmaker/", dependency, dependency, store, state); err != nil {
				t.Fatalf("switchDesktopServer: %v", err)
			}
			want := []string{"logout", "clear-site-data", "clear-authorization", "clear-config", "show-bootstrap"}
			if !reflect.DeepEqual(events, want) {
				t.Fatalf("events=%v, want %v", events, want)
			}
		})
	}
}
