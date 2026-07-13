package portrelay

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

type failAfterReader struct {
	remaining int
}

func newTestController(t *testing.T, cfg ControllerConfig) *Controller {
	t.Helper()
	controller, err := NewController(cfg)
	if err != nil {
		t.Fatalf("NewController(): %v", err)
	}
	return controller
}

func markRelayTopLevelNavigation(request *http.Request) {
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	request.Header.Set("Sec-Fetch-Dest", "document")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
}

func (r *failAfterReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.ErrUnexpectedEOF
	}
	n := len(p)
	if n > r.remaining {
		n = r.remaining
	}
	for index := 0; index < n; index++ {
		p[index] = byte(index + 1)
	}
	r.remaining -= n
	return n, nil
}

func TestControllerRandomFailureFailsClosed(t *testing.T) {
	if controller, err := NewController(ControllerConfig{Random: &failAfterReader{}}); err == nil || controller != nil {
		t.Fatalf("NewController() controller=%v err=%v, want random failure", controller, err)
	}

	for _, testCase := range []struct {
		name      string
		remaining int
	}{
		{name: "relay id", remaining: 32},
		{name: "nonce", remaining: 32 + 16},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			forwardCalled := false
			controller, err := NewController(ControllerConfig{
				Random: &failAfterReader{remaining: testCase.remaining},
				ForwardHubRequest: func(context.Context, string, string, any) ControlResult {
					forwardCalled = true
					return ControlResult{}
				},
			})
			if err != nil {
				t.Fatalf("NewController(): %v", err)
			}
			_, failure := controller.Enable(context.Background(), rp.RelayEnablePayload{
				ListenPort: reserveRelayTestPort(t),
				HubID:      "hub-local",
				TargetHost: "127.0.0.1",
				TargetPort: 80,
				AccessCode: "123456",
			}, "127.0.0.1:9630", false)
			if failure == nil || failure.Code != rp.CodeInternal {
				t.Fatalf("Enable() failure=%#v, want internal random failure", failure)
			}
			if controller.listener != nil || forwardCalled {
				t.Fatalf("random failure started relay listener=%v forwardCalled=%v", controller.listener != nil, forwardCalled)
			}
		})
	}
}

