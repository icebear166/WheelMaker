package security

import (
	"crypto/rand"
	"crypto/tls"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestRequireLoopbackAddress(t *testing.T) {
	tests := []struct {
		addr string
		ok   bool
	}{
		{addr: "127.0.0.1:9630", ok: true},
		{addr: "localhost:9630", ok: true},
		{addr: "[::1]:9630", ok: true},
		{addr: ":9630"},
		{addr: "0.0.0.0:9630"},
		{addr: "[::]:9630"},
		{addr: "192.168.1.10:9630"},
		{addr: "registry.example.com:9630"},
	}
	for _, tt := range tests {
		t.Run(tt.addr, func(t *testing.T) {
			err := RequireLoopbackAddress(tt.addr)
			if tt.ok && err != nil {
				t.Fatalf("RequireLoopbackAddress(%q): %v", tt.addr, err)
			}
			if !tt.ok && err == nil {
				t.Fatalf("RequireLoopbackAddress(%q) succeeded", tt.addr)
			}
		})
	}
}

func TestRequestOriginMatchesHostUsesExactSameOrigin(t *testing.T) {
	request := &http.Request{
		Host:       "wheelmaker.example.com",
		RemoteAddr: "127.0.0.1:50000",
		Header: http.Header{
			"Origin":            []string{"https://wheelmaker.example.com"},
			"X-Forwarded-Proto": []string{"https"},
		},
	}
	if !RequestOriginMatchesHost(request) {
		t.Fatal("same-origin request was rejected")
	}
	for _, origin := range []string{
		"http://wheelmaker.example.com",
		"https://wheelmaker.example.com.attacker.test",
		"https://wheelmaker.example.com@attacker.test",
		"https://wheelmaker.example.com:9443",
		"https://wheelmaker.example.com/path",
	} {
		request.Header.Set("Origin", origin)
		if RequestOriginMatchesHost(request) {
			t.Fatalf("cross-origin request %q was accepted", origin)
		}
	}
}

func TestForwardedHeadersAreTrustedOnlyFromLoopbackProxy(t *testing.T) {
	proxied := &http.Request{
		RemoteAddr: "127.0.0.1:50000",
		Header: http.Header{
			"X-Forwarded-Proto": []string{"https"},
			"X-Real-Ip":         []string{"203.0.113.9"},
		},
	}
	if !RequestIsHTTPS(proxied) {
		t.Fatal("trusted proxy https header was ignored")
	}
	if got := ClientIP(proxied); got != "203.0.113.9" {
		t.Fatalf("ClientIP(proxied)=%q", got)
	}

	untrusted := proxied.Clone(proxied.Context())
	untrusted.RemoteAddr = "198.51.100.7:50000"
	if RequestIsHTTPS(untrusted) {
		t.Fatal("untrusted forwarded proto was accepted")
	}
	if got := ClientIP(untrusted); got != "198.51.100.7" {
		t.Fatalf("ClientIP(untrusted)=%q", got)
	}

	directTLS := &http.Request{RemoteAddr: "198.51.100.8:443", Header: http.Header{}, TLS: &tls.ConnectionState{}}
	if !RequestIsHTTPS(directTLS) {
		t.Fatal("direct TLS request was not recognized")
	}
}

func TestBrowserWriteRequiresSameOriginFetchMetadata(t *testing.T) {
	base := &http.Request{
		Host:       "wheelmaker.example.com",
		RemoteAddr: "127.0.0.1:50000",
		Header: http.Header{
			"Origin":            []string{"https://wheelmaker.example.com"},
			"X-Forwarded-Proto": []string{"https"},
		},
	}
	tests := []struct {
		name      string
		origin    string
		fetchSite string
		fetchMode string
		ok        bool
	}{
		{name: "metadata omitted", origin: "https://wheelmaker.example.com", ok: true},
		{name: "same origin cors", origin: "https://wheelmaker.example.com", fetchSite: "same-origin", fetchMode: "cors", ok: true},
		{name: "same origin mode", origin: "https://wheelmaker.example.com", fetchSite: "same-origin", fetchMode: "same-origin", ok: true},
		{name: "missing origin", ok: false},
		{name: "cross origin", origin: "https://attacker.example", fetchSite: "same-origin", fetchMode: "cors", ok: false},
		{name: "cross site metadata", origin: "https://wheelmaker.example.com", fetchSite: "cross-site", fetchMode: "cors", ok: false},
		{name: "same site metadata", origin: "https://wheelmaker.example.com", fetchSite: "same-site", fetchMode: "cors", ok: false},
		{name: "navigate mode", origin: "https://wheelmaker.example.com", fetchSite: "same-origin", fetchMode: "navigate", ok: false},
		{name: "no cors mode", origin: "https://wheelmaker.example.com", fetchSite: "same-origin", fetchMode: "no-cors", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := base.Clone(base.Context())
			request.Header = base.Header.Clone()
			request.Header.Set("Origin", tt.origin)
			request.Header.Set("Sec-Fetch-Site", tt.fetchSite)
			request.Header.Set("Sec-Fetch-Mode", tt.fetchMode)
			if got := BrowserWriteRequestAllowed(request); got != tt.ok {
				t.Fatalf("BrowserWriteRequestAllowed()=%t, want %t", got, tt.ok)
			}
		})
	}
}

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

