package usage

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

const maxProviderResponseBytes = 2 << 20

func providerErrorMessage(_ string, status int, _ []byte, err error) string {
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return "unauthorized"
	}
	if err != nil || status < 200 || status >= 300 {
		return "network error"
	}
	return "invalid response"
}

func fetchProviderJSON(ctx context.Context, client *http.Client, endpoint, credential string) (map[string]any, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "network error"
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(credential))
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, providerErrorMessage(credential, 0, nil, err)
	}
	defer res.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(res.Body, maxProviderResponseBytes))
	if readErr != nil || res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, providerErrorMessage(credential, res.StatusCode, body, readErr)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, "invalid response"
	}
	return payload, ""
}

func providerStatus(accounts []Account) ProviderStatus {
	if len(accounts) == 0 {
		return ProviderUnavailable
	}
	for _, account := range accounts {
		if account.Status == ProviderOK {
			return ProviderOK
		}
	}
	return ProviderError
}

func clampPercent(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}
