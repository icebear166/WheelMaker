package usage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type openCodeAuthEntry struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

var openCodeProviderKeys = map[ProviderID]string{
	ProviderKimi:     "kimi-for-coding",
	ProviderZAI:      "zai-coding-plan",
	ProviderDeepSeek: "deepseek",
}

func defaultOpenCodeAuthPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "share", "opencode", "auth.json")
}

func readOpenCodeCredentials(path string) map[ProviderID]string {
	body, err := os.ReadFile(path)
	if err != nil {
		return map[ProviderID]string{}
	}
	var entries map[string]openCodeAuthEntry
	if json.Unmarshal(body, &entries) != nil {
		return map[ProviderID]string{}
	}
	credentials := make(map[ProviderID]string, len(openCodeProviderKeys))
	for providerID, authKey := range openCodeProviderKeys {
		entry := entries[authKey]
		credential := strings.TrimSpace(entry.Key)
		if strings.EqualFold(strings.TrimSpace(entry.Type), "api") && credential != "" {
			credentials[providerID] = credential
		}
	}
	return credentials
}
