package registry

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

const maxSecretValueBytes = 16 * 1024

var errSpeechSecretNotConfigured = errors.New("speech secret not configured")

type secretKind string

const (
	secretKindDeepSeek      secretKind = "deepseek"
	secretKindVolcengineASR secretKind = "volcengineAsr"
	secretKindMiMoTTS       secretKind = "mimoTts"
)

type secretStore struct {
	configPath  string
	mu          sync.Mutex
	writeConfig func(string, []byte) error
}

func newSecretStore(configPath string) *secretStore {
	return &secretStore{configPath: strings.TrimSpace(configPath), writeConfig: shared.WriteConfigFile}
}

func (s *secretStore) Status() ([]rp.SecretStatus, error) {
	cfg, err := s.load()
	if err != nil {
		return nil, err
	}
	return []rp.SecretStatus{
		secretStatus(rp.SecretKindDeepSeek, cfg.Secrets.DeepSeek),
		secretStatus(rp.SecretKindVolcengineASR, cfg.Secrets.VolcengineASR),
		secretStatus(rp.SecretKindMiMoTTS, cfg.Secrets.MiMoTTS),
	}, nil
}

func (s *secretStore) Set(kind secretKind, value string, now time.Time) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("secret value is required")
	}
	return s.update(kind, value, now)
}

func (s *secretStore) Clear(kind secretKind, now time.Time) error {
	return s.update(kind, "", now)
}

func (s *secretStore) Value(kind secretKind) (string, bool, error) {
	cfg, err := s.load()
	if err != nil {
		return "", false, err
	}
	record, err := secretConfigValue(cfg, kind)
	if err != nil {
		return "", false, err
	}
	value := strings.TrimSpace(record.Value)
	return value, value != "", nil
}

func (s *secretStore) update(kind secretKind, value string, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	record, err := secretConfigValue(cfg, kind)
	if err != nil {
		return err
	}
	record.Value = value
	record.UpdatedAt = now.UTC()
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode secret config: %w", err)
	}
	if err := s.writeConfig(s.configPath, append(raw, '\n')); err != nil {
		return fmt.Errorf("write secret config: %w", err)
	}
	return nil
}

func (s *secretStore) load() (*shared.AppConfig, error) {
	if s == nil || strings.TrimSpace(s.configPath) == "" {
		return nil, errors.New("backend secret store is not configured")
	}
	cfg, err := shared.LoadConfig(s.configPath)
	if err != nil {
		return nil, fmt.Errorf("load backend secret config: %w", err)
	}
	return cfg, nil
}

func secretConfigValue(cfg *shared.AppConfig, kind secretKind) (*shared.SecretValueConfig, error) {
	if cfg == nil {
		return nil, errors.New("secret config is nil")
	}
	switch kind {
	case secretKindDeepSeek:
		return &cfg.Secrets.DeepSeek, nil
	case secretKindVolcengineASR:
		return &cfg.Secrets.VolcengineASR, nil
	case secretKindMiMoTTS:
		return &cfg.Secrets.MiMoTTS, nil
	default:
		return nil, fmt.Errorf("unsupported secret kind %q", kind)
	}
}

func secretStatus(kind rp.SecretKind, value shared.SecretValueConfig) rp.SecretStatus {
	status := rp.SecretStatus{Kind: kind, Configured: strings.TrimSpace(value.Value) != ""}
	if !value.UpdatedAt.IsZero() {
		status.UpdatedAt = value.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return status
}

func (s *Server) handleSecretRequest(peer *peerConn, in envelope) {
	switch in.Method {
	case rp.RegistryMethodSecuritySecretStatus:
		var payload struct{}
		if err := decodeStrictPayload(in.Payload, &payload); err != nil {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid secret status payload", nil)
			return
		}
		items, err := s.secrets.Status()
		if err != nil {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "read backend secret status failed", nil)
			return
		}
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", rp.SecretStatusResponse{Secrets: items})
	case rp.RegistryMethodSecuritySecretUpdate:
		s.handleSecretUpdate(peer, in)
	default:
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported secret method", nil)
	}
}

func (s *Server) resolveVolcengineASRSecret() (string, error) {
	value, configured, err := s.secrets.Value(secretKindVolcengineASR)
	if err != nil {
		return "", err
	}
	if !configured {
		return "", errSpeechSecretNotConfigured
	}
	return value, nil
}

func (s *Server) resolveMiMoTTSSecret() (string, error) {
	value, configured, err := s.secrets.Value(secretKindMiMoTTS)
	if err != nil {
		return "", err
	}
	if !configured {
		return "", errTTSSecretNotConfigured
	}
	return value, nil
}

func (s *Server) handleSecretUpdate(peer *peerConn, in envelope) {
	var payload rp.SecretUpdatePayload
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid secret update payload", nil)
		return
	}
	kind, ok := parseSecretKind(payload.Kind)
	if !ok {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported secret kind", nil)
		return
	}
	action := strings.TrimSpace(payload.Action)
	value := strings.TrimSpace(payload.Value)
	var err error
	switch action {
	case "set":
		if value == "" || len(value) > maxSecretValueBytes {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "secret value must be between 1 byte and 16 KiB", nil)
			return
		}
		err = s.secrets.Set(kind, value, time.Now().UTC())
		value = ""
	case "clear":
		if value != "" {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "clear must not include a value", nil)
			return
		}
		err = s.secrets.Clear(kind, time.Now().UTC())
	default:
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "action must be set or clear", nil)
		return
	}
	if err != nil {
		registryLogger("").Warn("secret update kind=%s action=%s success=false", kind, action)
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "update backend secret failed", nil)
		return
	}
	registryLogger("").Info("secret update kind=%s action=%s success=true", kind, action)
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
}

func parseSecretKind(kind rp.SecretKind) (secretKind, bool) {
	switch kind {
	case rp.SecretKindDeepSeek:
		return secretKindDeepSeek, true
	case rp.SecretKindVolcengineASR:
		return secretKindVolcengineASR, true
	case rp.SecretKindMiMoTTS:
		return secretKindMiMoTTS, true
	default:
		return "", false
	}
}

func decodeStrictPayload(raw []byte, out any) error {
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = []byte("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
