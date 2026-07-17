package tools

import "testing"

func TestParseKimiUsages(t *testing.T) {
	payload := map[string]any{
		"usage": map[string]any{"limit": "100", "remaining": "100", "resetTime": "2026-07-23T15:37:02Z"},
		"limits": []any{
			map[string]any{
				"window": map[string]any{"duration": float64(300), "timeUnit": "TIME_UNIT_MINUTE"},
				"detail": map[string]any{"limit": "100", "used": "2", "remaining": "98", "resetTime": "2026-07-16T20:37:02Z"},
			},
		},
		"parallel":   map[string]any{"limit": "20"},
		"totalQuota": map[string]any{"limit": "100", "remaining": "99"},
	}
	fiveHour, week, err := parseKimiUsages(payload)
	if err != nil {
		t.Fatalf("parseKimiUsages: %v", err)
	}
	if fiveHour == nil || fiveHour.usedPercent != 2 {
		t.Errorf("5h = %+v, want usedPercent=2 (used 2 of 100)", fiveHour)
	}
	if week == nil || week.usedPercent != 0 {
		t.Errorf("week = %+v, want usedPercent=0 (remaining 100 of 100)", week)
	}
	if fiveHour.resetsAt == 0 {
		t.Error("5h resetsAt should be parsed from ISO time")
	}
}

func TestParseKimiUsagesEmpty(t *testing.T) {
	fiveHour, week, err := parseKimiUsages(map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fiveHour != nil || week != nil {
		t.Errorf("empty payload should yield nil windows, got 5h=%+v week=%+v", fiveHour, week)
	}
}
