# DeepSeek Platform Usage (Redo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert the initial DeepSeek platform usage implementation (13 code commits) and rebuild it on top of real captured API structures, per `spec-deepseek-platform-usage.md` (redo version).

**Architecture:** Hub fetches three private platform endpoints (`get_user_summary`, `usage/amount`, `usage/cost`) with a session token, parses them with strict typed decoders, caches per `(year, month)`, and serves the additive read-only Registry method `deepseek.usage.get`. Web renders a dialog that reuses the `usage-history` shell; Desktop/Android embed the official login page and read `localStorage.userToken` precisely.

**Tech Stack:** Go (hub/registry), React + TypeScript + ECharts (web), WebView2 (desktop), Kotlin WebView (android), Jest + go test.

**Reference material:**
- Real captured (sanitized) fixtures: `docs/scope/2026-08-01-deepseek-platform-usage/fixtures/` (`get_user_summary.json`, `usage_amount.json`, `usage_cost.json` for 2026-08; `*_prev_month.json` for 2026-07).
- Old implementation in git history (cherry-pick sources): `04ce29e6` hubconfig, `93cffd5a` protocol method, `c006903a` hub handler, `bb1b60ec` web transport, `90f3ec4d` monitor wiring, `6fa70f1c` desktop login, `93836e77`+`da3da061`+`2804066c`+`05f133b1` android login.
- Worktree: `.worktree/deepseek-platform-usage-redo`, branch `deepseek-platform-usage-redo`. All commands run from the worktree root.

**Verified API facts (from 2026-08-01 capture):**
- Envelope: `{code, msg, data: {biz_code, biz_msg, biz_data}}` (snake_case). `code` or `biz_code` = 40002/40003 → token expired.
- `get_user_summary` → `biz_data.normal_wallets[]` / `bonus_wallets[]`, wallet = `{currency, balance: decimal-string, token_estimation}`.
- `usage/amount` → `biz_data.{total[], days[]}`, `days` padded to full month; day = `{date, data[]}`; model usage types: `REQUEST`, `PROMPT_TOKEN` (always "0", ignored), `PROMPT_CACHE_HIT_TOKEN`, `PROMPT_CACHE_MISS_TOKEN`, `RESPONSE_TOKEN`; `amount` = integer string.
- `usage/cost` → `biz_data[]` per currency `{currency, total[], days[]}`; daily cost = sum of non-`REQUEST` amounts (decimal strings).
- Token storage: `localStorage.userToken` = `{"value":"<token>","__version":"0"}`.

---

### Task 1: Commit spec, fixtures, wiki, and this plan

**Files:**
- `docs/scope/2026-08-01-deepseek-platform-usage/spec-deepseek-platform-usage.md` (already rewritten)
- `docs/scope/2026-08-01-deepseek-platform-usage/fixtures/*.json` (already generated)
- `docs/scope/2026-08-01-deepseek-platform-usage/plan-deepseek-platform-usage.md` (this file)
- `docs/wiki/features/limits-monitoring.md` (DeepSeek section already rewritten)

- [ ] **Step 1: Commit docs**

```bash
git add docs/scope/2026-08-01-deepseek-platform-usage docs/wiki/features/limits-monitoring.md
git commit -m "docs: respec deepseek platform usage redo with verified fixtures"
```

---

### Task 2: Revert the initial implementation (13 code commits)

Reverts in reverse chronological order. Doc commits (`f2ef31f0`, `2d7fdcf1`) are intentionally excluded — the spec/plan/wiki were already replaced in Task 1. Unrelated commits `f57a2c2c` and `c20fc00f` are excluded.

**Files:** all files touched by the 13 commits (see `git log --oneline 04ce29e6^..05f133b1`).

- [ ] **Step 1: Revert all 13 commits into the index**

```bash
git revert --no-commit 05f133b1 2804066c da3da061 93836e77 6fa70f1c 90f3ec4d ee0a99a3 8e635714 bb1b60ec c006903a 93cffd5a f259b88f 04ce29e6
```

Expected: completes without conflicts (commits form a contiguous chain).

- [ ] **Step 2: Verify no deepseek-usage code remains**

```bash
rg -il "deepseek" --glob '!docs/**' --glob '!**/dist/**' | sort
```

Expected remaining matches only in: `server/internal/hub/agent/cxdeepseek/`, `server/internal/hub/agent/codexapp_deepseek.go`, `server/internal/hub/agent/factory.go`, `server/internal/hub/agent/skills.go`, `app/web/src/chat/` (cx-deepseek agent feature, unrelated). `server/internal/hubconfig/store.go`, `server/internal/hub/reporter.go`, `app/web/src/usage/` must NOT appear.

- [ ] **Step 3: Verify build and tests are green post-revert**

```bash
cd server && go build ./... && go test ./... 2>&1 | tail -20
cd ../app && npm test 2>&1 | tail -10 && npm run tsc:web
cd ..
```

Expected: all PASS.

- [ ] **Step 4: Commit the revert**

```bash
git add -A
git commit -m "revert: deepseek platform usage initial implementation"
```

---

### Task 3: Restore hubconfig platform token secret

The old hubconfig secret implementation was correct — restore it unchanged.

**Files:**
- `server/internal/hubconfig/store.go`
- `server/internal/hubconfig/store_test.go`

- [ ] **Step 1: Cherry-pick the old commit**

```bash
git cherry-pick 04ce29e6
```

Expected: clean pick, keeps message `feat(hubconfig): store deepseek platform session token`.

- [ ] **Step 2: Verify tests**

```bash
cd server && go test ./internal/hubconfig/ -run TestDeepSeek -v
```

Expected: PASS (set/clear/redact/snapshot tests).

---

### Task 4: Rewrite the platform client with verified parsing

Strict typed parsing replaces the speculative multi-key guessing. Key behaviors: snake_case envelope, 40002/40003 at either level → expired; `balance`/`amount` decimal/integer strings; `PROMPT_TOKEN` ignored; `days` full-month padded; daily cost = non-`REQUEST` sum; month cost = `total[]` non-`REQUEST` sum; network/5xx and expired both fall back to stale cache with status `error`/`expired`.

**Files:**
- Create: `server/internal/hub/usage/testdata/deepseek_user_summary.json`
- Create: `server/internal/hub/usage/testdata/deepseek_usage_amount.json`
- Create: `server/internal/hub/usage/testdata/deepseek_usage_cost.json`
- Create: `server/internal/hub/usage/deepseek_platform.go`
- Create: `server/internal/hub/usage/deepseek_platform_test.go`

- [ ] **Step 1: Copy sanitized fixtures into testdata**

```bash
mkdir -p server/internal/hub/usage/testdata
cp docs/scope/2026-08-01-deepseek-platform-usage/fixtures/get_user_summary.json server/internal/hub/usage/testdata/deepseek_user_summary.json
cp docs/scope/2026-08-01-deepseek-platform-usage/fixtures/usage_amount.json server/internal/hub/usage/testdata/deepseek_usage_amount.json
cp docs/scope/2026-08-01-deepseek-platform-usage/fixtures/usage_cost.json server/internal/hub/usage/testdata/deepseek_usage_cost.json
```

- [ ] **Step 2: Write the failing test**

Create `server/internal/hub/usage/deepseek_platform_test.go`:

```go
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
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd server && go test ./internal/hub/usage/ -run TestParseDeepSeek -v
```

Expected: FAIL — `deepSeekEnvelope`, `parseDeepSeekSummaryBalance` etc. undefined.

- [ ] **Step 4: Write the implementation**

Create `server/internal/hub/usage/deepseek_platform.go`:

