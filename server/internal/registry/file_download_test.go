package registry

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestFileDownloadCapabilityIsHighEntropySessionBoundAndSingleUse(t *testing.T) {
	now := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	store := newFileDownloadCapabilityStore(fileDownloadCapabilityStoreOptions{
		Now:      func() time.Time { return now },
		TTL:      time.Minute,
		Capacity: 4,
	})
	task := fileDownloadTask{
		DeviceID:  "device-1",
		BasePath:  "/workspace/",
		ProjectID: "hub:project",
		Source:    fileDownloadSource{Kind: fileDownloadSourceProject, Path: "docs/report.txt"},
		FileName:  "report.txt",
		MimeType:  "text/plain",
		Size:      42,
		Identity:  "identity-1",
	}
	token, err := store.issue(task)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != 32 {
		t.Fatalf("token entropy bytes=%d err=%v", len(decoded), err)
	}
	second, err := store.issue(task)
	if err != nil || second == token {
		t.Fatalf("second token=%q err=%v", second, err)
	}

	if _, err := store.claim(token, "wrong-device", "/workspace/"); err != errFileDownloadSessionMismatch {
		t.Fatalf("session mismatch err=%v", err)
	}
	claimed, err := store.claim(token, "device-1", "/workspace/")
	if err != nil || claimed.Source.Path != "docs/report.txt" || claimed.Identity != "identity-1" {
		t.Fatalf("claimed=%+v err=%v", claimed, err)
	}
	if _, err := store.claim(token, "device-1", "/workspace/"); err != errFileDownloadCapabilityMissing {
		t.Fatalf("second claim err=%v", err)
	}
}

func TestFileDownloadCapabilityExpiresAndEnforcesCapacity(t *testing.T) {
	now := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	store := newFileDownloadCapabilityStore(fileDownloadCapabilityStoreOptions{
		Now:      func() time.Time { return now },
		TTL:      time.Second,
		Capacity: 1,
	})
	task := fileDownloadTask{DeviceID: "device", BasePath: "/", ProjectID: "hub:project"}
	token, err := store.issue(task)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.issue(task); err != errFileDownloadCapabilityBusy {
		t.Fatalf("capacity err=%v", err)
	}
	now = now.Add(2 * time.Second)
	if _, err := store.claim(token, "device", "/"); err != errFileDownloadCapabilityExpired {
		t.Fatalf("expiry err=%v", err)
	}
	if _, err := store.issue(task); err != nil {
		t.Fatalf("expired task should free capacity: %v", err)
	}
}

func TestFileDownloadCapabilityClaimIsAtomic(t *testing.T) {
	store := newFileDownloadCapabilityStore(fileDownloadCapabilityStoreOptions{Capacity: 2})
	token, err := store.issue(fileDownloadTask{DeviceID: "device", BasePath: "/"})
	if err != nil {
		t.Fatal(err)
	}
	var successes atomic.Int32
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := store.claim(token, "device", "/"); err == nil {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatalf("successful claims=%d, want 1", successes.Load())
	}
}

func TestFileDownloadPrepareValidatesBrowserSessionAndProbesHub(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-download", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	browser := connectRegistryBrowser(t, testServer.URL, cookie)
	t.Cleanup(func() { _ = browser.Close() })

	mustWriteJSON(t, browser, testEnvelope{
		RequestID: 20,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadPrepare,
		ProjectID: "hub-download:proj1",
		Payload: map[string]any{
			"csrfToken": csrf,
			"source":    map[string]any{"kind": fileDownloadSourceProject, "path": "report.txt"},
		},
	})
	if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	open := mustReadEnvelope(t, hub)
	if open.Method != rp.RegistryMethodFileDownloadOpen || open.ProjectID != "hub-download:proj1" {
		t.Fatalf("open=%+v", open)
	}
	if source, _ := open.Payload["source"].(map[string]any); source["kind"] != fileDownloadSourceProject || source["path"] != "report.txt" {
		t.Fatalf("source=%+v", source)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    open.Method,
		ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "probe-transfer", "fileName": "report.txt",
			"mimeType": "text/plain", "size": 12, "identity": "identity-1",
		},
	})
	closeRequest := mustReadEnvelope(t, hub)
	if closeRequest.Method != rp.RegistryMethodFileDownloadClose || closeRequest.Payload["transferId"] != "probe-transfer" {
		t.Fatalf("close=%+v", closeRequest)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    closeRequest.Method,
		ProjectID: closeRequest.ProjectID,
		Payload:   map[string]any{"ok": true},
	})

	prepared := mustReadEnvelope(t, browser)
	if prepared.Type != rp.RegistryEnvelopeTypeResponse || prepared.Method != rp.RegistryMethodFileDownloadPrepare {
		t.Fatalf("prepared=%+v", prepared)
	}
	if prepared.Payload["downloadPath"] == "" || prepared.Payload["fileName"] != "report.txt" || prepared.Payload["size"] != float64(12) {
		t.Fatalf("prepared payload=%+v", prepared.Payload)
	}
	if path := prepared.Payload["downloadPath"].(string); path == "/download/" || len(path) <= len("/download/") {
		t.Fatalf("downloadPath=%q", path)
	}

	mustWriteJSON(t, browser, testEnvelope{
		RequestID: 21,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadPrepare,
		ProjectID: "hub-download:proj1",
		Payload: map[string]any{
			"csrfToken": "wrong",
			"source":    map[string]any{"kind": fileDownloadSourceProject, "path": "report.txt"},
		},
	})
	rejected := mustReadEnvelope(t, browser)
	if rejected.Type != rp.RegistryEnvelopeTypeError || rejected.Payload["code"] != codeForbidden {
		t.Fatalf("wrong CSRF response=%+v", rejected)
	}
}

