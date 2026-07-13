package registry

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	webSessionFileVersion  = 1
	maxWebSessionFileBytes = 1 << 20
)

type persistedWebSessionFile struct {
	Version          int                      `json:"version"`
	TokenFingerprint string                   `json:"tokenFingerprint"`
	Sessions         []persistedDeviceSession `json:"sessions"`
}

type persistedDeviceSession struct {
	DeviceID   string    `json:"deviceId"`
	Digest     string    `json:"digest"`
	DeviceName string    `json:"deviceName"`
	BasePath   string    `json:"basePath"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

func (s *webSessionStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions = make(map[[32]byte]webSession)
	s.lastPersistedAt = time.Time{}
	now := s.now()
	if s.filePath == "" {
		s.lastPersistedAt = now
		return nil
	}

	if _, err := os.Stat(s.filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s.persistLocked(now)
		}
		return fmt.Errorf("stat registry sessions: %w", err)
	}
	if err := s.secureFile(s.filePath); err != nil {
		return fmt.Errorf("secure registry sessions: %w", err)
	}
	data, err := readLimitedWebSessionFile(s.filePath)
	if err != nil {
		return err
	}
	var persisted persistedWebSessionFile
	if err := decodeWebSessionFile(data, &persisted); err != nil {
		return err
	}
	if persisted.Version != webSessionFileVersion {
		return fmt.Errorf("registry sessions: unsupported version %d", persisted.Version)
	}
	if len(persisted.Sessions) > maxWebSessions {
		return fmt.Errorf("registry sessions: session count %d exceeds limit", len(persisted.Sessions))
	}
	if persisted.TokenFingerprint != registryTokenFingerprint(s.registryToken) {
		return s.persistLocked(now)
	}

	loaded := make(map[[32]byte]webSession, len(persisted.Sessions))
	deviceIDs := make(map[string]struct{}, len(persisted.Sessions))
	removedExpired := false
	for _, record := range persisted.Sessions {
		session, err := decodePersistedDeviceSession(record)
		if err != nil {
			return err
		}
		if _, exists := loaded[session.Digest]; exists {
			return errors.New("registry sessions: duplicate digest")
		}
		if _, exists := deviceIDs[session.DeviceID]; exists {
			return errors.New("registry sessions: duplicate device ID")
		}
		deviceIDs[session.DeviceID] = struct{}{}
		if !now.Before(session.ExpiresAt) {
			removedExpired = true
			continue
		}
		loaded[session.Digest] = session
	}
	s.sessions = loaded
	s.lastPersistedAt = now
	if removedExpired {
		return s.persistLocked(now)
	}
	return nil
}

func (s *webSessionStore) persistLocked(now time.Time) error {
	if s.filePath == "" {
		s.lastPersistedAt = now
		return nil
	}
	records := make([]persistedDeviceSession, 0, len(s.sessions))
	for _, session := range s.sessions {
		records = append(records, persistedDeviceSession{
			DeviceID:   session.DeviceID,
			Digest:     base64.RawURLEncoding.EncodeToString(session.Digest[:]),
			DeviceName: session.DeviceName,
			BasePath:   session.BasePath,
			CreatedAt:  session.CreatedAt,
			LastSeenAt: session.LastSeenAt,
			ExpiresAt:  session.ExpiresAt,
		})
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].CreatedAt.Equal(records[j].CreatedAt) {
			return records[i].DeviceID < records[j].DeviceID
		}
		return records[i].CreatedAt.Before(records[j].CreatedAt)
	})
	persisted := persistedWebSessionFile{
		Version:          webSessionFileVersion,
		TokenFingerprint: registryTokenFingerprint(s.registryToken),
		Sessions:         records,
	}
	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal registry sessions: %w", err)
	}
	data = append(data, '\n')
	if len(data) > maxWebSessionFileBytes {
		return errors.New("registry sessions: encoded file exceeds size limit")
	}
	if err := s.writeFile(s.filePath, data); err != nil {
		return fmt.Errorf("write registry sessions: %w", err)
	}
	s.lastPersistedAt = now
	return nil
}

func readLimitedWebSessionFile(filePath string) ([]byte, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open registry sessions: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxWebSessionFileBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read registry sessions: %w", err)
	}
	if len(data) > maxWebSessionFileBytes {
		return nil, errors.New("registry sessions: file exceeds size limit")
	}
	return data, nil
}

func decodeWebSessionFile(data []byte, target *persistedWebSessionFile) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode registry sessions: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return fmt.Errorf("decode registry sessions: %w", err)
	}
	return nil
}

func decodePersistedDeviceSession(record persistedDeviceSession) (webSession, error) {
	digestBytes, err := base64.RawURLEncoding.DecodeString(record.Digest)
	if err != nil || len(digestBytes) != sha256.Size {
		return webSession{}, errors.New("registry sessions: invalid digest")
	}
	if record.DeviceID == "" || record.DeviceName == "" || !validRegistryBasePath(record.BasePath) || record.CreatedAt.IsZero() || record.LastSeenAt.Before(record.CreatedAt) || !record.ExpiresAt.After(record.LastSeenAt) {
		return webSession{}, errors.New("registry sessions: invalid device metadata")
	}
	var digest [sha256.Size]byte
	copy(digest[:], digestBytes)
	return webSession{
		DeviceID:   record.DeviceID,
		Digest:     digest,
		DeviceName: record.DeviceName,
		BasePath:   record.BasePath,
		CreatedAt:  record.CreatedAt,
		LastSeenAt: record.LastSeenAt,
		ExpiresAt:  record.ExpiresAt,
	}, nil
}

func deriveSessionCSRF(registryToken, rawCookie string) string {
	mac := hmac.New(sha256.New, []byte(registryToken))
	_, _ = mac.Write([]byte("wheelmaker/registry-session-csrf/v1\x00"))
	_, _ = mac.Write([]byte(rawCookie))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func registryTokenFingerprint(token string) string {
	sum := sha256.Sum256([]byte("wheelmaker/registry-token/v1\x00" + token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func writeWebSessionFile(path string, data []byte) error {
	return shared.WriteConfigFile(path, data)
}

func secureWebSessionFile(path string) error {
	return shared.SecureConfigFile(path)
}

func webSessionStatePath(stateDir string) string {
	if stateDir == "" {
		return ""
	}
	return filepath.Join(stateDir, "registry-sessions.json")
}
