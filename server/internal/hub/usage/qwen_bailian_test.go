package usage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type qwenSequenceCollector struct {
	call      int
	snapshots [][]ProviderSnapshot
}

func (c *qwenSequenceCollector) Scan(context.Context) []ProviderSnapshot {
	index := c.call
	c.call++
	if index >= len(c.snapshots) {
		index = len(c.snapshots) - 1
	}
	return c.snapshots[index]
}

func TestQwenScannerRequiresTokenPlanAPIKey(t *testing.T) {
	for _, key := range []string{"", "sk-qwen", "sk-"} {
		got := NewQwenBailianScanner(key, QwenOAuthCredential{AccessToken: "access-token"}, http.DefaultClient, "").Scan(context.Background())
		if got.ID != ProviderQwen || !got.Remove || len(got.Accounts) != 0 {
			t.Fatalf("key=%q snapshot=%+v, want authoritative removal", key, got)
		}
	}
}

func TestLocalCollectorEmitsQwenRemovalOnlyAfterConfiguredKeyIsCleared(t *testing.T) {
	collector := NewLocalCollector("")
	collector.Client = http.DefaultClient
	if snapshots := collector.Scan(context.Background()); len(snapshots) != 5 {
		t.Fatalf("initial snapshots=%d, want legacy providers only", len(snapshots))
	}
	collector.UpdateQwenCredentials("sk-sp-configured", QwenOAuthCredential{})
	if snapshots := collector.Scan(context.Background()); len(snapshots) != 6 || snapshots[5].ID != ProviderQwen {
		t.Fatalf("configured snapshots=%+v, want Qwen provider", snapshots)
	}
	collector.UpdateQwenCredentials("", QwenOAuthCredential{})
	snapshots := collector.Scan(context.Background())
	if len(snapshots) != 6 || snapshots[5].ID != ProviderQwen || !snapshots[5].Remove {
		t.Fatalf("cleared snapshots=%+v, want one Qwen tombstone", snapshots)
	}
	if snapshots = collector.Scan(context.Background()); len(snapshots) != 5 {
		t.Fatalf("post-removal snapshots=%d, want no repeated tombstone", len(snapshots))
	}
}

func TestUsageServiceHonorsQwenRemovalTombstone(t *testing.T) {
	ready := ProviderSnapshot{
		ID: ProviderQwen, Name: "Qwen", Status: ProviderOK,
		Accounts: []Account{{LocalID: "bailian-token-plan", Status: ProviderOK, Limits: []Limit{{ID: "week", RemainingPercent: 80}}}},
	}
	removed := ProviderSnapshot{ID: ProviderQwen, Name: "Qwen", Remove: true, Status: ProviderUnavailable, Accounts: []Account{}}
	collector := &qwenSequenceCollector{snapshots: [][]ProviderSnapshot{{ready}, {removed}}}
	service := NewService(ServiceOptions{
		HubID:     "hub-a",
		Collector: collector,
	})
	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := service.Snapshot(); len(got.Providers) != 0 {
		t.Fatalf("providers=%+v, want removed Qwen provider", got.Providers)
	}
}

func TestUsageServiceKeepsQwenDataWhenRefreshFails(t *testing.T) {
	ready := ProviderSnapshot{
		ID: ProviderQwen, Name: "Qwen", Status: ProviderOK,
		Accounts: []Account{{LocalID: "bailian-token-plan", Status: ProviderOK, Qwen: &QwenUsageData{
			FiveHour: QwenCreditsWindow{State: QwenCreditsLimited, Total: "700", Remaining: "600"},
			Week:     QwenCreditsWindow{State: QwenCreditsLimited, Total: "2500", Remaining: "2200"},
		}}},
	}
	failure := ProviderSnapshot{ID: ProviderQwen, Name: "Qwen", Status: ProviderUnavailable, Authenticated: true, Message: "subscription unavailable", Accounts: []Account{}}
	service := NewService(ServiceOptions{
		HubID:     "hub-a",
		Collector: &qwenSequenceCollector{snapshots: [][]ProviderSnapshot{{ready}, {failure}}},
	})
	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	snapshot := service.Snapshot()
	if len(snapshot.Providers) != 1 || snapshot.Providers[0].Status != ProviderError || !snapshot.Providers[0].Authenticated || len(snapshot.Providers[0].Accounts) != 1 {
		t.Fatalf("snapshot=%+v, want stale Qwen data with error status", snapshot)
	}
	if got := snapshot.Providers[0].Accounts[0].Qwen.FiveHour.Remaining; got != "600" {
		t.Fatalf("stale remaining=%q, want 600", got)
	}
}

