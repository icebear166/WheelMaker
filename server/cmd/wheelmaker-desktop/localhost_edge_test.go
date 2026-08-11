package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestDesktopLocalhostStatePersistsPrivateBasePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".wheelmaker", "desktop", "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)

	first, err := store.LoadOrCreate()
	if err != nil {
		t.Fatalf("LoadOrCreate first: %v", err)
	}
	if !validDesktopLocalhostBasePath(first.BasePath) {
		t.Fatalf("generated Base Path is invalid: %q", first.BasePath)
	}
	if first.SessionCookie != "" || !first.SessionExpiresAt.IsZero() {
		t.Fatalf("new state unexpectedly has a session: %+v", first)
	}

	restarted, err := newFileDesktopLocalhostStateStore(path).LoadOrCreate()
	if err != nil {
		t.Fatalf("LoadOrCreate restart: %v", err)
	}
	if restarted.BasePath != first.BasePath {
		t.Fatalf("restart Base Path=%q, want %q", restarted.BasePath, first.BasePath)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("state mode=%#o, want 0600", info.Mode().Perm())
		}
	}
}

func TestDesktopLocalhostCredentialLifecycle(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "desktop", "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{
		Name:     desktopRegistrySessionCookieName,
		Value:    strings.Repeat("A", 43),
		Path:     state.BasePath,
		Expires:  now.Add(24 * time.Hour),
		MaxAge:   int((24 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	}
	if err := store.SaveSession(cookie); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	restored, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if restored.BasePath != state.BasePath || restored.SessionCookie != cookie.Value || !restored.SessionExpiresAt.Equal(cookie.Expires) {
		t.Fatalf("restored state=%+v", restored)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"registry-token", "csrf-secret", desktopRegistrySessionCookieName} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("state file contains forbidden value %q", forbidden)
		}
	}

	if err := store.ClearSession(); err != nil {
		t.Fatalf("ClearSession: %v", err)
	}
	cleared, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if cleared.BasePath != state.BasePath || cleared.SessionCookie != "" || !cleared.SessionExpiresAt.IsZero() {
		t.Fatalf("cleared state=%+v", cleared)
	}

	if err := store.Delete(); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("state file still exists: %v", err)
	}
}

func TestDesktopLocalhostStateDropsExpiredSession(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSession(&http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("B", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)

	restored, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if restored.BasePath != state.BasePath || restored.SessionCookie != "" || !restored.SessionExpiresAt.IsZero() {
		t.Fatalf("expired session did not fail closed: %+v", restored)
	}
}

func TestDesktopLocalhostStateRejectsCorruptFiles(t *testing.T) {
	validBasePath := "/wm-local-" + strings.Repeat("A", 43) + "/"
	tests := []struct {
		name string
		raw  string
	}{
		{name: "malformed JSON", raw: "{"},
		{name: "unknown field", raw: `{"version":1,"basePath":"` + validBasePath + `","extra":true}`},
		{name: "wrong version", raw: `{"version":2,"basePath":"` + validBasePath + `"}`},
		{name: "unsafe Base Path", raw: `{"version":1,"basePath":"/../secret/"}`},
		{name: "partial session", raw: `{"version":1,"basePath":"` + validBasePath + `","sessionCookie":"` + strings.Repeat("A", 43) + `"}`},
		{name: "oversized", raw: strings.Repeat("x", desktopLocalhostStateMaxBytes+1)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "localhost-state.json")
			if err := os.WriteFile(path, []byte(tt.raw), 0o600); err != nil {
				t.Fatal(err)
			}
			if state, err := newFileDesktopLocalhostStateStore(path).LoadOrCreate(); err == nil {
				t.Fatalf("LoadOrCreate=%+v, want corrupt state rejection", state)
			}
		})
	}
}

func TestDesktopLocalhostCredentialRejectsInvalidCookies(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	valid := http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("C", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}
	tests := []struct {
		name   string
		mutate func(*http.Cookie)
	}{
		{name: "wrong name", mutate: func(cookie *http.Cookie) { cookie.Name = "other" }},
		{name: "wrong path", mutate: func(cookie *http.Cookie) { cookie.Path = "/" }},
		{name: "not secure", mutate: func(cookie *http.Cookie) { cookie.Secure = false }},
		{name: "not HTTP only", mutate: func(cookie *http.Cookie) { cookie.HttpOnly = false }},
		{name: "wrong SameSite", mutate: func(cookie *http.Cookie) { cookie.SameSite = http.SameSiteLaxMode }},
		{name: "deleted", mutate: func(cookie *http.Cookie) { cookie.MaxAge = -1 }},
		{name: "expired", mutate: func(cookie *http.Cookie) { cookie.Expires = now }},
		{name: "invalid value", mutate: func(cookie *http.Cookie) { cookie.Value = "bad\nvalue" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cookie := valid
			tt.mutate(&cookie)
			if err := store.SaveSession(&cookie); err == nil {
				t.Fatal("SaveSession accepted an invalid Registry cookie")
			}
		})
	}
}
