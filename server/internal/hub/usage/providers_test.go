//go:build windows

package usage

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFlickerScannerReadsMonthlyCreditWithoutPublishingCredential(t *testing.T) {
	var authorization, takumiToken, version, userName string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		takumiToken = r.Header.Get("x-takumi-token")
		version = r.Header.Get("x-takumi-version")
		userName = r.Header.Get("x-takumi-userName")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"success":true,"data":{"userId":"user-1","creditTotal":8000,"creditUsed":3969.719569,"creditAvailable":4030.280431,"availableRatio":50.38,"weeklyCreditsTotal":0,"weeklyCreditsUsed":0,"weeklyCreditsAvailable":0,"weeklyAvailableRatio":0}}`)
	}))
	defer server.Close()

	credential := FlickerCredential{Token: "private-token", UserName: "tester"}
	got := NewFlickerScanner(credential, server.Client(), server.URL, "0.3.11").Scan(context.Background())
	if got.Status != ProviderOK || len(got.Accounts) != 1 {
		t.Fatalf("snapshot=%+v", got)
	}
	account := got.Accounts[0]
	if account.Identity.Kind != "user" || account.Identity.Value != "user-1" {
		t.Fatalf("identity=%+v", account.Identity)
	}
	if len(account.Limits) != 1 || account.Limits[0].ID != "month" || account.Limits[0].RemainingPercent != 50.38 {
		t.Fatalf("limits=%+v", account.Limits)
	}
	if account.Limits[0].WindowKind != WindowCalendarMonth || account.Limits[0].ResetsAt == nil {
		t.Fatalf("month window=%+v", account.Limits[0])
	}
	if authorization != "Bearer private-token" || takumiToken != "private-token" || version != "0.3.11" || userName != "tester" {
		t.Fatalf("headers authorization=%q takumi=%q version=%q username=%q", authorization, takumiToken, version, userName)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), credential.Token) {
		t.Fatalf("credential leaked into snapshot: %s", raw)
	}
}

func TestReadFlickerCredential(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ai-token.json")
	if err := os.WriteFile(path, []byte(`{"userInfo":{"token":"private-token","userName":{"userName":"tester"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got := readFlickerCredential(path)
	if got.Token != "private-token" || got.UserName != "tester" {
		t.Fatalf("credential=%+v", got)
	}
}

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
	if limits[0].WindowKind != WindowFixed || limits[0].WindowDurationMins != 300 {
		t.Fatalf("primary window=%+v", limits[0])
	}
	if limits[1].WindowKind != WindowFixed || limits[1].WindowDurationMins != 10080 {
		t.Fatalf("secondary window=%+v", limits[1])
	}
}

func TestParseCodexResetCredits(t *testing.T) {
	payload := map[string]any{"rateLimitResetCredits": map[string]any{
		"availableCount": float64(2),
		"credits": []any{
			map[string]any{"id": "RateLimitResetCredit_a", "expiresAt": float64(1785528461)},
			map[string]any{"id": "RateLimitResetCredit_b", "expiresAt": float64(1786482562)},
			map[string]any{"id": "", "expiresAt": nil}, // skipped expiry but still listed
		},
	}}
	credits := parseCodexResetCredits(payload)
	if credits == nil || credits.AvailableCount != 2 || len(credits.Credits) != 3 {
		t.Fatalf("reset credits=%+v", credits)
	}
	if credits.Credits[0].ID != "RateLimitResetCredit_a" || credits.Credits[1].ID != "RateLimitResetCredit_b" {
		t.Fatalf("credit ids=%+v", credits.Credits)
	}
	want := time.Unix(1785528461, 0).UTC()
	if credits.Credits[0].ExpiresAt == nil || !credits.Credits[0].ExpiresAt.Equal(want) {
		t.Fatalf("first expiry=%v want %v", credits.Credits[0].ExpiresAt, want)
	}
	if credits.Credits[2].ExpiresAt != nil {
		t.Fatalf("missing expiry should stay nil, got %v", credits.Credits[2].ExpiresAt)
	}
	if got := parseCodexResetCredits(map[string]any{}); got != nil {
		t.Fatalf("expected nil when rateLimitResetCredits missing, got %+v", got)
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
	if account.ResetCredits == nil || account.ResetCredits.AvailableCount != 2 || len(account.ResetCredits.Credits) != 2 {
		t.Fatalf("reset credits=%+v", account.ResetCredits)
	}
	wantExpiry := time.Unix(1785528461, 0).UTC()
	first := account.ResetCredits.Credits[0]
	if first.ID != "RateLimitResetCredit_x" || first.ExpiresAt == nil || !first.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("first credit=%+v want id=RateLimitResetCredit_x expiry=%v", first, wantExpiry)
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
			}, "rateLimitResetCredits": map[string]any{
				"availableCount": float64(2),
				"credits": []any{
					map[string]any{"id": "RateLimitResetCredit_x", "expiresAt": float64(1785528461)},
					map[string]any{"id": "RateLimitResetCredit_y", "expiresAt": float64(1786482562)},
				},
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
	if limits[0].WindowKind != WindowFixed || limits[0].WindowDurationMins != 300 {
		t.Fatalf("five-hour window=%+v", limits[0])
	}
	if limits[1].WindowKind != WindowFixed || limits[1].WindowDurationMins != 10080 {
		t.Fatalf("weekly window=%+v", limits[1])
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
	if limits[0].WindowDurationMins != 300 || limits[1].WindowDurationMins != 10080 || limits[2].WindowKind != WindowCalendarMonth {
		t.Fatalf("window metadata=%+v", limits)
	}
}

func TestMyFlickerMonthWindowUsesShanghaiCalendar(t *testing.T) {
	now := time.Date(2026, 7, 31, 15, 30, 0, 0, time.UTC)
	got := myFlickerMonthReset(now)
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	want := time.Date(2026, 8, 1, 0, 0, 0, 0, shanghai)
	if !got.Equal(want) {
		t.Fatalf("reset=%s want=%s", got, want)
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

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestLocalCollectorUsesConfiguredKeysBeforeExternalCredentials(t *testing.T) {
	authPath := filepath.Join(t.TempDir(), "auth.json")
	if err := os.WriteFile(authPath, []byte(`{
		"kimi-for-coding":{"type":"api","key":"shared-kimi"},
		"zai-coding-plan":{"type":"api","key":"opencode-zai"},
		"deepseek":{"type":"api","key":"shared-deepseek"}
	}`), 0o600); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	requests := map[string][]string{}
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		mu.Lock()
		requests[request.URL.Host] = append(requests[request.URL.Host], request.Header.Get("Authorization"))
		mu.Unlock()
		body := ""
		switch request.URL.Host {
		case "api.kimi.com":
			body = `{"usage":{"limit":100,"remaining":50}}`
		case "api.z.ai":
			body = `{"data":{"limits":[{"type":"TOKENS_LIMIT","unit":6,"percentage":40}]}}`
		case "api.deepseek.com":
			body = `{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"10"}]}`
		default:
			return nil, fmt.Errorf("unexpected request host %q", request.URL.Host)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}

	collector := NewLocalCollector(authPath)
	collector.Binary = "missing-codex"
	collector.FlickerCredentialPath = filepath.Join(t.TempDir(), "missing-flicker.json")
	collector.KimiCodeCredentialsPath = filepath.Join(t.TempDir(), "missing-kimi-code.json")
	collector.KimiAPIKey = "shared-kimi"
	collector.ZAIAPIKey = "config-zai"
	collector.DeepSeekAPIKey = "shared-deepseek"
	collector.Client = client

	snapshots := collector.Scan(context.Background())
	if got := requests["api.kimi.com"]; !reflect.DeepEqual(got, []string{"Bearer shared-kimi"}) {
		t.Fatalf("Kimi requests=%v, want one configured credential request", got)
	}
	if got := requests["api.z.ai"]; !reflect.DeepEqual(got, []string{"Bearer config-zai", "Bearer opencode-zai"}) {
		t.Fatalf("ZAI requests=%v, want configured credential first and distinct OpenCode credential second", got)
	}
	if got := requests["api.deepseek.com"]; !reflect.DeepEqual(got, []string{"Bearer shared-deepseek"}) {
		t.Fatalf("DeepSeek requests=%v, want one configured credential request", got)
	}
	if len(snapshots) != 5 || snapshots[2].Accounts[0].LocalID != "wheelmaker-config" || len(snapshots[3].Accounts) != 2 || snapshots[3].Accounts[0].LocalID != "wheelmaker-config" || snapshots[3].Accounts[1].LocalID != "opencode" || snapshots[4].Accounts[0].LocalID != "wheelmaker-config" {
		t.Fatalf("snapshots=%+v", snapshots)
	}
}

func TestLocalCollectorUpdateAPIKeysReplacesRuntimeCredentials(t *testing.T) {
	collector := NewLocalCollector("")
	collector.UpdateAPIKeys("kimi-old", "zai-old", "deepseek-old")
	collector.UpdateAPIKeys("kimi-new", "", "deepseek-new")

	kimi, zai, deepSeek := collector.apiKeysSnapshot()
	if kimi != "kimi-new" || zai != "" || deepSeek != "deepseek-new" {
		t.Fatalf("API key snapshot = (%q, %q, %q), want latest values", kimi, zai, deepSeek)
	}
}

func TestKimiScannerDeduplicatesCredentialBeforeRequest(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"usage":{"limit":100,"remaining":50}}`)
	}))
	defer server.Close()

	scanner := NewKimiScanner([]KimiCredentialSource{
		{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: "shared-token"},
		{LocalID: "opencode", Label: "OpenCode", Credential: "shared-token"},
	}, server.Client(), server.URL)
	got := scanner.Scan(context.Background())
	if requests != 1 || len(got.Accounts) != 1 || got.Accounts[0].LocalID != "wheelmaker-config" {
		t.Fatalf("requests=%d snapshot=%+v", requests, got)
	}
}

func TestZAIScannerDeduplicatesCredentialBeforeRequest(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":{"limits":[{"type":"TOKENS_LIMIT","unit":6,"percentage":40}]}}`)
	}))
	defer server.Close()

	scanner := NewZAIScanner([]ProviderCredentialSource{
		{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: "shared-token"},
		{LocalID: "opencode", Label: "OpenCode", Credential: "shared-token"},
	}, server.Client(), server.URL)
	got := scanner.Scan(context.Background())
	if requests != 1 || len(got.Accounts) != 1 || got.Accounts[0].LocalID != "wheelmaker-config" {
		t.Fatalf("requests=%d snapshot=%+v", requests, got)
	}
}

