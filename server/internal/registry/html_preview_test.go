package registry

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

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
