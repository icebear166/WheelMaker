# HTML Preview JavaScript Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `srcDoc` HTML previews with an authenticated Registry HTTP response so self-contained project files, external files, and session attachments can execute inline JavaScript inside an opaque-origin sandbox.

**Architecture:** The Web app posts a typed source descriptor and the existing Registry CSRF token through a hidden form targeted at a `sandbox="allow-scripts"` iframe. A new Registry-only HTTP handler authenticates the browser session, validates iframe navigation metadata, maps the descriptor to one of three existing Hub read methods, and returns the unmodified HTML with a preview-specific CSP. HTML tabs keep metadata in Workspace state but never prefetch source content or participate in source search and line jumps.

**Tech Stack:** Go `net/http`, Gorilla WebSocket Registry transport, React 18, TypeScript, Jest with `react-test-renderer`, webpack-dev-server 5, WebView2 navigation policy tests, Nginx deployment documentation.

---

## File structure

- Create `server/internal/registry/html_preview.go`: canonical route recognition, form decoding, browser provenance checks, source-to-Hub mapping, response decoding, CSP headers, status mapping, and the HTTP handler.
- Create `server/internal/registry/html_preview_test.go`: table-driven route/schema/security tests and HTTP-to-Hub integration tests.
- Modify `server/internal/registry/http_routes.go`: dispatch the preview route before the existing `/ws` WebSocket/auth routing.
- Modify `server/internal/registry/server.go`: extract a context-aware project request forwarder shared by WebSocket clients and the preview handler.
- Modify `server/internal/registry/request_id_window_test.go`: retain coverage of the existing WebSocket forwarding wrapper after its signature-preserving refactor.
- Create `app/web/src/preview/htmlPreviewSource.ts`: the three source descriptor variants and deterministic form serialization.
- Create `app/web/src/preview/HtmlPreview.tsx`: hidden form, stable iframe target, and automatic POST submission.
- Create `app/__tests__/web-html-preview.test.tsx`: source serialization and component contract tests.
- Modify `app/web/src/registry/registryBaseUrl.ts` and `app/__tests__/web-registry-base-url.test.ts`: derive the base-path-aware preview endpoint.
- Modify `app/web/src/code/markdownPreview.tsx`: remove the old `srcDoc` component and cross-frame line-jump code.
- Modify `app/web/src/app/WorkspaceApp.tsx`: build descriptors for all sources, skip HTML content reads, and pass endpoint/auth data into viewers.
- Modify `app/web/src/preview/previewWorkbenchState.ts`: make HTML files unavailable to source search.
- Modify `app/__tests__/web-preview-workbench-state.test.ts`, `app/__tests__/web-preview-file-regressions.test.tsx`, and `app/__tests__/web-chat-file-peek-viewer.test.ts`: cover no-prefetch, no-search, and no-line-jump behavior.
- Modify `app/web/webpack.config.js` and `app/__tests__/web-security-policy.test.ts`: keep Registry preview response headers intact in development while preserving normal document headers.
- Modify `server/cmd/wheelmaker-desktop/webview_policy_test.go`: pin same-base-origin preview iframe navigation behavior without changing production Desktop policy.
- Modify `INSTALL.md` and `docs/nginx-security.md`: document the existing `/ws` prefix proxy requirement and preview header boundary.

### Task 1: Parse and authorize canonical preview requests

**Files:**
- Create: `server/internal/registry/html_preview.go`
- Create: `server/internal/registry/html_preview_test.go`
- Modify: `server/internal/registry/http_routes.go`

- [ ] **Step 1: Add failing route and provenance tests**

Create table-driven tests with these exact accepted and rejected cases:

```go
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
			t.Errorf("registryHTMLPreviewBasePath(%q) = %q, %v; want %q, %v",
				test.path, got, ok, test.want, test.ok)
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
}
```

- [ ] **Step 2: Run the route/provenance tests and verify the red state**

Run:

```powershell
cd server
go test ./internal/registry -run 'TestRegistryHTMLPreview(BasePath|RequestAllowed)$' -count=1
```

Expected: build failure because `registryHTMLPreviewBasePath` and `registryHTMLPreviewRequestAllowed` do not exist.

- [ ] **Step 3: Implement canonical route recognition and strict iframe provenance**

Add these declarations to `html_preview.go`:

```go
package registry

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/security"
)

const (
	registryHTMLPreviewSuffix       = "/preview/"
	maxHTMLPreviewDescriptorBytes   = 64 * 1024
	htmlPreviewContentSecurityPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'self'; sandbox allow-scripts"
	htmlPreviewErrorSecurityPolicy   = "default-src 'none'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox"
)

func registryHTMLPreviewBasePath(requestPath string) (string, bool) {
	if !strings.HasSuffix(requestPath, registryHTMLPreviewSuffix) {
		return "", false
	}
	return registryBasePath(strings.TrimSuffix(requestPath, registryHTMLPreviewSuffix))
}

func registryHTMLPreviewRequestAllowed(r *http.Request) bool {
	return security.RequestOriginMatchesHost(r) &&
		r.Header.Get("Sec-Fetch-Site") == "same-origin" &&
		r.Header.Get("Sec-Fetch-Mode") == "navigate" &&
		r.Header.Get("Sec-Fetch-Dest") == "iframe"
}
```

Add `net/url` with the decoder types in Step 5. Go must be buildable at the end of the task.

- [ ] **Step 4: Add failing source descriptor tests**

Use a request helper that gives `decodeRegistryHTMLPreviewForm` a real `ResponseRecorder`, then cover the complete schema:

