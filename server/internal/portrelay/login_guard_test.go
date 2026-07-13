package portrelay

import (
	"fmt"
	"testing"
	"time"
)

func TestLoginGuardAppliesSourceAndGenerationBuckets(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	guard := newLoginGuard(func() time.Time { return now })
	guard.reset(1)

	for attempt := 1; attempt <= relaySourceBurst; attempt++ {
		limited, retryAfter := guard.recordFailure("203.0.113.10", 1)
		if limited || retryAfter != 0 {
			t.Fatalf("source attempt %d limited=%v retry=%s", attempt, limited, retryAfter)
		}
	}
	limited, retryAfter := guard.recordFailure("203.0.113.10", 1)
	if !limited || retryAfter != relayLoginRefillInterval {
		t.Fatalf("source overflow limited=%v retry=%s, want true/%s", limited, retryAfter, relayLoginRefillInterval)
	}

	now = now.Add(relayLoginRefillInterval)
	limited, retryAfter = guard.recordFailure("203.0.113.10", 1)
	if limited || retryAfter != 0 {
		t.Fatalf("refilled source limited=%v retry=%s", limited, retryAfter)
	}

	guard.reset(2)
	for attempt := 0; attempt < relayGenerationBurst; attempt++ {
		limited, retryAfter = guard.recordFailure(fmt.Sprintf("203.0.113.%d", attempt+1), 2)
		if limited || retryAfter != 0 {
			t.Fatalf("generation attempt %d limited=%v retry=%s", attempt+1, limited, retryAfter)
		}
	}
	limited, retryAfter = guard.recordFailure("198.51.100.1", 2)
	if !limited || retryAfter != relayLoginRefillInterval {
		t.Fatalf("generation overflow limited=%v retry=%s, want true/%s", limited, retryAfter, relayLoginRefillInterval)
	}
}

func TestLoginGuardSuccessAndGenerationResetClearState(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	guard := newLoginGuard(func() time.Time { return now })
	guard.reset(1)

	for attempt := 0; attempt < relaySourceBurst; attempt++ {
		guard.recordFailure("203.0.113.20", 1)
	}
	guard.recordSuccess("203.0.113.20")
	if limited, _ := guard.recordFailure("203.0.113.20", 1); limited {
		t.Fatal("successful login did not clear the source bucket")
	}

	for attempt := 0; attempt < relayGenerationBurst; attempt++ {
		guard.recordFailure(fmt.Sprintf("198.51.100.%d", attempt+1), 1)
	}
	guard.reset(2)
	if limited, _ := guard.recordFailure("198.51.100.250", 2); limited {
		t.Fatal("new generation did not clear global and source limits")
	}
}

func TestLoginGuardBoundsAndExpiresSourceState(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	guard := newLoginGuard(func() time.Time { return now })
	guard.reset(1)

	for index := 0; index < relayLoginMaxSources+1; index++ {
		guard.recordFailure(fmt.Sprintf("source-%04d", index), 1)
		now = now.Add(time.Millisecond)
	}
	if got := len(guard.sources); got != relayLoginMaxSources {
		t.Fatalf("source count=%d, want %d", got, relayLoginMaxSources)
	}
	if _, exists := guard.sources["source-0000"]; exists {
		t.Fatal("oldest source was not evicted")
	}

	now = now.Add(relayLoginSourceTTL + time.Second)
	guard.recordFailure("fresh-source", 1)
	if got := len(guard.sources); got != 1 {
		t.Fatalf("expired source count=%d, want 1", got)
	}
}
