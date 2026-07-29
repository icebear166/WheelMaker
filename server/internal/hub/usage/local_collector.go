package usage

import (
	"context"
	"net/http"
	"sync"
	"time"
)

type LocalCollector struct {
	mu                      sync.RWMutex
	AuthPath                string
	FlickerCredentialPath   string
	KimiCodeCredentialsPath string
	KimiAPIKey              string
	ZAIAPIKey               string
	DeepSeekAPIKey          string
	Client                  *http.Client
	Binary                  string
	Timeout                 time.Duration
}

func NewLocalCollector(authPath string) *LocalCollector {
	return &LocalCollector{
		AuthPath: authPath,
		Client:   &http.Client{Timeout: 15 * time.Second},
		Timeout:  30 * time.Second,
	}
}

// UpdateAPIKeys replaces the Hub-managed credentials used by future scans.
func (c *LocalCollector) UpdateAPIKeys(kimi, zai, deepSeek string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.KimiAPIKey = kimi
	c.ZAIAPIKey = zai
	c.DeepSeekAPIKey = deepSeek
	c.mu.Unlock()
}

func (c *LocalCollector) apiKeysSnapshot() (kimi, zai, deepSeek string) {
	if c == nil {
		return "", "", ""
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.KimiAPIKey, c.ZAIAPIKey, c.DeepSeekAPIKey
}

func (c *LocalCollector) Scan(ctx context.Context) []ProviderSnapshot {
	kimiAPIKey, zaiAPIKey, deepSeekAPIKey := c.apiKeysSnapshot()
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	scanContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	client := c.Client
	if client == nil {
		client = http.DefaultClient
	}
	authPath := c.AuthPath
	if authPath == "" {
		authPath = defaultOpenCodeAuthPath()
	}
	credentials := readOpenCodeCredentials(authPath)
	kimiSources := make([]KimiCredentialSource, 0, 3)
	if kimiAPIKey != "" {
		kimiSources = append(kimiSources, KimiCredentialSource{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: kimiAPIKey})
	}
	if credential := credentials[ProviderKimi]; credential != "" {
		kimiSources = append(kimiSources, KimiCredentialSource{LocalID: "opencode", Label: "OpenCode", Credential: credential})
	}
	kimiCodePath := c.KimiCodeCredentialsPath
	if kimiCodePath == "" {
		kimiCodePath = defaultKimiCodeCredentialsPath()
	}
	if credential := readKimiCodeCredential(kimiCodePath, time.Now()); credential != "" {
		kimiSources = append(kimiSources, KimiCredentialSource{LocalID: "kimi-code", Label: "Kimi Code", Credential: credential})
	}
	flickerPath := c.FlickerCredentialPath
	if flickerPath == "" {
		flickerPath = defaultFlickerCredentialPath()
	}
	zaiSources := []ProviderCredentialSource{
		{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: zaiAPIKey},
		{LocalID: "opencode", Label: "OpenCode", Credential: credentials[ProviderZAI]},
	}
	deepSeekSources := []ProviderCredentialSource{
		{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: deepSeekAPIKey},
		{LocalID: "opencode", Label: "OpenCode", Credential: credentials[ProviderDeepSeek]},
	}
	return (Collector{Scanners: []ProviderScanner{
		NewCodexScanner(c.Binary),
		NewFlickerScanner(readFlickerCredential(flickerPath), client, "", ""),
		NewKimiScanner(kimiSources, client, ""),
		NewZAIScanner(zaiSources, client, ""),
		NewDeepSeekScanner(deepSeekSources, client, ""),
	}}).Scan(scanContext)
}
