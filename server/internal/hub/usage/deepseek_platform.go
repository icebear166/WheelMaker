package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	deepSeekPlatformBaseURL          = "https://platform.deepseek.com"
	deepSeekExpiredCode              = 40003
	deepSeekPlatformCurrentMonthTTL  = 5 * time.Minute
	deepSeekPlatformPastMonthTTL     = 24 * time.Hour
	deepSeekPlatformMaxResponseBytes = 4 << 20
)

var errDeepSeekExpired = errors.New("deepseek platform session expired")

type DeepSeekPlatformStatus string

const (
	DeepSeekPlatformOK           DeepSeekPlatformStatus = "ok"
	DeepSeekPlatformNotConnected DeepSeekPlatformStatus = "notConnected"
	DeepSeekPlatformExpired      DeepSeekPlatformStatus = "expired"
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
	Balance  []BalanceItem          `json:"balance,omitempty"`
	Days     []DeepSeekPlatformDay  `json:"days,omitempty"`
	Costs    []DeepSeekPlatformCost `json:"costs,omitempty"`
	CachedAt *time.Time             `json:"cachedAt,omitempty"`
}

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
	client := c.Client
	if client == nil {
		client = http.DefaultClient
	}
	baseURL := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if baseURL == "" {
		baseURL = deepSeekPlatformBaseURL
	}
	summary, err := c.fetchJSON(ctx, client, baseURL, "/api/v0/users/get_user_summary", token)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	amount, err := c.fetchJSON(ctx, client, baseURL, "/api/v0/usage/amount?year="+strconv.Itoa(year)+"&month="+strconv.Itoa(month), token)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	cost, err := c.fetchJSON(ctx, client, baseURL, "/api/v0/usage/cost?year="+strconv.Itoa(year)+"&month="+strconv.Itoa(month), token)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	balance, err := parseDeepSeekSummary(summary, now)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	days, err := parseDeepSeekAmount(amount)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	costs, err := parseDeepSeekCost(cost, now, monthValue)
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

