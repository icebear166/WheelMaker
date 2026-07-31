package registry

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/serverdata"
)

const maxServerDataSecretBytes = 16 * 1024

var errSpeechSecretNotConfigured = errors.New("speech secret not configured")

type ServerDataStore interface {
	Snapshot() (serverdata.Snapshot, error)
	UpdateSecret(serverdata.SecretKind, string, string, time.Time) error
	UpdateVoiceInputModel(string, time.Time) error
	UpdateTTS(string, string, time.Time) error
	Secret(serverdata.SecretKind) (string, string, error)
}

func (s *Server) handleServerDataRequest(peer *peerConn, state *connectionState, in envelope) {
	switch in.Method {
	case rp.RegistryMethodServerConfigGet:
		s.handleServerConfigGet(peer, in)
	case rp.RegistryMethodServerConfigUpdate:
		s.handleServerConfigUpdate(peer, in)
	case rp.RegistryMethodServerAndroidSpeechCredentialGet:
		s.handleAndroidSpeechCredentialGet(peer, state, in)
	case rp.RegistryMethodCodexRadarEfficiencyGet:
		s.handleCodexRadarEfficiencyGet(peer, in)
	default:
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported server data method", nil)
	}
}

func (s *Server) handleCodexRadarEfficiencyGet(peer *peerConn, in envelope) {
	var payload struct{}
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid CodexRadar efficiency payload", nil)
		return
	}
	if s.codexRadarEfficiencyLoader == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "CodexRadar efficiency is unavailable", nil)
		return
	}
	snapshot, err := s.codexRadarEfficiencyCache.get(context.Background(), s.codexRadarEfficiencyLoader)
	if err != nil {
		registryLogger("").Warn("CodexRadar efficiency fetch failed: %v", err)
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnavailable, "fetch CodexRadar efficiency failed", nil)
		return
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", snapshot)
}

func (s *Server) handleServerConfigGet(peer *peerConn, in envelope) {
	var payload struct{}
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid server config payload", nil)
		return
	}
	snapshot, err := s.serverDataSnapshot()
	if err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "read server config failed", nil)
		return
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", serverConfigResponse(snapshot))
}

func (s *Server) handleServerConfigUpdate(peer *peerConn, in envelope) {
	var payload rp.ServerConfigUpdatePayload
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid server config update payload", nil)
		return
	}
	payload.Section = strings.TrimSpace(payload.Section)
	payload.Field = strings.TrimSpace(payload.Field)
	payload.Action = strings.TrimSpace(payload.Action)
	if err := validateServerConfigUpdate(payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, err.Error(), nil)
		return
	}
	if s.serverData == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "server config is unavailable", nil)
		return
	}

	now := time.Now().UTC()
	var err error
	switch payload.Section + "." + payload.Field {
	case "voiceInput.key":
		err = s.serverData.UpdateSecret(serverdata.SecretVolcengineASR, payload.Action, payload.Value, now)
	case "voiceInput.model":
		err = s.serverData.UpdateVoiceInputModel(payload.Value, now)
	case "textToSpeech.key":
		err = s.serverData.UpdateSecret(serverdata.SecretMiMoTTS, payload.Action, payload.Value, now)
	case "textToSpeech.model":
		var snapshot serverdata.Snapshot
		snapshot, err = s.serverData.Snapshot()
		if err == nil {
			err = s.serverData.UpdateTTS(payload.Value, snapshot.TextToSpeech.Voice, now)
		}
	case "textToSpeech.voice":
		var snapshot serverdata.Snapshot
		snapshot, err = s.serverData.Snapshot()
		if err == nil {
			err = s.serverData.UpdateTTS(snapshot.TextToSpeech.Model, payload.Value, now)
		}
	case "deepSeek.key":
		err = s.serverData.UpdateSecret(serverdata.SecretDeepSeek, payload.Action, payload.Value, now)
	}
	if err != nil {
		registryLogger("").Warn("server config update section=%s field=%s action=%s success=false", payload.Section, payload.Field, payload.Action)
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "update server config failed", nil)
		return
	}
	snapshot, err := s.serverData.Snapshot()
	if err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "read updated server config failed", nil)
		return
	}
	registryLogger("").Info("server config update section=%s field=%s action=%s success=true", payload.Section, payload.Field, payload.Action)
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", serverConfigResponse(snapshot))
}