```go
package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	deepSeekPlatformBaseURL          = "https://platform.deepseek.com"
	deepSeekPlatformCurrentMonthTTL  = 5 * time.Minute
	deepSeekPlatformPastMonthTTL     = 24 * time.Hour
	deepSeekPlatformMaxResponseBytes = 4 << 20
)

var errDeepSeekSessionExpired = errors.New("deepseek platform session expired")

type DeepSeekPlatformStatus string

const (
	DeepSeekPlatformOK           DeepSeekPlatformStatus = "ok"
	DeepSeekPlatformNotConnected DeepSeekPlatformStatus = "notConnected"
	DeepSeekPlatformExpired      DeepSeekPlatformStatus = "expired"
	DeepSeekPlatformError        DeepSeekPlatformStatus = "error"
)

type DeepSeekPlatformMonth struct {
	Year  int `json:"year"`
	Month int `json:"month"`
}

type DeepSeekPlatformDay struct {
	Date         string `json:"date"`
	Request      int64  `json:"request"`
	OutputTokens int64  `json:"outputTokens"`
	HitTokens    int64  `json:"hitTokens"`
	MissTokens   int64  `json:"missTokens"`
	TotalTokens  int64  `json:"totalTokens"`
}

type DeepSeekPlatformCostDay struct {
	Date   string  `json:"date"`
	Amount float64 `json:"amount"`
}

type DeepSeekPlatformCost struct {
	Currency    string                    `json:"currency"`
	MonthlyCost float64                   `json:"monthlyCost"`
	TodayCost   float64                   `json:"todayCost"`
	Daily       []DeepSeekPlatformCostDay `json:"daily"`
}

type DeepSeekPlatformUsage struct {
	Status   DeepSeekPlatformStatus `json:"status"`
	Month    DeepSeekPlatformMonth  `json:"month"`
	Message  string                 `json:"message,omitempty"`
	Balance  []BalanceItem          `json:"balance,omitempty"`
	Days     []DeepSeekPlatformDay  `json:"days,omitempty"`
	Costs    []DeepSeekPlatformCost `json:"costs,omitempty"`
	CachedAt *time.Time             `json:"cachedAt,omitempty"`
}

// Wire types for the verified platform response shapes (2026-08-01 capture).
// All endpoints share the envelope {code, msg, data: {biz_code, biz_msg, biz_data}}.

type deepSeekEnvelope struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		BizCode int             `json:"biz_code"`
		BizMsg  string          `json:"biz_msg"`
		BizData json.RawMessage `json:"biz_data"`
	} `json:"data"`
}

type deepSeekWallet struct {
	Currency string `json:"currency"`
	Balance  string `json:"balance"`
}

type deepSeekSummaryBiz struct {
	NormalWallets []deepSeekWallet `json:"normal_wallets"`
	BonusWallets  []deepSeekWallet `json:"bonus_wallets"`
}

type deepSeekUsageItem struct {
	Type   string `json:"type"`
	Amount string `json:"amount"`
}

type deepSeekModelUsage struct {
	Model string              `json:"model"`
	Usage []deepSeekUsageItem `json:"usage"`
}

type deepSeekDayUsage struct {
	Date string               `json:"date"`
	Data []deepSeekModelUsage `json:"data"`
}

type deepSeekAmountBiz struct {
	Total []deepSeekModelUsage `json:"total"`
	Days  []deepSeekDayUsage   `json:"days"`
}

type deepSeekCostBlock struct {
	Currency string               `json:"currency"`
	Total    []deepSeekModelUsage `json:"total"`
	Days     []deepSeekDayUsage   `json:"days"`
}

// DeepSeekPlatformClient fetches and parses the platform endpoints once.
type DeepSeekPlatformClient struct {
	Token   string
	BaseURL string
	Client  *http.Client
	Now     func() time.Time
}

func (c *DeepSeekPlatformClient) Fetch(ctx context.Context, year, month int) (DeepSeekPlatformUsage, error) {
	token := strings.TrimSpace(c.Token)
	monthValue := DeepSeekPlatformMonth{Year: year, Month: month}
	if token == "" {
		return DeepSeekPlatformUsage{Status: DeepSeekPlatformNotConnected, Month: monthValue}, nil
	}
	httpClient := c.Client
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	baseURL := strings.TrimRight(c.BaseURL, "/")
	if baseURL == "" {
		baseURL = deepSeekPlatformBaseURL
	}
	monthQuery := "year=" + strconv.Itoa(year) + "&month=" + strconv.Itoa(month)
	type fetchResult struct {
		kind string
		raw  json.RawMessage
		err  error
	}
	results := make(chan fetchResult, 3)
	go func() {
		raw, err := c.fetchBizData(ctx, httpClient, baseURL, "/api/v0/users/get_user_summary", token)
		results <- fetchResult{kind: "summary", raw: raw, err: err}
	}()
	go func() {
		raw, err := c.fetchBizData(ctx, httpClient, baseURL, "/api/v0/usage/amount?"+monthQuery, token)
		results <- fetchResult{kind: "amount", raw: raw, err: err}
	}()
	go func() {
		raw, err := c.fetchBizData(ctx, httpClient, baseURL, "/api/v0/usage/cost?"+monthQuery, token)
		results <- fetchResult{kind: "cost", raw: raw, err: err}
	}()
	var summaryRaw, amountRaw, costRaw json.RawMessage
	for range 3 {
		result := <-results
		if result.err != nil {
			return DeepSeekPlatformUsage{}, result.err
		}
		switch result.kind {
		case "summary":
			summaryRaw = result.raw
		case "amount":
			amountRaw = result.raw
		case "cost":
			costRaw = result.raw
		}
	}
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	balance, err := parseDeepSeekSummaryBalance(summaryRaw)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	days, err := parseDeepSeekAmountDays(amountRaw)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	costs, err := parseDeepSeekCosts(costRaw, now, monthValue)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	return DeepSeekPlatformUsage{
		Status:  DeepSeekPlatformOK,
		Month:   monthValue,
		Balance: balance,
		Days:    days,
		Costs:   costs,
	}, nil
}

func (c *DeepSeekPlatformClient) fetchBizData(ctx context.Context, client *http.Client, baseURL, path, token string) (json.RawMessage, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("deepseek platform %s: %w", path, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, deepSeekPlatformMaxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("deepseek platform %s: %w", path, err)
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return nil, errDeepSeekSessionExpired
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("deepseek platform %s: HTTP %d", path, response.StatusCode)
	}
	var envelope deepSeekEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("deepseek platform %s: invalid JSON", path)
	}
	if deepSeekIsExpiredCode(envelope.Code) || deepSeekIsExpiredCode(envelope.Data.BizCode) {
		return nil, errDeepSeekSessionExpired
	}
	if envelope.Code != 0 {
		return nil, fmt.Errorf("deepseek platform %s: code %d (%s)", path, envelope.Code, envelope.Msg)
	}
	if envelope.Data.BizCode != 0 {
		return nil, fmt.Errorf("deepseek platform %s: biz_code %d (%s)", path, envelope.Data.BizCode, envelope.Data.BizMsg)
	}
	if len(envelope.Data.BizData) == 0 {
		return nil, fmt.Errorf("deepseek platform %s: missing biz_data", path)
	}
	return envelope.Data.BizData, nil
}

func deepSeekIsExpiredCode(code int) bool {
	return code == 40002 || code == 40003
}

func parseDeepSeekSummaryBalance(raw json.RawMessage) ([]BalanceItem, error) {
	var payload deepSeekSummaryBiz
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("parse user summary: %w", err)
	}
	type currencyTotals struct {
		toppedUp float64
		granted  float64
	}
	totals := map[string]*currencyTotals{}
	add := func(wallets []deepSeekWallet, granted bool) error {
		for _, wallet := range wallets {
			amount, err := deepSeekDecimal(wallet.Balance)
			if err != nil {
				return fmt.Errorf("parse user summary wallet: %w", err)
			}
			entry := totals[wallet.Currency]
			if entry == nil {
				entry = &currencyTotals{}
				totals[wallet.Currency] = entry
			}
			if granted {
				entry.granted += amount
			} else {
				entry.toppedUp += amount
			}
		}
		return nil
	}
	if err := add(payload.NormalWallets, false); err != nil {
		return nil, err
	}
	if err := add(payload.BonusWallets, true); err != nil {
		return nil, err
	}
	currencies := make([]string, 0, len(totals))
	for currency := range totals {
		currencies = append(currencies, currency)
	}
	sort.Strings(currencies)
	items := make([]BalanceItem, 0, len(currencies))
	for _, currency := range currencies {
		entry := totals[currency]
		items = append(items, BalanceItem{
			Currency: currency,
			Total:    deepSeekFormatMoney(entry.toppedUp + entry.granted),
			Granted:  deepSeekFormatMoney(entry.granted),
			ToppedUp: deepSeekFormatMoney(entry.toppedUp),
		})
	}
	return items, nil
}

func parseDeepSeekAmountDays(raw json.RawMessage) ([]DeepSeekPlatformDay, error) {
	var payload deepSeekAmountBiz
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("parse usage amount: %w", err)
	}
	days := make([]DeepSeekPlatformDay, 0, len(payload.Days))
	for _, day := range payload.Days {
		totals, err := deepSeekTokenTotals(day.Data)
		if err != nil {
			return nil, err
		}
		days = append(days, DeepSeekPlatformDay{
			Date:         day.Date,
			Request:      totals.request,
			OutputTokens: totals.output,
			HitTokens:    totals.hit,
			MissTokens:   totals.miss,
			TotalTokens:  totals.hit + totals.miss + totals.output,
		})
	}
	return days, nil
}

type deepSeekTokenAggregate struct {
	request int64
	output  int64
	hit     int64
	miss    int64
}

// deepSeekTokenTotals sums token usage across models. PROMPT_TOKEN is a legacy
// aggregate that is always zero on current models and is ignored to avoid
// double counting against hit+miss.
func deepSeekTokenTotals(models []deepSeekModelUsage) (deepSeekTokenAggregate, error) {
	var totals deepSeekTokenAggregate
	for _, model := range models {
		for _, item := range model.Usage {
			if item.Type == "PROMPT_TOKEN" {
				continue
			}
			amount, err := deepSeekTokenAmount(item.Amount)
			if err != nil {
				return totals, err
			}
			switch item.Type {
			case "REQUEST":
				totals.request += amount
			case "RESPONSE_TOKEN":
				totals.output += amount
			case "PROMPT_CACHE_HIT_TOKEN":
				totals.hit += amount
			case "PROMPT_CACHE_MISS_TOKEN":
				totals.miss += amount
			}
		}
	}
	return totals, nil
}

func parseDeepSeekCosts(raw json.RawMessage, now time.Time, month DeepSeekPlatformMonth) ([]DeepSeekPlatformCost, error) {
	var blocks []deepSeekCostBlock
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return nil, fmt.Errorf("parse usage cost: %w", err)
	}
	currentMonth := now.Year() == month.Year && int(now.Month()) == month.Month
	today := now.Format("2006-01-02")
	costs := make([]DeepSeekPlatformCost, 0, len(blocks))
	for _, block := range blocks {
		monthly, err := deepSeekCostSum(block.Total)
		if err != nil {
			return nil, err
		}
		cost := DeepSeekPlatformCost{Currency: block.Currency, MonthlyCost: monthly}
		for _, day := range block.Days {
			amount, err := deepSeekCostSum(day.Data)
			if err != nil {
				return nil, err
			}
			cost.Daily = append(cost.Daily, DeepSeekPlatformCostDay{Date: day.Date, Amount: amount})
			if currentMonth && day.Date == today {
				cost.TodayCost = amount
			}
		}
		costs = append(costs, cost)
	}
	return costs, nil
}

// deepSeekCostSum adds non-REQUEST usage amounts (REQUEST carries no charge).
func deepSeekCostSum(models []deepSeekModelUsage) (float64, error) {
	var sum float64
	for _, model := range models {
		for _, item := range model.Usage {
			if item.Type == "REQUEST" {
				continue
			}
			amount, err := deepSeekDecimal(item.Amount)
			if err != nil {
				return 0, err
			}
			sum += amount
		}
	}
	return sum, nil
}

func deepSeekDecimal(raw string) (float64, error) {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid decimal amount %q", raw)
	}
	return value, nil
}

func deepSeekTokenAmount(raw string) (int64, error) {
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid token amount %q", raw)
	}
	return value, nil
}

func deepSeekFormatMoney(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

type deepSeekPlatformCacheEntry struct {
	usage     DeepSeekPlatformUsage
	fetchedAt time.Time
}

// DeepSeekPlatformStore owns the token and the per-month cache.
type DeepSeekPlatformStore struct {
	mu      sync.RWMutex
	token   string
	baseURL string
	client  *http.Client
	now     func() time.Time
	cache   map[string]deepSeekPlatformCacheEntry
}

func NewDeepSeekPlatformStore(token string, client *http.Client, baseURLs ...string) *DeepSeekPlatformStore {
	baseURL := ""
	if len(baseURLs) > 0 {
		baseURL = strings.TrimRight(baseURLs[0], "/")
	}
	return &DeepSeekPlatformStore{
		token:   strings.TrimSpace(token),
		baseURL: baseURL,
		client:  client,
		now:     time.Now,
		cache:   map[string]deepSeekPlatformCacheEntry{},
	}
}

// SetToken replaces the session token and drops cached responses.
func (s *DeepSeekPlatformStore) SetToken(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.token = strings.TrimSpace(token)
	s.cache = map[string]deepSeekPlatformCacheEntry{}
}

// Get returns cached or freshly fetched platform usage for the month.
// Expired sessions and platform failures both fall back to the last
// successful cache (status expired/error + message); the cache is never
// overwritten by a failed fetch.
func (s *DeepSeekPlatformStore) Get(ctx context.Context, year, month int, force bool) (DeepSeekPlatformUsage, error) {
	key := fmt.Sprintf("%d-%02d", year, month)
	s.mu.RLock()
	entry, exists := s.cache[key]
	token := s.token
	now := s.now().UTC()
	s.mu.RUnlock()
	if exists && !force && deepSeekCacheFresh(entry, now, year, month) {
		return entry.usage, nil
	}
	client := DeepSeekPlatformClient{Token: token, BaseURL: s.baseURL, Client: s.client, Now: s.now}
	usage, err := client.Fetch(ctx, year, month)
	if err != nil {
		status := DeepSeekPlatformError
		message := "platform request failed"
		if errors.Is(err, errDeepSeekSessionExpired) {
			status = DeepSeekPlatformExpired
			message = "platform session expired"
		}
		s.mu.RLock()
		entry, exists = s.cache[key]
		s.mu.RUnlock()
		if exists {
			stale := entry.usage
			stale.Status = status
			stale.Message = message
			return stale, nil
		}
		return DeepSeekPlatformUsage{
			Status:  status,
			Month:   DeepSeekPlatformMonth{Year: year, Month: month},
			Message: message,
		}, nil
	}
	usage.Month = DeepSeekPlatformMonth{Year: year, Month: month}
	usage.CachedAt = &now
	s.mu.Lock()
	s.cache[key] = deepSeekPlatformCacheEntry{usage: usage, fetchedAt: now}
	s.mu.Unlock()
	return usage, nil
}

func deepSeekCacheFresh(entry deepSeekPlatformCacheEntry, now time.Time, year, month int) bool {
	ttl := deepSeekPlatformPastMonthTTL
	if year == now.Year() && month == int(now.Month()) {
		ttl = deepSeekPlatformCurrentMonthTTL
	}
	return now.Sub(entry.fetchedAt) < ttl
}
```

