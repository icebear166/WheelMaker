package main

import "testing"

func TestDesktopConfigStorePersistsPreviewWindowBounds(t *testing.T) {
	store := newFileDesktopConfigStore(t.TempDir() + "\\config.json")
	expected := desktopPreviewWindowBounds{Left: 1920, Top: 48, Width: 1100, Height: 780}
	if err := store.Save(desktopConfig{
		ConnectionMode: desktopConnectionGateway,
		BaseURL:        "https://example.com/workbench",
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
