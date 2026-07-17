package tools

import "testing"

func TestParseZAIQuotaLimit(t *testing.T) {
	payload := map[string]any{
		"code": float64(200),
		"data": map[string]any{
			"level": "pro",
			"limits": []any{
				map[string]any{"type": "TOKENS_LIMIT", "unit": float64(3), "number": float64(5), "percentage": float64(72), "nextResetTime": float64(1784226236151)},
				map[string]any{"type": "TOKENS_LIMIT", "unit": float64(6), "number": float64(1), "percentage": float64(50), "nextResetTime": float64(1784774559950)},
				map[string]any{"type": "TIME_LIMIT", "unit": float64(5), "number": float64(1), "usage": float64(1000), "currentValue": float64(21), "remaining": float64(979), "percentage": float64(2), "nextResetTime": float64(1786848159997)},
			},
		},
	}
	fiveHour, week, mcp, level, err := parseZAIQuotaLimit(payload)
	if err != nil {
		t.Fatalf("parseZAIQuotaLimit: %v", err)
	}
	if fiveHour == nil || fiveHour.usedPercent != 72 {
		t.Errorf("5h = %+v, want usedPercent=72", fiveHour)
	}
	if week == nil || week.usedPercent != 50 {
		t.Errorf("week = %+v, want usedPercent=50", week)
	}
	if mcp == nil || mcp.usedPercent != 2 {
		t.Errorf("mcp = %+v, want usedPercent=2 (21 of 1000)", mcp)
	}
	if level != "pro" {
		t.Errorf("level = %q, want pro", level)
	}
	if fiveHour.resetsAt != 1784226236 {
		t.Errorf("5h resetsAt = %d, want 1784226236 (ms→s)", fiveHour.resetsAt)
	}
}

func TestParseZAIQuotaLimitEmpty(t *testing.T) {
	fiveHour, week, mcp, level, err := parseZAIQuotaLimit(map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fiveHour != nil || week != nil || mcp != nil {
		t.Errorf("empty payload should yield nil windows")
	}
	if level != "" {
		t.Errorf("level = %q, want empty", level)
	}
}
