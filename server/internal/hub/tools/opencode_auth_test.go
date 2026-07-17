package tools

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadOpenCodeProviderKeys(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	payload := `{
		"openai": {"type":"oauth"},
		"kimi-for-coding": {"type":"api","key":"sk-kimi-abc"},
		"zai-coding-plan": {"type":"api","key":"4466.zai"},
		"deepseek": {"type":"api","key":"sk-ds-xyz"}
	}`
	if err := os.WriteFile(authPath, []byte(payload), 0o600); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}
	got, err := readOpenCodeProviderKeys(authPath)
	if err != nil {
		t.Fatalf("readOpenCodeProviderKeys: %v", err)
	}
	want := map[string]string{
		"kimi-for-coding": "sk-kimi-abc",
		"zai-coding-plan": "4466.zai",
		"deepseek":        "sk-ds-xyz",
	}
	for provider, key := range want {
		if got[provider] != key {
			t.Errorf("key[%s] = %q, want %q", provider, got[provider], key)
		}
	}
	if _, ok := got["openai"]; ok {
		t.Errorf("openai (oauth) should not appear in api-key map")
	}
}

func TestSha256Fingerprint(t *testing.T) {
	a := sha256Fingerprint("key-1")
	b := sha256Fingerprint("key-1")
	c := sha256Fingerprint("key-2")
	if a != b {
		t.Errorf("same key must produce same fingerprint: %q vs %q", a, b)
	}
	if a == c {
		t.Errorf("different keys must produce different fingerprints")
	}
	if len(a) != 64 {
		t.Errorf("fingerprint length = %d, want 64 hex chars", len(a))
	}
}
