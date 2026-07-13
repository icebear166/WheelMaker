package registry

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestInputLimitBoundaries(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		method       string
		messageBytes int
		payloadBytes int
		valid        bool
	}{
		{name: "normal payload limit minus one", method: "registry.project.list", messageBytes: maxJSONPayloadBytes - 1, payloadBytes: maxJSONPayloadBytes - 1, valid: true},
		{name: "normal payload limit", method: "registry.project.list", messageBytes: maxJSONPayloadBytes, payloadBytes: maxJSONPayloadBytes, valid: true},
		{name: "normal payload limit plus one", method: "registry.project.list", messageBytes: maxJSONPayloadBytes + 1, payloadBytes: maxJSONPayloadBytes + 1},
		{name: "normal envelope limit minus one", method: "registry.project.list", messageBytes: maxEnvelopeBytes - 1, valid: true},
		{name: "normal envelope limit", method: "registry.project.list", messageBytes: maxEnvelopeBytes, valid: true},
		{name: "normal envelope limit plus one", method: "registry.project.list", messageBytes: maxEnvelopeBytes + 1},
		{name: "speech payload limit minus one", method: speechMethodChunk, messageBytes: maxSpeechChunkPayloadBytes - 1, payloadBytes: maxSpeechChunkPayloadBytes - 1, valid: true},
		{name: "speech payload limit", method: speechMethodChunk, messageBytes: maxSpeechChunkPayloadBytes, payloadBytes: maxSpeechChunkPayloadBytes, valid: true},
		{name: "speech payload limit plus one", method: speechMethodChunk, messageBytes: maxSpeechChunkPayloadBytes + 1, payloadBytes: maxSpeechChunkPayloadBytes + 1},
		{name: "session read payload limit", method: rp.RegistryMethodSessionRead, messageBytes: maxSpeechChunkPayloadBytes, payloadBytes: maxSpeechChunkPayloadBytes, valid: true},
		{name: "session read payload limit plus one", method: rp.RegistryMethodSessionRead, messageBytes: maxSpeechChunkPayloadBytes + 1, payloadBytes: maxSpeechChunkPayloadBytes + 1},
		{name: "wire limit minus one", method: speechMethodChunk, messageBytes: maxWireMessageBytes - 1, valid: true},
		{name: "wire limit", method: speechMethodChunk, messageBytes: maxWireMessageBytes, valid: true},
		{name: "wire limit plus one", method: speechMethodChunk, messageBytes: maxWireMessageBytes + 1},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateRegistryInput(testCase.method, testCase.messageBytes, testCase.payloadBytes)
			if testCase.valid && err != nil {
				t.Fatalf("validateRegistryInput() err=%v", err)
			}
			if !testCase.valid && !errors.Is(err, errRegistryInputTooLarge) {
				t.Fatalf("validateRegistryInput() err=%v, want too large", err)
			}
		})
	}
}

func TestInputLimitRejectsSecondJSONAndTrailingGarbage(t *testing.T) {
	for _, message := range []string{
		`{"requestId":1,"type":"request","method":"connect.init","payload":{}} {}`,
		`{"requestId":1,"type":"request","method":"connect.init","payload":{}} trailing`,
	} {
		if _, _, err := decodeEnvelopeMessage([]byte(message)); err == nil {
			t.Fatalf("decodeEnvelopeMessage(%q) succeeded", message)
		}
	}
}

func TestInputLimitWebLoginIgnoresDeceptiveContentLength(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	body := `{"token":"` + strings.Repeat("x", maxWebLoginBodyBytes+1) + `"}`
	request := httptest.NewRequest(http.MethodPost, "https://registry.example/ws?auth=login", strings.NewReader(body))
	request.Host = "registry.example"
	request.ContentLength = 1
	request.Header.Set("Origin", "https://registry.example")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	response := httptest.NewRecorder()
	server.handleWebLogin(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d, want 413", response.Code)
	}
}

func TestInputLimitHTTPServerTimeouts(t *testing.T) {
	server := newRegistryHTTPServer("127.0.0.1:9630", http.NotFoundHandler())
	if server.ReadHeaderTimeout != 5*time.Second || server.ReadTimeout != 15*time.Second || server.WriteTimeout != 30*time.Second || server.IdleTimeout != 60*time.Second {
		t.Fatalf("registry server timeouts=%s/%s/%s/%s", server.ReadHeaderTimeout, server.ReadTimeout, server.WriteTimeout, server.IdleTimeout)
	}
}