```go
func newHTMLPreviewFormRequest(values url.Values) (*httptest.ResponseRecorder, *http.Request) {
	body := values.Encode()
	request := httptest.NewRequest(http.MethodPost, "https://preview.example/ws/preview/", strings.NewReader(body))
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
		name       string
		values     url.Values
		wantMethod string
		want       string
	}{
		{
			name: "project file",
			values: url.Values{
				"source": {"project-file"}, "projectId": {"proj1"},
				"path": {"docs/demo.HTML"}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodProjectFSRead,
			want:       `{"path":"docs/demo.HTML"}`,
		},
		{
			name: "external file",
			values: url.Values{
				"source": {"external-file"}, "projectId": {"proj1"},
				"path": {`C:\demo\page.htm`}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodProjectFSExternalRead,
			want:       `{"path":"C:\\demo\\page.htm"}`,
		},
		{
			name: "attachment id",
			values: url.Values{
				"source": {"session-attachment"}, "projectId": {"proj1"},
				"sessionId": {"sess1"}, "attachmentId": {"sha256-a"}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			want:       `{"attachmentId":"sha256-a","sessionId":"sess1"}`,
		},
		{
			name: "attachment uri",
			values: url.Values{
				"source": {"session-attachment"}, "projectId": {"proj1"},
				"sessionId": {"sess1"}, "uri": {"file:///attachment/page.html"}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			want:       `{"sessionId":"sess1","uri":"file:///attachment/page.html"}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder, request := newHTMLPreviewFormRequest(test.values)
			got, err := decodeRegistryHTMLPreviewForm(recorder, request)
			if err != nil {
				t.Fatal(err)
			}
			if got.Method != test.wantMethod || string(got.Payload) != test.want {
				t.Fatalf("request = %s %s, want %s %s",
					got.Method, got.Payload, test.wantMethod, test.want)
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
		"unknown field": func(v url.Values, _ *http.Request) { v.Set("method", "project.delete") },
		"duplicate": func(v url.Values, _ *http.Request) { v["path"] = []string{"a.html", "b.html"} },
		"missing project": func(v url.Values, _ *http.Request) { v.Del("projectId") },
		"wrong extension": func(v url.Values, _ *http.Request) { v.Set("path", "page.svg") },
		"extra attachment field": func(v url.Values, _ *http.Request) {
			v.Set("source", "session-attachment")
			v.Set("sessionId", "sess1")
			v.Set("attachmentId", "sha256-a")
			v.Set("uri", "file:///page.html")
			v.Del("path")
		},
		"unsupported media": func(_ url.Values, r *http.Request) { r.Header.Set("Content-Type", "application/json") },
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
```

Also add one test whose encoded body is `maxHTMLPreviewDescriptorBytes+1` bytes and assert `errors.As(err, new(*http.MaxBytesError))`.

- [ ] **Step 5: Implement strict form decoding and fixed Hub method mapping**

Use a closed source enum and never accept a method from the form:

```go
type registryHTMLPreviewRequest struct {
	ProjectID string
	CSRFToken string
	Method    string
	Payload   json.RawMessage
	Source    string
}

var registryHTMLPreviewFields = map[string]struct{}{
	"source": {}, "projectId": {}, "csrfToken": {}, "path": {},
	"sessionId": {}, "attachmentId": {}, "uri": {},
}

func decodeRegistryHTMLPreviewForm(w http.ResponseWriter, r *http.Request) (registryHTMLPreviewRequest, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/x-www-form-urlencoded" {
		return registryHTMLPreviewRequest{}, errHTMLPreviewMediaType
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxHTMLPreviewDescriptorBytes)
	if err := r.ParseForm(); err != nil {
		return registryHTMLPreviewRequest{}, err
	}
	if len(r.Form) != len(r.PostForm) {
		return registryHTMLPreviewRequest{}, errors.New("query fields are not allowed")
	}
	for key, values := range r.PostForm {
		if _, ok := registryHTMLPreviewFields[key]; !ok || len(values) != 1 {
			return registryHTMLPreviewRequest{}, errors.New("invalid preview field")
		}
	}
	one := func(name string) string {
		values := r.PostForm[name]
		if len(values) != 1 {
			return ""
		}
		return values[0]
	}
	out := registryHTMLPreviewRequest{
		ProjectID: strings.TrimSpace(one("projectId")),
		CSRFToken: one("csrfToken"),
		Source:    strings.TrimSpace(one("source")),
	}
	if out.ProjectID == "" || out.CSRFToken == "" {
		return registryHTMLPreviewRequest{}, errors.New("missing common preview field")
	}
	switch out.Source {
	case "project-file", "external-file":
		path := one("path")
		if !registryHTMLPreviewHasExactFields(r.PostForm, "source", "projectId", "csrfToken", "path") ||
			!isHTMLPreviewPath(path) {
			return registryHTMLPreviewRequest{}, errors.New("invalid file preview source")
		}
		if out.Source == "external-file" && !isAbsoluteHTMLPreviewPath(path) {
			return registryHTMLPreviewRequest{}, errors.New("external path must be absolute")
		}
		out.Method = rp.RegistryMethodProjectFSRead
		if out.Source == "external-file" {
			out.Method = rp.RegistryMethodProjectFSExternalRead
		}
		out.Payload = rp.MustRaw(map[string]string{"path": path})
	case "session-attachment":
		sessionID := strings.TrimSpace(one("sessionId"))
		attachmentID, uri := one("attachmentId"), one("uri")
		hasAttachmentID := attachmentID != "" &&
			registryHTMLPreviewHasExactFields(r.PostForm, "source", "projectId", "csrfToken", "sessionId", "attachmentId")
		hasURI := uri != "" &&
			registryHTMLPreviewHasExactFields(r.PostForm, "source", "projectId", "csrfToken", "sessionId", "uri")
		if sessionID == "" || hasAttachmentID == hasURI {
			return registryHTMLPreviewRequest{}, errors.New("invalid attachment preview source")
		}
		payload := map[string]string{"sessionId": sessionID}
		if attachmentID != "" {
			payload["attachmentId"] = attachmentID
		} else {
			payload["uri"] = uri
		}
		out.Method = rp.RegistryMethodSessionAttachmentRead
		out.Payload = rp.MustRaw(payload)
	default:
		return registryHTMLPreviewRequest{}, errors.New("unsupported preview source")
	}
	return out, nil
}

func registryHTMLPreviewHasExactFields(form url.Values, names ...string) bool {
	if len(form) != len(names) {
		return false
	}
	for _, name := range names {
		values := form[name]
		if len(values) != 1 || strings.TrimSpace(values[0]) == "" {
			return false
		}
	}
	return true
}

func isHTMLPreviewPath(value string) bool {
	switch strings.ToLower(filepath.Ext(value)) {
	case ".html", ".htm":
		return true
	default:
		return false
	}
}

func isAbsoluteHTMLPreviewPath(value string) bool {
	if filepath.IsAbs(value) || strings.HasPrefix(value, `\\`) {
		return true
	}
	return len(value) >= 3 &&
		((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) &&
		value[1] == ':' &&
		(value[2] == '\\' || value[2] == '/')
}
```

Add `net/url` to the implementation imports for `url.Values`, and define both sentinel errors so the handler can map them without string matching:

```go
var (
	errHTMLPreviewMediaType         = errors.New("unsupported preview media type")
	errHTMLPreviewUnsupportedContent = errors.New("unsupported preview content")
)
```

- [ ] **Step 6: Route canonical preview paths before WebSocket handling**

At the start of `handleHTTP`, dispatch preview requests without allowing query strings:

```go
func (s *Server) handleHTTP(w http.ResponseWriter, r *http.Request) {
	if basePath, ok := registryHTMLPreviewBasePath(r.URL.Path); ok {
		if r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), registryBasePathContextKey{}, basePath))
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeRegistryHTMLPreviewError(w, http.StatusMethodNotAllowed)
			return
		}
		s.handleRegistryHTMLPreview(w, r)
		return
	}

	basePath, ok := registryBasePath(r.URL.Path)
	// Keep the existing WebSocket/auth routing unchanged below this point.