func TestDeepSeekScannerKeepsDistinctCredentials(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"10"}]}`)
	}))
	defer server.Close()

	scanner := NewDeepSeekScanner([]ProviderCredentialSource{
		{LocalID: "wheelmaker-config", Label: "WheelMaker", Credential: "config-token"},
		{LocalID: "opencode", Label: "OpenCode", Credential: "opencode-token"},
	}, server.Client(), server.URL)
	got := scanner.Scan(context.Background())
	if requests != 2 || len(got.Accounts) != 2 || got.Accounts[0].LocalID != "wheelmaker-config" || got.Accounts[1].LocalID != "opencode" {
		t.Fatalf("requests=%d snapshot=%+v", requests, got)
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

func TestKimiScannerMergesSourcesWithSameUserID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"user":{"userId":"u-shared"},"limits":[{"window":{"duration":300},"detail":{"limit":100,"used":25,"resetTime":"2026-07-20T20:00:00Z"}}],"usage":{"limit":1000,"remaining":750,"resetTime":"2026-07-27T00:00:00Z"}}`)
	}))
	defer server.Close()
	scanner := NewKimiScanner([]KimiCredentialSource{
		{LocalID: "opencode", Label: "OpenCode", Credential: "token-a"},
		{LocalID: "kimi-code", Label: "Kimi Code", Credential: "token-b"},
	}, server.Client(), server.URL)
	got := scanner.Scan(context.Background())
	if got.Status != ProviderOK || len(got.Accounts) != 1 {
		t.Fatalf("snapshot=%+v", got)
	}
	account := got.Accounts[0]
	if account.LocalID != "u-shared" {
		t.Fatalf("localId=%q, want u-shared", account.LocalID)
	}
	if account.Identity.Kind != "user" || account.Identity.Value != "u-shared" || account.Identity.Label != "u-shared" {
		t.Fatalf("identity=%+v", account.Identity)
	}
	if len(account.Limits) != 2 {
		t.Fatalf("limits=%+v", account.Limits)
	}
}

