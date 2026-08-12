//go:build windows

package main

import (
	"os"
	"strings"
	"testing"
)

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

func TestDesktopWebViewUsesNativeNavigationAndProfileAdapter(t *testing.T) {
	var source strings.Builder
	for _, name := range []string{"webview_windows.go", "webview_profile_windows.go"} {
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		source.Write(body)
	}
	for _, want := range []string{
		"installDesktopWebViewPolicyAdapter",
		"NavigationStarting",
		"FrameNavigationStarting",
		"ClearBrowsingData",
	} {
		if !strings.Contains(source.String(), want) {
			t.Errorf("Windows WebView integration missing %q", want)
		}
	}
	if strings.Contains(source.String(), "Insecure"+"SkipVerify") {
		t.Fatal("Windows WebView integration must not bypass certificate validation")
	}
}

func TestDesktopBootstrapBindsLocalhostSelection(t *testing.T) {
	source, err := os.ReadFile("webview_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"desktopBootstrapSelectLocalhostBinding",
		"authorize(desktopBridgeSelectLocalhost)",
		"desktopRuntime.SelectLocalhost(context.Background())",
	} {
		if !strings.Contains(string(source), want) {
			t.Errorf("Windows Desktop bootstrap binding missing %q", want)
		}
	}
}

func TestDesktopBootstrapReadySignalFollowsCommittedNavigation(t *testing.T) {
	script := desktopRuntimeInitScript()
	for _, want := range []string{
		"const desktopBootstrapReady = new Promise",
		"window.addEventListener('__wheelMakerDesktopBootstrapReady'",
		"ready: desktopBootstrapReady",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("Desktop runtime Bootstrap readiness script missing %q", want)
		}
	}

	source, err := os.ReadFile("webview_profile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	sourceText := string(source)
	commitIndex := strings.Index(sourceText, "CommitTopLevelNavigation(epoch, rawURL)")
	signalIndex := strings.Index(sourceText, "a.webview.Eval(desktopBootstrapReadySignalScript())")
	if commitIndex < 0 || signalIndex < 0 || signalIndex < commitIndex {
		t.Fatalf("Bootstrap ready signal must follow committed navigation: commit=%d signal=%d", commitIndex, signalIndex)
	}
}

func TestDesktopRuntimeInitScriptAuthorizesExactLocalhostPage(t *testing.T) {
	baseURL := fixedDesktopLocalhostTestURL()
	script := desktopRuntimeInitScript(baseURL)
	for _, want := range []string{
		baseURL,
		"const trustedLocalhostBase = new URL(trustedLocalhostURL)",
		"location.origin === trustedLocalhostBase.origin",
		"location.pathname === trustedLocalhostBase.pathname",
		"location.pathname.startsWith(trustedLocalhostBase.pathname)",
		"installTrustedDesktopBridge();",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("Desktop runtime Localhost predicate missing %q", want)
		}
	}
	if strings.Contains(desktopRuntimeInitScript(), baseURL) {
		t.Fatal("Desktop runtime script leaked a Localhost Base Path without an authorized target")
	}

	webviewSource, err := os.ReadFile("webview_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(webviewSource), "desktopRuntimeInitScript(opts.Runtime.TrustedLocalhostURL())") {
		t.Fatal("Windows WebView initialization does not pass the authorized Localhost URL")
	}
	adapterSource, err := os.ReadFile("webview_profile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"a.runtime.TrustedLocalhostURL()",
		"desktopRuntimeInitScript(localhostURL)",
		"a.runtime.NavigationFailureMessage()",
	} {
		if !strings.Contains(string(adapterSource), want) {
			t.Errorf("Windows navigation adapter missing %q", want)
		}
	}
}

