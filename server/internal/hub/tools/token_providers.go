package tools

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// formatCodexWindowString renders a codexWindow into the historical compact
// format used by the web client: "77% (07-22 15:04)" or just "77%".
func formatCodexWindowString(w *codexWindow) string {
	if w == nil {
		return ""
	}
	remaining := int64(100 - w.usedPercent)
	if remaining < 0 {
		remaining = 0
	}
	if remaining > 100 {
		remaining = 100
	}
	if w.resetsAt <= 0 {
		return fmt.Sprintf("%d%%", remaining)
	}
	return fmt.Sprintf("%d%% (%s)", remaining, time.Unix(w.resetsAt, 0).Local().Format("01-02 15:04"))
}

// scanKimiProvider queries Kimi usages for one API key and builds a scan result.
func scanKimiProvider(ctx context.Context, httpClient *http.Client, apiKey, source, now string) tokenProviderScanResult {
	account := tokenProviderAccount{
		ID:          "kimi:" + maskSecret(apiKey),
		Alias:       "kimi",
		DisplayName: "Kimi",
		Source:      source,
		Status:      "ok",
		UpdatedAt:   now,
	}
	payload, err := fetchKimiUsages(ctx, httpClient, apiKey)
	if err != nil {
		account.Status = "error"
		account.Message = err.Error()
		return tokenProviderScanResult{ID: "kimi", Name: "Kimi", Accounts: []tokenProviderAccount{account}}
	}
	fiveHour, week, pErr := parseKimiUsages(payload)
	if pErr != nil {
		account.Status = "error"
		account.Message = pErr.Error()
	} else {
		account.FiveHourLimit = formatCodexWindowString(fiveHour)
		account.WeeklyLimit = formatCodexWindowString(week)
	}
	return tokenProviderScanResult{ID: "kimi", Name: "Kimi", Accounts: []tokenProviderAccount{account}}
}

// scanZAIProvider queries ZAI quota-limit for one API key and builds a scan result.
func scanZAIProvider(ctx context.Context, httpClient *http.Client, apiKey, source, now string) tokenProviderScanResult {
	account := tokenProviderAccount{
		ID:          "zai:" + maskSecret(apiKey),
		Alias:       "zai",
		DisplayName: "ZAI",
		Source:      source,
		Status:      "ok",
		UpdatedAt:   now,
	}
	payload, err := fetchZAIQuotaLimit(ctx, httpClient, apiKey)
	if err != nil {
		account.Status = "error"
		account.Message = err.Error()
		return tokenProviderScanResult{ID: "zai", Name: "ZAI", Accounts: []tokenProviderAccount{account}}
	}
	fiveHour, week, mcp, level, pErr := parseZAIQuotaLimit(payload)
	if pErr != nil {
		account.Status = "error"
		account.Message = pErr.Error()
	} else {
		if strings.TrimSpace(level) != "" {
			account.Plan = level
		}
		account.FiveHourLimit = formatCodexWindowString(fiveHour)
		account.WeeklyLimit = formatCodexWindowString(week)
		account.MCPLimit = formatCodexWindowString(mcp)
	}
	return tokenProviderScanResult{ID: "zai", Name: "ZAI", Accounts: []tokenProviderAccount{account}}
}

// scanDeepSeekProviderFromOpenCode queries DeepSeek balance for one API key.
func scanDeepSeekProviderFromOpenCode(ctx context.Context, httpClient *http.Client, apiKey, source, now string) tokenProviderScanResult {
	masked := maskSecret(apiKey)
	account := tokenProviderAccount{
		ID:          "deepseek:" + masked,
		Alias:       "deepseek",
		DisplayName: "DeepSeek",
		Source:      source,
		Status:      "ok",
		UpdatedAt:   now,
		Usage: deepSeekUsageView{
			RangeType: "month",
			Month:     time.Now().UTC().Format("2006-01"),
			Rows:      []deepSeekUsageRow{},
		},
	}
	scanner := &tokenScanner{httpClient: httpClient, deepSeekBaseURL: "https://api.deepseek.com"}
	balance, err := scanner.fetchDeepSeekBalance(ctx, apiKey)
	if err != nil {
		account.Status = "error"
		account.Message = err.Error()
	} else {
		account.Balance = balance
	}
	return tokenProviderScanResult{ID: "deepseek", Name: "DeepSeek", Accounts: []tokenProviderAccount{account}}
}

// scanCodexProfilesWithAppServer runs the app-server flow for each discovered
// codex profile. It never calls chatgpt.com/backend-api/wham/usage.
func (c *tokenScanner) scanCodexProfilesWithAppServer(ctx context.Context, profiles []codexAuthProfile, codexBinary, now string) tokenProviderScanResult {
	accounts := make([]tokenProviderAccount, 0, len(profiles))
	for _, profile := range profiles {
		state := extractCodexAuthState(profile.Auth)
		alias := strings.TrimSpace(profile.Alias)
		if alias == "" {
			alias = "codex"
		}
		accountID := strings.TrimSpace(state.AccountID)
		if accountID == "" {
			accountID = alias
		}
		acc := tokenProviderAccount{
			ID:          accountID + ":" + alias,
			Alias:       alias,
			DisplayName: alias,
			Source:      profile.Source,
			Status:      "ok",
			Email:       state.Email,
			Plan:        state.Plan,
			UpdatedAt:   now,
		}
		fiveHour, week, err := fetchCodexRateLimitsViaAppServer(ctx, codexBinary, state.AccessToken)
		if err != nil {
			acc.Status = "error"
			acc.Message = err.Error()
			accounts = append(accounts, acc)
			continue
		}
		acc.FiveHourLimit = formatCodexWindowString(fiveHour)
		acc.WeeklyLimit = formatCodexWindowString(week)
		accounts = append(accounts, acc)
	}
	return tokenProviderScanResult{ID: "codex", Name: "Codex", Accounts: accounts}
}
