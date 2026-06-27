//go:build windows

package main

import "testing"

func TestWebView2RemoteDebugArgumentUsesConfiguredPort(t *testing.T) {
	got := webView2RemoteDebugArgument(desktopWindowOptions{
		RemoteDebugEnabled: true,
		RemoteDebugPort:    desktopRemoteDebugPort,
	})

	if got != "--remote-debugging-port=9222" {
		t.Fatalf("argument=%q", got)
	}
}

func TestWebView2RemoteDebugArgumentFallsBackToDefaultPort(t *testing.T) {
	got := webView2RemoteDebugArgument(desktopWindowOptions{
		RemoteDebugEnabled: true,
	})

	if got != "--remote-debugging-port=9222" {
		t.Fatalf("argument=%q", got)
	}
}

func TestMergeWebView2AdditionalBrowserArgumentsPreservesExistingArgs(t *testing.T) {
	got := mergeWebView2AdditionalBrowserArguments(" --disable-features=msSmartScreenProtection ", "--remote-debugging-port=9222")

	if got != "--disable-features=msSmartScreenProtection --remote-debugging-port=9222" {
		t.Fatalf("merged arguments=%q", got)
	}
}

func TestWebView2DebugSettingIsEnabledForRemoteDebug(t *testing.T) {
	if !webView2DebugEnabled(desktopWindowOptions{RemoteDebugEnabled: true}) {
		t.Fatal("remote debug should enable WebView2 developer tools")
	}
}
