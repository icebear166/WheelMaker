package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// kimiUsagesResponse mirrors the subset of api.kimi.com/coding/v1/usages that we use.
type kimiUsagesResponse struct {
	Usage  kimiQuota       `json:"usage"`
	Limits []kimiLimitItem `json:"limits"`
}

type kimiQuota struct {
	Limit     string `json:"limit"`
	Remaining string `json:"remaining"`
	ResetTime string `json:"resetTime"`
}

type kimiLimitItem struct {
	Window kimiWindow `json:"window"`
	Detail kimiDetail `json:"detail"`
}

type kimiWindow struct {
	Duration int64  `json:"duration"`
	TimeUnit string `json:"timeUnit"`
}

type kimiDetail struct {
	Limit     string `json:"limit"`
	Used      string `json:"used"`
	Remaining string `json:"remaining"`
	ResetTime string `json:"resetTime"`
}

// parseKimiUsages extracts the 5h and weekly windows. 5h comes from limits[0]
// (window.duration==300 minutes); week comes from usage (top-level remaining).
// totalQuota and parallel are intentionally ignored.
func parseKimiUsages(payload map[string]any) (fiveHour, week *codexWindow, err error) {
	raw, mErr := json.Marshal(payload)
	if mErr != nil {
		return nil, nil, mErr
	}
	var resp kimiUsagesResponse
	if uErr := json.Unmarshal(raw, &resp); uErr != nil {
		return nil, nil, fmt.Errorf("decode kimi usages: %w", uErr)
	}
	for _, item := range resp.Limits {
		if item.Window.Duration == 300 {
			limit := parseFloat64(item.Detail.Limit)
			used := parseFloat64(item.Detail.Used)
			if limit > 0 {
				fiveHour = &codexWindow{
					usedPercent: int64((used / limit) * 100),
					resetsAt:    parseKimiResetTime(item.Detail.ResetTime),
				}
			}
			break
		}
	}
	limit := parseFloat64(resp.Usage.Limit)
	remaining := parseFloat64(resp.Usage.Remaining)
	if limit > 0 {
		used := limit - remaining
		if used < 0 {
			used = 0
		}
		week = &codexWindow{
			usedPercent: int64((used / limit) * 100),
			resetsAt:    parseKimiResetTime(resp.Usage.ResetTime),
		}
	}
	return fiveHour, week, nil
}

func parseKimiResetTime(iso string) int64 {
	s := strings.TrimSpace(iso)
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return 0
	}
	return t.Unix()
}

// fetchKimiUsages calls GET api.kimi.com/coding/v1/usages with the bearer key.
func fetchKimiUsages(ctx context.Context, httpClient *http.Client, apiKey string) (map[string]any, error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return nil, fmt.Errorf("kimi api key is empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.kimi.com/coding/v1/usages", nil)
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
		return nil, fmt.Errorf("kimi api key is invalid or unauthorized")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("kimi usages request failed: http %d %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode kimi usages response: %w", err)
	}
	return payload, nil
}
