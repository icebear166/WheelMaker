package security

import (
	"reflect"
	"testing"
)

func TestRedactDiagnosticValueRedactsNestedAndObfuscatedSecretKeys(t *testing.T) {
	original := map[string]any{
		"registryToken": "registry-secret",
		"nested": []any{map[string]any{
			"api_key":       "api-secret",
			"set-cookie":    "cookie-secret",
			"error_details": map[string]any{"app.secret": "app-secret", "credential": "credential-secret"},
		}},
		"tokenCount":           12,
		"inputTokens":          8,
		"output_tokens":        4,
		"accessCodeGeneration": 3,
	}

	got := RedactDiagnosticValue(original)
	want := map[string]any{
		"registryToken": RedactedValue,
		"nested": []any{map[string]any{
			"api_key":       RedactedValue,
			"set-cookie":    RedactedValue,
			"error_details": map[string]any{"app.secret": RedactedValue, "credential": RedactedValue},
		}},
		"tokenCount":           12,
		"inputTokens":          8,
		"output_tokens":        4,
		"accessCodeGeneration": 3,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RedactDiagnosticValue() = %#v, want %#v", got, want)
	}
	if original["registryToken"] != "registry-secret" {
		t.Fatalf("redactor mutated input: %#v", original)
	}
}

func TestRedactDiagnosticValueTerminatesAtDepthAndNodeLimits(t *testing.T) {
	deep := map[string]any{"value": "root"}
	cursor := deep
	for i := 0; i < 32; i++ {
		next := map[string]any{"value": i}
		cursor["next"] = next
		cursor = next
	}

	wide := make([]any, 10_100)
	for i := range wide {
		wide[i] = map[string]any{"value": i}
	}

	got := RedactDiagnosticValue(map[string]any{"deep": deep, "wide": wide})
	if got == nil {
		t.Fatal("redactor returned nil at safety limits")
	}
}