func TestFileDownloadHTTPStreamsHubChunksOnce(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-download-http", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	browser := connectRegistryBrowser(t, testServer.URL, cookie)
	t.Cleanup(func() { _ = browser.Close() })
	downloadPath := prepareFileDownloadCapabilityForTest(t, browser, hub, csrf, "hub-download-http:proj1")

	type httpResult struct {
		response *http.Response
		err      error
	}
	resultChannel := make(chan httpResult, 1)
	go func() {
		request, err := http.NewRequest(http.MethodGet, testServer.URL+downloadPath, nil)
		if err == nil {
			request.AddCookie(cookie)
		}
		response, requestErr := http.DefaultClient.Do(request)
		resultChannel <- httpResult{response: response, err: firstError(err, requestErr)}
	}()

	if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	open := mustReadEnvelope(t, hub)
	if open.Method != rp.RegistryMethodFileDownloadOpen {
		t.Fatalf("open=%+v", open)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: open.Method, ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "stream-transfer", "fileName": "résumé 2026.txt",
			"mimeType": "text/plain", "size": 6, "identity": "identity-1",
		},
	})

	for index, chunk := range []string{"abc", "def"} {
		read := mustReadEnvelope(t, hub)
		if read.Method != rp.RegistryMethodFileDownloadRead || read.Payload["offset"] != float64(index*3) {
			t.Fatalf("read %d=%+v", index, read)
		}
		mustWriteJSON(t, hub, testEnvelope{
			RequestID: read.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
			Method: read.Method, ProjectID: read.ProjectID,
			Payload: map[string]any{
				"ok": true, "data": base64.StdEncoding.EncodeToString([]byte(chunk)),
				"nextOffset": (index + 1) * 3, "eof": index == 1,
			},
		})
	}
	closeRequest := mustReadEnvelope(t, hub)
	if closeRequest.Method != rp.RegistryMethodFileDownloadClose || closeRequest.Payload["transferId"] != "stream-transfer" {
		t.Fatalf("close=%+v", closeRequest)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: closeRequest.Method, ProjectID: closeRequest.ProjectID,
		Payload: map[string]any{"ok": true},
	})

	got := <-resultChannel
	if got.err != nil {
		t.Fatal(got.err)
	}
	body, err := io.ReadAll(got.response.Body)
	got.response.Body.Close()
	if err != nil || string(body) != "abcdef" || got.response.StatusCode != http.StatusOK {
		t.Fatalf("status=%d body=%q err=%v", got.response.StatusCode, body, err)
	}
	for header, want := range map[string]string{
		"Content-Length":         "6",
		"Cache-Control":          "no-store",
		"Accept-Ranges":          "none",
		"X-Content-Type-Options": "nosniff",
		"Content-Type":           "text/plain",
	} {
		if value := got.response.Header.Get(header); value != want {
			t.Fatalf("%s=%q, want %q", header, value, want)
		}
	}
	disposition := got.response.Header.Get("Content-Disposition")
	if !strings.HasPrefix(disposition, "attachment;") || !strings.Contains(disposition, "filename*=UTF-8''r%C3%A9sum%C3%A9%202026.txt") || strings.ContainsAny(disposition, "\r\n") {
		t.Fatalf("Content-Disposition=%q", disposition)
	}

	repeat, err := http.NewRequest(http.MethodGet, testServer.URL+downloadPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	repeat.AddCookie(cookie)
	repeatResponse, err := http.DefaultClient.Do(repeat)
	if err != nil {
		t.Fatal(err)
	}
	defer repeatResponse.Body.Close()
	if repeatResponse.StatusCode != http.StatusGone {
		t.Fatalf("repeat status=%d, want 410", repeatResponse.StatusCode)
	}
}