func TestParseQwenTokenPlanUsageAndCredits(t *testing.T) {
	raw := map[string]any{
		"data": map[string]any{
			"DataV2": map[string]any{
				"data": map[string]any{
					"data": map[string]any{
						"per5HourPercentage": 0.25,
						"per5HourResetTime":  1786000000000,
						"per1WeekPercentage": 0.4,
						"per1WeekResetTime":  1786100000000,
					},
				},
			},
		},
	}

	usage, err := parseQwenTokenPlanUsage(raw)
	if err != nil {
		t.Fatal(err)
	}
	if usage.FiveHour.ConsumedPercent != 25 || usage.Week.ConsumedPercent != 40 {
		t.Fatalf("usage=%+v", usage)
	}
	if !usage.FiveHour.ResetsAt.Equal(time.UnixMilli(1786000000000).UTC()) {
		t.Fatalf("five-hour reset=%v", usage.FiveHour.ResetsAt)
	}

	subscription, err := parseQwenSubscription(map[string]any{
		"data": map[string]any{
			"DataV2": map[string]any{
				"data": map[string]any{
					"data": map[string]any{
						"specCode": "lite",
						"status":   "VALID",
						"endTime":  1787000000000,
					},
				},
			},
		},
	})
	if err != nil || subscription.SpecCode != "lite" || subscription.Status != "VALID" {
		t.Fatalf("subscription=%+v err=%v", subscription, err)
	}

	quotas, err := parseQwenQuotaConfig(map[string]any{
		"data": map[string]any{
			"DataV2": map[string]any{
				"data": map[string]any{
					"data": map[string]any{
						"lite": map[string]any{"five_hour": 700, "weekly": 2500},
					},
				},
			},
		},
	})
	if err != nil || quotas["lite"].FiveHour != "700" || quotas["lite"].Week != "2500" {
		t.Fatalf("quotas=%+v err=%v", quotas, err)
	}

	credits := usage.applyQuota(subscription, quotas)
	if credits.FiveHour.State != QwenCreditsLimited || credits.FiveHour.RemainingPercent == nil || *credits.FiveHour.RemainingPercent != 75 || credits.FiveHour.Total != "700" || credits.FiveHour.Used != "175" || credits.FiveHour.Remaining != "525" {
		t.Fatalf("five-hour credits=%+v", credits.FiveHour)
	}
	if credits.Week.State != QwenCreditsLimited || credits.Week.RemainingPercent == nil || *credits.Week.RemainingPercent != 60 || credits.Week.Total != "2500" || credits.Week.Used != "1000" || credits.Week.Remaining != "1500" {
		t.Fatalf("weekly credits=%+v", credits.Week)
	}
}

