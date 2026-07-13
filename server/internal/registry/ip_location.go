package registry

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
)

const ipLocationCacheTTL = 7 * 24 * time.Hour

type IPLocationResolver interface {
	ResolveIPLocation(ctx context.Context, ip string) string
}

type cachedIPLocation struct {
	location string
	expires  time.Time
}

type ipWhoisLocationResolver struct {
	client   *http.Client
	endpoint string
	now      func() time.Time

	mu    sync.Mutex
	cache map[string]cachedIPLocation
}

func NewIPWhoisLocationResolver() IPLocationResolver {
	return newIPWhoisLocationResolver(&http.Client{Timeout: 3 * time.Second}, "https://ipwho.is", time.Now)
}

func newIPWhoisLocationResolver(client *http.Client, endpoint string, now func() time.Time) *ipWhoisLocationResolver {
	return &ipWhoisLocationResolver{
		client:   client,
		endpoint: strings.TrimRight(endpoint, "/"),
		now:      now,
		cache:    make(map[string]cachedIPLocation),
	}
}

func (r *ipWhoisLocationResolver) ResolveIPLocation(ctx context.Context, ip string) string {
	if r == nil || r.client == nil || !publicIPAddress(ip) {
		return ""
	}
	now := r.now()
	r.mu.Lock()
	if cached, ok := r.cache[ip]; ok && now.Before(cached.expires) {
		r.mu.Unlock()
		return cached.location
	}
	r.mu.Unlock()

	lookupContext, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(lookupContext, http.MethodGet, r.endpoint+"/"+url.PathEscape(ip), nil)
	if err != nil {
		return ""
	}
	response, err := r.client.Do(request)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ""
	}
	var payload struct {
		Success bool   `json:"success"`
		City    string `json:"city"`
		Region  string `json:"region"`
		Country string `json:"country"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 32*1024)).Decode(&payload); err != nil || !payload.Success {
		return ""
	}
	location := formatIPLocation(payload.City, payload.Region, payload.Country)
	r.mu.Lock()
	r.cache[ip] = cachedIPLocation{location: location, expires: now.Add(ipLocationCacheTTL)}
	r.mu.Unlock()
	return location
}

func publicIPAddress(raw string) bool {
	ip, err := netip.ParseAddr(raw)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast()
}

func formatIPLocation(values ...string) string {
	parts := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		parts = append(parts, value)
	}
	return strings.Join(parts, ", ")
}
