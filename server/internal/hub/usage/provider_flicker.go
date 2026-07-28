package usage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultFlickerEndpoint = "https://takumi.corp.kuaishou.com/rest/codeflicker/credit-alert"
	defaultFlickerVersion  = "0.3.11"
)

type FlickerCredential struct {
	Token    string
	UserName string
}

type FlickerScanner struct {
	credential FlickerCredential
	client     *http.Client
	endpoint   string
	version    string
	now        func() time.Time
}

func NewFlickerScanner(credential FlickerCredential, client *http.Client, endpoint, version string) *FlickerScanner {
	if client == nil {
		client = http.DefaultClient
	}
	if endpoint == "" {
		endpoint = defaultFlickerEndpoint
	}
	if version == "" {
		version = defaultFlickerVersion
	}
	return &FlickerScanner{credential: credential, client: client, endpoint: endpoint, version: version, now: time.Now}
}

func (s *FlickerScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderFlicker, Name: "MyFlicker", Accounts: []Account{}}
	if s == nil || s.credential.Token == "" {
		result.Status, result.Message = ProviderUnavailable, "not authenticated"
		return result
	}
	payload, message := s.fetch(ctx)
	account := Account{LocalID: "myflicker", Identity: Identity{Kind: "source", Label: "Account"}, Limits: []Limit{}}
	if message != "" {
		account.Status, account.Message = ProviderError, message
	} else if limits, userID, err := parseFlickerLimits(payload, s.now()); err != nil {
		account.Status, account.Message = ProviderError, "invalid response"
	} else {
		account.Status, account.Limits = ProviderOK, limits
		if userID != "" {
			account.LocalID = userID
			account.Identity = Identity{Kind: "user", Value: userID, Label: "Account"}
		}
	}
	result.Accounts = []Account{account}
	result.Status = providerStatus(result.Accounts)
	return result
}

func (s *FlickerScanner) fetch(ctx context.Context) (map[string]any, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.endpoint, nil)
	if err != nil {
		return nil, "network error"
	}
	req.Header.Set("Authorization", "Bearer "+s.credential.Token)
	req.Header.Set("x-takumi-token", s.credential.Token)
	req.Header.Set("x-takumi-version", s.version)
	req.Header.Set("x-takumi-userName", s.credential.UserName)
	req.Header.Set("Accept", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return nil, "network error"
	}
	defer res.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(res.Body, maxProviderResponseBytes))
	if readErr != nil || res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, providerErrorMessage(s.credential.Token, res.StatusCode, body, readErr)
	}
	var envelope struct {
		Success bool           `json:"success"`
		Result  int            `json:"result"`
		Data    map[string]any `json:"data"`
	}
	if json.Unmarshal(body, &envelope) != nil || (!envelope.Success && envelope.Result != 1) || envelope.Data == nil {
		return nil, "invalid response"
	}
	return envelope.Data, ""
}

func parseFlickerLimits(data map[string]any, now time.Time) ([]Limit, string, error) {
	total := number(data["creditTotal"])
	if total <= 0 {
		return nil, "", fmt.Errorf("limits missing")
	}
	remaining := number(data["availableRatio"])
	reset := myFlickerMonthReset(now)
	limits := []Limit{{
		ID: "month", Label: "Month", RemainingPercent: clampPercent(remaining),
		WindowKind: WindowCalendarMonth, ResetsAt: &reset,
	}}
	userID := ""
	if value := data["userId"]; value != nil {
		userID = fmt.Sprint(value)
	}
	return limits, userID, nil
}

func myFlickerMonthReset(now time.Time) time.Time {
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	local := now.In(shanghai)
	return time.Date(local.Year(), local.Month()+1, 1, 0, 0, 0, 0, shanghai)
}

func readFlickerCredential(path string) FlickerCredential {
	var stored struct {
		UserInfo struct {
			Token    string `json:"token"`
			UserName struct {
				UserName string `json:"userName"`
			} `json:"userName"`
		} `json:"userInfo"`
	}
	raw, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(raw, &stored) != nil {
		return FlickerCredential{}
	}
	return FlickerCredential{Token: strings.TrimSpace(stored.UserInfo.Token), UserName: strings.TrimSpace(stored.UserInfo.UserName.UserName)}
}

func defaultFlickerCredentialPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".myflicker", "ai-token.json")
}
