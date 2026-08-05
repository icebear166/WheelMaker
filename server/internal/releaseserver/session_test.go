package releaseserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testPublisherToken = "release-token"

func TestStartSessionUsesServerIdentityAndFixedWhitelist(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	response := startTestSession(t, server, startRequest{
		Version:     "v1.1",
		SourceSHA:   strings.Repeat("a", 40),
		Publisher:   "local",
		WithDesktop: true,
		WithAndroid: true,
		WithGateway: true,
	})

	if response.Schema != 1 || response.SessionID != strings.Repeat("01", 16) {
		t.Fatalf("start response = %+v", response)
	}
	if response.PublishedAt != "2026-07-17T09:00:00Z" {
		t.Fatalf("publishedAt = %q", response.PublishedAt)
	}
	session := readTestSession(t, root, response.SessionID)
	if session.Version != "v1.1" || session.Publisher != "local" || !session.WithDesktop || !session.WithAndroid {
		t.Fatalf("session = %+v", session)
	}
	if len(session.AllowedFiles) != 15 {
		t.Fatalf("allowed file count = %d, want 15", len(session.AllowedFiles))
	}
	if _, ok := session.AllowedFiles["WheelMakerDesktop.exe"]; !ok {
		t.Fatal("Desktop file missing from whitelist")
	}
	if _, ok := session.AllowedFiles["WheelMakerAndroid.apk"]; !ok {
		t.Fatal("Android file missing from whitelist")
	}
	if _, ok := session.AllowedFiles["gateway-manifest.json"]; !ok {
		t.Fatal("Gateway manifest missing from whitelist")
	}
}

