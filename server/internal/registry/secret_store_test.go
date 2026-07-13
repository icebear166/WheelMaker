package registry

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

func TestSecretStoreSetReplaceClearAndFreshLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	writeSecretStoreConfig(t, path)
	store := newSecretStore(path)
	now := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)

	if err := store.Set(secretKindDeepSeek, "first-key", now); err != nil {
		t.Fatalf("Set(first): %v", err)
	}
	if value, ok, err := store.Value(secretKindDeepSeek); err != nil || !ok || value != "first-key" {
		t.Fatalf("Value()=%q,%v,%v", value, ok, err)
	}

	cfg, err := shared.LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig(): %v", err)
	}
	cfg.Log.Level = "debug"
	raw, _ := json.MarshalIndent(cfg, "", "  ")
	if err := shared.WriteConfigFile(path, append(raw, '\n')); err != nil {
		t.Fatalf("external config update: %v", err)
	}

	replacedAt := now.Add(time.Hour)
	if err := store.Set(secretKindDeepSeek, "replacement-key", replacedAt); err != nil {
		t.Fatalf("Set(replacement): %v", err)
	}
	cfg, err = shared.LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig(replaced): %v", err)
	}
	if cfg.Log.Level != "debug" || cfg.Registry.Token != "custom-short" || len(cfg.Projects) != 1 {
		t.Fatalf("non-secret config was not preserved: %+v", cfg)
	}
	if cfg.Secrets.DeepSeek.Value != "replacement-key" || !cfg.Secrets.DeepSeek.UpdatedAt.Equal(replacedAt) {
		t.Fatalf("deepseek=%+v", cfg.Secrets.DeepSeek)
	}

	if err := store.Clear(secretKindDeepSeek, replacedAt.Add(time.Hour)); err != nil {
		t.Fatalf("Clear(): %v", err)
	}
	if value, ok, err := store.Value(secretKindDeepSeek); err != nil || ok || value != "" {
		t.Fatalf("Value(after clear)=%q,%v,%v", value, ok, err)
	}
}

func TestSecretStoreStatusNeverSerializesValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	writeSecretStoreConfig(t, path)
	store := newSecretStore(path)
	if err := store.Set(secretKindVolcengineASR, "never-return-this", time.Now().UTC()); err != nil {
		t.Fatalf("Set(): %v", err)
	}
	status, err := store.Status()
	if err != nil {
		t.Fatalf("Status(): %v", err)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("Marshal(): %v", err)
	}
	for _, forbidden := range [][]byte{[]byte("never-return-this"), []byte(`"value"`), []byte("apiKey"), []byte("config.json")} {
		if bytes.Contains(encoded, forbidden) {
			t.Fatalf("status leaks %q: %s", forbidden, encoded)
		}
	}
}

func TestSecretStoreWriteFailureKeepsDiskVisibleValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	writeSecretStoreConfig(t, path)
	store := newSecretStore(path)
	if err := store.Set(secretKindMiMoTTS, "stable-key", time.Now().UTC()); err != nil {
		t.Fatalf("Set(): %v", err)
	}
	store.writeConfig = func(string, []byte) error { return errors.New("write failed") }
	if err := store.Set(secretKindMiMoTTS, "lost-key", time.Now().UTC()); err == nil {
		t.Fatal("Set() succeeded with failing writer")
	}
	if value, ok, err := store.Value(secretKindMiMoTTS); err != nil || !ok || value != "stable-key" {
		t.Fatalf("Value()=%q,%v,%v", value, ok, err)
	}
}

func TestSecretProtocolValidatesSetOnlyUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	writeSecretStoreConfig(t, path)
	s := New(Config{ConfigPath: path})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()
	connectRegistryTestClient(t, ws)

	tests := []struct {
		payload map[string]any
		code    string
	}{
		{map[string]any{"kind": "deepseek", "action": "set", "value": ""}, codeInvalidArgument},
		{map[string]any{"kind": "deepseek", "action": "set", "value": strings.Repeat("x", 16*1024+1)}, codeInvalidArgument},
		{map[string]any{"kind": "deepseek", "action": "clear", "value": "must-reject"}, codeInvalidArgument},
	}
	for i, tt := range tests {
		mustWriteJSON(t, ws, testEnvelope{RequestID: int64(i + 2), Type: "request", Method: protocol.RegistryMethodSecuritySecretUpdate, Payload: tt.payload})
		resp := mustReadEnvelope(t, ws)
		if resp.Type != "error" || resp.Payload["code"] != tt.code {
			t.Fatalf("case %d response=%#v", i, resp)
		}
	}

	mustWriteJSON(t, ws, testEnvelope{RequestID: 10, Type: "request", Method: protocol.RegistryMethodSecuritySecretUpdate, Payload: map[string]any{"kind": "deepseek", "action": "set", "value": "server-only-key"}})
	if resp := mustReadEnvelope(t, ws); resp.Type != "response" {
		t.Fatalf("set response=%#v", resp)
	}
	mustWriteJSON(t, ws, testEnvelope{RequestID: 11, Type: "request", Method: protocol.RegistryMethodSecuritySecretStatus, Payload: map[string]any{}})
	resp := mustReadEnvelope(t, ws)
	encoded, _ := json.Marshal(resp)
	for _, forbidden := range []string{"server-only-key", `"value"`, "apiKey", path} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("status response leaks %q: %s", forbidden, encoded)
		}
	}
}

func connectRegistryTestClient(t *testing.T, ws interface {
	WriteJSON(any) error
	ReadJSON(any) error
}) {
	t.Helper()
	if err := ws.WriteJSON(testEnvelope{RequestID: 1, Type: "request", Method: "connect.init", Payload: map[string]any{"clientName": "secret-test", "clientVersion": "test", "protocolVersion": protocol.DefaultProtocolVersion, "role": "client"}}); err != nil {
		t.Fatalf("connect write: %v", err)
	}
	var resp testEnvelope
	if err := ws.ReadJSON(&resp); err != nil {
		t.Fatalf("connect read: %v", err)
	}
	if resp.Type != "response" {
		t.Fatalf("connect response=%#v", resp)
	}
}

func writeSecretStoreConfig(t *testing.T, path string) {
	t.Helper()
	raw := []byte(`{"projects":[{"name":"p","path":"."}],"registry":{"token":"custom-short","hubId":"hub-a"},"log":{"level":"warn"}}`)
	if err := shared.WriteConfigFile(path, raw); err != nil {
		t.Fatalf("WriteConfigFile(): %v", err)
	}
	if info, err := os.Stat(path); err != nil {
		t.Fatalf("Stat(): %v", err)
	} else if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("config mode=%#o, want private", info.Mode().Perm())
	}
}