Note: `BalanceItem` already exists in the `usage` package with `Currency`, `Total`, `Granted`, `ToppedUp` string fields — verify with `rg "type BalanceItem" server/internal/hub/usage/`.

- [ ] **Step 5: Run the tests**

```bash
cd server && go test ./internal/hub/usage/ -run "DeepSeek" -v
```

Expected: all PASS (fixture parse, malformed rejection, expired codes, cache TTL/force, stale on expired/error, notConnected).

- [ ] **Step 6: Commit**

```bash
git add server/internal/hub/usage/
git commit -m "feat(usage): fetch deepseek platform usage with verified parsing"
```

---

### Task 5: Restore the protocol method

The old protocol registration was correct — restore unchanged.

**Files:**
- `server/internal/protocol/registry_methods.go`
- `server/internal/protocol/registry_methods_test.go`
- `server/internal/registry/server_test.go`

- [ ] **Step 1: Cherry-pick**

```bash
git cherry-pick 93cffd5a
```

Expected: clean pick (`feat(protocol): expose deepseek usage read method`).

- [ ] **Step 2: Verify**

```bash
cd server && go test ./internal/protocol/ ./internal/registry/ -run "DeepSeek" -v
```

Expected: PASS (method descriptor + registry forwarding by envelope hubId).

---

### Task 6: Restore hub handler and add error/message passthrough

**Files:**
- `server/internal/hub/reporter.go`
- `server/internal/hub/hub_test.go`

- [ ] **Step 1: Cherry-pick without committing**

```bash
git cherry-pick -n c006903a
```

Expected: clean (restores `deepSeekUsageGetPayload`, `deepSeekUsageSource`, `Reporter.deepSeekUsage`, wiring in `NewReporter`, `replyDeepSeekUsageGet`, the `deepSeekPlatform` case in `applyHubConfigUpdate`, and the two handler tests).

- [ ] **Step 2: Pass the message field through the response payload**

In `server/internal/hub/reporter.go`, in `replyDeepSeekUsageGet`, change the payload map from:

```go
		Payload: rp.MustRaw(map[string]any{
			"hubId":    r.cfg.HubID,
			"status":   result.Status,
			"month":    result.Month,
			"balance":  result.Balance,
			"days":     result.Days,
			"costs":    result.Costs,
			"cachedAt": result.CachedAt,
		}),
```

to:

```go
		Payload: rp.MustRaw(map[string]any{
			"hubId":    r.cfg.HubID,
			"status":   result.Status,
			"month":    result.Month,
			"message":  result.Message,
			"balance":  result.Balance,
			"days":     result.Days,
			"costs":    result.Costs,
			"cachedAt": result.CachedAt,
		}),
```

- [ ] **Step 3: Add an error-status test**

Append to `server/internal/hub/hub_test.go` (after `TestReporterRespondsToDeepSeekUsageGet`):

```go
func TestReporterRespondsToDeepSeekUsageGetErrorWithMessage(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-deepseek-usage-error", testEnvelope{
		RequestID: 203,
		Type:      "request",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage-error",
		Payload:   map[string]any{"year": 2026, "month": 8},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		Server:            strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-deepseek-usage-error",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)
	reporter.deepSeekUsage = &deepSeekUsageStub{result: usage.DeepSeekPlatformUsage{
		Status:  usage.DeepSeekPlatformError,
		Message: "platform request failed",
		Month:   usage.DeepSeekPlatformMonth{Year: 2026, Month: 8},
		Days: []usage.DeepSeekPlatformDay{{
			Date: "2026-07-31", Request: 267, OutputTokens: 213950, HitTokens: 84587904, MissTokens: 546731, TotalTokens: 85348585,
		}},
	}}

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Payload["status"] != "error" || resp.Payload["message"] != "platform request failed" {
			t.Fatalf("response payload=%#v", resp.Payload)
		}
		if days, ok := resp.Payload["days"].([]any); !ok || len(days) != 1 {
			t.Fatalf("stale days missing: %#v", resp.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive deepseek.usage.get response")
	}
}
```

- [ ] **Step 4: Run tests**

```bash
cd server && go test ./internal/hub/ -run "DeepSeekUsage" -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(hub): serve deepseek platform usage with stale error status"
```

---

### Task 7: Restore web transport with error status

**Files:**
- `app/web/src/registry/registryMethods.ts`
- `app/web/src/registry/registryTypes.ts`
- `app/web/src/registry/RegistryRepository.ts`
- `app/web/src/registry/RegistryWorkspaceService.ts`
- `app/__tests__/web-hub-state-service.test.ts`
- `app/web/src/app/ChatHubMenu.test.tsx`

- [ ] **Step 1: Cherry-pick without committing**

```bash
git cherry-pick -n bb1b60ec
```

Expected: clean.

