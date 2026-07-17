package tools

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// toInt64 converts a JSON-decoded any value to int64. Handles float64 (the
// default JSON number type), json.Number, and numeric strings. Returns 0 on
// any non-finite or unparseable input.
func toInt64(v any) int64 {
	switch typed := v.(type) {
	case float64:
		if !math.IsNaN(typed) && !math.IsInf(typed, 0) {
			return int64(typed)
		}
	case json.Number:
		if n, err := typed.Int64(); err == nil {
			return n
		}
	case int:
		return int64(typed)
	case int64:
		return typed
	case string:
		if n, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil {
			return n
		}
	}
	return 0
}

// parseFloat64 parses a numeric string into float64. Returns 0 on error.
func parseFloat64(s string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}
	return f
}