func TestRedactDiagnosticValueRedactsAPIKeysContainer(t *testing.T) {
	input := map[string]any{
		"api_keys": map[string]any{
			"kimi":    "kimi-test-secret",
			"qwen":    "qwen-test-secret",
			"zai":     "zai-test-secret",
			"flicker": "flicker-test-secret",
		},
	}
	want := map[string]any{"api_keys": RedactedValue}
	if got := RedactDiagnosticValue(input); !reflect.DeepEqual(got, want) {
		t.Fatalf("RedactDiagnosticValue() = %#v, want %#v", got, want)
	}

	type configWithAPIKeys struct {
		APIKeys map[string]string `json:"api_keys"`
	}
	structInput := configWithAPIKeys{APIKeys: map[string]string{
		"kimi":    "kimi-test-secret",
		"qwen":    "qwen-test-secret",
		"zai":     "zai-test-secret",
		"flicker": "flicker-test-secret",
	}}
	if got := RedactDiagnosticValue(structInput); !reflect.DeepEqual(got, want) {
		t.Fatalf("RedactDiagnosticValue(struct) = %#v, want %#v", got, want)
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

func TestNewRegistryTokenCreatesIndependentValues(t *testing.T) {
	first, err := NewRegistryToken(rand.Reader)
	if err != nil {
		t.Fatalf("NewRegistryToken(first): %v", err)
	}
	second, err := NewRegistryToken(rand.Reader)
	if err != nil {
		t.Fatalf("NewRegistryToken(second): %v", err)
	}
	if len(first) != 43 || len(second) != 43 {
		t.Fatalf("token lengths=%d/%d, want 43/43", len(first), len(second))
	}
	if first == second {
		t.Fatal("independent token generations returned the same value")
	}
}

func TestNewRegistryTokenReturnsRandomSourceFailure(t *testing.T) {
	want := errors.New("random source unavailable")
	_, err := NewRegistryToken(errorReader{err: want})
	if !errors.Is(err, want) {
		t.Fatalf("NewRegistryToken() error=%v, want wrapped %v", err, want)
	}
}

type errorReader struct {
	err error
}

func (r errorReader) Read([]byte) (int, error) {
	return 0, r.err
}

var _ io.Reader = errorReader{}

func TestValidateRegistryTokenRejectsUnsafeValues(t *testing.T) {
	for _, token := range []string{"", "   ", "wheelmaker-local-token"} {
		err := ValidateRegistryToken(token)
		if err == nil {
			t.Fatalf("ValidateRegistryToken(%q) succeeded, want rejection", token)
		}
		if err.Error() != "token must be a non-default value" {
			t.Fatalf("ValidateRegistryToken(%q) error=%q, want top-level token field", token, err)
		}
	}
}

func TestValidateRegistryTokenAcceptsGeneratedAndShortCustomValues(t *testing.T) {
	for _, token := range []string{strings.Repeat("a", 43), "short-custom"} {
		if err := ValidateRegistryToken(token); err != nil {
			t.Fatalf("ValidateRegistryToken(%q) error=%v", token, err)
		}
	}
}

func TestNormalizeHTTPSBaseURL(t *testing.T) {
	tests := []struct {
		raw        string
		normalized string
		ok         bool
	}{
		{raw: "https://example.com", normalized: "https://example.com/", ok: true},
		{raw: "https://example.com:8443/wheelmaker", normalized: "https://example.com:8443/wheelmaker/", ok: true},
		{raw: "https://127.0.0.1/app/", normalized: "https://127.0.0.1/app/", ok: true},
		{raw: "https://example.com/a%20b", normalized: "https://example.com/a%20b/", ok: true},
		{raw: "http://example.com/", ok: false},
		{raw: "https://user@example.com/", ok: false},
		{raw: "https://example.com/?x=1", ok: false},
		{raw: "https://example.com/#x", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			got, err := NormalizeHTTPSBaseURL(tt.raw)
			if !tt.ok {
				if err == nil {
					t.Fatalf("NormalizeHTTPSBaseURL(%q)=%q, want rejection", tt.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeHTTPSBaseURL(%q) error=%v", tt.raw, err)
			}
			if got.String() != tt.normalized {
				t.Fatalf("NormalizeHTTPSBaseURL(%q)=%q, want %q", tt.raw, got, tt.normalized)
			}
		})
	}
}
