package registry

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

const (
	registrySessionCookieName   = "wm_registry_session"
	webSessionTTL               = 180 * 24 * time.Hour
	webSessionPersistInterval   = 5 * time.Minute
	maxWebSessions              = 1024
	webSessionRandomBytes       = 32
	defaultWebSessionDeviceName = "Browser"
)

var errInvalidWebSessionMetadata = errors.New("invalid web session metadata")

type webSession struct {
	DeviceID   string
	Digest     [32]byte
	DeviceName string
	BasePath   string
	CSRFToken  string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
}

type webSessionStore struct {
	mu              sync.Mutex
	sessions        map[[32]byte]webSession
	source          io.Reader
	now             func() time.Time
	registryToken   string
	filePath        string
	lastPersistedAt time.Time
	writeFile       func(string, []byte) error
	secureFile      func(string) error
}

func newWebSessionStore(source io.Reader, now func() time.Time, registryToken, filePath string) *webSessionStore {
	return &webSessionStore{
		sessions:      make(map[[32]byte]webSession),
		source:        source,
		now:           now,
		registryToken: registryToken,
		filePath:      filePath,
		writeFile:     writeWebSessionFile,
		secureFile:    secureWebSessionFile,
	}
}

func (s *webSessionStore) Create(deviceName, basePath string) (string, string, error) {
	deviceName = strings.TrimSpace(deviceName)
	if deviceName == "" {
		deviceName = defaultWebSessionDeviceName
	}
	if !validRegistryBasePath(basePath) {
		return "", "", errInvalidWebSessionMetadata
	}
	raw, err := s.randomValue()
	if err != nil {
		return "", "", err
	}
	deviceID, err := s.randomValue()
	if err != nil {
		return "", "", err
	}
	now := s.now()
	digest := sha256.Sum256([]byte(raw))
	session := webSession{
		DeviceID:   deviceID,
		Digest:     digest,
		DeviceName: deviceName,
		BasePath:   basePath,
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  now.Add(webSessionTTL),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	previous := cloneWebSessions(s.sessions)
	s.removeExpiredLocked(now)
	if len(s.sessions) >= maxWebSessions {
		s.removeOldestLocked()
	}
	s.sessions[digest] = session
	if err := s.persistLocked(now); err != nil {
		s.sessions = previous
		return "", "", err
	}
	return raw, deriveSessionCSRF(s.registryToken, raw), nil
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
	if !ok {
		return webSession{}, false
	}
	if !now.Before(session.ExpiresAt) {
		delete(s.sessions, digest)
		_ = s.persistLocked(now)
		return webSession{}, false
	}
	previous := session
	session.LastSeenAt = now
	session.ExpiresAt = now.Add(webSessionTTL)
	s.sessions[digest] = session
	if s.lastPersistedAt.IsZero() || now.Sub(s.lastPersistedAt) >= webSessionPersistInterval {
		if err := s.persistLocked(now); err != nil {
			s.sessions[digest] = previous
			return webSession{}, false
		}
	}
	session.CSRFToken = deriveSessionCSRF(s.registryToken, raw)
	return session, true
}

func (s *webSessionStore) Revoke(raw string) error {
	if raw == "" {
		return nil
	}
	digest := sha256.Sum256([]byte(raw))
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[digest]
	if !ok {
		return nil
	}
	delete(s.sessions, digest)
	if err := s.persistLocked(s.now()); err != nil {
		s.sessions[digest] = session
		return err
	}
	return nil
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
	var oldest webSession
	found := false
	for digest, session := range s.sessions {
		if !found || session.LastSeenAt.Before(oldest.LastSeenAt) || (session.LastSeenAt.Equal(oldest.LastSeenAt) && session.CreatedAt.Before(oldest.CreatedAt)) || (session.LastSeenAt.Equal(oldest.LastSeenAt) && session.CreatedAt.Equal(oldest.CreatedAt) && session.DeviceID < oldest.DeviceID) {
			oldestDigest = digest
			oldest = session
			found = true
		}
	}
	if found {
		delete(s.sessions, oldestDigest)
	}
}

func validRegistryBasePath(basePath string) bool {
	if basePath == "" || !strings.HasSuffix(basePath, "/") {
		return false
	}
	got, ok := registryBasePath(basePath + "ws")
	return ok && got == basePath
}

func cloneWebSessions(sessions map[[32]byte]webSession) map[[32]byte]webSession {
	cloned := make(map[[32]byte]webSession, len(sessions))
	for digest, session := range sessions {
		cloned[digest] = session
	}
	return cloned
}
