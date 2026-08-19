//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
	"unsafe"

	"github.com/gorilla/websocket"
	"github.com/swm8023/wheelmaker/internal/registry"
	"golang.org/x/sys/windows"
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
		{name: "bootstrap cannot show notification", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeShowNotification},
		{name: "remote window control", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeClose, want: true},
		{name: "remote server change", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeRequestServerChange, want: true},
		{name: "remote device name", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeGetDeviceName, want: true},
		{name: "remote Desktop update info", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeGetUpdateInfo, want: true},
		{name: "remote Desktop update request", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: true, action: desktopBridgeRequestUpdate, want: true},
		{name: "remote shows notification", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeShowNotification, want: true},
		{name: "old origin cannot show notification", mode: desktopTrustedRemotePage, url: "https://old.example.com/wheelmaker/", mainFrame: true, action: desktopBridgeShowNotification},
		{name: "iframe cannot show notification", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeShowNotification},
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

func TestNotificationBridgeAllowedOnLocalhostAndLocalDevPages(t *testing.T) {
	localhostURL := fixedDesktopLocalhostTestURL()
	localhostPolicy, err := newDesktopLocalhostWebViewPolicy(localhostURL)
	if err != nil {
		t.Fatal(err)
	}
	if !localhostPolicy.AllowsBridge(desktopTrustedLocalhostPage, localhostURL, true, desktopBridgeShowNotification) {
		t.Fatal("notification bridge must be allowed on the trusted localhost page")
	}
	localDevPolicy, err := newDesktopLocalDevWebViewPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if !localDevPolicy.AllowsBridge(desktopTrustedLocalDevPage, desktopLocalDevURL, true, desktopBridgeShowNotification) {
		t.Fatal("notification bridge must be allowed on the local dev page")
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

func TestDesktopLocalhostPolicyAcceptsOnlyExactBasePath(t *testing.T) {
	baseURL := fixedDesktopLocalhostTestURL()
	basePath := "/wm-local-" + strings.Repeat("A", 43) + "/"
	policy, err := newDesktopLocalhostWebViewPolicy(baseURL)
	if err != nil {
		t.Fatal(err)
	}

	for _, rawURL := range []string{
		baseURL,
		baseURL + "projects/1",
		baseURL + "ws/preview/session/index.html",
		baseURL + "ws/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
	} {
		if !policy.contains(rawURL) {
			t.Errorf("Localhost policy rejected trusted URL %q", rawURL)
		}
	}

	for _, rawURL := range []string{
		desktopLocalhostOrigin + "/",
		desktopLocalhostOrigin + strings.TrimSuffix(basePath, "/"),
		desktopLocalhostOrigin + "/wm-local-" + strings.Repeat("B", 43) + "/",
		desktopLocalhostOrigin + strings.TrimSuffix(basePath, "/") + "-evil/",
		"http://localhost:9633" + basePath,
		"http://127.0.0.1:9634" + basePath,
		"https://127.0.0.1:9633" + basePath,
		baseURL + "?source=untrusted",
		baseURL + "#untrusted",
		"http://user@127.0.0.1:9633" + basePath,
		baseURL + "%2e%2e/admin/",
		baseURL + "projects%2f..%2fadmin/",
		baseURL + "projects/../admin/",
		"javascript:alert(1)",
		"data:text/html,evil",
		"file:///tmp/evil",
	} {
		if policy.contains(rawURL) {
			t.Errorf("Localhost policy accepted untrusted URL %q", rawURL)
		}
	}

	if got := policy.DecideNavigation(baseURL, true, false); got != desktopNavigationAllow {
		t.Fatalf("trusted Localhost navigation=%v, want allow", got)
	}
	if got := policy.DecideNavigation("https://docs.example.net/help", true, false); got != desktopNavigationOpenExternal {
		t.Fatalf("external HTTPS navigation=%v, want external", got)
	}
	if got := policy.DecideNavigation("https://docs.example.net/help", false, false); got != desktopNavigationBlock {
		t.Fatalf("external HTTPS iframe navigation=%v, want block", got)
	}
	if got := policy.DecideNavigation(baseURL, true, true); got != desktopNavigationBlock {
		t.Fatalf("certificate-error navigation=%v, want block", got)
	}
}

func TestDesktopLocalhostPageRequiresCommittedTopLevelNavigation(t *testing.T) {
	baseURL := fixedDesktopLocalhostTestURL()
	state, err := newDesktopWebViewSecurityState(baseURL, desktopTrustedLocalhostPage)
	if err != nil {
		t.Fatal(err)
	}
	productionActions := []desktopBridgeAction{
		desktopBridgeGetDeviceName,
		desktopBridgeRequestServerChange,
		desktopBridgeOpenProjectFileInVSCode,
		desktopBridgeCopyFileToClipboard,
		desktopBridgeBeginHTMLFileClipboard,
		desktopBridgeGetUpdateInfo,
		desktopBridgeRequestUpdate,
		desktopBridgeDeepSeekLogin,
	}

	epoch := state.BeginTopLevelNavigation(baseURL + "projects")
	for _, action := range productionActions {
		if state.Authorize(epoch, true, action) || state.AuthorizeCurrent(action) {
			t.Fatalf("uncommitted Localhost navigation authorized action %v", action)
		}
	}
	state.CommitTopLevelNavigation(epoch, baseURL+"projects")
	for _, action := range productionActions {
		if !state.Authorize(epoch, true, action) || !state.AuthorizeCurrent(action) {
			t.Fatalf("committed Localhost navigation denied production action %v", action)
		}
		if state.Authorize(epoch, false, action) {
			t.Fatalf("Localhost iframe authorized action %v", action)
		}
	}
	for _, action := range []desktopBridgeAction{
		desktopBridgeGetState,
		desktopBridgeSaveBaseURL,
		desktopBridgeSelectLocalhost,
		desktopBridgeGetLocalDevState,
		desktopBridgeSaveLocalDevSource,
		desktopBridgeRunLocalDevOperation,
	} {
		if state.Authorize(epoch, true, action) {
			t.Fatalf("Localhost page authorized non-production action %v", action)
		}
	}

	next := state.BeginTopLevelNavigation(baseURL + "next")
	if state.Authorize(epoch, true, desktopBridgeClose) || state.Authorize(next, true, desktopBridgeClose) {
		t.Fatal("stale or uncommitted Localhost navigation retained bridge authorization")
	}
	state.RejectTopLevelNavigation(next)
	if state.Authorize(next, true, desktopBridgeClose) {
		t.Fatal("rejected Localhost navigation retained bridge authorization")
	}

	wrong := state.BeginTopLevelNavigation(desktopLocalhostOrigin + "/")
	state.CommitTopLevelNavigation(wrong, desktopLocalhostOrigin+"/")
	if state.Authorize(wrong, true, desktopBridgeClose) {
		t.Fatal("wrong Localhost path received bridge authorization")
	}
}

func TestDesktopLocalhostNavigationFailureMessage(t *testing.T) {
	state, err := newDesktopWebViewSecurityState(fixedDesktopLocalhostTestURL(), desktopTrustedLocalhostPage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntimeWithOptions(
		&memoryDesktopConfigStore{},
		&recordingDesktopProber{},
		desktopConfig{ConnectionMode: desktopConnectionLocalhost},
		desktopBootstrapState{ConnectionMode: desktopConnectionLocalhost},
		state,
		desktopRuntimeOptions{LocalhostURL: fixedDesktopLocalhostTestURL()},
	)
	if got := runtime.NavigationFailureMessage(); got != "The Localhost navigation failed. Retry or change the connection." {
		t.Fatalf("NavigationFailureMessage()=%q", got)
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
		&memoryDesktopConfigStore{config: desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/"}},
		&recordingDesktopProber{},
		desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/"},
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
		desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/app/"},
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
	if prober.url != result.BaseURL || store.config != (desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: result.BaseURL}) || surface.navigatedURL != result.BaseURL {
		t.Fatalf("probe=%q store=%+v navigation=%q", prober.url, store.config, surface.navigatedURL)
	}
}

func TestDesktopRemoteNavigationFailureReturnsToBootstrap(t *testing.T) {
	store := &memoryDesktopConfigStore{config: desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/app/"}}
	security, err := newDesktopWebViewSecurityState(store.config.BaseURL, desktopTrustedRemotePage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntime(store, &recordingDesktopProber{}, store.config, desktopBootstrapState{ConnectionMode: desktopConnectionGateway, BaseURL: store.config.BaseURL}, security)
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

func TestDesktopLocalhostStatePersistsPrivateBasePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".wheelmaker", "desktop", "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)

	first, err := store.LoadOrCreate()
	if err != nil {
		t.Fatalf("LoadOrCreate first: %v", err)
	}
	if !validDesktopLocalhostBasePath(first.BasePath) {
		t.Fatalf("generated Base Path is invalid: %q", first.BasePath)
	}
	if first.SessionCookie != "" || !first.SessionExpiresAt.IsZero() {
		t.Fatalf("new state unexpectedly has a session: %+v", first)
	}

	restarted, err := newFileDesktopLocalhostStateStore(path).LoadOrCreate()
	if err != nil {
		t.Fatalf("LoadOrCreate restart: %v", err)
	}
	if restarted.BasePath != first.BasePath {
		t.Fatalf("restart Base Path=%q, want %q", restarted.BasePath, first.BasePath)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("state mode=%#o, want 0600", info.Mode().Perm())
		}
	}
}

func TestDesktopLocalhostCredentialLifecycle(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "desktop", "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{
		Name:     desktopRegistrySessionCookieName,
		Value:    strings.Repeat("A", 43),
		Path:     state.BasePath,
		Expires:  now.Add(24 * time.Hour),
		MaxAge:   int((24 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	}
	if err := store.SaveSession(cookie); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	restored, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if restored.BasePath != state.BasePath || restored.SessionCookie != cookie.Value || !restored.SessionExpiresAt.Equal(cookie.Expires) {
		t.Fatalf("restored state=%+v", restored)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"registry-token", "csrf-secret", desktopRegistrySessionCookieName} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("state file contains forbidden value %q", forbidden)
		}
	}

	if err := store.ClearSession(); err != nil {
		t.Fatalf("ClearSession: %v", err)
	}
	cleared, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if cleared.BasePath != state.BasePath || cleared.SessionCookie != "" || !cleared.SessionExpiresAt.IsZero() {
		t.Fatalf("cleared state=%+v", cleared)
	}

	if err := store.Delete(); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("state file still exists: %v", err)
	}
}

func TestDesktopLocalhostStateDropsExpiredSession(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSession(&http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("B", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)

	restored, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if restored.BasePath != state.BasePath || restored.SessionCookie != "" || !restored.SessionExpiresAt.IsZero() {
		t.Fatalf("expired session did not fail closed: %+v", restored)
	}
}

func TestDesktopLocalhostStateRejectsCorruptFiles(t *testing.T) {
	validBasePath := "/wm-local-" + strings.Repeat("A", 43) + "/"
	tests := []struct {
		name string
		raw  string
	}{
		{name: "malformed JSON", raw: "{"},
		{name: "unknown field", raw: `{"version":1,"basePath":"` + validBasePath + `","extra":true}`},
		{name: "wrong version", raw: `{"version":2,"basePath":"` + validBasePath + `"}`},
		{name: "unsafe Base Path", raw: `{"version":1,"basePath":"/../secret/"}`},
		{name: "partial session", raw: `{"version":1,"basePath":"` + validBasePath + `","sessionCookie":"` + strings.Repeat("A", 43) + `"}`},
		{name: "oversized", raw: strings.Repeat("x", desktopLocalhostStateMaxBytes+1)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "localhost-state.json")
			if err := os.WriteFile(path, []byte(tt.raw), 0o600); err != nil {
				t.Fatal(err)
			}
			if state, err := newFileDesktopLocalhostStateStore(path).LoadOrCreate(); err == nil {
				t.Fatalf("LoadOrCreate=%+v, want corrupt state rejection", state)
			}
		})
	}
}

func TestDesktopLocalhostCredentialRejectsInvalidCookies(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	valid := http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("C", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}
	tests := []struct {
		name   string
		mutate func(*http.Cookie)
	}{
		{name: "wrong name", mutate: func(cookie *http.Cookie) { cookie.Name = "other" }},
		{name: "wrong path", mutate: func(cookie *http.Cookie) { cookie.Path = "/" }},
		{name: "not secure", mutate: func(cookie *http.Cookie) { cookie.Secure = false }},
		{name: "not HTTP only", mutate: func(cookie *http.Cookie) { cookie.HttpOnly = false }},
		{name: "wrong SameSite", mutate: func(cookie *http.Cookie) { cookie.SameSite = http.SameSiteLaxMode }},
		{name: "deleted", mutate: func(cookie *http.Cookie) { cookie.MaxAge = -1 }},
		{name: "expired", mutate: func(cookie *http.Cookie) { cookie.Expires = now }},
		{name: "invalid value", mutate: func(cookie *http.Cookie) { cookie.Value = "bad\nvalue" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cookie := valid
			tt.mutate(&cookie)
			if err := store.SaveSession(&cookie); err == nil {
				t.Fatal("SaveSession accepted an invalid Registry cookie")
			}
		})
	}
}

func TestDesktopLocalhostStableOriginUsesFixedLoopbackPort(t *testing.T) {
	basePath := "/wm-local-" + strings.Repeat("A", 43) + "/"
	want := "http://127.0.0.1:9633" + basePath
	if desktopLocalhostListenAddress != "127.0.0.1:9633" {
		t.Fatalf("listen address=%q, want fixed loopback", desktopLocalhostListenAddress)
	}
	if got := desktopLocalhostFixedURL(basePath); got != want {
		t.Fatalf("desktopLocalhostFixedURL=%q, want %q", got, want)
	}
	if got := desktopLocalhostFixedURL(basePath); got != want {
		t.Fatalf("second startup URL=%q, want stable %q", got, want)
	}
}

func TestDesktopLocalhostStaticEdgeRequiresSecretHostAndPath(t *testing.T) {
	webRoot := writeDesktopLocalhostWebRoot(t)
	edge, targetURL := startDesktopLocalhostTestEdge(t, webRoot)
	client := &http.Client{Timeout: 3 * time.Second}

	tests := []struct {
		name        string
		path        string
		host        string
		wantStatus  int
		wantBody    string
		contentType string
	}{
		{name: "entry", wantStatus: http.StatusOK, wantBody: "LOCALHOST_DOCUMENT", contentType: "text/html"},
		{name: "hashed asset", path: "bundle.abcdef12.js", wantStatus: http.StatusOK, wantBody: "LOCALHOST_ASSET", contentType: "text/javascript"},
		{name: "SPA route", path: "projects/one", wantStatus: http.StatusOK, wantBody: "LOCALHOST_DOCUMENT", contentType: "text/html"},
		{name: "directory listing", path: "assets/", wantStatus: http.StatusNotFound},
		{name: "wrong Host", host: "localhost", wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request, err := http.NewRequest(http.MethodGet, targetURL+tt.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if tt.host != "" {
				request.Host = tt.host
			}
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tt.wantStatus || (tt.wantBody != "" && !strings.Contains(string(body), tt.wantBody)) {
				t.Fatalf("status=%d body=%q, want status=%d body containing %q", response.StatusCode, body, tt.wantStatus, tt.wantBody)
			}
			if tt.contentType != "" && !strings.HasPrefix(response.Header.Get("Content-Type"), tt.contentType) {
				t.Fatalf("Content-Type=%q, want prefix %q", response.Header.Get("Content-Type"), tt.contentType)
			}
			if response.StatusCode == http.StatusOK {
				if response.Header.Get("X-Content-Type-Options") != "nosniff" || response.Header.Get("X-Frame-Options") != "DENY" || response.Header.Get("Referrer-Policy") != "no-referrer" {
					t.Fatalf("missing static security headers: %v", response.Header)
				}
			}
		})
	}

	parsedTarget, err := url.Parse(targetURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, rawURL := range []string{
		parsedTarget.Scheme + "://" + parsedTarget.Host + "/",
		parsedTarget.Scheme + "://" + parsedTarget.Host + "/wm-local-" + strings.Repeat("B", 43) + "/",
		targetURL + "%2e%2e/local-index.html",
		targetURL + "missing.js",
	} {
		response, err := client.Get(rawURL)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("GET %q status=%d, want 404", rawURL, response.StatusCode)
		}
	}

	if err := edge.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

func TestDesktopLocalhostStartupFailsClosed(t *testing.T) {
	t.Run("missing local document", func(t *testing.T) {
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: "127.0.0.1:0",
			RegistryURL:   unavailableDesktopLocalhostRegistryURL(t),
			WebRoot:       t.TempDir(),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			t.Fatalf("Start=%q, want missing local-index rejection", target)
		}
	})

	t.Run("occupied port", func(t *testing.T) {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: listener.Addr().String(),
			RegistryURL:   unavailableDesktopLocalhostRegistryURL(t),
			WebRoot:       writeDesktopLocalhostWebRoot(t),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			t.Fatalf("Start=%q, want occupied port rejection", target)
		}
	})
}

func TestDesktopLocalhostRegistrySessionLifecycle(t *testing.T) {
	const registryToken = "desktop-localhost-registry-token"
	registryServer := registry.New(registry.Config{Token: registryToken})
	upstream := httptest.NewServer(registryServer.Handler())
	defer upstream.Close()
	webRoot := writeDesktopLocalhostWebRoot(t)
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	edge, targetURL := startDesktopLocalhostEdgeWithRegistry(t, webRoot, upstream.URL, store)
	origin := strings.TrimSuffix(targetURL, mustDesktopLocalhostBasePath(t, store))
	authURL := targetURL + "ws"

	status := doDesktopLocalhostRequest(t, http.MethodGet, authURL+"?auth=status", origin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, false)

	loginBody := `{"token":"` + registryToken + `","deviceName":"Desktop Localhost"}`
	login := doDesktopLocalhostRequest(t, http.MethodPost, authURL+"?auth=login", origin, "", loginBody)
	if login.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(login.Body)
		login.Body.Close()
		t.Fatalf("login status=%d body=%q", login.StatusCode, body)
	}
	if cookies := login.Header.Values("Set-Cookie"); len(cookies) != 0 {
		login.Body.Close()
		t.Fatalf("WebView received Registry cookies: %v", cookies)
	}
	var loginPayload struct {
		Authenticated bool   `json:"authenticated"`
		CSRFToken     string `json:"csrfToken"`
	}
	if err := json.NewDecoder(login.Body).Decode(&loginPayload); err != nil {
		login.Body.Close()
		t.Fatal(err)
	}
	login.Body.Close()
	if !loginPayload.Authenticated || loginPayload.CSRFToken == "" {
		t.Fatalf("login payload=%+v", loginPayload)
	}
	persisted, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if !validDesktopLocalhostSessionValue(persisted.SessionCookie) || !persisted.SessionExpiresAt.After(time.Now()) {
		t.Fatalf("native session was not persisted: %+v", persisted)
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(registryToken)) || bytes.Contains(raw, []byte(loginPayload.CSRFToken)) {
		t.Fatal("Desktop state persisted Token or CSRF")
	}

	status = doDesktopLocalhostRequest(t, http.MethodGet, authURL+"?auth=status", origin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, true)
	connection, response, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(targetURL, "http")+"ws",
		http.Header{"Origin": []string{origin}},
	)
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		t.Fatalf("dial real Registry through Desktop edge: %v", err)
	}
	connection.Close()

	if err := edge.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, restartedURL := startDesktopLocalhostEdgeWithRegistry(t, webRoot, upstream.URL, store)
	restartedOrigin := strings.TrimSuffix(restartedURL, mustDesktopLocalhostBasePath(t, store))
	status = doDesktopLocalhostRequest(t, http.MethodGet, restartedURL+"ws?auth=status", restartedOrigin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, true)

	logout := doDesktopLocalhostRequest(t, http.MethodPost, restartedURL+"ws?auth=logout", restartedOrigin, loginPayload.CSRFToken, "")
	assertDesktopLocalhostAuthStatus(t, logout, false)
	cleared, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if cleared.SessionCookie != "" || !cleared.SessionExpiresAt.IsZero() {
		t.Fatalf("logout retained native session: %+v", cleared)
	}
	_ = restarted.Close()
}

