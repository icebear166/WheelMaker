package releaseserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

func TestFirstCommitCreatesV11Schema2StableAndHistory(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	started := prepareCompleteTestSession(t, server, validStartRequest())

	stable, status := commitTestSession(t, server, started.SessionID)

	if status != http.StatusOK {
		t.Fatalf("commit status = %d", status)
	}
	if stable.Schema != 2 || stable.Version != "v1.1" || stable.SourceSHA != strings.Repeat("a", 40) {
		t.Fatalf("stable = %+v", stable)
	}
	if stable.Deploy.MJSPath != "/releases/v1.1/deploy.mjs" || stable.Release.ManifestPath != "/releases/v1.1/release-manifest.json" {
		t.Fatalf("stable pointers = %+v %+v", stable.Deploy, stable.Release)
	}
	stableRaw, err := os.ReadFile(filepath.Join(root, "public", "stable.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(stableRaw, []byte(`"schema": 2`)) {
		t.Fatalf("stable bytes = %s", stableRaw)
	}
	for _, name := range []string{"deploy.mjs", "deploy-core.mjs", "releases.json"} {
		if _, err := os.Stat(filepath.Join(root, "public", name)); err != nil {
			t.Fatalf("missing derived file %s: %v", name, err)
		}
	}
	for _, name := range []string{
		"wheelmaker-v1.1-windows-amd64.tar.zst",
		"wheelmaker-v1.1-darwin-amd64.tar.zst",
	} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.1", name)); err != nil {
			t.Fatalf("version asset %s missing: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "staging", started.SessionID)); !os.IsNotExist(err) {
		t.Fatalf("committed staging remains: %v", err)
	}
	var history releaseHistory
	readJSONTestFile(t, filepath.Join(root, "public", "releases.json"), &history)
	if history.Schema != 1 || len(history.Releases) != 1 || history.Releases[0].Version != "v1.1" || len(history.Releases[0].Assets) != 7 {
		t.Fatalf("history = %+v", history)
	}
}

func TestCommitCarriesOptionalPointersAcrossVersions(t *testing.T) {
	server, _ := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, startRequest{
		Version:     "v1.1",
		SourceSHA:   strings.Repeat("a", 40),
		Publisher:   "local",
		WithDesktop: true,
		WithAndroid: true,
	})
	firstStable, firstStatus := commitTestSession(t, server, first.SessionID)
	if firstStatus != http.StatusOK || firstStable.Desktop == nil || firstStable.Android == nil {
		t.Fatalf("first stable = %+v, status = %d", firstStable, firstStatus)
	}

	second := prepareCompleteTestSession(t, server, startRequest{
		Version:   "v1.2",
		SourceSHA: strings.Repeat("b", 40),
		Publisher: "action",
	})
	secondStable, secondStatus := commitTestSession(t, server, second.SessionID)
	if secondStatus != http.StatusOK {
		t.Fatalf("second status = %d", secondStatus)
	}
	if secondStable.Desktop == nil || secondStable.Desktop.Version != "v1.1" || secondStable.Android == nil || secondStable.Android.Version != "v1.1" {
		t.Fatalf("optional pointers were not inherited: %+v", secondStable)
	}
}

func TestGatewayCommitUsesFixedCurrentAndPreviousSlots(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, startRequest{
		Version:     "v1.1",
		SourceSHA:   strings.Repeat("a", 40),
		Publisher:   "local",
		WithGateway: true,
	})
	firstStable, firstStatus := commitTestSession(t, server, first.SessionID)
	if firstStatus != http.StatusOK || firstStable.Gateway == nil {
		t.Fatalf("first Gateway stable = %+v, status = %d", firstStable.Gateway, firstStatus)
	}
	firstManifest, err := os.ReadFile(filepath.Join(root, "public", "gateway", "current", "gateway-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.1", "gateway-manifest.json")); !os.IsNotExist(err) {
		t.Fatalf("Gateway manifest leaked into version release: %v", err)
	}

	second := prepareCompleteTestSession(t, server, startRequest{
		Version:     "v1.2",
		SourceSHA:   strings.Repeat("b", 40),
		Publisher:   "local",
		WithGateway: true,
	})
	secondStable, secondStatus := commitTestSession(t, server, second.SessionID)
	if secondStatus != http.StatusOK || secondStable.Gateway == nil || secondStable.Gateway.Version != "v1.2" {
		t.Fatalf("second Gateway stable = %+v, status = %d", secondStable.Gateway, secondStatus)
	}
	previousManifest, err := os.ReadFile(filepath.Join(root, "public", "gateway", "previous", "gateway-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(previousManifest, firstManifest) {
		t.Fatal("Gateway previous slot does not contain the previous manifest")
	}
}