- [ ] **Step 2: Add the error status and message to the types**

In `app/web/src/registry/registryTypes.ts`, change `RegistryDeepSeekUsageResponse` from:

```ts
export interface RegistryDeepSeekUsageResponse {
  hubId: string;
  status: 'ok' | 'notConnected' | 'expired';
  month: {year: number; month: number};
  balance?: Array<{currency: string; total: string; granted?: string; toppedUp?: string}>;
  days?: RegistryDeepSeekUsageDay[];
  costs?: RegistryDeepSeekUsageCost[];
  cachedAt?: string;
}
```

to:

```ts
export interface RegistryDeepSeekUsageResponse {
  hubId: string;
  status: 'ok' | 'notConnected' | 'expired' | 'error';
  month: {year: number; month: number};
  message?: string;
  balance?: Array<{currency: string; total: string; granted?: string; toppedUp?: string}>;
  days?: RegistryDeepSeekUsageDay[];
  costs?: RegistryDeepSeekUsageCost[];
  cachedAt?: string;
}
```

- [ ] **Step 3: Parse the full payload for every status**

`expired`/`error` responses now carry stale data, so the early return for non-ok statuses must go. In `app/web/src/registry/RegistryRepository.ts`, replace the whole `normalizeDeepSeekUsageResponse` function with:

```ts
function normalizeDeepSeekUsageResponse(
  raw: unknown,
  hubId: string,
): RegistryDeepSeekUsageResponse | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const status = input.status;
  const month = input.month as {year?: unknown; month?: unknown} | undefined;
  if (
    input.hubId !== hubId
    || (status !== 'ok' && status !== 'notConnected' && status !== 'expired' && status !== 'error')
    || !month
    || typeof month.year !== 'number'
    || typeof month.month !== 'number'
  ) {
    return null;
  }
  const days = Array.isArray(input.days)
    ? input.days.map(normalizeDeepSeekUsageDay).filter((day): day is RegistryDeepSeekUsageDay => day !== null)
    : [];
  const costs = Array.isArray(input.costs)
    ? input.costs.map(normalizeDeepSeekUsageCost).filter((cost): cost is RegistryDeepSeekUsageCost => cost !== null)
    : [];
  if (days.length !== (Array.isArray(input.days) ? input.days.length : 0)) return null;
  if (costs.length !== (Array.isArray(input.costs) ? input.costs.length : 0)) return null;
  return {
    hubId,
    status,
    month: {year: month.year, month: month.month},
    message: typeof input.message === 'string' && input.message !== '' ? input.message : undefined,
    balance: Array.isArray(input.balance)
      ? input.balance as RegistryDeepSeekUsageResponse['balance']
      : undefined,
    days,
    costs,
    cachedAt: typeof input.cachedAt === 'string' ? input.cachedAt : undefined,
  };
}
```

- [ ] **Step 4: Run transport tests**

```bash
cd app && npm test -- web-hub-state-service web-backend-secret-settings 2>&1 | tail -8
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/registry app/__tests__/web-hub-state-service.test.ts app/web/src/app/ChatHubMenu.test.tsx
git commit -m "feat(app): transport deepseek platform usage with error status"
```

---

### Task 8: Rewrite the usage view model (multi-currency)

**Files:**
- Create: `app/web/src/usage/deepSeekUsage.ts`
- Create: `app/__tests__/web-deepseek-usage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/web-deepseek-usage.test.ts`:

```ts
import {deepSeekHitRate, normalizeDeepSeekUsage} from '../web/src/usage/deepSeekUsage';
import type {RegistryDeepSeekUsageResponse} from '../web/src/registry/registryTypes';

function makeResponse(overrides: Partial<RegistryDeepSeekUsageResponse> = {}): RegistryDeepSeekUsageResponse {
  return {
    hubId: 'hub-1',
    status: 'ok',
    month: {year: 2026, month: 8},
    balance: [{currency: 'CNY', total: '1.25', granted: '0.00', toppedUp: '1.25'}],
    days: [
      {date: '2026-08-01', request: 800000, outputTokens: 700000, hitTokens: 500000, missTokens: 600000, totalTokens: 1800000},
      {date: '2026-08-02', request: 0, outputTokens: 0, hitTokens: 0, missTokens: 0, totalTokens: 0},
    ],
    costs: [
      {
        currency: 'CNY',
        monthlyCost: 12.75,
        todayCost: 21.75,
        daily: [{date: '2026-08-01', amount: 21.75}],
      },
      {
        currency: 'USD',
        monthlyCost: 1.5,
        todayCost: 0.5,
        daily: [{date: '2026-08-01', amount: 0.5}],
      },
    ],
    cachedAt: '2026-08-01T12:00:00Z',
    ...overrides,
  };
}

describe('deepSeekHitRate', () => {
  it('computes hit / (hit + miss) and handles zero input', () => {
    expect(deepSeekHitRate({hitTokens: 500000, missTokens: 600000})).toBeCloseTo(500000 / 1100000, 6);
    expect(deepSeekHitRate({hitTokens: 0, missTokens: 0})).toBe(0);
  });
});

describe('normalizeDeepSeekUsage', () => {
  const now = new Date(2026, 7, 1, 12, 0, 0);

  it('maps per-currency daily costs onto days', () => {
    const view = normalizeDeepSeekUsage(makeResponse(), now);
    expect(view.days[0].costs).toEqual([
      {currency: 'CNY', amount: 21.75},
      {currency: 'USD', amount: 0.5},
    ]);
    expect(view.days[1].costs).toEqual([
      {currency: 'CNY', amount: 0},
      {currency: 'USD', amount: 0},
    ]);
  });

  it('keeps one spend row per currency with today cost for the current month', () => {
    const view = normalizeDeepSeekUsage(makeResponse(), now);
    expect(view.isCurrentMonth).toBe(true);
    expect(view.spend).toEqual([
      {currency: 'CNY', monthlyCost: 12.75, todayCost: 21.75},
      {currency: 'USD', monthlyCost: 1.5, todayCost: 0.5},
    ]);
  });

  it('drops today cost for past months', () => {
    const past = new Date(2026, 8, 1, 12, 0, 0);
    const view = normalizeDeepSeekUsage(makeResponse(), past);
    expect(view.isCurrentMonth).toBe(false);
    expect(view.spend.map(item => item.todayCost)).toEqual([null, null]);
  });

  it('marks months without any usage as empty', () => {
    const view = normalizeDeepSeekUsage(makeResponse({
      days: [{date: '2026-08-01', request: 0, outputTokens: 0, hitTokens: 0, missTokens: 0, totalTokens: 0}],
    }), now);
    expect(view.isEmpty).toBe(true);
    const nonEmpty = normalizeDeepSeekUsage(makeResponse(), now);
    expect(nonEmpty.isEmpty).toBe(false);
  });

  it('defaults missing sections', () => {
    const view = normalizeDeepSeekUsage({hubId: 'hub-1', status: 'expired', month: {year: 2026, month: 8}}, now);
    expect(view.balance).toEqual([]);
    expect(view.days).toEqual([]);
    expect(view.spend).toEqual([]);
    expect(view.isEmpty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npm test -- web-deepseek-usage 2>&1 | tail -5
```

Expected: FAIL — module `../web/src/usage/deepSeekUsage` not found.

- [ ] **Step 3: Write the implementation**

Create `app/web/src/usage/deepSeekUsage.ts`:

```ts
import type {RegistryDeepSeekUsageCost, RegistryDeepSeekUsageDay, RegistryDeepSeekUsageResponse} from '../registry/registryTypes';

export interface DeepSeekUsageDay extends RegistryDeepSeekUsageDay {
  cacheHitRate: number;
  costs: Array<{currency: string; amount: number}>;
}

export interface DeepSeekCurrencySpend {
  currency: string;
  monthlyCost: number;
  todayCost: number | null;
}

export interface DeepSeekUsageView {
  status: RegistryDeepSeekUsageResponse['status'];
  message?: string;
  month: {year: number; month: number};
  balance: NonNullable<RegistryDeepSeekUsageResponse['balance']>;
  days: DeepSeekUsageDay[];
  spend: DeepSeekCurrencySpend[];
  cachedAt?: string;
  isCurrentMonth: boolean;
  isEmpty: boolean;
}

export function deepSeekHitRate(day: Pick<RegistryDeepSeekUsageDay, 'hitTokens' | 'missTokens'>): number {
  const total = day.hitTokens + day.missTokens;
  return total > 0 ? day.hitTokens / total : 0;
}

export function normalizeDeepSeekUsage(raw: RegistryDeepSeekUsageResponse, now = new Date()): DeepSeekUsageView {
  const costs: RegistryDeepSeekUsageCost[] = raw.costs ?? [];
  const isCurrentMonth = raw.month.year === now.getFullYear() && raw.month.month === now.getMonth() + 1;
  const days = (raw.days ?? []).map(day => ({
    ...day,
    cacheHitRate: deepSeekHitRate(day),
    costs: costs.map(block => ({
      currency: block.currency,
      amount: block.daily.find(entry => entry.date === day.date)?.amount ?? 0,
    })),
  }));
  return {
    status: raw.status,
    message: raw.message,
    month: raw.month,
    balance: raw.balance ?? [],
    days,
    spend: costs.map(block => ({
      currency: block.currency,
      monthlyCost: block.monthlyCost,
      todayCost: isCurrentMonth ? block.todayCost : null,
    })),
    cachedAt: raw.cachedAt,
    isCurrentMonth,
    isEmpty: days.every(day => day.totalTokens === 0),
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd app && npm test -- web-deepseek-usage 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/usage/deepSeekUsage.ts app/__tests__/web-deepseek-usage.test.ts
git commit -m "feat(app): normalize deepseek platform usage views"
```

