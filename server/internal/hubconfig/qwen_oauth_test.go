package hubconfig

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestQwenOAuthCredentialIsStoredPrivatelyAndSnapshottedSanitized(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hub-config.json")
	store := New(path)
	expiresAt := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	credential := QwenOAuthCredential{
		AccessToken:  "access-token-secret",
		RefreshToken: "refresh-token-secret",
		ExpiresAt:    &expiresAt,
		Region:       "cn-beijing",
		Site:         "domestic",
	}
	if err := store.UpdateQwenOAuthCredential("set", credential, updatedAt); err != nil {
		t.Fatal(err)
	}
	got, err := store.QwenOAuthCredential()
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessToken != credential.AccessToken || got.RefreshToken != credential.RefreshToken {
		t.Fatalf("credential=%+v", got)
	}
	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.QwenOAuth.Configured || snapshot.QwenOAuth.UpdatedAt != updatedAt.Format(time.RFC3339) || snapshot.QwenOAuth.ExpiresAt != expiresAt.Format(time.RFC3339) {
		t.Fatalf("qwen OAuth snapshot=%+v", snapshot.QwenOAuth)
	}
	rawSnapshot, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(rawSnapshot, []byte(credential.AccessToken)) || bytes.Contains(rawSnapshot, []byte(credential.RefreshToken)) {
		t.Fatalf("snapshot leaked OAuth secret: %s", rawSnapshot)
	}
	rawConfig, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(rawConfig, []byte(credential.AccessToken)) || !bytes.Contains(rawConfig, []byte(credential.RefreshToken)) {
		t.Fatalf("config did not persist OAuth credential: %s", rawConfig)
	}
}

func TestQwenOAuthClearRemovesCredential(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.UpdateQwenOAuthCredential("set", QwenOAuthCredential{AccessToken: "token"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateQwenOAuthCredential("clear", QwenOAuthCredential{}, time.Now()); err != nil {
		t.Fatal(err)
	}
	credential, err := store.QwenOAuthCredential()
	if err != nil {
		t.Fatal(err)
	}
	if credential.AccessToken != "" {
		t.Fatalf("credential=%+v, want empty", credential)
	}
	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.QwenOAuth.Configured {
		t.Fatalf("snapshot=%+v, want OAuth cleared", snapshot.QwenOAuth)
	}
}