```

Add a temporary handler shell so Task 1 compiles:

```go
func (s *Server) handleRegistryHTMLPreview(w http.ResponseWriter, r *http.Request) {
	writeRegistryHTMLPreviewError(w, http.StatusNotImplemented)
}

func writeRegistryHTMLPreviewError(w http.ResponseWriter, status int) {
	setRegistryHTMLPreviewHeaders(w, htmlPreviewErrorSecurityPolicy)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, "<!doctype html><title>HTML preview unavailable</title><p>HTML preview unavailable.</p>")
}

func setRegistryHTMLPreviewHeaders(w http.ResponseWriter, policy string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", policy)
}
```

Do not set `X-Frame-Options` in either response helper.

- [ ] **Step 7: Format, run Task 1 tests, and commit**

Run:

```powershell
cd server
gofmt -w internal/registry/html_preview.go internal/registry/html_preview_test.go internal/registry/http_routes.go
go test ./internal/registry -run 'TestRegistryHTMLPreview|TestDecodeRegistryHTMLPreviewForm' -count=1
```

Expected: all selected tests pass.

Commit:

```powershell
cd ..
git add server/internal/registry/html_preview.go server/internal/registry/html_preview_test.go server/internal/registry/http_routes.go
git commit -m "feat: validate registry html preview requests"
```

### Task 2: Make Registry project forwarding context-aware

**Files:**
- Modify: `server/internal/registry/server.go:1264`
- Modify: `server/internal/registry/html_preview_test.go`
- Verify: `server/internal/registry/request_id_window_test.go`

- [ ] **Step 1: Add a failing cancellation and pending-cleanup test**

Build a connected test Hub using `dialWS` and `mustReportHubProjects`, start a request, read the forwarded request on the Hub, cancel the context, and inspect the peer:

```go
func TestExecuteProjectRequestCancellationCleansPending(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
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
```

- [ ] **Step 2: Run the cancellation test and verify the red state**

Run:

```powershell
cd server
go test ./internal/registry -run TestExecuteProjectRequestCancellationCleansPending -count=1
```

Expected: build failure because `executeProjectRequest` does not exist.

- [ ] **Step 3: Extract the shared context-aware forwarder**

Keep the public behavior of `executeClientRequest` and move the transport body into this function:

```go
func (s *Server) executeClientRequest(state *connectionState, in envelope) envelope {
	return s.executeProjectRequest(context.Background(), state.scopeHubID, in)
}

func (s *Server) executeProjectRequest(ctx context.Context, scopeHubID string, in envelope) envelope {
	projectID := strings.TrimSpace(in.ProjectID)
	if projectID == "" {
		return s.errorEnvelope(in.Method, codeInvalidArgument, "projectId is required", nil)
	}
	if scopeHubID != "" && !strings.HasPrefix(projectID, scopeHubID+":") {
		return s.errorEnvelope(in.Method, codeForbidden, "project out of client scope", map[string]any{"projectId": projectID})
	}

	s.mu.RLock()
	hubID := s.projectToHub[projectID]
	hubPeer := s.hubPeers[hubID]
	s.mu.RUnlock()
	if hubID == "" {
		return s.errorEnvelope(in.Method, codeNotFound, "project not found", map[string]any{"projectId": projectID})
	}
	if hubPeer == nil {
		return s.errorEnvelope(in.Method, codeUnavailable, "hub offline", map[string]any{"projectId": projectID})
	}

	forwardID := s.nextForwardID.Add(1)
	waitCh, err := hubPeer.registerPending(forwardID)
	if err != nil {
		return s.errorEnvelope(in.Method, codeBusy, "hub request backlog is full", nil)
	}
	if err := hubPeer.write(envelope{
		RequestID: forwardID,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    in.Method,
		ProjectID: projectID,
		Payload:   in.Payload,
	}); err != nil {
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeInternal, "forward request write failed", nil)
	}

	timer := time.NewTimer(projectForwardRequestTimeout(in.Method))
	defer timer.Stop()
	select {
	case resp, ok := <-waitCh:
		if !ok {
			return s.errorEnvelope(in.Method, codeInternal, "hub disconnected", nil)
		}
		resp.ProjectID = projectID
		return resp
	case <-ctx.Done():
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeTimeout, "request cancelled", nil)
	case <-timer.C:
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeTimeout, "hub response timeout", nil)
	}
}
```

The cancellation message is internal and must never be emitted by the HTML error page.

- [ ] **Step 4: Run forwarding and Registry regression tests**

Run:

```powershell
cd server
gofmt -w internal/registry/server.go internal/registry/html_preview_test.go
go test ./internal/registry -run 'TestExecuteProjectRequestCancellationCleansPending|TestRegistryForwards|TestRequestID' -count=1
```

Expected: all selected tests pass, including the existing direct `executeClientRequest` test.

- [ ] **Step 5: Commit the forwarding refactor**

```powershell
cd ..
git add server/internal/registry/server.go server/internal/registry/html_preview_test.go server/internal/registry/request_id_window_test.go
git commit -m "refactor: make project forwarding cancellable"
```

### Task 3: Return Hub HTML through the Registry preview endpoint

**Files:**
- Modify: `server/internal/registry/html_preview.go`
- Modify: `server/internal/registry/html_preview_test.go`

- [ ] **Step 1: Add failing authenticated HTTP-to-Hub mapping tests**

Add helpers that log in on the request's exact base path, capture the real session CSRF token, attach the session cookie, and supply exact iframe navigation headers:

```go
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

