package usage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type kimiCodeCredentialsFile struct {
	AccessToken string `json:"access_token"`
	ExpiresAt   int64  `json:"expires_at"`
}

func defaultKimiCodeCredentialsPath() string {
	if home := strings.TrimSpace(os.Getenv("KIMI_CODE_HOME")); home != "" {
		return filepath.Join(home, "credentials", "kimi-code.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".kimi-code", "credentials", "kimi-code.json")
}

// readKimiCodeCredential returns the access token only while it is still
// valid. WheelMaker never refreshes OAuth tokens and never writes this file;
// kimi-cli refreshes it on its own runs.
func readKimiCodeCredential(path string, now time.Time) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var creds kimiCodeCredentialsFile
	if json.Unmarshal(body, &creds) != nil {
		return ""
	}
	token := strings.TrimSpace(creds.AccessToken)
	if token == "" || creds.ExpiresAt <= now.Unix() {
		return ""
	}
	return token
}
