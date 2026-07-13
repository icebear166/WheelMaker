package registry

import (
	"strings"
	"testing"
	"time"
)

func TestWebSessionStoreCreatesAuthenticatesAndRevokesSession(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	source := strings.NewReader(strings.Repeat("a", 32) + strings.Repeat("b", 32))
	store := newWebSessionStore(source, func() time.Time { return now })
	raw, csrf, err := store.Create()
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	if raw == "" || csrf == "" || raw == csrf {
		t.Fatalf("invalid session credentials raw=%q csrf=%q", raw, csrf)
	}
	session, ok := store.Authenticate(raw)
	if !ok || session.CSRFToken != csrf {
		t.Fatalf("Authenticate() session=%+v ok=%v", session, ok)
	}
	store.Revoke(raw)
	if _, ok := store.Authenticate(raw); ok {
		t.Fatal("revoked session authenticated")
	}
}

func TestWebSessionStoreExpiresSession(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	store := newWebSessionStore(strings.NewReader(strings.Repeat("b", 64)), func() time.Time { return now })
	raw, _, err := store.Create()
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	now = now.Add(webSessionTTL)
	if _, ok := store.Authenticate(raw); ok {
		t.Fatal("expired session authenticated")
	}
}

func TestLoginLimiterThrottlesSourceAndRefills(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(func() time.Time { return now })
	for attempt := 1; attempt <= 5; attempt++ {
		if allowed, _ := limiter.Allow("203.0.113.9"); !allowed {
			t.Fatalf("attempt %d denied", attempt)
		}
	}
	if allowed, retry := limiter.Allow("203.0.113.9"); allowed || retry <= 0 {
		t.Fatalf("sixth attempt allowed=%v retry=%v", allowed, retry)
	}
	now = now.Add(loginTokenRefill)
	if allowed, _ := limiter.Allow("203.0.113.9"); !allowed {
		t.Fatal("source did not refill")
	}
}

func TestLoginLimiterAppliesGlobalLimit(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(func() time.Time { return now })
	for attempt := 0; attempt < globalLoginBurst; attempt++ {
		if allowed, _ := limiter.Allow(string(rune('a' + attempt))); !allowed {
			t.Fatalf("global attempt %d denied", attempt+1)
		}
	}
	if allowed, _ := limiter.Allow("overflow"); allowed {
		t.Fatal("global overflow attempt allowed")
	}
}
