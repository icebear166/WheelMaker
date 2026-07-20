package usage

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	scanner := NewKimiScanner([]KimiCredentialSource{{LocalID: "opencode", Label: "OpenCode", Credential: secret}}, &http.Client{}, "https://unused.invalid")
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

func TestCodexScannerReadsStableEmailWithoutPublishingCredential(t *testing.T) {
	previousCommand := newBackgroundCommand
	defer func() { newBackgroundCommand = previousCommand }()
	newBackgroundCommand = func(ctx context.Context, _ string, _ ...string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=TestCodexAppServerHelperProcess")
		cmd.Env = append(os.Environ(), "WHEELMAKER_CODEX_HELPER=1")
		return cmd
	}

	got := NewCodexScanner("codex").Scan(context.Background())
	if got.Status != ProviderOK || len(got.Accounts) != 1 {
		t.Fatalf("snapshot=%+v", got)
	}
	account := got.Accounts[0]
	if account.Identity.Kind != "email" || account.Identity.Value != "user@example.com" || account.Identity.Label != "User@Example.com" {
		t.Fatalf("identity=%+v", account.Identity)
	}
	if account.Plan != "plus" {
		t.Fatalf("plan=%q", account.Plan)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "sk-private-test-key") {
		t.Fatalf("Codex credential leaked into snapshot: %s", raw)
	}
}

func TestCodexAppServerHelperProcess(t *testing.T) {
	if os.Getenv("WHEELMAKER_CODEX_HELPER") != "1" {
		return
	}
	accountRead := false
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request struct {
			ID     int64          `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			os.Exit(2)
		}
		var result any
		switch request.Method {
		case "initialize":
			result = map[string]any{}
		case "account/read":
			if refresh, _ := request.Params["refreshToken"].(bool); refresh {
				os.Exit(3)
			}
			accountRead = true
			result = map[string]any{"account": map[string]any{
				"type": "chatgpt", "email": "User@Example.com", "planType": "plus", "apiKey": "sk-private-test-key",
			}, "requiresOpenaiAuth": true}
		case "account/rateLimits/read":
			if !accountRead {
				os.Exit(4)
			}
			result = map[string]any{"rateLimits": map[string]any{
				"primary": map[string]any{"windowDurationMins": float64(300), "usedPercent": float64(23)},
			}}
		default:
			os.Exit(5)
		}
		if encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result}) != nil {
			os.Exit(6)
		}
	}
	os.Exit(0)
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
	scanner := NewKimiScanner(nil, &http.Client{}, "https://unused.invalid")
	got := scanner.Scan(context.Background())
	if got.Status != ProviderUnavailable || len(got.Accounts) != 0 {
		t.Fatalf("snapshot=%+v", got)
	}
}

func TestKimiScannerReportsOneAccountPerCredentialSource(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"limits":[{"window":{"duration":300},"detail":{"limit":100,"used":25,"resetTime":"2026-07-20T20:00:00Z"}}],"usage":{"limit":1000,"remaining":750,"resetTime":"2026-07-27T00:00:00Z"}}`)
	}))
	defer server.Close()
	scanner := NewKimiScanner([]KimiCredentialSource{
		{LocalID: "opencode", Label: "OpenCode", Credential: "token-a"},
		{LocalID: "kimi-code", Label: "Kimi Code", Credential: "token-b"},
	}, server.Client(), server.URL)
	got := scanner.Scan(context.Background())
	if got.Status != ProviderOK || len(got.Accounts) != 2 {
		t.Fatalf("snapshot=%+v", got)
	}
	if got.Accounts[0].LocalID != "opencode" || got.Accounts[1].LocalID != "kimi-code" {
		t.Fatalf("account order=%q,%q", got.Accounts[0].LocalID, got.Accounts[1].LocalID)
	}
	if got.Accounts[1].Identity.Label != "Kimi Code" {
		t.Fatalf("kimi-code identity=%+v", got.Accounts[1].Identity)
	}
	if len(got.Accounts[0].Limits) != 2 || got.Accounts[0].Limits[0].RemainingPercent != 75 {
		t.Fatalf("limits=%+v", got.Accounts[0].Limits)
	}
}

func TestReadKimiCodeCredentialValidToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kimi-code.json")
	body := `{"access_token":"kimi-code-token","refresh_token":"ignored","expires_at":4102444800,"token_type":"Bearer"}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(path, time.Unix(1784519757, 0)); got != "kimi-code-token" {
		t.Fatalf("credential=%q, want kimi-code-token", got)
	}
}

func TestReadKimiCodeCredentialRejectsExpiredToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kimi-code.json")
	body := `{"access_token":"kimi-code-token","expires_at":1784520447}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(path, time.Unix(1784520447, 0)); got != "" {
		t.Fatalf("expired credential=%q, want empty", got)
	}
}

func TestReadKimiCodeCredentialHandlesMissingAndInvalidFiles(t *testing.T) {
	if got := readKimiCodeCredential(filepath.Join(t.TempDir(), "absent.json"), time.Now()); got != "" {
		t.Fatalf("missing file credential=%q, want empty", got)
	}
	path := filepath.Join(t.TempDir(), "broken.json")
	if err := os.WriteFile(path, []byte(`{"access_token":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(path, time.Now()); got != "" {
		t.Fatalf("invalid JSON credential=%q, want empty", got)
	}
	empty := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(empty, []byte(`{"expires_at":4102444800}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readKimiCodeCredential(empty, time.Now()); got != "" {
		t.Fatalf("empty token credential=%q, want empty", got)
	}
}

func TestDefaultKimiCodeCredentialsPathRespectsHomeOverride(t *testing.T) {
	override := t.TempDir()
	t.Setenv("KIMI_CODE_HOME", override)
	got := defaultKimiCodeCredentialsPath()
	want := filepath.Join(override, "credentials", "kimi-code.json")
	if got != want {
		t.Fatalf("path=%q, want %q", got, want)
	}
	t.Setenv("KIMI_CODE_HOME", "")
	if path := defaultKimiCodeCredentialsPath(); path == "" || !strings.HasSuffix(path, filepath.Join("credentials", "kimi-code.json")) {
		t.Fatalf("default path=%q", path)
	}
}