func TestQwenScannerRefreshesExpiredCredentialAndPersistsRotation(t *testing.T) {
	oldAccessToken := "expired-access-token"
	oldRefreshToken := "old-refresh-token"
	newAccessToken := "rotated-access-token"
	newRefreshToken := "rotated-refresh-token"
	expiresAt := time.Now().UTC().Add(-time.Minute)
	refreshServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/oauth/token" {
			t.Fatalf("refresh request=%s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != oldRefreshToken {
			t.Fatalf("refresh form=%v", r.Form)
		}
		fmt.Fprint(w, `{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","expires_in":3600}`)
	}))
	defer refreshServer.Close()

	var persisted QwenOAuthCredential
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+newAccessToken {
			t.Errorf("authorization=%q", got)
		}
		api := r.URL.Query().Get("api")
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(api, "/usage"):
			fmt.Fprint(w, `{"data":{"per5HourPercentage":0.1,"per1WeekPercentage":0.2}}`)
		case strings.HasSuffix(api, "/subscription"):
			fmt.Fprint(w, `{"data":{"specCode":"lite"}}`)
		case strings.HasSuffix(api, "/quota-config"):
			fmt.Fprint(w, `{"data":{"lite":{"five_hour":700,"weekly":2500}}}`)
		default:
			t.Fatalf("unexpected API=%q", api)
		}
	}))
	defer gateway.Close()

	scanner := NewQwenBailianScanner("sk-sp-configured", QwenOAuthCredential{
		AccessToken: oldAccessToken, RefreshToken: oldRefreshToken, ExpiresAt: &expiresAt,
	}, gateway.Client(), gateway.URL)
	scanner.OAuthTokenURL = refreshServer.URL + "/oauth/token"
	scanner.PersistCredential = func(credential QwenOAuthCredential) error {
		persisted = credential
		return nil
	}
	got := scanner.Scan(context.Background())
	if got.Status != ProviderOK || !got.Authenticated || len(got.Accounts) != 1 {
		t.Fatalf("snapshot=%+v", got)
	}
	if persisted.AccessToken != newAccessToken || persisted.RefreshToken != newRefreshToken || persisted.ExpiresAt == nil || !persisted.ExpiresAt.After(time.Now().UTC()) {
		t.Fatalf("persisted credential=%+v", persisted)
	}
}

func TestQwenScannerReportsAuthenticatedStatsUnavailableWhenSupplementaryQueryFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		api := r.URL.Query().Get("api")
		if strings.HasSuffix(api, "/subscription") {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(api, "/usage") {
			fmt.Fprint(w, `{"data":{"per5HourPercentage":0.1,"per1WeekPercentage":0.2}}`)
			return
		}
		t.Fatalf("unexpected API=%q", api)
	}))
	defer server.Close()

	got := NewQwenBailianScanner("sk-sp-configured", QwenOAuthCredential{AccessToken: "access-token"}, server.Client(), server.URL).Scan(context.Background())
	if got.Status != ProviderUnavailable || !got.Authenticated || len(got.Accounts) != 0 {
		t.Fatalf("snapshot=%+v, want logged-in stats-unavailable state", got)
	}
	if got.Message != "subscription unavailable" {
		t.Fatalf("message=%q", got.Message)
	}
}

func TestQwenMissingAbsoluteQuotaIsUnavailableWithoutPercentage(t *testing.T) {
	raw := map[string]any{
		"data": map[string]any{
			"per5HourPercentage": 0.25,
		},
	}
	parsed, err := parseQwenTokenPlanUsage(raw)
	if err != nil {
		t.Fatal(err)
	}
	data := parsed.toCredits()
	if data.FiveHour.State != QwenCreditsUnavailable || data.FiveHour.RemainingPercent != nil {
		t.Fatalf("five-hour window=%+v, want unavailable without percent", data.FiveHour)
	}
	if data.Week.State != QwenCreditsUnavailable || data.Week.RemainingPercent != nil {
		t.Fatalf("weekly window=%+v, want unavailable without percent", data.Week)
	}
	if limits := data.limits(); len(limits) != 0 {
		t.Fatalf("limits=%+v, want no tightness comparison for unavailable credits", limits)
	}
}

func TestQwenUnlimitedWindowIsExcludedFromTightnessLimits(t *testing.T) {
	parsed, err := parseQwenTokenPlanUsage(map[string]any{
		"per5HourPercentage": 0.9,
		"per1WeekPercentage": 0.2,
	})
	if err != nil {
		t.Fatal(err)
	}
	data := parsed.applyQuota(QwenSubscription{SpecCode: "pro"}, map[string]QwenQuotaConfig{
		"pro": {FiveHour: "unlimited", Week: "1000"},
	})
	if data.FiveHour.State != QwenCreditsUnlimited || data.FiveHour.RemainingPercent != nil {
		t.Fatalf("five-hour=%+v, want unlimited without percent", data.FiveHour)
	}
	if len(data.limits()) != 1 || data.limits()[0].ID != "week" {
		t.Fatalf("limits=%+v, want weekly only", data.limits())
	}
}