---

### Task 9: Bridge native deepseek login (web side)

These small pieces were correct in the old implementation; re-apply them manually (no cherry-pick — the rest of that commit is being rewritten).

**Files:**
- Modify: `app/web/src/platform/android/androidNativeMessageBridge.ts`
- Modify: `app/web/src/platform/native/nativeRuntime.ts`
- Create: `app/web/src/usage/deepSeekLogin.ts`

- [ ] **Step 1: Add the android facade method**

In `app/web/src/platform/android/androidNativeMessageBridge.ts`, in `AndroidNativeRpcFacade`, after the `reserveUserAction` line add:

```ts
  deepSeekLogin(): Promise<string>;
```

and in `getAndroidNativeRpcFacade`'s returned object, after the `reserveUserAction` implementation (which ends with `'token',\n    ),`) add:

```ts
    deepSeekLogin: () => request('deepseek.login'),
```

- [ ] **Step 2: Add the native runtime bridge wrapper**

In `app/web/src/platform/native/nativeRuntime.ts`, in `NativeRuntimeBridge`, after `enabled?: boolean;` add:

```ts
  deepSeekLogin?: () => Promise<string>;
```

and in `wrapAndroidRuntime`'s returned object, after `enabled: true,` add:

```ts
    deepSeekLogin: async () => {
      const raw = await native.deepSeekLogin();
      const parsed = JSON.parse(raw) as {token?: unknown};
      if (typeof parsed.token !== 'string' || parsed.token === '') {
        throw new Error('DeepSeek login returned no token');
      }
      return parsed.token;
    },
```

- [ ] **Step 3: Create the login helper**

Create `app/web/src/usage/deepSeekLogin.ts`:

```ts
import {getNativeRuntimeBridge} from '../platform/native/nativeRuntime';

export function nativeDeepSeekLoginAvailable(): boolean {
  return typeof getNativeRuntimeBridge()?.deepSeekLogin === 'function';
}

export function requestNativeDeepSeekLogin(): Promise<string> {
  const bridge = getNativeRuntimeBridge();
  if (typeof bridge?.deepSeekLogin !== 'function') {
    return Promise.reject(new Error('Native DeepSeek login is unavailable'));
  }
  return bridge.deepSeekLogin();
}
```

- [ ] **Step 4: Type check**

```bash
cd app && npm run tsc:web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/platform app/web/src/usage/deepSeekLogin.ts
git commit -m "feat(app): bridge native deepseek login"
```

---

### Task 10: Rewrite the usage dialog

Full `usage-history` shell, styled login panel with official-site link, expired state with re-login entry, error state with stale data + retry, month prev/next, cachedAt, disconnect button, empty state.

**Files:**
- Create: `app/web/src/usage/DeepSeekUsageDialog.tsx`
- Create: `app/__tests__/web-deepseek-usage-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/web-deepseek-usage-dialog.test.tsx`:

```tsx
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {DeepSeekUsageDialog, type DeepSeekUsageDialogState} from '../web/src/usage/DeepSeekUsageDialog';
import type {DeepSeekUsageView} from '../web/src/usage/deepSeekUsage';

jest.mock('../web/src/usage/deepSeekLogin', () => ({
  nativeDeepSeekLoginAvailable: jest.fn(() => false),
  requestNativeDeepSeekLogin: jest.fn(),
}));

jest.mock('../web/src/usage/DeepSeekUsageChart', () => ({
  __esModule: true,
  default: () => <div data-chart-stub={true} />,
}));

import {nativeDeepSeekLoginAvailable, requestNativeDeepSeekLogin} from '../web/src/usage/deepSeekLogin';

const MONTH = {year: 2026, month: 8};

function makeView(overrides: Partial<DeepSeekUsageView> = {}): DeepSeekUsageView {
  return {
    status: 'ok',
    month: MONTH,
    balance: [{currency: 'CNY', total: '1.25'}],
    days: [{
      date: '2026-08-01', request: 800000, outputTokens: 700000, hitTokens: 500000, missTokens: 600000,
      totalTokens: 1800000, cacheHitRate: 500000 / 1100000,
      costs: [{currency: 'CNY', amount: 21.75}],
    }],
    spend: [{currency: 'CNY', monthlyCost: 12.75, todayCost: 21.75}],
    cachedAt: '2026-08-01T12:00:00Z',
    isCurrentMonth: true,
    isEmpty: false,
    ...overrides,
  };
}

function renderDialog(state: DeepSeekUsageDialogState, handlers: Record<string, jest.Mock> = {}) {
  const props = {
    state,
    onClose: jest.fn(),
    onRetry: jest.fn(),
    onMonthChange: jest.fn(),
    onSaveToken: jest.fn(async () => {}),
    onClearToken: jest.fn(async () => {}),
    ...handlers,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<DeepSeekUsageDialog {...props} />);
  });
  return {renderer, props};
}

function text(renderer: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe('DeepSeekUsageDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the login panel with the official site link when not connected', () => {
    const {renderer} = renderDialog({status: 'notConnected', month: MONTH});
    const output = text(renderer);
    expect(output).toContain('Login DeepSeek');
    expect(output).toContain('platform.deepseek.com');
    const link = renderer.root.findByType('a');
    expect(link.props.href).toBe('https://platform.deepseek.com');
    expect(link.props.target).toBe('_blank');
  });

  it('saves a pasted token', async () => {
    const onSaveToken = jest.fn(async () => {});
    const {renderer} = renderDialog({status: 'notConnected', month: MONTH}, {onSaveToken});
    const input = renderer.root.findByType('input');
    await act(async () => {
      input.props.onChange({target: {value: '  token-abc  '}});
    });
    const saveButton = renderer.root.findAllByType('button').find(node =>
      TestRenderer.isElement(node) && node.props.children === 'Save token');
    expect(saveButton).toBeDefined();
    await act(async () => {
      saveButton!.props.onClick();
    });
    expect(onSaveToken).toHaveBeenCalledWith('token-abc');
  });

  it('keeps stale data and offers re-login when expired', () => {
    const {renderer} = renderDialog({status: 'expired', month: MONTH, view: makeView()});
    const output = text(renderer);
    expect(output).toContain('Session expired');
    expect(output).toContain('CNY 12.75');
    expect(output).toContain('Login DeepSeek');
  });

  it('keeps stale data and offers retry on platform error', () => {
    const onRetry = jest.fn();
    const {renderer} = renderDialog(
      {status: 'error', message: 'platform request failed', month: MONTH, view: makeView()},
      {onRetry},
    );
    const output = text(renderer);
    expect(output).toContain('platform request failed');
    expect(output).toContain('CNY 12.75');
    const retry = renderer.root.findAllByType('button').find(node => node.props.children === 'Retry');
    expect(retry).toBeDefined();
    act(() => {
      retry!.props.onClick();
    });
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows per-currency spend, balance, updated time when ready', () => {
    const {renderer} = renderDialog({status: 'ready', view: makeView()});
    const output = text(renderer);
    expect(output).toContain('CNY 12.75');
    expect(output).toContain('CNY 21.75');
    expect(output).toContain('CNY 1.25');
    expect(output).toContain('Updated');
  });

  it('shows an empty state for months without usage', () => {
    const {renderer} = renderDialog({status: 'ready', view: makeView({isEmpty: true, days: []})});
    expect(text(renderer)).toContain('No usage recorded this month');
  });

  it('navigates months backward and forward but not past the current month', () => {
    const onMonthChange = jest.fn();
    const now = new Date();
    const current = {year: now.getFullYear(), month: now.getMonth() + 1};
    const {renderer} = renderDialog({status: 'loading', month: current}, {onMonthChange});
    const next = renderer.root.findAllByType('button').find(node => node.props['aria-label'] === 'Next month');
    expect(next!.props.disabled).toBe(true);
    const previous = renderer.root.findAllByType('button').find(node => node.props['aria-label'] === 'Previous month');
    act(() => {
      previous!.props.onClick();
    });
    const expected = current.month === 1
      ? [current.year - 1, 12]
      : [current.year, current.month - 1];
    expect(onMonthChange).toHaveBeenCalledWith(expected[0], expected[1]);
  });

  it('offers the native login button only when the bridge exists and surfaces its errors', async () => {
    (nativeDeepSeekLoginAvailable as jest.Mock).mockReturnValue(true);
    (requestNativeDeepSeekLogin as jest.Mock).mockRejectedValue(new Error('login window closed'));
    const {renderer} = renderDialog({status: 'notConnected', month: MONTH});
    const nativeButton = renderer.root.findAllByType('button').find(node => node.props.children === 'Login in window');
    expect(nativeButton).toBeDefined();
    await act(async () => {
      nativeButton!.props.onClick();
    });
    expect(text(renderer)).toContain('login window closed');
  });

  it('disconnects through onClearToken', () => {
    const onClearToken = jest.fn(async () => {});
    const {renderer} = renderDialog({status: 'ready', view: makeView()}, {onClearToken});
    const disconnect = renderer.root.findAllByType('button').find(node =>
      node.props['aria-label'] === 'Disconnect DeepSeek platform');
    expect(disconnect).toBeDefined();
    act(() => {
      disconnect!.props.onClick();
    });
    expect(onClearToken).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npm test -- web-deepseek-usage-dialog 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the dialog**

Create `app/web/src/usage/DeepSeekUsageDialog.tsx`:

```tsx
import React from 'react';

