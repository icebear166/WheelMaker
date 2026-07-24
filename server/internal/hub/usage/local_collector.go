package usage

import (
	"context"
	"net/http"
	"time"
)

type LocalCollector struct {
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

func (c *LocalCollector) Scan(ctx context.Context) []ProviderSnapshot {
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
	if c.KimiAPIKey != "" {
		kimiSources = append(kimiSources, KimiCredentialSource{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: c.KimiAPIKey})
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
		{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: c.ZAIAPIKey},
		{LocalID: "opencode", Label: "OpenCode", Credential: credentials[ProviderZAI]},
	}
	deepSeekSources := []ProviderCredentialSource{
		{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: c.DeepSeekAPIKey},
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