func (c *DeepSeekPlatformClient) fetchJSON(ctx context.Context, client *http.Client, baseURL, path, token string) (map[string]any, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json, text/plain, */*")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, deepSeekPlatformMaxResponseBytes))
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusUnauthorized {
		return nil, errDeepSeekExpired
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("deepseek platform %s: status %d", path, response.StatusCode)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("deepseek platform %s: invalid JSON", path)
	}
	if code, _ := nestedInt(payload, "code"); code == deepSeekExpiredCode {
		return nil, errDeepSeekExpired
	}
	return payload, nil
}

func deepSeekBizData(payload map[string]any) map[string]any {
	current := payload
	for depth := 0; depth < 6; depth++ {
		if current == nil {
			return nil
		}
		if next, ok := current["bizData"].(map[string]any); ok {
			current = next
			continue
		}
		if next, ok := current["data"].(map[string]any); ok {
			current = next
			continue
		}
		return current
	}
	return nil
}

func parseDeepSeekSummary(payload map[string]any, now time.Time) ([]BalanceItem, error) {
	data := deepSeekBizData(payload)
	items := make([]BalanceItem, 0, 4)
	items = append(items, parseDeepSeekWallets(data, "normal_wallets")...)
	items = append(items, parseDeepSeekWallets(data, "bonus_wallets")...)
	return items, nil
}

func parseDeepSeekWallets(data map[string]any, key string) []BalanceItem {
	raw, _ := data[key].([]any)
	items := make([]BalanceItem, 0, len(raw))
	for _, entry := range raw {
		item, _ := entry.(map[string]any)
		if item == nil {
			continue
		}
		currency := deepSeekText(item, "currency", "currency_code", "currencyCode")
		total := deepSeekText(item, "total_balance", "totalBalance", "balance", "total")
		if currency == "" || total == "" {
			continue
		}
		items = append(items, BalanceItem{
			Currency: currency,
			Total:    total,
			Granted:  deepSeekText(item, "granted_balance", "grantedBalance"),
			ToppedUp: deepSeekText(item, "topped_up_balance", "toppedUpBalance"),
		})
	}
	return items
}

func parseDeepSeekAmount(payload map[string]any) ([]DeepSeekPlatformDay, error) {
	data := deepSeekBizData(payload)
	rawDays, ok := firstArray(data, "days", "daily", "daily_usage", "dailyUsage")
	if !ok {
		return nil, nil
	}
	days := make([]DeepSeekPlatformDay, 0, len(rawDays))
	for _, raw := range rawDays {
		entry, _ := raw.(map[string]any)
		if entry == nil {
			continue
		}
		aggregate := deepSeekAggregateUsage(firstArrayValues(entry, "data", "models", "usage", "usages"))
		days = append(days, DeepSeekPlatformDay{
			Date:         deepSeekText(entry, "date", "day"),
			Request:      aggregate.request,
			OutputTokens: aggregate.response,
			HitTokens:    aggregate.promptHit,
			MissTokens:   aggregate.promptMiss,
			TotalTokens:  aggregate.total,
		})
	}
	return days, nil
}

type deepSeekUsageAggregate struct {
	request, response, promptHit, promptMiss, total int64
}

func deepSeekAggregateUsage(items []any) deepSeekUsageAggregate {
	var sum deepSeekUsageAggregate
	for _, item := range items {
		entry, _ := item.(map[string]any)
		if entry == nil {
			continue
		}
		var model deepSeekUsageAggregate
		for _, usageEntry := range firstArrayValues(entry, "usage", "usages", "usage_list", "usageList") {
			usage, _ := usageEntry.(map[string]any)
			if usage == nil {
				continue
			}
			kind := deepSeekText(usage, "type", "usage_type", "usageType", "name", "key")
			amount := deepSeekInt(usage, "amount", "value", "count", "total")
			switch kind {
			case "REQUEST":
				model.request += amount
			case "RESPONSE_TOKEN":
				model.response += amount
			case "PROMPT_CACHE_HIT_TOKEN":
				model.promptHit += amount
			case "PROMPT_CACHE_MISS_TOKEN":
				model.promptMiss += amount
			}
		}
		sum.request += model.request
		sum.response += model.response
		sum.promptHit += model.promptHit
		sum.promptMiss += model.promptMiss
	}
	sum.total = sum.response + sum.promptHit + sum.promptMiss
	return sum
}

func parseDeepSeekCost(payload map[string]any, now time.Time, month DeepSeekPlatformMonth) ([]DeepSeekPlatformCost, error) {
	data := deepSeekBizData(payload)
	rawBlocks, ok := firstArray(data, "cost", "costs", "currencies")
	if !ok {
		if nested, ok := firstArray(data, "data"); ok {
			rawBlocks = nested
		} else {
			return nil, nil
		}
	}
	currentMonth := now.Year() == month.Year && int(now.Month()) == month.Month
	today := now.Format("2006-01-02")
	costs := make([]DeepSeekPlatformCost, 0, len(rawBlocks))
	for _, raw := range rawBlocks {
		block, _ := raw.(map[string]any)
		if block == nil {
			continue
		}
		currency := deepSeekText(block, "currency", "currency_code", "currencyCode")
		if currency == "" {
			continue
		}
		cost := DeepSeekPlatformCost{Currency: currency}
		for _, model := range firstArrayValues(block, "total", "totals", "models", "model_cost", "modelCost") {
			cost.MonthlyCost += deepSeekEntryAmount(model)
		}
		for _, rawDay := range firstArrayValues(block, "days", "daily", "daily_cost", "dailyCost") {
			day, _ := rawDay.(map[string]any)
			if day == nil {
				continue
			}
			date := deepSeekText(day, "date", "day")
			amount := deepSeekFloat(day, "amount", "value", "cost", "total")
			if amount == 0 {
				amount = deepSeekBlockDayAmount(day)
			}
			cost.Daily = append(cost.Daily, DeepSeekPlatformCostDay{Date: date, Amount: amount})
			if currentMonth && date == today {
				cost.TodayCost = amount
			}
		}
		costs = append(costs, cost)
	}
	return costs, nil
}

func deepSeekBlockDayAmount(day map[string]any) float64 {
	var amount float64
	for _, model := range firstArrayValues(day, "models", "data", "costs", "model_cost", "modelCost") {
		amount += deepSeekEntryAmount(model)
	}
	return amount
}

func deepSeekEntryAmount(value any) float64 {
	entry, _ := value.(map[string]any)
	if entry == nil {
		return 0
	}
	var amount float64
	for _, usageEntry := range firstArrayValues(entry, "usage", "usages") {
		usage, _ := usageEntry.(map[string]any)
		if usage == nil {
			continue
		}
		amount += deepSeekFloat(usage, "amount", "value", "cost")
	}
	if amount == 0 {
		amount = deepSeekFloat(entry, "amount", "value", "cost")
	}
	return amount
}

func firstArray(data map[string]any, keys ...string) ([]any, bool) {
	for _, key := range keys {
		if value, ok := data[key].([]any); ok {
			return value, true
		}
	}
	return nil, false
}

func firstArrayValues(data map[string]any, keys ...string) []any {
	for _, key := range keys {
		if value, ok := data[key].([]any); ok {
			return value
		}
	}
	return nil
}

func nestedInt(data map[string]any, key string) (int64, bool) {
	switch value := data[key].(type) {
	case float64:
		return int64(value), true
	case int64:
		return value, true
	case json.Number:
		parsed, err := value.Int64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func deepSeekText(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := data[key].(string); ok {
			if text := strings.TrimSpace(value); text != "" {
				return text
			}
		}
	}
	return ""
}

func deepSeekInt(data map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := data[key].(type) {
		case float64:
			return int64(value)
		case int64:
			return value
		case json.Number:
			if parsed, err := value.Int64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func deepSeekFloat(data map[string]any, keys ...string) float64 {
	for _, key := range keys {
		switch value := data[key].(type) {
		case float64:
			return value
		case json.Number:
			if parsed, err := value.Float64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
				return parsed
			}
		}
	}
	return 0
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
		baseURL = baseURLs[0]
	}
	return &DeepSeekPlatformStore{
		token:   strings.TrimSpace(token),
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
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
func (s *DeepSeekPlatformStore) Get(ctx context.Context, year, month int, force bool) (DeepSeekPlatformUsage, error) {
	key := fmt.Sprintf("%d-%02d", year, month)
	s.mu.RLock()
	entry, exists := s.cache[key]
	token := s.token
	now := s.now().UTC()
	s.mu.RUnlock()
	if exists && !force && cacheFresh(entry, now, year, month) {
		return entry.usage, nil
	}
	client := DeepSeekPlatformClient{Token: token, BaseURL: s.baseURL, Client: s.client, Now: s.now}
	usage, err := client.Fetch(ctx, year, month)
	if err != nil {
		if errors.Is(err, errDeepSeekExpired) {
			s.mu.RLock()
			entry, exists = s.cache[key]
			s.mu.RUnlock()
			if exists {
				stale := entry.usage
				stale.Status = DeepSeekPlatformExpired
				return stale, nil
			}
			return DeepSeekPlatformUsage{
				Status: DeepSeekPlatformExpired,
				Month:  DeepSeekPlatformMonth{Year: year, Month: month},
			}, nil
		}
		return DeepSeekPlatformUsage{}, err
	}
	usage.Month = DeepSeekPlatformMonth{Year: year, Month: month}
	usage.CachedAt = &now
	s.mu.Lock()
	s.cache[key] = deepSeekPlatformCacheEntry{usage: usage, fetchedAt: now}
	s.mu.Unlock()
	return usage, nil
}

func cacheFresh(entry deepSeekPlatformCacheEntry, now time.Time, year, month int) bool {
	ttl := deepSeekPlatformPastMonthTTL
	if year == now.Year() && month == int(now.Month()) {
		ttl = deepSeekPlatformCurrentMonthTTL
	}
	return now.Sub(entry.fetchedAt) < ttl
}
