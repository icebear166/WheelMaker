package registry

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"sync"
	"time"
)

const (
	registrySessionCookieName = "wm_registry_session"
	webSessionTTL             = 7 * 24 * time.Hour
	maxWebSessions            = 1024
	webSessionRandomBytes     = 32
)

type webSession struct {
	Digest     [32]byte
	CSRFToken  string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
}

type webSessionStore struct {
	mu       sync.Mutex
	sessions map[[32]byte]webSession
	source   io.Reader
	now      func() time.Time
}

func newWebSessionStore(source io.Reader, now func() time.Time) *webSessionStore {
	return &webSessionStore{
		sessions: make(map[[32]byte]webSession),
		source:   source,
		now:      now,
	}
}

func (s *webSessionStore) Create() (string, string, error) {
	raw, err := s.randomValue()
	if err != nil {
		return "", "", err
	}
	csrf, err := s.randomValue()
	if err != nil {
		return "", "", err
	}
	now := s.now()
	digest := sha256.Sum256([]byte(raw))
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeExpiredLocked(now)
	if len(s.sessions) >= maxWebSessions {
		s.removeOldestLocked()
	}
	s.sessions[digest] = webSession{
		Digest:     digest,
		CSRFToken:  csrf,
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  now.Add(webSessionTTL),
	}
	return raw, csrf, nil
}

func (s *webSessionStore) Authenticate(raw string) (webSession, bool) {
	if raw == "" {
		return webSession{}, false
	}
	digest := sha256.Sum256([]byte(raw))
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[digest]
	if !ok || !now.Before(session.ExpiresAt) {
		delete(s.sessions, digest)
		return webSession{}, false
	}
	session.LastSeenAt = now
	s.sessions[digest] = session
	return session, true
}

func (s *webSessionStore) Revoke(raw string) {
	digest := sha256.Sum256([]byte(raw))
	s.mu.Lock()
	delete(s.sessions, digest)
	s.mu.Unlock()
}

func (s *webSessionStore) randomValue() (string, error) {
	raw := make([]byte, webSessionRandomBytes)
	if _, err := io.ReadFull(s.source, raw); err != nil {
		return "", fmt.Errorf("generate web session credential: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (s *webSessionStore) removeExpiredLocked(now time.Time) {
	for digest, session := range s.sessions {
		if !now.Before(session.ExpiresAt) {
			delete(s.sessions, digest)
		}
	}
}

func (s *webSessionStore) removeOldestLocked() {
	var oldestDigest [32]byte
	var oldest time.Time
	for digest, session := range s.sessions {
		if oldest.IsZero() || session.CreatedAt.Before(oldest) {
			oldestDigest = digest
			oldest = session.CreatedAt
		}
	}
	if !oldest.IsZero() {
		delete(s.sessions, oldestDigest)
	}
}
