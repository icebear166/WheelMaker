package registry

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWebSessionRestartRestoresPrivateCredentials(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	token := "short-custom-token"
	source := strings.NewReader(strings.Repeat("a", 32) + strings.Repeat("b", 32))
	store := newWebSessionStore(source, func() time.Time { return now }, token, statePath)
	if err := store.Load(); err != nil {
		t.Fatalf("Load(): %v", err)
	}
	raw, csrf, err := store.Create("Work Laptop", "/wheelmaker/")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	if raw == "" || csrf == "" || raw == csrf {
		t.Fatalf("invalid session credentials raw=%q csrf=%q", raw, csrf)
	}

	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("ReadFile(): %v", err)
	}
	for _, secret := range []string{raw, csrf, token} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatalf("session file contains secret %q: %s", secret, data)
		}
	}
	var persisted persistedWebSessionFile
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatalf("Unmarshal(): %v", err)
	}
	if len(persisted.Sessions) != 1 {
		t.Fatalf("persisted sessions=%d, want 1", len(persisted.Sessions))
	}
	record := persisted.Sessions[0]
	if record.Digest == "" || record.DeviceID == "" || record.DeviceName != "Work Laptop" || record.BasePath != "/wheelmaker/" {
		t.Fatalf("persisted session=%+v", record)
	}

	restored := newWebSessionStore(strings.NewReader(""), func() time.Time { return now }, token, statePath)
	if err := restored.Load(); err != nil {
		t.Fatalf("restored Load(): %v", err)
	}
	session, ok := restored.Authenticate(raw)
	if !ok || session.CSRFToken != csrf || session.DeviceID != record.DeviceID || session.DeviceName != "Work Laptop" || session.BasePath != "/wheelmaker/" {
		t.Fatalf("Authenticate() session=%+v ok=%v", session, ok)
	}
	if err := restored.Revoke(raw); err != nil {
		t.Fatalf("Revoke(): %v", err)
	}
	if _, ok := restored.Authenticate(raw); ok {
		t.Fatal("revoked session authenticated")
	}
}

func TestWebSessionSlidesExpirationAndCoalescesPersistence(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "token", statePath)
	writes := 0
	writeFile := store.writeFile
	store.writeFile = func(path string, data []byte) error {
		writes++
		return writeFile(path, data)
	}
	if err := store.Load(); err != nil {
		t.Fatalf("Load(): %v", err)
	}
	raw, _, err := store.Create("Browser", "/")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	createdWrites := writes

	now = now.Add(time.Minute)
	session, ok := store.Authenticate(raw)
	if !ok || !session.ExpiresAt.Equal(now.Add(webSessionTTL)) {
		t.Fatalf("Authenticate() session=%+v ok=%v", session, ok)
	}
	if writes != createdWrites {
		t.Fatalf("touch writes=%d, want coalesced count %d", writes, createdWrites)
	}

	now = now.Add(3 * time.Minute)
	if _, ok := store.Authenticate(raw); !ok {
		t.Fatal("session did not authenticate during coalescing window")
	}
	if writes != createdWrites {
		t.Fatalf("high-frequency touch writes=%d, want %d", writes, createdWrites)
	}

	now = now.Add(2 * time.Minute)
	if _, ok := store.Authenticate(raw); !ok {
		t.Fatal("session did not authenticate after persistence interval")
	}
	if writes != createdWrites+1 {
		t.Fatalf("post-interval touch writes=%d, want %d", writes, createdWrites+1)
	}
}

func TestWebSession180DaySlidingTTL(t *testing.T) {
	if webSessionTTL != 180*24*time.Hour {
		t.Fatalf("webSessionTTL=%s, want 180 days", webSessionTTL)
	}
}

func TestWebSessionStoreExpiresSession(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "token", "")
	raw, _, err := store.Create("Browser", "/")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	now = now.Add(webSessionTTL)
	if _, ok := store.Authenticate(raw); ok {
		t.Fatal("expired session authenticated")
	}
}

func TestWebSessionTokenRotationInvalidatesShortTokens(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "a", statePath)
	if err := store.Load(); err != nil {
		t.Fatalf("Load(): %v", err)
	}
	raw, _, err := store.Create("Browser", "/")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}

	rotated := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "b", statePath)
	if err := rotated.Load(); err != nil {
		t.Fatalf("rotated Load(): %v", err)
	}
	if _, ok := rotated.Authenticate(raw); ok {
		t.Fatal("session survived registry token rotation")
	}
	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("ReadFile(): %v", err)
	}
	var persisted persistedWebSessionFile
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatalf("Unmarshal(): %v", err)
	}
	if persisted.TokenFingerprint != registryTokenFingerprint("b") || len(persisted.Sessions) != 0 {
		t.Fatalf("rotated file=%+v", persisted)
	}
	if bytes.Contains(data, []byte(`"a"`)) || bytes.Contains(data, []byte(`"b"`)) {
		t.Fatalf("rotated file contains raw short token: %s", data)
	}
}