func TestDesktopLocalhostRegistryUnauthenticatedStatusClearsPersistedSession(t *testing.T) {
	now := time.Now()
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSession(&http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("D", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"authenticated":false}`)
	}))
	defer upstream.Close()
	edge, targetURL := startDesktopLocalhostEdgeWithRegistry(t, writeDesktopLocalhostWebRoot(t), upstream.URL, store)
	origin := strings.TrimSuffix(targetURL, state.BasePath)
	status := doDesktopLocalhostRequest(t, http.MethodGet, targetURL+"ws?auth=status", origin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, false)
	cleared, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if cleared.SessionCookie != "" {
		t.Fatal("unauthenticated Registry status retained native session")
	}
	_ = edge.Close()
}

func TestDesktopLocalhostProxyPreservesWebSocketDownloadAndPreview(t *testing.T) {
	now := time.Now()
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	cookieValue := strings.Repeat("E", 43)
	if err := store.SaveSession(&http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: cookieValue, Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}); err != nil {
		t.Fatal(err)
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "" || r.Header.Get("Origin") == "" && r.URL.RawQuery == "" ||
			r.Header.Get("X-Forwarded-Proto") != "http" || r.Header.Get("X-Real-IP") != "127.0.0.1" ||
			r.Header.Get("X-WheelMaker-Relay") != "" {
			http.Error(w, "missing proxy metadata", http.StatusBadRequest)
			return
		}
		cookie, cookieErr := r.Cookie(desktopRegistrySessionCookieName)
		if cookieErr != nil || cookie.Value != cookieValue {
			http.Error(w, "missing native session", http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.RawQuery == "auth=status":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":true,"csrfToken":"test-only"}`)
		case strings.HasSuffix(r.URL.Path, "/ws/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"):
			w.Header().Set("Content-Disposition", `attachment; filename="file.txt"`)
			_, _ = io.WriteString(w, "DOWNLOAD_BODY")
		case strings.HasSuffix(r.URL.Path, "/ws/preview/"):
			w.Header().Set("Content-Security-Policy", "sandbox allow-scripts")
			w.Header().Set("X-Preview-Contract", "preserved")
			_, _ = io.WriteString(w, "PREVIEW_BODY")
		case strings.HasSuffix(r.URL.Path, "/ws"):
			connection, upgradeErr := upgrader.Upgrade(w, r, nil)
			if upgradeErr != nil {
				return
			}
			defer connection.Close()
			messageType, payload, readErr := connection.ReadMessage()
			if readErr == nil {
				_ = connection.WriteMessage(messageType, payload)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	_, targetURL := startDesktopLocalhostEdgeWithRegistry(t, writeDesktopLocalhostWebRoot(t), upstream.URL, store)
	origin := strings.TrimSuffix(targetURL, state.BasePath)

	downloadRequest, err := http.NewRequest(http.MethodGet, targetURL+"ws/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789", nil)
	if err != nil {
		t.Fatal(err)
	}
	downloadRequest.Header.Set("Origin", origin)
	downloadRequest.Header.Set("Cookie", desktopRegistrySessionCookieName+"=client-controlled; foreign=value")
	downloadRequest.Header.Set("X-Forwarded-Proto", "https")
	downloadRequest.Header.Set("X-Real-IP", "203.0.113.8")
	downloadRequest.Header.Set("X-WheelMaker-Relay", "1")
	download, err := (&http.Client{Timeout: 3 * time.Second}).Do(downloadRequest)
	if err != nil {
		t.Fatal(err)
	}
	downloadBody, _ := io.ReadAll(download.Body)
	download.Body.Close()
	if download.StatusCode != http.StatusOK || string(downloadBody) != "DOWNLOAD_BODY" || !strings.Contains(download.Header.Get("Content-Disposition"), "file.txt") {
		t.Fatalf("download status=%d headers=%v body=%q", download.StatusCode, download.Header, downloadBody)
	}

	preview := doDesktopLocalhostRequest(t, http.MethodPost, targetURL+"ws/preview/", origin, "test-only", `{}`)
	previewBody, _ := io.ReadAll(preview.Body)
	preview.Body.Close()
	if preview.StatusCode != http.StatusOK || string(previewBody) != "PREVIEW_BODY" || preview.Header.Get("Content-Security-Policy") != "sandbox allow-scripts" || preview.Header.Get("X-Preview-Contract") != "preserved" || preview.Header.Get("X-Frame-Options") != "" {
		t.Fatalf("preview status=%d headers=%v body=%q", preview.StatusCode, preview.Header, previewBody)
	}

	wsURL := "ws" + strings.TrimPrefix(targetURL, "http") + "ws"
	connection, response, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{origin}})
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		t.Fatalf("WebSocket dial: %v", err)
	}
	defer connection.Close()
	if err := connection.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatal(err)
	}
	_, payload, err := connection.ReadMessage()
	if err != nil || string(payload) != "ping" {
		t.Fatalf("WebSocket echo payload=%q err=%v", payload, err)
	}
}

func TestDesktopLocalhostProxyRejectsUnavailableRegistryAndInvalidLoginCookie(t *testing.T) {
	t.Run("Registry unavailable", func(t *testing.T) {
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: "127.0.0.1:0",
			RegistryURL:   unavailableDesktopLocalhostRegistryURL(t),
			WebRoot:       writeDesktopLocalhostWebRoot(t),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			_ = edge.Close()
			t.Fatalf("Start=%q, want unavailable Registry rejection", target)
		}
	})

	t.Run("Registry redirect", func(t *testing.T) {
		redirects := 0
		redirectTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			redirects++
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":false}`)
		}))
		defer redirectTarget.Close()
		upstream := httptest.NewServer(http.RedirectHandler(redirectTarget.URL, http.StatusFound))
		defer upstream.Close()
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: "127.0.0.1:0",
			RegistryURL:   upstream.URL,
			WebRoot:       writeDesktopLocalhostWebRoot(t),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			_ = edge.Close()
			t.Fatalf("Start=%q, want Registry redirect rejection", target)
		}
		if redirects != 0 {
			t.Fatalf("Registry probe followed %d redirect(s)", redirects)
		}
	})

	t.Run("foreign login cookie", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.RawQuery == "auth=status" {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"authenticated":false}`)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "foreign", Value: "value", Path: "/", Secure: true, HttpOnly: true})
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":true,"csrfToken":"must-not-pass"}`)
		}))
		defer upstream.Close()
		store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
		_, targetURL := startDesktopLocalhostEdgeWithRegistry(t, writeDesktopLocalhostWebRoot(t), upstream.URL, store)
		basePath := mustDesktopLocalhostBasePath(t, store)
		origin := strings.TrimSuffix(targetURL, basePath)
		login := doDesktopLocalhostRequest(t, http.MethodPost, targetURL+"ws?auth=login", origin, "", `{"token":"not-persisted"}`)
		login.Body.Close()
		if login.StatusCode != http.StatusBadGateway || len(login.Header.Values("Set-Cookie")) != 0 {
			t.Fatalf("login status=%d cookies=%v, want fail closed", login.StatusCode, login.Header.Values("Set-Cookie"))
		}
		state, err := store.LoadOrCreate()
		if err != nil {
			t.Fatal(err)
		}
		if state.SessionCookie != "" {
			t.Fatal("foreign cookie was persisted")
		}
	})
}

