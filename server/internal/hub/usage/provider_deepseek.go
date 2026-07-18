package usage

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

const defaultDeepSeekEndpoint = "https://api.deepseek.com/user/balance"

type DeepSeekScanner struct {
	credential string
	client     *http.Client
	endpoint   string
}

func NewDeepSeekScanner(credential string, client *http.Client, endpoint string) *DeepSeekScanner {
	if client == nil {
		client = http.DefaultClient
	}
	if strings.TrimSpace(endpoint) == "" {
		endpoint = defaultDeepSeekEndpoint
	}
	return &DeepSeekScanner{credential: strings.TrimSpace(credential), client: client, endpoint: endpoint}
}

func (s *DeepSeekScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderDeepSeek, Name: "DeepSeek", Accounts: []Account{}}
	if s == nil || s.credential == "" {
		result.Status, result.Message = ProviderUnavailable, "not authenticated"
		return result
	}
	payload, message := fetchProviderJSON(ctx, s.client, s.endpoint, s.credential)
	account := Account{LocalID: "opencode", Identity: Identity{Kind: "source", Label: "OpenCode"}, Limits: []Limit{}}
	if message != "" {
		account.Status, account.Message = ProviderError, message
	} else if balance, err := parseDeepSeekBalance(payload); err != nil {
		account.Status, account.Message = ProviderError, "invalid response"
	} else {
		account.Status, account.Balance = ProviderOK, &balance
	}
	result.Accounts = []Account{account}
	result.Status = providerStatus(result.Accounts)
	return result
}

func parseDeepSeekBalance(payload map[string]any) (Balance, error) {
	available, _ := payload["is_available"].(bool)
	rawItems, ok := payload["balance_infos"].([]any)
	if !ok {
		return Balance{}, fmt.Errorf("balance missing")
	}
	items := make([]BalanceItem, 0, len(rawItems))
	for _, raw := range rawItems {
		item, _ := raw.(map[string]any)
		items = append(items, BalanceItem{
			Currency: textField(item, "currency"),
			Total:    textField(item, "total_balance"),
			Granted:  textField(item, "granted_balance"),
			ToppedUp: textField(item, "topped_up_balance"),
		})
	}
	return Balance{IsAvailable: available, Items: items}, nil
}

func textField(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}