func TestWebSessionCapacityEvictsLeastRecentlySeen(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "token", "")
	var firstRaw, secondRaw string
	for i := 0; i < maxWebSessions; i++ {
		raw, _, err := store.Create("Browser", "/")
		if err != nil {
			t.Fatalf("Create(%d): %v", i, err)
		}
		if i == 0 {
			firstRaw = raw
		}
		if i == 1 {
			secondRaw = raw
		}
		now = now.Add(time.Minute)
	}
	if _, ok := store.Authenticate(firstRaw); !ok {
		t.Fatal("touch first session")
	}
	now = now.Add(time.Minute)
	if _, _, err := store.Create("Overflow", "/"); err != nil {
		t.Fatalf("Create(overflow): %v", err)
	}
	if _, ok := store.Authenticate(firstRaw); !ok {
		t.Fatal("recently touched session was evicted")
	}
	if _, ok := store.Authenticate(secondRaw); ok {
		t.Fatal("least recently seen session was not evicted")
	}
}

func TestWebSessionCorruptFilesFailClosed(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{name: "oversize", data: bytes.Repeat([]byte("x"), (1<<20)+1)},
		{name: "unknown version", data: []byte(`{"version":99,"tokenFingerprint":"x","sessions":[]}`)},
		{name: "invalid json", data: []byte(`{"version":`)},
		{name: "invalid digest", data: []byte(`{"version":1,"tokenFingerprint":"` + registryTokenFingerprint("token") + `","sessions":[{"deviceId":"d","digest":"invalid","deviceName":"Browser","basePath":"/","createdAt":"2026-07-13T12:00:00Z","lastSeenAt":"2026-07-13T12:00:00Z","expiresAt":"2027-01-09T12:00:00Z"}]}`)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
			if err := os.WriteFile(statePath, tt.data, 0o600); err != nil {
				t.Fatalf("WriteFile(): %v", err)
			}
			store := newWebSessionStore(&sequenceReader{}, time.Now, "token", statePath)
			if err := store.Load(); err == nil {
				t.Fatal("Load() succeeded, want fail closed")
			}
			if len(store.sessions) != 0 {
				t.Fatalf("loaded sessions=%d after failure", len(store.sessions))
			}
		})
	}
}

func TestWebSessionPrivatePermissionRepairFailureFailsClosed(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	if err := os.WriteFile(statePath, []byte(`{"version":1,"tokenFingerprint":"x","sessions":[]}`), 0o600); err != nil {
		t.Fatalf("WriteFile(): %v", err)
	}
	store := newWebSessionStore(&sequenceReader{}, time.Now, "token", statePath)
	want := errors.New("permission repair failed")
	store.secureFile = func(string) error { return want }
	if err := store.Load(); !errors.Is(err, want) {
		t.Fatalf("Load() error=%v, want %v", err, want)
	}
}

func TestWebSessionListAndRevokeExposeOnlyPublicDeviceIDs(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "registry-token", "")
	firstRaw, _, err := store.Create("First", "/")
	if err != nil {
		t.Fatalf("Create(first): %v", err)
	}
	first, ok := store.Authenticate(firstRaw)
	if !ok {
		t.Fatal("authenticate first")
	}
	now = now.Add(time.Minute)
	secondRaw, _, err := store.Create("Second", "/wheelmaker/")
	if err != nil {
		t.Fatalf("Create(second): %v", err)
	}
	second, ok := store.Authenticate(secondRaw)
	if !ok {
		t.Fatal("authenticate second")
	}

	listed, err := store.List(first.DeviceID)
	if err != nil {
		t.Fatalf("List(): %v", err)
	}
	if len(listed) != 2 {
		t.Fatalf("List()=%+v, want two sessions", listed)
	}
	encoded, err := json.Marshal(listed)
	if err != nil {
		t.Fatalf("Marshal(): %v", err)
	}
	for _, forbidden := range []string{firstRaw, secondRaw, first.CSRFToken, second.CSRFToken, "registry-token", "digest", "csrf", "token", "cookie", "fingerprint"} {
		if bytes.Contains(bytes.ToLower(encoded), bytes.ToLower([]byte(forbidden))) {
			t.Fatalf("List() leaks %q: %s", forbidden, encoded)
		}
	}
	if revoked, err := store.RevokeDevice(second.DeviceID); err != nil || !revoked {
		t.Fatalf("RevokeDevice() revoked=%t err=%v", revoked, err)
	}
	if _, ok := store.Authenticate(secondRaw); ok {
		t.Fatal("revoked device authenticated")
	}
	if _, ok := store.Authenticate(firstRaw); !ok {
		t.Fatal("unrelated device was revoked")
	}
	if revoked, err := store.RevokeAll(); err != nil || len(revoked) != 1 || revoked[0] != first.DeviceID {
		t.Fatalf("RevokeAll() revoked=%v err=%v", revoked, err)
	}
	if _, ok := store.Authenticate(firstRaw); ok {
		t.Fatal("revokeAll left a session active")
	}
}

type sequenceReader struct {
	next uint64
}

func (r *sequenceReader) Read(p []byte) (int, error) {
	r.next++
	for i := range p {
		p[i] = byte(r.next >> (8 * (i % 8)))
	}
	return len(p), nil
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
