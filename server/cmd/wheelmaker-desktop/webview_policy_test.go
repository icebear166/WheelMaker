package main

import (
	"context"
	"encoding/base64"
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
	bootstrapDocumentURL := "data:text/html;charset=utf-8;base64," + base64.StdEncoding.EncodeToString([]byte(desktopBootstrapHTML))

	tests := []struct {
		name      string
		mode      desktopPageMode
		url       string
		mainFrame bool
		action    desktopBridgeAction
		want      bool
	}{
		{name: "bootstrap get state", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeGetState, want: true},
		{name: "embedded bootstrap get state", mode: desktopBootstrapPage, url: bootstrapDocumentURL, mainFrame: true, action: desktopBridgeGetState, want: true},
		{name: "bootstrap save", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeSaveBaseURL, want: true},
		{name: "bootstrap retry", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeRetry, want: true},
		{name: "bootstrap reset", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeReset, want: true},
		{name: "bootstrap device name", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeGetDeviceName, want: true},
		{name: "bootstrap start drag", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeStartDrag, want: true},
		{name: "bootstrap minimize", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeMinimize, want: true},
		{name: "bootstrap maximize", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeToggleMaximize, want: true},
		{name: "bootstrap close", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeClose, want: true},
		{name: "bootstrap cannot change server", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeRequestServerChange},
		{name: "bootstrap cannot open project file in VS Code", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeOpenProjectFileInVSCode},
		{name: "bootstrap cannot show project file in folder", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeShowProjectFileInFolder},
		{name: "bootstrap cannot open absolute file in VS Code", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeOpenFileInVSCode},
		{name: "bootstrap cannot show absolute file in folder", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeShowFileInFolder},
		{name: "bootstrap cannot copy absolute file", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeCopyFileToClipboard},
		{name: "bootstrap cannot write HTML clipboard file", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeBeginHTMLFileClipboard},
		{name: "bootstrap cannot read Desktop update info", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeGetUpdateInfo},
		{name: "bootstrap cannot request Desktop update", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeRequestUpdate},
		{name: "remote window control", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeClose, want: true},
		{name: "remote server change", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeRequestServerChange, want: true},
		{name: "remote device name", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeGetDeviceName, want: true},
		{name: "remote Desktop update info", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeGetUpdateInfo, want: true},
		{name: "remote Desktop update request", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeRequestUpdate, want: true},
		{name: "old origin cannot request Desktop update", mode: desktopTrustedRemotePage, url: "https://old.example.com/wheelmaker/", mainFrame: true, action: desktopBridgeRequestUpdate},
		{name: "iframe cannot request Desktop update", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeRequestUpdate},
		{name: "remote open project file in VS Code", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeOpenProjectFileInVSCode, want: true},
		{name: "remote show project file in folder", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeShowProjectFileInFolder, want: true},
		{name: "remote open absolute file in VS Code", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeOpenFileInVSCode, want: true},
		{name: "remote show absolute file in folder", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeShowFileInFolder, want: true},
		{name: "remote copies absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeCopyFileToClipboard, want: true},
		{name: "remote begins HTML clipboard file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeBeginHTMLFileClipboard, want: true},
		{name: "old origin cannot open project file in VS Code", mode: desktopTrustedRemotePage, url: "https://old.example.com/wheelmaker/", mainFrame: true, action: desktopBridgeOpenProjectFileInVSCode},
		{name: "old origin cannot show project file in folder", mode: desktopTrustedRemotePage, url: "https://old.example.com/wheelmaker/", mainFrame: true, action: desktopBridgeShowProjectFileInFolder},
		{name: "outside base path cannot open project file in VS Code", mode: desktopTrustedRemotePage, url: "https://example.com/admin/", mainFrame: true, action: desktopBridgeOpenProjectFileInVSCode},
		{name: "outside base path cannot show project file in folder", mode: desktopTrustedRemotePage, url: "https://example.com/admin/", mainFrame: true, action: desktopBridgeShowProjectFileInFolder},
		{name: "outside base path cannot open absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/admin/", mainFrame: true, action: desktopBridgeOpenFileInVSCode},
		{name: "outside base path cannot copy absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/admin/", mainFrame: true, action: desktopBridgeCopyFileToClipboard},
		{name: "wrong origin cannot show absolute file", mode: desktopTrustedRemotePage, url: "https://old.example.com/wheelmaker/", mainFrame: true, action: desktopBridgeShowFileInFolder},
		{name: "iframe cannot open project file in VS Code", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeOpenProjectFileInVSCode},
		{name: "iframe cannot show project file in folder", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeShowProjectFileInFolder},
		{name: "iframe cannot open absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeOpenFileInVSCode},
		{name: "iframe cannot show absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeShowFileInFolder},
		{name: "iframe cannot copy absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeCopyFileToClipboard},
		{name: "iframe cannot write HTML clipboard file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeCommitHTMLFileClipboard},
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

func TestTrustedPageAllowsDeepSeekLoginBridge(t *testing.T) {
	policy, err := newDesktopWebViewPolicy("https://release.wheelmaker.top/")
	if err != nil {
		t.Fatal(err)
	}
	if !policy.AllowsBridge(desktopTrustedRemotePage, "https://release.wheelmaker.top/", true, desktopBridgeDeepSeekLogin) {
		t.Fatal("deepseek login bridge must be allowed on trusted pages")
	}
	if policy.AllowsBridge(desktopBootstrapPage, desktopBootstrapDocumentURL(), true, desktopBridgeDeepSeekLogin) {
		t.Fatal("deepseek login bridge must not be allowed on the bootstrap page")
	}
}

func TestDesktopLocalDevPolicyAcceptsOnlyExactLoopbackOrigin(t *testing.T) {
	policy, err := newDesktopLocalDevWebViewPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if !policy.contains("http://127.0.0.1:4173/") {
		t.Fatal("local Dev policy rejected its origin")
	}
	if !policy.contains("http://127.0.0.1:4173/projects") {
		t.Fatal("local Dev policy rejected a child path")
	}
	for _, raw := range []string{
		"http://localhost:8080/",
		"http://127.0.0.1:8081/",
		"http://192.0.2.1:8080/",
		"https://127.0.0.1:4173/",
	} {
		if policy.contains(raw) {
			t.Fatalf("local Dev policy accepted %q", raw)
		}
	}
}

func TestDesktopLocalDevPageOnlyAuthorizesWindowControls(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("", desktopTrustedLocalDevPage)
	if err != nil {
		t.Fatal(err)
	}
	epoch := state.BeginTopLevelNavigation("http://127.0.0.1:4173/")
	state.CommitTopLevelNavigation(epoch, "http://127.0.0.1:4173/")
	if !state.Authorize(epoch, true, desktopBridgeMinimize) {
		t.Fatal("local Dev page did not authorize minimize")
	}
	if state.Authorize(epoch, true, desktopBridgeOpenProjectFileInVSCode) {
		t.Fatal("local Dev page authorized a remote file action")
	}
	if state.Authorize(epoch, true, desktopBridgeOpenFileInVSCode) ||
		state.Authorize(epoch, true, desktopBridgeShowFileInFolder) {
		t.Fatal("local Dev page authorized an absolute file action")
	}
	if state.Authorize(epoch, true, desktopBridgeGetUpdateInfo) || state.Authorize(epoch, true, desktopBridgeRequestUpdate) {
		t.Fatal("local Dev page authorized Desktop self-update")
	}
	if !state.Authorize(epoch, true, desktopBridgeGetLocalDevState) {
		t.Fatal("local Dev page did not authorize its state action")
	}
}

func TestDesktopRemotePageCannotRunLocalDevOperations(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("https://example.com/", desktopTrustedRemotePage)
	if err != nil {
		t.Fatal(err)
	}
	epoch := state.BeginTopLevelNavigation("https://example.com/")
	state.CommitTopLevelNavigation(epoch, "https://example.com/")
	if state.Authorize(epoch, true, desktopBridgeRunLocalDevOperation) {
		t.Fatal("remote page authorized a Local Dev operation")
	}
}

func TestDesktopRuntimeEntersOnlyTheFixedLocalDevOrigin(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("https://example.com/", desktopTrustedRemotePage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntime(
		&memoryDesktopConfigStore{config: desktopConfig{BaseURL: "https://example.com/"}},
		&recordingDesktopProber{},
		desktopConfig{BaseURL: "https://example.com/"},
		desktopBootstrapState{},
		state,
	)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)
	if err := runtime.EnterLocalDev(); err != nil {
		t.Fatal(err)
	}
	if surface.navigatedURL != "http://127.0.0.1:4173/" {
		t.Fatalf("Navigate() = %q", surface.navigatedURL)
	}
	if state.DecideNavigation("https://example.com/", true, false) != desktopNavigationOpenExternal {
		t.Fatal("Dev mode retained the remote HTTPS policy")
	}
}

func TestDesktopRuntimeExitsLocalDevToConfiguredServer(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("https://example.com/app/", desktopTrustedRemotePage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntime(
		&memoryDesktopConfigStore{},
		&recordingDesktopProber{},
		desktopConfig{BaseURL: "https://example.com/app/"},
		desktopBootstrapState{},
		state,
	)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)
	if err := runtime.EnterLocalDev(); err != nil {
		t.Fatal(err)
	}
	if err := runtime.ExitLocalDev(); err != nil {
		t.Fatal(err)
	}
	if surface.navigatedURL != "https://example.com/app/" {
		t.Fatalf("navigated URL=%q", surface.navigatedURL)
	}
	if runtime.security.Mode() != desktopTrustedRemotePage {
		t.Fatalf("mode=%v, want trusted remote", runtime.security.Mode())
	}
}

func TestDesktopFileActionsRequireCommittedTrustedNavigation(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("https://example.com/wheelmaker/", desktopTrustedRemotePage)
	if err != nil {
		t.Fatal(err)
	}
	actions := []desktopBridgeAction{
		desktopBridgeOpenProjectFileInVSCode,
		desktopBridgeShowProjectFileInFolder,
		desktopBridgeCopyFileToClipboard,
		desktopBridgeGetUpdateInfo,
		desktopBridgeRequestUpdate,
	}

	epoch := state.BeginTopLevelNavigation("https://example.com/wheelmaker/projects")
	for _, action := range actions {
		if state.Authorize(epoch, true, action) {
			t.Fatalf("Authorize(%v) allowed an uncommitted trusted navigation", action)
		}
		if state.AuthorizeCurrent(action) {
			t.Fatalf("AuthorizeCurrent(%v) allowed an uncommitted trusted navigation", action)
		}
	}

	state.CommitTopLevelNavigation(epoch, "https://example.com/wheelmaker/projects")
	for _, action := range actions {
		if !state.Authorize(epoch, true, action) {
			t.Fatalf("Authorize(%v) denied a committed trusted navigation", action)
		}
		if !state.AuthorizeCurrent(action) {
			t.Fatalf("AuthorizeCurrent(%v) denied a committed trusted navigation", action)
		}
	}
}

func TestDesktopEmbeddedBootstrapDocumentNavigationAndBridge(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("", desktopBootstrapPage)
	if err != nil {
		t.Fatal(err)
	}
	bootstrapURL := desktopBootstrapDocumentURL()
	if got := state.DecideNavigation(bootstrapURL, true, false); got != desktopNavigationAllow {
		t.Fatalf("DecideNavigation()=%v, want embedded bootstrap page allowed", got)
	}
	epoch := state.BeginTopLevelNavigation(bootstrapURL)
	state.CommitTopLevelNavigation(epoch, bootstrapURL)
	if !state.Authorize(epoch, true, desktopBridgeGetState) {
		t.Fatal("embedded bootstrap page was not authorized for bootstrap bridge")
	}
	if got := state.DecideNavigation("data:text/html,evil", true, false); got != desktopNavigationBlock {
		t.Fatalf("DecideNavigation()=%v, want arbitrary data URL blocked", got)
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
		{name: "same base preview iframe", url: "https://example.com/wheelmaker/ws/preview/", want: desktopNavigationAllow},
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

func TestDesktopDownloadNavigationUsesTrustedRegistryPolicy(t *testing.T) {
	policy, err := newDesktopWebViewPolicy("https://example.com/wheelmaker/")
	if err != nil {
		t.Fatal(err)
	}
	token := "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"
	if got := policy.DecideNavigation("https://example.com/wheelmaker/download/"+token, true, false); got != desktopNavigationAllow {
		t.Fatalf("trusted download navigation=%v, want allow", got)
	}
	for _, rawURL := range []string{
		"http://example.com/wheelmaker/download/" + token,
		"javascript:location.href='https://example.com/wheelmaker/download/" + token + "'",
	} {
		if got := policy.DecideNavigation(rawURL, true, false); got != desktopNavigationBlock {
			t.Fatalf("untrusted download navigation %q=%v, want block", rawURL, got)
		}
	}
	if got := policy.DecideNavigation("https://evil.example/wheelmaker/download/"+token, true, false); got != desktopNavigationOpenExternal {
		t.Fatalf("cross-origin download navigation=%v, want external", got)
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
