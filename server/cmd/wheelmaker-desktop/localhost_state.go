package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	desktopLocalhostStateVersion       = 1
	desktopLocalhostStateMaxBytes      = 16 * 1024
	desktopLocalhostSecretBytes        = 32
	desktopLocalhostBasePathPrefix     = "/wm-local-"
	desktopRegistrySessionCookieName   = "wm_registry_session"
	desktopLocalhostSessionValueLength = 43
)

type desktopLocalhostState struct {
	BasePath         string
	SessionCookie    string
	SessionExpiresAt time.Time
}

type persistedDesktopLocalhostState struct {
	Version          int    `json:"version"`
	BasePath         string `json:"basePath"`
	SessionCookie    string `json:"sessionCookie,omitempty"`
	SessionExpiresAt string `json:"sessionExpiresAt,omitempty"`
}

type fileDesktopLocalhostStateStore struct {
	mu     sync.Mutex
	path   string
	random io.Reader
	now    func() time.Time
}

func newFileDesktopLocalhostStateStore(path string) *fileDesktopLocalhostStateStore {
	return &fileDesktopLocalhostStateStore{path: path, random: rand.Reader, now: time.Now}
}

func (s *fileDesktopLocalhostStateStore) LoadOrCreate() (desktopLocalhostState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadOrCreateLocked()
}

func (s *fileDesktopLocalhostStateStore) SaveSession(cookie *http.Cookie) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadOrCreateLocked()
	if err != nil {
		return err
	}
	if !validDesktopRegistrySessionCookie(cookie, state.BasePath, s.now()) {
		return errors.New("invalid Registry session cookie")
	}
	state.SessionCookie = cookie.Value
	state.SessionExpiresAt = cookie.Expires.UTC()
	return s.writeLocked(state)
}

func (s *fileDesktopLocalhostStateStore) ClearSession() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadOrCreateLocked()
	if err != nil {
		return err
	}
	state.SessionCookie = ""
	state.SessionExpiresAt = time.Time{}
	return s.writeLocked(state)
}

func (s *fileDesktopLocalhostStateStore) Delete() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *fileDesktopLocalhostStateStore) loadOrCreateLocked() (desktopLocalhostState, error) {
	state, err := s.readLocked()
	if errors.Is(err, os.ErrNotExist) {
		basePath, createErr := newDesktopLocalhostBasePath(s.random)
		if createErr != nil {
			return desktopLocalhostState{}, createErr
		}
		state = desktopLocalhostState{BasePath: basePath}
		if writeErr := s.writeLocked(state); writeErr != nil {
			return desktopLocalhostState{}, writeErr
		}
		return state, nil
	}
	if err != nil {
		return desktopLocalhostState{}, err
	}
	if state.SessionCookie != "" && !state.SessionExpiresAt.After(s.now()) {
		state.SessionCookie = ""
		state.SessionExpiresAt = time.Time{}
		if err := s.writeLocked(state); err != nil {
			return desktopLocalhostState{}, err
		}
	}
	return state, nil
}

func (s *fileDesktopLocalhostStateStore) readLocked() (desktopLocalhostState, error) {
	file, err := os.Open(s.path)
	if err != nil {
		return desktopLocalhostState{}, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, desktopLocalhostStateMaxBytes+1))
	if err != nil {
		return desktopLocalhostState{}, err
	}
	if len(raw) > desktopLocalhostStateMaxBytes {
		return desktopLocalhostState{}, errors.New("Desktop Localhost state exceeds size limit")
	}
	if err := shared.SecureConfigFile(s.path); err != nil {
		return desktopLocalhostState{}, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var persisted persistedDesktopLocalhostState
	if err := decoder.Decode(&persisted); err != nil {
		return desktopLocalhostState{}, fmt.Errorf("decode Desktop Localhost state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return desktopLocalhostState{}, fmt.Errorf("decode Desktop Localhost state: %w", err)
	}
	if persisted.Version != desktopLocalhostStateVersion || !validDesktopLocalhostBasePath(persisted.BasePath) {
		return desktopLocalhostState{}, errors.New("invalid Desktop Localhost state")
	}
	if (persisted.SessionCookie == "") != (persisted.SessionExpiresAt == "") {
		return desktopLocalhostState{}, errors.New("incomplete Desktop Localhost session")
	}
	state := desktopLocalhostState{BasePath: persisted.BasePath}
	if persisted.SessionCookie == "" {
		return state, nil
	}
	if !validDesktopLocalhostSessionValue(persisted.SessionCookie) {
		return desktopLocalhostState{}, errors.New("invalid Desktop Localhost session")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, persisted.SessionExpiresAt)
	if err != nil || expiresAt.IsZero() {
		return desktopLocalhostState{}, errors.New("invalid Desktop Localhost session expiry")
	}
	state.SessionCookie = persisted.SessionCookie
	state.SessionExpiresAt = expiresAt
	return state, nil
}

func (s *fileDesktopLocalhostStateStore) writeLocked(state desktopLocalhostState) error {
	if !validDesktopLocalhostBasePath(state.BasePath) {
		return errors.New("invalid Desktop Localhost Base Path")
	}
	persisted := persistedDesktopLocalhostState{
		Version:  desktopLocalhostStateVersion,
		BasePath: state.BasePath,
	}
	if state.SessionCookie != "" || !state.SessionExpiresAt.IsZero() {
		if !validDesktopLocalhostSessionValue(state.SessionCookie) || state.SessionExpiresAt.IsZero() {
			return errors.New("invalid Desktop Localhost session")
		}
		persisted.SessionCookie = state.SessionCookie
		persisted.SessionExpiresAt = state.SessionExpiresAt.UTC().Format(time.RFC3339Nano)
	}
	raw, err := json.Marshal(persisted)
	if err != nil {
		return fmt.Errorf("encode Desktop Localhost state: %w", err)
	}
	if len(raw) > desktopLocalhostStateMaxBytes {
		return errors.New("Desktop Localhost state exceeds size limit")
	}
	return shared.WriteConfigFile(s.path, append(raw, '\n'))
}

func newDesktopLocalhostBasePath(source io.Reader) (string, error) {
	raw := make([]byte, desktopLocalhostSecretBytes)
	if _, err := io.ReadFull(source, raw); err != nil {
		return "", fmt.Errorf("generate Desktop Localhost Base Path: %w", err)
	}
	return desktopLocalhostBasePathPrefix + base64.RawURLEncoding.EncodeToString(raw) + "/", nil
}

func validDesktopLocalhostBasePath(value string) bool {
	if !strings.HasPrefix(value, desktopLocalhostBasePathPrefix) || !strings.HasSuffix(value, "/") {
		return false
	}
	encoded := strings.TrimSuffix(strings.TrimPrefix(value, desktopLocalhostBasePathPrefix), "/")
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	return err == nil && len(decoded) == desktopLocalhostSecretBytes && len(encoded) == desktopLocalhostSessionValueLength
}

func validDesktopLocalhostSessionValue(value string) bool {
	if len(value) != desktopLocalhostSessionValueLength {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == desktopLocalhostSecretBytes
}

func validDesktopRegistrySessionCookie(cookie *http.Cookie, basePath string, now time.Time) bool {
	return cookie != nil && cookie.Name == desktopRegistrySessionCookieName &&
		validDesktopLocalhostSessionValue(cookie.Value) && cookie.Path == basePath && cookie.Domain == "" &&
		cookie.Expires.After(now) && cookie.MaxAge > 0 && cookie.HttpOnly && cookie.Secure &&
		cookie.SameSite == http.SameSiteStrictMode
}