func TestGatewayPointerCarriesForwardWhenReleaseOmitsGateway(t *testing.T) {
	server, _ := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, startRequest{
		Version:     "v1.1",
		SourceSHA:   strings.Repeat("a", 40),
		Publisher:   "local",
		WithGateway: true,
	})
	firstStable, firstStatus := commitTestSession(t, server, first.SessionID)
	if firstStatus != http.StatusOK || firstStable.Gateway == nil {
		t.Fatalf("first Gateway stable = %+v, status = %d", firstStable.Gateway, firstStatus)
	}
	second := prepareCompleteTestSession(t, server, startRequest{
		Version:   "v1.2",
		SourceSHA: strings.Repeat("b", 40),
		Publisher: "local",
	})
	secondStable, secondStatus := commitTestSession(t, server, second.SessionID)
	if secondStatus != http.StatusOK || secondStable.Gateway == nil {
		t.Fatalf("Gateway pointer was not carried forward: %+v, status = %d", secondStable.Gateway, secondStatus)
	}
	if *secondStable.Gateway != *firstStable.Gateway {
		t.Fatalf("Gateway pointer changed without a Gateway publish: first=%+v second=%+v", *firstStable.Gateway, *secondStable.Gateway)
	}
}

func TestGatewayStableWriteFailureRestoresCurrentAndStagingFiles(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, startRequest{
		Version:     "v1.1",
		SourceSHA:   strings.Repeat("a", 40),
		Publisher:   "local",
		WithGateway: true,
	})
	if _, status := commitTestSession(t, server, first.SessionID); status != http.StatusOK {
		t.Fatalf("first commit status = %d", status)
	}
	previousCurrent, err := os.ReadFile(filepath.Join(root, "public", "gateway", "current", "gateway-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	second := prepareCompleteTestSession(t, server, startRequest{
		Version:     "v1.2",
		SourceSHA:   strings.Repeat("b", 40),
		Publisher:   "local",
		WithGateway: true,
	})
	originalWrite := server.writeJSON
	server.writeJSON = func(path string, value any, mode os.FileMode) error {
		if filepath.Base(path) == "stable.json" {
			return errors.New("injected Gateway stable failure")
		}
		return originalWrite(path, value, mode)
	}
	if _, status := commitTestSession(t, server, second.SessionID); status != http.StatusInternalServerError {
		t.Fatalf("second commit status = %d", status)
	}
	current, err := os.ReadFile(filepath.Join(root, "public", "gateway", "current", "gateway-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(current, previousCurrent) {
		t.Fatal("Gateway current slot changed after stable write failure")
	}
	if _, err := os.Stat(filepath.Join(root, "staging", second.SessionID, "files", "gateway-manifest.json")); err != nil {
		t.Fatalf("failed Gateway transaction was not restored to staging: %v", err)
	}
}

func TestStableWriteFailureLeavesPreviousStableBytesUntouched(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, validStartRequest())
	_, status := commitTestSession(t, server, first.SessionID)
	if status != http.StatusOK {
		t.Fatalf("first commit status = %d", status)
	}
	previous, err := os.ReadFile(filepath.Join(root, "public", "stable.json"))
	if err != nil {
		t.Fatal(err)
	}

	second := prepareCompleteTestSession(t, server, startRequest{
		Version:   "v1.2",
		SourceSHA: strings.Repeat("b", 40),
		Publisher: "local",
	})
	originalWrite := server.writeJSON
	server.writeJSON = func(path string, value any, mode os.FileMode) error {
		if filepath.Base(path) == "stable.json" {
			return errors.New("injected stable failure")
		}
		return originalWrite(path, value, mode)
	}
	_, status = commitTestSession(t, server, second.SessionID)
	if status != http.StatusInternalServerError {
		t.Fatalf("failed commit status = %d", status)
	}
	got, err := os.ReadFile(filepath.Join(root, "public", "stable.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, previous) {
		t.Fatalf("stable changed after failure:\n%s", got)
	}
	if _, err := os.Stat(filepath.Join(root, "staging", second.SessionID, "files", "deploy.mjs")); err != nil {
		t.Fatalf("failed transaction was not restored to staging: %v", err)
	}
}

