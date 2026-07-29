package hubconfig

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
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

func TestFlickerBridgeEnabledDefaultsToFalse(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	enabled, err := store.FlickerBridgeEnabled()
	if err != nil {
		t.Fatal(err)
	}
	if enabled {
		t.Fatal("enabled defaults to true")
	}
}

func TestUpdateFlickerBridgeEnabledPreservesMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateFlickerBridgeEnabled(true); err != nil {
		t.Fatal(err)
	}
	enabled, err := store.FlickerBridgeEnabled()
	if err != nil || !enabled {
		t.Fatalf("enabled = %v, err = %v", enabled, err)
	}
	if mode, err := store.FlickerBridgeMode(); err != nil || mode != FlickerBridgeModeV2 {
		t.Fatalf("mode = %q, err = %v", mode, err)
	}
}

func TestUpdateAPIKeySetAndClear(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	if err := store.UpdateAPIKey(APIKeyKimi, "set", "sk-kimi-1", now); err != nil {
		t.Fatal(err)
	}
	if value, err := store.APIKeyValue(APIKeyKimi); err != nil || value != "sk-kimi-1" {
		t.Fatalf("value = %q, err = %v", value, err)
	}
	if err := store.UpdateAPIKey(APIKeyKimi, "clear", "", now); err != nil {
		t.Fatal(err)
	}
	if value, err := store.APIKeyValue(APIKeyKimi); err != nil || value != "" {
		t.Fatalf("value after clear = %q, err = %v", value, err)
	}
}

func TestUpdateAPIKeyRejectsInvalidInput(t *testing.T) {
	now := time.Now()
	for name, call := range map[string]func(*Store) error{
		"unknown-key": func(s *Store) error { return s.UpdateAPIKey("openai", "set", "x", now) },
		"bad-action":  func(s *Store) error { return s.UpdateAPIKey(APIKeyKimi, "replace", "x", now) },
		"empty-value": func(s *Store) error { return s.UpdateAPIKey(APIKeyKimi, "set", "", now) },
		"oversized": func(s *Store) error {
			return s.UpdateAPIKey(APIKeyKimi, "set", string(bytes.Repeat([]byte("x"), maxSecretBytes+1)), now)
		},
		"read-unknown": func(s *Store) error { _, err := s.APIKeyValue("openai"); return err },
	} {
		t.Run(name, func(t *testing.T) {
			store := New(filepath.Join(t.TempDir(), "hub-config.json"))
			if err := call(store); err == nil {
				t.Fatal("invalid input was accepted")
			}
		})
	}
}

func TestUpdateAPIKeyPreservesFlickerBridgeSection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAPIKey(APIKeyQwen, "set", "sk-qwen-1", time.Now()); err != nil {
		t.Fatal(err)
	}
	if mode, err := store.FlickerBridgeMode(); err != nil || mode != FlickerBridgeModeV2 {
		t.Fatalf("mode = %q, err = %v", mode, err)
	}
}

func TestSnapshotReportsConfiguredFlagsOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateAPIKey(APIKeyZAI, "set", "sk-zai-secret", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateFlickerBridgeEnabled(true); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.FlickerBridge.Enabled || snapshot.FlickerBridge.Mode != FlickerBridgeModeV1 {
		t.Fatalf("flickerBridge snapshot = %#v", snapshot.FlickerBridge)
	}
	if !snapshot.APIKeys["zai"].Configured || snapshot.APIKeys["zai"].UpdatedAt == "" {
		t.Fatalf("zai snapshot = %#v", snapshot.APIKeys["zai"])
	}
	if snapshot.APIKeys["kimi"].Configured {
		t.Fatalf("kimi snapshot = %#v", snapshot.APIKeys["kimi"])
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("sk-zai-secret")) {
		t.Fatalf("snapshot leaks secret value: %s", raw)
	}
}

func TestSnapshotLoadsLegacyConfigWithoutAPIKeysSection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	writeHubConfigFixture(t, path, []byte(`{"version":1,"flickerBridge":{"mode":"v2"}}`))
	store := New(path)
	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.FlickerBridge.Mode != FlickerBridgeModeV2 || snapshot.FlickerBridge.Enabled {
		t.Fatalf("flickerBridge snapshot = %#v", snapshot.FlickerBridge)
	}
	if len(snapshot.APIKeys) != len(APIKeyNames) {
		t.Fatalf("apiKeys snapshot = %#v", snapshot.APIKeys)
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
