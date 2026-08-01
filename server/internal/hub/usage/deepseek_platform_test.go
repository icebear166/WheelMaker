package usage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

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
