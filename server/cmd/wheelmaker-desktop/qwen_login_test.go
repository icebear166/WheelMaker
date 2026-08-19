package main

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestExtractQwenOAuthAcceptsOnlyOAuthBundle(t *testing.T) {
	want := `{"accessToken":"qwen-access-token","refreshToken":"qwen-refresh-token"}`
	for _, input := range []string{want, `"` + strings.ReplaceAll(want, `"`, `\"`) + `"`} {
		if got := extractQwenOAuth(input); got != want {
			t.Fatalf("extractQwenOAuth(%q) = %q, want %q", input, got, want)
		}
	}
	for _, input := range []string{"", `{"token":"not-an-oauth-token"}`, `{"accessToken":"has whitespace"}`} {
		if got := extractQwenOAuth(input); got != "" {
			t.Fatalf("extractQwenOAuth(%q) = %q, want empty", input, got)
		}
	}
}

func TestQwenOAuthCallbackBundleAcceptsOfficialFieldsOnly(t *testing.T) {
	query := url.Values{
		"access_token":   {"qwen-access-token"},
		"refresh_token":  {"qwen-refresh-token"},
		"expires_at":     {"2026-08-20T12:00:00Z"},
		"console_region": {"cn-beijing"},
	}
	bundle := qwenOAuthCallbackBundle(query, "", nil)
	if !strings.Contains(bundle, `"accessToken":"qwen-access-token"`) || !strings.Contains(bundle, `"refreshToken":"qwen-refresh-token"`) {
		t.Fatalf("bundle=%s", bundle)
	}
	if strings.Contains(bundle, "cookie") || strings.Contains(bundle, "api_key") {
		t.Fatalf("callback bundle retained unrelated secret fields: %s", bundle)
	}
}

func TestQwenOAuthCallbackBundleParsesJSONDataWrapper(t *testing.T) {
	body := []byte(`{"data":{"access_token":"qwen-access-token","region":"cn-beijing","site":"domestic"},"cookie":"must-not-copy"}`)
	bundle := qwenOAuthCallbackBundle(nil, "application/json", body)
	if !strings.Contains(bundle, `"accessToken":"qwen-access-token"`) || !strings.Contains(bundle, `"region":"cn-beijing"`) {
		t.Fatalf("bundle=%s", bundle)
	}
	if strings.Contains(bundle, "cookie") {
		t.Fatalf("callback bundle retained cookie: %s", bundle)
	}
}

func TestQwenLoginCallbackRequiresStateBeforePublishingCredential(t *testing.T) {
	callback := &qwenLoginCallback{state: "state-1", result: make(chan string, 1), done: make(chan struct{})}
	wrong := httptest.NewRequest("GET", "/callback?state=wrong&access_token=secret", nil)
	wrongResponse := httptest.NewRecorder()
	callback.handle(wrongResponse, wrong)
	if wrongResponse.Code != 400 {
		t.Fatalf("wrong-state status=%d, want 400", wrongResponse.Code)
	}
	right := httptest.NewRequest("GET", "/callback?state=state-1&access_token=access-secret", nil)
	rightResponse := httptest.NewRecorder()
	callback.handle(rightResponse, right)
	if rightResponse.Code != 200 {
		t.Fatalf("valid callback status=%d, want 200", rightResponse.Code)
	}
	if got := <-callback.result; !strings.Contains(got, `"accessToken":"access-secret"`) {
		t.Fatalf("callback bundle=%s", got)
	}
}