func doHTMLPreviewRequest(
	t *testing.T,
	baseURL string,
	basePath string,
	cookie *http.Cookie,
	csrf string,
	values url.Values,
) *http.Response {
	t.Helper()
	values.Set("csrfToken", csrf)
	request, err := http.NewRequest(
		http.MethodPost,
		baseURL+strings.TrimSuffix(basePath, "/")+"/ws/preview/",
		strings.NewReader(values.Encode()),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", baseURL)
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	request.Header.Set("Sec-Fetch-Dest", "iframe")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
```

For each row below, start the HTTP call in a goroutine, assert the envelope received by the Hub, reply with the listed payload, then assert status `200` and the exact HTML body:

```go
tests := []struct {
	name       string
	form       url.Values
	wantMethod string
	wantPayload string
	response   map[string]any
}{
	{
		name: "project",
		form: url.Values{"source": {"project-file"}, "projectId": {"hub-preview:proj1"}, "path": {"page.html"}},
		wantMethod: rp.RegistryMethodProjectFSRead,
		wantPayload: `{"path":"page.html"}`,
		response: map[string]any{"content": "<script>top.document.title='blocked'</script>", "encoding": "utf-8", "isBinary": false},
	},
	{
		name: "external",
		form: url.Values{"source": {"external-file"}, "projectId": {"hub-preview:proj1"}, "path": {`C:\preview\page.htm`}},
		wantMethod: rp.RegistryMethodProjectFSExternalRead,
		wantPayload: `{"path":"C:\\preview\\page.htm"}`,
		response: map[string]any{"content": "<p>external</p>", "encoding": "utf-8", "isBinary": false},
	},
	{
		name: "attachment",
		form: url.Values{"source": {"session-attachment"}, "projectId": {"hub-preview:proj1"}, "sessionId": {"sess1"}, "attachmentId": {"sha256-a"}},
		wantMethod: rp.RegistryMethodSessionAttachmentRead,
		wantPayload: `{"attachmentId":"sha256-a","sessionId":"sess1"}`,
		response: map[string]any{"content": "<p>attachment</p>", "encoding": "utf-8", "isBinary": false, "mimeType": "text/html; charset=utf-8"},
	},
}
```

Call `loginHTMLPreviewBrowser` rather than creating session internals directly. Add a second run under base path `/wheelmaker/` to prove cookie/base-path alignment.

- [ ] **Step 2: Add failing security, error mapping, and response-header tests**

Extend `html_preview_test.go` with:

```go
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
	if !strings.Contains(csp, "frame-ancestors 'self'") || !strings.Contains(csp, "sandbox") {
		t.Fatalf("CSP = %q", csp)
	}
	if success {
		for _, directive := range []string{
			"script-src 'unsafe-inline'", "connect-src 'none'", "frame-src 'none'",
			"worker-src 'none'", "form-action 'none'", "sandbox allow-scripts",
		} {
			if !strings.Contains(csp, directive) {
				t.Fatalf("CSP missing %q: %s", directive, csp)
			}
		}
		if strings.Contains(csp, "'unsafe-eval'") {
			t.Fatalf("CSP allows unsafe-eval: %s", csp)
		}
	}
}
```

Cover these status cases with exact assertions:

- no session: `401`;
- wrong base-path session, Origin, any Fetch Metadata value, or CSRF: `403`;
- malformed schema: `400`;
- descriptor over 64 KiB: `413`;
- unsupported media type: `415`;
- project not found: `404`;
- Hub offline: `503`;
- Hub timeout/context deadline: `504`;
- Hub disconnect/internal/invalid-argument error: `502`;
- binary file, non-UTF-8 encoding, or attachment MIME other than parsed `text/html`: `415`;
- method on canonical path: `405` with `Allow: POST`;
- query, missing slash, or extra path: `404`.

For every generated error page assert that neither `C:\private\page.html`, `csrf-secret`, nor a Hub error message appears in the body.

- [ ] **Step 3: Run the handler tests and verify the red state**

Run:

```powershell
cd server
go test ./internal/registry -run 'TestRegistryHTMLPreview(ForwardsSources|Security|Errors|Headers)' -count=1
```

Expected: failures because the temporary handler returns `501`.

- [ ] **Step 4: Decode safe Hub responses and map transport errors**

Replace the temporary handler and add these response helpers:

```go
type registryHTMLPreviewReadResult struct {
	Content   *string `json:"content"`
	Encoding  string  `json:"encoding"`
	IsBinary *bool   `json:"isBinary"`
	MIMEType  string  `json:"mimeType"`
}

func registryHTMLPreviewResponseStatus(response envelope) int {
	if response.Type == rp.RegistryEnvelopeTypeResponse {
		return http.StatusOK
	}
	if response.Type != rp.RegistryEnvelopeTypeError {
		return http.StatusBadGateway
	}
	var payload errorPayload
	if json.Unmarshal(response.Payload, &payload) != nil {
		return http.StatusBadGateway
	}
	switch payload.Code {
	case codeNotFound:
		return http.StatusNotFound
	case codeUnavailable:
		return http.StatusServiceUnavailable
	case codeTimeout:
		return http.StatusGatewayTimeout
	default:
		return http.StatusBadGateway
	}
}

func decodeRegistryHTMLPreviewResult(source string, payload json.RawMessage) (string, error) {
	var result registryHTMLPreviewReadResult
	if err := json.Unmarshal(payload, &result); err != nil {
		return "", err
	}
	if result.Content == nil || result.IsBinary == nil || *result.IsBinary ||
		!strings.EqualFold(result.Encoding, "utf-8") || !utf8.ValidString(*result.Content) {
		return "", errHTMLPreviewUnsupportedContent
	}
	if source == "session-attachment" {
		mediaType, _, err := mime.ParseMediaType(result.MIMEType)
		if err != nil || !strings.EqualFold(mediaType, "text/html") {
			return "", errHTMLPreviewUnsupportedContent
		}
	}
	return *result.Content, nil
}

func writeRegistryHTMLPreviewSuccess(w http.ResponseWriter, content string) {
	setRegistryHTMLPreviewHeaders(w, htmlPreviewContentSecurityPolicy)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, content)
}
```

Existing Hub read payloads contain fields beyond the four consumed here, so response decoding intentionally uses `json.Unmarshal`. Incoming form fields remain exact-schema validated.

- [ ] **Step 5: Implement the authenticated handler in validation order**

Add `crypto/subtle` and `unicode/utf8` to `html_preview.go`'s imports. Use the current browser session and compare CSRF in constant time:

```go
func (s *Server) handleRegistryHTMLPreview(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authenticateWebRequest(r)
	if !ok {
		writeRegistryHTMLPreviewError(w, http.StatusUnauthorized)
		return
	}
	if !registryHTMLPreviewRequestAllowed(r) {
		writeRegistryHTMLPreviewError(w, http.StatusForbidden)
		return
	}
	request, err := decodeRegistryHTMLPreviewForm(w, r)
	if err != nil {
		status := http.StatusBadRequest
		var maxBytesErr *http.MaxBytesError
		switch {
		case errors.As(err, &maxBytesErr):
			status = http.StatusRequestEntityTooLarge
		case errors.Is(err, errHTMLPreviewMediaType):
			status = http.StatusUnsupportedMediaType
		}
		writeRegistryHTMLPreviewError(w, status)
		return
	}
	if subtle.ConstantTimeCompare([]byte(request.CSRFToken), []byte(session.CSRFToken)) != 1 {
		writeRegistryHTMLPreviewError(w, http.StatusForbidden)
		return
	}

	response := s.executeProjectRequest(r.Context(), "", envelope{
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    request.Method,
		ProjectID: request.ProjectID,
		Payload:   request.Payload,
	})
	if status := registryHTMLPreviewResponseStatus(response); status != http.StatusOK {
		writeRegistryHTMLPreviewError(w, status)
		return
	}
	content, err := decodeRegistryHTMLPreviewResult(request.Source, response.Payload)
	if err != nil {
		writeRegistryHTMLPreviewError(w, http.StatusUnsupportedMediaType)
		return
	}
	writeRegistryHTMLPreviewSuccess(w, content)
}
```

Ensure error pages contain only a fixed title and fixed sentence. Do not interpolate `request`, `response.Payload`, `error`, a path, or a token.

- [ ] **Step 6: Format and run the Registry review checkpoint**

Run:

```powershell
cd server
gofmt -w internal/registry/html_preview.go internal/registry/html_preview_test.go
go test ./internal/registry -count=1
```

Expected: all Registry tests pass. Review the diff before continuing:

```powershell
cd ..
git diff --check
git diff -- server/internal/registry
```

Expected: no whitespace errors; no imports from `internal/portrelay`, no `os.ReadFile`, no new protocol method, and no protocol version change.

- [ ] **Step 7: Commit the complete Registry endpoint**

```powershell
git add server/internal/registry/html_preview.go server/internal/registry/html_preview_test.go
git commit -m "feat: serve sandboxed html previews"
```

### Task 4: Build the typed Web form-to-iframe preview

**Files:**
- Create: `app/web/src/preview/htmlPreviewSource.ts`
- Create: `app/web/src/preview/HtmlPreview.tsx`
- Create: `app/__tests__/web-html-preview.test.tsx`
- Modify: `app/web/src/registry/registryBaseUrl.ts`
- Modify: `app/__tests__/web-registry-base-url.test.ts`
- Modify: `app/web/src/code/markdownPreview.tsx`

- [ ] **Step 1: Add failing descriptor and endpoint tests**

Create `web-html-preview.test.tsx` with exact serialized field assertions:

```tsx
import React from 'react';
import {act, create} from 'react-test-renderer';
import {HtmlPreview} from '../web/src/preview/HtmlPreview';
import {
  htmlPreviewFormFields,
  htmlPreviewSourceKey,
  type HtmlPreviewSource,
} from '../web/src/preview/htmlPreviewSource';