func TestDesktopWebViewInstallsWorkAreaConstraintForCustomTitleBar(t *testing.T) {
	source, err := os.ReadFile("webview_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	sourceText := string(source)
	frameIndex := strings.Index(sourceText, "applyCustomTitleBarFrame(hwnd)")
	installIndex := strings.Index(sourceText, "installDesktopWindowWorkAreaConstraintWithOps(hwnd, win32DesktopWindowSubclassOps{})")
	cleanupIndex := strings.Index(sourceText, "defer cleanupWindowWorkAreaConstraint()")
	themeIndex := strings.Index(sourceText, "applyDesktopWindowTheme(hwnd, opts.ThemeColor)")
	suppressBorderIndex := strings.Index(sourceText, "suppressDesktopWindowBorder(hwnd)")
	bridgeIndex := strings.Index(sourceText, "bindDesktopWindowBridge(w, hwnd, opts.Runtime)")
	themeGuardIndex := strings.Index(sourceText, "if !opts.CustomTitleBar {")
	if frameIndex < 0 || installIndex < 0 || installIndex > frameIndex || cleanupIndex < installIndex ||
		suppressBorderIndex < frameIndex || bridgeIndex < suppressBorderIndex || themeGuardIndex < 0 || themeIndex < themeGuardIndex {
		t.Fatalf(
			"custom frame setup order/theme guard is incomplete: frame=%d install=%d cleanup=%d themeGuard=%d theme=%d suppress=%d bridge=%d",
			frameIndex,
			installIndex,
			cleanupIndex,
			themeGuardIndex,
			themeIndex,
			suppressBorderIndex,
			bridgeIndex,
		)
	}
}

func TestDesktopWebViewInstallsResizeHitTestBridgeForCustomTitleBar(t *testing.T) {
	source, err := os.ReadFile("webview_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	sourceText := string(source)
	installIndex := strings.Index(sourceText, "installDesktopWindowWorkAreaConstraintWithOps(hwnd, win32DesktopWindowSubclassOps{})")
	resizeBridgeIndex := strings.Index(sourceText, "installDesktopWindowResizeHitTestOverlay(hwnd)")
	frameIndex := strings.Index(sourceText, "applyCustomTitleBarFrame(hwnd)")
	if installIndex < 0 || resizeBridgeIndex < installIndex || frameIndex < resizeBridgeIndex {
		t.Fatalf(
			"custom frame must install resize hit-test bridge after window hook and before frame change: install=%d resizeBridge=%d frame=%d",
			installIndex,
			resizeBridgeIndex,
			frameIndex,
		)
	}
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

func TestDesktopRuntimeFileActionBindings(t *testing.T) {
	script := desktopRuntimeInitScript()
	for _, want := range []string{
		"openProjectFileInVSCode",
		"showProjectFileInFolder",
		"openFileInVSCode",
		"showFileInFolder",
		"copyFileToClipboard",
		desktopOpenProjectFileInVSCodeBinding,
		desktopShowProjectFileInFolderBinding,
		desktopOpenFileInVSCodeBinding,
		desktopShowFileInFolderBinding,
		desktopCopyFileToClipboardBinding,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("desktop runtime script missing %q", want)
		}
	}

	bootstrapStart := strings.Index(script, "window.wheelMakerBootstrap")
	if bootstrapStart < 0 {
		t.Fatal("desktop runtime script bootstrap object section was not found")
	}
	bootstrapEnd := strings.Index(script[bootstrapStart:], "return;")
	if bootstrapEnd < 0 {
		t.Fatal("desktop runtime script bootstrap object section was not found")
	}
	bootstrapSection := script[bootstrapStart : bootstrapStart+bootstrapEnd]
	for _, privateName := range []string{
		desktopOpenProjectFileInVSCodeBinding,
		desktopShowProjectFileInFolderBinding,
		desktopOpenFileInVSCodeBinding,
		desktopShowFileInFolderBinding,
		desktopCopyFileToClipboardBinding,
	} {
		if strings.Contains(bootstrapSection, privateName) {
			t.Errorf("bootstrap object exposes private file action binding %q", privateName)
		}
	}
	remoteRelative := strings.Index(script[bootstrapStart+bootstrapEnd:], "window.WheelMakerDesktop = Object.freeze({")
	if remoteRelative < 0 {
		t.Fatal("desktop runtime remote section was not found")
	}
	remoteStart := bootstrapStart + bootstrapEnd + remoteRelative
	localRelative := strings.Index(script[remoteStart+1:], "window.WheelMakerDesktop = Object.freeze({")
	if localRelative < 0 {
		t.Fatal("desktop runtime Local Dev section was not found")
	}
	localDevSection := script[remoteStart+1+localRelative:]
	for _, privateName := range []string{
		desktopOpenFileInVSCodeBinding,
		desktopShowFileInFolderBinding,
		desktopCopyFileToClipboardBinding,
	} {
		if strings.Contains(localDevSection, privateName) {
			t.Errorf("Local Dev object exposes absolute file action binding %q", privateName)
		}
	}

	source, err := os.ReadFile("webview_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"authorize(desktopBridgeOpenProjectFileInVSCode)",
		"newDefaultDesktopFileActionEnvironment().openProjectFileInVSCode(projectRoot, relativePath)",
		"authorize(desktopBridgeShowProjectFileInFolder)",
		"newDefaultDesktopFileActionEnvironment().showProjectFileInFolder(projectRoot, relativePath)",
		"authorize(desktopBridgeOpenFileInVSCode)",
		"newDefaultDesktopFileActionEnvironment().openFileInVSCode(absolutePath)",
		"authorize(desktopBridgeShowFileInFolder)",
		"newDefaultDesktopFileActionEnvironment().showFileInFolder(absolutePath)",
		"authorize(desktopBridgeCopyFileToClipboard)",
		"setDesktopFileClipboard(hwnd, absolutePath)",
	} {
		if !strings.Contains(string(source), want) {
			t.Errorf("Windows desktop binding source missing %q", want)
		}
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

func TestDesktopRuntimeSelfUpdateBindingsStayRemoteAndCloseAfterLaunch(t *testing.T) {
	script := desktopRuntimeInitScript()
	for _, want := range []string{
		"getDesktopUpdateInfo",
		"requestDesktopUpdate",
		desktopGetUpdateInfoBinding,
		desktopRequestUpdateBinding,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("desktop runtime script missing %q", want)
		}
	}

	bootstrapStart := strings.Index(script, "window.wheelMakerBootstrap")
	if bootstrapStart < 0 {
		t.Fatal("desktop runtime bootstrap section was not found")
	}
	bootstrapEnd := strings.Index(script[bootstrapStart:], "return;")
	if bootstrapEnd < 0 {
		t.Fatal("desktop runtime bootstrap section end was not found")
	}
	remoteRelative := strings.Index(script[bootstrapStart+bootstrapEnd:], "window.WheelMakerDesktop = Object.freeze({")
	if remoteRelative < 0 {
		t.Fatal("desktop runtime remote section was not found")
	}
	remoteStart := bootstrapStart + bootstrapEnd + remoteRelative
	localRelative := strings.Index(script[remoteStart+1:], "window.WheelMakerDesktop = Object.freeze({")
	if localRelative < 0 {
		t.Fatal("desktop runtime Local Dev section was not found")
	}
	localDevStart := remoteStart + 1 + localRelative
	bootstrapSection := script[bootstrapStart : bootstrapStart+bootstrapEnd]
	localDevSection := script[localDevStart:]
	for _, privateName := range []string{desktopGetUpdateInfoBinding, desktopRequestUpdateBinding} {
		if strings.Contains(bootstrapSection, privateName) {
			t.Errorf("bootstrap object exposes Desktop update binding %q", privateName)
		}
		if strings.Contains(localDevSection, privateName) {
			t.Errorf("Local Dev object exposes Desktop update binding %q", privateName)
		}
	}

	source, err := os.ReadFile("webview_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	sourceText := string(source)
	for _, want := range []string{
		"authorize(desktopBridgeGetUpdateInfo)",
		"authorize(desktopBridgeRequestUpdate)",
		"updateController.Start(os.Getpid())",
	} {
		if !strings.Contains(sourceText, want) {
			t.Errorf("Windows Desktop update binding source missing %q", want)
		}
	}
	startIndex := strings.Index(sourceText, "updateController.Start(os.Getpid())")
	if startIndex < 0 {
		t.Fatal("Desktop updater start call was not found")
	}
	closeIndex := strings.Index(sourceText[startIndex:], "postWindowClose(hwnd)")
	if closeIndex < 0 {
		t.Fatal("Desktop close must occur after the updater starts")
	}
}

func TestDesktopRuntimeExposesOnlyTheLocalDevEntryOnHTTPS(t *testing.T) {
	script := desktopRuntimeInitScript()
	if !strings.Contains(script, "requestLocalDevMode") || !strings.Contains(script, desktopEnterLocalDevBinding) {
		t.Fatal("desktop runtime script is missing the Local Dev entry binding")
	}
	source, err := os.ReadFile("webview_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), "authorize(desktopBridgeEnterLocalDev)") {
		t.Fatal("Windows bridge does not authorize Local Dev entry")
	}
}

func TestDesktopRuntimeInjectsLocalDevControlsOnlyForExactLoopback(t *testing.T) {
	script := desktopRuntimeInitScript()
	for _, want := range []string{
		"location.hostname === '127.0.0.1'",
		"location.port === '4173'",
		"localDev: Object.freeze",
		desktopGetLocalDevStateBinding,
		desktopSaveLocalDevSourceBinding,
		desktopRunLocalDevBinding,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("desktop runtime script missing %q", want)
		}
	}
}
