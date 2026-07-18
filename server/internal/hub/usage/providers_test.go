package usage

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenCodeDiscoveryReadsOnlySupportedAPIEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	if err := os.WriteFile(path, []byte(`{
		"kimi-for-coding":{"type":"api","key":"kimi-secret"},
		"zai-coding-plan":{"type":"oauth","key":"oauth-secret"},
		"deepseek":{"type":"api","key":"deepseek-secret"},
		"unrelated":{"type":"api","key":"other-secret"}
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	credentials := readOpenCodeCredentials(path)
	if len(credentials) != 2 || credentials[ProviderKimi] != "kimi-secret" || credentials[ProviderDeepSeek] != "deepseek-secret" {
		t.Fatalf("supported credential discovery mismatch; count=%d", len(credentials))
	}
}

func TestSnapshotJSONNeverContainsProviderCredential(t *testing.T) {
	secret := "sk-private-test-key"
	scanner := NewKimiScanner(secret, &http.Client{}, "https://unused.invalid")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := scanner.Scan(ctx)
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), secret) {
		t.Fatalf("credential leaked into snapshot: %s", raw)
	}
}

func TestParseCodexRateLimitsByWindowDuration(t *testing.T) {
	payload := map[string]any{"rateLimits": map[string]any{
		"primary":   map[string]any{"windowDurationMins": float64(300), "usedPercent": float64(23), "resetsAt": float64(1798761900)},
		"secondary": map[string]any{"windowDurationMins": float64(10080), "usedPercent": float64(58), "resetsAt": float64(1799366400)},
	}}
	limits, err := parseCodexRateLimits(payload)
	if err != nil || len(limits) != 2 || limits[0].RemainingPercent != 77 || limits[1].RemainingPercent != 42 {
		t.Fatalf("limits=%+v err=%v", limits, err)
	}
}

func TestParseKimiUsageUsesLimitsAndWeeklyUsage(t *testing.T) {
	payload := map[string]any{
		"usage": map[string]any{"limit": "100", "remaining": "67", "resetTime": "2027-01-08T00:00:00Z"},
		"limits": []any{map[string]any{
			"window": map[string]any{"duration": float64(300)},
			"detail": map[string]any{"limit": "100", "used": "9", "resetTime": "2027-01-01T05:00:00Z"},
		}},
	}
	limits, err := parseKimiLimits(payload)
	if err != nil || len(limits) != 2 || limits[0].RemainingPercent != 91 || limits[1].RemainingPercent != 67 {
		t.Fatalf("limits=%+v err=%v", limits, err)
	}
}

func TestParseZAIQuotaUsesUnitsThreeSixAndFive(t *testing.T) {
	payload := map[string]any{"data": map[string]any{"limits": []any{
		map[string]any{"type": "TOKENS_LIMIT", "unit": float64(3), "percentage": float64(66), "nextResetTime": float64(1798761900000)},
		map[string]any{"type": "TOKENS_LIMIT", "unit": float64(6), "percentage": float64(40), "nextResetTime": float64(1799366400000)},
		map[string]any{"type": "TIME_LIMIT", "unit": float64(5), "percentage": float64(12), "nextResetTime": float64(1801440000000)},
	}}}
	limits, _, err := parseZAILimits(payload)
	if err != nil || len(limits) != 3 || limits[0].RemainingPercent != 34 || limits[2].RemainingPercent != 88 {
		t.Fatalf("limits=%+v err=%v", limits, err)
	}
}

func TestParseDeepSeekBalancePreservesCurrencies(t *testing.T) {
	payload := map[string]any{"is_available": true, "balance_infos": []any{
		map[string]any{"currency": "CNY", "total_balance": "110", "granted_balance": "10", "topped_up_balance": "100"},
	}}
	balance, err := parseDeepSeekBalance(payload)
	if err != nil || !balance.IsAvailable || len(balance.Items) != 1 || balance.Items[0].Total != "110" {
		t.Fatalf("balance=%+v err=%v", balance, err)
	}
}

func TestProviderErrorNeverContainsCredential(t *testing.T) {
	secret := "sk-private-test-key"
	message := providerErrorMessage(secret, http.StatusBadGateway, []byte("upstream echoed "+secret), errors.New("request failed"))
	if strings.Contains(message, secret) || message != "network error" {
		t.Fatalf("unsafe error=%q", message)
	}
}

func TestKimiMissingCredentialIsUnavailable(t *testing.T) {
	scanner := NewKimiScanner("", &http.Client{}, "https://unused.invalid")
	got := scanner.Scan(context.Background())
	if got.Status != ProviderUnavailable || len(got.Accounts) != 0 {
		t.Fatalf("snapshot=%+v", got)
	}
}
