package registry

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestRegistryHTMLPreviewBasePath(t *testing.T) {
	tests := []struct {
		path string
		want string
		ok   bool
	}{
		{path: "/ws/preview/", want: "/", ok: true},
		{path: "/wheelmaker/ws/preview/", want: "/wheelmaker/", ok: true},
		{path: "/ws/preview", ok: false},
		{path: "/ws/preview/extra", ok: false},
		{path: "/wheelmaker//ws/preview/", ok: false},
		{path: "/wheelmaker/../ws/preview/", ok: false},
		{path: `\ws\preview\`, ok: false},
	}
	for _, test := range tests {
		got, ok := registryHTMLPreviewBasePath(test.path)
		if got != test.want || ok != test.ok {
			t.Errorf(
				"registryHTMLPreviewBasePath(%q) = %q, %v; want %q, %v",
				test.path,
				got,
				ok,
				test.want,
				test.ok,
			)
		}
	}
}

func TestRegistryHTMLPreviewRequestAllowed(t *testing.T) {
	valid := httptest.NewRequest(http.MethodPost, "https://preview.example/ws/preview/", nil)
	valid.Host = "preview.example"
	valid.Header.Set("Origin", "https://preview.example")
	valid.Header.Set("Sec-Fetch-Site", "same-origin")
	valid.Header.Set("Sec-Fetch-Mode", "navigate")
	valid.Header.Set("Sec-Fetch-Dest", "iframe")

	if !registryHTMLPreviewRequestAllowed(valid) {
		t.Fatal("valid iframe navigation was rejected")
	}

	opaqueOrigin := valid.Clone(valid.Context())
	opaqueOrigin.Header = valid.Header.Clone()
	opaqueOrigin.Header.Set("Origin", "null")
	if !registryHTMLPreviewRequestAllowed(opaqueOrigin) {
		t.Fatal("sandboxed iframe navigation with an opaque origin was rejected")
	}

	for _, header := range []string{"Origin", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest"} {
		t.Run("missing_"+header, func(t *testing.T) {
			request := valid.Clone(valid.Context())
			request.Header = valid.Header.Clone()
			request.Header.Del(header)
			if registryHTMLPreviewRequestAllowed(request) {
				t.Fatalf("request missing %s was accepted", header)
			}
		})
	}

	for name, mutate := range map[string]func(*http.Request){
		"cross_origin": func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") },
		"cross_site":   func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		"cors":         func(r *http.Request) { r.Header.Set("Sec-Fetch-Mode", "cors") },
		"top_level":    func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "document") },
	} {
		t.Run(name, func(t *testing.T) {
			request := valid.Clone(valid.Context())
			request.Header = valid.Header.Clone()
			mutate(request)
			if registryHTMLPreviewRequestAllowed(request) {
				t.Fatal("invalid browser provenance was accepted")
			}
		})
	}

	for name, mutate := range map[string]func(*http.Request){
		"missing_fetch_site": func(r *http.Request) { r.Header.Del("Sec-Fetch-Site") },
		"cross_site":         func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		"cors":               func(r *http.Request) { r.Header.Set("Sec-Fetch-Mode", "cors") },
		"top_level":          func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "document") },
	} {
		t.Run("opaque_origin_"+name, func(t *testing.T) {
			request := opaqueOrigin.Clone(opaqueOrigin.Context())
			request.Header = opaqueOrigin.Header.Clone()
			mutate(request)
			if registryHTMLPreviewRequestAllowed(request) {
				t.Fatal("opaque origin without strict iframe provenance was accepted")
			}
		})
	}
}

func newHTMLPreviewFormRequest(values url.Values) (*httptest.ResponseRecorder, *http.Request) {
	body := values.Encode()
	request := httptest.NewRequest(
		http.MethodPost,
		"https://preview.example/ws/preview/",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
	return httptest.NewRecorder(), request
}

func cloneHTMLPreviewValues(values url.Values) url.Values {
	cloned := make(url.Values, len(values))
	for key, entries := range values {
		cloned[key] = append([]string(nil), entries...)
	}
	return cloned
}

func TestDecodeRegistryHTMLPreviewForm(t *testing.T) {
	tests := []struct {
		name        string
		values      url.Values
		wantMethod  string
		wantPayload map[string]string
	}{
		{
			name: "project file",
			values: url.Values{
				"source": {"project-file"}, "projectId": {"proj1"},
				"path": {"docs/demo.HTML"}, "csrfToken": {"csrf"},
			},
			wantMethod:  rp.RegistryMethodProjectFSRead,
			wantPayload: map[string]string{"path": "docs/demo.HTML"},
		},
		{
			name: "external Windows file",
			values: url.Values{
				"source": {"external-file"}, "projectId": {"proj1"},
				"path": {`C:\demo\page.htm`}, "csrfToken": {"csrf"},
			},
			wantMethod:  rp.RegistryMethodProjectFSExternalRead,
			wantPayload: map[string]string{"path": `C:\demo\page.htm`},
		},
		{
			name: "external POSIX file",
			values: url.Values{
				"source": {"external-file"}, "projectId": {"proj1"},
				"path": {"/tmp/page.html"}, "csrfToken": {"csrf"},
			},
			wantMethod:  rp.RegistryMethodProjectFSExternalRead,
			wantPayload: map[string]string{"path": "/tmp/page.html"},
		},
		{
			name: "attachment id",
			values: url.Values{
				"source": {"session-attachment"}, "projectId": {"proj1"},
				"sessionId": {"sess1"}, "attachmentId": {"sha256-a"}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			wantPayload: map[string]string{
				"sessionId": "sess1", "attachmentId": "sha256-a",
			},
		},
		{
			name: "attachment uri",
			values: url.Values{
				"source": {"session-attachment"}, "projectId": {"proj1"},
				"sessionId": {"sess1"}, "uri": {"file:///attachment/page.html"}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			wantPayload: map[string]string{
				"sessionId": "sess1", "uri": "file:///attachment/page.html",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder, request := newHTMLPreviewFormRequest(test.values)
			got, err := decodeRegistryHTMLPreviewForm(recorder, request)
			if err != nil {
				t.Fatal(err)
			}
			if got.Method != test.wantMethod {
				t.Fatalf("method = %q, want %q", got.Method, test.wantMethod)
			}
			var payload map[string]string
			if err := json.Unmarshal(got.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(payload, test.wantPayload) {
				t.Fatalf("payload = %#v, want %#v", payload, test.wantPayload)
			}
			if got.ProjectID != "proj1" || got.CSRFToken != "csrf" {
				t.Fatalf("common fields = %#v", got)
			}
		})
	}
}

func TestDecodeRegistryHTMLPreviewFormRejectsInvalidInput(t *testing.T) {
	valid := url.Values{
		"source": {"project-file"}, "projectId": {"proj1"},
		"path": {"page.html"}, "csrfToken": {"csrf"},
	}
	tests := map[string]func(url.Values, *http.Request){
		"unknown field": func(values url.Values, _ *http.Request) {
			values.Set("method", "project.delete")
		},
		"duplicate field": func(values url.Values, _ *http.Request) {
			values["path"] = []string{"a.html", "b.html"}
		},
		"missing project": func(values url.Values, _ *http.Request) {
			values.Del("projectId")
		},
		"empty csrf": func(values url.Values, _ *http.Request) {
			values.Set("csrfToken", "")
		},
		"wrong extension": func(values url.Values, _ *http.Request) {
			values.Set("path", "page.svg")
		},
		"relative external path": func(values url.Values, _ *http.Request) {
			values.Set("source", "external-file")
		},
		"empty extra field": func(values url.Values, _ *http.Request) {
			values.Set("sessionId", "")
		},
		"attachment identities": func(values url.Values, _ *http.Request) {
			values.Set("source", "session-attachment")
			values.Set("sessionId", "sess1")
			values.Set("attachmentId", "sha256-a")
			values.Set("uri", "file:///page.html")
			values.Del("path")
		},
		"attachment without identity": func(values url.Values, _ *http.Request) {
			values.Set("source", "session-attachment")
			values.Set("sessionId", "sess1")
			values.Del("path")
		},
		"unsupported media": func(_ url.Values, request *http.Request) {
			request.Header.Set("Content-Type", "application/json")
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			values := cloneHTMLPreviewValues(valid)
			recorder, request := newHTMLPreviewFormRequest(values)
			mutate(values, request)
			if request.Header.Get("Content-Type") != "application/json" {
				encoded := values.Encode()
				request.Body = io.NopCloser(strings.NewReader(encoded))
				request.ContentLength = int64(len(encoded))
			}
			if _, err := decodeRegistryHTMLPreviewForm(recorder, request); err == nil {
				t.Fatal("invalid form was accepted")
			}
		})
	}
}

func TestDecodeRegistryHTMLPreviewFormLimitsDescriptorBody(t *testing.T) {
	values := url.Values{
		"source": {"project-file"}, "projectId": {"proj1"},
		"path": {"page.html"}, "csrfToken": {strings.Repeat("x", maxHTMLPreviewDescriptorBytes)},
	}
	recorder, request := newHTMLPreviewFormRequest(values)
	_, err := decodeRegistryHTMLPreviewForm(recorder, request)
	var maxBytesErr *http.MaxBytesError
	if !errors.As(err, &maxBytesErr) {
		t.Fatalf("error = %v, want *http.MaxBytesError", err)
	}
}

func TestRegistryHTMLPreviewRouteIsolation(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	tests := []struct {
		name      string
		method    string
		path      string
		want      int
		wantAllow string
	}{
		{
			name:      "canonical route rejects get",
			method:    http.MethodGet,
			path:      "/ws/preview/",
			want:      http.StatusMethodNotAllowed,
			wantAllow: http.MethodPost,
		},
		{
			name:   "query is not a preview route",
			method: http.MethodPost,
			path:   "/ws/preview/?source=project-file",
			want:   http.StatusNotFound,
		},
		{
			name:   "missing trailing slash is not a preview route",
			method: http.MethodPost,
			path:   "/ws/preview",
			want:   http.StatusNotFound,
		},
		{
			name:   "web auth route remains isolated",
			method: http.MethodGet,
			path:   "/ws?auth=status",
			want:   http.StatusOK,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequest(test.method, testServer.URL+test.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.want {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.want)
			}
			if got := response.Header.Get("Allow"); got != test.wantAllow {
				t.Fatalf("Allow = %q, want %q", got, test.wantAllow)
			}
		})
	}
}

func TestExecuteProjectRequestCancellationCleansPending(t *testing.T) {
	server := New(Config{})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHubProjects(t, hub, "hub-preview", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan envelope, 1)
	go func() {
		result <- server.executeProjectRequest(ctx, "", envelope{
			Type:      rp.RegistryEnvelopeTypeRequest,
			Method:    rp.RegistryMethodProjectFSRead,
			ProjectID: "hub-preview:proj1",
			Payload:   rp.MustRaw(map[string]string{"path": "page.html"}),
		})
	}()

	forwarded := mustReadEnvelope(t, hub)
	cancel()
	response := <-result
	var payload errorPayload
	if err := json.Unmarshal(response.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != codeTimeout {
		t.Fatalf("code = %q, want %q", payload.Code, codeTimeout)
	}

	server.mu.RLock()
	peer := server.hubPeers["hub-preview"]
	server.mu.RUnlock()
	peer.pendingMu.Lock()
	_, pending := peer.pending[forwarded.RequestID]
	peer.pendingMu.Unlock()
	if pending {
		t.Fatal("cancelled request remained pending")
	}
}

func loginHTMLPreviewBrowser(
	t *testing.T,
	baseURL string,
	basePath string,
) (*http.Cookie, string) {
	t.Helper()
	login := doRegistryWebAuthRequest(
		t,
		baseURL,
		http.MethodPost,
		basePath,
		"login",
		`{"token":"custom-token","deviceName":"HTML preview test"}`,
		sameOriginWebAuthHeaders(baseURL),
		nil,
	)
	defer login.Body.Close()
	if login.StatusCode != http.StatusOK || len(login.Cookies()) != 1 {
		t.Fatalf("login status=%d cookies=%v", login.StatusCode, login.Cookies())
	}
	var payload struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.NewDecoder(login.Body).Decode(&payload); err != nil || payload.CSRFToken == "" {
		t.Fatalf("decode login csrfToken=%q err=%v", payload.CSRFToken, err)
	}
	return login.Cookies()[0], payload.CSRFToken
}

func mustReportHTMLPreviewHub(
	t *testing.T,
	hub *websocket.Conn,
	hubID string,
	token string,
	projects []map[string]any,
) {
	t.Helper()
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodConnectInit,
		Payload: map[string]any{
			"clientName":      "wheelmaker-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           hubID,
			"token":           token,
		},
	})
	initResponse := mustReadEnvelope(t, hub)
	principal, _ := initResponse.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodHubReportProjects,
		HubID:     hubID,
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects":        projects,
		},
	})
	if response := mustReadEnvelope(t, hub); response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("hub report response = %#v", response)
	}
}

func newHTMLPreviewHTTPRequest(
	t *testing.T,
	baseURL string,
	basePath string,
	cookie *http.Cookie,
	csrf string,
	values url.Values,
) *http.Request {
	t.Helper()
	values = cloneHTMLPreviewValues(values)
	values.Set("csrfToken", csrf)
	request, err := http.NewRequest(
		http.MethodPost,
		baseURL+strings.TrimSuffix(basePath, "/")+"/ws/preview/",
		strings.NewReader(values.Encode()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", baseURL)
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	request.Header.Set("Sec-Fetch-Dest", "iframe")
	return request
}

func TestRegistryHTMLPreviewForwardsSources(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-preview", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	tests := []struct {
		name        string
		form        url.Values
		wantMethod  string
		wantPayload map[string]string
		response    map[string]any
		wantBody    string
	}{
		{
			name: "project",
			form: url.Values{
				"source": {"project-file"}, "projectId": {"hub-preview:proj1"},
				"path": {"page.html"},
			},
			wantMethod:  rp.RegistryMethodProjectFSRead,
			wantPayload: map[string]string{"path": "page.html"},
			response: map[string]any{
				"content":  "<script>document.body.dataset.ready='yes'</script>",
				"encoding": "utf-8", "isBinary": false, "mimeType": "text/html",
			},
			wantBody: "<script>document.body.dataset.ready='yes'</script>",
		},
		{
			name: "external",
			form: url.Values{
				"source": {"external-file"}, "projectId": {"hub-preview:proj1"},
				"path": {`C:\preview\page.htm`},
			},
			wantMethod:  rp.RegistryMethodProjectFSExternalRead,
			wantPayload: map[string]string{"path": `C:\preview\page.htm`},
			response: map[string]any{
				"content": "<p>external</p>", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/html",
			},
			wantBody: "<p>external</p>",
		},
		{
			name: "attachment",
			form: url.Values{
				"source": {"session-attachment"}, "projectId": {"hub-preview:proj1"},
				"sessionId": {"sess1"}, "attachmentId": {"sha256-a"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			wantPayload: map[string]string{
				"sessionId": "sess1", "attachmentId": "sha256-a",
			},
			response: map[string]any{
				"content": "<p>attachment</p>", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/html; charset=utf-8",
			},
			wantBody: "<p>attachment</p>",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := newHTMLPreviewHTTPRequest(
				t,
				testServer.URL,
				"/",
				cookie,
				csrf,
				test.form,
			)
			type result struct {
				response *http.Response
				err      error
			}
			resultChannel := make(chan result, 1)
			go func() {
				response, err := http.DefaultClient.Do(request)
				resultChannel <- result{response: response, err: err}
			}()

			if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
				t.Fatal(err)
			}
			forwarded := mustReadEnvelope(t, hub)
			if err := hub.SetReadDeadline(time.Time{}); err != nil {
				t.Fatal(err)
			}
			if forwarded.Method != test.wantMethod ||
				forwarded.ProjectID != "hub-preview:proj1" {
				t.Fatalf("forwarded request = %#v", forwarded)
			}
			if !reflect.DeepEqual(forwarded.Payload, mapStringAny(test.wantPayload)) {
				t.Fatalf("payload = %#v, want %#v", forwarded.Payload, test.wantPayload)
			}
			mustWriteJSON(t, hub, testEnvelope{
				RequestID: forwarded.RequestID,
				Type:      rp.RegistryEnvelopeTypeResponse,
				Method:    forwarded.Method,
				ProjectID: forwarded.ProjectID,
				Payload:   test.response,
			})

			got := <-resultChannel
			if got.err != nil {
				t.Fatal(got.err)
			}
			defer got.response.Body.Close()
			body, err := io.ReadAll(got.response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if got.response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d body = %s", got.response.StatusCode, body)
			}
			if string(body) != test.wantBody {
				t.Fatalf("body = %q, want %q", body, test.wantBody)
			}
			assertHTMLPreviewSecurityHeaders(t, got.response, true)
			if got.response.Header.Get("Content-Type") != "text/html; charset=utf-8" {
				t.Fatalf("Content-Type = %q", got.response.Header.Get("Content-Type"))
			}
			if got.response.Header.Get("Content-Disposition") != "inline" {
				t.Fatalf("Content-Disposition = %q", got.response.Header.Get("Content-Disposition"))
			}
		})
	}
}

func mapStringAny(values map[string]string) map[string]any {
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func assertHTMLPreviewSecurityHeaders(t *testing.T, response *http.Response, success bool) {
	t.Helper()
	if got := response.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if got := response.Header.Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("Referrer-Policy = %q", got)
	}
	if got := response.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
	if got := response.Header.Get("X-Frame-Options"); got != "" {
		t.Fatalf("X-Frame-Options = %q, want absent", got)
	}
	csp := response.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "frame-ancestors 'self'") ||
		!strings.Contains(csp, "sandbox") {
		t.Fatalf("CSP = %q", csp)
	}
	if !success {
		if strings.Contains(csp, "allow-scripts") {
			t.Fatalf("error CSP enables scripts: %s", csp)
		}
		return
	}
	for _, directive := range []string{
		"script-src 'unsafe-inline' https:",
		"style-src 'unsafe-inline' https:",
		"img-src data: blob: https:",
		"font-src data: https:",
		"media-src data: blob: https:",
		"connect-src 'none'",
		"frame-src 'none'",
		"worker-src 'none'",
		"form-action 'none'",
		"sandbox allow-scripts",
	} {
		if !strings.Contains(csp, directive) {
			t.Fatalf("CSP missing %q: %s", directive, csp)
		}
	}
	if strings.Contains(csp, "'unsafe-eval'") {
		t.Fatalf("CSP allows unsafe-eval: %s", csp)
	}
}

func TestDecodeRegistryHTMLPreviewResultRejectsInvalidUTF8(t *testing.T) {
	payload := append([]byte(`{"content":"`), byte(0xff))
	payload = append(payload, []byte(`","encoding":"utf-8","isBinary":false}`)...)
	if content, err := decodeRegistryHTMLPreviewResult("project-file", payload); err == nil {
		t.Fatalf("invalid UTF-8 content was accepted as %q", content)
	}
}

func TestDecodeRegistryHTMLPreviewResultRejectsUnsupportedContent(t *testing.T) {
	tests := []struct {
		name    string
		source  string
		payload map[string]any
	}{
		{
			name:   "binary",
			source: "project-file",
			payload: map[string]any{
				"content": "YWJj", "encoding": "base64", "isBinary": true,
			},
		},
		{
			name:   "missing binary flag",
			source: "project-file",
			payload: map[string]any{
				"content": "<p>page</p>", "encoding": "utf-8",
			},
		},
		{
			name:   "missing content",
			source: "project-file",
			payload: map[string]any{
				"encoding": "utf-8", "isBinary": false,
			},
		},
		{
			name:   "non html attachment",
			source: "session-attachment",
			payload: map[string]any{
				"content": "<p>page</p>", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/plain",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if content, err := decodeRegistryHTMLPreviewResult(
				test.source,
				rp.MustRaw(test.payload),
			); err == nil {
				t.Fatalf("unsupported content was accepted as %q", content)
			}
		})
	}
}

func TestRegistryHTMLPreviewResponseStatus(t *testing.T) {
	tests := []struct {
		name     string
		response envelope
		want     int
	}{
		{
			name: "success",
			response: envelope{
				Type: rp.RegistryEnvelopeTypeResponse,
			},
			want: http.StatusOK,
		},
		{
			name: "not found",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeNotFound}),
			},
			want: http.StatusNotFound,
		},
		{
			name: "offline",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeUnavailable}),
			},
			want: http.StatusServiceUnavailable,
		},
		{
			name: "timeout",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeTimeout}),
			},
			want: http.StatusGatewayTimeout,
		},
		{
			name: "internal",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeInternal}),
			},
			want: http.StatusBadGateway,
		},
		{
			name: "invalid envelope type",
			response: envelope{
				Type: rp.RegistryEnvelopeTypeEvent,
			},
			want: http.StatusBadGateway,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := registryHTMLPreviewResponseStatus(test.response); got != test.want {
				t.Fatalf("status = %d, want %d", got, test.want)
			}
		})
	}
}

