package releaseserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDebugWebCommitPublishesVerifiedCurrentArchiveWithoutStableChanges(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	archive := []byte("debug web zip bytes")
	started := startDebugWebTestSession(t, server, archive)

	upload := httptest.NewRequest(http.MethodPut, "/api/debug-web/"+started.SessionID+"/archive", bytes.NewReader(archive))
	upload.ContentLength = int64(len(archive))
	upload.Header.Set("Authorization", "Bearer "+testPublisherToken)
	upload.Header.Set("X-WheelMaker-SHA256", sha256BytesHex(archive))
	uploadRecorder := httptest.NewRecorder()
	server.ServeHTTP(uploadRecorder, upload)
	if uploadRecorder.Code != http.StatusNoContent {
		t.Fatalf("upload status=%d body=%s", uploadRecorder.Code, uploadRecorder.Body.String())
	}

	commit := httptest.NewRequest(http.MethodPost, "/api/debug-web/"+started.SessionID+"/commit", nil)
	commit.Header.Set("Authorization", "Bearer "+testPublisherToken)
	commitRecorder := httptest.NewRecorder()
	server.ServeHTTP(commitRecorder, commit)
	if commitRecorder.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", commitRecorder.Code, commitRecorder.Body.String())
	}

	var current debugWebCurrent
	readJSONTestFile(t, filepath.Join(root, "public", "debug-web", "current.json"), &current)
	if current.Schema != 1 || current.ArchivePath != "/debug-web/archives/"+sha256BytesHex(archive)+".zip" || current.Size != int64(len(archive)) || current.SHA256 != sha256BytesHex(archive) {
		t.Fatalf("current=%+v", current)
	}
	if _, err := os.Stat(filepath.Join(root, "public", "debug-web", "archives", sha256BytesHex(archive)+".zip")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "public", "stable.json")); !os.IsNotExist(err) {
		t.Fatalf("debug web changed stable metadata: %v", err)
	}
}

func TestDebugWebRejectsBadDigestAndKeepsCurrentSnapshot(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	old := debugWebCurrent{Schema: 1, ArchivePath: "/debug-web/archives/old.zip", Size: 3, SHA256: sha256BytesHex([]byte("old")), PublishedAt: "2026-07-17T09:00:00Z"}
	if err := os.MkdirAll(filepath.Join(root, "public", "debug-web"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFileAtomic(filepath.Join(root, "public", "debug-web", "current.json"), old, 0o640); err != nil {
		t.Fatal(err)
	}
	archive := []byte("new archive")
	started := startDebugWebTestSession(t, server, archive)
	upload := httptest.NewRequest(http.MethodPut, "/api/debug-web/"+started.SessionID+"/archive", bytes.NewReader(archive))
	upload.ContentLength = int64(len(archive))
	upload.Header.Set("Authorization", "Bearer "+testPublisherToken)
	upload.Header.Set("X-WheelMaker-SHA256", sha256BytesHex([]byte("wrong")))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, upload)
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("upload status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var current debugWebCurrent
	readJSONTestFile(t, filepath.Join(root, "public", "debug-web", "current.json"), &current)
	if current != old {
		t.Fatalf("current=%+v, want %+v", current, old)
	}
}

func startDebugWebTestSession(t *testing.T, server *Server, archive []byte) debugWebStartResponse {
	t.Helper()
	body, err := json.Marshal(debugWebStartRequest{Size: int64(len(archive)), SHA256: sha256BytesHex(archive)})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/debug-web/start", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("start status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response debugWebStartResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}