describe('HTML preview source', () => {
  test.each<[HtmlPreviewSource, Record<string, string>]>([
    [
      {source: 'project-file', projectId: 'proj1', path: 'page.html'},
      {source: 'project-file', projectId: 'proj1', path: 'page.html'},
    ],
    [
      {source: 'external-file', projectId: 'proj1', path: String.raw`C:\page.htm`},
      {source: 'external-file', projectId: 'proj1', path: String.raw`C:\page.htm`},
    ],
    [
      {source: 'session-attachment', projectId: 'proj1', sessionId: 'sess1', attachmentId: 'sha256-a'},
      {source: 'session-attachment', projectId: 'proj1', sessionId: 'sess1', attachmentId: 'sha256-a'},
    ],
    [
      {source: 'session-attachment', projectId: 'proj1', sessionId: 'sess1', uri: 'file:///page.html'},
      {source: 'session-attachment', projectId: 'proj1', sessionId: 'sess1', uri: 'file:///page.html'},
    ],
  ])('serializes only the source schema', (source, expected) => {
    expect(Object.fromEntries(htmlPreviewFormFields(source))).toEqual(expected);
    expect(htmlPreviewSourceKey(source)).toBe(JSON.stringify(Object.entries(expected)));
  });
});
```

In `web-registry-base-url.test.ts`, extend every expected endpoint object with:

```ts
previewURL: new URL('https://example.test/wheelmaker/ws/preview/'),
```

and add root path and insecure-loopback cases.

- [ ] **Step 2: Run source and endpoint tests and verify the red state**

Run:

```powershell
cd app
npm test -- web-html-preview.test.tsx web-registry-base-url.test.ts --runInBand
```

Expected: build failures because the preview modules and `previewURL` do not exist.

- [ ] **Step 3: Implement the source union and base-path-aware endpoint**

Create:

```ts
export type HtmlPreviewSource =
  | {source: 'project-file'; projectId: string; path: string}
  | {source: 'external-file'; projectId: string; path: string}
  | (
      {source: 'session-attachment'; projectId: string; sessionId: string} &
      (
        {attachmentId: string; uri?: never} |
        {attachmentId?: never; uri: string}
      )
    );

export function isHtmlPreviewPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function isHtmlPreviewAttachment(title: string, mimeType: string): boolean {
  return isHtmlPreviewPath(title) ||
    mimeType.split(';', 1)[0].trim().toLocaleLowerCase() === 'text/html';
}

export function htmlPreviewFormFields(source: HtmlPreviewSource): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['source', source.source],
    ['projectId', source.projectId],
  ];
  if (source.source === 'project-file' || source.source === 'external-file') {
    fields.push(['path', source.path]);
  } else {
    fields.push(['sessionId', source.sessionId]);
    if (source.attachmentId) {
      fields.push(['attachmentId', source.attachmentId]);
    } else if (source.uri) {
      fields.push(['uri', source.uri]);
    }
  }
  return fields;
}

export function htmlPreviewSourceKey(source: HtmlPreviewSource): string {
  return JSON.stringify(htmlPreviewFormFields(source));
}
```

Modify the endpoint type and return value:

```ts
export type RegistryEndpoints = {
  authURL: URL;
  previewURL: URL;
  wsURL: string;
  basePath: string;
};

