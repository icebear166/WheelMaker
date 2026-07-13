package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	mimoTTSEndpoint          = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
	maxTTSTextBytes          = 16 * 1024
	maxTTSResponseBytes      = 16 * 1024 * 1024
	maxTTSErrorBodyBytes     = 4 * 1024
	defaultTTSRequestTimeout = 45 * time.Second
)

var errTTSSecretNotConfigured = errors.New("tts secret not configured")

var allowedTTSModels = map[string]struct{}{
	"mimo-v2-tts":               {},
	"mimo-v2.5-tts":             {},
	"mimo-v2.5-tts-voiceclone":  {},
	"mimo-v2.5-tts-voicedesign": {},
}

var allowedTTSVoices = map[string]struct{}{
	"mimo_default": {}, "冰糖": {}, "茉莉": {}, "苏打": {}, "白桦": {},
	"Mia": {}, "Chloe": {}, "Milo": {}, "Dean": {},
}

type ttsService struct {
	endpoint       string
	client         *http.Client
	secretResolver func() (string, error)
}

type ttsServiceError struct {
	Code    string
	Message string
}

func (e *ttsServiceError) Error() string {
	if e == nil {
		return ""
	}
	return e.Code + ": " + e.Message
}

func newTTSService(resolver func() (string, error)) *ttsService {
	if resolver == nil {
		resolver = func() (string, error) { return "", errTTSSecretNotConfigured }
	}
	return &ttsService{
		endpoint:       mimoTTSEndpoint,
		client:         &http.Client{Timeout: defaultTTSRequestTimeout},
		secretResolver: resolver,
	}
}

func (s *ttsService) synthesize(ctx context.Context, payload rp.TTSSynthesizePayload) (rp.TTSSynthesizeResponse, *ttsServiceError) {
	payload.Model = strings.TrimSpace(payload.Model)
	payload.Voice = strings.TrimSpace(payload.Voice)
	payload.Text = strings.TrimSpace(payload.Text)
	if _, ok := allowedTTSModels[payload.Model]; !ok {
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInvalidArgument, Message: "unsupported TTS model"}
	}
	if _, ok := allowedTTSVoices[payload.Voice]; !ok {
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInvalidArgument, Message: "unsupported TTS voice"}
	}
	if payload.Text == "" || len([]byte(payload.Text)) > maxTTSTextBytes {
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInvalidArgument, Message: "TTS text must be between 1 byte and 16 KiB"}
	}
	credential, err := s.secretResolver()
	if err != nil {
		if errors.Is(err, errTTSSecretNotConfigured) {
			return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: "not_configured", Message: "MiMo TTS is not configured"}
		}
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInternal, Message: "load TTS credential failed"}
	}
	body, err := json.Marshal(map[string]any{
		"model": payload.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "请朗读以下文本"},
			{"role": "assistant", "content": payload.Text},
		},
		"modalities": []string{"text", "audio"},
		"audio":      map[string]string{"voice": payload.Voice, "format": "wav"},
	})
	if err != nil {
		credential = ""
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInternal, Message: "encode TTS request failed"}
	}
	requestCtx, cancel := context.WithTimeout(ctx, defaultTTSRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, s.endpoint, bytes.NewReader(body))
	if err != nil {
		credential = ""
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInternal, Message: "create TTS request failed"}
	}
	req.Header.Set("Authorization", "Bearer "+credential)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	credential = ""
	resp, err := s.client.Do(req)
	if err != nil {
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeUnavailable, Message: "TTS upstream request failed"}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.ReadAll(io.LimitReader(resp.Body, maxTTSErrorBodyBytes))
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeUnavailable, Message: fmt.Sprintf("TTS upstream returned HTTP %d", resp.StatusCode)}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxTTSResponseBytes+1))
	if err != nil {
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeUnavailable, Message: "read TTS upstream response failed"}
	}
	if len(raw) > maxTTSResponseBytes {
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeUnavailable, Message: "TTS upstream response is too large"}
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Audio struct {
					Data string `json:"data"`
				} `json:"audio"`
			} `json:"message"`
		} `json:"choices"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&decoded); err != nil || len(decoded.Choices) == 0 || strings.TrimSpace(decoded.Choices[0].Message.Audio.Data) == "" {
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeUnavailable, Message: "TTS upstream returned no audio data"}
	}
	return rp.TTSSynthesizeResponse{AudioBase64: decoded.Choices[0].Message.Audio.Data, Format: "wav"}, nil
}

func (s *ttsService) handleRequest(peer *peerConn, in envelope) {
	var payload rp.TTSSynthesizePayload
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = writeSpeechError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid TTS payload", nil)
		return
	}
	response, serviceErr := s.synthesize(context.Background(), payload)
	if serviceErr != nil {
		_ = writeSpeechError(peer, in.RequestID, in.Method, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	_ = writeSpeechResponse(peer, in.RequestID, in.Method, response)
}
