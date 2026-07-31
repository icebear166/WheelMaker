package usage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const deepSeekPlatformFixture = `{
  "code": 0,
  "bizData": {
    "monthly_costs": [{"currency": "CNY", "total": 8.8}],
    "normal_wallets": [{"currency": "CNY", "total_balance": "3.24", "granted_balance": "0.00", "topped_up_balance": "3.24"}],
    "bonus_wallets": []
  }
}`

const deepSeekAmountFixture = `{
  "code": 0,
  "data": {
    "days": [
      {
        "date": "2026-08-01",
        "models": [
          {
            "model": "deepseek-v4-flash",
            "usage": [
              {"type": "REQUEST", "amount": 3},
              {"type": "RESPONSE_TOKEN", "amount": 120},
              {"type": "PROMPT_CACHE_HIT_TOKEN", "amount": 300},
              {"type": "PROMPT_CACHE_MISS_TOKEN", "amount": 100}
            ]
          }
        ]
      }
    ]
  }
}`

const deepSeekCostFixture = `{
  "code": 0,
  "bizData": {
    "currencies": [
      {
        "currency": "CNY",
        "total": [{"model": "deepseek-v4-flash", "usage": [{"type": "RESPONSE_TOKEN", "amount": 0.02}]}],
        "days": [{"date": "2026-08-01", "amount": 0.02}]
      }
    ]
  }
}`

func TestParseDeepSeekPlatformFixtures(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	balance, err := parseDeepSeekSummary(asMap(t, deepSeekPlatformFixture), now)
	if err != nil || len(balance) != 1 || balance[0].Currency != "CNY" || balance[0].Total != "3.24" {
		t.Fatalf("balance=%+v err=%v", balance, err)
	}
	days, err := parseDeepSeekAmount(asMap(t, deepSeekAmountFixture))
	if err != nil || len(days) != 1 {
		t.Fatalf("days=%+v err=%v", days, err)
	}
	day := days[0]
	if day.Date != "2026-08-01" || day.Request != 3 || day.OutputTokens != 120 ||
		day.HitTokens != 300 || day.MissTokens != 100 || day.TotalTokens != 520 {
		t.Fatalf("day=%+v", day)
	}
	costs, err := parseDeepSeekCost(asMap(t, deepSeekCostFixture), now, DeepSeekPlatformMonth{Year: 2026, Month: 8})
	if err != nil || len(costs) != 1 || costs[0].Currency != "CNY" || costs[0].TodayCost != 0.02 || len(costs[0].Daily) != 1 {
		t.Fatalf("costs=%+v err=%v", costs, err)
	}
}

func TestDeepSeekPlatformStoreCacheAndExpired(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		switch {
		case strings.Contains(r.URL.Path, "get_user_summary"):
			_, _ = w.Write([]byte(deepSeekPlatformFixture))
		case strings.Contains(r.URL.Path, "usage/amount"):
			_, _ = w.Write([]byte(deepSeekAmountFixture))
		case strings.Contains(r.URL.Path, "usage/cost"):
			_, _ = w.Write([]byte(deepSeekCostFixture))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	store := NewDeepSeekPlatformStore("session-token", server.Client(), server.URL)
	first, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || first.Status != DeepSeekPlatformOK || len(first.Days) != 1 || len(first.Costs) != 1 {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	if calls.Load() != 3 {
		t.Fatalf("expected 3 upstream calls, got %d", calls.Load())
	}
	cached, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || len(cached.Days) != 1 {
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

func TestDeepSeekPlatformStoreExpiredKeepsCache(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) <= 3 {
			switch {
			case strings.Contains(r.URL.Path, "get_user_summary"):
				_, _ = w.Write([]byte(deepSeekPlatformFixture))
			case strings.Contains(r.URL.Path, "usage/amount"):
				_, _ = w.Write([]byte(deepSeekAmountFixture))
			default:
				_, _ = w.Write([]byte(deepSeekCostFixture))
			}
			return
		}
		_, _ = w.Write([]byte(`{"code":40003,"msg":"Authorization Failed (invalid token)"}`))
	}))
	defer server.Close()

	store := NewDeepSeekPlatformStore("session-token", server.Client(), server.URL)
	first, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || first.Status != DeepSeekPlatformOK {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	got, err := store.Get(context.Background(), 2026, 8, true)
	if err != nil {
		t.Fatalf("expired fetch: %v", err)
	}
	if got.Status != DeepSeekPlatformExpired || len(got.Days) != 1 {
		t.Fatalf("expired response must keep cached data: %+v", got)
	}
}

func TestDeepSeekPlatformStoreNotConnected(t *testing.T) {
	store := NewDeepSeekPlatformStore("", nil)
	got, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || got.Status != DeepSeekPlatformNotConnected {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func asMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	return out
}