func startDesktopLocalhostTestEdge(t *testing.T, webRoot string) (*desktopLocalhostEdge, string) {
	t.Helper()
	registry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("auth") == "status" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":false}`)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(registry.Close)
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	return startDesktopLocalhostEdgeWithRegistry(t, webRoot, registry.URL, store)
}

func startDesktopLocalhostEdgeWithRegistry(t *testing.T, webRoot, registryURL string, store *fileDesktopLocalhostStateStore) (*desktopLocalhostEdge, string) {
	t.Helper()
	edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
		ListenAddress: "127.0.0.1:0",
		RegistryURL:   registryURL,
		WebRoot:       webRoot,
		StateStore:    store,
	})
	targetURL, err := edge.Start(context.Background())
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = edge.Close() })
	return edge, targetURL
}

func mustDesktopLocalhostBasePath(t *testing.T, store *fileDesktopLocalhostStateStore) string {
	t.Helper()
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	return state.BasePath
}

func doDesktopLocalhostRequest(t *testing.T, method, rawURL, origin, csrf, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, rawURL, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
		request.Header.Set("Sec-Fetch-Site", "same-origin")
		request.Header.Set("Sec-Fetch-Mode", "cors")
	}
	if csrf != "" {
		request.Header.Set("X-WheelMaker-CSRF", csrf)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := (&http.Client{Timeout: 3 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func assertDesktopLocalhostAuthStatus(t *testing.T, response *http.Response, authenticated bool) {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("auth status=%d body=%q", response.StatusCode, body)
	}
	var payload struct {
		Authenticated bool `json:"authenticated"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Authenticated != authenticated {
		t.Fatalf("authenticated=%v, want %v", payload.Authenticated, authenticated)
	}
}

func writeDesktopLocalhostWebRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "local-index.html"), []byte("<!doctype html>LOCALHOST_DOCUMENT"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "bundle.abcdef12.js"), []byte("LOCALHOST_ASSET"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	return root
}

func unavailableDesktopLocalhostRegistryURL(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	return "http://" + address
}

func TestDesktopBaseURLContract(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "domain without scheme", raw: "example.com", want: "https://example.com/"},
		{name: "domain", raw: "https://example.com", want: "https://example.com/"},
		{name: "ip", raw: "https://192.0.2.10", want: "https://192.0.2.10/"},
		{name: "port and subpath", raw: "https://example.com:8443/wheelmaker", want: "https://example.com:8443/wheelmaker/"},
		{name: "encoded path", raw: "https://example.com/a%20b", want: "https://example.com/a%20b/"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeDesktopBaseURL(tt.raw)
			if err != nil {
				t.Fatalf("normalizeDesktopBaseURL(%q): %v", tt.raw, err)
			}
			if got != tt.want {
				t.Fatalf("normalizeDesktopBaseURL(%q)=%q, want %q", tt.raw, got, tt.want)
			}
		})
	}

	for _, raw := range []string{
		"",
		"http://example.com/",
		"https://user@example.com/",
		"https://example.com/?token=secret",
		"https://example.com/#fragment",
		"javascript:alert(1)",
		"file:///tmp/index.html",
	} {
		t.Run("reject_"+raw, func(t *testing.T) {
			if got, err := normalizeDesktopBaseURL(raw); err == nil {
				t.Fatalf("normalizeDesktopBaseURL(%q)=%q, want rejection", raw, got)
			}
		})
	}
}

func TestDesktopConnectionConfigNormalizesLegacyGateway(t *testing.T) {
	tests := []struct {
		name        string
		input       desktopConfig
		want        desktopConfig
		wantChanged bool
	}{
		{
			name: "empty legacy config remains unselected",
		},
		{
			name:        "legacy base URL migrates to Gateway",
			input:       desktopConfig{BaseURL: "https://example.com/app"},
			want:        desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/app/"},
			wantChanged: true,
		},
		{
			name:  "explicit Gateway remains Gateway",
			input: desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/app/"},
			want:  desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/app/"},
		},
		{
			name:  "Localhost has no base URL",
			input: desktopConfig{ConnectionMode: desktopConnectionLocalhost},
			want:  desktopConfig{ConnectionMode: desktopConnectionLocalhost},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, changed, err := normalizeDesktopConfig(tt.input)
			if err != nil {
				t.Fatalf("normalizeDesktopConfig: %v", err)
			}
			if got != tt.want || changed != tt.wantChanged {
				t.Fatalf("normalizeDesktopConfig(%+v)=(%+v, %v), want (%+v, %v)", tt.input, got, changed, tt.want, tt.wantChanged)
			}
		})
	}
}

func TestDesktopConnectionConfigRejectsInvalidCombinations(t *testing.T) {
	for _, config := range []desktopConfig{
		{ConnectionMode: desktopConnectionMode("other")},
		{ConnectionMode: desktopConnectionGateway},
		{ConnectionMode: desktopConnectionGateway, BaseURL: "http://example.com/"},
		{ConnectionMode: desktopConnectionLocalhost, BaseURL: "https://example.com/"},
	} {
		if got, _, err := normalizeDesktopConfig(config); err == nil {
			t.Fatalf("normalizeDesktopConfig(%+v)=%+v, want rejection", config, got)
		}
	}
}

func TestDesktopUsesCustomTitleBar(t *testing.T) {
	if !defaultDesktopWindowOptions().CustomTitleBar {
		t.Fatal("desktop window must use the custom title bar")
	}
}

type recordingLauncher struct {
	target desktopLaunchTarget
	opts   desktopWindowOptions
	err    error
}

func (r *recordingLauncher) Launch(target desktopLaunchTarget, opts desktopWindowOptions) error {
	r.target = target
	r.opts = opts
	return r.err
}

type memoryDesktopConfigStore struct {
	config desktopConfig
	err    error
}

func (s *memoryDesktopConfigStore) Load() (desktopConfig, error) { return s.config, s.err }
func (s *memoryDesktopConfigStore) Save(config desktopConfig) error {
	s.config = config
	return s.err
}

type recordingDesktopProber struct {
	url string
	err error
}

type recordingDesktopLocalhostEdge struct {
	url         string
	startErrors []error
	starts      int
	closes      int
	deletes     int
}

func (e *recordingDesktopLocalhostEdge) Start(context.Context) (string, error) {
	e.starts++
	if len(e.startErrors) != 0 {
		err := e.startErrors[0]
		e.startErrors = e.startErrors[1:]
		if err != nil {
			return "", err
		}
	}
	return e.url, nil
}

func (e *recordingDesktopLocalhostEdge) Close() error {
	e.closes++
	return nil
}

func (e *recordingDesktopLocalhostEdge) DeleteState() error {
	e.deletes++
	return nil
}

func fixedDesktopLocalhostTestURL() string {
	return desktopLocalhostFixedURL("/wm-local-" + strings.Repeat("A", 43) + "/")
}

func (p *recordingDesktopProber) Probe(_ context.Context, baseURL string) error {
	p.url = baseURL
	return p.err
}

func TestDesktopBootstrapLaunchWithoutConfig(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{}
	err := runDesktopApp(context.Background(), launcher, &memoryDesktopConfigStore{}, prober)
	if err != nil {
		t.Fatalf("runDesktopApp: %v", err)
	}
	if launcher.target.HTML != desktopBootstrapHTML || launcher.target.URL != "" {
		t.Fatalf("target=%+v, want embedded Bootstrap HTML", launcher.target)
	}
	if prober.url != "" {
		t.Fatalf("unexpected probe for empty configuration: %q", prober.url)
	}
	if launcher.opts.BootstrapState.BaseURL != "" || launcher.opts.BootstrapState.Error != "" {
		t.Fatalf("bootstrap state=%+v", launcher.opts.BootstrapState)
	}
	if !launcher.opts.BootstrapState.SupportsLocalhost || launcher.opts.BootstrapState.ConnectionMode != "" {
		t.Fatalf("bootstrap capability state=%+v", launcher.opts.BootstrapState)
	}
}

func TestDesktopLocalhostLaunchUsesFixedEdgeWithoutGatewayProbe(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{err: errors.New("Gateway probe must not run")}
	store := &memoryDesktopConfigStore{config: desktopConfig{ConnectionMode: desktopConnectionLocalhost}}
	edge := &recordingDesktopLocalhostEdge{url: fixedDesktopLocalhostTestURL()}
	dependencies := desktopAppDependencies{LocalhostEdgeFactory: func() (desktopLocalhostRuntimeEdge, error) {
		return edge, nil
	}}

	if err := runDesktopAppWithDependencies(context.Background(), launcher, store, prober, false, dependencies); err != nil {
		t.Fatalf("runDesktopAppWithDependencies: %v", err)
	}
	if launcher.target.URL != edge.url || launcher.target.HTML != "" {
		t.Fatalf("target=%+v, want Localhost edge URL", launcher.target)
	}
	if prober.url != "" {
		t.Fatalf("Localhost launch probed Gateway %q", prober.url)
	}
	if launcher.opts.Runtime.security.Mode() != desktopTrustedLocalhostPage {
		t.Fatalf("security mode=%v, want trusted Localhost", launcher.opts.Runtime.security.Mode())
	}
	if edge.starts != 1 || edge.closes != 1 || edge.deletes != 0 {
		t.Fatalf("edge lifecycle starts=%d closes=%d deletes=%d", edge.starts, edge.closes, edge.deletes)
	}
}

func TestDesktopLocalhostStartupFailurePreservesModeForRetry(t *testing.T) {
	launcher := &recordingLauncher{}
	store := &memoryDesktopConfigStore{config: desktopConfig{ConnectionMode: desktopConnectionLocalhost}}
	edge := &recordingDesktopLocalhostEdge{
		url:         fixedDesktopLocalhostTestURL(),
		startErrors: []error{errors.New("Registry unavailable")},
	}
	dependencies := desktopAppDependencies{LocalhostEdgeFactory: func() (desktopLocalhostRuntimeEdge, error) {
		return edge, nil
	}}

	if err := runDesktopAppWithDependencies(context.Background(), launcher, store, &recordingDesktopProber{}, false, dependencies); err != nil {
		t.Fatal(err)
	}
	if launcher.target.HTML != desktopBootstrapHTML || launcher.target.URL != "" {
		t.Fatalf("target=%+v, want Bootstrap failure state", launcher.target)
	}
	state := launcher.opts.BootstrapState
	if state.ConnectionMode != desktopConnectionLocalhost || !state.SupportsLocalhost || !strings.Contains(state.Error, "Registry unavailable") {
		t.Fatalf("bootstrap state=%+v", state)
	}
	if store.config.ConnectionMode != desktopConnectionLocalhost || store.config.BaseURL != "" {
		t.Fatalf("stored config=%+v, want retained Localhost", store.config)
	}
}

func TestDesktopRuntimeSelectsAndRetriesLocalhost(t *testing.T) {
	store := &memoryDesktopConfigStore{}
	edge := &recordingDesktopLocalhostEdge{
		url:         fixedDesktopLocalhostTestURL(),
		startErrors: []error{errors.New("Registry unavailable"), nil},
	}
	security, err := newDesktopWebViewSecurityState("", desktopBootstrapPage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntimeWithOptions(
		store,
		&recordingDesktopProber{},
		desktopConfig{},
		desktopBootstrapState{SupportsLocalhost: true},
		security,
		desktopRuntimeOptions{LocalhostEdgeFactory: func() (desktopLocalhostRuntimeEdge, error) { return edge, nil }},
	)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)

	failed := runtime.SelectLocalhost(context.Background())
	if failed.OK || failed.ConnectionMode != desktopConnectionLocalhost || !strings.Contains(failed.Error, "Registry unavailable") {
		t.Fatalf("SelectLocalhost result=%+v", failed)
	}
	if store.config != (desktopConfig{ConnectionMode: desktopConnectionLocalhost}) {
		t.Fatalf("config=%+v, Localhost mode must persist before startup", store.config)
	}
	if surface.navigatedURL != "" {
		t.Fatalf("failed Localhost navigated to %q", surface.navigatedURL)
	}

	retried := runtime.Retry(context.Background())
	if !retried.OK || retried.ConnectionMode != desktopConnectionLocalhost || retried.Error != "" {
		t.Fatalf("Retry result=%+v", retried)
	}
	if surface.navigatedURL != edge.url || security.Mode() != desktopTrustedLocalhostPage || edge.starts != 2 {
		t.Fatalf("navigation=%q mode=%v starts=%d", surface.navigatedURL, security.Mode(), edge.starts)
	}
}

func TestDesktopRuntimeLocalhostCleanupAndLocalDevRestore(t *testing.T) {
	edge := &recordingDesktopLocalhostEdge{url: fixedDesktopLocalhostTestURL()}
	config := desktopConfig{ConnectionMode: desktopConnectionLocalhost}
	security, err := newDesktopWebViewSecurityState(edge.url, desktopTrustedLocalhostPage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntimeWithOptions(
		&memoryDesktopConfigStore{config: config},
		&recordingDesktopProber{},
		config,
		desktopBootstrapState{ConnectionMode: desktopConnectionLocalhost, SupportsLocalhost: true},
		security,
		desktopRuntimeOptions{
			LocalhostEdgeFactory: func() (desktopLocalhostRuntimeEdge, error) { return edge, nil },
			LocalhostEdge:        edge,
			LocalhostURL:         edge.url,
		},
	)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)

	if err := runtime.EnterLocalDev(); err != nil {
		t.Fatal(err)
	}
	if edge.closes != 1 || surface.navigatedURL != desktopLocalDevURL {
		t.Fatalf("enter Local Dev closes=%d navigation=%q", edge.closes, surface.navigatedURL)
	}
	if err := runtime.ExitLocalDev(); err != nil {
		t.Fatal(err)
	}
	if edge.starts != 1 || surface.navigatedURL != edge.url || security.Mode() != desktopTrustedLocalhostPage {
		t.Fatalf("exit Local Dev starts=%d navigation=%q mode=%v", edge.starts, surface.navigatedURL, security.Mode())
	}

	runtime.ShowBootstrap()
	if edge.closes != 2 || edge.deletes != 1 || runtime.GetState().ConnectionMode != "" {
		t.Fatalf("connection cleanup closes=%d deletes=%d state=%+v", edge.closes, edge.deletes, runtime.GetState())
	}
}

func TestDesktopLocalDevLaunchUsesFixedLoopbackWithoutProbing(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{}
	store := &memoryDesktopConfigStore{config: desktopConfig{BaseURL: "https://example.com/"}}

	if err := runDesktopAppWithMode(context.Background(), launcher, store, prober, true); err != nil {
		t.Fatalf("runDesktopAppWithMode: %v", err)
	}
	if launcher.target.URL != desktopLocalDevURL || launcher.target.HTML != "" {
		t.Fatalf("target=%+v, want fixed Local Dev URL", launcher.target)
	}
	if prober.url != "" {
		t.Fatalf("local Dev launch unexpectedly probed %q", prober.url)
	}
	if launcher.opts.Runtime.security.Mode() != desktopTrustedLocalDevPage {
		t.Fatalf("mode=%v, want local Dev mode", launcher.opts.Runtime.security.Mode())
	}
}

func TestDesktopSavedServerLaunchesWithoutPreflightProbe(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{err: errors.New("probe should not run")}
	store := &memoryDesktopConfigStore{config: desktopConfig{BaseURL: "https://example.com/app"}}

	if err := runDesktopApp(context.Background(), launcher, store, prober); err != nil {
		t.Fatalf("runDesktopApp: %v", err)
	}
	if prober.url != "" {
		t.Fatalf("saved server was preflight-probed: %q", prober.url)
	}
	if launcher.target.URL != "https://example.com/app/" || launcher.target.HTML != "" {
		t.Fatalf("target=%+v, want direct remote URL", launcher.target)
	}
	if store.config != (desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/app/"}) {
		t.Fatalf("stored config=%+v, want explicit normalized Gateway", store.config)
	}
}

func TestDesktopBootstrapSaveProbeFailureShowsError(t *testing.T) {
	prober := &recordingDesktopProber{err: errors.New("certificate is not trusted")}
	store := &memoryDesktopConfigStore{}
	security, err := newDesktopWebViewSecurityState("", desktopBootstrapPage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntime(store, prober, desktopConfig{}, desktopBootstrapState{}, security)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)

	result := runtime.SaveBaseURL(context.Background(), "https://example.com/app/")

	if result.OK || !strings.Contains(result.Error, "certificate is not trusted") {
		t.Fatalf("result=%+v", result)
	}
	if prober.url != "https://example.com/app/" {
		t.Fatalf("probe URL=%q", prober.url)
	}
	if store.config.BaseURL != "" || surface.navigatedURL != "" {
		t.Fatalf("store=%q navigation=%q", store.config.BaseURL, surface.navigatedURL)
	}
}

func TestDesktopRemoteProbeRejectsBadStatusAndUntrustedCertificate(t *testing.T) {
	notFound := httptest.NewTLSServer(http.NotFoundHandler())
	defer notFound.Close()
	trustedTestClient := notFound.Client()
	trustedTestClient.Timeout = 3 * time.Second
	if err := (&httpDesktopBaseURLProber{client: trustedTestClient}).Probe(context.Background(), notFound.URL+"/"); err == nil {
		t.Fatal("expected non-2xx/3xx status rejection")
	}

	untrusted := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer untrusted.Close()
	if err := newDefaultDesktopBaseURLProber().Probe(context.Background(), untrusted.URL+"/"); err == nil {
		t.Fatal("expected system trust validation to reject the test certificate")
	}
}

func TestDesktopBaseURLProbeClientPolicy(t *testing.T) {
	client := newDesktopProbeHTTPClient()
	if client.Timeout != 3*time.Second {
		t.Fatalf("timeout=%s, want 3s", client.Timeout)
	}

	request, err := http.NewRequest(http.MethodGet, "https://example.com/app/", nil)
	if err != nil {
		t.Fatal(err)
	}
	for hop, target := range []string{
		"https://example.com/next/",
		"http://example.com/downgrade/",
		"https://example.com/too-many/",
	} {
		next, err := http.NewRequest(http.MethodGet, target, nil)
		if err != nil {
			t.Fatal(err)
		}
		via := make([]*http.Request, hop)
		for index := range via {
			via[index] = request
		}
		err = client.CheckRedirect(next, via)
		switch hop {
		case 0:
			if err != nil {
				t.Fatalf("HTTPS redirect rejected: %v", err)
			}
		case 1:
			if err == nil {
				t.Fatal("HTTP downgrade redirect was accepted")
			}
		case 2:
			// Replace the synthetic redirect history with five completed hops.
			via = make([]*http.Request, 6)
			for index := range via {
				via[index] = request
			}
			if err := client.CheckRedirect(next, via); err == nil {
				t.Fatal("sixth redirect was accepted")
			}
		}
	}
}

func TestDesktopConfigStoreUsesPrivateAtomicBaseURLFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".wheelmaker", "desktop", "config.json")
	store := newFileDesktopConfigStore(path)
	want := desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: "https://example.com/app/"}
	if err := store.Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if string(raw) != "{\"connectionMode\":\"gateway\",\"baseUrl\":\"https://example.com/app/\"}\n" {
		t.Fatalf("config=%q, want explicit Gateway mode and baseUrl", raw)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != want {
		t.Fatalf("Load=%+v, want %+v", got, want)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("config mode=%#o, want 0600", info.Mode().Perm())
		}
	}
}

func TestDesktopConfigMissingFileLoadsEmpty(t *testing.T) {
	store := newFileDesktopConfigStore(filepath.Join(t.TempDir(), "missing", "config.json"))
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != (desktopConfig{}) {
		t.Fatalf("Load=%+v, want empty config", got)
	}
}

func TestDesktopBootstrapLaunchReturnsActionableWebViewError(t *testing.T) {
	launcher := &recordingLauncher{err: errWebView2Unavailable}
	err := runDesktopApp(context.Background(), launcher, &memoryDesktopConfigStore{}, &recordingDesktopProber{})
	if err == nil || !strings.Contains(err.Error(), "Microsoft Edge WebView2 Runtime") {
		t.Fatalf("error=%v should mention WebView2 runtime", err)
	}
}

type recordingDesktopDwmWindowOps struct {
	attributes map[uint32]uint32
}

func (r *recordingDesktopDwmWindowOps) setWindowAttribute(_ uintptr, attribute, value uint32) error {
	if r.attributes == nil {
		r.attributes = make(map[uint32]uint32)
	}
	r.attributes[attribute] = value
	return nil
}

func TestCustomTitleBarSuppressesNativeDwmBorder(t *testing.T) {
	ops := &recordingDesktopDwmWindowOps{}

	suppressDesktopWindowBorderWithOps(42, ops)

	if got := ops.attributes[dwmwaBorderColor]; got != dwmColorNone {
		t.Fatalf("DWM border color=%#x, want DWMWA_COLOR_NONE %#x", got, uint32(dwmColorNone))
	}
}

func TestDesktopWindowThemeKeepsNativeTitleBarBorderColor(t *testing.T) {
	ops := &recordingDesktopDwmWindowOps{}

	applyDesktopWindowThemeWithOps(42, "#1e1e1e", ops)

	want, ok := parseColorRef("#1e1e1e")
	if !ok {
		t.Fatal("test color should parse")
	}
	if got := ops.attributes[dwmwaBorderColor]; got != want {
		t.Fatalf("DWM border color=%#x, want theme color %#x", got, want)
	}
}

func TestDesktopRuntimeHTMLClipboardBindingsStayRemoteOnly(t *testing.T) {
	script := desktopRuntimeInitScript()
	for _, want := range []string{
		"beginHtmlFileClipboard",
		"appendHtmlFileClipboard",
		"commitHtmlFileClipboard",
		"cancelHtmlFileClipboard",
		desktopBeginHTMLFileClipboardBinding,
		desktopAppendHTMLFileClipboardBinding,
		desktopCommitHTMLFileClipboardBinding,
		desktopCancelHTMLFileClipboardBinding,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("desktop runtime script missing %q", want)
		}
	}

	bootstrapStart := strings.Index(script, "window.wheelMakerBootstrap")
	bootstrapEnd := strings.Index(script[bootstrapStart:], "return;")
	remoteRelative := strings.Index(script[bootstrapStart+bootstrapEnd:], "window.WheelMakerDesktop = Object.freeze({")
	remoteStart := bootstrapStart + bootstrapEnd + remoteRelative
	localRelative := strings.Index(script[remoteStart+1:], "window.WheelMakerDesktop = Object.freeze({")
	localDevSection := script[remoteStart+1+localRelative:]
	bootstrapSection := script[bootstrapStart : bootstrapStart+bootstrapEnd]
	for _, privateName := range []string{
		desktopBeginHTMLFileClipboardBinding,
		desktopAppendHTMLFileClipboardBinding,
		desktopCommitHTMLFileClipboardBinding,
		desktopCancelHTMLFileClipboardBinding,
	} {
		if strings.Contains(bootstrapSection, privateName) || strings.Contains(localDevSection, privateName) {
			t.Errorf("non-remote runtime exposes HTML clipboard binding %q", privateName)
		}
	}
}

type desktopLaunchCall struct {
	name string
	args []string
}

func newDesktopFileActionTestEnvironment(launches *[]desktopLaunchCall) desktopFileActionEnvironment {
	return desktopFileActionEnvironment{
		stat: os.Stat,
		lookPath: func(string) (string, error) {
			return "", exec.ErrNotFound
		},
		getenv: func(string) string {
			return ""
		},
		launch: func(name string, args ...string) error {
			*launches = append(*launches, desktopLaunchCall{name: name, args: append([]string(nil), args...)})
			return nil
		},
	}
}

func writeDesktopTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopAbsoluteFileActions(t *testing.T) {
	base := t.TempDir()
	file := filepath.Join(base, "outside file.go")
	code := filepath.Join(base, "Code.exe")
	writeDesktopTestFile(t, file)
	writeDesktopTestFile(t, code)
	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(string) (string, error) {
		return code, nil
	}

	if err := environment.openFileInVSCode(file); err != nil {
		t.Fatal(err)
	}
	if err := environment.showFileInFolder(file); err != nil {
		t.Fatal(err)
	}
	if len(launches) != 2 ||
		launches[0].name != code ||
		launches[0].args[0] != file ||
		launches[1].name != "explorer.exe" ||
		launches[1].args[0] != "/select,"+file {
		t.Fatalf("launches=%v", launches)
	}
}

func TestDesktopAbsoluteFileActionsRejectInvalidTargets(t *testing.T) {
	base := t.TempDir()
	directory := filepath.Join(base, "folder")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(base, "missing.go")

	for _, target := range []string{"relative.go", missing, directory} {
		t.Run(target, func(t *testing.T) {
			var launches []desktopLaunchCall
			environment := newDesktopFileActionTestEnvironment(&launches)
			if err := environment.openFileInVSCode(target); err == nil {
				t.Fatal("openFileInVSCode() error = nil")
			}
			if err := environment.showFileInFolder(target); err == nil {
				t.Fatal("showFileInFolder() error = nil")
			}
			if len(launches) != 0 {
				t.Fatalf("launches=%v, want none", launches)
			}
		})
	}
}

func TestDesktopProjectFilePathRejectsInvalidRoots(t *testing.T) {
	tempDir := t.TempDir()
	fileRoot := filepath.Join(tempDir, "root.txt")
	if err := os.WriteFile(fileRoot, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		root string
	}{
		{name: "relative", root: "."},
		{name: "missing", root: filepath.Join(tempDir, "missing")},
		{name: "file", root: fileRoot},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := resolveDesktopProjectFilePath(tt.root, "src/main.go"); err == nil {
				t.Fatal("resolveDesktopProjectFilePath() error = nil, want validation error")
			}
		})
	}
}

func TestDesktopProjectFilePathRejectsInvalidArtifactPaths(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name string
		path string
	}{
		{name: "empty", path: ""},
		{name: "dot", path: "."},
		{name: "dot with separator", path: "./"},
		{name: "absolute", path: filepath.Join(root, "outside.txt")},
		{name: "drive qualified", path: `C:Windows\system.ini`},
		{name: "drive absolute", path: `C:\Windows\system.ini`},
		{name: "current drive rooted backslash", path: `\Windows\system.ini`},
		{name: "current drive rooted slash", path: "/Windows/system.ini"},
		{name: "UNC", path: `\\server\share\file.txt`},
		{name: "parent", path: ".."},
		{name: "parent traversal", path: `..\outside.txt`},
		{name: "nested parent traversal", path: `src\..\..\outside.txt`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := resolveDesktopProjectFilePath(root, tt.path); err == nil {
				t.Fatal("resolveDesktopProjectFilePath() error = nil, want validation error")
			}
		})
	}
}

func TestDesktopProjectFilePathResolvesForwardSlashRelativePath(t *testing.T) {
	root := t.TempDir()

	cleanRoot, target, err := resolveDesktopProjectFilePath(root, "src/main.go")
	if err != nil {
		t.Fatalf("resolveDesktopProjectFilePath() error = %v", err)
	}
	if cleanRoot != filepath.Clean(root) {
		t.Fatalf("cleanRoot = %q, want %q", cleanRoot, filepath.Clean(root))
	}
	wantTarget := filepath.Join(root, "src", "main.go")
	if target != wantTarget {
		t.Fatalf("target = %q, want %q", target, wantTarget)
	}
}

func TestDesktopVSCodeUsesPathBeforeInstallFallbacks(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "src", "main.go")
	writeDesktopTestFile(t, target)
	pathCode := filepath.Join(t.TempDir(), "bin", "Code.exe")
	writeDesktopTestFile(t, pathCode)
	localAppData := t.TempDir()
	fallbackCode := filepath.Join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
	writeDesktopTestFile(t, fallbackCode)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(name string) (string, error) {
		if name != "Code.exe" {
			t.Fatalf("lookPath(%q), want Code.exe", name)
		}
		return pathCode, nil
	}
	environment.getenv = func(name string) string {
		if name == "LOCALAPPDATA" {
			return localAppData
		}
		return ""
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "src/main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() error = %v", err)
	}
	assertDesktopLaunch(t, launches, pathCode, target)
}

func TestDesktopVSCodeUsesInstallLocationFallbacks(t *testing.T) {
	tests := []struct {
		name      string
		envName   string
		pathParts []string
	}{
		{name: "LocalAppData", envName: "LOCALAPPDATA", pathParts: []string{"Programs", "Microsoft VS Code", "Code.exe"}},
		{name: "ProgramFiles", envName: "ProgramFiles", pathParts: []string{"Microsoft VS Code", "Code.exe"}},
		{name: "ProgramFiles x86", envName: "ProgramFiles(x86)", pathParts: []string{"Microsoft VS Code", "Code.exe"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			projectRoot := t.TempDir()
			target := filepath.Join(projectRoot, "main.go")
			writeDesktopTestFile(t, target)
			installRoot := t.TempDir()
			codePathParts := append([]string{installRoot}, tt.pathParts...)
			codePath := filepath.Join(codePathParts...)
			writeDesktopTestFile(t, codePath)

			var launches []desktopLaunchCall
			environment := newDesktopFileActionTestEnvironment(&launches)
			environment.getenv = func(name string) string {
				if name == tt.envName {
					return installRoot
				}
				return ""
			}

			if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
				t.Fatalf("openProjectFileInVSCode() error = %v", err)
			}
			assertDesktopLaunch(t, launches, codePath, target)
		})
	}
}

func TestDesktopVSCodeUsesInstallLocationFallbacksInPriorityOrder(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "main.go")
	writeDesktopTestFile(t, target)

	localAppData := t.TempDir()
	programFiles := t.TempDir()
	programFilesX86 := t.TempDir()
	localAppDataCode := filepath.Join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
	programFilesCode := filepath.Join(programFiles, "Microsoft VS Code", "Code.exe")
	programFilesX86Code := filepath.Join(programFilesX86, "Microsoft VS Code", "Code.exe")
	for _, codePath := range []string{localAppDataCode, programFilesCode, programFilesX86Code} {
		writeDesktopTestFile(t, codePath)
	}

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.getenv = func(name string) string {
		return map[string]string{
			"LOCALAPPDATA":      localAppData,
			"ProgramFiles":      programFiles,
			"ProgramFiles(x86)": programFilesX86,
		}[name]
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() with all fallbacks error = %v", err)
	}
	assertDesktopLaunch(t, launches, localAppDataCode, target)

	if err := os.Remove(localAppDataCode); err != nil {
		t.Fatal(err)
	}
	launches = nil
	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() without LocalAppData candidate error = %v", err)
	}
	assertDesktopLaunch(t, launches, programFilesCode, target)

	if err := os.Remove(programFilesCode); err != nil {
		t.Fatal(err)
	}
	launches = nil
	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() without ProgramFiles candidate error = %v", err)
	}
	assertDesktopLaunch(t, launches, programFilesX86Code, target)
}

func TestDesktopVSCodeSkipsNonRegularPathCandidate(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "main.go")
	writeDesktopTestFile(t, target)
	pathCodeDirectory := t.TempDir()
	programFiles := t.TempDir()
	fallbackCode := filepath.Join(programFiles, "Microsoft VS Code", "Code.exe")
	writeDesktopTestFile(t, fallbackCode)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(string) (string, error) {
		return pathCodeDirectory, nil
	}
	environment.getenv = func(name string) string {
		if name == "ProgramFiles" {
			return programFiles
		}
		return ""
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() error = %v", err)
	}
	assertDesktopLaunch(t, launches, fallbackCode, target)
}

func TestDesktopVSCodeRejectsMissingTargetWithoutLaunch(t *testing.T) {
	projectRoot := t.TempDir()
	codePath := filepath.Join(t.TempDir(), "Code.exe")
	writeDesktopTestFile(t, codePath)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(string) (string, error) {
		return codePath, nil
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "missing.go"); err == nil || err.Error() != "project file is unavailable" {
		t.Fatalf("openProjectFileInVSCode() error = %v, want stable unavailable error", err)
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want none", launches)
	}
}

func TestDesktopVSCodeReportsMissingInstallationWithoutLaunch(t *testing.T) {
	projectRoot := t.TempDir()
	writeDesktopTestFile(t, filepath.Join(projectRoot, "main.go"))

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	err := environment.openProjectFileInVSCode(projectRoot, "main.go")
	if err == nil || !strings.Contains(err.Error(), "Visual Studio Code was not found") {
		t.Fatalf("openProjectFileInVSCode() error = %v, want Visual Studio Code not found", err)
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want none", launches)
	}
}

func TestDesktopFileExplorerSelectsExistingFile(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "src", "main.go")
	writeDesktopTestFile(t, target)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	if err := environment.showProjectFileInFolder(projectRoot, "src/main.go"); err != nil {
		t.Fatalf("showProjectFileInFolder() error = %v", err)
	}
	assertDesktopLaunch(t, launches, "explorer.exe", "/select,"+target)
}

func TestDesktopFileExplorerUsesNearestExistingParentForDeletedFile(t *testing.T) {
	projectRoot := t.TempDir()
	existingParent := filepath.Join(projectRoot, "src")
	if err := os.MkdirAll(existingParent, 0o700); err != nil {
		t.Fatal(err)
	}

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	if err := environment.showProjectFileInFolder(projectRoot, "src/missing/deleted.go"); err != nil {
		t.Fatalf("showProjectFileInFolder() error = %v", err)
	}
	assertDesktopLaunch(t, launches, "explorer.exe", existingParent)
}

func TestDesktopFileExplorerDeletedFileNeverFallsBackOutsideProjectRoot(t *testing.T) {
	projectRoot := t.TempDir()
	outsideParent := filepath.Dir(projectRoot)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.stat = func(path string) (os.FileInfo, error) {
		if path == outsideParent {
			return os.Stat(outsideParent)
		}
		return nil, os.ErrNotExist
	}

	if err := environment.showProjectFileInFolder(projectRoot, "missing/deleted.go"); err == nil {
		t.Fatal("showProjectFileInFolder() error = nil, want project-boundary error")
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want no launch outside project root", launches)
	}
}

func TestDesktopFileExplorerRejectsExistingDirectoryWithoutLaunch(t *testing.T) {
	projectRoot := t.TempDir()
	if err := os.Mkdir(filepath.Join(projectRoot, "src"), 0o700); err != nil {
		t.Fatal(err)
	}

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	if err := environment.showProjectFileInFolder(projectRoot, "src"); err == nil {
		t.Fatal("showProjectFileInFolder() error = nil, want non-regular target error")
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want none", launches)
	}
}

func assertDesktopLaunch(t *testing.T, launches []desktopLaunchCall, wantName string, wantArgs ...string) {
	t.Helper()
	if len(launches) != 1 {
		t.Fatalf("launches = %v, want exactly one", launches)
	}
	if launches[0].name != wantName {
		t.Fatalf("launch name = %q, want %q", launches[0].name, wantName)
	}
	if len(launches[0].args) != len(wantArgs) {
		t.Fatalf("launch args = %q, want %q", launches[0].args, wantArgs)
	}
	for index := range wantArgs {
		if launches[0].args[index] != wantArgs[index] {
			t.Fatalf("launch arg %d = %q, want %q", index, launches[0].args[index], wantArgs[index])
		}
	}
}

type fakeTrayOps struct {
	installHwnd uintptr
	installErr  error

	installed int
	removed   []uintptr
	focused   int
	evaled    []string
}

func newFakeTrayOps() *fakeTrayOps {
	return &fakeTrayOps{installHwnd: 77}
}

func (f *fakeTrayOps) installTrayIcon(_ *desktopToastNotifier) (uintptr, error) {
	f.installed++
	if f.installErr != nil {
		return 0, f.installErr
	}
	return f.installHwnd, nil
}

func (f *fakeTrayOps) removeTrayIcon(hwnd uintptr) { f.removed = append(f.removed, hwnd) }

func (f *fakeTrayOps) focusMainWindow() { f.focused++ }

func (f *fakeTrayOps) evalScript(script string) { f.evaled = append(f.evaled, script) }

type fakeToastOps struct {
	registerErr error
	showErr     error
	registered  int
	shown       []struct{ xml, tag string }
	unreg       int
}

func (f *fakeToastOps) registerIdentity() error {
	f.registered++
	return f.registerErr
}

func (f *fakeToastOps) showToast(xml, tag string) error {
	if f.showErr != nil {
		return f.showErr
	}
	f.shown = append(f.shown, struct{ xml, tag string }{xml, tag})
	return nil
}

func (f *fakeToastOps) unregister() { f.unreg++ }

func validNotificationJSON(title, body string) string {
	return `{"type":"chat.prompt.completed","projectId":"p1","sessionId":"s1","title":"` + title +
		`","body":"` + body + `","status":"completed","tag":"p1:s1"}`
}

func TestParseDesktopNotification(t *testing.T) {
	n, err := parseDesktopNotification(validNotificationJSON("Fix bug", "done"))
	if err != nil {
		t.Fatalf("parse valid payload: %v", err)
	}
	if n.Key != "p1:s1" || n.ProjectID != "p1" || n.SessionID != "s1" ||
		n.Title != "Fix bug" || n.Body != "done" || n.Status != "completed" {
		t.Fatalf("parse = %+v", n)
	}
	for _, raw := range []string{
		`{"type":"chat.prompt.completed","projectId":"","sessionId":"s1"}`,
		`{"type":"chat.prompt.completed","projectId":"p1"}`,
		`{"type":"other","projectId":"p1","sessionId":"s1"}`,
		`not-json`,
	} {
		if _, err := parseDesktopNotification(raw); err == nil {
			t.Fatalf("parseDesktopNotification(%s) expected error", raw)
		}
	}
}

func TestDesktopNotificationStatusPrefix(t *testing.T) {
	cases := map[string]string{
		"completed": "✓ ", "": "✓ ",
		"failed":    "✗ ",
		"cancelled": "■ ", "interrupted": "■ ",
	}
	for status, want := range cases {
		if got := desktopNotificationStatusPrefix(status); got != want {
			t.Fatalf("prefix(%q) = %q, want %q", status, got, want)
		}
	}
}

func TestDesktopToastContentFor(t *testing.T) {
	n := desktopNotification{Key: "p1:s1", ProjectID: "p1", SessionID: "s1", Title: "Fix bug", Body: "done", Status: "failed"}
	c := desktopToastContentFor(n)
	if c.Title != "Fix bug" || c.Body != "✗ done" || c.Tag != "p1:s1" ||
		c.Launch != "projectId=p1&sessionId=s1" {
		t.Fatalf("content = %+v", c)
	}
}

func TestMarshalDesktopToastXMLEscapesAndShapes(t *testing.T) {
	c := desktopToastContent{
		Title: `A<b>&"c"`, Body: "✓ done",
		Tag: "p1:s1", Launch: "projectId=p1&sessionId=s1",
	}
	got := marshalDesktopToastXML(c)
	for _, want := range []string{
		`activationType="foreground"`,
		`launch="projectId=p1&amp;sessionId=s1"`,
		`template="ToastGeneric"`,
		`<text>A&lt;b&gt;&amp;&#34;c&#34;</text>`,
		`<text>✓ done</text>`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("xml missing %q:\n%s", want, got)
		}
	}
}

func TestDesktopToastNotifierShowBuildsAndSendsToast(t *testing.T) {
	toast := &fakeToastOps{}
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(toast, tray)
	if toast.registered != 1 {
		t.Fatalf("registered = %d, want 1 at construction", toast.registered)
	}
	if got := n.show(validNotificationJSON("Fix bug", "done")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("show = %s, want ok", got)
	}
	if len(toast.shown) != 1 {
		t.Fatalf("shown = %v, want 1 toast", toast.shown)
	}
	if toast.shown[0].tag != "p1:s1" || !strings.Contains(toast.shown[0].xml, "<text>Fix bug</text>") {
		t.Fatalf("shown = %+v", toast.shown[0])
	}
}

func TestDesktopToastNotifierRegisterFailureDropsNotification(t *testing.T) {
	toast := &fakeToastOps{registerErr: errors.New("registry denied")}
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(toast, tray)
	if got := n.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
	if len(toast.shown) != 0 {
		t.Fatalf("shown = %v, want none", toast.shown)
	}
	toast.registerErr = nil
	if got := n.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("retry show = %s, want ok", got)
	}
	if toast.registered != 3 {
		t.Fatalf("registered = %d, want construct + failed retry + success retry", toast.registered)
	}
}

func TestDesktopToastNotifierShowToastFailureReturnsNotOk(t *testing.T) {
	toast := &fakeToastOps{showErr: errors.New("com error")}
	n := newDesktopToastNotifierWithOps(toast, newFakeTrayOps())
	if got := n.show(validNotificationJSON("A", "b")); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
}

func TestDesktopToastNotifierRejectsInvalidPayload(t *testing.T) {
	toast := &fakeToastOps{}
	n := newDesktopToastNotifierWithOps(toast, newFakeTrayOps())
	if got := n.show(`not-json`); !strings.Contains(got, `"ok":false`) {
		t.Fatalf("show = %s, want failure json", got)
	}
	if len(toast.shown) != 0 {
		t.Fatalf("shown = %v, want none", toast.shown)
	}
}

func TestDesktopToastNotifierTrayLifecycle(t *testing.T) {
	toast := &fakeToastOps{}
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(toast, tray)
	if tray.installed != 1 {
		t.Fatalf("tray installed = %d, want 1", tray.installed)
	}
	n.handleTrayClick()
	if tray.focused != 1 || len(tray.evaled) != 0 {
		t.Fatalf("tray click focused = %d evaled = %v, want focus only", tray.focused, tray.evaled)
	}
	n.close()
	if len(tray.removed) != 1 || toast.unreg != 1 {
		t.Fatalf("close removed = %v unreg = %d, want tray removed + unregistered", tray.removed, toast.unreg)
	}
	n.close()
	if len(tray.removed) != 1 || toast.unreg != 1 {
		t.Fatalf("second close = %v/%d, want idempotent", tray.removed, toast.unreg)
	}
}

func TestParseDesktopToastLaunchArgs(t *testing.T) {
	pid, sid, ok := parseDesktopToastLaunchArgs("projectId=p1&sessionId=s1")
	if !ok || pid != "p1" || sid != "s1" {
		t.Fatalf("parse = %q %q %v", pid, sid, ok)
	}
	for _, bad := range []string{"", "projectId=p1", "sessionId=s1", "a=b&c=d"} {
		if _, _, ok := parseDesktopToastLaunchArgs(bad); ok {
			t.Fatalf("parse(%q) = ok, want not ok", bad)
		}
	}
}

func TestDesktopToastNotifierActivationFocusesAndRoutes(t *testing.T) {
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(&fakeToastOps{}, tray)
	n.handleToastActivation("projectId=p2&sessionId=s2")
	if tray.focused != 1 {
		t.Fatalf("focused = %d, want 1", tray.focused)
	}
	if len(tray.evaled) != 1 ||
		!strings.Contains(tray.evaled[0], "wheelmaker:desktop-notification-click") ||
		!strings.Contains(tray.evaled[0], `"p2"`) || !strings.Contains(tray.evaled[0], `"s2"`) {
		t.Fatalf("evaled = %v", tray.evaled)
	}
}

func TestDesktopToastNotifierActivationWithBadArgsDoesNothing(t *testing.T) {
	tray := newFakeTrayOps()
	n := newDesktopToastNotifierWithOps(&fakeToastOps{}, tray)
	n.handleToastActivation("garbage")
	if tray.focused != 0 || len(tray.evaled) != 0 {
		t.Fatalf("focused = %d evaled = %v, want none", tray.focused, tray.evaled)
	}
}

func TestRemoveDesktopToastIconRoute(t *testing.T) {
	home := t.TempDir()
	path := desktopToastIconPath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte("png"), 0o644); err != nil {
		t.Fatalf("write icon: %v", err)
	}
	removeDesktopToastIconRoute(home)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("icon still present after cleanup")
	}
	removeDesktopToastIconRoute(home) // idempotent, must not error or panic
}

