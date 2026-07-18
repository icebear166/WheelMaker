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
	credential string
	client     *http.Client
	endpoint   string
}

func NewZAIScanner(credential string, client *http.Client, endpoint string) *ZAIScanner {
	if client == nil {
		client = http.DefaultClient
	}
	if strings.TrimSpace(endpoint) == "" {
		endpoint = defaultZAIEndpoint
	}
	return &ZAIScanner{credential: strings.TrimSpace(credential), client: client, endpoint: endpoint}
}

func (s *ZAIScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderZAI, Name: "ZAI", Accounts: []Account{}}
	if s == nil || s.credential == "" {
		result.Status, result.Message = ProviderUnavailable, "not authenticated"
		return result
	}
	payload, message := fetchProviderJSON(ctx, s.client, s.endpoint, s.credential)
	account := Account{LocalID: "opencode", Identity: Identity{Kind: "source", Label: "OpenCode"}, Limits: []Limit{}}
	if message != "" {
		account.Status, account.Message = ProviderError, message
	} else if limits, plan, err := parseZAILimits(payload); err != nil {
		account.Status, account.Message = ProviderError, "invalid response"
	} else {
		account.Status, account.Limits, account.Plan = ProviderOK, limits, plan
	}
	result.Accounts = []Account{account}
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
		switch {
		case kind == "TOKENS_LIMIT" && unit == 3:
			id, label = "5h", "5 hours"
		case kind == "TOKENS_LIMIT" && unit == 6:
			id, label = "week", "Week"
		case kind == "TIME_LIMIT" && unit == 5:
			id, label = "mcp-month", "MCP month"
		default:
			continue
		}
		resetMillis := int64(number(item["nextResetTime"]))
		var reset *time.Time
		if resetMillis > 0 {
			value := time.UnixMilli(resetMillis).UTC()
			reset = &value
		}
		limits = append(limits, Limit{ID: id, Label: label, RemainingPercent: clampPercent(100 - number(item["percentage"])), ResetsAt: reset})
	}
	if len(limits) == 0 {
		return nil, "", fmt.Errorf("limits missing")
	}
	plan, _ := data["level"].(string)
	return limits, strings.TrimSpace(plan), nil
}
