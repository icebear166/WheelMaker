package security

import "testing"

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
