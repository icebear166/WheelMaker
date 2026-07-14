package serverdata

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	fileVersion                    = 1
	maxFileBytes                   = 64 * 1024
	maxSecretBytes                 = 16 * 1024
	SecretDeepSeek      SecretKind = "deepseek"
	SecretVolcengineASR SecretKind = "volcengineAsr"
	SecretMiMoTTS       SecretKind = "mimoTts"

	VoiceInputModelDoubaoStreamingASR2 = "doubao-streaming-asr-2.0"
	TTSModelMiMoV25                    = "mimo-v2.5-tts"
	TTSVoiceMia                        = "Mia"
)

type SecretKind string

type secretValue struct {
	Value     string    `json:"value,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type fileData struct {
	Version    int `json:"version"`
	VoiceInput struct {
		AccessToken secretValue `json:"accessToken"`
		Model       string      `json:"model"`
	} `json:"voiceInput"`
	TextToSpeech struct {
		APIKey secretValue `json:"apiKey"`
		Model  string      `json:"model"`
		Voice  string      `json:"voice"`
	} `json:"textToSpeech"`
	DeepSeek struct {
		APIKey secretValue `json:"apiKey"`
	} `json:"deepseek"`
}

type FeatureSnapshot struct {
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

type VoiceInputSnapshot struct {
	FeatureSnapshot
	Model string `json:"model"`
}

type TTSSnapshot struct {
	FeatureSnapshot
	Model string `json:"model"`
	Voice string `json:"voice"`
}

type Snapshot struct {
	VoiceInput   VoiceInputSnapshot `json:"voiceInput"`
	TextToSpeech TTSSnapshot        `json:"textToSpeech"`
	DeepSeek     FeatureSnapshot    `json:"deepseek"`
}

type Store struct {
	path  string
	mu    sync.Mutex
	write func(string, []byte) error
}

func New(path string) *Store {
	return &Store{path: path, write: shared.WriteConfigFile}
}

func (s *Store) Snapshot() (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return Snapshot{}, err
	}
	return snapshotFromData(data), nil
}

func (s *Store) UpdateSecret(kind SecretKind, action, value string, now time.Time) error {
	if action != "set" && action != "clear" {
		return fmt.Errorf("unsupported secret action %q", action)
	}
	if action == "set" {
		if value == "" {
			return fmt.Errorf("secret value is required")
		}
		if len(value) > maxSecretBytes {
			return fmt.Errorf("secret value exceeds 16 KiB")
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	secret, err := secretForKind(&data, kind)
	if err != nil {
		return err
	}
	if action == "clear" {
		*secret = secretValue{}
	} else {
		*secret = secretValue{Value: value, UpdatedAt: now.UTC()}
	}
	return s.writeLocked(data)
}

func (s *Store) UpdateVoiceInputModel(model string, _ time.Time) error {
	if model != VoiceInputModelDoubaoStreamingASR2 {
		return fmt.Errorf("unsupported voice input model %q", model)
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	data.VoiceInput.Model = model
	return s.writeLocked(data)
}

func (s *Store) UpdateTTS(model, voice string, _ time.Time) error {
	if model != TTSModelMiMoV25 {
		return fmt.Errorf("unsupported text-to-speech model %q", model)
	}
	if voice != TTSVoiceMia {
		return fmt.Errorf("unsupported text-to-speech voice %q", voice)
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	data.TextToSpeech.Model = model
	data.TextToSpeech.Voice = voice
	return s.writeLocked(data)
}

func (s *Store) Secret(kind SecretKind) (value, version string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return "", "", err
	}
	secret, err := secretForKind(&data, kind)
	if err != nil {
		return "", "", err
	}
	if secret.Value == "" {
		return "", "", nil
	}
	return secret.Value, formatTime(secret.UpdatedAt), nil
}

func (s *Store) loadLocked() (fileData, error) {
	data := defaultData()
	info, err := os.Stat(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return data, nil
		}
		return fileData{}, fmt.Errorf("stat server data: %w", err)
	}
	if info.Size() > maxFileBytes {
		return fileData{}, fmt.Errorf("server data exceeds 64 KiB")
	}
	if err := shared.SecureConfigFile(s.path); err != nil {
		return fileData{}, err
	}
	file, err := os.Open(s.path)
	if err != nil {
		return fileData{}, fmt.Errorf("open server data: %w", err)
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxFileBytes+1))
	if err != nil {
		return fileData{}, fmt.Errorf("read server data: %w", err)
	}
	if len(raw) > maxFileBytes {
		return fileData{}, fmt.Errorf("server data exceeds 64 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&data); err != nil {
		return fileData{}, fmt.Errorf("parse server data: %w", err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return fileData{}, err
	}
	if err := validateData(&data); err != nil {
		return fileData{}, err
	}
	return data, nil
}

func (s *Store) writeLocked(data fileData) error {
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("encode server data: %w", err)
	}
	raw = append(raw, '\n')
	if len(raw) > maxFileBytes {
		return fmt.Errorf("server data exceeds 64 KiB")
	}
	if err := s.write(s.path, raw); err != nil {
		return fmt.Errorf("write server data: %w", err)
	}
	return nil
}

func defaultData() fileData {
	var data fileData
	data.Version = fileVersion
	data.VoiceInput.Model = VoiceInputModelDoubaoStreamingASR2
	data.TextToSpeech.Model = TTSModelMiMoV25
	data.TextToSpeech.Voice = TTSVoiceMia
	return data
}

func validateData(data *fileData) error {
	if data.Version != fileVersion {
		return fmt.Errorf("unsupported server data version %d", data.Version)
	}
	if data.VoiceInput.Model == "" {
		data.VoiceInput.Model = VoiceInputModelDoubaoStreamingASR2
	}
	if data.TextToSpeech.Model == "" {
		data.TextToSpeech.Model = TTSModelMiMoV25
	}
	if data.TextToSpeech.Voice == "" {
		data.TextToSpeech.Voice = TTSVoiceMia
	}
	if data.VoiceInput.Model != VoiceInputModelDoubaoStreamingASR2 {
		return fmt.Errorf("unsupported voice input model %q", data.VoiceInput.Model)
	}
	if data.TextToSpeech.Model != TTSModelMiMoV25 {
		return fmt.Errorf("unsupported text-to-speech model %q", data.TextToSpeech.Model)
	}
	if data.TextToSpeech.Voice != TTSVoiceMia {
		return fmt.Errorf("unsupported text-to-speech voice %q", data.TextToSpeech.Voice)
	}
	for _, secret := range []*secretValue{
		&data.VoiceInput.AccessToken,
		&data.TextToSpeech.APIKey,
		&data.DeepSeek.APIKey,
	} {
		if len(secret.Value) > maxSecretBytes {
			return fmt.Errorf("stored secret exceeds 16 KiB")
		}
	}
	return nil
}

func secretForKind(data *fileData, kind SecretKind) (*secretValue, error) {
	switch kind {
	case SecretDeepSeek:
		return &data.DeepSeek.APIKey, nil
	case SecretVolcengineASR:
		return &data.VoiceInput.AccessToken, nil
	case SecretMiMoTTS:
		return &data.TextToSpeech.APIKey, nil
	default:
		return nil, fmt.Errorf("unsupported secret kind %q", kind)
	}
}

func snapshotFromData(data fileData) Snapshot {
	return Snapshot{
		VoiceInput: VoiceInputSnapshot{
			FeatureSnapshot: featureSnapshot(data.VoiceInput.AccessToken),
			Model:           data.VoiceInput.Model,
		},
		TextToSpeech: TTSSnapshot{
			FeatureSnapshot: featureSnapshot(data.TextToSpeech.APIKey),
			Model:           data.TextToSpeech.Model,
			Voice:           data.TextToSpeech.Voice,
		},
		DeepSeek: featureSnapshot(data.DeepSeek.APIKey),
	}
}

func featureSnapshot(secret secretValue) FeatureSnapshot {
	if secret.Value == "" {
		return FeatureSnapshot{}
	}
	return FeatureSnapshot{Configured: true, UpdatedAt: formatTime(secret.UpdatedAt)}
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("parse server data: multiple JSON values")
		}
		return fmt.Errorf("parse server data: %w", err)
	}
	return nil
}
