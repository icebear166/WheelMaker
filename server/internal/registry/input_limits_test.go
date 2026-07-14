package registry

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestInputLimitBoundaries(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		messageBytes int
		valid        bool
	}{
		{name: "limit minus one", messageBytes: 16*1024*1024 - 1, valid: true},
		{name: "limit", messageBytes: 16 * 1024 * 1024, valid: true},
		{name: "limit plus one", messageBytes: 16*1024*1024 + 1},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			message := registryMessageWithBytes(t, testCase.messageBytes)
			_, _, err := decodeEnvelopeMessage(message)
			if testCase.valid && err != nil {
				t.Fatalf("decodeEnvelopeMessage() err=%v", err)
			}
			if !testCase.valid && !errors.Is(err, errRegistryInputTooLarge) {
				t.Fatalf("decodeEnvelopeMessage() err=%v, want too large", err)
			}
		})
	}
}

func registryMessageWithBytes(t *testing.T, messageBytes int) []byte {
	t.Helper()
	prefix := `{"type":"event","method":"registry.project.list","payload":{"data":"`
	suffix := `"}}`
	padding := messageBytes - len(prefix) - len(suffix)
	if padding < 0 {
		t.Fatalf("messageBytes=%d is too small", messageBytes)
	}
	return []byte(prefix + strings.Repeat("x", padding) + suffix)
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