func TestRegistryHTMLPreviewSecurityFailures(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	valid := url.Values{
		"source": {"project-file"}, "projectId": {"missing:project"},
		"path": {`C:\private\page.html`},
	}

	tests := []struct {
		name   string
		cookie *http.Cookie
		csrf   string
		mutate func(*http.Request)
		want   int
	}{
		{
			name: "no session", csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Del("Cookie")
			},
			want: http.StatusUnauthorized,
		},
		{
			name: "wrong origin", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Set("Origin", "https://evil.example")
			},
			want: http.StatusForbidden,
		},
		{
			name: "missing fetch site", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Del("Sec-Fetch-Site")
			},
			want: http.StatusForbidden,
		},
		{
			name: "top level navigation", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Set("Sec-Fetch-Dest", "document")
			},
			want: http.StatusForbidden,
		},
		{
			name: "wrong csrf", cookie: cookie, csrf: "csrf-secret",
			want: http.StatusForbidden,
		},
		{
			name: "unsupported media", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Set("Content-Type", "application/json")
			},
			want: http.StatusUnsupportedMediaType,
		},
		{
			name: "invalid schema", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				values := url.Values{
					"source": {"project-file"}, "projectId": {"missing:project"},
					"path": {"page.svg"}, "csrfToken": {csrf},
				}
				encoded := values.Encode()
				request.Body = io.NopCloser(strings.NewReader(encoded))
				request.ContentLength = int64(len(encoded))
			},
			want: http.StatusBadRequest,
		},
		{
			name: "descriptor too large", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				values := url.Values{
					"source": {"project-file"}, "projectId": {"missing:project"},
					"path":      {"page.html"},
					"csrfToken": {strings.Repeat("x", maxHTMLPreviewDescriptorBytes)},
				}
				encoded := values.Encode()
				request.Body = io.NopCloser(strings.NewReader(encoded))
				request.ContentLength = int64(len(encoded))
			},
			want: http.StatusRequestEntityTooLarge,
		},
		{
			name: "project not found", cookie: cookie, csrf: csrf,
			want: http.StatusNotFound,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := newHTMLPreviewHTTPRequest(
				t,
				testServer.URL,
				"/",
				test.cookie,
				test.csrf,
				valid,
			)
			if test.mutate != nil {
				test.mutate(request)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != test.want {
				t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, test.want, body)
			}
			assertHTMLPreviewSecurityHeaders(t, response, false)
			for _, secret := range []string{
				`C:\private\page.html`,
				"csrf-secret",
				"project not found",
			} {
				if strings.Contains(string(body), secret) {
					t.Fatalf("error body leaked %q: %s", secret, body)
				}
			}
		})
	}
}

