package usage

import (
	"bufio"
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