func TestDesktopToastAUMIDValues(t *testing.T) {
	got := map[string]string{}
	for _, v := range desktopToastAUMIDValues() {
		got[v[0]] = v[1]
	}
	want := map[string]string{
		"DisplayName":     "WheelMaker",
		"CustomActivator": desktopToastActivatorCLSID,
	}
	if len(got) != len(want) {
		t.Fatalf("values = %v, want exactly %v", got, want)
	}
	for name, value := range want {
		if got[name] != value {
			t.Fatalf("%s = %q, want %q", name, got[name], value)
		}
	}
}

func TestDesktopToastShortcutPath(t *testing.T) {
	got := desktopToastShortcutPath(`C:\Users\u\AppData\Roaming`)
	want := `C:\Users\u\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\WheelMaker.lnk`
	if got != want {
		t.Fatalf("shortcut path = %q, want %q", got, want)
	}
}

type fakeDesktopWindowOps struct {
	maximized bool
	shows     []uintptr
}

type fakeDesktopMonitorOps struct {
	info desktopMonitorInfo
	ok   bool
}

func (f fakeDesktopMonitorOps) monitorInfo(uintptr) (desktopMonitorInfo, bool) {
	return f.info, f.ok
}

type fakeDesktopWindowSubclassOps struct {
	fakeDesktopMonitorOps
	originalProc            uintptr
	replacementProc         uintptr
	restoredProc            uintptr
	window                  desktopWindowRect
	windowOK                bool
	callResult              uintptr
	callCount               int
	constraintAfterOriginal bool
}

