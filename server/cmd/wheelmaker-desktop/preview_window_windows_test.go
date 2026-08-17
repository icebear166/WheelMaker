//go:build windows

package main

import "testing"

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

func TestResolvePreviewWindowRectRelocatesOffscreenBounds(t *testing.T) {
	areas := []desktopMonitorWorkArea{{
		monitor:  desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1080},
		workArea: desktopWindowRect{left: 0, top: 0, right: 1920, bottom: 1040},
	}}
	if desktopWindowRectVisible(desktopWindowRect{left: 3000, top: 3000, right: 4100, bottom: 3780}, areas) {
		t.Fatal("offscreen bounds should not be considered visible")
	}
	if !desktopWindowRectVisible(desktopWindowRect{left: 1800, top: 900, right: 2900, bottom: 1680}, areas) {
		t.Fatal("partially visible bounds should remain usable")
	}
}