func TestRegistryHTMLPreviewAllowsSandboxedOpaqueOrigin(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	request := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		url.Values{
			"source": {"project-file"}, "projectId": {"missing:project"},
			"path": {"page.html"},
		},
	)
	request.Header.Set("Origin", "null")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
	assertHTMLPreviewSecurityHeaders(t, response, false)
}

func TestRegistryHTMLPreviewBasePathSessionIsolation(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/wheelmaker/")
	values := url.Values{
		"source": {"project-file"}, "projectId": {"missing:project"},
		"path": {"page.html"},
	}

	subpathRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/wheelmaker/",
		cookie,
		csrf,
		values,
	)
	subpathResponse, err := http.DefaultClient.Do(subpathRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer subpathResponse.Body.Close()
	if subpathResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("subpath status = %d, want 404", subpathResponse.StatusCode)
	}

	rootRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		values,
	)
	rootResponse, err := http.DefaultClient.Do(rootRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer rootResponse.Body.Close()
	if rootResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("root status = %d, want 401", rootResponse.StatusCode)
	}
}

func TestRegistryHTMLPreviewHubRuntimeFailures(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	server.mu.Lock()
	server.projectToHub["offline:proj1"] = "offline-hub"
	server.mu.Unlock()
	offlineRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		url.Values{
			"source": {"project-file"}, "projectId": {"offline:proj1"},
			"path": {"page.html"},
		},
	)
	offlineResponse, err := http.DefaultClient.Do(offlineRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer offlineResponse.Body.Close()
	if offlineResponse.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("offline status = %d, want 503", offlineResponse.StatusCode)
	}

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-preview", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cancelledRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		url.Values{
			"source": {"project-file"}, "projectId": {"hub-preview:proj1"},
			"path": {"page.html"},
		},
	)
	ctx, cancel := context.WithCancel(cancelledRequest.Context())
	cancel()
	recorder := httptest.NewRecorder()
	server.handleHTTP(recorder, cancelledRequest.WithContext(ctx))
	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("cancelled status = %d, want 504", recorder.Code)
	}
}

