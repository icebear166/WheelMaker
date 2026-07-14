package registry

import (
	"context"
	"errors"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	ttsprovider "github.com/swm8023/wheelmaker/internal/tts"
)

var errTTSSecretNotConfigured = errors.New("tts secret not configured")

type ttsService struct {
	client         ttsprovider.Client
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

func newTTSService(client ttsprovider.Client, resolver func() (string, error)) *ttsService {
	if client == nil {
		client = ttsprovider.NewClient()
	}
	if resolver == nil {
		resolver = func() (string, error) { return "", errTTSSecretNotConfigured }
	}
	return &ttsService{
		client:         client,
		secretResolver: resolver,
	}
}

func (s *ttsService) synthesize(ctx context.Context, payload rp.TTSSynthesizePayload) (rp.TTSSynthesizeResponse, *ttsServiceError) {
	credential, err := s.secretResolver()
	if err != nil {
		if errors.Is(err, errTTSSecretNotConfigured) {
			return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: "not_configured", Message: "MiMo TTS is not configured"}
		}
		return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInternal, Message: "load TTS credential failed"}
	}
	response, err := s.client.Synthesize(ctx, ttsprovider.Request{
		APIKey: credential,
		Model:  payload.Model,
		Voice:  payload.Voice,
		Text:   payload.Text,
	})
	credential = ""
	if err != nil {
		switch {
		case errors.Is(err, ttsprovider.ErrInvalidRequest):
			return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInvalidArgument, Message: "invalid TTS request"}
		case errors.Is(err, ttsprovider.ErrUnavailable):
			return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeUnavailable, Message: "TTS upstream request failed"}
		default:
			return rp.TTSSynthesizeResponse{}, &ttsServiceError{Code: codeInternal, Message: "TTS request failed"}
		}
	}
	return rp.TTSSynthesizeResponse{AudioBase64: response.AudioBase64, Format: response.Format}, nil
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
