package releaseserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
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

func TestDerivedWriteFailureDoesNotAdvanceStable(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, validStartRequest())
	if _, status := commitTestSession(t, server, first.SessionID); status != http.StatusOK {
		t.Fatalf("first commit status = %d", status)
	}
	stableBefore, err := os.ReadFile(filepath.Join(root, "public", "stable.json"))
	if err != nil {
		t.Fatal(err)
	}
	deployBefore, err := os.ReadFile(filepath.Join(root, "public", "deploy.mjs"))
	if err != nil {
		t.Fatal(err)
	}

	second := prepareCompleteTestSession(t, server, startRequest{
		Version: "v1.2", SourceSHA: strings.Repeat("b", 40), Publisher: "local",
	})
	originalWrite := server.writeJSON
	server.writeJSON = func(path string, value any, mode os.FileMode) error {
		if filepath.Base(path) == "releases.json" {
			return errors.New("injected history failure")
		}
		return originalWrite(path, value, mode)
	}
	if _, status := commitTestSession(t, server, second.SessionID); status != http.StatusInternalServerError {
		t.Fatalf("second commit status = %d", status)
	}
	for name, want := range map[string][]byte{"stable.json": stableBefore, "deploy.mjs": deployBefore} {
		got, err := os.ReadFile(filepath.Join(root, "public", name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("%s changed after derived write failure", name)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.2")); !os.IsNotExist(err) {
		t.Fatalf("failed version remains public: %v", err)
	}
}

func TestPublicVerificationFailureRestoresPreviousVisibleRelease(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := prepareCompleteTestSession(t, server, validStartRequest())
	if _, status := commitTestSession(t, server, first.SessionID); status != http.StatusOK {
		t.Fatalf("first commit status = %d", status)
	}
	before := map[string][]byte{}
	for _, name := range []string{"stable.json", "deploy.mjs", "deploy-core.mjs", "releases.json"} {
		raw, err := os.ReadFile(filepath.Join(root, "public", name))
		if err != nil {
			t.Fatal(err)
		}
		before[name] = raw
	}
	server.verifyPublic = func(stableDocument, publishSession) error {
		return errors.New("injected public origin failure")
	}
	second := prepareCompleteTestSession(t, server, startRequest{
		Version: "v1.2", SourceSHA: strings.Repeat("b", 40), Publisher: "local",
	})
	if _, status := commitTestSession(t, server, second.SessionID); status != http.StatusInternalServerError {
		t.Fatalf("second commit status = %d", status)
	}
	for name, want := range before {
		got, err := os.ReadFile(filepath.Join(root, "public", name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("%s changed after public verification failure", name)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.2")); !os.IsNotExist(err) {
		t.Fatalf("failed version remains public: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "staging", second.SessionID, "files", "deploy.mjs")); err != nil {
		t.Fatalf("failed transaction was not restored to staging: %v", err)
	}
}

func TestCommitWritesStableAfterDerivedMetadataAndBeforePublicVerification(t *testing.T) {
	server, _ := newAuthenticatedSessionTestServer(t)
	events := []string{}
	originalWrite := server.writeJSON
	server.writeJSON = func(path string, value any, mode os.FileMode) error {
		name := filepath.Base(path)
		if name == "releases.json" || name == "publish-status.json" || name == "stable.json" {
			events = append(events, name)
		}
		return originalWrite(path, value, mode)
	}
	server.verifyPublic = func(stableDocument, publishSession) error {
		events = append(events, "public-verify")
		return nil
	}
	started := prepareCompleteTestSession(t, server, validStartRequest())
	if _, status := commitTestSession(t, server, started.SessionID); status != http.StatusOK {
		t.Fatalf("commit status = %d", status)
	}
	index := func(name string) int {
		for position, event := range events {
			if event == name {
				return position
			}
		}
		return -1
	}
	if !(index("releases.json") >= 0 && index("releases.json") < index("stable.json") && index("stable.json") < index("public-verify")) {
		t.Fatalf("commit order = %v", events)
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
			PublicURL:   "https://release.example.com",
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

func writeStorageStableFixture(t *testing.T, dataRoot string, version string) {
	t.Helper()
	sha := strings.Repeat("a", 64)
	stable := map[string]any{
		"schema":      2,
		"version":     version,
		"publishedAt": time.Now().UTC().Format(time.RFC3339),
		"sourceSha":   strings.Repeat("b", 40),
		"deploy": map[string]any{
			"mjsPath": "/releases/" + version + "/deploy.mjs", "mjsSha256": sha,
			"corePath": "/releases/" + version + "/deploy-core.mjs", "coreSha256": sha,
		},
		"release": map[string]any{
			"manifestPath": "/releases/" + version + "/release-manifest.json", "manifestSha256": sha,
		},
	}
	raw, err := json.Marshal(stable)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataRoot, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataRoot, "public", "stable.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeStorageHistoryFixture(t *testing.T, dataRoot string, versions ...string) {
	t.Helper()
	entries := make([]map[string]any, 0, len(versions))
	for _, version := range versions {
		entries = append(entries, map[string]any{
			"version":        version,
			"publishedAt":    time.Now().UTC().Format(time.RFC3339),
			"sourceSha":      strings.Repeat("b", 40),
			"manifestSha256": strings.Repeat("a", 64),
			"assets":         []any{},
		})
	}
	raw, err := json.Marshal(map[string]any{"schema": 1, "releases": entries})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataRoot, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataRoot, "public", "releases.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeStorageVersionDir(t *testing.T, dataRoot string, version string, size int) {
	t.Helper()
	directory := filepath.Join(dataRoot, "public", "releases", version)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "asset.bin"), make([]byte, size), 0o600); err != nil {
		t.Fatal(err)
	}
}

func newStorageTestHandler(t *testing.T, dataRoot string) *Server {
	t.Helper()
	handler, err := New(Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com", DataRoot: dataRoot, TokenSHA256: sha256String("release-token")})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func storageAuthorizedRequest(method string, path string) *http.Request {
	request := httptest.NewRequest(method, path, nil)
	request.Header.Set("Authorization", "Bearer release-token")
	return request
}

func TestStorageReportsTotalAndReclaimableBytes(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	writeStorageHistoryFixture(t, root, "v1.1", "v1.2", "v1.3")
	writeStorageVersionDir(t, root, "v1.1", 100) // history alone does not protect a version
	writeStorageVersionDir(t, root, "v1.3", 300) // stable
	writeStorageVersionDir(t, root, "v1.9", 200) // orphan: not referenced anywhere

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodGet, "/api/storage"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		TotalBytes       int64 `json:"totalBytes"`
		ReclaimableBytes int64 `json:"reclaimableBytes"`
		OrphanCount      int   `json:"orphanCount"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.TotalBytes != 600 || body.ReclaimableBytes != 300 || body.OrphanCount != 2 {
		t.Fatalf("storage = %+v, want total 600 reclaimable 300 orphans 2", body)
	}
}

func TestStorageRequiresPublisherToken(t *testing.T) {
	handler := newStorageTestHandler(t, t.TempDir())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/storage", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}

func TestStorageRejectsNonGetMethods(t *testing.T) {
	handler := newStorageTestHandler(t, t.TempDir())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/storage"))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", recorder.Code)
	}
}

func TestStorageTreatsDesktopAndAndroidPointerVersionsAsReferenced(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	// stable Desktop pointer references an older version directory
	stablePath := filepath.Join(root, "public", "stable.json")
	raw, err := os.ReadFile(stablePath)
	if err != nil {
		t.Fatal(err)
	}
	var stable map[string]any
	if err := json.Unmarshal(raw, &stable); err != nil {
		t.Fatal(err)
	}
	stable["desktopExe"] = map[string]any{
		"version": "v1.2", "path": "/releases/v1.2/WheelMakerDesktop.exe", "sha256": strings.Repeat("a", 64),
	}
	raw, err = json.Marshal(stable)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stablePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	writeStorageVersionDir(t, root, "v1.2", 100)
	writeStorageVersionDir(t, root, "v1.3", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodGet, "/api/storage"))
	var body struct {
		ReclaimableBytes int64 `json:"reclaimableBytes"`
		OrphanCount      int   `json:"orphanCount"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ReclaimableBytes != 0 || body.OrphanCount != 0 {
		t.Fatalf("storage = %+v, want nothing reclaimable", body)
	}
}

func TestPruneKeepsOnlyStableAndTrimsHistory(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	writeStorageHistoryFixture(t, root, "v1.1", "v1.3")
	writeStorageVersionDir(t, root, "v1.1", 100) // history alone does not protect a version
	writeStorageVersionDir(t, root, "v1.3", 100) // stable
	writeStorageVersionDir(t, root, "v1.7", 100) // orphan
	writeStorageVersionDir(t, root, "v1.9", 100) // orphan
	// a non-version directory must never be touched
	miscDir := filepath.Join(root, "public", "releases", "notes")
	if err := os.MkdirAll(miscDir, 0o755); err != nil {
		t.Fatal(err)
	}

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		OK           bool `json:"ok"`
		RemovedCount int  `json:"removedCount"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.RemovedCount != 3 {
		t.Fatalf("prune = %+v, want ok with 3 removals", body)
	}
	for _, kept := range []string{"v1.3", "notes"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", kept)); err != nil {
			t.Fatalf("%s must be kept: %v", kept, err)
		}
	}
	for _, removed := range []string{"v1.1", "v1.7", "v1.9"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", removed)); !os.IsNotExist(err) {
			t.Fatalf("%s must be removed", removed)
		}
	}
	// stable is untouched; history is trimmed to the stable entry only
	if _, err := os.Stat(filepath.Join(root, "public", "stable.json")); err != nil {
		t.Fatal(err)
	}
	var history releaseHistory
	readJSONTestFile(t, filepath.Join(root, "public", "releases.json"), &history)
	if history.Schema != 1 || len(history.Releases) != 1 || history.Releases[0].Version != "v1.3" {
		raw, _ := os.ReadFile(filepath.Join(root, "public", "releases.json"))
		t.Fatalf("history after prune = %s, want only v1.3", raw)
	}
}

func TestPruneKeepsStablePointerVersions(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	// stable Desktop pointer references an older version directory
	stablePath := filepath.Join(root, "public", "stable.json")
	raw, err := os.ReadFile(stablePath)
	if err != nil {
		t.Fatal(err)
	}
	var stable map[string]any
	if err := json.Unmarshal(raw, &stable); err != nil {
		t.Fatal(err)
	}
	stable["desktopExe"] = map[string]any{
		"version": "v1.2", "path": "/releases/v1.2/WheelMakerDesktop.exe", "sha256": strings.Repeat("a", 64),
	}
	raw, err = json.Marshal(stable)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stablePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	writeStorageHistoryFixture(t, root, "v1.1", "v1.2", "v1.3")
	writeStorageVersionDir(t, root, "v1.1", 100)
	writeStorageVersionDir(t, root, "v1.2", 100)
	writeStorageVersionDir(t, root, "v1.3", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.1")); !os.IsNotExist(err) {
		t.Fatal("v1.1 must be removed")
	}
	for _, kept := range []string{"v1.2", "v1.3"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", kept)); err != nil {
			t.Fatalf("%s must be kept: %v", kept, err)
		}
	}
	var history releaseHistory
	readJSONTestFile(t, filepath.Join(root, "public", "releases.json"), &history)
	if len(history.Releases) != 2 || history.Releases[0].Version != "v1.2" || history.Releases[1].Version != "v1.3" {
		raw, _ := os.ReadFile(filepath.Join(root, "public", "releases.json"))
		t.Fatalf("history after prune = %s, want v1.2 and v1.3", raw)
	}
}

func TestPruneRefusesWhenStableIsMissing(t *testing.T) {
	root := t.TempDir()
	writeStorageHistoryFixture(t, root, "v1.1")
	writeStorageVersionDir(t, root, "v1.9", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.9")); err != nil {
		t.Fatal("orphan must survive when stable is missing")
	}
}

func TestPruneRefusesWhenStableIsCorrupt(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "public", "stable.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeStorageVersionDir(t, root, "v1.9", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.9")); err != nil {
		t.Fatal("orphan must survive when stable is corrupt")
	}
}

func TestPruneRequiresPublisherToken(t *testing.T) {
	handler := newStorageTestHandler(t, t.TempDir())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/prune", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}

func TestWriteAndLoadConfigRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	want := Config{
		Schema:    1,
		Listen:    "127.0.0.1:9680",
		PublicURL: "https://release.example.com",
		DataRoot:  filepath.Join(t.TempDir(), "release-data"),
	}

	if err := WriteConfig(path, want); err != nil {
		t.Fatalf("WriteConfig() error = %v", err)
	}
	got, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if got != want {
		t.Fatalf("LoadConfig() = %+v, want %+v", got, want)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) == 0 || raw[len(raw)-1] != '\n' {
		t.Fatalf("config must end with one newline: %q", raw)
	}
}

func TestLoadConfigReadsReleaseFromGatewayConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway.json")
	dataRoot := filepath.Join(t.TempDir(), "release-data")
	raw := fmt.Sprintf(`{"schema":2,"acme":{"email":""},"wm_sites":{"tls":{"certificateFile":"","keyFile":""},"registry":{"urlMode":"sync_hub"},"release":{"publicUrl":"https://release.example.com","listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":""},"share":{"urlMode":"sync_hub"}}}`, dataRoot)
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.PublicURL != "https://release.example.com" || cfg.DataRoot != dataRoot {
		t.Fatalf("release config = %+v", cfg)
	}
}

func TestGatewayReleaseUpdatesPreserveOtherSections(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "gateway.json")
	dataRoot := filepath.Join(dir, "release-data")
	newDataRoot := filepath.Join(dir, "new-release-data")
	raw := fmt.Sprintf(`{"schema":2,"acme":{"email":"ops@example.com"},"wm_sites":{"tls":{"certificateFile":"/etc/wm-sites.crt","keyFile":"/etc/wm-sites.key"},"registry":{"urlMode":"sync_hub"},"release":{"publicUrl":"https://old-release.example.com","listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":""},"share":{"urlMode":"sync_hub"}}}`, dataRoot)
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	var before map[string]any
	if err := json.Unmarshal([]byte(raw), &before); err != nil {
		t.Fatal(err)
	}

	digest := strings.Repeat("a", 64)
	if err := ConfigureTokenHash(path, digest); err != nil {
		t.Fatalf("ConfigureTokenHash() error = %v", err)
	}
	if err := ConfigurePublicURLWithDataRoot(path, "https://new-release.example.com/", newDataRoot); err != nil {
		t.Fatalf("ConfigurePublicURLWithDataRoot() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var after map[string]any
	if err := json.Unmarshal(data, &after); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schema", "acme"} {
		if !reflect.DeepEqual(after[key], before[key]) {
			t.Fatalf("Gateway section %q changed: before=%#v after=%#v", key, before[key], after[key])
		}
	}
	beforeSites := before["wm_sites"].(map[string]any)
	afterSites := after["wm_sites"].(map[string]any)
	for _, key := range []string{"tls", "registry", "share"} {
		if !reflect.DeepEqual(afterSites[key], beforeSites[key]) {
			t.Fatalf("Gateway wm_sites section %q changed: before=%#v after=%#v", key, beforeSites[key], afterSites[key])
		}
	}
	release, ok := afterSites["release"].(map[string]any)
	if !ok {
		t.Fatalf("wm_sites.release section = %#v", afterSites["release"])
	}
	if release["publicUrl"] != "https://new-release.example.com" || release["dataRoot"] != newDataRoot || release["tokenSha256"] != digest {
		t.Fatalf("updated release section = %#v", release)
	}
	if _, ok := release["tls"]; ok {
		t.Fatalf("wm_sites.release retained per-site TLS: %#v", release)
	}
}

func TestMigrateLegacyConfigCreatesFullGatewayConfig(t *testing.T) {
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "release-server.json")
	gatewayPath := filepath.Join(dir, "gateway", "config.json")
	dataRoot := filepath.Join(dir, "data")
	legacy := Config{
		Schema:      1,
		Listen:      "127.0.0.1:9680",
		PublicURL:   "https://release.example.com",
		DataRoot:    dataRoot,
		TokenSHA256: strings.Repeat("b", 64),
	}
	if err := WriteConfig(legacyPath, legacy); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(gatewayPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := MigrateLegacyConfig(legacyPath, gatewayPath, dataRoot); err != nil {
		t.Fatalf("MigrateLegacyConfig() error = %v", err)
	}
	if _, err := LoadConfig(gatewayPath); err != nil {
		t.Fatalf("LoadConfig(migrated Gateway config) error = %v", err)
	}
	data, err := os.ReadFile(gatewayPath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schema", "acme", "wm_sites"} {
		if _, ok := document[key]; !ok {
			t.Fatalf("migrated Gateway config missing %q", key)
		}
	}
	var schema int
	if err := json.Unmarshal(document["schema"], &schema); err != nil || schema != 2 {
		t.Fatalf("migrated Gateway schema = %d, err=%v", schema, err)
	}
	var wmSites map[string]json.RawMessage
	if err := json.Unmarshal(document["wm_sites"], &wmSites); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"tls", "registry", "release", "share"} {
		if _, ok := wmSites[key]; !ok {
			t.Fatalf("migrated Gateway wm_sites missing %q", key)
		}
	}
}

func TestGatewaySchemaOneIsRejectedWithoutWriting(t *testing.T) {
	dir := t.TempDir()
	gatewayPath := filepath.Join(dir, "gateway.json")
	legacyPath := filepath.Join(dir, "release-server.json")
	dataRoot := filepath.Join(dir, "data")
	legacy := Config{
		Schema:    1,
		Listen:    "127.0.0.1:9680",
		PublicURL: "https://release.example.com",
		DataRoot:  dataRoot,
	}
	if err := WriteConfig(legacyPath, legacy); err != nil {
		t.Fatal(err)
	}
	original := []byte(fmt.Sprintf(`{"schema":1,"acme":{"email":""},"registry":{"tls":{}},"release":{"publicUrl":"https://old.example.com","listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":""},"share":{"tls":{}}}`, dataRoot))

	operations := map[string]func() error{
		"load": func() error {
			_, err := LoadConfig(gatewayPath)
			return err
		},
		"configure token": func() error {
			return ConfigureTokenHash(gatewayPath, strings.Repeat("a", 64))
		},
		"configure URL": func() error {
			return ConfigurePublicURLWithDataRoot(gatewayPath, "https://new.example.com", dataRoot)
		},
		"migrate standalone config": func() error {
			return MigrateLegacyConfig(legacyPath, gatewayPath, dataRoot)
		},
	}
	for name, operation := range operations {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(gatewayPath, original, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := operation(); err == nil || !strings.Contains(err.Error(), "schema 1") {
				t.Fatalf("operation error = %v, want schema 1 rejection", err)
			}
			got, err := os.ReadFile(gatewayPath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, original) {
				t.Fatalf("schema 1 Gateway config changed\n got: %s\nwant: %s", got, original)
			}
		})
	}
}

func TestConfigureTokenHashWritesOnlyDigest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := Config{
		Schema:    1,
		Listen:    "127.0.0.1:9680",
		PublicURL: "https://release.example.com",
		DataRoot:  filepath.Join(t.TempDir(), "data"),
	}
	if err := WriteConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	if err := ConfigureTokenHash(path, digest); err != nil {
		t.Fatalf("ConfigureTokenHash() error = %v", err)
	}
	got, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.TokenSHA256 != digest {
		t.Fatalf("tokenSha256 = %q, want %q", got.TokenSHA256, digest)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("Bearer")) || bytes.Contains(raw, []byte("release-token")) {
		t.Fatalf("config contains a raw token: %s", raw)
	}
}

func TestConfigurePublicURLUpgradesLegacyConfigWithoutChangingToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	dataRoot := filepath.Join(t.TempDir(), "data")
	digest := strings.Repeat("a", 64)
	legacy := fmt.Sprintf(
		`{"schema":1,"listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":%q}`,
		dataRoot,
		digest,
	)
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ConfigurePublicURL(path, "https://release.example.com:8443/"); err != nil {
		t.Fatalf("ConfigurePublicURL() error = %v", err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://release.example.com:8443" || cfg.DataRoot != dataRoot || cfg.TokenSHA256 != digest {
		t.Fatalf("config = %+v", cfg)
	}
}

func TestConfigRejectsInvalidPublicURL(t *testing.T) {
	for name, value := range map[string]string{
		"missing":     "",
		"credentials": "https://user@example.com",
		"path":        "https://example.com/releases",
		"query":       "https://example.com?x=1",
		"fragment":    "https://example.com#x",
		"scheme":      "ftp://example.com",
	} {
		t.Run(name, func(t *testing.T) {
			cfg := Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: value, DataRoot: t.TempDir()}
			if err := cfg.Validate(); err == nil {
				t.Fatal("Validate() error = nil")
			}
		})
	}
}

func TestConfigRejectsUnknownFieldsAndInvalidBoundaries(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	absoluteRoot := filepath.Join(dir, "data")
	for name, raw := range map[string]string{
		"unknown field": fmt.Sprintf(
			`{"schema":1,"listen":"127.0.0.1:9680","publicUrl":"https://release.example.com","dataRoot":%q,"tokenSha256":"","extra":true}`,
			absoluteRoot,
		),
		"wrong listen": fmt.Sprintf(
			`{"schema":1,"listen":"0.0.0.0:9680","publicUrl":"https://release.example.com","dataRoot":%q,"tokenSha256":""}`,
			absoluteRoot,
		),
		"relative root": `{"schema":1,"listen":"127.0.0.1:9680","publicUrl":"https://release.example.com","dataRoot":"data","tokenSha256":""}`,
		"uppercase hash": fmt.Sprintf(
			`{"schema":1,"listen":"127.0.0.1:9680","publicUrl":"https://release.example.com","dataRoot":%q,"tokenSha256":"%s"}`,
			absoluteRoot,
			strings.Repeat("A", 64),
		),
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := LoadConfig(path); err == nil {
				t.Fatal("LoadConfig() error = nil")
			}
		})
	}
}

func TestConfigModeAllowsOnlyRootWriteAndServiceGroupRead(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not report POSIX group mode bits")
	}
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com", DataRoot: t.TempDir()}
	if err := WriteConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("mode = %#o, want 0640", info.Mode().Perm())
	}
}

func TestHealthIsPublicAndReportsPublisherConfiguration(t *testing.T) {
	handler, err := New(Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com", DataRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		OK                  bool `json:"ok"`
		PublisherConfigured bool `json:"publisherConfigured"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.PublisherConfigured {
		t.Fatalf("health = %+v", body)
	}
}

func TestPublishAuthenticationRunsBeforeRouting(t *testing.T) {
	for name, tc := range map[string]struct {
		tokenHash string
		header    string
		want      int
	}{
		"not configured": {want: http.StatusServiceUnavailable},
		"missing bearer": {tokenHash: sha256String("release-token"), want: http.StatusUnauthorized},
		"wrong bearer":   {tokenHash: sha256String("release-token"), header: "Bearer wrong", want: http.StatusUnauthorized},
		"valid bearer":   {tokenHash: sha256String("release-token"), header: "Bearer release-token", want: http.StatusBadRequest},
	} {
		t.Run(name, func(t *testing.T) {
			handler, err := New(Config{
				Schema:      1,
				Listen:      "127.0.0.1:9680",
				PublicURL:   "https://release.example.com",
				DataRoot:    t.TempDir(),
				TokenSHA256: tc.tokenHash,
			})
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/publish/start", nil)
			if tc.header != "" {
				request.Header.Set("Authorization", tc.header)
			}
			handler.ServeHTTP(recorder, request)
			if recorder.Code != tc.want {
				t.Fatalf("status = %d, want %d, body = %s", recorder.Code, tc.want, recorder.Body.String())
			}
			if recorder.Header().Get("Content-Type") != "application/json" {
				t.Fatalf("Content-Type = %q", recorder.Header().Get("Content-Type"))
			}
			if recorder.Body.String() == tc.header {
				t.Fatal("response echoed authorization header")
			}
		})
	}
}

func TestPublicFilesSupportHomepageHeadRangeCORSAndCaching(t *testing.T) {
	dataRoot := t.TempDir()
	publicRoot := filepath.Join(dataRoot, "public")
	if err := os.MkdirAll(filepath.Join(publicRoot, "releases", "v1.2"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"index.html":                  "release-home",
		"deploy.mjs":                  "deploy-script",
		"stable.json":                 `{"schema":2}`,
		"releases/v1.2/asset.tar.zst": "abcdef",
	}
	for name, body := range files {
		path := filepath.Join(publicRoot, filepath.FromSlash(name))
		if err := os.WriteFile(path, []byte(body), 0o640); err != nil {
			t.Fatal(err)
		}
	}
	handler, err := New(Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com", DataRoot: dataRoot})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name       string
		method     string
		path       string
		rangeValue string
		wantBody   string
		wantStatus int
		cachePart  string
	}{
		{name: "homepage", method: http.MethodGet, path: "/", wantStatus: http.StatusOK, wantBody: "release-home", cachePart: "no-store"},
		{name: "head", method: http.MethodHead, path: "/deploy.mjs", wantStatus: http.StatusOK, cachePart: "no-store"},
		{name: "range", method: http.MethodGet, path: "/releases/v1.2/asset.tar.zst", rangeValue: "bytes=1-2", wantStatus: http.StatusPartialContent, wantBody: "bc", cachePart: "immutable"},
		{name: "stable", method: http.MethodGet, path: "/stable.json", wantStatus: http.StatusOK, wantBody: `{"schema":2}`, cachePart: "no-store"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.rangeValue != "" {
				request.Header.Set("Range", tc.rangeValue)
			}
			handler.ServeHTTP(recorder, request)
			if recorder.Code != tc.wantStatus || recorder.Body.String() != tc.wantBody {
				t.Fatalf("status/body = %d %q", recorder.Code, recorder.Body.String())
			}
			if recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
				t.Fatalf("CORS = %q", recorder.Header().Get("Access-Control-Allow-Origin"))
			}
			if !strings.Contains(recorder.Header().Get("Cache-Control"), tc.cachePart) {
				t.Fatalf("Cache-Control = %q", recorder.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestPublicFilesRejectMethodsDirectoriesTraversalAndAPIFallback(t *testing.T) {
	dataRoot := t.TempDir()
	publicRoot := filepath.Join(dataRoot, "public")
	if err := os.MkdirAll(filepath.Join(publicRoot, "directory"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(publicRoot, "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicRoot, "api", "hidden"), []byte("must-not-serve"), 0o640); err != nil {
		t.Fatal(err)
	}
	token := "release-token"
	handler, err := New(Config{
		Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com",
		DataRoot: dataRoot, TokenSHA256: sha256String(token),
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
		auth   bool
		want   int
	}{
		{method: http.MethodPost, path: "/stable.json", want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/directory/", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/..%2fconfig.json", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/hidden", auth: true, want: http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(tc.method, tc.path, bytes.NewReader(nil))
		if tc.auth {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		handler.ServeHTTP(recorder, request)
		if recorder.Code != tc.want || recorder.Body.String() == "must-not-serve" {
			t.Fatalf("%s %s: status/body = %d %q", tc.method, tc.path, recorder.Code, recorder.Body.String())
		}
	}
}

func sha256String(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

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
	archivePath := filepath.Join(root, "public", "debug-web", "archives", sha256BytesHex(archive)+".zip")
	info, err := os.Stat(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o640 {
		t.Fatalf("public archive permissions = %04o, want 0640", info.Mode().Perm())
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

func TestDebugWebCommitKeepsOnlyLatestArchive(t *testing.T) {
	server, root := newAuthenticatedSessionTestServer(t)
	first := []byte("first archive")
	firstSession := startDebugWebTestSession(t, server, first)
	uploadAndCommitDebugWeb(t, server, firstSession.SessionID, first)
	second := []byte("second archive")
	secondSession := startDebugWebTestSession(t, server, second)
	uploadAndCommitDebugWeb(t, server, secondSession.SessionID, second)
	if _, err := os.Stat(filepath.Join(root, "public", "debug-web", "archives", sha256BytesHex(first)+".zip")); !os.IsNotExist(err) {
		t.Fatalf("old archive remains: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "public", "debug-web", "archives", sha256BytesHex(second)+".zip")); err != nil {
		t.Fatal(err)
	}
}

func uploadAndCommitDebugWeb(t *testing.T, server *Server, sessionID string, archive []byte) {
	t.Helper()
	upload := httptest.NewRequest(http.MethodPut, "/api/debug-web/"+sessionID+"/archive", bytes.NewReader(archive))
	upload.ContentLength = int64(len(archive))
	upload.Header.Set("Authorization", "Bearer "+testPublisherToken)
	upload.Header.Set("X-WheelMaker-SHA256", sha256BytesHex(archive))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, upload)
	if response.Code != http.StatusNoContent {
		t.Fatalf("upload=%d", response.Code)
	}
	commit := httptest.NewRequest(http.MethodPost, "/api/debug-web/"+sessionID+"/commit", nil)
	commit.Header.Set("Authorization", "Bearer "+testPublisherToken)
	response = httptest.NewRecorder()
	server.ServeHTTP(response, commit)
	if response.Code != http.StatusOK {
		t.Fatalf("commit=%d", response.Code)
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

func TestVerifyPublicReleaseChecksControlsAndArtifactRange(t *testing.T) {
	deploy := []byte("#!/usr/bin/env node\n")
	core := []byte("export const core = true;\n")
	manifest := []byte(`{"schema":2}`)
	artifact := []byte("archive")
	stable := stableDocument{
		Schema: 2, Version: "v1.2", PublishedAt: "2026-08-06T00:00:00Z", SourceSHA: strings.Repeat("a", 40),
		Deploy:  deployPointer{MJSPath: "/releases/v1.2/deploy.mjs", MJSSHA256: sha256BytesHex(deploy), CorePath: "/releases/v1.2/deploy-core.mjs", CoreSHA256: sha256BytesHex(core)},
		Release: manifestPointer{ManifestPath: "/releases/v1.2/release-manifest.json", ManifestSHA256: sha256BytesHex(manifest)},
	}
	session := publishSession{
		Version: "v1.2", SourceSHA: stable.SourceSHA,
		Files: map[string]fileInfo{
			"deploy.mjs":                          {Size: int64(len(deploy)), SHA256: sha256BytesHex(deploy)},
			"deploy-core.mjs":                     {Size: int64(len(core)), SHA256: sha256BytesHex(core)},
			"release-manifest.json":               {Size: int64(len(manifest)), SHA256: sha256BytesHex(manifest)},
			"wheelmaker-v1.2-linux-amd64.tar.zst": {Size: int64(len(artifact)), SHA256: sha256BytesHex(artifact)},
		},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/stable.json":
			_ = json.NewEncoder(w).Encode(stable)
		case "/deploy.mjs":
			_, _ = w.Write(deploy)
		case "/deploy-core.mjs":
			_, _ = w.Write(core)
		case stable.Release.ManifestPath:
			_, _ = w.Write(manifest)
		case "/releases/v1.2/wheelmaker-v1.2-linux-amd64.tar.zst":
			if r.Header.Get("Range") != "bytes=0-0" {
				t.Errorf("Range = %q", r.Header.Get("Range"))
			}
			w.Header().Set("Content-Range", "bytes 0-0/7")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(artifact[:1])
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	if err := verifyPublicRelease(server.URL, stable, session, &http.Client{Timeout: time.Second}); err != nil {
		t.Fatalf("verifyPublicRelease() error = %v", err)
	}
}

func TestVerifyPublicReleaseRejectsWrongDigestAndIgnoredRange(t *testing.T) {
	stable := stableDocument{
		Schema: 2, Version: "v1.2", PublishedAt: "2026-08-06T00:00:00Z", SourceSHA: strings.Repeat("a", 40),
		Deploy:  deployPointer{MJSPath: "/releases/v1.2/deploy.mjs", MJSSHA256: strings.Repeat("b", 64), CorePath: "/releases/v1.2/deploy-core.mjs", CoreSHA256: strings.Repeat("c", 64)},
		Release: manifestPointer{ManifestPath: "/releases/v1.2/release-manifest.json", ManifestSHA256: strings.Repeat("d", 64)},
	}
	session := publishSession{Version: stable.Version, SourceSHA: stable.SourceSHA, Files: map[string]fileInfo{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/stable.json" {
			_ = json.NewEncoder(w).Encode(stable)
			return
		}
		_, _ = w.Write([]byte("wrong"))
	}))
	defer server.Close()
	if err := verifyPublicRelease(server.URL, stable, session, server.Client()); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("wrong digest error = %v", err)
	}
}