func TestRelayListenerBindsLoopbackOnly(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve relay listener port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	listener, err := newRelayListener(port, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	if err != nil {
		t.Fatalf("newRelayListener() err=%v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	addr, ok := listener.ln.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("listener addr=%T, want *net.TCPAddr", listener.ln.Addr())
	}
	if !addr.IP.Equal(net.ParseIP("127.0.0.1")) {
		t.Fatalf("listener IP=%s, want 127.0.0.1", addr.IP.String())
	}
}

func TestFilterRequestHeadersDropsConditionalCacheHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set("If-None-Match", `"empty-index"`)
	headers.Set("If-Modified-Since", "Sat, 23 May 2026 00:00:00 GMT")
	headers.Set("If-Match", `"current"`)
	headers.Set("If-Unmodified-Since", "Sat, 23 May 2026 00:00:00 GMT")
	headers.Set("If-Range", `"range"`)
	headers.Set("Accept-Encoding", "gzip, br")
	headers.Set("Accept", "text/html")

	filtered := filterRequestHeaders(headers)

	for _, name := range []string{"If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "If-Range"} {
		if _, ok := filtered[name]; ok {
			t.Fatalf("filterRequestHeaders forwarded %s: %#v", name, filtered)
		}
	}
	if got := filtered["Accept"]; len(got) != 1 || got[0] != "text/html" {
		t.Fatalf("filterRequestHeaders dropped Accept: %#v", filtered)
	}
	if got := filtered["Accept-Encoding"]; len(got) != 1 || got[0] != "gzip, br" {
		t.Fatalf("filterRequestHeaders dropped Accept-Encoding: %#v", filtered)
	}
}

func TestFilterRequestHeadersPreservesTargetCookiesExceptRelayAuth(t *testing.T) {
	headers := http.Header{}
	headers.Add("Cookie", "wm_port_relay=relay-secret; breezecara_session=target-session; theme=light")
	headers.Add("Cookie", "another=target-cookie")
	headers.Set("Accept", "application/json")

	filtered := filterRequestHeaders(headers)

	got := filtered["Cookie"]
	want := []string{"breezecara_session=target-session; theme=light", "another=target-cookie"}
	if len(got) != len(want) {
		t.Fatalf("Cookie headers=%#v, want %#v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("Cookie headers=%#v, want %#v", got, want)
		}
	}
	if strings.Contains(strings.Join(got, "; "), relayCookieName+"=") {
		t.Fatalf("Cookie headers leaked relay auth cookie: %#v", got)
	}
	if got := filtered["Accept"]; len(got) != 1 || got[0] != "application/json" {
		t.Fatalf("filterRequestHeaders dropped Accept: %#v", filtered)
	}
}

func TestCopyResponseHeadersDropsContentLength(t *testing.T) {
	src := map[string][]string{
		"Content-Length": {"1234"},
		"Content-Type":   {"application/javascript"},
	}
	dst := http.Header{}

	copyResponseHeaders(dst, src, false)

	if got := dst.Get("Content-Length"); got != "" {
		t.Fatalf("copyResponseHeaders forwarded Content-Length=%q", got)
	}
	if got := dst.Get("Content-Type"); got != "application/javascript" {
		t.Fatalf("copyResponseHeaders Content-Type=%q, want application/javascript", got)
	}
}

func TestCopyResponseHeadersAllowsRelayEmbedding(t *testing.T) {
	src := map[string][]string{
		"Content-Security-Policy":             {"default-src 'self'; frame-ancestors 'none'; connect-src ws: wss:"},
		"Content-Security-Policy-Report-Only": {"frame-ancestors https://example.com; script-src 'self'"},
		"X-Frame-Options":                     {"DENY"},
		"Content-Type":                        {"text/html"},
	}
	dst := http.Header{}

	copyResponseHeaders(dst, src, false)

	if got := dst.Get("X-Frame-Options"); got != "" {
		t.Fatalf("X-Frame-Options=%q, want empty", got)
	}
	if got := dst.Get("Content-Security-Policy"); got != "default-src 'self'; connect-src ws: wss:" {
		t.Fatalf("Content-Security-Policy=%q, want frame-ancestors removed", got)
	}
	if got := dst.Get("Content-Security-Policy-Report-Only"); got != "script-src 'self'" {
		t.Fatalf("Content-Security-Policy-Report-Only=%q, want frame-ancestors removed", got)
	}
	if got := dst.Get("Content-Type"); got != "text/html" {
		t.Fatalf("Content-Type=%q, want text/html", got)
	}
}

func TestCopyResponseHeadersMakesTargetCookiesEmbeddableForHTTPSRelay(t *testing.T) {
	src := map[string][]string{
		"Set-Cookie": {
			"breezecara_session=target-session; Path=/; Expires=Wed, 24 Jun 2026 11:43:36 GMT; HttpOnly; SameSite=Lax",
			relayCookieName + "=relay-secret; Path=/; HttpOnly; Secure; SameSite=None",
		},
	}
	dst := http.Header{}

	copyResponseHeaders(dst, src, true)

	got := dst.Values("Set-Cookie")
	if len(got) != 1 {
		t.Fatalf("Set-Cookie values=%#v, want only target cookie", got)
	}
	if !strings.Contains(got[0], "breezecara_session=target-session") {
		t.Fatalf("Set-Cookie=%q, want target session cookie", got[0])
	}
	if !strings.Contains(got[0], "Secure") {
		t.Fatalf("Set-Cookie=%q, want Secure for HTTPS iframe embedding", got[0])
	}
	if !strings.Contains(got[0], "SameSite=None") {
		t.Fatalf("Set-Cookie=%q, want SameSite=None for HTTPS iframe embedding", got[0])
	}
	if strings.Contains(got[0], "SameSite=Lax") {
		t.Fatalf("Set-Cookie=%q, must not keep SameSite=Lax for embedded relay", got[0])
	}
}

func TestCopyWebSocketResponseHeadersKeepsSubprotocolAndDropsExtensions(t *testing.T) {
	src := map[string][]string{
		"Sec-Websocket-Protocol":   {"vite-hmr"},
		"Sec-Websocket-Accept":     {"target-accept"},
		"Sec-Websocket-Extensions": {"permessage-deflate"},
		"Content-Length":           {"12"},
	}

	dst := copyWebSocketResponseHeaders(src)

	if got := dst.Get("Sec-Websocket-Protocol"); got != "vite-hmr" {
		t.Fatalf("Sec-Websocket-Protocol=%q, want vite-hmr", got)
	}
	if got := dst.Get("Sec-Websocket-Extensions"); got != "" {
		t.Fatalf("Sec-Websocket-Extensions=%q, want empty", got)
	}
	if got := dst.Get("Sec-Websocket-Accept"); got != "" {
		t.Fatalf("Sec-Websocket-Accept=%q, want empty", got)
	}
	if got := dst.Get("Content-Length"); got != "" {
		t.Fatalf("Content-Length=%q, want empty", got)
	}
}

func TestRelayEnableAllowsOnlyExactLoopbackTargetHost(t *testing.T) {
	c := newTestController(t, ControllerConfig{
		RegistryAddr: "127.0.0.1:9630",
		ForwardHubRequest: func(context.Context, string, string, any) ControlResult {
			t.Fatal("ForwardHubRequest must not be called for invalid targetHost")
			return ControlResult{}
		},
	})
	for _, targetHost := range []string{"localhost", "0.0.0.0", "::1", "127.0.0.2", "127.1.2.3"} {
		t.Run(targetHost, func(t *testing.T) {
			_, errPayload := c.Enable(context.Background(), rp.RelayEnablePayload{
				ListenPort: reserveRelayTestPort(t),
				HubID:      "hub-local",
				TargetHost: targetHost,
				TargetPort: 80,
				AccessCode: "123456",
			}, "127.0.0.1:9630", false)
			if errPayload == nil || errPayload.Code != rp.CodeInvalidArgument {
				t.Fatalf("Enable targetHost=%q err=%#v, want invalid_argument", targetHost, errPayload)
			}
			if !strings.Contains(errPayload.Message, "127.0.0.1") {
				t.Fatalf("Enable targetHost=%q message=%q, want explicit loopback constraint", targetHost, errPayload.Message)
			}
		})
	}
}

func TestRelayLoginFlowUsesSafeRelativeNextAndHidesMappingInfo(t *testing.T) {
	c := newTestController(t, ControllerConfig{})
	c.mu.Lock()
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		HubID:                "private-hub",
		TargetHost:           "127.0.0.1",
		TargetPort:           5173,
		AccessCode:           "123456",
		AccessCodeGeneration: 1,
	}
	c.mu.Unlock()

	pageReq := httptest.NewRequest(http.MethodGet, internalLoginPath+"?error=1&next=%2Fconsole%3Ftab%3Drelay", nil)
	pageResp := httptest.NewRecorder()
	c.handleLogin(pageResp, pageReq)
	if pageResp.Code != http.StatusOK {
		t.Fatalf("login page status=%d, want 200", pageResp.Code)
	}
	body := pageResp.Body.String()
	for _, want := range []string{"WheelMaker Port Relay", "Invalid access code", `maxlength="6"`, `name="next" value="/console?tab=relay"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("login page missing %q:\n%s", want, body)
		}
	}
	for _, leaked := range []string{"private-hub", "5173", "127.0.0.1"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("login page leaked mapping value %q:\n%s", leaked, body)
		}
	}

	badForm := url.Values{"code": {"000000"}, "next": {"/console?tab=relay"}}
	badReq := httptest.NewRequest(http.MethodPost, internalLoginPath, strings.NewReader(badForm.Encode()))
	badReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	badReq.Header.Set("Origin", "http://example.com")
	badResp := httptest.NewRecorder()
	c.handleLogin(badResp, badReq)
	if badResp.Code != http.StatusSeeOther {
		t.Fatalf("bad login status=%d, want 303", badResp.Code)
	}
	if got := badResp.Header().Get("Location"); got != internalLoginPath+"?error=1&next=%2Fconsole%3Ftab%3Drelay" {
		t.Fatalf("bad login Location=%q", got)
	}

	goodForm := url.Values{"code": {"123456"}, "next": {"https://evil.example/steal"}}
	goodReq := httptest.NewRequest(http.MethodPost, internalLoginPath, strings.NewReader(goodForm.Encode()))
	goodReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	goodReq.Header.Set("Origin", "http://example.com")
	goodResp := httptest.NewRecorder()
	c.handleLogin(goodResp, goodReq)
	if goodResp.Code != http.StatusSeeOther {
		t.Fatalf("good login status=%d, want 303", goodResp.Code)
	}
	if got := goodResp.Header().Get("Location"); got != "/" {
		t.Fatalf("good login unsafe next Location=%q, want /", got)
	}
	if got := goodResp.Header().Get("Set-Cookie"); !strings.Contains(got, relayCookieName+"=") {
		t.Fatalf("good login missing relay auth cookie: %q", got)
	}
}

func TestUnauthenticatedRelayRequestRedirectsToLoginWithNext(t *testing.T) {
	c := newTestController(t, ControllerConfig{})
	c.mu.Lock()
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		AccessCode:           "123456",
		AccessCodeGeneration: 1,
	}
	c.mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/console?tab=relay", nil)
	resp := httptest.NewRecorder()
	c.handleDataPlane(resp, req)

	if resp.Code != http.StatusSeeOther {
		t.Fatalf("unauthenticated status=%d, want 303", resp.Code)
	}
	if got := resp.Header().Get("Location"); got != internalLoginPath+"?next=%2Fconsole%3Ftab%3Drelay" {
		t.Fatalf("unauthenticated Location=%q", got)
	}
}

func TestRelayURLAccessCodeAuthenticatesAndStripsCodeQuery(t *testing.T) {
	c := newTestController(t, ControllerConfig{})
	c.mu.Lock()
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		RelayID:              "relay-test",
		AccessCode:           "123456",
		AccessCodeGeneration: 1,
	}
	c.mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/console?tab=relay&__wm_relay_code=123456&x=1", nil)
	markRelayTopLevelNavigation(req)
	resp := httptest.NewRecorder()
	c.handleDataPlane(resp, req)

	if resp.Code != http.StatusSeeOther {
		t.Fatalf("inline code status=%d, want 303", resp.Code)
	}
	if got := resp.Header().Get("Location"); got != "/console?tab=relay&x=1" {
		t.Fatalf("inline code Location=%q, want code-stripped target", got)
	}
	if got := resp.Header().Get("Set-Cookie"); !strings.Contains(got, relayCookieName+"=") {
		t.Fatalf("inline code missing relay auth cookie: %q", got)
	}

	badReq := httptest.NewRequest(http.MethodGet, "/console?tab=relay&__wm_relay_code=000000", nil)
	markRelayTopLevelNavigation(badReq)
	badResp := httptest.NewRecorder()
	c.handleDataPlane(badResp, badReq)

	if badResp.Code != http.StatusSeeOther {
		t.Fatalf("bad inline code status=%d, want 303", badResp.Code)
	}
	if got := badResp.Header().Get("Location"); got != internalLoginPath+"?error=1&next=%2Fconsole%3Ftab%3Drelay" {
		t.Fatalf("bad inline code Location=%q, want login without leaked code", got)
	}
	if strings.Contains(badResp.Header().Get("Location"), "__wm_relay_code") {
		t.Fatalf("bad inline code leaked code query in Location=%q", badResp.Header().Get("Location"))
	}
}

func TestRelayURLAccessCodeUsesEmbeddableCookieForForwardedHTTPS(t *testing.T) {
	c := newTestController(t, ControllerConfig{})
	c.mu.Lock()
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		RelayID:              "relay-test",
		AccessCode:           "123456",
		AccessCodeGeneration: 1,
	}
	c.mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/console?__wm_relay_code=123456", nil)
	markRelayTopLevelNavigation(req)
	req.RemoteAddr = "127.0.0.1:50000"
	req.Header.Set("X-Forwarded-Proto", "https")
	resp := httptest.NewRecorder()
	c.handleDataPlane(resp, req)

	setCookie := resp.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "SameSite=None") {
		t.Fatalf("Set-Cookie=%q, want SameSite=None for HTTPS iframe embedding", setCookie)
	}
	if !strings.Contains(setCookie, "Secure") {
		t.Fatalf("Set-Cookie=%q, want Secure for SameSite=None", setCookie)
	}
}

func TestRelayClearSiteDataPageClearsOriginStorageAndReauthenticatesWithURLCode(t *testing.T) {
	c := newTestController(t, ControllerConfig{})
	c.mu.Lock()
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		RelayID:              "relay-test",
		AccessCode:           "123456",
		AccessCodeGeneration: 1,
	}
	c.mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, internalClearSiteDataPath+"?next=%2Fconsole%3Ftab%3Drelay&__wm_relay_code=123456", nil)
	req.RemoteAddr = "127.0.0.1:50000"
	req.Header.Set("X-Forwarded-Proto", "https")
	resp := httptest.NewRecorder()

	c.handleDataPlane(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("clear site data status=%d, want 200", resp.Code)
	}
	if got := resp.Header().Get("Clear-Site-Data"); got != `"cache", "storage"` {
		t.Fatalf("Clear-Site-Data=%q, want cache and storage only", got)
	}
	setCookie := resp.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, relayCookieName+"=") {
		t.Fatalf("clear site data missing relay auth cookie: %q", setCookie)
	}
	body := resp.Body.String()
	for _, want := range []string{
		"navigator.serviceWorker.getRegistrations",
		"caches.keys",
		"localStorage.clear",
		"sessionStorage.clear",
		`window.location.replace("/console?tab=relay")`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("clear site data page missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "123456") {
		t.Fatalf("clear site data page leaked access code:\n%s", body)
	}
}

func TestRelayClearSiteDataPageRequiresAuthOrValidURLCode(t *testing.T) {
	c := newTestController(t, ControllerConfig{})
	c.mu.Lock()
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		RelayID:              "relay-test",
		AccessCode:           "123456",
		AccessCodeGeneration: 1,
	}
	c.mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, internalClearSiteDataPath+"?next=%2Fconsole&__wm_relay_code=000000", nil)
	resp := httptest.NewRecorder()
	c.handleDataPlane(resp, req)

	if resp.Code != http.StatusSeeOther {
		t.Fatalf("bad clear code status=%d, want 303", resp.Code)
	}
	if got := resp.Header().Get("Location"); got != internalLoginPath+"?error=1&next=%2Fconsole" {
		t.Fatalf("bad clear code Location=%q", got)
	}

	unauthReq := httptest.NewRequest(http.MethodGet, internalClearSiteDataPath+"?next=%2Fconsole", nil)
	unauthResp := httptest.NewRecorder()
	c.handleDataPlane(unauthResp, unauthReq)

	if unauthResp.Code != http.StatusSeeOther {
		t.Fatalf("unauth clear status=%d, want 303", unauthResp.Code)
	}
	if got := unauthResp.Header().Get("Location"); got != internalLoginPath+"?next=%2Fconsole" {
		t.Fatalf("unauth clear Location=%q", got)
	}
}

func TestRelayLoginPostUsesEmbeddableCookieForForwardedHTTPS(t *testing.T) {
	c := newTestController(t, ControllerConfig{})
	c.mu.Lock()
	c.slot = relaySlot{
		Enabled:              true,
		Status:               rp.RelayStatusOpening,
		RelayID:              "relay-test",
		AccessCode:           "123456",
		AccessCodeGeneration: 1,
	}
	c.mu.Unlock()

	form := url.Values{"code": {"123456"}, "next": {"/console"}}
	req := httptest.NewRequest(http.MethodPost, internalLoginPath, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", "https://example.com")
	req.RemoteAddr = "127.0.0.1:50000"
	req.Header.Set("X-Forwarded-Proto", "https")
	resp := httptest.NewRecorder()
	c.handleLogin(resp, req)

	setCookie := resp.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "SameSite=None") {
		t.Fatalf("Set-Cookie=%q, want SameSite=None for HTTPS iframe embedding", setCookie)
	}
	if !strings.Contains(setCookie, "Secure") {
		t.Fatalf("Set-Cookie=%q, want Secure for SameSite=None", setCookie)
	}
	if got := resp.Header().Get("Location"); got != "/console" {
		t.Fatalf("Location=%q, want /console", got)
	}
}

func TestRelayLoginOriginValidation(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		origin     string
		remoteAddr string
		forwarded  string
		wantStatus int
	}{
		{name: "same origin", origin: "https://relay.example.com", remoteAddr: "127.0.0.1:50000", forwarded: "https", wantStatus: http.StatusSeeOther},
		{name: "missing origin", remoteAddr: "127.0.0.1:50000", forwarded: "https", wantStatus: http.StatusForbidden},
		{name: "cross origin", origin: "https://attacker.example", remoteAddr: "127.0.0.1:50000", forwarded: "https", wantStatus: http.StatusForbidden},
		{name: "untrusted forwarded scheme", origin: "https://relay.example.com", remoteAddr: "198.51.100.8:50000", forwarded: "https", wantStatus: http.StatusForbidden},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			controller := newTestController(t, ControllerConfig{})
			controller.mu.Lock()
			controller.slot = relaySlot{Enabled: true, RelayID: "relay-test", AccessCode: "123456", AccessCodeGeneration: 1}
			controller.mu.Unlock()

			form := url.Values{"code": {"123456"}, "next": {"/console"}}
			request := httptest.NewRequest(http.MethodPost, "http://relay.example.com"+internalLoginPath, strings.NewReader(form.Encode()))
			request.RemoteAddr = testCase.remoteAddr
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			request.Header.Set("Origin", testCase.origin)
			request.Header.Set("X-Forwarded-Proto", testCase.forwarded)
			response := httptest.NewRecorder()
			controller.handleDataPlane(response, request)
			if response.Code != testCase.wantStatus {
				t.Fatalf("status=%d, want %d", response.Code, testCase.wantStatus)
			}
		})
	}
}

func TestRelayURLCodeFetchMetadataValidation(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		method     string
		mode       string
		dest       string
		site       string
		wantStatus int
	}{
		{name: "same origin navigation", method: http.MethodGet, mode: "navigate", dest: "document", site: "same-origin", wantStatus: http.StatusSeeOther},
		{name: "direct navigation", method: http.MethodGet, mode: "navigate", dest: "document", site: "none", wantStatus: http.StatusSeeOther},
		{name: "post", method: http.MethodPost, mode: "navigate", dest: "document", site: "same-origin", wantStatus: http.StatusForbidden},
		{name: "missing metadata", method: http.MethodGet, wantStatus: http.StatusForbidden},
		{name: "iframe", method: http.MethodGet, mode: "navigate", dest: "iframe", site: "same-origin", wantStatus: http.StatusForbidden},
		{name: "cors", method: http.MethodGet, mode: "cors", dest: "document", site: "same-origin", wantStatus: http.StatusForbidden},
		{name: "no cors", method: http.MethodGet, mode: "no-cors", dest: "document", site: "same-origin", wantStatus: http.StatusForbidden},
		{name: "cross site", method: http.MethodGet, mode: "navigate", dest: "document", site: "cross-site", wantStatus: http.StatusForbidden},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			controller := newTestController(t, ControllerConfig{})
			controller.mu.Lock()
			controller.slot = relaySlot{Enabled: true, RelayID: "relay-test", AccessCode: "123456", AccessCodeGeneration: 1}
			controller.mu.Unlock()

			request := httptest.NewRequest(testCase.method, "http://relay.example.com/console?__wm_relay_code=123456&tab=relay", nil)
			request.Header.Set("Sec-Fetch-Mode", testCase.mode)
			request.Header.Set("Sec-Fetch-Dest", testCase.dest)
			request.Header.Set("Sec-Fetch-Site", testCase.site)
			response := httptest.NewRecorder()
			controller.handleDataPlane(response, request)
			if response.Code != testCase.wantStatus {
				t.Fatalf("status=%d, want %d", response.Code, testCase.wantStatus)
			}
			if testCase.wantStatus == http.StatusSeeOther {
				if location := response.Header().Get("Location"); location != "/console?tab=relay" {
					t.Fatalf("Location=%q, want code-stripped redirect", location)
				}
			}
		})
	}
}

func TestRelayForwardedHeadersRequireLoopbackPeer(t *testing.T) {
	trusted := httptest.NewRequest(http.MethodGet, "http://relay.example.com/", nil)
	trusted.RemoteAddr = "127.0.0.1:50000"
	trusted.Header.Set("X-Forwarded-Proto", "https")
	trusted.Header.Set("X-Real-IP", "203.0.113.9")
	if !relayRequestIsHTTPS(trusted) || relayRequestSource(trusted) != "203.0.113.9" {
		t.Fatalf("trusted proxy resolved https=%t source=%q", relayRequestIsHTTPS(trusted), relayRequestSource(trusted))
	}

	untrusted := trusted.Clone(trusted.Context())
	untrusted.RemoteAddr = "198.51.100.7:50000"
	if relayRequestIsHTTPS(untrusted) || relayRequestSource(untrusted) != "198.51.100.7" {
		t.Fatalf("untrusted peer resolved https=%t source=%q", relayRequestIsHTTPS(untrusted), relayRequestSource(untrusted))
	}
}

func TestRelaySensitiveResponsesSetHeaders(t *testing.T) {
	controller := newTestController(t, ControllerConfig{})
	controller.mu.Lock()
	controller.slot = relaySlot{Enabled: true, RelayID: "relay-test", AccessCode: "123456", AccessCodeGeneration: 1}
	controller.mu.Unlock()

	for _, target := range []string{
		internalLoginPath,
		internalStatusPath,
		"/console?__wm_relay_code=000000",
	} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		if strings.Contains(target, relayURLCodeParam) {
			markRelayTopLevelNavigation(request)
		}
		response := httptest.NewRecorder()
		controller.handleDataPlane(response, request)
		if got := response.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s Cache-Control=%q", target, got)
		}
		if got := response.Header().Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("%s Referrer-Policy=%q", target, got)
		}
	}
}

func TestRelayListenerHeadersAndTimeouts(t *testing.T) {
	listener, err := newRelayListener(0, http.NotFoundHandler())
	if err != nil {
		t.Fatalf("newRelayListener(): %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	if listener.srv.ReadHeaderTimeout != 5*time.Second || listener.srv.ReadTimeout != 15*time.Second || listener.srv.WriteTimeout != 30*time.Second || listener.srv.IdleTimeout != 60*time.Second {
		t.Fatalf("relay server timeouts=%s/%s/%s/%s", listener.srv.ReadHeaderTimeout, listener.srv.ReadTimeout, listener.srv.WriteTimeout, listener.srv.IdleTimeout)
	}
}

func reserveRelayTestPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve relay test port: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestFrameCodecRoundTripBinaryPayload(t *testing.T) {
	frame := Frame{
		Type:     FrameData,
		Flags:    FlagWebSocketBinary,
		StreamID: 42,
		Meta:     []byte(`{"kind":"websocket"}`),
		Payload:  []byte{0, 1, 2, 255},
	}

	encoded, err := EncodeFrame(frame)
	if err != nil {
		t.Fatalf("EncodeFrame() err=%v", err)
	}
	decoded, err := DecodeFrame(encoded)
	if err != nil {
		t.Fatalf("DecodeFrame() err=%v", err)
	}

	if decoded.Type != frame.Type || decoded.Flags != frame.Flags || decoded.StreamID != frame.StreamID {
		t.Fatalf("decoded header=%#v, want %#v", decoded, frame)
	}
	if !bytes.Equal(decoded.Meta, frame.Meta) {
		t.Fatalf("decoded meta=%q, want %q", decoded.Meta, frame.Meta)
	}
	if !bytes.Equal(decoded.Payload, frame.Payload) {
		t.Fatalf("decoded payload=%v, want %v", decoded.Payload, frame.Payload)
	}
}

func TestFrameCodecRejectsBadMagic(t *testing.T) {
	encoded, err := EncodeFrame(Frame{Type: FramePing, StreamID: 1})
	if err != nil {
		t.Fatalf("EncodeFrame() err=%v", err)
	}
	encoded[0] = 'X'

	if _, err := DecodeFrame(encoded); err == nil {
		t.Fatal("DecodeFrame() err=nil, want bad magic error")
	}
}

func TestFrameCodecRejectsOversizedMetadata(t *testing.T) {
	_, err := EncodeFrame(Frame{
		Type:     FrameOpen,
		StreamID: 1,
		Meta:     bytes.Repeat([]byte{'a'}, maxFrameMetaBytes+1),
	})
	if err == nil {
		t.Fatal("EncodeFrame() err=nil, want metadata size error")
	}
}

func TestApplyTargetHeadersDropsExternalBrowserContextHeaders(t *testing.T) {
	dst := http.Header{}
	applyTargetHeaders(dst, map[string][]string{
		"Origin":  {"https://vimernas.myqnapcloud.com:28801"},
		"Referer": {"https://vimernas.myqnapcloud.com:28801/"},
		"Accept":  {"text/html"},
	})

	if got := dst.Get("Origin"); got != "" {
		t.Fatalf("applyTargetHeaders forwarded Origin=%q", got)
	}
	if got := dst.Get("Referer"); got != "" {
		t.Fatalf("applyTargetHeaders forwarded Referer=%q", got)
	}
	if got := dst.Get("Accept"); got != "text/html" {
		t.Fatalf("applyTargetHeaders Accept=%q, want text/html", got)
	}
}

func TestTargetOriginForWebSocketURLUsesHTTPOrigin(t *testing.T) {
	if got := targetOriginForURL("ws://127.0.0.1:5173/?token=abc"); got != "http://127.0.0.1:5173" {
		t.Fatalf("targetOriginForURL()=%q", got)
	}
}

func TestHubClientOpenAllowsOnlyExactLoopbackTargetHost(t *testing.T) {
	client := NewHubClient()
	for _, targetHost := range []string{"localhost", "0.0.0.0", "::1", "127.0.0.2", "127.1.2.3"} {
		t.Run(targetHost, func(t *testing.T) {
			err := client.Open(rp.RelayOpenPayload{
				RelayID:    "relay_test",
				RelayURL:   "ws://127.0.0.1:9/__wheelmaker/relay/hub",
				Nonce:      "nonce",
				TargetHost: targetHost,
				TargetPort: 80,
			})
			if err == nil {
				t.Fatalf("Open targetHost=%q succeeded, want error", targetHost)
			}
		})
	}
}

func TestRegistryTunnelRouteBackpressuresInsteadOfDroppingDataFrames(t *testing.T) {
	tunnel := newRegistryTunnel(nil, nil)
	stream := &registryStream{
		id:      1,
		tunnel:  tunnel,
		headers: make(chan Frame, 1),
		frames:  make(chan Frame, 1),
		closed:  make(chan struct{}),
	}
	tunnel.streams[stream.id] = stream

	tunnel.route(Frame{Type: FrameData, StreamID: stream.id, Payload: []byte("first")})

	delivered := make(chan struct{})
	go func() {
		tunnel.route(Frame{Type: FrameData, StreamID: stream.id, Payload: []byte("second")})
		close(delivered)
	}()

	select {
	case <-delivered:
		t.Fatalf("route returned while the stream frame buffer was full; data frames must not be dropped")
	case <-time.After(20 * time.Millisecond):
	}

	first := <-stream.frames
	if string(first.Payload) != "first" {
		t.Fatalf("first payload=%q, want first", string(first.Payload))
	}

	select {
	case <-delivered:
	case <-time.After(time.Second):
		t.Fatalf("route did not resume after the stream frame buffer had space")
	}

	second := <-stream.frames
	if string(second.Payload) != "second" {
		t.Fatalf("second payload=%q, want second", string(second.Payload))
	}
}
