package hubconfig

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestStoreFlickerBridgeModeDefaultsToV1WithoutCreatingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	mode, err := store.FlickerBridgeMode()
	if err != nil {
		t.Fatal(err)
	}
	if mode != FlickerBridgeModeV1 {
		t.Fatalf("mode = %q, want v1", mode)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("default read created config: %v", err)
	}
}

func TestUpdateFlickerBridgeModeCreatesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	if mode, err := store.FlickerBridgeMode(); err != nil || mode != FlickerBridgeModeV2 {
		t.Fatalf("mode = %q, err = %v", mode, err)
	}
}

func TestUpdateFlickerBridgeModePreservesOtherSections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	writeHubConfigFixture(t, path, []byte(`{"version":1,"future":{"enabled":true},"flickerBridge":{"mode":"v1","futureField":7}}`))
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(readHubConfigFixture(t, path), &root); err != nil {
		t.Fatal(err)
	}
	future := root["future"].(map[string]any)
	if future["enabled"] != true {
		t.Fatalf("future section = %#v", future)
	}
	flicker := root["flickerBridge"].(map[string]any)
	if flicker["futureField"] != float64(7) || flicker["mode"] != "v2" {
		t.Fatalf("flickerBridge section = %#v", flicker)
	}
}

func TestUpdateFlickerBridgeModeRejectsInvalidMode(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.UpdateFlickerBridgeMode("v3"); err == nil {
		t.Fatal("invalid mode was accepted")
	}
}

func TestUpdateFlickerBridgeModeDoesNotRewriteInvalidInput(t *testing.T) {
	for name, original := range map[string][]byte{
		"corrupt":         []byte(`{"version":`),
		"unknown-version": []byte(`{"version":2,"flickerBridge":{"mode":"v1"}}`),
		"oversized":       bytes.Repeat([]byte("x"), maxConfigBytes+1),
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "hub-config.json")
			writeHubConfigFixture(t, path, original)
			store := New(path)
			if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err == nil {
				t.Fatal("invalid input was accepted")
			}
			if got := readHubConfigFixture(t, path); !bytes.Equal(got, original) {
				t.Fatalf("invalid input was rewritten")
			}
		})
	}
}

func TestStoreSerializesConcurrentUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	var wait sync.WaitGroup
	for index := 0; index < 20; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			mode := FlickerBridgeModeV1
			if index%2 == 0 {
				mode = FlickerBridgeModeV2
			}
			if err := store.UpdateFlickerBridgeMode(mode); err != nil {
				t.Errorf("update: %v", err)
			}
		}(index)
	}
	wait.Wait()
	if _, err := store.FlickerBridgeMode(); err != nil {
		t.Fatal(err)
	}
}

func writeHubConfigFixture(t *testing.T, path string, raw []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readHubConfigFixture(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
