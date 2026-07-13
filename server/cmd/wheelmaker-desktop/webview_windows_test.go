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
	if strings.Contains(source.String(), "InsecureSkipVerify") {
		t.Fatal("Windows WebView integration must not bypass certificate validation")
	}
}