func (s *Server) handleAndroidSpeechCredentialGet(peer *peerConn, state *connectionState, in envelope) {
	var payload struct{}
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid Android speech credential payload", nil)
		return
	}
	if state == nil || !state.browserSession || state.role != string(rp.RegistryRoleClient) || state.clientName != "wheelmaker-android" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "Android device session required", nil)
		return
	}
	if s.serverData == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "server config is unavailable", nil)
		return
	}
	accessToken, version, err := s.serverData.Secret(serverdata.SecretVolcengineASR)
	if err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "read Android speech credential failed", nil)
		return
	}
	if accessToken == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, "not_configured", "Volcengine speech is not configured", nil)
		return
	}
	snapshot, err := s.serverData.Snapshot()
	if err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "read Android speech model failed", nil)
		return
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", rp.AndroidSpeechCredentialResponse{
		AccessToken: accessToken,
		Version:     version,
		Model:       snapshot.VoiceInput.Model,
	})
}

func validateServerConfigUpdate(payload rp.ServerConfigUpdatePayload) error {
	keyUpdate := func() error {
		switch payload.Action {
		case "set":
			if payload.Value == "" || len(payload.Value) > maxServerDataSecretBytes {
				return errors.New("key value must be between 1 byte and 16 KiB")
			}
		case "clear":
			if payload.Value != "" {
				return errors.New("clear must not include a value")
			}
		default:
			return errors.New("key action must be set or clear")
		}
		return nil
	}
	settingUpdate := func(valid bool) error {
		if payload.Action != "set" || payload.Value == "" {
			return errors.New("setting action must be set with a value")
		}
		if !valid {
			return errors.New("unsupported setting value")
		}
		return nil
	}

	switch payload.Section + "." + payload.Field {
	case "voiceInput.key", "textToSpeech.key", "deepSeek.key":
		return keyUpdate()
	case "voiceInput.model":
		return settingUpdate(payload.Value == serverdata.VoiceInputModelDoubaoStreamingASR2)
	case "textToSpeech.model":
		return settingUpdate(validTTSModel(payload.Value))
	case "textToSpeech.voice":
		return settingUpdate(validTTSVoice(payload.Value))
	default:
		return fmt.Errorf("unsupported server config section or field")
	}
}

func validTTSModel(value string) bool {
	switch value {
	case "mimo-v2-tts", "mimo-v2.5-tts", "mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign":
		return true
	default:
		return false
	}
}

func validTTSVoice(value string) bool {
	switch value {
	case "mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean":
		return true
	default:
		return false
	}
}

func (s *Server) serverDataSnapshot() (serverdata.Snapshot, error) {
	if s.serverData == nil {
		return serverdata.Snapshot{}, errors.New("server data store is not configured")
	}
	return s.serverData.Snapshot()
}

func serverConfigResponse(snapshot serverdata.Snapshot) rp.ServerConfigResponse {
	return rp.ServerConfigResponse{
		VoiceInput: rp.ServerVoiceInputConfig{
			ServerFeatureConfig: rp.ServerFeatureConfig{Configured: snapshot.VoiceInput.Configured, UpdatedAt: snapshot.VoiceInput.UpdatedAt},
			Model:               snapshot.VoiceInput.Model,
		},
		TextToSpeech: rp.ServerTextToSpeechConfig{
			ServerFeatureConfig: rp.ServerFeatureConfig{Configured: snapshot.TextToSpeech.Configured, UpdatedAt: snapshot.TextToSpeech.UpdatedAt},
			Model:               snapshot.TextToSpeech.Model,
			Voice:               snapshot.TextToSpeech.Voice,
		},
		DeepSeek: rp.ServerFeatureConfig{Configured: snapshot.DeepSeek.Configured, UpdatedAt: snapshot.DeepSeek.UpdatedAt},
	}
}

func (s *Server) resolveVolcengineASRSecret() (string, error) {
	return s.resolveServerSecret(serverdata.SecretVolcengineASR, errSpeechSecretNotConfigured)
}

func (s *Server) resolveMiMoTTSSecret() (string, error) {
	return s.resolveServerSecret(serverdata.SecretMiMoTTS, errTTSSecretNotConfigured)
}

func (s *Server) resolveServerSecret(kind serverdata.SecretKind, notConfigured error) (string, error) {
	if s.serverData == nil {
		return "", notConfigured
	}
	value, _, err := s.serverData.Secret(kind)
	if err != nil {
		return "", err
	}
	if value == "" {
		return "", notConfigured
	}
	return value, nil
}