func TestKimiScannerKeepsDistinctUserIDsSeparate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := "u-a"
		if r.Header.Get("Authorization") == "Bearer token-b" {
			userID = "u-b"
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"user":{"userId":%q},"usage":{"limit":100,"remaining":50,"resetTime":"2026-07-27T00:00:00Z"}}`, userID)
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
	if got.Accounts[0].Identity.Value != "u-a" || got.Accounts[1].Identity.Value != "u-b" {
		t.Fatalf("identities=%+v,%+v", got.Accounts[0].Identity, got.Accounts[1].Identity)
	}
}

func TestKimiScannerMergesWhenOneSourceFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer token-bad" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"user":{"userId":"u-shared"},"usage":{"limit":100,"remaining":50,"resetTime":"2026-07-27T00:00:00Z"}}`)
	}))
	defer server.Close()
	scanner := NewKimiScanner([]KimiCredentialSource{
		{LocalID: "opencode", Label: "OpenCode", Credential: "token-bad"},
		{LocalID: "kimi-code", Label: "Kimi Code", Credential: "token-good"},
	}, server.Client(), server.URL)
	got := scanner.Scan(context.Background())
	if got.Status != ProviderOK || len(got.Accounts) != 1 {
		t.Fatalf("snapshot=%+v", got)
	}
	if got.Accounts[0].Status != ProviderOK || got.Accounts[0].Identity.Value != "u-shared" {
		t.Fatalf("account=%+v", got.Accounts[0])
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

type blockingCollector struct {
	calls   atomic.Int64
	started chan struct{}
	release chan struct{}
	once    sync.Once
	results []ProviderSnapshot
}

func newBlockingCollector() *blockingCollector {
	return &blockingCollector{started: make(chan struct{}), release: make(chan struct{})}
}

func (c *blockingCollector) Scan(ctx context.Context) []ProviderSnapshot {
	c.calls.Add(1)
	c.once.Do(func() { close(c.started) })
	select {
	case <-c.release:
		return append([]ProviderSnapshot(nil), c.results...)
	case <-ctx.Done():
		return nil
	}
}

func TestServiceScansImmediatelyThenTenMinutesAfterCompletion(t *testing.T) {
	after := make(chan time.Duration, 1)
	collector := newBlockingCollector()
	service := NewService(ServiceOptions{
		Collector: collector,
		Interval:  10 * time.Minute,
		After: func(duration time.Duration) <-chan time.Time {
			after <- duration
			return make(chan time.Time)
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go service.Run(ctx)
	select {
	case <-collector.started:
	case <-time.After(time.Second):
		t.Fatal("collector did not start immediately")
	}
	close(collector.release)
	if got := <-after; got != 10*time.Minute {
		t.Fatalf("interval=%v", got)
	}
}

func TestRefreshJoinsRunningScan(t *testing.T) {
	collector := newBlockingCollector()
	service := NewService(ServiceOptions{Collector: collector})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	select {
	case <-collector.started:
	case <-time.After(time.Second):
		t.Fatal("collector did not start")
	}
	doneA, doneB := make(chan struct{}), make(chan struct{})
	go func() { _, _ = service.Refresh(context.Background()); close(doneA) }()
	go func() { _, _ = service.Refresh(context.Background()); close(doneB) }()
	time.Sleep(10 * time.Millisecond)
	if got := collector.calls.Load(); got != 1 {
		t.Fatalf("collector calls=%d, want 1", got)
	}
	close(collector.release)
	select {
	case <-doneA:
	case <-time.After(time.Second):
		t.Fatal("first refresh did not join")
	}
	select {
	case <-doneB:
	case <-time.After(time.Second):
		t.Fatal("second refresh did not join")
	}
}

type immediateCollector struct{ calls atomic.Int64 }

func (c *immediateCollector) Scan(context.Context) []ProviderSnapshot {
	c.calls.Add(1)
	return nil
}

type sequenceCollector struct {
	results [][]ProviderSnapshot
	index   int
}

func (c *sequenceCollector) Scan(context.Context) []ProviderSnapshot {
	if c.index >= len(c.results) {
		return nil
	}
	result := c.results[c.index]
	c.index++
	return result
}

type historyRecorderStub struct {
	at        []time.Time
	providers [][]ProviderSnapshot
	err       error
}

func (s *historyRecorderStub) Record(at time.Time, providers []ProviderSnapshot) error {
	s.at = append(s.at, at)
	s.providers = append(s.providers, append([]ProviderSnapshot(nil), providers...))
	return s.err
}

func TestServiceRecordsRawHistoryBeforePreservingFailedSnapshot(t *testing.T) {
	collector := &sequenceCollector{results: [][]ProviderSnapshot{
		{{
			ID: ProviderKimi, Name: "Kimi", Status: ProviderOK,
			Accounts: []Account{{
				LocalID: "opencode", Status: ProviderOK,
				Limits: []Limit{{ID: "week", RemainingPercent: 66}},
			}},
		}},
		{{
			ID: ProviderKimi, Name: "Kimi", Status: ProviderError,
			Accounts: []Account{{
				LocalID: "opencode", Status: ProviderError, Limits: []Limit{},
			}},
		}},
	}}
	recorder := &historyRecorderStub{}
	service := NewService(ServiceOptions{Collector: collector, History: recorder})

	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(recorder.providers) != 2 || recorder.providers[1][0].Accounts[0].Status != ProviderError {
		t.Fatalf("recorded providers=%+v", recorder.providers)
	}
	if got.Providers[0].Accounts[0].Status != ProviderOK || got.Providers[0].Accounts[0].Limits[0].RemainingPercent != 66 {
		t.Fatalf("visible snapshot=%+v", got.Providers)
	}
}

func TestServiceHistoryWriteFailureDoesNotFailLimitsScan(t *testing.T) {
	collector := &sequenceCollector{results: [][]ProviderSnapshot{{{
		ID: ProviderKimi, Name: "Kimi", Status: ProviderOK, Accounts: []Account{},
	}}}}
	recorder := &historyRecorderStub{err: errors.New("disk full")}
	var historyErr error
	service := NewService(ServiceOptions{
		Collector: collector, History: recorder,
		OnHistoryError: func(err error) { historyErr = err },
	})

	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("refresh error=%v", err)
	}
	if got.Status != ScanReady || len(recorder.providers) != 1 || historyErr == nil || historyErr.Error() != "disk full" {
		t.Fatalf("snapshot=%+v recorder=%+v historyErr=%v", got, recorder, historyErr)
	}
}

func TestServiceKeepsPreviousProviderWhenRefreshFails(t *testing.T) {
	collector := &sequenceCollector{results: [][]ProviderSnapshot{
		{{
			ID: ProviderKimi, Name: "Kimi", Status: ProviderOK,
			Accounts: []Account{{
				LocalID: "opencode", Status: ProviderOK,
				Limits: []Limit{{ID: "week", RemainingPercent: 66}},
			}},
		}},
		{{
			ID: ProviderKimi, Name: "Kimi", Status: ProviderError,
			Accounts: []Account{{
				LocalID: "opencode", Status: ProviderError,
				Limits: []Limit{},
			}},
		}},
	}}
	service := NewService(ServiceOptions{Collector: collector})

	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("second refresh: %v", err)
	}

	if len(got.Providers) != 1 || len(got.Providers[0].Accounts) != 1 {
		t.Fatalf("providers=%+v, want previous provider and account", got.Providers)
	}
	if len(got.Providers[0].Accounts[0].Limits) != 1 {
		t.Fatalf("limits=%+v, want previous successful limit", got.Providers[0].Accounts[0].Limits)
	}
	if got.Providers[0].Accounts[0].Limits[0].RemainingPercent != 66 {
		t.Fatalf("limits=%+v, want previous successful limit", got.Providers[0].Accounts[0].Limits)
	}
}

func TestServiceKeepsPreviousAccountWhenOneAccountRefreshFails(t *testing.T) {
	collector := &sequenceCollector{results: [][]ProviderSnapshot{
		{{
			ID: ProviderDeepSeek, Name: "DeepSeek", Status: ProviderOK,
			Accounts: []Account{
				{LocalID: "one", Status: ProviderOK, Limits: []Limit{{ID: "week", RemainingPercent: 80}}},
				{LocalID: "two", Status: ProviderOK, Limits: []Limit{{ID: "week", RemainingPercent: 60}}},
			},
		}},
		{{
			ID: ProviderDeepSeek, Name: "DeepSeek", Status: ProviderOK,
			Accounts: []Account{
				{LocalID: "one", Status: ProviderOK, Limits: []Limit{{ID: "week", RemainingPercent: 70}}},
				{LocalID: "two", Status: ProviderError, Limits: []Limit{}},
			},
		}},
	}}
	service := NewService(ServiceOptions{Collector: collector})

	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("second refresh: %v", err)
	}

	accounts := got.Providers[0].Accounts
	if len(accounts) != 2 {
		t.Fatalf("accounts=%+v, want two accounts", accounts)
	}
	if len(accounts[0].Limits) != 1 || len(accounts[1].Limits) != 1 {
		t.Fatalf("accounts=%+v, want one limit per account", accounts)
	}
	if accounts[0].Limits[0].RemainingPercent != 70 || accounts[1].Limits[0].RemainingPercent != 60 {
		t.Fatalf("accounts=%+v, want refreshed account plus previous failed account", accounts)
	}
}

func TestManualRefreshRestartsAutomaticInterval(t *testing.T) {
	afterCalls := make(chan time.Duration, 2)
	collector := &immediateCollector{}
	service := NewService(ServiceOptions{
		Collector: collector,
		Interval:  10 * time.Minute,
		After: func(duration time.Duration) <-chan time.Time {
			afterCalls <- duration
			return make(chan time.Time)
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go service.Run(ctx)
	if got := <-afterCalls; got != 10*time.Minute {
		t.Fatalf("initial interval=%v", got)
	}
	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("manual refresh: %v", err)
	}
	select {
	case got := <-afterCalls:
		if got != 10*time.Minute {
			t.Fatalf("reset interval=%v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("manual refresh did not restart the automatic interval")
	}
	if got := collector.calls.Load(); got != 2 {
		t.Fatalf("collector calls=%d, want 2", got)
	}
}

func TestCloneSnapshotPreservesEmptyCollectionsAsJSONArrays(t *testing.T) {
	snapshot := cloneSnapshot(Snapshot{Providers: []ProviderSnapshot{
		{
			ID: ProviderDeepSeek, Name: "DeepSeek", Status: ProviderOK,
			Accounts: []Account{{LocalID: "opencode", Status: ProviderOK, Limits: []Limit{}}},
		},
		{ID: ProviderKimi, Name: "Kimi", Status: ProviderUnavailable, Accounts: []Account{}},
	}})
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	for _, expected := range []string{`"limits":[]`, `"accounts":[]`} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf("snapshot JSON must contain %s: %s", expected, raw)
		}
	}
	emptyRaw, err := json.Marshal(cloneSnapshot(Snapshot{Providers: []ProviderSnapshot{}}))
	if err != nil {
		t.Fatalf("marshal empty snapshot: %v", err)
	}
	if !strings.Contains(string(emptyRaw), `"providers":[]`) {
		t.Fatalf("empty providers must remain an array: %s", emptyRaw)
	}
}

func TestHistoryStoreRecordsCompactSamplesAndReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "usage-history.json")
	store := NewHistoryStore(path)
	reset := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	at := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)
	if err := store.Record(at, []ProviderSnapshot{{
		ID: ProviderCodex, Status: ProviderOK,
		Accounts: []Account{{
			LocalID: "current", Status: ProviderOK,
			Limits: []Limit{{
				ID: "week", Label: "Week", RemainingPercent: 82.4,
				WindowKind: WindowFixed, WindowDurationMins: 10080, ResetsAt: &reset,
			}},
		}},
	}}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`[1785200400000,82.4]`)) {
		t.Fatalf("history is not compact: %s", raw)
	}
	got, err := NewHistoryStore(path).Query(HistoryQuery{
		ProviderID: ProviderCodex, AccountLocalID: "current", Now: at,
	})
	if err != nil || len(got.Limits) != 1 || len(got.Limits[0].Samples) != 1 {
		t.Fatalf("query=%+v err=%v", got, err)
	}
}

