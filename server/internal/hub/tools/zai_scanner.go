package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// zaiQuotaLimitResponse mirrors api.z.ai/api/monitor/usage/quota/limit.
type zaiQuotaLimitResponse struct {
	Code    float64      `json:"code"`
	Data    zaiQuotaData `json:"data"`
	Success bool         `json:"success"`
}

type zaiQuotaData struct {
	Level  string         `json:"level"`
	Limits []zaiLimitItem `json:"limits"`
}

type zaiLimitItem struct {
	Type          string  `json:"type"`
	Unit          int64   `json:"unit"`
	Number        int64   `json:"number"`
	Percentage    float64 `json:"percentage"`
	Usage         float64 `json:"usage"`
	CurrentValue  float64 `json:"currentValue"`
	Remaining     float64 `json:"remaining"`
	NextResetTime int64   `json:"nextResetTime"`
}

// parseZAIQuotaLimit returns the 5h (TOKENS_LIMIT unit=3), week (TOKENS_LIMIT
// unit=6) and MCP-monthly (TIME_LIMIT unit=5) windows plus the plan level.
// nextResetTime arrives in milliseconds; it is converted to seconds.
func parseZAIQuotaLimit(payload map[string]any) (fiveHour, week, mcp *codexWindow, level string, err error) {
	raw, mErr := json.Marshal(payload)
	if mErr != nil {
		return nil, nil, nil, "", mErr
	}
	var resp zaiQuotaLimitResponse
	if uErr := json.Unmarshal(raw, &resp); uErr != nil {
		return nil, nil, nil, "", fmt.Errorf("decode zai quota: %w", uErr)
	}
	level = strings.TrimSpace(resp.Data.Level)
	for _, item := range resp.Data.Limits {
		resetsAt := item.NextResetTime / 1000 // ms → s
		w := &codexWindow{usedPercent: int64(item.Percentage), resetsAt: resetsAt}
		switch {
		case item.Type == "TOKENS_LIMIT" && item.Unit == 3:
			fiveHour = w
		case item.Type == "TOKENS_LIMIT" && item.Unit == 6:
			week = w
		case item.Type == "TIME_LIMIT" && item.Unit == 5:
			mcp = w
		}
	}
	return fiveHour, week, mcp, level, nil
}

// fetchZAIQuotaLimit calls GET api.z.ai/api/monitor/usage/quota/limit with the bearer key.
func fetchZAIQuotaLimit(ctx context.Context, httpClient *http.Client, apiKey string) (map[string]any, error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return nil, fmt.Errorf("zai api key is empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.z.ai/api/monitor/usage/quota/limit", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("zai api key is invalid or unauthorized")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("zai quota request failed: http %d %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode zai quota response: %w", err)
	}
	return payload, nil
}
