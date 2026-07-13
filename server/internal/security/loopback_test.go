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

func TestOriginAllowedUsesExactOrigin(t *testing.T) {
	allowed := []string{"https://wheelmaker.example.com", "https://wheelmaker.example.com:8443"}
	for _, origin := range []string{"https://wheelmaker.example.com", "https://WHEELMAKER.EXAMPLE.COM:443", "https://wheelmaker.example.com:8443"} {
		if !OriginAllowed(origin, allowed) {
			t.Fatalf("OriginAllowed(%q)=false", origin)
		}
	}
	for _, origin := range []string{
		"http://wheelmaker.example.com",
		"https://wheelmaker.example.com.attacker.test",
		"https://wheelmaker.example.com@attacker.test",
		"https://wheelmaker.example.com:9443",
		"https://wheelmaker.example.com/path",
	} {
		if OriginAllowed(origin, allowed) {
			t.Fatalf("OriginAllowed(%q)=true", origin)
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
