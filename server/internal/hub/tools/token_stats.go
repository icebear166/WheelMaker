package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type deepSeekBalanceInfo struct {
	Currency        string `json:"currency"`
	TotalBalance    string `json:"totalBalance"`
	GrantedBalance  string `json:"grantedBalance"`
	ToppedUpBalance string `json:"toppedUpBalance"`
}

type deepSeekBalanceView struct {
	IsAvailable bool                  `json:"isAvailable"`
	Items       []deepSeekBalanceInfo `json:"items"`
}

type deepSeekUsageRow struct {
	Bucket       string  `json:"bucket"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	TotalTokens  int64   `json:"totalTokens"`
	Cost         float64 `json:"cost"`
}

type deepSeekUsageView struct {
	RangeType string             `json:"rangeType"`
	Month     string             `json:"month"`
	Rows      []deepSeekUsageRow `json:"rows"`
}

type deepSeekBalanceResponse struct {
	IsAvailable  bool `json:"is_available"`
	BalanceInfos []struct {
		Currency        string `json:"currency"`
		TotalBalance    string `json:"total_balance"`
		GrantedBalance  string `json:"granted_balance"`
		ToppedUpBalance string `json:"topped_up_balance"`
	} `json:"balance_infos"`
}

type tokenProviderScanResult struct {
	ID       string                 `json:"id"`
	Name     string                 `json:"name"`
	Accounts []tokenProviderAccount `json:"accounts"`
}

type tokenProviderAccount struct {
	ID            string              `json:"id"`
	Alias         string              `json:"alias"`
	DisplayName   string              `json:"displayName"`
	Source        string              `json:"source"`
	Status        string              `json:"status"`
	Message       string              `json:"message,omitempty"`
	Email         string              `json:"email,omitempty"`
	Plan          string              `json:"plan,omitempty"`
	FiveHourLimit string              `json:"fiveHourLimit,omitempty"`
	WeeklyLimit   string              `json:"weeklyLimit,omitempty"`
	MCPLimit      string              `json:"mcpLimit,omitempty"`
	Balance       deepSeekBalanceView `json:"balance"`
	Usage         deepSeekUsageView   `json:"usage"`
	UpdatedAt     string              `json:"updatedAt,omitempty"`
}

type tokenScanPayload struct {
	OK        bool                      `json:"ok"`
	UpdatedAt string                    `json:"updatedAt"`
	Providers []tokenProviderScanResult `json:"providers"`
}

type tokenScanner struct {
	httpClient      *http.Client
	deepSeekBaseURL string
	publish         func(any) // optional streaming callback; nil = collect-only
}

type codexAuthProfile struct {
	Alias  string
	Source string
	Auth   map[string]any
}

type codexAuthState struct {
	AccessToken string
	AccountID   string
	Email       string
	Plan        string
}

// ScanTokenStats is the entry point invoked by the hub tool dispatcher. It
// discovers credentials, dedups by key hash, queries all providers in
// parallel, and (when wired via the streaming driver) publishes incremental
// results. The current implementation returns the aggregated payload; the
// streaming hook is added in a later task.
func ScanTokenStats(ctx context.Context) (any, error) {
	return ScanTokenStatsWithPublisher(ctx, nil)
}

// ScanTokenStatsWithPublisher runs the parallel scan and invokes publish (if
// non-nil) for each completed provider result, in completion order. Used by
// the streaming refresh path; the non-streaming "scan" action passes nil.
func ScanTokenStatsWithPublisher(ctx context.Context, publish func(any)) (any, error) {
	scanner := &tokenScanner{
		httpClient:      &http.Client{Timeout: 15 * time.Second},
		deepSeekBaseURL: "https://api.deepseek.com",
		publish:         publish,
	}
	return scanner.scanTokenStats(ctx)
}

func (c *tokenScanner) scanTokenStats(ctx context.Context) (tokenScanPayload, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	opencodeKeys, _ := readOpenCodeProviderKeys(defaultOpenCodeAuthPath())
	driver := &streamDriver{}
	if profiles := discoverCodexAuthProfiles(); len(profiles) > 0 {
		profiles := profiles
		driver.add(func() tokenProviderScanResult {
			return c.scanCodexProfilesWithAppServer(ctx, profiles, "", now)
		})
	}
	if key, ok := opencodeKeys["kimi-for-coding"]; ok {
		key := key
		driver.add(func() tokenProviderScanResult {
			return scanKimiProvider(ctx, c.httpClient, key, "opencode:kimi-for-coding", now)
		})
	}
	if key, ok := opencodeKeys["zai-coding-plan"]; ok {
		key := key
		driver.add(func() tokenProviderScanResult {
			return scanZAIProvider(ctx, c.httpClient, key, "opencode:zai-coding-plan", now)
		})
	}
	if key, ok := opencodeKeys["deepseek"]; ok {
		key := key
		driver.add(func() tokenProviderScanResult {
			return scanDeepSeekProviderFromOpenCode(ctx, c.httpClient, key, "opencode:deepseek", now)
		})
	}
	providers := driver.run(func(r tokenProviderScanResult) {
		if c.publish != nil {
			c.publish(r)
		}
	})
	return tokenScanPayload{
		OK:        true,
		UpdatedAt: now,
		Providers: providers,
	}, nil
}

// fetchDeepSeekBalance queries the DeepSeek balance endpoint for one key.
func (c *tokenScanner) fetchDeepSeekBalance(ctx context.Context, apiKey string) (deepSeekBalanceView, error) {
	base := strings.TrimRight(strings.TrimSpace(c.deepSeekBaseURL), "/")
	if base == "" {
		base = "https://api.deepseek.com"
	}
	endpoint := base + "/user/balance"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return deepSeekBalanceView{}, fmt.Errorf("build deepseek balance request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	res, err := c.httpClient.Do(req)
	if err != nil {
		return deepSeekBalanceView{}, fmt.Errorf("query deepseek balance: %w", err)
	}
	defer res.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return deepSeekBalanceView{}, fmt.Errorf("deepseek api key is invalid or unauthorized")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = res.Status
		}
		return deepSeekBalanceView{}, fmt.Errorf("deepseek balance request failed: %s", message)
	}

	var parsed deepSeekBalanceResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return deepSeekBalanceView{}, fmt.Errorf("decode deepseek balance response: %w", err)
	}

	items := make([]deepSeekBalanceInfo, 0, len(parsed.BalanceInfos))
	for _, info := range parsed.BalanceInfos {
		items = append(items, deepSeekBalanceInfo{
			Currency:        strings.TrimSpace(info.Currency),
			TotalBalance:    strings.TrimSpace(info.TotalBalance),
			GrantedBalance:  strings.TrimSpace(info.GrantedBalance),
			ToppedUpBalance: strings.TrimSpace(info.ToppedUpBalance),
		})
	}
	return deepSeekBalanceView{IsAvailable: parsed.IsAvailable, Items: items}, nil
}

// discoverCodexAuthProfiles reads ~/.codex/auth.json (current) and
// ~/.codex/codex-cc.json (named profiles), returning every distinct codex
// ChatGPT auth blob it can find.
func discoverCodexAuthProfiles() []codexAuthProfile {
	profiles := make([]codexAuthProfile, 0)
	seen := map[string]struct{}{}
	appendProfile := func(alias, source string, auth map[string]any) {
		if len(auth) == 0 {
			return
		}
		state := extractCodexAuthState(auth)
		identity := firstNonEmptyString(state.AccountID, state.Email, state.AccessToken)
		if strings.TrimSpace(identity) == "" {
			return
		}
		if _, exists := seen[identity]; exists {
			return
		}
		seen[identity] = struct{}{}
		profiles = append(profiles, codexAuthProfile{Alias: strings.TrimSpace(alias), Source: strings.TrimSpace(source), Auth: auth})
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return profiles
	}
	codexDir := filepath.Join(home, ".codex")
	if auth := readJSONMapFile(filepath.Join(codexDir, "auth.json")); len(auth) > 0 {
		appendProfile("current", "~/.codex/auth.json", auth)
	}
	store := readJSONMapFile(filepath.Join(codexDir, "codex-cc.json"))
	if len(store) == 0 {
		return profiles
	}
	profilesNode, ok := store["profiles"].(map[string]any)
	if !ok {
		return profiles
	}
	for alias, rawProfile := range profilesNode {
		profileMap, ok := rawProfile.(map[string]any)
		if !ok {
			continue
		}
		provider := strings.ToLower(strings.TrimSpace(firstStringField(profileMap, "provider")))
		if provider != "" && provider != "codex" {
			continue
		}
		authNode, ok := profileMap["auth"].(map[string]any)
		if !ok {
			authNode, _ = profileMap["data"].(map[string]any)
		}
		appendProfile(alias, "~/.codex/codex-cc.json", authNode)
	}
	return profiles
}

func extractCodexAuthState(auth map[string]any) codexAuthState {
	tokens, _ := auth["tokens"].(map[string]any)
	accessToken := strings.TrimSpace(firstStringField(tokens, "access_token", "accessToken"))
	accountID := strings.TrimSpace(firstStringField(tokens, "account_id", "accountId"))
	email := ""
	plan := ""
	claims := decodeJWTPayload(accessToken)
	if len(claims) == 0 {
		idToken := strings.TrimSpace(firstStringField(tokens, "id_token", "idToken"))
		claims = decodeJWTPayload(idToken)
	}
	if len(claims) > 0 {
		profileMap, _ := claims["https://api.openai.com/profile"].(map[string]any)
		email = strings.TrimSpace(firstStringField(profileMap, "email"))
		authInfo, _ := claims["https://api.openai.com/auth"].(map[string]any)
		if accountID == "" {
			accountID = strings.TrimSpace(firstStringField(authInfo, "chatgpt_account_id"))
		}
		plan = strings.TrimSpace(firstStringField(authInfo, "chatgpt_plan_type"))
	}
	return codexAuthState{
		AccessToken: accessToken,
		AccountID:   accountID,
		Email:       email,
		Plan:        normalizePlanLabel(plan),
	}
}

func decodeJWTPayload(token string) map[string]any {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) < 2 {
		return nil
	}
	payload := parts[1]
	decoded, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(decoded, &out); err != nil {
		return nil
	}
	return out
}

func normalizePlanLabel(plan string) string {
	value := strings.ToLower(strings.TrimSpace(plan))
	switch value {
	case "plus":
		return "Plus"
	case "pro":
		return "Pro"
	case "prolite":
		return "Pro Lite"
	case "team":
		return "Team"
	case "business":
		return "Business"
	case "enterprise", "enterprise/edu":
		return "Enterprise"
	default:
		if value == "" {
			return ""
		}
		return strings.ToUpper(value)
	}
}

func readJSONMapFile(path string) map[string]any {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		clean := sanitizeJSONWithLineComments(string(body))
		if clean == "" || json.Unmarshal([]byte(clean), &out) != nil {
			return nil
		}
	}
	return out
}

func sanitizeJSONWithLineComments(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

func firstStringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key]; ok {
			switch typed := value.(type) {
			case string:
				trimmed := strings.TrimSpace(typed)
				if trimmed != "" {
					return trimmed
				}
			}
		}
	}
	return ""
}

func firstInt64Field(m map[string]any, keys ...string) int64 {
	for _, key := range keys {
		if value, ok := m[key]; ok {
			switch typed := value.(type) {
			case float64:
				if !math.IsNaN(typed) && !math.IsInf(typed, 0) {
					return int64(typed)
				}
			case json.Number:
				if n, err := typed.Int64(); err == nil {
					return n
				}
			case string:
				if n, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil {
					return n
				}
			}
		}
	}
	return 0
}

func firstFloat64Field(m map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value, ok := m[key]; ok {
			switch typed := value.(type) {
			case float64:
				if !math.IsNaN(typed) && !math.IsInf(typed, 0) {
					return typed
				}
			case json.Number:
				if n, err := typed.Float64(); err == nil {
					return n
				}
			case string:
				if n, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
					return n
				}
			}
		}
	}
	return 0
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func maskSecret(secret string) string {
	trimmed := strings.TrimSpace(secret)
	if len(trimmed) <= 8 {
		return "****"
	}
	return trimmed[:4] + "..." + trimmed[len(trimmed)-4:]
}