func TestHistoryStoreRecordsQwenSamplesForLocalTrend(t *testing.T) {
	path := t.TempDir() + "/usage-history.json"
	store := NewHistoryStore(path)
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	reset := now.Add(5 * 24 * time.Hour)
	if err := store.Record(now, []ProviderSnapshot{{
		ID: ProviderQwen, Status: ProviderOK,
		Accounts: []Account{{LocalID: "bailian-token-plan", Status: ProviderOK, Limits: []Limit{{
			ID: "week", Label: "7 days", RemainingPercent: 72,
			WindowKind: WindowFixed, WindowDurationMins: 10080, ResetsAt: &reset,
		}}}},
	}}); err != nil {
		t.Fatal(err)
	}
	response, err := store.Query(HistoryQuery{
		ProviderID: ProviderQwen, AccountLocalID: "bailian-token-plan", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Limits) != 1 || len(response.Limits[0].Samples) != 1 || response.Limits[0].Samples[0].RemainingPercent != 72 {
		t.Fatalf("Qwen history=%+v, want one local trend sample", response)
	}
}

func TestQwenScannerCallsOfficialConsoleGatewayWithoutPublishingSecrets(t *testing.T) {
	const accessToken = "access-token-secret"
	const apiKey = "sk-sp-qwen-secret"
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+accessToken {
			t.Errorf("authorization=%q", got)
		}
		if got := r.URL.Query().Get("action"); got != "BroadScopeAspnGateway" {
			t.Errorf("action=%q", got)
		}
		if got := r.URL.Query().Get("product"); got != "sfm_bailian" {
			t.Errorf("product=%q", got)
		}
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), apiKey) {
			t.Errorf("API key leaked into gateway body: %s", body)
		}
		params, err := url.ParseQuery(string(body))
		if err != nil {
			t.Errorf("form body: %v", err)
		} else {
			var request struct {
				Data struct {
					CornerstoneParam struct {
						SwitchUserType int `json:"switchUserType"`
					} `json:"cornerstoneParam"`
				} `json:"Data"`
			}
			if err := json.Unmarshal([]byte(params.Get("params")), &request); err != nil || request.Data.CornerstoneParam.SwitchUserType != 3 {
				t.Errorf("gateway params=%s", params.Get("params"))
			}
		}
		api := r.URL.Query().Get("api")
		calls = append(calls, api)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(api, "/usage"):
			fmt.Fprint(w, `{"data":{"DataV2":{"data":{"data":{"per5HourPercentage":0.1,"per1WeekPercentage":0.2}}}}}`)
		case strings.HasSuffix(api, "/subscription"):
			fmt.Fprint(w, `{"data":{"DataV2":{"data":{"data":{"specCode":"lite","status":"VALID"}}}}}`)
		case strings.HasSuffix(api, "/quota-config"):
			fmt.Fprint(w, `{"data":{"DataV2":{"data":{"data":{"lite":{"five_hour":700,"weekly":2500}}}}}}`)
		default:
			t.Fatalf("unexpected API=%q", api)
		}
	}))
	defer server.Close()

	got := NewQwenBailianScanner(apiKey, QwenOAuthCredential{AccessToken: accessToken}, server.Client(), server.URL).Scan(context.Background())
	if got.ID != ProviderQwen || got.Status != ProviderOK || len(got.Accounts) != 1 {
		t.Fatalf("snapshot=%+v", got)
	}
	if got.Accounts[0].Qwen == nil || got.Accounts[0].Qwen.FiveHour.RemainingPercent == nil || *got.Accounts[0].Qwen.FiveHour.RemainingPercent != 90 || got.Accounts[0].Qwen.FiveHour.Total != "700" || got.Accounts[0].Qwen.FiveHour.Used != "70" || got.Accounts[0].Qwen.FiveHour.Remaining != "630" {
		t.Fatalf("qwen usage=%+v", got.Accounts[0].Qwen)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), accessToken) || strings.Contains(string(raw), apiKey) {
		t.Fatalf("secret leaked into snapshot: %s", raw)
	}
	if len(calls) != 3 {
		t.Fatalf("calls=%v", calls)
	}
}