func TestConcurrentSameVersionHasOneWinner(t *testing.T) {
	server, _ := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, validStartRequest())
	second := prepareCompleteTestSession(t, server, validStartRequest())
	statuses := make([]int, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	for index, sessionID := range []string{first.SessionID, second.SessionID} {
		go func(index int, sessionID string) {
			defer wait.Done()
			_, statuses[index] = commitTestSession(t, server, sessionID)
		}(index, sessionID)
	}
	wait.Wait()
	sort.Ints(statuses)
	if statuses[0] != http.StatusOK || statuses[1] != http.StatusConflict {
		t.Fatalf("statuses = %v", statuses)
	}
}

func TestCommitRejectsInsufficientStorageBeforeStable(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	started := prepareCompleteTestSession(t, server, validStartRequest())
	server.diskFree = func(string) (uint64, error) { return 512 << 20, nil }

	_, status := commitTestSession(t, server, started.SessionID)

	if status != http.StatusInsufficientStorage {
		t.Fatalf("status = %d", status)
	}
	if _, err := os.Stat(filepath.Join(root, "public", "stable.json")); !os.IsNotExist(err) {
		t.Fatalf("stable exists after storage rejection: %v", err)
	}
}

func TestStartupRecoveryRepairsDerivedFilesAndQuarantinesNewerDirectory(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, validStartRequest())
	_, status := commitTestSession(t, server, first.SessionID)
	if status != http.StatusOK {
		t.Fatalf("commit status = %d", status)
	}
	for _, name := range []string{"deploy.mjs", "deploy-core.mjs", "releases.json"} {
		if err := os.Remove(filepath.Join(root, "public", name)); err != nil {
			t.Fatal(err)
		}
	}
	orphan := filepath.Join(root, "public", "releases", "v1.2")
	if err := os.MkdirAll(orphan, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(orphan, "orphan"), []byte("orphan"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := server.recoverPublishedState(); err != nil {
		t.Fatalf("recoverPublishedState() error = %v", err)
	}
	for _, name := range []string{"deploy.mjs", "deploy-core.mjs", "releases.json"} {
		if _, err := os.Stat(filepath.Join(root, "public", name)); err != nil {
			t.Fatalf("derived file %s not repaired: %v", name, err)
		}
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan remained public: %v", err)
	}
	recoveryEntries, err := filepath.Glob(filepath.Join(root, "staging", "recovery-v1.2-*"))
	if err != nil || len(recoveryEntries) != 1 {
		t.Fatalf("recovery entries = %v, error = %v", recoveryEntries, err)
	}
	if _, err := os.Stat(filepath.Join(recoveryEntries[0], "orphan")); err != nil {
		t.Fatalf("orphan was deleted instead of quarantined: %v", err)
	}
}

func prepareCompleteTestSession(t *testing.T, server *Server, request startRequest) startResponse {
	t.Helper()
	started := startTestSession(t, server, request)
	files := map[string][]byte{
		"deploy.mjs":      []byte("#!/usr/bin/env node\n"),
		"deploy-core.mjs": []byte("export const core = true;\n"),
		"wheelmaker-" + request.Version + "-windows-amd64.tar.zst": []byte("windows archive"),
		"wheelmaker-" + request.Version + "-linux-amd64.tar.zst":   []byte("linux archive"),
		"wheelmaker-" + request.Version + "-darwin-amd64.tar.zst":  []byte("darwin amd64 archive"),
		"wheelmaker-" + request.Version + "-darwin-arm64.tar.zst":  []byte("darwin archive"),
	}
	if request.WithDesktop {
		files["WheelMakerDesktop.exe"] = []byte("desktop executable")
	}
	if request.WithAndroid {
		apk := []byte("android package")
		files["WheelMakerAndroid.apk"] = apk
		androidManifest, err := json.Marshal(map[string]any{
			"schema":      1,
			"platform":    "android",
			"version":     request.Version,
			"versionName": request.Version[1:],
			"versionCode": versionNumberForTest(request.Version),
			"sourceSha":   request.SourceSHA,
			"builtAt":     started.PublishedAt,
			"apk": map[string]any{
				"fileName": "WheelMakerAndroid.apk",
				"sha256":   sha256BytesHex(apk),
				"size":     len(apk),
			},
			"signing": map[string]any{"certificateSha256": []string{strings.Repeat("c", 64)}},
		})
		if err != nil {
			t.Fatal(err)
		}
		files["android-release.json"] = append(androidManifest, '\n')
	}
	if request.WithGateway {
		gatewayArtifacts := map[string]any{}
		for _, platform := range []string{"windows-amd64", "linux-amd64", "darwin-amd64", "darwin-arm64"} {
			name := "wheelmaker-gateway-" + request.Version + "-" + platform + ".tar.zst"
			body := []byte("gateway archive " + platform)
			files[name] = body
			gatewayArtifacts[platform] = map[string]any{
				"path":   "/gateway/current/" + name,
				"sha256": sha256BytesHex(body),
				"size":   len(body),
			}
		}
		gatewayManifest, err := json.Marshal(map[string]any{
			"schema":      1,
			"version":     request.Version,
			"publishedAt": started.PublishedAt,
			"sourceSha":   request.SourceSHA,
			"path":        "/gateway/current/gateway-manifest.json",
			"artifacts":   gatewayArtifacts,
		})
		if err != nil {
			t.Fatal(err)
		}
		files["gateway-manifest.json"] = append(gatewayManifest, '\n')
	}

	artifacts := map[string]artifact{}
	for _, platform := range []string{"windows-amd64", "linux-amd64", "darwin-amd64", "darwin-arm64"} {
		name := "wheelmaker-" + request.Version + "-" + platform + ".tar.zst"
		body := files[name]
		artifacts[platform] = artifact{
			Path:   "/releases/" + request.Version + "/" + name,
			SHA256: sha256BytesHex(body),
			Size:   int64(len(body)),
		}
	}
	manifestValue := map[string]any{
		"schema":      2,
		"version":     request.Version,
		"publishedAt": started.PublishedAt,
		"sourceSha":   request.SourceSHA,
		"artifacts":   artifacts,
	}
	if request.WithGateway {
		manifestValue["gateway"] = map[string]any{
			"manifestPath":   "/gateway/current/gateway-manifest.json",
			"manifestSha256": sha256BytesHex(files["gateway-manifest.json"]),
			"sourceSha":      request.SourceSHA,
			"version":        request.Version,
		}
	}
	manifestRaw, err := json.Marshal(manifestValue)
	if err != nil {
		t.Fatal(err)
	}
	files["release-manifest.json"] = append(manifestRaw, '\n')

	for name, body := range files {
		uploadTestFile(t, server, started.SessionID, name, body)
	}
	return started
}

func uploadTestFile(t *testing.T, server *Server, sessionID string, name string, body []byte) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPut, "/api/publish/"+sessionID+"/files/"+name, bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	request.Header.Set("X-WheelMaker-SHA256", sha256BytesHex(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("upload %s status = %d, body = %s", name, recorder.Code, recorder.Body.String())
	}
}

func commitTestSession(t *testing.T, server *Server, sessionID string) (stableDocument, int) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/publish/"+sessionID+"/commit", nil)
	request.Header.Set("Authorization", "Bearer "+testPublisherToken)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	var stable stableDocument
	if recorder.Code == http.StatusOK {
		if err := json.Unmarshal(recorder.Body.Bytes(), &stable); err != nil {
			t.Fatalf("decode stable response: %v; body = %s", err, recorder.Body.String())
		}
	}
	return stable, recorder.Code
}

func versionNumberForTest(version string) int {
	var number int
	if _, err := fmt.Sscanf(version, "v1.%d", &number); err != nil {
		panic(err)
	}
	return number
}

func readJSONTestFile(t *testing.T, path string, destination any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, destination); err != nil {
		t.Fatal(err)
	}
}