const authURL = new URL('ws', base);
const previewURL = new URL('ws/preview/', base);
// ...
return {authURL, previewURL, wsURL: wsURL.toString(), basePath: base.pathname};
```

- [ ] **Step 4: Add the failing component behavior test**

Append:

```tsx
describe('HtmlPreview', () => {
  test('posts into a stable opaque-origin script sandbox and resubmits on source change', () => {
    const requestSubmit = jest.fn();
    const first: HtmlPreviewSource = {source: 'project-file', projectId: 'proj1', path: 'one.html'};
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <HtmlPreview endpoint="https://example.test/ws/preview/" csrfToken="csrf" source={first} />,
        {createNodeMock: element => element.type === 'form' ? {requestSubmit} : null},
      );
    });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    const iframe = renderer!.root.findByType('iframe');
    const form = renderer!.root.findByType('form');
    expect(form.props.method).toBe('post');
    expect(form.props.action).toBe('https://example.test/ws/preview/');
    expect(form.props.target).toBe(iframe.props.name);
    expect(iframe.props.sandbox).toBe('allow-scripts');
    expect(iframe.props.referrerPolicy).toBe('no-referrer');
    expect(iframe.props.srcDoc).toBeUndefined();
    expect(String(iframe.props.sandbox)).not.toContain('allow-same-origin');

    const target = iframe.props.name;
    act(() => {
      renderer!.update(
        <HtmlPreview
          endpoint="https://example.test/ws/preview/"
          csrfToken="csrf"
          source={{source: 'external-file', projectId: 'proj1', path: String.raw`C:\two.htm`}}
        />,
      );
    });
    expect(requestSubmit).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findByType('iframe').props.name).toBe(target);

    const inputs = renderer!.root.findAllByType('input')
      .map(input => [input.props.name, input.props.value]);
    expect(Object.fromEntries(inputs)).toEqual({
      source: 'external-file',
      projectId: 'proj1',
      path: String.raw`C:\two.htm`,
      csrfToken: 'csrf',
    });
  });
});
```

- [ ] **Step 5: Implement the hidden form and stable iframe target**

Create:

```tsx
import React, {useEffect, useId, useMemo, useRef} from 'react';
import {
  htmlPreviewFormFields,
  htmlPreviewSourceKey,
  type HtmlPreviewSource,
} from './htmlPreviewSource';

export type HtmlPreviewProps = {
  endpoint: string;
  csrfToken: string;
  source: HtmlPreviewSource;
};

