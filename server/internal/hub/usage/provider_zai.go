package usage

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const defaultZAIEndpoint = "https://api.z.ai/api/monitor/usage/quota/limit"

type ZAIScanner struct {
	sources  []ProviderCredentialSource
	client   *http.Client
	endpoint string
}

func NewZAIScanner(sources []ProviderCredentialSource, client *http.Client, endpoint string) *ZAIScanner {
	if client == nil {
		client = http.DefaultClient
	}
	if strings.TrimSpace(endpoint) == "" {
		endpoint = defaultZAIEndpoint
	}
	return &ZAIScanner{sources: uniqueCredentialSources(sources), client: client, endpoint: endpoint}
}

func (s *ZAIScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderZAI, Name: "ZAI", Accounts: []Account{}}
	if s == nil || len(s.sources) == 0 {
		result.Status, result.Message = ProviderUnavailable, "not authenticated"
		return result
	}
	for _, source := range s.sources {
		payload, message := fetchProviderJSON(ctx, s.client, s.endpoint, source.Credential)
		account := Account{LocalID: source.LocalID, Identity: Identity{Kind: "source", Label: source.Label}, Limits: []Limit{}}
		if message != "" {
			account.Status, account.Message = ProviderError, message
		} else if limits, plan, err := parseZAILimits(payload); err != nil {
			account.Status, account.Message = ProviderError, "invalid response"
		} else {
			account.Status, account.Limits, account.Plan = ProviderOK, limits, plan
		}
		result.Accounts = append(result.Accounts, account)
	}
	result.Status = providerStatus(result.Accounts)
	return result
}

func parseZAILimits(payload map[string]any) ([]Limit, string, error) {
	data, _ := payload["data"].(map[string]any)
	items, _ := data["limits"].([]any)
	limits := make([]Limit, 0, 3)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		kind, _ := item["type"].(string)
		unit := int64(number(item["unit"]))
		id, label := "", ""
		windowKind := WindowFixed
		windowDurationMins := int64(0)
		switch {
		case kind == "TOKENS_LIMIT" && unit == 3:
			id, label, windowDurationMins = "5h", "5 hours", 300
		case kind == "TOKENS_LIMIT" && unit == 6:
			id, label, windowDurationMins = "week", "Week", 10080
		case kind == "TIME_LIMIT" && unit == 5:
			id, label = "mcp-month", "MCP month"
			windowKind = WindowCalendarMonth
		default:
			continue
		}
		resetMillis := int64(number(item["nextResetTime"]))
		var reset *time.Time
		if resetMillis > 0 {
			value := time.UnixMilli(resetMillis).UTC()
			reset = &value
		}
		limits = append(limits, Limit{
			ID: id, Label: label, RemainingPercent: clampPercent(100 - number(item["percentage"])),
			WindowKind: windowKind, WindowDurationMins: windowDurationMins, ResetsAt: reset,
		})
	}
	if len(limits) == 0 {
		return nil, "", fmt.Errorf("limits missing")
	}
	plan, _ := data["level"].(string)
	return limits, strings.TrimSpace(plan), nil
}
