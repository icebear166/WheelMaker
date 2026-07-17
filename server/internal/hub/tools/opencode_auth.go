package tools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// openCodeAuthEntry mirrors one provider block in ~/.local/share/opencode/auth.json.
type openCodeAuthEntry struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

// readOpenCodeProviderKeys reads the opencode auth.json at path and returns a
// map of providerID -> plaintext API key for every entry whose type == "api".
// OAuth entries (type "oauth") are skipped — their tokens are not API keys.
func readOpenCodeProviderKeys(path string) (map[string]string, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw map[string]openCodeAuthEntry
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(raw))
	for provider, entry := range raw {
		if strings.ToLower(strings.TrimSpace(entry.Type)) != "api" {
			continue
		}
		key := strings.TrimSpace(entry.Key)
		if key == "" {
			continue
		}
		out[provider] = key
	}
	return out, nil
}

// defaultOpenCodeAuthPath returns the conventional auth.json location. Returns
// "" if the home directory cannot be resolved.
func defaultOpenCodeAuthPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "share", "opencode", "auth.json")
}

// sha256Fingerprint returns the hex-encoded sha256 of a key, used for in-hub
// deduplication without leaking the plaintext.
func sha256Fingerprint(key string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(key)))
	return hex.EncodeToString(sum[:])
}
