package registry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestTTSUsesBackendSecretAndFixedRequestShape(t *testing.T) {
	var authorization string
	var upstream map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&upstream); err != nil {
			t.Fatalf("decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"audio":{"data":"UklGRg=="}}}]}`))
	}))
	defer ts.Close()

	service := newTTSService(func() (string, error) { return "backend-tts-key", nil })
	service.endpoint = ts.URL
	response, serviceErr := service.synthesize(context.Background(), rp.TTSSynthesizePayload{
		Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello",
	})
	if serviceErr != nil {
		t.Fatalf("synthesize: %v", serviceErr)
	}
	if authorization != "Bearer backend-tts-key" {
		t.Fatalf("Authorization=%q", authorization)
	}
	if response.AudioBase64 != "UklGRg==" || response.Format != "wav" {
		t.Fatalf("response=%+v", response)
	}
	encoded, _ := json.Marshal(response)
	if strings.Contains(string(encoded), "backend-tts-key") {
		t.Fatalf("response leaks secret: %s", encoded)
	}
	if upstream["model"] != "mimo-v2.5-tts" {
		t.Fatalf("upstream=%#v", upstream)
	}
}

func TestTTSValidatesInputAndBoundsUpstreamErrors(t *testing.T) {
	secret := "never-echo-this-key"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(strings.Repeat("x", 5000) + secret))
	}))
	defer ts.Close()
	service := newTTSService(func() (string, error) { return secret, nil })
	service.endpoint = ts.URL

	for _, payload := range []rp.TTSSynthesizePayload{
		{Model: "bad", Voice: "Mia", Text: "hello"},
		{Model: "mimo-v2.5-tts", Voice: "bad", Text: "hello"},
		{Model: "mimo-v2.5-tts", Voice: "Mia", Text: strings.Repeat("x", 16*1024+1)},
	} {
		if _, serviceErr := service.synthesize(context.Background(), payload); serviceErr == nil || serviceErr.Code != codeInvalidArgument {
			t.Fatalf("payload=%+v error=%v", payload, serviceErr)
		}
	}
	_, serviceErr := service.synthesize(context.Background(), rp.TTSSynthesizePayload{Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello"})
	if serviceErr == nil || strings.Contains(serviceErr.Message, secret) || len(serviceErr.Message) > 4096 {
		t.Fatalf("unsafe upstream error=%v", serviceErr)
	}
}
