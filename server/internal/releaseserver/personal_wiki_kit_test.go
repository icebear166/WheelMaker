package releaseserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPersonalWikiKitCommitPublishesIndependentStableAndAnonymousAssets(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	started := prepareCompleteKitSession(t, server, "0.1.0", strings.Repeat("a", 40))
	stable, status := commitKitTestSession(t, server, started.SessionID)
	if status != http.StatusOK {
		t.Fatalf("commit status = %d", status)
	}
	if stable.Schema != 1 || stable.Version != "0.1.0" || stable.SourceSHA != strings.Repeat("a", 40) {
		t.Fatalf("stable = %+v", stable)
	}
	if stable.Setup.Path != "/setup-wiki.bat" || stable.Artifacts["windows-x64"].Path != "/personal-wiki-kit/releases/v0.1.0/personal-wiki-kit-v0.1.0-windows-x64.zip" {
		t.Fatalf("stable pointers = %+v", stable)
	}
	if _, err := os.Stat(filepath.Join(root, "public", "stable.json")); !os.IsNotExist(err) {
		t.Fatalf("WheelMaker stable changed: %v", err)
	}

	for _, tc := range []struct {
		path      string
		body      string
		cachePart string
	}{
		{path: "/setup-wiki.bat", body: "setup 0.1.0\n", cachePart: "no-store"},
		{path: "/personal-wiki-kit/stable.json", cachePart: "no-store"},
		{path: stable.Artifacts["windows-x64"].Path, body: "windows 0.1.0\n", cachePart: "immutable"},
		{path: stable.Artifacts["linux-x64"].Path, body: "linux 0.1.0\n", cachePart: "immutable"},
	} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, body = %s", tc.path, recorder.Code, recorder.Body.String())
		}
		if tc.body != "" && recorder.Body.String() != tc.body {
			t.Fatalf("GET %s body = %q", tc.path, recorder.Body.String())
		}
		if !strings.Contains(recorder.Header().Get("Cache-Control"), tc.cachePart) {
			t.Fatalf("GET %s cache = %q", tc.path, recorder.Header().Get("Cache-Control"))
		}
	}
}

func TestPersonalWikiKitRejectsInvalidIncompleteAndDuplicateReleases(t *testing.T) {
	server, _ := newAuthenticatedSessionTestServer(t)
	for _, version := range []string{"v0.1.0", "latest", "0.01.0", "0.1"} {
		raw, _ := json.Marshal(kitStartRequest{Version: version, SourceSHA: strings.Repeat("a", 40), Publisher: "local"})
		recorder := authenticatedKitRequest(server, http.MethodPost, "/api/personal-wiki-kit/start", raw, "")
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("version %q status = %d", version, recorder.Code)
		}
	}

	started := startKitTestSession(t, server, "0.1.0", strings.Repeat("a", 40))
	body := []byte("not allowed")
	recorder := authenticatedKitRequest(server, http.MethodPut, "/api/personal-wiki-kit/"+started.SessionID+"/files/other.zip", body, sha256BytesHex(body))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected file status = %d", recorder.Code)
	}
	_, status := commitKitTestSession(t, server, started.SessionID)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("incomplete commit status = %d", status)
	}

	first := prepareCompleteKitSession(t, server, "0.1.0", strings.Repeat("b", 40))
	if _, status := commitKitTestSession(t, server, first.SessionID); status != http.StatusOK {
		t.Fatalf("first complete commit status = %d", status)
	}
	duplicate := prepareCompleteKitSession(t, server, "0.1.0", strings.Repeat("c", 40))
	if _, status := commitKitTestSession(t, server, duplicate.SessionID); status != http.StatusConflict {
		t.Fatalf("duplicate commit status = %d", status)
	}
}

func TestPersonalWikiKitVerificationFailureRollsBackVisibleFiles(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteKitSession(t, server, "0.1.0", strings.Repeat("a", 40))
	if _, status := commitKitTestSession(t, server, first.SessionID); status != http.StatusOK {
		t.Fatalf("first commit status = %d", status)
	}
	stableBefore, err := os.ReadFile(filepath.Join(root, "public", "personal-wiki-kit", "stable.json"))
	if err != nil {
		t.Fatal(err)
	}
	setupBefore, err := os.ReadFile(filepath.Join(root, "public", "setup-wiki.bat"))
	if err != nil {
		t.Fatal(err)
	}
	server.verifyPublicKit = func(kitStableDocument, kitPublishSession) error {
		return errors.New("injected public verification failure")
	}
	second := prepareCompleteKitSession(t, server, "0.2.0", strings.Repeat("b", 40))
	if _, status := commitKitTestSession(t, server, second.SessionID); status != http.StatusInternalServerError {
		t.Fatalf("failed commit status = %d", status)
	}
	stableAfter, _ := os.ReadFile(filepath.Join(root, "public", "personal-wiki-kit", "stable.json"))
	setupAfter, _ := os.ReadFile(filepath.Join(root, "public", "setup-wiki.bat"))
	if !bytes.Equal(stableBefore, stableAfter) || !bytes.Equal(setupBefore, setupAfter) {
		t.Fatal("visible Kit files changed after failed verification")
	}
	if _, err := os.Stat(filepath.Join(root, "public", "personal-wiki-kit", "releases", "v0.2.0")); !os.IsNotExist(err) {
		t.Fatalf("failed version directory remains: %v", err)
	}
}

