package releaseserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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