func TestRegistryHTMLPreviewRejectsUnsupportedHubContent(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-preview", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	tests := []struct {
		name     string
		form     url.Values
		response map[string]any
	}{
		{
			name: "binary file",
			form: url.Values{
				"source": {"project-file"}, "projectId": {"hub-preview:proj1"},
				"path": {"page.html"},
			},
			response: map[string]any{
				"content": "AAE=", "encoding": "base64",
				"isBinary": true, "mimeType": "application/octet-stream",
			},
		},
		{
			name: "non html attachment",
			form: url.Values{
				"source": {"session-attachment"}, "projectId": {"hub-preview:proj1"},
				"sessionId": {"sess1"}, "attachmentId": {"sha256-a"},
			},
			response: map[string]any{
				"content": "plain", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/plain",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := newHTMLPreviewHTTPRequest(
				t,
				testServer.URL,
				"/",
				cookie,
				csrf,
				test.form,
			)
			type result struct {
				response *http.Response
				err      error
			}
			resultChannel := make(chan result, 1)
			go func() {
				response, err := http.DefaultClient.Do(request)
				resultChannel <- result{response: response, err: err}
			}()

			if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
				t.Fatal(err)
			}
			forwarded := mustReadEnvelope(t, hub)
			if err := hub.SetReadDeadline(time.Time{}); err != nil {
				t.Fatal(err)
			}
			mustWriteJSON(t, hub, testEnvelope{
				RequestID: forwarded.RequestID,
				Type:      rp.RegistryEnvelopeTypeResponse,
				Method:    forwarded.Method,
				ProjectID: forwarded.ProjectID,
				Payload:   test.response,
			})
			got := <-resultChannel
			if got.err != nil {
				t.Fatal(got.err)
			}
			defer got.response.Body.Close()
			if got.response.StatusCode != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, want 415", got.response.StatusCode)
			}
			assertHTMLPreviewSecurityHeaders(t, got.response, false)
		})
	}
}