func TestPublishSessionStreamsDeclaredFile(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	started := startTestSession(t, server, validStartRequest())
	body := []byte("#!/usr/bin/env node\n")
	request := httptest.NewRequest(
		http.MethodPut,
		"/api/publish/"+started.SessionID+"/files/deploy.mjs",
		bytes.NewReader(body),
	)
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	request.Header.Set("X-WheelMaker-SHA256", sha256BytesHex(body))
	recorder := httptest.NewRecorder()

	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	got, err := os.ReadFile(filepath.Join(root, "staging", started.SessionID, "files", "deploy.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("uploaded bytes = %q", got)
	}
	session := readTestSession(t, root, started.SessionID)
	if session.Files["deploy.mjs"].SHA256 != sha256BytesHex(body) || session.Files["deploy.mjs"].Size != int64(len(body)) {
		t.Fatalf("recorded file = %+v", session.Files["deploy.mjs"])
	}
}

func TestUploadRejectsTraversalDigestMismatchAndMissingLength(t *testing.T) {
	server, _ := newAuthenticatedSessionTestServer(t)
	started := startTestSession(t, server, validStartRequest())
	body := []byte("x")

	assertUploadStatus(t, server, started.SessionID, "%2e%2e%2fstable.json", body, sha256BytesHex(body), http.StatusBadRequest)
	assertUploadStatus(t, server, started.SessionID, "deploy.mjs", body, strings.Repeat("0", 64), http.StatusUnprocessableEntity)
	assertUploadStatus(t, server, started.SessionID, "unknown.bin", body, sha256BytesHex(body), http.StatusBadRequest)

	request := httptest.NewRequest(http.MethodPut, "/api/publish/"+started.SessionID+"/files/deploy.mjs", io.NopCloser(bytes.NewReader(body)))
	request.ContentLength = -1
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	request.Header.Set("X-WheelMaker-SHA256", sha256BytesHex(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusLengthRequired {
		t.Fatalf("missing length status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestUploadRejectsDeclaredFileAndSessionLimitsBeforeReadingBody(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	started := startTestSession(t, server, startRequest{
		Version:     "v1.1",
		SourceSHA:   strings.Repeat("a", 40),
		Publisher:   "local",
		WithDesktop: true,
		WithAndroid: true,
	})

	oversized := &recordingReader{data: []byte("not read")}
	request := httptest.NewRequest(http.MethodPut, "/api/publish/"+started.SessionID+"/files/deploy.mjs", oversized)
	request.ContentLength = maxControlFileSize + 1
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	request.Header.Set("X-WheelMaker-SHA256", strings.Repeat("a", 64))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge || oversized.read {
		t.Fatalf("oversized response = %d, bodyRead = %v", recorder.Code, oversized.read)
	}

	session := readTestSession(t, root, started.SessionID)
	if _, ok := session.AllowedFiles["wheelmaker-v1.1-darwin-amd64.tar.zst"]; !ok {
		t.Fatal("darwin-amd64 file missing from whitelist")
	}
	for _, name := range []string{
		"wheelmaker-v1.1-windows-amd64.tar.zst",
		"wheelmaker-v1.1-linux-amd64.tar.zst",
		"wheelmaker-v1.1-darwin-arm64.tar.zst",
		"WheelMakerDesktop.exe",
	} {
		session.Files[name] = fileInfo{Size: maxBinaryFileSize, SHA256: strings.Repeat("b", 64)}
	}
	if err := server.writeSession(session); err != nil {
		t.Fatal(err)
	}
	totalExceeded := &recordingReader{data: []byte("x")}
	request = httptest.NewRequest(http.MethodPut, "/api/publish/"+started.SessionID+"/files/deploy.mjs", totalExceeded)
	request.ContentLength = 1
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	request.Header.Set("X-WheelMaker-SHA256", sha256BytesHex([]byte("x")))
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge || totalExceeded.read {
		t.Fatalf("session total response = %d, bodyRead = %v", recorder.Code, totalExceeded.read)
	}
}

func TestAuthenticationRejectsBeforeReadingUploadBody(t *testing.T) {
	server, _ := newAuthenticatedSessionTestServer(t)
	reader := &recordingReader{data: []byte("secret upload")}
	request := httptest.NewRequest(http.MethodPut, "/api/publish/"+strings.Repeat("0", 32)+"/files/deploy.mjs", reader)
	request.ContentLength = int64(len(reader.data))
	request.Header.Set("X-WheelMaker-SHA256", sha256BytesHex(reader.data))
	recorder := httptest.NewRecorder()

	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", recorder.Code)
	}
	if reader.read {
		t.Fatal("request body was read before authentication")
	}
}

func TestStatusDerivesIdentityAndContainsNoSecretOrStack(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	started := startTestSession(t, server, validStartRequest())
	requestBody := []byte(`{"state":"running","phase":"building"}`)
	request := httptest.NewRequest(
		http.MethodPut,
		"/api/publish/"+started.SessionID+"/status",
		bytes.NewReader(requestBody),
	)
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	recorder := httptest.NewRecorder()

	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	raw, err := os.ReadFile(filepath.Join(root, "public", "publish-status.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{testPublisherToken, "stack", root, started.SessionID} {
		if bytes.Contains(raw, []byte(forbidden)) {
			t.Fatalf("public status contains %q: %s", forbidden, raw)
		}
	}
	var status publishStatus
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatal(err)
	}
	if status.Version != "v1.1" || status.SourceSHA != strings.Repeat("a", 40) || status.Publisher != "local" {
		t.Fatalf("status identity = %+v", status)
	}
	if status.StartedAt != started.PublishedAt || status.UpdatedAt != started.PublishedAt {
		t.Fatalf("status timestamps = %+v", status)
	}
}

func TestCancelAndStaleCleanupRemoveOnlyStaging(t *testing.T) {
	now := time.Date(2026, 7, 17, 9, 0, 0, 0, time.UTC)
	server, root := newSessionTestServer(t, func() time.Time { return now })
	first := startTestSession(t, server, validStartRequest())
	putTestStatus(t, server, first.SessionID, statusRequest{State: "running", Phase: "uploading"})
	second := startTestSession(t, server, startRequest{
		Version:   "v1.2",
		SourceSHA: strings.Repeat("b", 40),
		Publisher: "action",
	})
	publicVersion := filepath.Join(root, "public", "releases", "v1.1")
	if err := os.MkdirAll(publicVersion, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicVersion, "keep"), []byte("keep"), 0o640); err != nil {
		t.Fatal(err)
	}

	cancel := httptest.NewRequest(http.MethodDelete, "/api/publish/"+second.SessionID, nil)
	cancel.Header.Set("Authorization", "Bearer "+testPublisherToken)
	cancelRecorder := httptest.NewRecorder()
	server.ServeHTTP(cancelRecorder, cancel)
	if cancelRecorder.Code != http.StatusNoContent {
		t.Fatalf("cancel status = %d, body = %s", cancelRecorder.Code, cancelRecorder.Body.String())
	}

	now = now.Add(25 * time.Hour)
	if err := server.cleanupStaleSessions(); err != nil {
		t.Fatalf("cleanupStaleSessions() error = %v", err)
	}
	for _, sessionID := range []string{first.SessionID, second.SessionID} {
		if _, err := os.Stat(filepath.Join(root, "staging", sessionID)); !os.IsNotExist(err) {
			t.Fatalf("staging %s still exists: %v", sessionID, err)
		}
	}
	if _, err := os.Stat(filepath.Join(publicVersion, "keep")); err != nil {
		t.Fatalf("public release was removed: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "public", "publish-status.json"))
	if err != nil {
		t.Fatal(err)
	}
	var status publishStatus
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatal(err)
	}
	if status.State != "failed" || status.ErrorCode != "publisher_timeout" || status.Version != "v1.1" {
		t.Fatalf("timeout status = %+v", status)
	}
}

func newAuthenticatedSessionTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	return newSessionTestServer(t, func() time.Time {
		return time.Date(2026, 7, 17, 9, 0, 0, 0, time.UTC)
	})
}

func newSessionTestServer(t *testing.T, now func() time.Time) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	server, err := newServer(
		Config{
			Schema:      1,
			Listen:      "127.0.0.1:9680",
			DataRoot:    root,
			TokenSHA256: sha256String(testPublisherToken),
		},
		serverDependencies{
			now:      now,
			random:   bytes.NewReader(sessionIDFixtureBytes()),
			diskFree: func(string) (uint64, error) { return ^uint64(0), nil },
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return server, root
}

func sessionIDFixtureBytes() []byte {
	raw := make([]byte, 0, 16*32)
	for value := byte(1); value <= 32; value++ {
		raw = append(raw, bytes.Repeat([]byte{value}, 16)...)
	}
	return raw
}

func validStartRequest() startRequest {
	return startRequest{
		Version:   "v1.1",
		SourceSHA: strings.Repeat("a", 40),
		Publisher: "local",
	}
}

func startTestSession(t *testing.T, server *Server, body startRequest) startResponse {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/publish/start", bytes.NewReader(raw))
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("start status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response startResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func putTestStatus(t *testing.T, server *Server, sessionID string, status statusRequest) {
	t.Helper()
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/api/publish/"+sessionID+"/status", bytes.NewReader(raw))
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status update = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func readTestSession(t *testing.T, root string, sessionID string) publishSession {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, "staging", sessionID, "session.json"))
	if err != nil {
		t.Fatal(err)
	}
	var session publishSession
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatal(err)
	}
	return session
}

func assertUploadStatus(t *testing.T, server *Server, sessionID string, name string, body []byte, digest string, want int) {
	t.Helper()
	request := httptest.NewRequest(
		http.MethodPut,
		"/api/publish/"+sessionID+"/files/"+name,
		bytes.NewReader(body),
	)
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	request.Header.Set("X-WheelMaker-SHA256", digest)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != want {
		t.Fatalf("upload %q status = %d, want %d, body = %s", name, recorder.Code, want, recorder.Body.String())
	}
}

func sha256BytesHex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

type recordingReader struct {
	data []byte
	read bool
}

func (r *recordingReader) Read(target []byte) (int, error) {
	r.read = true
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	n := copy(target, r.data)
	r.data = r.data[n:]
	return n, nil
}