import {Icon} from '../common/Icon';
import {nativeDeepSeekLoginAvailable, requestNativeDeepSeekLogin} from './deepSeekLogin';
import type {DeepSeekUsageView} from './deepSeekUsage';

const LazyDeepSeekUsageChart = React.lazy(() => import(
  /* webpackChunkName: "deepseek-usage-chart" */
  './DeepSeekUsageChart'
));

export interface DeepSeekUsageMonth {
  year: number;
  month: number;
}

export type DeepSeekUsageDialogState =
  | {status: 'loading'; month: DeepSeekUsageMonth}
  | {status: 'error'; message: string; month: DeepSeekUsageMonth; view?: DeepSeekUsageView}
  | {status: 'notConnected'; month: DeepSeekUsageMonth}
  | {status: 'expired'; month: DeepSeekUsageMonth; view?: DeepSeekUsageView}
  | {status: 'ready'; view: DeepSeekUsageView};

interface DeepSeekUsageDialogProps {
  state: DeepSeekUsageDialogState;
  triggerElement?: HTMLElement | null;
  onClose: () => void;
  onRetry: () => void;
  onMonthChange: (year: number, month: number) => void;
  onSaveToken: (token: string) => Promise<void>;
  onClearToken: () => Promise<void>;
}

export function DeepSeekUsageDialog({
  state,
  triggerElement,
  onClose,
  onRetry,
  onMonthChange,
  onSaveToken,
  onClearToken,
}: DeepSeekUsageDialogProps) {
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeRef = React.useRef(onClose);
  const triggerRef = React.useRef(triggerElement);
  closeRef.current = onClose;

  React.useEffect(() => {
    closeButtonRef.current?.focus();
    const eventTarget = typeof document === 'undefined' ? null : document;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    eventTarget?.addEventListener('keydown', handleKeyDown);
    return () => {
      eventTarget?.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus();
    };
  }, []);

  const month = state.status === 'ready' ? state.view.month : state.month;
  const view = state.status === 'ready' || state.status === 'expired' || state.status === 'error'
    ? state.view
    : undefined;
  const hasData = Boolean(view && (view.days.length > 0 || view.balance.length > 0));

  return (
    <div
      className="usage-history-overlay"
      data-deepseek-usage-overlay={true}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="usage-history-dialog deepseek-usage-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby="deepseek-usage-dialog-title"
        data-deepseek-usage-dialog={true}
      >
        <header className="usage-history-header">
          <div className="usage-history-title">
            <span className="usage-history-title-icon">
              <Icon name="activity" size={16} />
            </span>
            <div className="usage-history-heading">
              <h2 id="deepseek-usage-dialog-title">
                <span>DeepSeek</span>
                <span className="usage-history-window">Platform usage</span>
              </h2>
              <p>Monthly and daily token usage · data lags about 5 minutes</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="usage-history-close"
            aria-label="Close DeepSeek usage"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="usage-history-body">
          <div className="deepseek-usage-toolbar">
            <MonthSwitcher month={month} onMonthChange={onMonthChange} />
            <div className="deepseek-usage-toolbar-side">
              {view?.cachedAt ? (
                <span className="deepseek-usage-updated">Updated {formatCachedAt(view.cachedAt)}</span>
              ) : null}
              <button
                type="button"
                className="deepseek-usage-icon-button"
                aria-label="Refresh DeepSeek usage"
                onClick={onRetry}
              >
                <Icon name="refreshCw" />
              </button>
              {view ? (
                <button
                  type="button"
                  className="deepseek-usage-icon-button"
                  aria-label="Disconnect DeepSeek platform"
                  onClick={() => { void onClearToken(); }}
                >
                  <Icon name="logOut" />
                </button>
              ) : null}
            </div>
          </div>
          {state.status === 'loading' ? <DeepSeekUsageLoading /> : null}
          {state.status === 'notConnected' ? <DeepSeekLoginPanel onSaveToken={onSaveToken} /> : null}
          {state.status === 'expired' ? (
            <>
              <div className="deepseek-usage-banner tone-warning" role="alert">
                <strong>Session expired</strong>
                <p>Sign in again to refresh.{hasData ? ' Last successful data is shown below.' : ''}</p>
              </div>
              {view && hasData ? <DeepSeekUsageReady view={view} /> : null}
              <DeepSeekLoginPanel onSaveToken={onSaveToken} />
            </>
          ) : null}
          {state.status === 'error' ? (
            <>
              <div className="deepseek-usage-banner tone-danger" role="alert">
                <strong>Usage unavailable</strong>
                <p>{state.message}</p>
                <div>
                  <button type="button" className="deepseek-usage-banner-action" onClick={onRetry}>Retry</button>
                </div>
              </div>
              {view && hasData ? <DeepSeekUsageReady view={view} /> : null}
            </>
          ) : null}
          {state.status === 'ready' && view ? <DeepSeekUsageReady view={view} /> : null}
        </div>
      </section>
    </div>
  );
}

