package registry

import (
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/security"
)

type securityE2EProxy struct {
	t        *testing.T
	stateDir string
	target   atomic.Pointer[url.URL]
	backend  *httptest.Server
	public   *httptest.Server
}

func newSecurityE2EProxy(t *testing.T, token string) *securityE2EProxy {
	t.Helper()
	fixture := &securityE2EProxy{t: t, stateDir: t.TempDir()}
	fixture.startRegistry(token)

	proxy := &httputil.ReverseProxy{Director: func(request *http.Request) {
		target := fixture.target.Load()
		request.URL.Scheme = target.Scheme
		request.URL.Host = target.Host
		request.Header.Set("X-Forwarded-Proto", "https")
		request.Header.Set("X-Real-IP", "203.0.113.10")
	}}
	fixture.public = httptest.NewServer(proxy)
	t.Cleanup(fixture.public.Close)
	return fixture
}

func (f *securityE2EProxy) startRegistry(token string) {
	f.t.Helper()
	if f.backend != nil {
		f.backend.CloseClientConnections()
		f.backend.Close()
	}
	server := New(Config{Token: token, StateDir: f.stateDir})
	if err := server.webSessions.Load(); err != nil {
		f.t.Fatalf("load registry sessions: %v", err)
	}
	f.backend = httptest.NewServer(server.Handler())
	target, err := url.Parse(f.backend.URL)
	if err != nil {
		f.t.Fatalf("parse registry backend URL: %v", err)
	}
	f.target.Store(target)
	f.t.Cleanup(f.backend.Close)
}

func (f *securityE2EProxy) origin() string {
	return "https://" + strings.TrimPrefix(f.public.URL, "http://")
}

func (f *securityE2EProxy) authRequest(method, basePath, action, body, origin string, cookie *http.Cookie) *http.Response {
	f.t.Helper()
	requestURL := f.public.URL + strings.TrimSuffix(basePath, "/") + "/ws?auth=" + action
	request, err := http.NewRequest(method, requestURL, strings.NewReader(body))
	if err != nil {
		f.t.Fatalf("create %s request: %v", action, err)
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
		request.Header.Set("Sec-Fetch-Site", "same-origin")
		request.Header.Set("Sec-Fetch-Mode", "cors")
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		f.t.Fatalf("perform %s request: %v", action, err)
	}
	return response
}

type securityE2EAuthStatus struct {
	Authenticated bool   `json:"authenticated"`
	CSRFToken     string `json:"csrfToken"`
	Device        struct {
		DeviceID string `json:"deviceId"`
		BasePath string `json:"basePath"`
	} `json:"device"`
}

func securityE2EReadStatus(t *testing.T, response *http.Response) securityE2EAuthStatus {
	t.Helper()
	defer response.Body.Close()
	var status securityE2EAuthStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("decode auth status: %v", err)
	}
	return status
}

func securityE2ELogin(t *testing.T, fixture *securityE2EProxy, token, basePath, deviceName string) (*http.Cookie, securityE2EAuthStatus) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"token": token, "deviceName": deviceName})
	if err != nil {
		t.Fatalf("encode login request: %v", err)
	}
	response := fixture.authRequest(http.MethodPost, basePath, "login", string(body), fixture.origin(), nil)
	if response.StatusCode != http.StatusOK || len(response.Cookies()) != 1 {
		status := response.StatusCode
		_ = response.Body.Close()
		t.Fatalf("login status=%d cookies=%d", status, len(response.Cookies()))
	}
	cookie := response.Cookies()[0]
	_ = response.Body.Close()
	statusResponse := fixture.authRequest(http.MethodGet, basePath, "status", "", "", cookie)
	status := securityE2EReadStatus(t, statusResponse)
	if !status.Authenticated || status.CSRFToken == "" || status.Device.DeviceID == "" || status.Device.BasePath != basePath {
		t.Fatalf("login status payload=%+v", status)
	}
	return cookie, status
}

func securityE2EConnectBrowser(t *testing.T, fixture *securityE2EProxy, basePath string, cookie *http.Cookie) *websocket.Conn {
	t.Helper()
	wsURL := "ws://" + strings.TrimPrefix(fixture.public.URL, "http://") + strings.TrimSuffix(basePath, "/") + "/ws"
	header := http.Header{
		"Origin": []string{fixture.origin()},
		"Cookie": []string{cookie.String()},
	}
	connection, response, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if response != nil {
			t.Fatalf("dial browser websocket: status=%d err=%v", response.StatusCode, err)
		}
		t.Fatalf("dial browser websocket: %v", err)
	}
	mustWriteJSON(t, connection, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wheelmaker-web", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion, "role": "client",
	}})
	if response := mustReadEnvelope(t, connection); response.Type != "response" {
		_ = connection.Close()
		t.Fatalf("connect.init response=%+v", response)
	}
	return connection
}

func securityE2ERandomToken(t *testing.T) string {
	t.Helper()
	token, err := security.NewRegistryToken(rand.Reader)
	if err != nil {
		t.Fatalf("generate test token: %v", err)
	}
	return token
}

