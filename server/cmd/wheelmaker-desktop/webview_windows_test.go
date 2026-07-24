//go:build windows

package main

import (
	"os"
	"strings"
	"testing"
)

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

func TestDesktopRuntimeFileActionBindings(t *testing.T) {
	script := desktopRuntimeInitScript()
	for _, want := range []string{
		"openProjectFileInVSCode",
		"showProjectFileInFolder",
		"openFileInVSCode",
		"showFileInFolder",
		desktopOpenProjectFileInVSCodeBinding,
		desktopShowProjectFileInFolderBinding,
		desktopOpenFileInVSCodeBinding,
		desktopShowFileInFolderBinding,
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