export const HtmlPreview = React.memo(function HtmlPreview({
  endpoint,
  csrfToken,
  source,
}: HtmlPreviewProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const reactId = useId();
  const target = useMemo(
    () => `wheelmaker-html-preview-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId],
  );
  const sourceKey = htmlPreviewSourceKey(source);
  const fields = htmlPreviewFormFields(source);

  useEffect(() => {
    if (endpoint && csrfToken) {
      formRef.current?.requestSubmit();
    }
  }, [endpoint, csrfToken, sourceKey]);

  return (
    <div className="html-preview">
      <form
        ref={formRef}
        method="post"
        action={endpoint}
        target={target}
        hidden
        aria-hidden="true"
      >
        {fields.map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="csrfToken" value={csrfToken} />
      </form>
      <iframe
        className="html-preview-frame"
        name={target}
        title="HTML preview"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </div>
  );
});
```

Remove `HtmlPreviewProps`, `scrollHtmlPreviewFrameToLine`, `HtmlPreview`, and the now-unused `useRef` import from `markdownPreview.tsx`. Keep Markdown preview behavior and `.html-preview` CSS unchanged.

- [ ] **Step 6: Run component tests, type-check, and commit**

Run:

```powershell
cd app
npm test -- web-html-preview.test.tsx web-registry-base-url.test.ts --runInBand
npm run tsc:web
```

Expected: both test suites pass and TypeScript reports no errors.

Commit:

```powershell
cd ..
git add app/web/src/preview/htmlPreviewSource.ts app/web/src/preview/HtmlPreview.tsx app/__tests__/web-html-preview.test.tsx app/web/src/registry/registryBaseUrl.ts app/__tests__/web-registry-base-url.test.ts app/web/src/code/markdownPreview.tsx
git commit -m "feat: post html previews into sandboxed frames"
```

### Task 5: Integrate all Workspace HTML sources without content prefetch

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/preview/previewWorkbenchState.ts`
- Modify: `app/__tests__/web-preview-workbench-state.test.ts`
- Modify: `app/__tests__/web-preview-file-regressions.test.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Add failing no-search and no-line-jump tests**

In `web-preview-workbench-state.test.ts`, use the exported real state functions:

```ts
test('HTML file tabs do not expose source search documents', () => {
  const tab: FilePreviewTab = {
    id: 'file:page.html',
    type: 'file',
    projectId: 'proj1',
    title: 'page.html',
    path: 'page.HTML',
    targetLine: 9,
    content: '<p>needle</p>',
    info: null,
    loading: false,
    error: '',
    requestId: 1,
  };
  expect(buildPreviewSearchMatches(tab, 'needle')).toEqual([]);
  expect(previewSearchDocumentKey(tab)).toBe('');
});
```

Replace the HTML line-scroll assertions in `web-preview-file-regressions.test.tsx` with structural assertions that:

```ts
expect(source).not.toContain('scrollHtmlPreviewFrameToLine');
expect(source).not.toContain("item.type === 'file' ? {...item, targetLine: match.line}");
expect(source).toContain("'Search is not available for this preview.'");
```

- [ ] **Step 2: Add failing no-prefetch and three-source rendering tests**

Update `web-chat-file-peek-viewer.test.ts` so its service fixture records calls and asserts:

```ts
expect(service.getProjectFileInfo).toHaveBeenCalledWith('proj1', 'page.html', expect.anything());
expect(service.readProjectFile).not.toHaveBeenCalled();
expect(service.getExternalFileInfo).toHaveBeenCalledWith('proj1', String.raw`C:\page.htm`, expect.anything());
expect(service.readExternalFile).not.toHaveBeenCalled();
expect(service.readProjectSessionAttachment).not.toHaveBeenCalledWith(
  'proj1',
  expect.objectContaining({sessionId: 'sess1', attachmentId: 'sha256-a'}),
);
```

Add source-structure assertions for:

```tsx
{source: 'project-file', projectId: peek.projectId, path: peek.path}
{source: 'external-file', projectId: peek.projectId, path: peek.path}
{
  source: 'session-attachment',
  projectId: preview.projectId,
  sessionId: payload.sessionId,
  attachmentId: payload.attachmentId,
  uri: payload.uri,
}
```

Also retain a `.md` case that expects `readProjectFile` and a non-HTML attachment case that expects `readProjectSessionAttachment`.

- [ ] **Step 3: Run the Workspace tests and verify the red state**

Run:

```powershell
cd app
npm test -- web-preview-workbench-state.test.ts web-preview-file-regressions.test.tsx web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: failures because HTML still searches, jumps, prefetches, and imports the old component.

- [ ] **Step 4: Exclude HTML from search state**

Import `isHtmlPreviewPath` into `previewWorkbenchState.ts` and short-circuit both exports:

```ts
if (tab.type === 'file') {
  if (isHtmlPreviewPath(tab.path)) {
    return [];
  }
  return tab.content
    .split('\n')
    .map((text, index) => ({kind: 'file' as const, line: index + 1, text}))
    .filter(match => match.text.toLocaleLowerCase().includes(normalizedQuery));
}
```

and:

```ts
if (tab.type === 'file') {
  return isHtmlPreviewPath(tab.path) ? '' : tab.content;
}
```

In `WorkspaceApp.tsx`, calculate search availability with:

```ts
const previewSearchUnavailableMessage =
  activeWorkbenchTab &&
  (
    (activeWorkbenchTab.type === 'file' && isHtmlPreviewPath(activeWorkbenchTab.path)) ||
    (activeWorkbenchTab.type !== 'file' && activeWorkbenchTab.type !== 'prompt-diff')
  )
    ? 'Search is not available for this preview.'
    : '';
```

Delete the `isHtmlPath(tab.path)` branch from `scrollToPreviewSearchMatch`; file matches now only belong to Markdown/code.

- [ ] **Step 5: Pass endpoint, CSRF, and file source descriptors into the viewer**

Replace the `HtmlPreview` import with:

```ts
import {HtmlPreview} from '../preview/HtmlPreview';
import {
  isHtmlPreviewAttachment,
  isHtmlPreviewPath,
  type HtmlPreviewSource,
} from '../preview/htmlPreviewSource';
```

Delete the local `isHtmlPath` helper and replace all of its file-path call sites with `isHtmlPreviewPath`; attachment detection uses `isHtmlPreviewAttachment`.

Add these viewer props:

```ts
type HTMLPreviewConnectionProps = {
  htmlPreviewEndpoint: string;
  htmlPreviewCSRFToken: string;
};
```

Intersect this type into `ChatFilePeekViewerProps` and `ChatAttachmentPreviewViewerProps`, pass:

```tsx
htmlPreviewEndpoint={registryEndpoints.previewURL.toString()}
htmlPreviewCSRFToken={registryAuth.status?.csrfToken || ''}
```

from `renderPreviewWorkbenchTabBody`, and render file HTML with:

```tsx
<HtmlPreview
  endpoint={htmlPreviewEndpoint}
  csrfToken={htmlPreviewCSRFToken}
  source={{
    source: isAbsolutePreviewFilePath(peek.path) ? 'external-file' : 'project-file',
    projectId: peek.projectId,
    path: peek.path,
  }}
/>
```

Use `isHtmlPreviewPath` for HTML decisions and remove `targetLine` from the HTML branch.

- [ ] **Step 6: Build and render attachment descriptors before content-state branches**

Add a total helper next to `attachmentPreviewReadPayloadFromKey`:

```ts
function attachmentHTMLPreviewSource(tab: AttachmentPreviewTab): HtmlPreviewSource | null {
  if (!isHtmlPreviewAttachment(tab.title, tab.mimeType)) {
    return null;
  }
  const payload = attachmentPreviewReadPayloadFromKey(tab);
  if (!payload) {
    return null;
  }
  if (payload.attachmentId) {
    return {
      source: 'session-attachment',
      projectId: tab.projectId,
      sessionId: payload.sessionId,
      attachmentId: payload.attachmentId,
    };
  }
  if (payload.uri) {
    return {
      source: 'session-attachment',
      projectId: tab.projectId,
      sessionId: payload.sessionId,
      uri: payload.uri,
    };
  }
  return null;
}
```

In `ChatAttachmentPreviewViewer`, evaluate it before checking `preview.content`:

```tsx
const htmlSource = attachmentHTMLPreviewSource(preview);
// loading and explicit error branches stay first
if (htmlSource) {
  body = (
    <HtmlPreview
      endpoint={htmlPreviewEndpoint}
      csrfToken={htmlPreviewCSRFToken}
      source={htmlSource}
    />
  );
} else if (preview.kind === 'image' && preview.src) {
  // Keep the existing image/Markdown/code branches.
}
```

If the source cannot be reconstructed, the existing fixed attachment restore error remains visible.

- [ ] **Step 7: Skip HTML body reads in open and restore flows**

After file info resolves in `readChatFilePeek`, complete HTML tabs immediately and bypass the large-file confirmation:

```ts
if (isHtmlPreviewPath(path)) {
  setPreviewWorkbench(current =>
    updatePreviewTabAfterLoad(current, targetProjectId, tabId, requestSeq, tab =>
      tab.type === 'file'
        ? {...tab, info, content: '', loading: false, error: '', targetLine: null}
        : tab,
    ),
  );
  return;
}
```

Make the same branch after info resolution in `loadRestoredPreviewTab`.

In `openChatAttachmentPreview`, compute:

```ts
const htmlAttachment = isHtmlPreviewAttachment(title, block.mimeType || '');
```

and return before `service.readProjectSessionAttachment` when `htmlAttachment` is true. In the restored attachment path, resolve `attachmentHTMLPreviewSource(tab)` before beginning a load and return immediately for a valid HTML source. This leaves existing size limits and content reads unchanged for every non-HTML attachment.

- [ ] **Step 8: Run Workspace tests and type-check**

Run:

```powershell
cd app
npm test -- web-html-preview.test.tsx web-preview-workbench-state.test.ts web-preview-file-regressions.test.tsx web-chat-file-peek-viewer.test.ts --runInBand
npm run tsc:web
```

Expected: all selected suites pass and TypeScript reports no errors.

- [ ] **Step 9: Commit Workspace integration**

```powershell
cd ..
git add app/web/src/app/WorkspaceApp.tsx app/web/src/preview/previewWorkbenchState.ts app/__tests__/web-preview-workbench-state.test.ts app/__tests__/web-preview-file-regressions.test.tsx app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat: load html previews through registry"
```

### Task 6: Preserve preview headers in development and pin Desktop policy

**Files:**
- Modify: `app/web/webpack.config.js`
- Modify: `app/__tests__/web-security-policy.test.ts`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`

- [ ] **Step 1: Add failing webpack header tests**

Replace direct object indexing with calls against a request path:

```ts
type DevHeaders = Record<string, string>;
const headersFor = (url: string): DevHeaders =>
  devServer.headers({url} as never, {} as never, {} as never);

const documentHeaders = headersFor('/');
expect(documentHeaders['Content-Security-Policy']).toContain("default-src 'self'");
expect(documentHeaders['X-Frame-Options']).toBe('DENY');
expect(documentHeaders['X-Content-Type-Options']).toBe('nosniff');
expect(documentHeaders['Referrer-Policy']).toBe('no-referrer');

for (const url of ['/ws/preview/', '/wheelmaker/ws/preview/']) {
  const previewHeaders = headersFor(url);
  expect(previewHeaders['Content-Security-Policy']).toBeUndefined();
  expect(previewHeaders['X-Frame-Options']).toBeUndefined();
  expect(previewHeaders['X-Content-Type-Options']).toBe('nosniff');
  expect(previewHeaders['Referrer-Policy']).toBe('no-referrer');
}
```

Keep all existing assertions that normal pages exclude `'unsafe-eval'`, production content retains its strict CSP, and the proxy context is `['/ws']`.

- [ ] **Step 2: Run the webpack test and verify the red state**

Run:

```powershell
cd app
npm test -- web-security-policy.test.ts --runInBand
```

Expected: failure because `devServer.headers` is still an object.

- [ ] **Step 3: Make development headers path-aware**

Add:

```js
function isHTMLPreviewRequest(request) {
  const pathname = String(request?.url || '').split(/[?#]/, 1)[0];
  return pathname === '/ws/preview/' || pathname.endsWith('/ws/preview/');
}

function developmentResponseHeaders(request) {
  const common = {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (isHTMLPreviewRequest(request)) {
    return common;
  }
  return {
    ...common,
    'Content-Security-Policy': LOCAL_WEB_SECURITY_POLICY,
    'X-Frame-Options': 'DENY',
  };
}
```

Set:

```js
headers: developmentResponseHeaders,
```

The existing `/ws` proxy already covers both root and subpath preview URLs; do not add another target.

- [ ] **Step 4: Add a same-base-origin Desktop subframe policy case**

In the existing table for `isNavigationAllowed`, add:

```go
{
	name: "same base preview iframe",
	url:  "https://example.com/wheelmaker/ws/preview/",
	want: desktopNavigationAllow,
},
```

Keep the existing cross-origin subframe and non-main-frame native bridge rejection tests. No production Desktop source change is expected.

- [ ] **Step 5: Run the development and Desktop checkpoint**

Run:

```powershell
cd app
npm test -- web-security-policy.test.ts --runInBand
npm run tsc:web
cd ../server
gofmt -w cmd/wheelmaker-desktop/webview_policy_test.go
go test ./cmd/wheelmaker-desktop ./internal/registry -count=1
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit development and Desktop coverage**

```powershell
cd ..
git add app/web/webpack.config.js app/__tests__/web-security-policy.test.ts server/cmd/wheelmaker-desktop/webview_policy_test.go
git commit -m "test: cover html preview hosting boundaries"
```

### Task 7: Document deployment semantics and complete verification

**Files:**
- Modify: `INSTALL.md`
- Modify: `docs/nginx-security.md`
- Verify: `docs/scope/2026-07-26-html-preview-js/spec-html-preview-js.md`
- Verify: `docs/wiki/features/html-preview.md`

- [ ] **Step 1: Rebase the clean implementation branch on current remote main**

Run:

```powershell
git fetch origin
git rebase origin/main
```

Expected: the clean worktree rebases without unresolved conflicts. Do this before creating the final uncommitted documentation change reserved for the Completion Gate.

- [ ] **Step 2: Add a failing documentation assertion**

Extend the deployment documentation test with exact stable phrases:

```ts
expect(docs).toContain('/ws/preview/');
expect(docs).toContain('prefix location');
expect(docs).toContain('upstream Content-Security-Policy');
expect(docs).toContain('must not add X-Frame-Options: DENY');
```

Run:

```powershell
cd app
npm test -- web-security-policy.test.ts --runInBand
```

Expected: failure because the deployment docs do not yet describe preview proxy semantics.

- [ ] **Step 3: Document the existing Nginx boundary without adding a location**

Add this operational content to both documents near the existing `location /ws` example:

```markdown
`/ws/preview/` is an authenticated iframe POST endpoint carried by the existing
`/ws` prefix location. Keep this as a prefix location; an exact `/ws` match would
route WebSocket connections but break HTML preview responses. For preview
responses, pass the upstream Content-Security-Policy through unchanged and must
not add X-Frame-Options: DENY. Deployments that use the documented prefix proxy
need no additional Nginx location.
```

Do not change the static application location's CSP or `X-Frame-Options: DENY`; the exception applies only to the upstream preview response under the existing Registry proxy.

- [ ] **Step 4: Run focused server and app tests**

Run:

```powershell
cd server
go test ./internal/registry ./cmd/wheelmaker-desktop -count=1
cd ../app
npm test -- web-html-preview.test.tsx web-registry-base-url.test.ts web-preview-workbench-state.test.ts web-preview-file-regressions.test.tsx web-chat-file-peek-viewer.test.ts web-security-policy.test.ts --runInBand
npm run tsc:web
```

Expected: all Go packages and Jest suites pass; TypeScript reports no errors.

- [ ] **Step 5: Run complete regressions and production Web build**

Run:

```powershell
cd server
go test ./...
cd ../app
npm test -- --runInBand
npm run build:web
```

Expected: all server and app tests pass and the production Web bundle builds successfully.

- [ ] **Step 6: Audit security and scope invariants**

Run:

```powershell
cd ..
rg -n "srcDoc|allow-same-origin|unsafe-eval|os\\.ReadFile|portrelay" server/internal/registry/html_preview.go app/web/src/preview/HtmlPreview.tsx app/web/src/code/markdownPreview.tsx
rg -n "RegistryMethod.*Preview|ProtocolVersion" server/internal/protocol server/internal/registry/html_preview.go
git diff --check
git status --short
```

Expected:

- no `srcDoc`, `allow-same-origin`, `'unsafe-eval'`, `os.ReadFile`, or port relay reference in the new preview path;
- no preview protocol method and no protocol version edit;
- only files named in this plan are modified;
- `git diff --check` has no output.

- [ ] **Step 7: Complete the repository Completion Gate exactly**

These must be the final three shell commands:

```powershell
git add -A
git commit -m "docs: document html preview proxy boundary"
git push origin spec-html-preview-js
```

Expected: the documentation test change and both deployment documents are committed, and `origin/spec-html-preview-js` points at the verified implementation.
