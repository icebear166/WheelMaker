package usage

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	qwenBailianUsageAPI         = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage"
	qwenBailianSubscriptionAPI  = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription"
	qwenBailianQuotaConfigAPI   = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config"
	qwenBailianMaxResponseBytes = 2 << 20
	qwenOAuthTokenEndpoint      = "https://chat.qwen.ai/api/v1/oauth2/token"
	qwenOAuthClientID           = "f0304373b74a44d2b584a3fb70ca9e56"
	qwenOAuthRefreshSkew        = 2 * time.Minute
)

var errQwenLoginRequired = errors.New("login required")

type QwenOAuthCredential struct {
	AccessToken  string     `json:"accessToken,omitempty"`
	RefreshToken string     `json:"refreshToken,omitempty"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	Region       string     `json:"region,omitempty"`
	Site         string     `json:"site,omitempty"`
}

type QwenCreditsState string

const (
	QwenCreditsLimited     QwenCreditsState = "limited"
	QwenCreditsUnlimited   QwenCreditsState = "unlimited"
	QwenCreditsUnavailable QwenCreditsState = "unavailable"
)

type QwenCreditsWindow struct {
	State            QwenCreditsState `json:"state"`
	Total            string           `json:"total,omitempty"`
	Used             string           `json:"used,omitempty"`
	Remaining        string           `json:"remaining,omitempty"`
	RemainingPercent *float64         `json:"remainingPercent,omitempty"`
	WindowID         string           `json:"windowId,omitempty"`
	ResetsAt         *time.Time       `json:"resetsAt,omitempty"`
}

type QwenSubscription struct {
	InstanceCode  string     `json:"instanceCode,omitempty"`
	SpecCode      string     `json:"specCode,omitempty"`
	RemainingDays *int64     `json:"remainingDays,omitempty"`
	StartTime     *time.Time `json:"startTime,omitempty"`
	EndTime       *time.Time `json:"endTime,omitempty"`
	AutoRenew     *bool      `json:"autoRenew,omitempty"`
	Status        string     `json:"status,omitempty"`
}

type QwenQuotaConfig struct {
	FiveHour string `json:"fiveHour,omitempty"`
	Week     string `json:"week,omitempty"`
}

type QwenUsageData struct {
	FiveHour     QwenCreditsWindow `json:"fiveHour"`
	Week         QwenCreditsWindow `json:"week"`
	Subscription *QwenSubscription `json:"subscription,omitempty"`
	Quota        *QwenQuotaConfig  `json:"quota,omitempty"`
	UpdatedAt    *time.Time        `json:"updatedAt,omitempty"`
}

func cloneQwenUsageData(value *QwenUsageData) *QwenUsageData {
	if value == nil {
		return nil
	}
	copyValue := *value
	copyValue.FiveHour.ResetsAt = cloneTime(value.FiveHour.ResetsAt)
	copyValue.Week.ResetsAt = cloneTime(value.Week.ResetsAt)
	copyValue.UpdatedAt = cloneTime(value.UpdatedAt)
	if value.Subscription != nil {
		subscription := *value.Subscription
		subscription.StartTime = cloneTime(value.Subscription.StartTime)
		subscription.EndTime = cloneTime(value.Subscription.EndTime)
		copyValue.Subscription = &subscription
	}
	if value.Quota != nil {
		quota := *value.Quota
		copyValue.Quota = &quota
	}
	if value.FiveHour.RemainingPercent != nil {
		remaining := *value.FiveHour.RemainingPercent
		copyValue.FiveHour.RemainingPercent = &remaining
	}
	if value.Week.RemainingPercent != nil {
		remaining := *value.Week.RemainingPercent
		copyValue.Week.RemainingPercent = &remaining
	}
	return &copyValue
}

type qwenUsageWindow struct {
	ConsumedPercent float64
	Available       bool
	ResetsAt        *time.Time
}

type qwenTokenPlanUsage struct {
	FiveHour qwenUsageWindow
	Week     qwenUsageWindow
}

type qwenGatewayClient struct {
	credential QwenOAuthCredential
	client     *http.Client
	gatewayURL string
}

type QwenBailianScanner struct {
	APIKey            string
	Credential        QwenOAuthCredential
	Client            *http.Client
	GatewayURL        string
	OAuthTokenURL     string
	PersistCredential func(QwenOAuthCredential) error
}

func NewQwenBailianScanner(apiKey string, credential QwenOAuthCredential, client *http.Client, gatewayURL string) *QwenBailianScanner {
	if client == nil {
		client = http.DefaultClient
	}
	return &QwenBailianScanner{
		APIKey: strings.TrimSpace(apiKey), Credential: credential, Client: client,
		GatewayURL: strings.TrimRight(strings.TrimSpace(gatewayURL), "/"),
	}
}

func (s *QwenBailianScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderQwen, Name: "Qwen", Accounts: []Account{}}
	if s == nil || !strings.HasPrefix(strings.TrimSpace(s.APIKey), "sk-sp-") {
		result.Remove = true
		result.Status = ProviderUnavailable
		return result
	}
	account := Account{
		LocalID:  "bailian-token-plan",
		Identity: Identity{Kind: "source", Label: "阿里云百炼 Token Plan"},
		Limits:   []Limit{},
	}
	if strings.TrimSpace(s.Credential.AccessToken) == "" {
		result.Accounts = []Account{account}
		result.Status = ProviderUnavailable
		result.Message = "login required"
		result.Accounts[0].Status = ProviderUnavailable
		result.Accounts[0].Message = "login required"
		return result
	}

	credential, err := s.credentialForScan(ctx)
	if err != nil {
		result.Status = ProviderUnavailable
		result.Message = qwenScanErrorMessage(err)
		result.Authenticated = !errors.Is(err, errQwenLoginRequired)
		return result
	}
	result.Authenticated = true
	client := qwenGatewayClient{credential: credential, client: s.Client, gatewayURL: s.GatewayURL}
	refreshAttempted := false
	fetch := func(api string) (map[string]any, error) {
		raw, fetchErr := client.fetch(ctx, api)
		if !errors.Is(fetchErr, errQwenLoginRequired) || refreshAttempted || strings.TrimSpace(credential.RefreshToken) == "" {
			return raw, fetchErr
		}
		refreshAttempted = true
		refreshed, refreshErr := s.refreshCredential(ctx, credential)
		if refreshErr != nil {
			return nil, refreshErr
		}
		credential = refreshed
		client.credential = credential
		return client.fetch(ctx, api)
	}
	rawUsage, err := fetch(qwenBailianUsageAPI)
	if err != nil {
		result.Status = ProviderUnavailable
		result.Message = qwenScanErrorMessage(err)
		result.Authenticated = !errors.Is(err, errQwenLoginRequired)
		return result
	}
	usageValue, err := parseQwenTokenPlanUsage(rawUsage)
	if err != nil {
		result.Status = ProviderUnavailable
		result.Message = "invalid usage response"
		return result
	}

	rawSubscription, err := fetch(qwenBailianSubscriptionAPI)
	if err != nil {
		return qwenStatsUnavailable(result, "subscription unavailable", err)
	}
	subscription, err := parseQwenSubscription(rawSubscription)
	if err != nil {
		return qwenStatsUnavailable(result, "subscription unavailable", err)
	}
	rawQuota, err := fetch(qwenBailianQuotaConfigAPI)
	if err != nil {
		return qwenStatsUnavailable(result, "quota unavailable", err)
	}
	quotas, err := parseQwenQuotaConfig(rawQuota)
	if err != nil {
		return qwenStatsUnavailable(result, "quota unavailable", err)
	}
	data := usageValue.applyQuota(subscription, quotas)
	if data.Quota == nil || data.FiveHour.State == QwenCreditsUnavailable && data.Week.State == QwenCreditsUnavailable {
		return qwenStatsUnavailable(result, "quota unavailable", errors.New("missing active quota"))
	}
	now := time.Now().UTC()
	data.UpdatedAt = &now
	account.Status = ProviderOK
	account.Plan = data.SubscriptionPlan()
	account.Qwen = &data
	account.Limits = data.limits()
	result.Accounts = []Account{account}
	result.Status = ProviderOK
	return result
}

func (s *QwenBailianScanner) credentialForScan(ctx context.Context) (QwenOAuthCredential, error) {
	credential := s.Credential
	if credential.ExpiresAt == nil || credential.ExpiresAt.After(time.Now().UTC().Add(qwenOAuthRefreshSkew)) {
		return credential, nil
	}
	return s.refreshCredential(ctx, credential)
}

func (s *QwenBailianScanner) refreshCredential(ctx context.Context, credential QwenOAuthCredential) (QwenOAuthCredential, error) {
	if strings.TrimSpace(credential.RefreshToken) == "" {
		return QwenOAuthCredential{}, errQwenLoginRequired
	}
	endpoint := strings.TrimSpace(s.OAuthTokenURL)
	if endpoint == "" {
		endpoint = qwenOAuthTokenEndpoint
	}
	refreshed, err := refreshQwenOAuthCredential(ctx, credential, s.Client, endpoint)
	if err != nil {
		return QwenOAuthCredential{}, err
	}
	if refreshed.RefreshToken == "" {
		refreshed.RefreshToken = credential.RefreshToken
	}
	if refreshed.Region == "" {
		refreshed.Region = credential.Region
	}
	if refreshed.Site == "" {
		refreshed.Site = credential.Site
	}
	if s.PersistCredential != nil {
		if err := s.PersistCredential(refreshed); err != nil {
			return QwenOAuthCredential{}, errors.New("persist OAuth credential")
		}
	}
	s.Credential = refreshed
	return refreshed, nil
}

func qwenStatsUnavailable(result ProviderSnapshot, message string, cause error) ProviderSnapshot {
	result.Status = ProviderUnavailable
	result.Message = message
	result.Accounts = []Account{}
	result.Authenticated = !errors.Is(cause, errQwenLoginRequired)
	return result
}

func qwenScanErrorMessage(err error) string {
	if errors.Is(err, errQwenLoginRequired) {
		return "login required"
	}
	return err.Error()
}

func refreshQwenOAuthCredential(ctx context.Context, credential QwenOAuthCredential, client *http.Client, endpoint string) (QwenOAuthCredential, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
		return QwenOAuthCredential{}, errors.New("invalid OAuth token endpoint")
	}
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {strings.TrimSpace(credential.RefreshToken)},
		"client_id":     {qwenOAuthClientID},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return QwenOAuthCredential{}, errors.New("create OAuth refresh request")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return QwenOAuthCredential{}, errors.New("OAuth refresh network error")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, qwenBailianMaxResponseBytes))
	if err != nil || len(body) == qwenBailianMaxResponseBytes {
		return QwenOAuthCredential{}, errors.New("invalid OAuth refresh response")
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusBadRequest {
		return QwenOAuthCredential{}, errQwenLoginRequired
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return QwenOAuthCredential{}, errors.New("OAuth refresh unavailable")
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return QwenOAuthCredential{}, errors.New("invalid OAuth refresh response")
	}
	data := payload
	if nested := qwenResponseData(payload); len(nested) > 0 {
		data = nested
	}
	accessToken := qwenOAuthString(data, "access_token", "accessToken")
	if accessToken == "" {
		accessToken = qwenOAuthString(payload, "access_token", "accessToken")
	}
	if accessToken == "" || len(accessToken) > 4096 || strings.ContainsAny(accessToken, " \t\r\n") {
		return QwenOAuthCredential{}, errors.New("invalid OAuth refresh response")
	}
	refreshed := QwenOAuthCredential{AccessToken: accessToken}
	refreshed.RefreshToken = qwenOAuthString(data, "refresh_token", "refreshToken")
	if refreshed.RefreshToken == "" {
		refreshed.RefreshToken = qwenOAuthString(payload, "refresh_token", "refreshToken")
	}
	if refreshed.RefreshToken != "" && (len(refreshed.RefreshToken) > 4096 || strings.ContainsAny(refreshed.RefreshToken, " \t\r\n")) {
		return QwenOAuthCredential{}, errors.New("invalid OAuth refresh response")
	}
	if expiresAt, ok := qwenOAuthExpiry(data); ok {
		refreshed.ExpiresAt = &expiresAt
	} else if expiresAt, ok := qwenOAuthExpiry(payload); ok {
		refreshed.ExpiresAt = &expiresAt
	}
	return refreshed, nil
}

func qwenOAuthString(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := data[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func qwenOAuthExpiry(data map[string]any) (time.Time, bool) {
	for _, key := range []string{"expiresAt", "expires_at"} {
		if value, ok := qwenTime(data[key]); ok {
			return value, true
		}
	}
	if seconds, ok := qwenNumber(data["expires_in"]); ok && seconds > 0 {
		return time.Now().UTC().Add(time.Duration(seconds * float64(time.Second))), true
	}
	return time.Time{}, false
}

func (c qwenGatewayClient) fetch(ctx context.Context, api string) (map[string]any, error) {
	gatewayURL := strings.TrimSpace(c.gatewayURL)
	if gatewayURL == "" {
		gatewayURL = qwenBailianGatewayURL(c.credential)
	}
	parsed, err := url.Parse(gatewayURL)
	if err != nil || parsed.Scheme != "https" && parsed.Scheme != "http" || parsed.Host == "" {
		return nil, errors.New("invalid Bailian gateway")
	}
	query := parsed.Query()
	query.Set("action", qwenGatewayAction(c.credential))
	query.Set("product", "sfm_bailian")
	query.Set("api", api)
	parsed.RawQuery = query.Encode()

	region := strings.TrimSpace(c.credential.Region)
	if region == "" {
		region = "cn-beijing"
	}
	site := strings.TrimSpace(c.credential.Site)
	consoleSite := "BAILIAN_ALIYUN"
	if site == "international" {
		consoleSite = "BAILIAN_ALIBABACLOUD"
	}
	params, err := json.Marshal(map[string]any{
		"Api": api,
		"V":   "1.0",
		"Data": map[string]any{
			"cornerstoneParam": map[string]any{
				"protocol": "V2", "console": "ONE_CONSOLE", "productCode": "p_efm", "switchUserType": 3, "consoleSite": consoleSite,
			},
		},
	})
	if err != nil {
		return nil, errors.New("encode Bailian request")
	}
	form := url.Values{"params": {string(params)}, "region": {region}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, errors.New("create Bailian request")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(c.credential.AccessToken))
	client := c.client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("network error")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, qwenBailianMaxResponseBytes))
	if err != nil || len(body) == qwenBailianMaxResponseBytes {
		return nil, errors.New("invalid response")
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return nil, errQwenLoginRequired
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New("network error")
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errors.New("invalid response")
	}
	if inner, ok := payload["data"].(map[string]any); ok {
		if success, exists := inner["success"].(bool); exists && !success {
			if code, _ := inner["errorCode"].(string); strings.Contains(strings.ToLower(code), "login") || strings.Contains(strings.ToLower(code), "auth") {
				return nil, errQwenLoginRequired
			}
			return nil, errors.New("Bailian gateway error")
		}
	}
	return payload, nil
}

func qwenGatewayAction(credential QwenOAuthCredential) string {
	if strings.EqualFold(strings.TrimSpace(credential.Region), "ap-southeast-1") {
		return "IntlBroadScopeAspnGateway"
	}
	return "BroadScopeAspnGateway"
}

func qwenBailianGatewayURL(credential QwenOAuthCredential) string {
	region := strings.ToLower(strings.TrimSpace(credential.Region))
	if region == "" {
		region = "cn-beijing"
	}
	site := strings.ToLower(strings.TrimSpace(credential.Site))
	if site == "" {
		site = "domestic"
	}
	switch {
	case region == "ap-southeast-1" && site == "international":
		return "https://bailian-singapore-cs.alibabacloud.com/cli/api.json"
	case region == "ap-southeast-1":
		return "https://modelstudio-cs.console.aliyun.com/cli/api.json"
	case site == "international":
		return "https://bailian-cs.console.alibabacloud.com/cli/api.json"
	default:
		return "https://bailian-cs.console.aliyun.com/cli/api.json"
	}
}

func parseQwenTokenPlanUsage(raw map[string]any) (qwenTokenPlanUsage, error) {
	data := qwenResponseData(raw)
	fiveHour, ok := qwenUsageWindowFromData(data, "per5HourPercentage", "per5HourResetTime")
	if !ok {
		return qwenTokenPlanUsage{}, errors.New("invalid five-hour usage")
	}
	week, ok := qwenUsageWindowFromData(data, "per1WeekPercentage", "per1WeekResetTime")
	if !ok {
		return qwenTokenPlanUsage{}, errors.New("invalid weekly usage")
	}
	if !fiveHour.Available && !week.Available {
		return qwenTokenPlanUsage{}, errors.New("missing token plan usage")
	}
	return qwenTokenPlanUsage{FiveHour: fiveHour, Week: week}, nil
}

func qwenUsageWindowFromData(data map[string]any, percentageKey, resetKey string) (qwenUsageWindow, bool) {
	if data == nil {
		return qwenUsageWindow{}, true
	}
	rawPercentage, exists := data[percentageKey]
	if !exists || rawPercentage == nil {
		return qwenUsageWindow{}, true
	}
	percentage, ok := qwenNumber(rawPercentage)
	if !ok || percentage < 0 || percentage > 1 {
		return qwenUsageWindow{}, false
	}
	window := qwenUsageWindow{ConsumedPercent: percentage * 100, Available: true}
	if reset, exists := qwenTime(data[resetKey]); exists {
		window.ResetsAt = &reset
	}
	return window, true
}

func parseQwenSubscription(raw map[string]any) (QwenSubscription, error) {
	data := qwenResponseData(raw)
	specCode, _ := data["specCode"].(string)
	if strings.TrimSpace(specCode) == "" {
		return QwenSubscription{}, errors.New("missing subscription tier")
	}
	subscription := QwenSubscription{SpecCode: strings.TrimSpace(specCode)}
	subscription.InstanceCode, _ = data["instanceCode"].(string)
	subscription.Status, _ = data["status"].(string)
	if days, ok := qwenInt64(data["remainingDays"]); ok {
		subscription.RemainingDays = &days
	}
	if start, ok := qwenTime(data["startTime"]); ok {
		subscription.StartTime = &start
	}
	if end, ok := qwenTime(data["endTime"]); ok {
		subscription.EndTime = &end
	}
	if autoRenew, ok := data["autoRenewFlag"].(bool); ok {
		subscription.AutoRenew = &autoRenew
	} else if autoRenew, ok := data["autoRenew"].(bool); ok {
		subscription.AutoRenew = &autoRenew
	}
	return subscription, nil
}

func parseQwenQuotaConfig(raw map[string]any) (map[string]QwenQuotaConfig, error) {
	data := qwenResponseData(raw)
	quotas := make(map[string]QwenQuotaConfig)
	for tier, rawValue := range data {
		value, ok := rawValue.(map[string]any)
		if !ok {
			continue
		}
		fiveHour, fiveHourOK := qwenStringNumber(value["five_hour"])
		week, weekOK := qwenStringNumber(value["weekly"])
		if !fiveHourOK && !weekOK {
			continue
		}
		quotas[tier] = QwenQuotaConfig{FiveHour: fiveHour, Week: week}
	}
	if len(quotas) == 0 {
		return nil, errors.New("missing quota config")
	}
	return quotas, nil
}

func (u qwenTokenPlanUsage) toCredits() QwenUsageData {
	return QwenUsageData{
		FiveHour: qwenCreditsWindow(u.FiveHour, "5h"),
		Week:     qwenCreditsWindow(u.Week, "week"),
	}
}

func (u qwenTokenPlanUsage) applyQuota(subscription QwenSubscription, quotas map[string]QwenQuotaConfig) QwenUsageData {
	data := u.toCredits()
	data.Subscription = &subscription
	quota, ok := quotas[subscription.SpecCode]
	if !ok {
		return data
	}
	data.Quota = &quota
	data.FiveHour = applyQwenQuota(data.FiveHour, u.FiveHour, quota.FiveHour)
	data.Week = applyQwenQuota(data.Week, u.Week, quota.Week)
	return data
}

func qwenCreditsWindow(window qwenUsageWindow, id string) QwenCreditsWindow {
	return QwenCreditsWindow{State: QwenCreditsUnavailable, WindowID: id, ResetsAt: window.ResetsAt}
}

func applyQwenQuota(window QwenCreditsWindow, usage qwenUsageWindow, total string) QwenCreditsWindow {
	if !usage.Available {
		return window
	}
	total = strings.TrimSpace(total)
	if isQwenUnlimitedQuota(total) {
		window.State = QwenCreditsUnlimited
		window.RemainingPercent = nil
		window.Total, window.Used, window.Remaining = "", "", ""
		return window
	}
	totalValue, err := strconv.ParseFloat(total, 64)
	if err != nil || totalValue <= 0 {
		return window
	}
	remaining := clampPercent(100 - usage.ConsumedPercent)
	window.State = QwenCreditsLimited
	window.RemainingPercent = &remaining
	usedValue := math.Round(totalValue * usage.ConsumedPercent / 100)
	remainingValue := math.Max(0, totalValue-usedValue)
	window.Total = formatQwenNumber(totalValue)
	window.Used = formatQwenNumber(usedValue)
	window.Remaining = formatQwenNumber(remainingValue)
	return window
}

func isQwenUnlimitedQuota(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "unlimited", "infinite", "infinity", "-1":
		return true
	default:
		return false
	}
}

func (d QwenUsageData) SubscriptionPlan() string {
	if d.Subscription == nil {
		return ""
	}
	return d.Subscription.SpecCode
}

func (d QwenUsageData) limits() []Limit {
	limits := make([]Limit, 0, 2)
	appendLimit := func(id, label string, window QwenCreditsWindow) {
		if window.RemainingPercent == nil {
			return
		}
		limits = append(limits, Limit{ID: id, Label: label, RemainingPercent: *window.RemainingPercent, WindowKind: WindowFixed, WindowDurationMins: qwenWindowDuration(id), ResetsAt: window.ResetsAt})
	}
	appendLimit("5h", "5 hours", d.FiveHour)
	appendLimit("week", "7 days", d.Week)
	return limits
}

func qwenWindowDuration(id string) int64 {
	if id == "5h" {
		return 300
	}
	return 10080
}

func qwenResponseData(raw map[string]any) map[string]any {
	current := raw
	for index := 0; index < 4; index++ {
		var next map[string]any
		for _, key := range []string{"data", "DataV2"} {
			if candidate, ok := current[key].(map[string]any); ok {
				next = candidate
				break
			}
		}
		if next == nil {
			break
		}
		current = next
	}
	return current
}

func qwenNumber(value any) (float64, bool) {
	switch value := value.(type) {
	case float64:
		return value, finite(value)
	case float32:
		return float64(value), finite(float64(value))
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case json.Number:
		parsed, err := value.Float64()
		return parsed, err == nil && finite(parsed)
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return parsed, err == nil && finite(parsed)
	default:
		return 0, false
	}
}

func qwenStringNumber(value any) (string, bool) {
	if stringValue, ok := value.(string); ok {
		stringValue = strings.TrimSpace(stringValue)
		if isQwenUnlimitedQuota(stringValue) {
			return stringValue, true
		}
		if parsed, err := strconv.ParseFloat(stringValue, 64); err == nil && finite(parsed) {
			return stringValue, true
		}
	}
	if number, ok := qwenNumber(value); ok {
		return formatQwenNumber(number), true
	}
	return "", false
}

func qwenTime(value any) (time.Time, bool) {
	if text, ok := value.(string); ok {
		if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(text)); err == nil {
			return parsed.UTC(), true
		}
	}
	number, ok := qwenNumber(value)
	if !ok || number <= 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(int64(number)).UTC(), true
}

func qwenInt64(value any) (int64, bool) {
	number, ok := qwenNumber(value)
	if !ok || number != float64(int64(number)) {
		return 0, false
	}
	return int64(number), true
}

func formatQwenNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