func (f *fakeDesktopWindowSubclassOps) monitorInfo(hwnd uintptr) (desktopMonitorInfo, bool) {
	f.constraintAfterOriginal = f.callCount > 0
	return f.fakeDesktopMonitorOps.monitorInfo(hwnd)
}

func (f *fakeDesktopWindowSubclassOps) windowRect(uintptr) (desktopWindowRect, bool) {
	return f.window, f.windowOK
}

func (f *fakeDesktopWindowSubclassOps) replaceWindowProc(_ uintptr, replacement uintptr) (uintptr, bool) {
	f.replacementProc = replacement
	return f.originalProc, f.originalProc != 0
}

func (f *fakeDesktopWindowSubclassOps) restoreWindowProc(_ uintptr, original uintptr) {
	f.restoredProc = original
}

func (f *fakeDesktopWindowSubclassOps) callWindowProc(_ uintptr, _ uintptr, _ uintptr, _ uintptr, _ uintptr) uintptr {
	f.callCount++
	return f.callResult
}

func (f *fakeDesktopWindowOps) showWindow(_ uintptr, command uintptr) {
	f.shows = append(f.shows, command)
	if command == swRestore {
		f.maximized = false
	}
}

func (f *fakeDesktopWindowOps) isMaximized(uintptr) bool {
	return f.maximized
}

