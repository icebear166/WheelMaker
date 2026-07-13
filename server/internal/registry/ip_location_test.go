package registry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIPWhoisLocationResolverCachesSuccessfulLookup(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/8.8.8.8" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"success":true,"city":"Mountain View","region":"California","country":"United States"}`))
	}))
	defer server.Close()

	now := time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC)
	resolver := newIPWhoisLocationResolver(server.Client(), server.URL, func() time.Time { return now })
	for range 2 {
		if got := resolver.ResolveIPLocation(context.Background(), "8.8.8.8"); got != "Mountain View, California, United States" {
			t.Fatalf("ResolveIPLocation()=%q", got)
		}
	}
	if calls != 1 {
		t.Fatalf("calls=%d, want one cached lookup", calls)
	}
}