func TestFileDownloadHTTPRejectsRange(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, _ := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	session, ok := server.webSessions.AuthenticateForBasePath(cookie.Value, "/")
	if !ok {
		t.Fatal("session not found")
	}
	token, err := server.fileDownloads.issue(fileDownloadTask{
		DeviceID: session.DeviceID, BasePath: "/", ProjectID: "hub:project",
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodGet, testServer.URL+"/download/"+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	request.Header.Set("Range", "bytes=0-3")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestedRangeNotSatisfiable || response.Header.Get("Accept-Ranges") != "none" {
		t.Fatalf("status=%d Accept-Ranges=%q", response.StatusCode, response.Header.Get("Accept-Ranges"))
	}
}

func TestFileDownloadHTTPCancellationClosesHubTransfer(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-download-cancel", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	browser := connectRegistryBrowser(t, testServer.URL, cookie)
	t.Cleanup(func() { _ = browser.Close() })
	downloadPath := prepareFileDownloadCapabilityForTest(t, browser, hub, csrf, "hub-download-cancel:proj1")

	requestContext, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, testServer.URL+downloadPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	resultChannel := make(chan error, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if response != nil {
			_ = response.Body.Close()
		}
		resultChannel <- requestErr
	}()

	open := mustReadEnvelope(t, hub)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: open.Method, ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "cancel-transfer", "fileName": "résumé 2026.txt",
			"mimeType": "text/plain", "size": 6, "identity": "identity-1",
		},
	})
	read := mustReadEnvelope(t, hub)
	if read.Method != rp.RegistryMethodFileDownloadRead {
		t.Fatalf("read=%+v", read)
	}
	cancel()
	closeRequest := mustReadEnvelope(t, hub)
	if closeRequest.Method != rp.RegistryMethodFileDownloadClose || closeRequest.Payload["transferId"] != "cancel-transfer" {
		t.Fatalf("close=%+v", closeRequest)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: closeRequest.Method, ProjectID: closeRequest.ProjectID,
		Payload: map[string]any{"ok": true},
	})
	select {
	case <-resultChannel:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled HTTP request did not return")
	}
}

func TestRegistryFileDownloadRouteIsExact(t *testing.T) {
	token := strings.Repeat("A", 43)
	basePath, gotToken, ok := registryFileDownloadRoute("/wheelmaker/download/" + token)
	if !ok || basePath != "/wheelmaker/" || gotToken != token {
		t.Fatalf("route=(%q, %q, %v)", basePath, gotToken, ok)
	}
	for _, requestPath := range []string{
		"/download/short",
		"/wheelmaker/download/" + token + "/extra",
		"/wheelmaker//download/" + token,
		"/wheelmaker/../download/" + token,
		"/wheelmaker\\download\\" + token,
	} {
		if _, _, accepted := registryFileDownloadRoute(requestPath); accepted {
			t.Fatalf("accepted malformed route %q", requestPath)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.com/download/%41"+strings.Repeat("A", 42), nil)
	if request.URL.RawPath == "" {
		t.Fatal("encoded test URL did not retain RawPath")
	}
	recorder := httptest.NewRecorder()
	New(Config{}).handleHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("encoded capability status=%d, want 404", recorder.Code)
	}
}

func prepareFileDownloadCapabilityForTest(t *testing.T, browser, hub *websocket.Conn, csrf, projectID string) string {
	t.Helper()
	mustWriteJSON(t, browser, testEnvelope{
		RequestID: 30, Type: rp.RegistryEnvelopeTypeRequest,
		Method: rp.RegistryMethodFileDownloadPrepare, ProjectID: projectID,
		Payload: map[string]any{
			"csrfToken": csrf,
			"source":    map[string]any{"kind": fileDownloadSourceProject, "path": "résumé 2026.txt"},
		},
	})
	open := mustReadEnvelope(t, hub)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: open.Method, ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "probe-transfer", "fileName": "résumé 2026.txt",
			"mimeType": "text/plain", "size": 6, "identity": "identity-1",
		},
	})
	closeRequest := mustReadEnvelope(t, hub)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: closeRequest.Method, ProjectID: closeRequest.ProjectID,
		Payload: map[string]any{"ok": true},
	})
	prepared := mustReadEnvelope(t, browser)
	path, _ := prepared.Payload["downloadPath"].(string)
	if path == "" {
		t.Fatalf("prepared=%+v", prepared)
	}
	return path
}

func firstError(errorsToCheck ...error) error {
	for _, err := range errorsToCheck {
		if err != nil {
			return err
		}
	}
	return nil
}
