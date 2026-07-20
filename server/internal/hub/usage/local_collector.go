package usage

import (
	"context"
	"net/http"
	"time"
)

type LocalCollector struct {
	AuthPath                string
	KimiCodeCredentialsPath string
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
	kimiSources := make([]KimiCredentialSource, 0, 2)
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
	return (Collector{Scanners: []ProviderScanner{
		NewCodexScanner(c.Binary),
		NewKimiScanner(kimiSources, client, ""),
		NewZAIScanner(credentials[ProviderZAI], client, ""),
		NewDeepSeekScanner(credentials[ProviderDeepSeek], client, ""),
	}}).Scan(scanContext)
}
