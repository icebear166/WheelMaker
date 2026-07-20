package usage

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const defaultKimiEndpoint = "https://api.kimi.com/coding/v1/usages"

// KimiCredentialSource is one local credential origin feeding the Kimi
// usage endpoint. Each source becomes one account in the snapshot.
type KimiCredentialSource struct {
	LocalID    string
	Label      string
	Credential string
}

type KimiScanner struct {
	sources  []KimiCredentialSource
	client   *http.Client
	endpoint string
}

func NewKimiScanner(sources []KimiCredentialSource, client *http.Client, endpoint string) *KimiScanner {
	if client == nil {
		client = http.DefaultClient
	}
	if strings.TrimSpace(endpoint) == "" {
		endpoint = defaultKimiEndpoint
	}
	filtered := make([]KimiCredentialSource, 0, len(sources))
	for _, source := range sources {
		source.Credential = strings.TrimSpace(source.Credential)
		if source.Credential == "" {
			continue
		}
		filtered = append(filtered, source)
	}
	return &KimiScanner{sources: filtered, client: client, endpoint: endpoint}
}

func (s *KimiScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderKimi, Name: "Kimi", Accounts: []Account{}}
	if s == nil || len(s.sources) == 0 {
		result.Status, result.Message = ProviderUnavailable, "not authenticated"
		return result
	}
	mergedIndex := map[string]int{}
	succeeded := 0
	failures := []Account{}
	for _, source := range s.sources {
		payload, message := fetchProviderJSON(ctx, s.client, s.endpoint, source.Credential)
		if message != "" {
			failures = append(failures, Account{LocalID: source.LocalID, Identity: Identity{Kind: "source", Label: source.Label}, Status: ProviderError, Message: message, Limits: []Limit{}})
			continue
		}
		limits, err := parseKimiLimits(payload)
		if err != nil {
			failures = append(failures, Account{LocalID: source.LocalID, Identity: Identity{Kind: "source", Label: source.Label}, Status: ProviderError, Message: "invalid response", Limits: []Limit{}})
			continue
		}
		succeeded++
		userID := parseKimiUserID(payload)
		mergeKey := userID
		account := Account{LocalID: source.LocalID, Identity: Identity{Kind: "source", Label: source.Label}, Status: ProviderOK, Limits: limits}
		if userID != "" {
			account.LocalID = userID
			account.Identity = Identity{Kind: "user", Value: userID, Label: userID}
		} else {
			mergeKey = "source:" + source.LocalID
		}
		if _, exists := mergedIndex[mergeKey]; exists {
			continue
		}
		mergedIndex[mergeKey] = len(result.Accounts)
		result.Accounts = append(result.Accounts, account)
	}
	if succeeded == 0 {
		result.Accounts = failures
	}
	result.Status = providerStatus(result.Accounts)
	return result
}

func parseKimiUserID(payload map[string]any) string {
	user, _ := payload["user"].(map[string]any)
	id, _ := user["userId"].(string)
	return strings.TrimSpace(id)
}

func parseKimiLimits(payload map[string]any) ([]Limit, error) {
	limits := make([]Limit, 0, 2)
	items, _ := payload["limits"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		window, _ := item["window"].(map[string]any)
		if int64(number(window["duration"])) != 300 {
			continue
		}
		detail, _ := item["detail"].(map[string]any)
		total := decimal(detail["limit"])
		used := decimal(detail["used"])
		if total > 0 {
			limits = append(limits, Limit{ID: "5h", Label: "5 hours", RemainingPercent: clampPercent(100 - used/total*100), ResetsAt: parseRFC3339(detail["resetTime"])})
		}
		break
	}
	usage, _ := payload["usage"].(map[string]any)
	total, remaining := decimal(usage["limit"]), decimal(usage["remaining"])
	if total > 0 {
		limits = append(limits, Limit{ID: "week", Label: "Week", RemainingPercent: clampPercent(remaining / total * 100), ResetsAt: parseRFC3339(usage["resetTime"])})
	}
	if len(limits) == 0 {
		return nil, fmt.Errorf("limits missing")
	}
	return limits, nil
}

func decimal(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func number(value any) float64 { return decimal(value) }

func parseRFC3339(value any) *time.Time {
	text, _ := value.(string)
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(text))
	if err != nil {
		return nil
	}
	utc := parsed.UTC()
	return &utc
}
