package registry

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sort"
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

type webSessionInfo struct {
	DeviceID   string
	DeviceName string
	BasePath   string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
	Current    bool
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
	return s.authenticate(raw, "")
}

func (s *webSessionStore) AuthenticateForBasePath(raw, basePath string) (webSession, bool) {
	return s.authenticate(raw, basePath)
}

func (s *webSessionStore) authenticate(raw, basePath string) (webSession, bool) {
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
	if basePath != "" && session.BasePath != basePath {
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

func (s *webSessionStore) List(currentDeviceID string) ([]webSessionInfo, error) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := cloneWebSessions(s.sessions)
	s.removeExpiredLocked(now)
	if len(previous) != len(s.sessions) {
		if err := s.persistLocked(now); err != nil {
			s.sessions = previous
			return nil, err
		}
	}
	items := make([]webSessionInfo, 0, len(s.sessions))
	for _, session := range s.sessions {
		items = append(items, webSessionInfo{
			DeviceID:   session.DeviceID,
			DeviceName: session.DeviceName,
			BasePath:   session.BasePath,
			CreatedAt:  session.CreatedAt,
			LastSeenAt: session.LastSeenAt,
			ExpiresAt:  session.ExpiresAt,
			Current:    session.DeviceID == currentDeviceID,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Current != items[j].Current {
			return items[i].Current
		}
		if items[i].LastSeenAt.Equal(items[j].LastSeenAt) {
			return items[i].DeviceID < items[j].DeviceID
		}
		return items[i].LastSeenAt.After(items[j].LastSeenAt)
	})
	return items, nil
}

func (s *webSessionStore) RevokeDevice(deviceID string) (bool, error) {
	if deviceID == "" {
		return false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for digest, session := range s.sessions {
		if session.DeviceID != deviceID {
			continue
		}
		delete(s.sessions, digest)
		if err := s.persistLocked(s.now()); err != nil {
			s.sessions[digest] = session
			return false, err
		}
		return true, nil
	}
	return false, nil
}

func (s *webSessionStore) RevokeAll() ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sessions) == 0 {
		return []string{}, nil
	}
	previous := cloneWebSessions(s.sessions)
	deviceIDs := make([]string, 0, len(s.sessions))
	for _, session := range s.sessions {
		deviceIDs = append(deviceIDs, session.DeviceID)
	}
	sort.Strings(deviceIDs)
	s.sessions = make(map[[32]byte]webSession)
	if err := s.persistLocked(s.now()); err != nil {
		s.sessions = previous
		return nil, err
	}
	return deviceIDs, nil
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
