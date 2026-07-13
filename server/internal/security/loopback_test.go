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
