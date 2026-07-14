package tts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientUsesFixedEndpointAuthorizationAndRequestShape(t *testing.T) {
	var authorization string
	var upstream map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("Authorization")
		if err := json.NewDecoder(request.Body).Decode(&upstream); err != nil {
			t.Fatalf("decode upstream: %v", err)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"choices":[{"message":{"audio":{"data":"UklGRg=="}}}]}`))
	}))
	defer server.Close()

	client := NewClient().(*clientImpl)
	if client.endpoint != mimoEndpoint {
		t.Fatalf("endpoint=%q, want fixed MiMo endpoint", client.endpoint)
	}
	client.endpoint = server.URL
	result, err := client.Synthesize(context.Background(), Request{APIKey: "backend-key", Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if authorization != "Bearer backend-key" || result.AudioBase64 != "UklGRg==" || result.Format != "wav" {
		t.Fatalf("authorization=%q result=%+v", authorization, result)
	}
	if upstream["model"] != "mimo-v2.5-tts" || strings.Contains(string(mustJSON(t, upstream)), "backend-key") {
		t.Fatalf("unsafe upstream=%#v", upstream)
	}
}

func TestClientValidatesAllowedModelsVoicesAndRequestSize(t *testing.T) {
	client := NewClient()
	models := []string{"mimo-v2-tts", "mimo-v2.5-tts", "mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign"}
	voices := []string{"mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean"}
	for _, model := range models {
		if err := Validate(Request{APIKey: "key", Model: model, Voice: "Mia", Text: "hello"}); err != nil {
			t.Fatalf("model %q: %v", model, err)
		}
	}
	for _, voice := range voices {
		if err := Validate(Request{APIKey: "key", Model: "mimo-v2.5-tts", Voice: voice, Text: "hello"}); err != nil {
			t.Fatalf("voice %q: %v", voice, err)
		}
	}
	for _, request := range []Request{
		{APIKey: "", Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello"},
		{APIKey: "key", Model: "bad", Voice: "Mia", Text: "hello"},
		{APIKey: "key", Model: "mimo-v2.5-tts", Voice: "bad", Text: "hello"},
		{APIKey: "key", Model: "mimo-v2.5-tts", Voice: "Mia", Text: strings.Repeat("x", 16*1024+1)},
	} {
		if _, err := client.Synthesize(context.Background(), request); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("request=%+v error=%v", request, err)
		}
	}
}

func TestClientBoundsResponseAndRedactsUpstreamErrors(t *testing.T) {
	secret := "never-echo-this-key"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/large" {
			_, _ = response.Write([]byte(strings.Repeat("x", 16*1024*1024+1)))
			return
		}
		response.WriteHeader(http.StatusBadGateway)
		_, _ = response.Write([]byte(strings.Repeat("x", 5000) + secret))
	}))
	defer server.Close()
	client := NewClient().(*clientImpl)
	request := Request{APIKey: secret, Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello"}

	client.endpoint = server.URL + "/large"
	if _, err := client.Synthesize(context.Background(), request); !errors.Is(err, ErrUnavailable) || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("large response error=%v", err)
	}
	client.endpoint = server.URL + "/error"
	if _, err := client.Synthesize(context.Background(), request); !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), secret) || len(err.Error()) > 512 {
		t.Fatalf("unsafe upstream error=%v", err)
	}
}

type blockingRoundTripper struct{}

func (blockingRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	<-request.Context().Done()
	return nil, request.Context().Err()
}

func TestClientAppliesRequestTimeout(t *testing.T) {
	client := NewClient().(*clientImpl)
	client.timeout = 20 * time.Millisecond
	client.http = &http.Client{Transport: blockingRoundTripper{}}
	started := time.Now()
	_, err := client.Synthesize(context.Background(), Request{APIKey: "key", Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello"})
	if !errors.Is(err, ErrUnavailable) || time.Since(started) > time.Second {
		t.Fatalf("timeout error=%v elapsed=%s", err, time.Since(started))
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
