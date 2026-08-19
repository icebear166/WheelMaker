package usage

import "time"

type ProviderID string

const (
	ProviderCodex    ProviderID = "codex"
	ProviderFlicker  ProviderID = "flicker"
	ProviderKimi     ProviderID = "kimi"
	ProviderZAI      ProviderID = "zai"
	ProviderDeepSeek ProviderID = "deepseek"
	ProviderQwen     ProviderID = "qwen"
)

func IsKnownProviderID(id ProviderID) bool {
	switch id {
	case ProviderCodex, ProviderFlicker, ProviderKimi, ProviderZAI, ProviderDeepSeek, ProviderQwen:
		return true
	default:
		return false
	}
}

type ProviderStatus string

const (
	ProviderOK          ProviderStatus = "ok"
	ProviderUnavailable ProviderStatus = "unavailable"
	ProviderError       ProviderStatus = "error"
)

type WindowKind string

const (
	WindowFixed         WindowKind = "fixed"
	WindowCalendarMonth WindowKind = "calendarMonth"
)

type Limit struct {
	ID                 string     `json:"id"`
	Label              string     `json:"label"`
	RemainingPercent   float64    `json:"remainingPercent"`
	WindowKind         WindowKind `json:"windowKind"`
	WindowDurationMins int64      `json:"windowDurationMins,omitempty"`
	ResetsAt           *time.Time `json:"resetsAt,omitempty"`
}

type Identity struct {
	Kind  string `json:"kind,omitempty"`
	Value string `json:"value,omitempty"`
	Label string `json:"label,omitempty"`
}

type BalanceItem struct {
	Currency string `json:"currency"`
	Total    string `json:"total"`
	Granted  string `json:"granted,omitempty"`
	ToppedUp string `json:"toppedUp,omitempty"`
}

type Balance struct {
	IsAvailable bool          `json:"isAvailable"`
	Items       []BalanceItem `json:"items"`
}

type ResetCredit struct {
	ID        string     `json:"id,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type ResetCredits struct {
	AvailableCount int           `json:"availableCount"`
	Credits        []ResetCredit `json:"credits,omitempty"`
}

type Account struct {
	LocalID      string         `json:"localId"`
	Identity     Identity       `json:"identity"`
	Status       ProviderStatus `json:"status"`
	Plan         string         `json:"plan,omitempty"`
	Message      string         `json:"message,omitempty"`
	Limits       []Limit        `json:"limits"`
	Balance      *Balance       `json:"balance,omitempty"`
	ResetCredits *ResetCredits  `json:"resetCredits,omitempty"`
	Qwen         *QwenUsageData `json:"qwen,omitempty"`
}

type ProviderSnapshot struct {
	ID            ProviderID     `json:"id"`
	Name          string         `json:"name"`
	Status        ProviderStatus `json:"status"`
	Message       string         `json:"message,omitempty"`
	Remove        bool           `json:"remove,omitempty"`
	Authenticated bool           `json:"authenticated"`
	Accounts      []Account      `json:"accounts"`
}

type ScanStatus string

const (
	ScanIdle     ScanStatus = "idle"
	ScanScanning ScanStatus = "scanning"
	ScanReady    ScanStatus = "ready"
	ScanError    ScanStatus = "error"
)

type Snapshot struct {
	HubID      string             `json:"hubId"`
	Generation uint64             `json:"generation"`
	Status     ScanStatus         `json:"status"`
	StartedAt  *time.Time         `json:"startedAt,omitempty"`
	UpdatedAt  *time.Time         `json:"updatedAt,omitempty"`
	NextScanAt *time.Time         `json:"nextScanAt,omitempty"`
	Message    string             `json:"message,omitempty"`
	Providers  []ProviderSnapshot `json:"providers"`
}
