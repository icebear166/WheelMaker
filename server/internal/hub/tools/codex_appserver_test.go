package tools

import (
	"testing"
)

func TestParseCodexRateLimitsResponse(t *testing.T) {
	payload := map[string]any{
		"rateLimits": map[string]any{
			"primary":   map[string]any{"usedPercent": float64(23), "windowDurationMins": float64(10080), "resetsAt": float64(1784780541)},
			"secondary": map[string]any{"usedPercent": float64(2), "windowDurationMins": float64(300), "resetsAt": float64(1784226236)},
		},
	}
	fiveHour, week, err := parseCodexRateLimits(payload)
	if err != nil {
		t.Fatalf("parseCodexRateLimits: %v", err)
	}
	if fiveHour == nil || fiveHour.usedPercent != 2 {
		t.Errorf("5h = %+v, want usedPercent=2", fiveHour)
	}
	if week == nil || week.usedPercent != 23 {
		t.Errorf("week = %+v, want usedPercent=23", week)
	}
	if fiveHour.resetsAt != 1784226236 {
		t.Errorf("5h resetsAt = %d, want 1784226236", fiveHour.resetsAt)
	}
}

func TestParseCodexRateLimitsMissingWindow(t *testing.T) {
	payload := map[string]any{
		"rateLimits": map[string]any{
			"primary": map[string]any{"usedPercent": float64(50), "windowDurationMins": float64(10080)},
		},
	}
	fiveHour, week, err := parseCodexRateLimits(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fiveHour != nil {
		t.Errorf("5h should be nil when only week window present, got %+v", fiveHour)
	}
	if week == nil || week.usedPercent != 50 {
		t.Errorf("week window not parsed correctly: %+v", week)
	}
}

func TestParseCodexRateLimitsNoRateLimits(t *testing.T) {
	payload := map[string]any{"other": "stuff"}
	_, _, err := parseCodexRateLimits(payload)
	if err == nil {
		t.Error("expected error when rateLimits missing")
	}
}