func TestDesktopMaximizeControllerUsesNativeMaximizeWhenRestored(t *testing.T) {
	ops := &fakeDesktopWindowOps{}
	controller := newDesktopMaximizeController(42, ops)

	controller.toggle()

	if len(ops.shows) != 1 || ops.shows[0] != swMaximize {
		t.Fatalf("toggle should call ShowWindow(SW_MAXIMIZE), shows=%v", ops.shows)
	}
}

func TestDesktopMaximizeControllerRestoresNativeMaximizedWindow(t *testing.T) {
	ops := &fakeDesktopWindowOps{maximized: true}
	controller := newDesktopMaximizeController(42, ops)

	controller.toggle()

	if len(ops.shows) != 1 || ops.shows[0] != swRestore {
		t.Fatalf("toggle should call ShowWindow(SW_RESTORE), shows=%v", ops.shows)
	}
}

func TestDesktopMaximizeBoundsUseBottomTaskbarWorkArea(t *testing.T) {
	monitor := desktopWindowRect{left: 0, top: 0, right: 2048, bottom: 1152}
	workArea := desktopWindowRect{left: 0, top: 0, right: 2048, bottom: 1104}

	position, size := desktopMaximizeBounds(monitor, workArea)

	if want := (desktopWindowPoint{x: 0, y: 0}); position != want {
		t.Fatalf("position=%+v, want %+v", position, want)
	}
	if want := (desktopWindowPoint{x: 2048, y: 1104}); size != want {
		t.Fatalf("size=%+v, want %+v", size, want)
	}
}

func TestDesktopMaximizeBoundsAreRelativeToNegativeMonitorOrigin(t *testing.T) {
	monitor := desktopWindowRect{left: -1920, top: -120, right: 0, bottom: 960}
	workArea := desktopWindowRect{left: -1872, top: -80, right: 0, bottom: 960}

	position, size := desktopMaximizeBounds(monitor, workArea)

	if want := (desktopWindowPoint{x: 48, y: 40}); position != want {
		t.Fatalf("position=%+v, want %+v", position, want)
	}
	if want := (desktopWindowPoint{x: 1872, y: 1040}); size != want {
		t.Fatalf("size=%+v, want %+v", size, want)
	}
}

func TestDesktopWorkAreaConstraintUpdatesNativeMaximizeBounds(t *testing.T) {
	ops := fakeDesktopMonitorOps{
		ok: true,
		info: desktopMonitorInfo{
			monitor:  desktopWindowRect{left: -1920, top: 0, right: 0, bottom: 1080},
			workArea: desktopWindowRect{left: -1920, top: 0, right: 0, bottom: 1040},
		},
	}
	info := desktopWindowMinMaxInfo{
		maxTrackSize: desktopWindowPoint{x: 3840, y: 2160},
	}

	if !constrainDesktopMaximizeToWorkArea(42, &info, ops) {
		t.Fatal("constraint should apply when monitor information is available")
	}
	if want := (desktopWindowPoint{x: 0, y: 0}); info.maxPosition != want {
		t.Fatalf("maxPosition=%+v, want %+v", info.maxPosition, want)
	}
	if want := (desktopWindowPoint{x: 1920, y: 1040}); info.maxSize != want {
		t.Fatalf("maxSize=%+v, want %+v", info.maxSize, want)
	}
	if want := (desktopWindowPoint{x: 3840, y: 2160}); info.maxTrackSize != want {
		t.Fatalf("maxTrackSize=%+v, want unchanged %+v", info.maxTrackSize, want)
	}
}

func TestDesktopWorkAreaConstraintPreservesDefaultsWithoutMonitorInfo(t *testing.T) {
	want := desktopWindowMinMaxInfo{
		maxPosition: desktopWindowPoint{x: -8, y: -8},
		maxSize:     desktopWindowPoint{x: 1936, y: 1096},
	}
	info := want

	if constrainDesktopMaximizeToWorkArea(42, &info, fakeDesktopMonitorOps{}) {
		t.Fatal("constraint should not apply without monitor information")
	}
	if info != want {
		t.Fatalf("info=%+v, want unchanged %+v", info, want)
	}
}

func TestDesktopWindowWorkAreaHookConstrainsAfterOriginalWindowProc(t *testing.T) {
	ops := &fakeDesktopWindowSubclassOps{
		fakeDesktopMonitorOps: fakeDesktopMonitorOps{
			ok: true,
			info: desktopMonitorInfo{
				monitor:  desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1080},
				workArea: desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1040},
			},
		},
		originalProc: 99,
		callResult:   73,
	}
	cleanup, err := installDesktopWindowWorkAreaConstraintWithOps(42, ops)
	if err != nil {
		t.Fatalf("installDesktopWindowWorkAreaConstraintWithOps: %v", err)
	}
	defer cleanup()
	info := desktopWindowMinMaxInfo{
		maxPosition: desktopWindowPoint{x: -8, y: -8},
		maxSize:     desktopWindowPoint{x: 1936, y: 1096},
	}

	result := desktopWindowWorkAreaProcWithInfo(42, wmGetMinMaxInfo, 0, 0, &info)

	if result != 73 {
		t.Fatalf("window proc result=%d, want original result 73", result)
	}
	if ops.callCount != 1 {
		t.Fatalf("original window proc call count=%d, want 1", ops.callCount)
	}
	if !ops.constraintAfterOriginal {
		t.Fatal("work-area constraint ran before the original window proc")
	}
	if want := (desktopWindowPoint{x: 0, y: 0}); info.maxPosition != want {
		t.Fatalf("maxPosition=%+v, want %+v", info.maxPosition, want)
	}
	if want := (desktopWindowPoint{x: 1920, y: 1040}); info.maxSize != want {
		t.Fatalf("maxSize=%+v, want %+v", info.maxSize, want)
	}
}

func TestDesktopWindowCustomFrameUsesEntireWindowAsClientArea(t *testing.T) {
	const wmNCCalcSizeTestMessage = 0x0083
	ops := &fakeDesktopWindowSubclassOps{
		originalProc: 99,
		callResult:   73,
	}
	cleanup, err := installDesktopWindowWorkAreaConstraintWithOps(44, ops)
	if err != nil {
		t.Fatalf("installDesktopWindowWorkAreaConstraintWithOps: %v", err)
	}
	defer cleanup()

	result := desktopWindowWorkAreaProcWithInfo(44, wmNCCalcSizeTestMessage, 1, 0, nil)

	if result != 0 {
		t.Fatalf("WM_NCCALCSIZE result=%d, want 0 for a borderless client area", result)
	}
}