func TestSecurityE2EProxySessionLifecycle(t *testing.T) {
	for _, basePath := range []string{"/", "/wheelmaker/"} {
		t.Run(basePath, func(t *testing.T) {
			token := securityE2ERandomToken(t)
			fixture := newSecurityE2EProxy(t, token)

			initial := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", nil))
			if initial.Authenticated {
				t.Fatal("fresh browser unexpectedly authenticated")
			}

			cookie, device := securityE2ELogin(t, fixture, token, basePath, "Security E2E")
			if cookie.Path != basePath || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
				t.Fatalf("login cookie=%+v", cookie)
			}
			firstSocket := securityE2EConnectBrowser(t, fixture, basePath, cookie)
			defer firstSocket.Close()

			fixture.startRegistry(token)
			afterRestart := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", cookie))
			if !afterRestart.Authenticated || afterRestart.Device.DeviceID != device.Device.DeviceID {
				t.Fatalf("session did not survive restart: %+v", afterRestart)
			}
			restartedSocket := securityE2EConnectBrowser(t, fixture, basePath, cookie)
			mustWriteJSON(t, restartedSocket, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodSecuritySessionRevoke, Payload: map[string]any{
				"deviceId": afterRestart.Device.DeviceID,
			}})
			if response := mustReadEnvelope(t, restartedSocket); response.Type != "response" || response.Payload["revoked"] != true {
				t.Fatalf("device revoke response=%+v", response)
			}
			_ = restartedSocket.SetReadDeadline(time.Now().Add(time.Second))
			if _, _, err := restartedSocket.ReadMessage(); err == nil {
				t.Fatal("revoked browser websocket remained connected")
			}
			_ = restartedSocket.Close()
			afterRevoke := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", cookie))
			if afterRevoke.Authenticated {
				t.Fatal("revoked cookie remained authenticated")
			}

			firstRotatedCookie, _ := securityE2ELogin(t, fixture, token, basePath, "Before Rotation A")
			secondRotatedCookie, _ := securityE2ELogin(t, fixture, token, basePath, "Before Rotation B")
			rotatedToken := securityE2ERandomToken(t)
			fixture.startRegistry(rotatedToken)
			for _, staleCookie := range []*http.Cookie{firstRotatedCookie, secondRotatedCookie} {
				status := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", staleCookie))
				if status.Authenticated {
					t.Fatal("token rotation left an old browser session authenticated")
				}
			}
			oldLoginBody, _ := json.Marshal(map[string]string{"token": token})
			oldLogin := fixture.authRequest(http.MethodPost, basePath, "login", string(oldLoginBody), fixture.origin(), nil)
			_ = oldLogin.Body.Close()
			if oldLogin.StatusCode != http.StatusUnauthorized {
				t.Fatalf("old token login status=%d, want 401", oldLogin.StatusCode)
			}
			newCookie, _ := securityE2ELogin(t, fixture, rotatedToken, basePath, "After Rotation")
			if newCookie.Value == "" {
				t.Fatal("rotated token did not establish a new session")
			}
		})
	}
}

func TestSecurityE2ERejectsProxyBoundaryViolations(t *testing.T) {
	token := securityE2ERandomToken(t)
	fixture := newSecurityE2EProxy(t, token)

	crossOriginBody, _ := json.Marshal(map[string]string{"token": token})
	crossOrigin := fixture.authRequest(http.MethodPost, "/", "login", string(crossOriginBody), "https://attacker.invalid", nil)
	_ = crossOrigin.Body.Close()
	if crossOrigin.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin login status=%d, want 403", crossOrigin.StatusCode)
	}

	oversized := fixture.authRequest(http.MethodPost, "/", "login", `{"token":"`+strings.Repeat("x", maxWebLoginBodyBytes)+`"}`, fixture.origin(), nil)
	_ = oversized.Body.Close()
	if oversized.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized login status=%d, want 413", oversized.StatusCode)
	}

	rootCookie, _ := securityE2ELogin(t, fixture, token, "/", "Root Device")
	wrongPath := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, "/wheelmaker/", "status", "", "", rootCookie))
	if wrongPath.Authenticated {
		t.Fatal("root cookie authenticated against a different Base Path")
	}

	for attempt := 1; attempt <= sourceLoginBurst+1; attempt++ {
		response := fixture.authRequest(http.MethodPost, "/", "login", `{"token":"incorrect"}`, fixture.origin(), nil)
		_ = response.Body.Close()
		want := http.StatusUnauthorized
		if attempt > sourceLoginBurst {
			want = http.StatusTooManyRequests
		}
		if response.StatusCode != want {
			t.Fatalf("login attempt %d status=%d, want %d", attempt, response.StatusCode, want)
		}
	}

	directServer := New(Config{Token: token})
	request := httptest.NewRequest(http.MethodPost, "http://registry.example/ws?auth=login", strings.NewReader(string(crossOriginBody)))
	request.Host = "registry.example"
	request.RemoteAddr = "198.51.100.7:4321"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://registry.example")
	request.Header.Set("X-Forwarded-Proto", "https")
	recorder := httptest.NewRecorder()
	directServer.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("untrusted forwarded HTTPS status=%d, want 403", recorder.Code)
	}
}

func TestSecurityE2EHubWithoutOriginRequiresToken(t *testing.T) {
	token := securityE2ERandomToken(t)
	fixture := newSecurityE2EProxy(t, token)
	wsURL := "ws://" + strings.TrimPrefix(fixture.public.URL, "http://") + "/ws"

	unauthenticated, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial unauthenticated hub: %v", err)
	}
	mustWriteJSON(t, unauthenticated, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wheelmaker-hub", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion, "role": "hub", "hubId": "hub-e2e",
	}})
	if response := mustReadEnvelope(t, unauthenticated); response.Type != "error" || response.Payload["code"] != codeUnauthorized {
		t.Fatalf("tokenless hub response=%+v", response)
	}
	_ = unauthenticated.Close()

	authenticated, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial authenticated hub: %v", err)
	}
	defer authenticated.Close()
	mustWriteJSON(t, authenticated, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wheelmaker-hub", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion, "role": "hub", "hubId": "hub-e2e", "token": token,
	}})
	if response := mustReadEnvelope(t, authenticated); response.Type != "response" {
		t.Fatalf("authenticated hub response=%+v", response)
	}
}