function formatCachedAt(cachedAt: string): string {
  const parsed = new Date(cachedAt);
  if (Number.isNaN(parsed.getTime())) return cachedAt;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

function DeepSeekUsageLoading() {
  return (
    <div className="usage-history-loading" aria-live="polite">
      <div className="usage-history-loading-copy">
        <strong>Loading DeepSeek usage</strong>
        <span>Fetching monthly spend and daily tokens from the platform…</span>
      </div>
      <div className="usage-history-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function MonthSwitcher({
  month,
  onMonthChange,
}: {
  month: DeepSeekUsageMonth;
  onMonthChange: (year: number, month: number) => void;
}) {
  const now = new Date();
  const atCurrentMonth = month.year === now.getFullYear() && month.month === now.getMonth() + 1;
  const previous = month.month === 1
    ? {year: month.year - 1, month: 12}
    : {year: month.year, month: month.month - 1};
  const next = month.month === 12
    ? {year: month.year + 1, month: 1}
    : {year: month.year, month: month.month + 1};
  return (
    <div className="deepseek-usage-months">
      <button
        type="button"
        className="deepseek-usage-icon-button"
        aria-label="Previous month"
        onClick={() => onMonthChange(previous.year, previous.month)}
      >
        <Icon name="arrowLeft" />
      </button>
      <span className="deepseek-usage-month-label">
        {String(month.year)}-{String(month.month).padStart(2, '0')}
      </span>
      <button
        type="button"
        className="deepseek-usage-icon-button"
        aria-label="Next month"
        disabled={atCurrentMonth}
        onClick={() => onMonthChange(next.year, next.month)}
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

function DeepSeekLoginPanel({onSaveToken}: {onSaveToken: (token: string) => Promise<void>}) {
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const nativeAvailable = nativeDeepSeekLoginAvailable();

  const save = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await onSaveToken(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="deepseek-usage-login" data-deepseek-usage-login={true}>
      <strong>Login DeepSeek</strong>
      <p>
        Sign in on{' '}
        <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">
          platform.deepseek.com
        </a>{' '}
        to fetch official spend and token usage.
      </p>
      {nativeAvailable ? (
        <button
          type="button"
          className="deepseek-usage-primary-action"
          disabled={busy}
          onClick={() => {
            void requestNativeDeepSeekLogin()
              .then(save)
              .catch(cause => setError(cause instanceof Error ? cause.message : 'Failed to start native login'));
          }}
        >
          Login in window
        </button>
      ) : null}
      <label>
        <span>Paste the platform session token</span>
        <input
          type="password"
          value={token}
          disabled={busy}
          placeholder="Bearer token from platform.deepseek.com"
          onChange={event => setToken(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="deepseek-usage-primary-action"
        disabled={busy || token.trim() === ''}
        onClick={() => void save(token.trim())}
      >
        Save token
      </button>
      {error ? <p className="deepseek-usage-login-error" role="alert">{error}</p> : null}
    </div>
  );
}

function DeepSeekUsageReady({view}: {view: DeepSeekUsageView}) {
  return (
    <>
      <div className="deepseek-usage-summary">
        <span>
          <strong>{view.spend.map(item => `${item.currency} ${item.monthlyCost.toFixed(2)}`).join(' · ') || '—'}</strong>
          <em>This month</em>
        </span>
        <span>
          <strong>
            {view.isCurrentMonth
              ? view.spend.map(item => `${item.currency} ${(item.todayCost ?? 0).toFixed(2)}`).join(' · ') || '—'
              : '—'}
          </strong>
          <em>Today</em>
        </span>
        <span>
          <strong>{view.balance.map(item => `${item.currency} ${item.total}`).join(' · ') || '—'}</strong>
          <em>Balance</em>
        </span>
      </div>
      {view.isEmpty ? (
        <div className="usage-history-empty">
          <strong>No usage recorded this month</strong>
          <p>Days with DeepSeek API spend will appear here.</p>
        </div>
      ) : (
        <React.Suspense fallback={(
          <div className="usage-history-chart-loading" aria-live="polite">Loading chart…</div>
        )}>
          <LazyDeepSeekUsageChart view={view} />
        </React.Suspense>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
cd app && npm test -- web-deepseek-usage-dialog 2>&1 | tail -8
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/usage/DeepSeekUsageDialog.tsx app/__tests__/web-deepseek-usage-dialog.test.tsx
git commit -m "feat(app): add deepseek platform usage dialog"
```

---

### Task 11: Chart and dialog styles

**Files:**
- Create: `app/web/src/usage/DeepSeekUsageChart.tsx`
- Modify: `app/web/src/styles/usage.css` (append deepseek block at the end)

- [ ] **Step 1: Write the chart**

Create `app/web/src/usage/DeepSeekUsageChart.tsx`:

```tsx
import React from 'react';
import * as echarts from 'echarts/core';
import {BarChart, LineChart} from 'echarts/charts';
import {GridComponent, LegendComponent, TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

import type {DeepSeekUsageView} from './deepSeekUsage';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export default function DeepSeekUsageChart({view}: {view: DeepSeekUsageView}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<echarts.ECharts | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, {renderer: 'canvas'});
    chartRef.current = chart;
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => chart.resize());
    resizeObserver?.observe(container);
    return () => {
      resizeObserver?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    const styles = getComputedStyle(container);
    const output = cssToken(styles, '--accent-primary', '#2784c7');
    const miss = cssToken(styles, '--state-info', '#65a3d8');
    const hit = cssToken(styles, '--state-success', '#58a86d');
    const hitRate = cssToken(styles, '--state-warning', '#d0a24f');
    const textPrimary = cssToken(styles, '--text-primary', '#dedede');
    const textSecondary = cssToken(styles, '--text-secondary', '#a3a3a3');
    const border = cssToken(styles, '--border-subtle', '#363636');
    chart.setOption({
      animation: false,
      legend: {
        textStyle: {color: textSecondary, fontSize: 10},
        top: 0,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssToken(styles, '--surface-overlay', '#2e2e2e'),
        borderColor: border,
        textStyle: {color: textPrimary, fontSize: 11},
        formatter: (params: unknown) => formatTooltip(params, view),
      },
      grid: {left: 46, right: 46, top: 28, bottom: 28},
      xAxis: {
        type: 'category',
        data: view.days.map(day => day.date),
        axisLabel: {
          color: textSecondary,
          fontSize: 10,
          formatter: (value: string) => value.slice(5),
        },
        axisLine: {lineStyle: {color: border}},
        axisTick: {show: false},
      },
      yAxis: [
        {
          type: 'value',
          name: 'Tokens',
          axisLabel: {color: textSecondary, fontSize: 10},
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {lineStyle: {color: withAlpha(border, 0.68)}},
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          name: 'Hit %',
          axisLabel: {color: textSecondary, fontSize: 10, formatter: '{value}%'},
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {show: false},
        },
      ],
      series: [
        {
          name: 'Output',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.outputTokens),
          itemStyle: {color: output},
          emphasis: {disabled: true},
        },
        {
          name: 'Cache miss',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.missTokens),
          itemStyle: {color: miss},
          emphasis: {disabled: true},
        },
        {
          name: 'Cache hit',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.hitTokens),
          itemStyle: {color: hit},
          emphasis: {disabled: true},
        },
        {
          name: 'Hit rate',
          type: 'line',
          yAxisIndex: 1,
          data: view.days.map(day => Number((day.cacheHitRate * 100).toFixed(1))),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: {color: hitRate, width: 2},
          itemStyle: {color: hitRate},
          emphasis: {disabled: true},
        },
      ],
    }, {notMerge: true});
  }, [view]);

  return (
    <div
      ref={containerRef}
      className="usage-history-chart deepseek-usage-chart"
      role="img"
      aria-label="Daily token usage, cache hit rate, and spend chart"
    />
  );
}

function cssToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (hex) {
    return `rgb(${parseInt(hex[1], 16)} ${parseInt(hex[2], 16)} ${parseInt(hex[3], 16)} / ${alpha})`;
  }
  return color;
}

function trimMoney(amount: number): string {
  return amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
}

function formatTooltip(params: unknown, view: DeepSeekUsageView): string {
  const items = Array.isArray(params) ? params : [];
  const first = items[0] as {name?: unknown} | undefined;
  const date = String(first?.name ?? '');
  const day = view.days.find(entry => entry.date === date);
  if (!day) return '';
  const hitPercent = Math.round(day.cacheHitRate * 1000) / 10;
  const spend = day.costs
    .filter(item => item.amount > 0)
    .map(item => `${item.currency} ${trimMoney(item.amount)}`)
    .join(' · ') || '—';
  const rows = [
    `<strong>${date}</strong>`,
    `Total: ${day.totalTokens.toLocaleString()} tokens`,
    `Hit rate: ${hitPercent}%`,
    `Spend: ${spend}`,
    `Output: ${day.outputTokens.toLocaleString()}`,
    `Cache hit: ${day.hitTokens.toLocaleString()}`,
    `Cache miss: ${day.missTokens.toLocaleString()}`,
  ];
  return rows.join('<br/>');
}
```

- [ ] **Step 2: Append the deepseek styles**

Append to `app/web/src/styles/usage.css`:

```css
.deepseek-usage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.deepseek-usage-months { display: inline-flex; align-items: center; gap: 6px; }
.deepseek-usage-month-label {
  min-width: 64px;
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.deepseek-usage-toolbar-side { display: inline-flex; align-items: center; gap: 6px; }
.deepseek-usage-updated {
  color: var(--text-tertiary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.deepseek-usage-icon-button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  padding: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.deepseek-usage-icon-button:hover:not(:disabled) { background: var(--hover); color: var(--text-primary); }
.deepseek-usage-icon-button:disabled { cursor: default; opacity: 0.4; }
.deepseek-usage-icon-button:focus-visible,
.deepseek-usage-login input:focus-visible,
.deepseek-usage-login button:focus-visible,
.deepseek-usage-banner-action:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
.deepseek-usage-summary {
  display: grid;
  margin-bottom: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.deepseek-usage-summary > span {
  display: flex;
  min-width: 0;
  padding: 8px 10px;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
}
.deepseek-usage-summary strong {
  overflow: hidden;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deepseek-usage-summary em {
  color: var(--text-tertiary);
  font-size: 10px;
  font-style: normal;
}
.deepseek-usage-banner {
  display: flex;
  margin-bottom: 12px;
  padding: 9px 12px;
  flex-direction: column;
  gap: 4px;
  border: 1px solid;
  border-radius: var(--radius-control);
  font-size: 11px;
}
.deepseek-usage-banner.tone-warning {
  border-color: color-mix(in srgb, var(--state-warning) 45%, transparent);
  background: color-mix(in srgb, var(--state-warning) 8%, transparent);
  color: var(--state-warning);
}
.deepseek-usage-banner.tone-danger {
  border-color: color-mix(in srgb, var(--state-danger) 45%, transparent);
  background: color-mix(in srgb, var(--state-danger) 8%, transparent);
  color: var(--state-danger);
}
.deepseek-usage-banner p { margin: 0; color: var(--text-secondary); }
.deepseek-usage-banner-action {
  min-height: 26px;
  margin-top: 4px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
.deepseek-usage-banner-action:hover { background: var(--hover); }
.deepseek-usage-login {
  display: grid;
  max-width: 420px;
  margin: 0 auto;
  padding: 16px;
  gap: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
}
.deepseek-usage-login > strong { font-size: 13px; }
.deepseek-usage-login > p { margin: 0; color: var(--text-secondary); font-size: 11px; }
.deepseek-usage-login a { color: var(--accent-primary); }
.deepseek-usage-login label { display: grid; color: var(--text-secondary); font-size: 11px; gap: 4px; }
.deepseek-usage-login input {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
}
.deepseek-usage-login button {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
.deepseek-usage-login button:hover:not(:disabled) { background: var(--hover); }
.deepseek-usage-login button:disabled { cursor: default; opacity: 0.5; }
.deepseek-usage-login .deepseek-usage-primary-action {
  border-color: var(--accent-primary);
  background: var(--accent-soft-bg);
  color: var(--accent-primary);
}
.deepseek-usage-login-error { margin: 0; color: var(--state-danger); font-size: 11px; }
@media (max-width: 620px) {
  .deepseek-usage-summary { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Verify type check, tests, and production build**

```bash
cd app && npm run tsc:web && npm test -- web-deepseek-usage 2>&1 | tail -5 && npm run build:web 2>&1 | tail -5
```

Expected: tsc PASS, jest PASS, webpack build succeeds (chart chunk emitted).

- [ ] **Step 4: Commit**

```bash
git add app/web/src/usage/DeepSeekUsageChart.tsx app/web/src/styles/usage.css
git commit -m "feat(app): chart deepseek daily usage with theme tokens"
```

---

### Task 12: Wire the dialog into Monitor rows

**Files:**
- `app/web/src/app/WorkspaceApp.tsx`
- `app/web/src/usage/UsageFeatureSurface.tsx`
- `app/__tests__/web-usage-feature-surface.test.tsx`
- `app/__tests__/web-usage-workspace-integration.test.tsx`

- [ ] **Step 1: Cherry-pick the old wiring without committing**

```bash
git cherry-pick -n 90f3ec4d
```

Expected: clean. This restores the `deepSeekUsageDialogView` state, the `loadDeepSeekUsage`/`openDeepSeekUsage`/`closeDeepSeekUsage`/`saveDeepSeekToken`/`clearDeepSeekToken`/`changeDeepSeekMonth`/`handleUsageRowActivate` callbacks, the overlay render, the `provider.id === 'deepseek'` clickable rows in `UsageFeatureSurface.tsx`, and the two test files.

- [ ] **Step 2: Map the error status with stale data**

In `app/web/src/app/WorkspaceApp.tsx`, in `loadDeepSeekUsage`, change the state mapping from:

```ts
      const view = normalizeDeepSeekUsage(result);
      if ((view.balance ?? []).length === 0 && target.account.balance?.items?.length) {
        view.balance = target.account.balance.items;
      }
      const state: DeepSeekUsageDialogState = view.status === 'ok'
        ? {status: 'ready', view}
        : view.status === 'expired'
          ? {status: 'expired', month, view}
          : {status: 'notConnected', month};
```

to:

```ts
      const view = normalizeDeepSeekUsage(result);
      if (view.balance.length === 0 && target.account.balance?.items?.length) {
        view.balance = target.account.balance.items;
      }
      const state: DeepSeekUsageDialogState = view.status === 'ok'
        ? {status: 'ready', view}
        : view.status === 'expired'
          ? {status: 'expired', month, view}
          : view.status === 'error'
            ? {status: 'error', message: view.message ?? 'Failed to load DeepSeek usage', month, view}
            : {status: 'notConnected', month};
```

- [ ] **Step 3: Run wiring tests**

```bash
cd app && npm test -- web-usage-feature-surface web-usage-workspace-integration 2>&1 | tail -8 && npm run tsc:web
```

Expected: PASS. If the integration test asserts the old state mapping, update its expectations to the new error mapping.

- [ ] **Step 4: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/usage/UsageFeatureSurface.tsx app/__tests__/web-usage-feature-surface.test.tsx app/__tests__/web-usage-workspace-integration.test.tsx
git commit -m "feat(app): open deepseek usage from monitor rows"
```

---

### Task 13: Restore desktop embedded login with precise token read

**Files:**
- `server/cmd/wheelmaker-desktop/deepseek_login.go`
- `server/cmd/wheelmaker-desktop/deepseek_login_test.go`
- `server/cmd/wheelmaker-desktop/deepseek_login_windows.go`
- `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- `server/cmd/wheelmaker-desktop/webview_policy.go`
- `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- `server/cmd/wheelmaker-desktop/webview_windows.go`

- [ ] **Step 1: Cherry-pick without committing**

```bash
git cherry-pick -n 6fa70f1c
```

Expected: clean.

- [ ] **Step 2: Replace the token scan with a precise userToken read**

In `server/cmd/wheelmaker-desktop/deepseek_login.go`, replace the `deepSeekLoginScript` constant:

```go
// deepSeekLoginScript reads the platform session token from localStorage. The
// platform stores it as JSON under the userToken key: {"value":"<token>","__version":"0"}.
const deepSeekLoginScript = `(() => {
  try {
    const raw = localStorage.getItem('userToken');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    const token = parsed && typeof parsed.value === 'string' ? parsed.value : '';
    return /^[A-Za-z0-9._~+/=-]{20,4096}$/.test(token) ? token : '';
  } catch (_) {
    return '';
  }
})()`
```

- [ ] **Step 3: Extend the login test**

In `server/cmd/wheelmaker-desktop/deepseek_login_test.go`, append:

```go
func TestDeepSeekLoginScriptTargetsUserTokenKey(t *testing.T) {
	if !strings.Contains(deepSeekLoginScript, `localStorage.getItem('userToken')`) {
		t.Fatal("login script must read the userToken key precisely")
	}
	if strings.Contains(deepSeekLoginScript, "localStorage.key(") || strings.Contains(deepSeekLoginScript, "localStorage.length") {
		t.Fatal("login script must not scan unrelated localStorage keys")
	}
}
```

(Ensure `strings` is imported in the test file.)

- [ ] **Step 4: Run desktop tests and build**

```bash
cd server && go test ./cmd/wheelmaker-desktop/ -run "DeepSeek|WebViewPolicy" -v && go build ./cmd/wheelmaker-desktop/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/cmd/wheelmaker-desktop/
git commit -m "feat(desktop): embedded deepseek platform login"
```

---

### Task 14: Restore android embedded login with precise token read

**Files:**
- `mobile/android/app/src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt`
- `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`
- `mobile/android/app/src/test/java/com/wheelmaker/android/DeepSeekLoginProtocolTest.kt`

- [ ] **Step 1: Cherry-pick the android chain without committing**

```bash
git cherry-pick -n 93836e77
git cherry-pick -n da3da061
git cherry-pick -n 2804066c || true
git cherry-pick -n 05f133b1 || true
git status --short
```

`2804066c` also touches web files (`app/__tests__/web-deepseek-usage-login-error.test.tsx`, `app/web/src/usage/DeepSeekUsageDialog.tsx`) which have been rewritten — conflicts there are expected. Drop the web side and keep the android side:

```bash
git checkout HEAD -- app/
git add -A
git status --short
```

If any conflict involves android files, stop and resolve manually — the android side must end up identical to `05f133b1`'s version:

```bash
git show 05f133b1:mobile/android/app/src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt | diff - mobile/android/app/src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt && echo "android dialog matches 05f133b1"
```

- [ ] **Step 2: Replace the token scan with a precise userToken read**

In `mobile/android/app/src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt`, replace `DEEP_SEEK_TOKEN_SCRIPT` with:

```kotlin
internal const val DEEP_SEEK_TOKEN_SCRIPT = """
  (() => {
    try {
      const raw = localStorage.getItem('userToken');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      const token = parsed && typeof parsed.value === 'string' ? parsed.value : '';
      return /^[A-Za-z0-9._~+/=-]{20,4096}$/.test(token) ? token : '';
    } catch (_) {
      return '';
    }
  })()
"""
```

- [ ] **Step 3: Extend the protocol test**

In `mobile/android/app/src/test/java/com/wheelmaker/android/DeepSeekLoginProtocolTest.kt`, append a test (matching the file's existing assertion style):

```kotlin
    @Test
    fun tokenScriptReadsUserTokenKeyPrecisely() {
        assertTrue(DEEP_SEEK_TOKEN_SCRIPT.contains("localStorage.getItem('userToken')"))
        assertFalse(DEEP_SEEK_TOKEN_SCRIPT.contains("localStorage.key("))
    }
```

- [ ] **Step 4: Run android unit tests**

```bash
cd mobile/android && ./gradlew.bat :app:testDebugUnitTest --tests "com.wheelmaker.android.DeepSeekLoginProtocolTest" 2>&1 | tail -10
```

Expected: PASS. (Use `./gradlew` if the wrapper script has no `.bat`.)

- [ ] **Step 5: Commit**

```bash
git add mobile/android
git commit -m "feat(android): embedded deepseek platform login"
```

---

### Task 15: Full verification and probe cleanup

- [ ] **Step 1: Full server verification**

```bash
cd server && go build ./... && go test ./... 2>&1 | tail -15
```

Expected: all PASS.

- [ ] **Step 2: Full web verification**

```bash
cd app && npm run tsc:web && npm test 2>&1 | tail -10 && npm run build:web 2>&1 | tail -3
```

Expected: all PASS.

- [ ] **Step 3: Confirm spec acceptance points against the diff**

```bash
git diff origin/main...HEAD --stat | tail -5
rg -n "userToken|40002|biz_data|isCurrentMonth|Disconnect DeepSeek" server/internal app/web/src mobile/android --glob '!**/dist/**' | head -20
```

Expected: every acceptance bullet in `spec-deepseek-platform-usage.md` maps to landed code; no camelCase `bizData` guessing remains in `deepseek_platform.go`.

- [ ] **Step 4: Clean up the probe environment**

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*wm-ds-probe-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
rm -rf /c/Users/suweimin/AppData/Local/Temp/wm-ds-probe /c/Users/suweimin/AppData/Local/Temp/wm-ds-probe-profile /c/Users/suweimin/AppData/Local/Temp/codexbar-ref
```

Expected: temporary Edge profile (holding the logged-in DeepSeek session), probe outputs with raw responses, and the CodexBar reference clone are all removed.

---

## Self-review notes

- **Spec coverage:** revert (Task 2) · hubconfig secret (3) · verified parsing + fixtures (4) · protocol method (5) · hub handler with expired/error + stale (6) · web transport with error status (7) · multi-currency view model (8) · native bridge (9) · dialog shell/states/login panel/disconnect/empty/cachedAt/month-nav (10) · chart with CSS tokens (11) · monitor rows (12) · desktop precise userToken (13) · android precise userToken (14) · verification + cleanup (15). All spec acceptance bullets map to a task.
- **No placeholders:** every code-changing step carries the full code or an exact cherry-pick command plus the exact edit.
- **Type consistency:** `DeepSeekPlatformStatus` adds `error` (Task 4) → reporter passes `message` (6) → `RegistryDeepSeekUsageResponse.status` includes `'error'` + `message?` (7) → `DeepSeekUsageView.message` (8) → dialog error state (10) → WorkspaceApp mapping (12). `DeepSeekUsageDialogState` keeps the old shape plus `error.view`, so the cherry-picked WorkspaceApp wiring compiles with minimal edits.