func TestDesktopWindowCustomFrameHitTestsResizeBorders(t *testing.T) {
	const wmNCHitTestTestMessage = 0x0084
	ops := &fakeDesktopWindowSubclassOps{
		originalProc: 99,
		window:       desktopWindowRect{left: 0, top: 0, right: 1000, bottom: 800},
		windowOK:     true,
		callResult:   1,
	}
	cleanup, err := installDesktopWindowWorkAreaConstraintWithOps(45, ops)
	if err != nil {
		t.Fatalf("installDesktopWindowWorkAreaConstraintWithOps: %v", err)
	}
	defer cleanup()

	tests := []struct {
		name string
		x    uint16
		y    uint16
		want uintptr
	}{
		{name: "left", x: 0, y: 400, want: 10},
		{name: "top-left", x: 0, y: 0, want: 13},
		{name: "bottom-right", x: 999, y: 799, want: 17},
		{name: "client", x: 500, y: 400, want: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			lparam := uintptr(test.x) | uintptr(uint32(test.y)<<16)
			result := desktopWindowWorkAreaProcWithInfo(45, wmNCHitTestTestMessage, 0, lparam, nil)
			if result != test.want {
				t.Fatalf("WM_NCHITTEST at (%d,%d)=%d, want %d", test.x, test.y, result, test.want)
			}
		})
	}
}

func TestDesktopWindowWorkAreaHookRestoresOriginalWindowProc(t *testing.T) {
	ops := &fakeDesktopWindowSubclassOps{originalProc: 99}
	cleanup, err := installDesktopWindowWorkAreaConstraintWithOps(43, ops)
	if err != nil {
		t.Fatalf("installDesktopWindowWorkAreaConstraintWithOps: %v", err)
	}

	cleanup()

	if ops.restoredProc != 99 {
		t.Fatalf("restored window proc=%d, want 99", ops.restoredProc)
	}
}

func TestEncodeDesktopVirtualHTMLFileClipboardData(t *testing.T) {
	if got, want := unsafe.Sizeof(desktopFileDescriptorW{}), uintptr(592); got != want {
		t.Fatalf("FILEDESCRIPTORW size = %d, want %d", got, want)
	}
	if got, want := unsafe.Sizeof(desktopFileDescriptorA{}), uintptr(332); got != want {
		t.Fatalf("FILEDESCRIPTORA size = %d, want %d", got, want)
	}
	content := []byte("<h1>Hello</h1>")
	unicodeDescriptor, err := encodeDesktopFileGroupDescriptorW("README.html", int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(unicodeDescriptor), int(unsafe.Sizeof(desktopFileGroupDescriptorW{})); got != want {
		t.Fatalf("Unicode descriptor size = %d, want %d", got, want)
	}
	unicodeHeader := (*desktopFileGroupDescriptorW)(unsafe.Pointer(&unicodeDescriptor[0]))
	if unicodeHeader.cItems != 1 {
		t.Fatalf("Unicode descriptor item count = %d, want 1", unicodeHeader.cItems)
	}
	if unicodeHeader.fgd[0].dwFlags&desktopFileDescriptorUnicode == 0 {
		t.Fatal("Unicode descriptor is missing FD_UNICODE")
	}
	if got := windows.UTF16ToString(unicodeHeader.fgd[0].cFileName[:]); got != "README.html" {
		t.Fatalf("Unicode descriptor file name = %q", got)
	}
	if got := uint64(unicodeHeader.fgd[0].nFileSizeHigh)<<32 | uint64(unicodeHeader.fgd[0].nFileSizeLow); got != uint64(len(content)) {
		t.Fatalf("Unicode descriptor file size = %d, want %d", got, len(content))
	}

	ansiDescriptor, err := encodeDesktopFileGroupDescriptorA("README.html", int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(ansiDescriptor), int(unsafe.Sizeof(desktopFileGroupDescriptorA{})); got != want {
		t.Fatalf("ANSI descriptor size = %d, want %d", got, want)
	}
	ansiHeader := (*desktopFileGroupDescriptorA)(unsafe.Pointer(&ansiDescriptor[0]))
	if ansiHeader.cItems != 1 {
		t.Fatalf("ANSI descriptor item count = %d, want 1", ansiHeader.cItems)
	}
	if got := bytes.TrimRight(ansiHeader.fgd[0].cFileName[:], "\x00"); string(got) != "README.html" {
		t.Fatalf("ANSI descriptor file name = %q", got)
	}

	if got := encodeDesktopPreferredDropEffect(); !bytes.Equal(got, []byte{1, 0, 0, 0}) {
		t.Fatalf("preferred drop effect = %v, want copy", got)
	}
}

func TestSetDesktopHTMLFileClipboardRawFallbackUsesOwnerWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "README.html")
	if err := os.WriteFile(path, []byte("<h1>Hello</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}

	const ownerWindow = uintptr(0x1234)
	var openedWindow uintptr
	setCount := 0
	nextFormat := uintptr(100)
	operations := desktopHTMLClipboardOperations{
		openClipboard: func(hwnd uintptr) error {
			openedWindow = hwnd
			return nil
		},
		closeClipboard: func() {},
		emptyClipboard: func() error { return nil },
		registerClipboardFormat: func(string) (uintptr, error) {
			format := nextFormat
			nextFormat++
			return format, nil
		},
		setClipboardData: func(uintptr, []byte, string) error {
			setCount++
			return nil
		},
	}

	if err := setDesktopHTMLFileClipboardWithOperations(ownerWindow, path, operations); err != nil {
		t.Fatal(err)
	}
	if openedWindow != ownerWindow {
		t.Fatalf("OpenClipboard hwnd = %#x, want %#x", openedWindow, ownerWindow)
	}
	if setCount != 5 {
		t.Fatalf("clipboard format count = %d, want 5", setCount)
	}
}

func TestSetDesktopHTMLFileClipboardUsesShellOLEDataObject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "README.html")
	if err := os.WriteFile(path, []byte("<h1>Hello</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}

	const dataObject = uintptr(0x4321)
	var createdPath string
	var setDataObject uintptr
	released := false
	operations := desktopFileClipboardOLEOperations{
		createDataObject: func(gotPath string) (uintptr, func(), error) {
			createdPath = gotPath
			return dataObject, func() { released = true }, nil
		},
		setClipboard: func(gotDataObject uintptr) error {
			setDataObject = gotDataObject
			return nil
		},
	}

	if err := setDesktopHTMLFileClipboardWithOLEOperations(path, operations); err != nil {
		t.Fatal(err)
	}
	if createdPath != path {
		t.Fatalf("Shell data object path = %q, want %q", createdPath, path)
	}
	if setDataObject != dataObject {
		t.Fatalf("OleSetClipboard data object = %#x, want %#x", setDataObject, dataObject)
	}
	if !released {
		t.Fatal("Shell data object was not released after OleSetClipboard")
	}
}

func TestNewDesktopShellFileDataObjectFromHTMLFile(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	path := filepath.Join(t.TempDir(), "README.html")
	if err := os.WriteFile(path, []byte("<h1>Hello</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := initializeDesktopClipboardOLE(); err != nil {
		t.Fatal(err)
	}
	defer uninitializeDesktopClipboardOLE()

	dataObject, release, err := newDesktopShellFileDataObject(path)
	if err != nil {
		t.Fatal(err)
	}
	if dataObject == 0 {
		t.Fatal("Shell data object is empty")
	}
	if release == nil {
		t.Fatal("Shell data object release function is nil")
	}
	release()
}

func TestDesktopHTMLClipboardTransferStoreKeepsNamedHtmlFile(t *testing.T) {
	store := newDesktopHTMLClipboardTransferStore(t.TempDir(), 8, 4)

	transferID, err := store.begin("README.html", 6)
	if err != nil {
		t.Fatal(err)
	}
	if ok := store.append(transferID, 0, []byte{1, 2, 3}); !ok {
		t.Fatal("first chunk was rejected")
	}
	if _, ok := store.commit(transferID); ok {
		t.Fatal("partial transfer committed")
	}
	if ok := store.append(transferID, 1, []byte{4, 5, 6}); !ok {
		t.Fatal("second chunk was rejected")
	}
	path, ok := store.commit(transferID)
	if !ok {
		t.Fatal("complete transfer was rejected")
	}
	if filepath.Base(path) != "README.html" {
		t.Fatalf("clipboard file name = %q", filepath.Base(path))
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(content), string([]byte{1, 2, 3, 4, 5, 6}); got != want {
		t.Fatalf("clipboard file content = %q, want %q", got, want)
	}
}

func TestDesktopHTMLClipboardTransferStoreRejectsUnsafeFileNames(t *testing.T) {
	store := newDesktopHTMLClipboardTransferStore(t.TempDir(), 8, 4)
	for _, fileName := range []string{"../escape.html", "report.txt", "", "folder\\report.html"} {
		if _, err := store.begin(fileName, 2); err == nil {
			t.Fatalf("begin(%q) accepted an unsafe file name", fileName)
		}
	}
}

func writeDesktopUpdateTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopUpdateInfoUsesOnlyStandardInstall(t *testing.T) {
	oldVersion := desktopReleaseVersion
	desktopReleaseVersion = "v1.42"
	t.Cleanup(func() { desktopReleaseVersion = oldVersion })

	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "update_exe.bat")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(
		t,
		updater,
		"@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n@echo off\r\n",
	)

	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		readFile:   os.ReadFile,
	})
	info, err := controller.Info()
	if err != nil {
		t.Fatal(err)
	}
	wantSHA := sha256.Sum256([]byte("desktop"))
	if info.Version != "v1.42" || info.SHA256 != hex.EncodeToString(wantSHA[:]) || !info.UpdaterReady {
		t.Fatalf("info=%+v", info)
	}
}

func TestDesktopUpdateStartsOnlyTheFixedUpdater(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "update_exe.bat")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(
		t,
		updater,
		"@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n@echo off\r\n",
	)
	var startedPath string
	var startedPID int
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		readFile:   os.ReadFile,
		startUpdater: func(path string, pid int) error {
			startedPath, startedPID = path, pid
			return nil
		},
	})
	if err := controller.Start(42); err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(startedPath) != filepath.Clean(updater) || startedPID != 42 {
		t.Fatalf("started path=%q pid=%d", startedPath, startedPID)
	}
}

func TestDesktopUpdateRejectsPortableExecutable(t *testing.T) {
	home := t.TempDir()
	portable := filepath.Join(home, "WheelMakerDesktop.exe")
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return portable, nil },
		hashFile:   sha256File,
		readFile:   os.ReadFile,
	})
	if _, err := controller.Info(); err == nil || !strings.Contains(err.Error(), "standard install") {
		t.Fatalf("Info error=%v", err)
	}
}

func TestDesktopUpdateStartPropagatesLauncherFailure(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "update_exe.bat")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(
		t,
		updater,
		"@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n@echo off\r\n",
	)
	wantErr := errors.New("start failed")
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		readFile:   os.ReadFile,
		startUpdater: func(string, int) error {
			return wantErr
		},
	})
	if err := controller.Start(42); !errors.Is(err, wantErr) {
		t.Fatalf("Start error=%v", err)
	}
}

func TestDesktopUpdateRejectsBATWithoutCapability(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "update_exe.bat")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(t, updater, "@echo off\r\n")
	startCalls := 0
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		readFile:   os.ReadFile,
		startUpdater: func(string, int) error {
			startCalls++
			return nil
		},
	})

	info, err := controller.Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.UpdaterReady {
		t.Fatal("old BAT must not be reported ready")
	}
	err = controller.Start(42)
	if err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("Start error=%v", err)
	}
	if startCalls != 0 {
		t.Fatalf("start calls=%d", startCalls)
	}
}

func TestDesktopUpdateRejectsInvalidParentPID(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "update_exe.bat")
	writeDesktopUpdateTestFile(t, exe, "desktop")
	writeDesktopUpdateTestFile(
		t,
		updater,
		"@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n@echo off\r\n",
	)
	startCalls := 0
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		readFile:   os.ReadFile,
		startUpdater: func(string, int) error {
			startCalls++
			return nil
		},
	})

	for _, pid := range []int{0, -1} {
		if err := controller.Start(pid); err == nil {
			t.Fatalf("Start(%d) succeeded", pid)
		}
	}
	if startCalls != 0 {
		t.Fatalf("start calls=%d", startCalls)
	}
}

type recordingLocalDevExecutor struct {
	operation localDevOperation
	root      string
}

func (e *recordingLocalDevExecutor) Run(_ context.Context, root string, operation localDevOperation) error {
	e.root = root
	e.operation = operation
	return nil
}

func (e *recordingLocalDevExecutor) OpenDirectory(root string) error {
	e.root = root
	e.operation = localDevOpenDirectory
	return nil
}

func TestValidateLocalDevSourceRoot(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"server/go.mod", "app/package.json", "scripts/.keep"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	got, err := validateLocalDevSourceRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	if got != root {
		t.Fatalf("validateLocalDevSourceRoot() = %q, want %q", got, root)
	}
}

func TestParseLocalDevOperationRejectsUnknownValue(t *testing.T) {
	if _, err := parseLocalDevOperation("cmd /c whoami"); err == nil {
		t.Fatal("parseLocalDevOperation accepted an arbitrary command")
	}
}

func TestFileLocalDevConfigStoreRoundTripsSourcePath(t *testing.T) {
	store := newFileLocalDevConfigStore(filepath.Join(t.TempDir(), "dev-config.json"))
	if err := store.Save(localDevConfig{SourcePath: `D:\Code\WheelMaker`}); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.SourcePath != `D:\Code\WheelMaker` {
		t.Fatalf("SourcePath = %q", got.SourcePath)
	}
}

