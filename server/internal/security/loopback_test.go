package security

import (
	"crypto/tls"
	"net/http"
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
