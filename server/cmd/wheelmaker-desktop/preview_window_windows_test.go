//go:build windows

package main

import (
	"strings"
	"testing"
)

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

func TestCompanionRuntimeInitScriptScopesThePreviewChannel(t *testing.T) {
	const channelName = "wheelmaker.preview-workbench.test-instance"
	script := desktopCompanionRuntimeInitScript(channelName)
	if !strings.Contains(script, channelName) {
		t.Fatalf("companion init script does not contain channel name %q", channelName)
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

func TestPreviewWindowClosedScriptUsesTheInstanceChannel(t *testing.T) {
	const channelName = "wheelmaker.preview-workbench.test-close"
	script := previewWindowClosedScript(channelName)
	if !strings.Contains(script, channelName) || !strings.Contains(script, "preview-window-closed") {
		t.Fatalf("close script does not target channel %q", channelName)
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