func TestHistoryStoreReplacesDuplicateTimestampAndKeepsFlatSamples(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	store := NewHistoryStore(path)
	reset := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	providers := func(remaining float64) []ProviderSnapshot {
		return []ProviderSnapshot{{
			ID: ProviderCodex, Status: ProviderOK,
			Accounts: []Account{{
				LocalID: "current", Status: ProviderOK,
				Limits: []Limit{{
					ID: "week", Label: "Week", RemainingPercent: remaining,
					WindowKind: WindowFixed, WindowDurationMins: 10080, ResetsAt: &reset,
				}},
			}},
		}}
	}
	first := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)
	if err := store.Record(first, providers(82.4)); err != nil {
		t.Fatal(err)
	}
	if err := store.Record(first, providers(81.9)); err != nil {
		t.Fatal(err)
	}
	if err := store.Record(first.Add(10*time.Minute), providers(81.9)); err != nil {
		t.Fatal(err)
	}
	got, err := store.Query(HistoryQuery{
		ProviderID: ProviderCodex, AccountLocalID: "current", Now: first.Add(10 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	samples := got.Limits[0].Samples
	if len(samples) != 2 || samples[0].RemainingPercent != 81.9 || samples[1].RemainingPercent != 81.9 {
		t.Fatalf("samples=%+v", samples)
	}
}

func TestHistoryStoreSkipsFailedRawAccounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	store := NewHistoryStore(path)
	at := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)
	if err := store.Record(at, []ProviderSnapshot{{
		ID: ProviderKimi, Status: ProviderError,
		Accounts: []Account{{
			LocalID: "opencode", Status: ProviderError,
			Limits: []Limit{{ID: "week", RemainingPercent: 66}},
		}},
	}}); err != nil {
		t.Fatal(err)
	}
	got, err := store.Query(HistoryQuery{ProviderID: ProviderKimi, AccountLocalID: "opencode", Now: at})
	if err != nil || len(got.Limits) != 0 {
		t.Fatalf("query=%+v err=%v", got, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("failed sample created history file: %v", err)
	}
}

func TestHistoryStoreQueryReturnsRecentWeekAcrossCurrentWindowStart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	raw := `{"version":1,"series":[{"providerId":"codex","accountLocalId":"current","limitId":"week","limitLabel":"Week","windowKind":"fixed","windowDurationMins":10080,"resetAt":"2026-08-03T00:00:00Z","samples":[[1784851200000,95],[1785110400000,90],[1785283200000,80]]}]}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := NewHistoryStore(path).Query(HistoryQuery{
		ProviderID:     ProviderCodex,
		AccountLocalID: "current",
		Now:            time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Limits) != 1 || len(got.Limits[0].Samples) != 3 {
		t.Fatalf("query=%+v", got)
	}
	if got.Limits[0].Samples[0].ObservedAtMillis != 1784851200000 {
		t.Fatalf("samples=%+v", got.Limits[0].Samples)
	}
}

func TestHistoryStoreDeletesUnsupportedOrCorruptFile(t *testing.T) {
	for _, content := range []string{`{"version":99,"series":[]}`, `{not-json`} {
		t.Run(content, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "usage-history.json")
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			got, err := NewHistoryStore(path).Query(HistoryQuery{
				ProviderID: ProviderCodex, AccountLocalID: "current", Now: time.Now(),
			})
			if err != nil || len(got.Limits) != 0 {
				t.Fatalf("query=%+v err=%v", got, err)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("invalid file was not deleted: %v", err)
			}
		})
	}
}

func TestHistoryStoreRetainsCurrentAndPreviousWindows(t *testing.T) {
	tests := []struct {
		name       string
		windowKind WindowKind
		duration   int64
		reset      time.Time
		samples    []HistorySample
		wantFirst  int64
	}{
		{
			name: "fixed week", windowKind: WindowFixed, duration: 10080,
			reset: time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC),
			samples: []HistorySample{
				{ObservedAtMillis: time.Date(2026, 7, 19, 23, 59, 0, 0, time.UTC).UnixMilli(), RemainingPercent: 100},
				{ObservedAtMillis: time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli(), RemainingPercent: 99},
				{ObservedAtMillis: time.Date(2026, 7, 28, 0, 0, 0, 0, time.UTC).UnixMilli(), RemainingPercent: 80},
			},
			wantFirst: time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli(),
		},
		{
			name: "calendar month", windowKind: WindowCalendarMonth,
			reset: time.Date(2026, 8, 1, 0, 0, 0, 0, shanghaiLocation),
			samples: []HistorySample{
				{ObservedAtMillis: time.Date(2026, 5, 31, 23, 59, 0, 0, shanghaiLocation).UnixMilli(), RemainingPercent: 100},
				{ObservedAtMillis: time.Date(2026, 6, 1, 0, 0, 0, 0, shanghaiLocation).UnixMilli(), RemainingPercent: 99},
				{ObservedAtMillis: time.Date(2026, 7, 28, 0, 0, 0, 0, shanghaiLocation).UnixMilli(), RemainingPercent: 80},
			},
			wantFirst: time.Date(2026, 6, 1, 0, 0, 0, 0, shanghaiLocation).UnixMilli(),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "usage-history.json")
			fixture := historyFile{Version: historyFileVersion, Series: []historySeries{{
				ProviderID: ProviderCodex, AccountLocalID: "current", LimitID: "limit",
				LimitLabel: "Limit", WindowKind: test.windowKind,
				WindowDurationMins: test.duration, ResetAt: &test.reset, Samples: test.samples,
			}}}
			raw, err := json.Marshal(fixture)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			store := NewHistoryStore(path)
			if err := store.Record(test.reset.Add(-time.Hour), []ProviderSnapshot{{
				ID: ProviderCodex, Status: ProviderOK,
				Accounts: []Account{{
					LocalID: "current", Status: ProviderOK,
					Limits: []Limit{{
						ID: "limit", Label: "Limit", RemainingPercent: 70,
						WindowKind: test.windowKind, WindowDurationMins: test.duration, ResetsAt: &test.reset,
					}},
				}},
			}}); err != nil {
				t.Fatal(err)
			}
			persisted, err := store.loadLocked()
			if err != nil {
				t.Fatal(err)
			}
			if got := persisted.Series[0].Samples[0].ObservedAtMillis; got != test.wantFirst {
				t.Fatalf("first sample=%d want=%d samples=%+v", got, test.wantFirst, persisted.Series[0].Samples)
			}
		})
	}
}

func TestHistoryStoreCapsSeriesAtTenThousandPoints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	reset := time.Date(2026, 8, 1, 0, 0, 0, 0, shanghaiLocation)
	start := time.Date(2026, 7, 20, 0, 0, 0, 0, shanghaiLocation)
	samples := make([]HistorySample, 10_001)
	for index := range samples {
		samples[index] = HistorySample{
			ObservedAtMillis: start.Add(time.Duration(index) * time.Minute).UnixMilli(),
			RemainingPercent: 100 - float64(index%100),
		}
	}
	fixture := historyFile{Version: historyFileVersion, Series: []historySeries{{
		ProviderID: ProviderFlicker, AccountLocalID: "account", LimitID: "month",
		LimitLabel: "Month", WindowKind: WindowCalendarMonth, ResetAt: &reset, Samples: samples,
	}}}
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewHistoryStore(path)
	if err := store.Record(start.Add(10_001*time.Minute), []ProviderSnapshot{{
		ID: ProviderFlicker, Status: ProviderOK,
		Accounts: []Account{{
			LocalID: "account", Status: ProviderOK,
			Limits: []Limit{{
				ID: "month", Label: "Month", RemainingPercent: 50,
				WindowKind: WindowCalendarMonth, ResetsAt: &reset,
			}},
		}},
	}}); err != nil {
		t.Fatal(err)
	}
	persisted, err := store.loadLocked()
	if err != nil {
		t.Fatal(err)
	}
	got := persisted.Series[0].Samples
	if len(got) != 10_000 || got[0].ObservedAtMillis != samples[2].ObservedAtMillis {
		t.Fatalf("len=%d first=%d wantFirst=%d", len(got), got[0].ObservedAtMillis, samples[2].ObservedAtMillis)
	}
}

func readDeepSeekFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return raw
}

func deepSeekFixtureBizData(t *testing.T, name string) json.RawMessage {
	t.Helper()
	var envelope deepSeekEnvelope
	if err := json.Unmarshal(readDeepSeekFixture(t, name), &envelope); err != nil {
		t.Fatalf("fixture %s envelope: %v", name, err)
	}
	if envelope.Code != 0 || envelope.Data.BizCode != 0 || len(envelope.Data.BizData) == 0 {
		t.Fatalf("fixture %s has unexpected envelope: %+v", name, envelope)
	}
	return envelope.Data.BizData
}

func TestParseDeepSeekSummaryBalanceFixture(t *testing.T) {
	items, err := parseDeepSeekSummaryBalance(deepSeekFixtureBizData(t, "deepseek_user_summary.json"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items=%+v", items)
	}
	item := items[0]
	if item.Currency != "CNY" || item.Total != "1.25" || item.Granted != "0.00" || item.ToppedUp != "1.25" {
		t.Fatalf("item=%+v", item)
	}
}

func TestParseDeepSeekAmountDaysFixture(t *testing.T) {
	days, err := parseDeepSeekAmountDays(deepSeekFixtureBizData(t, "deepseek_usage_amount.json"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(days) != 31 {
		t.Fatalf("expected 31 padded days, got %d", len(days))
	}
	first := days[0]
	if first.Date != "2026-08-01" || first.Request != 800000 || first.HitTokens != 500000 ||
		first.MissTokens != 600000 || first.OutputTokens != 700000 || first.TotalTokens != 1800000 {
		t.Fatalf("first=%+v", first)
	}
	second := days[1]
	if second.TotalTokens != 0 || second.Request != 0 {
		t.Fatalf("second day should be zero-padded: %+v", second)
	}
}

func TestParseDeepSeekCostsFixture(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	costs, err := parseDeepSeekCosts(deepSeekFixtureBizData(t, "deepseek_usage_cost.json"), now, DeepSeekPlatformMonth{Year: 2026, Month: 8})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(costs) != 1 || costs[0].Currency != "CNY" {
		t.Fatalf("costs=%+v", costs)
	}
	cost := costs[0]
	if cost.MonthlyCost != 12.75 {
		t.Fatalf("monthly=%v, want 12.75", cost.MonthlyCost)
	}
	if cost.TodayCost != 21.75 {
		t.Fatalf("today=%v, want 21.75", cost.TodayCost)
	}
	if len(cost.Daily) != 31 || cost.Daily[0].Date != "2026-08-01" || cost.Daily[0].Amount != 21.75 {
		t.Fatalf("daily=%+v", cost.Daily)
	}
	if cost.Daily[1].Amount != 0 {
		t.Fatalf("second day should be zero: %+v", cost.Daily[1])
	}
}

func TestParseDeepSeekCostsTodayOnlyForCurrentMonth(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	costs, err := parseDeepSeekCosts(deepSeekFixtureBizData(t, "deepseek_usage_cost.json"), now, DeepSeekPlatformMonth{Year: 2026, Month: 8})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if costs[0].TodayCost != 0 {
		t.Fatalf("today cost must be 0 outside the current month: %+v", costs[0])
	}
}

func TestParseDeepSeekRejectsMalformed(t *testing.T) {
	if _, err := parseDeepSeekSummaryBalance(json.RawMessage(`{"normal_wallets":[{"currency":"CNY","balance":123}]}`)); err == nil {
		t.Fatal("expected parse error for numeric balance")
	}
	if _, err := parseDeepSeekAmountDays(json.RawMessage(`{"days":[{"date":"2026-08-01","data":[{"model":"m","usage":[{"type":"REQUEST","amount":"abc"}]}]}]}`)); err == nil {
		t.Fatal("expected parse error for non-integer amount")
	}
}

func TestDeepSeekExpiredCodes(t *testing.T) {
	for _, body := range []string{
		`{"code":40003,"msg":"Authorization Failed (invalid token)"}`,
		`{"code":40002,"msg":"Authorization Failed"}`,
		`{"code":0,"data":{"biz_code":40003,"biz_msg":"expired","biz_data":{}}}`,
	} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			store := NewDeepSeekPlatformStore("session-token", server.Client(), server.URL)
			got, err := store.Get(context.Background(), 2026, 8, false)
			if err != nil {
				t.Fatalf("Get: %v", err)
			}
			if got.Status != DeepSeekPlatformExpired {
				t.Fatalf("status=%q, want expired", got.Status)
			}
		})
	}
}

func newDeepSeekFixtureServer(t *testing.T, calls *atomic.Int64) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls != nil {
			calls.Add(1)
		}
		if ua := r.UserAgent(); !strings.Contains(ua, "Mozilla/5.0") {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		switch {
		case strings.Contains(r.URL.Path, "get_user_summary"):
			_, _ = w.Write(readDeepSeekFixture(t, "deepseek_user_summary.json"))
		case strings.Contains(r.URL.Path, "usage/amount"):
			_, _ = w.Write(readDeepSeekFixture(t, "deepseek_usage_amount.json"))
		case strings.Contains(r.URL.Path, "usage/cost"):
			_, _ = w.Write(readDeepSeekFixture(t, "deepseek_usage_cost.json"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestDeepSeekPlatformStoreFetchAndCache(t *testing.T) {
	var calls atomic.Int64
	server := newDeepSeekFixtureServer(t, &calls)
	defer server.Close()

	store := NewDeepSeekPlatformStore("session-token", server.Client(), server.URL)
	store.now = func() time.Time { return time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC) }

	first, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || first.Status != DeepSeekPlatformOK {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	if len(first.Days) != 31 || len(first.Costs) != 1 || len(first.Balance) != 1 {
		t.Fatalf("first=%+v", first)
	}
	if first.CachedAt == nil {
		t.Fatal("cachedAt must be set on fresh fetch")
	}
	if calls.Load() != 3 {
		t.Fatalf("expected 3 upstream calls, got %d", calls.Load())
	}

	cached, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || cached.Status != DeepSeekPlatformOK {
		t.Fatalf("cached=%+v err=%v", cached, err)
	}
	if calls.Load() != 3 {
		t.Fatalf("cache miss: expected still 3 calls, got %d", calls.Load())
	}

	if _, err := store.Get(context.Background(), 2026, 8, true); err != nil {
		t.Fatalf("forced refresh: %v", err)
	}
	if calls.Load() != 6 {
		t.Fatalf("forced refresh should refetch, got %d calls", calls.Load())
	}
}

func TestDeepSeekPlatformStoreStaleOnExpiredAndError(t *testing.T) {
	var failMode atomic.Int32 // 0 = serve fixtures, 1 = expired, 2 = 500
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch failMode.Load() {
		case 1:
			_, _ = w.Write([]byte(`{"code":40003,"msg":"expired"}`))
			return
		case 2:
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		switch {
		case strings.Contains(r.URL.Path, "get_user_summary"):
			_, _ = w.Write(readDeepSeekFixture(t, "deepseek_user_summary.json"))
		case strings.Contains(r.URL.Path, "usage/amount"):
			_, _ = w.Write(readDeepSeekFixture(t, "deepseek_usage_amount.json"))
		default:
			_, _ = w.Write(readDeepSeekFixture(t, "deepseek_usage_cost.json"))
		}
	}))
	defer server.Close()

	store := NewDeepSeekPlatformStore("session-token", server.Client(), server.URL)
	store.now = func() time.Time { return time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC) }
	if _, err := store.Get(context.Background(), 2026, 8, false); err != nil {
		t.Fatalf("prime cache: %v", err)
	}

	failMode.Store(1)
	expired, err := store.Get(context.Background(), 2026, 8, true)
	if err != nil {
		t.Fatalf("expired fetch: %v", err)
	}
	if expired.Status != DeepSeekPlatformExpired || len(expired.Days) != 31 {
		t.Fatalf("expired must keep stale data: %+v", expired)
	}

	failMode.Store(2)
	platformError, err := store.Get(context.Background(), 2026, 8, true)
	if err != nil {
		t.Fatalf("error fetch: %v", err)
	}
	if platformError.Status != DeepSeekPlatformError || len(platformError.Days) != 31 {
		t.Fatalf("error must keep stale data: %+v", platformError)
	}
	if platformError.Message == "" {
		t.Fatal("error status must carry a message")
	}

	empty := NewDeepSeekPlatformStore("session-token", server.Client(), server.URL)
	failMode.Store(1)
	got, err := empty.Get(context.Background(), 2026, 7, false)
	if err != nil {
		t.Fatalf("expired without cache: %v", err)
	}
	if got.Status != DeepSeekPlatformExpired || len(got.Days) != 0 {
		t.Fatalf("expired without cache must be empty: %+v", got)
	}
	failMode.Store(2)
	got, err = empty.Get(context.Background(), 2026, 7, false)
	if err != nil {
		t.Fatalf("error without cache: %v", err)
	}
	if got.Status != DeepSeekPlatformError || got.Message == "" || len(got.Days) != 0 {
		t.Fatalf("error without cache must be empty with message: %+v", got)
	}
}

func TestDeepSeekPlatformStoreNotConnected(t *testing.T) {
	store := NewDeepSeekPlatformStore("", nil)
	got, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || got.Status != DeepSeekPlatformNotConnected {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func TestCollectorReturnsStableProviderOrder(t *testing.T) {
	collector := Collector{Scanners: []ProviderScanner{
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderZAI} }),
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderFlicker} }),
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderCodex} }),
	}}
	got := collector.Scan(context.Background())
	if got[0].ID != ProviderCodex || got[1].ID != ProviderFlicker || got[2].ID != ProviderZAI {
		t.Fatalf("provider order=%v", []ProviderID{got[0].ID, got[1].ID, got[2].ID})
	}
}

func TestLimitKeepsFullUTCTimestamp(t *testing.T) {
	reset := time.Date(2027, 1, 1, 0, 5, 0, 0, time.UTC)
	limit := Limit{ID: "5h", RemainingPercent: 77, ResetsAt: &reset}
	raw, err := json.Marshal(limit)
	if err != nil || !bytes.Contains(raw, []byte("2027-01-01T00:05:00Z")) {
		t.Fatalf("limit json=%s err=%v", raw, err)
	}
}

func TestCodexCommandHidesWindow(t *testing.T) {
	cmd := newBackgroundCommand(context.Background(), "cmd", "/c", "exit", "0")
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("Codex helper must hide its Windows console window")
	}
}