func TestPersonalWikiKitCommitDoesNotChangeWheelMakerReleaseState(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	publicRoot := filepath.Join(root, "public")
	wheelMakerStable := []byte(`{"schema":2,"version":"v1.99"}`)
	wheelMakerHistory := []byte(`{"schema":1,"releases":[]}`)
	if err := os.WriteFile(filepath.Join(publicRoot, "stable.json"), wheelMakerStable, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicRoot, "releases.json"), wheelMakerHistory, 0o640); err != nil {
		t.Fatal(err)
	}
	started := prepareCompleteKitSession(t, server, "1.0.0", strings.Repeat("d", 40))
	if _, status := commitKitTestSession(t, server, started.SessionID); status != http.StatusOK {
		t.Fatalf("Kit commit status = %d", status)
	}
	for name, want := range map[string][]byte{"stable.json": wheelMakerStable, "releases.json": wheelMakerHistory} {
		got, err := os.ReadFile(filepath.Join(publicRoot, name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("WheelMaker %s changed to %s", name, got)
		}
	}
}

func TestPersonalWikiKitStaleSessionCleanupRemovesOnlyKitStaging(t *testing.T) {
	current := time.Date(2026, 8, 19, 9, 0, 0, 0, time.UTC)
	server, root := newSessionTestServer(t, func() time.Time { return current })
	started := startKitTestSession(t, server, "0.1.0", strings.Repeat("e", 40))
	keep := filepath.Join(root, "public", "setup-wiki.bat")
	if err := os.WriteFile(keep, []byte("keep"), 0o640); err != nil {
		t.Fatal(err)
	}
	current = current.Add(staleSessionAge + time.Minute)
	if err := server.cleanupStaleSessions(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(server.kitSessionDirectory(started.SessionID)); !os.IsNotExist(err) {
		t.Fatalf("stale Kit session remains: %v", err)
	}
	if got, err := os.ReadFile(keep); err != nil || string(got) != "keep" {
		t.Fatalf("public file changed: %q, %v", got, err)
	}
}

func prepareCompleteKitSession(t *testing.T, server *Server, version, sourceSHA string) kitStartResponse {
	t.Helper()
	started := startKitTestSession(t, server, version, sourceSHA)
	files := map[string][]byte{
		"setup-wiki.bat": []byte("setup " + version + "\n"),
		"personal-wiki-kit-v" + version + "-windows-x64.zip":  []byte("windows " + version + "\n"),
		"personal-wiki-kit-v" + version + "-linux-x64.tar.gz": []byte("linux " + version + "\n"),
	}
	for name, body := range files {
		recorder := authenticatedKitRequest(server, http.MethodPut, "/api/personal-wiki-kit/"+started.SessionID+"/files/"+name, body, sha256BytesHex(body))
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("upload %s status = %d, body = %s", name, recorder.Code, recorder.Body.String())
		}
	}
	return started
}

func startKitTestSession(t *testing.T, server *Server, version, sourceSHA string) kitStartResponse {
	t.Helper()
	raw, err := json.Marshal(kitStartRequest{Version: version, SourceSHA: sourceSHA, Publisher: "local"})
	if err != nil {
		t.Fatal(err)
	}
	recorder := authenticatedKitRequest(server, http.MethodPost, "/api/personal-wiki-kit/start", raw, "")
	if recorder.Code != http.StatusCreated {
		t.Fatalf("start status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response kitStartResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func commitKitTestSession(t *testing.T, server *Server, sessionID string) (kitStableDocument, int) {
	t.Helper()
	recorder := authenticatedKitRequest(server, http.MethodPost, "/api/personal-wiki-kit/"+sessionID+"/commit", nil, "")
	var stable kitStableDocument
	if recorder.Code == http.StatusOK {
		if err := json.Unmarshal(recorder.Body.Bytes(), &stable); err != nil {
			t.Fatal(err)
		}
	}
	return stable, recorder.Code
}

func authenticatedKitRequest(server *Server, method, path string, body []byte, digest string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	if digest != "" {
		request.Header.Set("X-WheelMaker-SHA256", digest)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	return recorder
}
