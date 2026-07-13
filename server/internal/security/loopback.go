package security

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// RequireLoopbackAddress rejects listeners that may bind a non-loopback interface.
func RequireLoopbackAddress(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid listen address %q: %w", addr, err)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("listen host must be loopback: %q", host)
	}
	return nil
}

// OriginAllowed compares a browser Origin against an exact configured allowlist.
func OriginAllowed(origin string, allowed []string) bool {
	normalized, ok := normalizeOrigin(origin)
	if !ok {
		return false
	}
	for _, candidate := range allowed {
		if candidateOrigin, valid := normalizeOrigin(candidate); valid && candidateOrigin == normalized {
			return true
		}
	}
	return false
}

func normalizeOrigin(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", false
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	hostname := strings.ToLower(u.Hostname())
	if hostname == "" {
		return "", false
	}
	port := u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host = net.JoinHostPort(hostname, port)
	}
	return strings.ToLower(u.Scheme) + "://" + host, true
}

// IsTrustedProxyRequest reports whether the immediate peer is loopback.
func IsTrustedProxyRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	return remoteIP(r.RemoteAddr).IsLoopback()
}

// RequestIsHTTPS accepts forwarded protocol only from a loopback reverse proxy.
func RequestIsHTTPS(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	if !IsTrustedProxyRequest(r) {
		return false
	}
	forwarded := strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]
	return strings.EqualFold(strings.TrimSpace(forwarded), "https")
}

// ClientIP returns a trusted proxy client address or the immediate peer address.
func ClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if IsTrustedProxyRequest(r) {
		if forwarded := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); forwarded != nil {
			return forwarded.String()
		}
	}
	if ip := remoteIP(r.RemoteAddr); ip != nil {
		return ip.String()
	}
	return ""
}

func remoteIP(addr string) net.IP {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return net.ParseIP(addr)
	}
	return net.ParseIP(host)
}
