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
	// The platform's risk control rejects requests without a browser UA (HTTP 429).
	deepSeekPlatformUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
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
	request.Header.Set("User-Agent", deepSeekPlatformUserAgent)
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
		message := err.Error()
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