func TestLocalDevControllerRunsOnlyWhitelistedOperationFromSavedSource(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"server/go.mod", "app/package.json", "scripts/.keep"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store := newFileLocalDevConfigStore(filepath.Join(t.TempDir(), "dev-config.json"))
	if err := store.Save(localDevConfig{SourcePath: root}); err != nil {
		t.Fatal(err)
	}
	executor := &recordingLocalDevExecutor{}
	controller := newLocalDevController(store, executor)
	if _, err := controller.Run(context.Background(), "build"); err != nil {
		t.Fatal(err)
	}
	if executor.root != root || executor.operation != localDevBuild {
		t.Fatalf("executor = root %q operation %q", executor.root, executor.operation)
	}
	if _, err := controller.Run(context.Background(), "cmd /c whoami"); err == nil {
		t.Fatal("controller accepted an arbitrary operation")
	}
}

func TestLocalDevControllerValidatesBeforeSavingSource(t *testing.T) {
	store := newFileLocalDevConfigStore(filepath.Join(t.TempDir(), "dev-config.json"))
	controller := newLocalDevController(store, &recordingLocalDevExecutor{})
	if _, err := controller.SaveSource(t.TempDir()); err == nil {
		t.Fatal("SaveSource accepted a non-WheelMaker directory")
	}
}

func TestSetDesktopFileClipboardUsesShellOLEDataObject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.bin")
	if err := os.WriteFile(path, []byte{1, 2, 3}, 0o600); err != nil {
		t.Fatal(err)
	}

	const dataObject = uintptr(0x4321)
	var createdPath string
	var setDataObject uintptr
	released := false
	operations := desktopFileClipboardOLEOperations{
		createDataObject: func(gotPath string) (uintptr, func(), error) {
			createdPath = gotPath
			return dataObject, func() { released = true }, nil
		},
		setClipboard: func(gotDataObject uintptr) error {
			setDataObject = gotDataObject
			return nil
		},
	}

	if err := setDesktopFileClipboardWithOLEOperations(path, operations); err != nil {
		t.Fatal(err)
	}
	if createdPath != path || setDataObject != dataObject || !released {
		t.Fatalf("createdPath=%q setDataObject=%#x released=%v", createdPath, setDataObject, released)
	}
}

func TestSetDesktopFileClipboardRawFallbackPublishesDropFormats(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large-file.bin")
	if err := os.WriteFile(path, []byte{1}, 0o600); err != nil {
		t.Fatal(err)
	}

	const ownerWindow = uintptr(0x1234)
	var openedWindow uintptr
	var labels []string
	nextFormat := uintptr(100)
	operations := desktopFileClipboardOperations{
		openClipboard: func(hwnd uintptr) error {
			openedWindow = hwnd
			return nil
		},
		closeClipboard: func() {},
		emptyClipboard: func() error { return nil },
		registerClipboardFormat: func(name string) (uintptr, error) {
			if name != desktopPreferredDropEffectFormat {
				t.Fatalf("registered format %q", name)
			}
			format := nextFormat
			nextFormat++
			return format, nil
		},
		setClipboardData: func(_ uintptr, _ []byte, label string) error {
			labels = append(labels, label)
			return nil
		},
	}

	if err := setDesktopFileClipboardWithOperations(ownerWindow, path, operations); err != nil {
		t.Fatal(err)
	}
	if openedWindow != ownerWindow {
		t.Fatalf("OpenClipboard hwnd=%#x, want %#x", openedWindow, ownerWindow)
	}
	if got, want := labels, []string{"file drop", "preferred drop effect"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("clipboard labels=%v, want %v", got, want)
	}
}

func TestSetDesktopFileClipboardRejectsInvalidTargets(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "folder")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"relative.txt",
		filepath.Join(root, "missing.txt"),
		directory,
	} {
		t.Run(path, func(t *testing.T) {
			if err := setDesktopFileClipboardWithOLEOperations(path, desktopFileClipboardOLEOperations{}); err == nil {
				t.Fatal("setDesktopFileClipboardWithOLEOperations() error=nil")
			}
		})
	}
}

func TestPreviewWindowURLUsesDedicatedPathWithoutQueryOrHash(t *testing.T) {
	got, err := previewWindowURL("https://example.com/workbench/")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://example.com/workbench/preview-window" {
		t.Fatalf("unexpected Preview URL %q", got)
	}
	if _, err := previewWindowURL("https://example.com/?token=secret"); err == nil {
		t.Fatal("query-bearing base URL must not produce a companion route")
	}
}

func TestDesktopPreviewChannelNameIsUniquePerMainWindow(t *testing.T) {
	first, err := newDesktopPreviewChannelName()
	if err != nil {
		t.Fatal(err)
	}
	second, err := newDesktopPreviewChannelName()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatalf("preview channel names must be unique: %q", first)
	}
	for _, name := range []string{first, second} {
		if !strings.HasPrefix(name, "wheelmaker.preview-workbench.v1.") {
			t.Fatalf("unexpected preview channel name %q", name)
		}
	}
}

func TestResolvePreviewWindowRectRelocatesOffscreenBounds(t *testing.T) {
	areas := []desktopMonitorWorkArea{{
		monitor:  desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1080},
		workArea: desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1040},
	}}
	if desktopWindowRectVisible(desktopWindowRect{left: 3000, top: 3000, right: 4100, bottom: 3780}, areas) {
		t.Fatal("offscreen bounds should not be considered visible")
	}
	if desktopWindowRectVisible(desktopWindowRect{left: 1800, top: 900, right: 2900, bottom: 1680}, areas) {
		t.Fatal("a tiny partially visible bounds should be relocated")
	}
}

func TestExtractDeepSeekToken(t *testing.T) {
	const token = "abcdefghijklmnopqrstuvwxyz012345"
	cases := map[string]string{
		`"` + token + `"`:            token,
		`""`:                         "",
		`"Bearer ` + token + `"`:     token,
		token:                        token,
		`"short"`:                    "",
		`"token with spaces and xx"`: "",
	}
	for input, want := range cases {
		if got := extractDeepSeekToken(input); got != want {
			t.Fatalf("extractDeepSeekToken(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDeepSeekLoginSessionPollsUntilToken(t *testing.T) {
	reads := 0
	read := func() (string, bool) {
		reads++
		if reads < 2 {
			return "", false
		}
		return "session-token", true
	}
	session := newDeepSeekLoginSession(read)
	for i := 0; i < 5; i++ {
		if token, done := session.Poll(); done {
			if token != "session-token" {
				t.Fatalf("token=%q", token)
			}
			return
		}
	}
	t.Fatal("session did not resolve")
}

func TestWindowsLocalDevExecutorRequiresConfirmation(t *testing.T) {
	called := false
	executor := &windowsLocalDevExecutor{
		confirm: func(localDevOperation, string) bool { return false },
		run: func(context.Context, string, []string, string, []string) error {
			called = true
			return nil
		},
	}
	if err := executor.Run(context.Background(), `D:\Code\WheelMaker`, localDevBuild); err == nil {
		t.Fatal("Run succeeded after confirmation was declined")
	}
	if called {
		t.Fatal("Run invoked the build script after confirmation was declined")
	}
}

func TestWindowsLocalDevExecutorUsesNodeScriptAndFixedOperation(t *testing.T) {
	var file string
	var args []string
	executor := &windowsLocalDevExecutor{
		confirm: func(localDevOperation, string) bool { return true },
		run: func(_ context.Context, gotFile string, gotArgs []string, _ string, _ []string) error {
			file, args = gotFile, gotArgs
			return nil
		},
	}
	if err := executor.Run(context.Background(), `D:\Code\WheelMaker`, localDevRestart); err != nil {
		t.Fatal(err)
	}
	if file != "node.exe" {
		t.Fatalf("file = %q", file)
	}
	want := []string{`D:\Code\WheelMaker\scripts\dev-local.mjs`, "restart"}
	if len(args) != len(want) || args[0] != want[0] || args[1] != want[1] {
		t.Fatalf("args = %q, want %q", args, want)
	}
}

func TestFormatWindowsLocalDevCommandErrorDropsInvalidOutputBytes(t *testing.T) {
	err := formatWindowsLocalDevCommandError(
		errors.New("exit status 1"),
		[]byte{'[', 'd', 'e', 'v', ']', ' ', 'f', 'a', 'i', 'l', 'e', 'd', ' ', 0x81, 0x82},
	)
	if !utf8.ValidString(err.Error()) {
		t.Fatalf("error is not valid UTF-8: %q", err)
	}
	if strings.ContainsRune(err.Error(), utf8.RuneError) {
		t.Fatalf("error contains replacement glyphs: %q", err)
	}
}

func TestDesktopResizeGripSpecsCoverOnlyWindowBorders(t *testing.T) {
	specs := desktopResizeGripSpecs(desktopWindowPoint{x: 100, y: 80}, desktopWindowPoint{x: 8, y: 8})
	want := []desktopResizeGripSpec{
		{hitTest: htTopLeft, rect: desktopWindowRect{left: 0, top: 0, right: 8, bottom: 8}},
		{hitTest: htTop, rect: desktopWindowRect{left: 8, top: 0, right: 92, bottom: 8}},
		{hitTest: htTopRight, rect: desktopWindowRect{left: 92, top: 0, right: 100, bottom: 8}},
		{hitTest: htLeft, rect: desktopWindowRect{left: 0, top: 8, right: 8, bottom: 72}},
		{hitTest: htRight, rect: desktopWindowRect{left: 92, top: 8, right: 100, bottom: 72}},
		{hitTest: htBottomLeft, rect: desktopWindowRect{left: 0, top: 72, right: 8, bottom: 80}},
		{hitTest: htBottom, rect: desktopWindowRect{left: 8, top: 72, right: 92, bottom: 80}},
		{hitTest: htBottomRight, rect: desktopWindowRect{left: 92, top: 72, right: 100, bottom: 80}},
	}

	if len(specs) != len(want) {
		t.Fatalf("grip count=%d, want %d", len(specs), len(want))
	}
	for index := range want {
		if specs[index] != want[index] {
			t.Errorf("grip[%d]=%+v, want %+v", index, specs[index], want[index])
		}
	}
}

func TestDesktopResizeOverlayForwardsResizeDragToParent(t *testing.T) {
	hitTest := desktopResizeOverlayMessage(wmNCLButtonDown, htBottomRight)
	if !hitTest.forward || hitTest.result != 0 {
		t.Fatalf("WM_NCLBUTTONDOWN action=%+v, want forward with zero result", hitTest)
	}

	nonClientHitTest := desktopResizeOverlayMessage(wmNCHitTest, htBottomRight)
	if nonClientHitTest.forward || nonClientHitTest.result != htBottomRight {
		t.Fatalf("WM_NCHITTEST action=%+v, want local hit-test result", nonClientHitTest)
	}
}

func TestWindowsDesktopUpdaterUsesVisibleShellWithFixedArguments(t *testing.T) {
	updater := filepath.Join(t.TempDir(), "update_exe.bat")
	var gotOperation string
	var gotTarget string
	var gotParameters string
	var gotShowCommand int
	err := launchDesktopUpdater(updater, 42, func(
		operation string,
		target string,
		parameters string,
		showCommand int,
	) (uintptr, error) {
		gotOperation = operation
		gotTarget = target
		gotParameters = parameters
		gotShowCommand = showCommand
		return 33, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotOperation != "open" ||
		gotTarget != updater ||
		gotParameters != "42" ||
		gotShowCommand != desktopUpdaterShowNormal {
		t.Fatalf(
			"operation=%q target=%q parameters=%q showCommand=%d",
			gotOperation,
			gotTarget,
			gotParameters,
			gotShowCommand,
		)
	}
}

func TestWindowsDesktopUpdaterReturnsShellLaunchFailure(t *testing.T) {
	err := launchDesktopUpdater("update_exe.bat", 42, func(
		string,
		string,
		string,
		int,
	) (uintptr, error) {
		return 31, nil
	})
	if err == nil || !strings.Contains(err.Error(), "code 31") {
		t.Fatalf("error=%v", err)
	}
}

func TestWindowsDesktopUpdaterReturnsShellAdapterFailure(t *testing.T) {
	wantErr := filepath.ErrBadPattern
	err := launchDesktopUpdater("update_exe.bat", 42, func(
		string,
		string,
		string,
		int,
	) (uintptr, error) {
		return 0, wantErr
	})
	if err != wantErr {
		t.Fatalf("error=%v want=%v", err, wantErr)
	}
}

func TestDesktopConfigStorePersistsPreviewWindowBounds(t *testing.T) {
	store := newFileDesktopConfigStore(t.TempDir() + "\\config.json")
	expected := desktopPreviewWindowBounds{Left: 1920, Top: 48, Width: 1100, Height: 780}
	if err := store.Save(desktopConfig{
		ConnectionMode:      desktopConnectionGateway,
		BaseURL:             "https://example.com/workbench",
		PreviewWindowBounds: &expected,
	}); err != nil {
		t.Fatal(err)
	}

	got, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.PreviewWindowBounds == nil || *got.PreviewWindowBounds != expected {
		t.Fatalf("PreviewWindowBounds = %+v, want %+v", got.PreviewWindowBounds, expected)
	}
}

func TestNormalizeDesktopConfigPreservesPreviewWindowBounds(t *testing.T) {
	expected := &desktopPreviewWindowBounds{Left: 12, Top: 24, Width: 1100, Height: 780}
	got, changed, err := normalizeDesktopConfig(desktopConfig{
		BaseURL:             "https://example.com/workbench/",
		PreviewWindowBounds: expected,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("legacy config should be normalized")
	}
	if got.PreviewWindowBounds == nil || *got.PreviewWindowBounds != *expected {
		t.Fatalf("PreviewWindowBounds = %+v, want %+v", got.PreviewWindowBounds, expected)
	}
}
