package usage

import (
	"context"
	"net/http"
	"time"
)

type LocalCollector struct {
	AuthPath string
	Client   *http.Client
	Binary   string
	Timeout  time.Duration
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
	return (Collector{Scanners: []ProviderScanner{
		NewCodexScanner(c.Binary),
		NewKimiScanner(credentials[ProviderKimi], client, ""),
		NewZAIScanner(credentials[ProviderZAI], client, ""),
		NewDeepSeekScanner(credentials[ProviderDeepSeek], client, ""),
	}}).Scan(scanContext)
}
