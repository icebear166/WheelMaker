package registry

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	ttsprovider "github.com/swm8023/wheelmaker/internal/tts"
)

type recordingTTSClient struct {
	request  ttsprovider.Request
	response ttsprovider.Response
	err      error
}

func (c *recordingTTSClient) Synthesize(_ context.Context, request ttsprovider.Request) (ttsprovider.Response, error) {
	c.request = request
	return c.response, c.err
}

func TestTTSAdapterPassesBackendSecretOnlyToClient(t *testing.T) {
	client := &recordingTTSClient{response: ttsprovider.Response{AudioBase64: "UklGRg==", Format: "wav"}}
	service := newTTSService(client, func() (string, error) { return "backend-tts-key", nil })
	response, serviceErr := service.synthesize(context.Background(), rp.TTSSynthesizePayload{
		Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello",
	})
	if serviceErr != nil {
		t.Fatalf("synthesize: %v", serviceErr)
	}
	if client.request.APIKey != "backend-tts-key" || client.request.Model != "mimo-v2.5-tts" || client.request.Voice != "Mia" || client.request.Text != "hello" {
		t.Fatalf("request=%+v", client.request)
	}
	if response.AudioBase64 != "UklGRg==" || response.Format != "wav" {
		t.Fatalf("response=%+v", response)
	}
	encoded, _ := json.Marshal(response)
	if strings.Contains(string(encoded), "backend-tts-key") {
		t.Fatalf("response leaks secret: %s", encoded)
	}
}

func TestTTSAdapterMapsCredentialAndProviderErrors(t *testing.T) {
	payload := rp.TTSSynthesizePayload{Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello"}
	tests := []struct {
		name     string
		resolver func() (string, error)
		client   *recordingTTSClient
		wantCode string
	}{
		{name: "not configured", resolver: func() (string, error) { return "", errTTSSecretNotConfigured }, client: &recordingTTSClient{}, wantCode: "not_configured"},
		{name: "credential read", resolver: func() (string, error) { return "", errors.New("disk") }, client: &recordingTTSClient{}, wantCode: codeInternal},
		{name: "invalid request", resolver: func() (string, error) { return "key", nil }, client: &recordingTTSClient{err: ttsprovider.ErrInvalidRequest}, wantCode: codeInvalidArgument},
		{name: "upstream", resolver: func() (string, error) { return "key", nil }, client: &recordingTTSClient{err: ttsprovider.ErrUnavailable}, wantCode: codeUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := newTTSService(tt.client, tt.resolver)
			_, serviceErr := service.synthesize(context.Background(), payload)
			if serviceErr == nil || serviceErr.Code != tt.wantCode {
				t.Fatalf("error=%v, want code %s", serviceErr, tt.wantCode)
			}
		})
	}
}
