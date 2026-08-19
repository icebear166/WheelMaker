package tools

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWellKnownProviderDiscoversCandidatesInUpstreamOrderAndMaterializesLegacyCatalog(t *testing.T) {
	var mu sync.Mutex
	var indexRequests []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if filepath.Base(request.URL.Path) == "index.json" {
			mu.Lock()
			indexRequests = append(indexRequests, request.URL.Path)
			mu.Unlock()
		}
		switch request.URL.Path {
		case "/.well-known/skills/index.json":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md","references/guide.md"]},{"name":"beta","description":"Beta","files":["SKILL.md"]}]}`))
		case "/.well-known/skills/alpha/SKILL.md":
			_, _ = response.Write([]byte("---\nname: frontmatter-alpha\ndescription: Alpha skill\n---\n# Alpha\n"))
		case "/.well-known/skills/alpha/references/guide.md":
			_, _ = response.Write([]byte("guide\n"))
		case "/.well-known/skills/beta/SKILL.md":
			_, _ = response.Write([]byte("---\nname: beta\ndescription: Beta skill\n---\n# Beta\n"))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "snapshot")
	provider := newWellKnownSkillSourceProvider(server.Client())
	checkout, err := provider.materialize(context.Background(), server.URL+"/docs/lark/SKILL.md", destination)
	if err != nil {
		t.Fatalf("materialize() error=%v", err)
	}
	wantRequests := []string{
		"/docs/lark/SKILL.md/.well-known/agent-skills/index.json",
		"/.well-known/agent-skills/index.json",
		"/docs/lark/SKILL.md/.well-known/skills/index.json",
		"/.well-known/skills/index.json",
	}
	if !reflect.DeepEqual(indexRequests, wantRequests) {
		t.Fatalf("index requests=%#v, want %#v", indexRequests, wantRequests)
	}
	wantSource := server.URL + "/.well-known/skills/index.json"
	if checkout.Source != wantSource || checkout.SourceKey != wantSource {
		t.Fatalf("identity=(%q, %q), want canonical %q", checkout.Source, checkout.SourceKey, wantSource)
	}
	if checkout.Path != destination || checkout.Branch != "" || len(checkout.Commit) != 64 || checkout.RemoteCommit != checkout.Commit {
		t.Fatalf("checkout metadata=%#v", checkout)
	}
	if len(checkout.Skills) != 2 || checkout.Skills[0].Name != "alpha" || checkout.Skills[1].Name != "beta" {
		t.Fatalf("skills=%#v, want index installation names alpha and beta", checkout.Skills)
	}
	assertFileContents(t, filepath.Join(destination, "skills", "alpha", "references", "guide.md"), "guide\n")
	assertFileContents(t, filepath.Join(destination, "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: Beta skill\n---\n# Beta\n")
}

func TestWellKnownProviderRejectsPartialLegacyCandidateAndUsesNextCompleteCandidate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/docs/.well-known/agent-skills/index.json":
			_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md","missing.md"]}]}`))
		case "/docs/.well-known/agent-skills/alpha/SKILL.md":
			_, _ = response.Write([]byte("---\nname: alpha\ndescription: Alpha skill\n---\n"))
		case "/.well-known/agent-skills/index.json":
			_, _ = response.Write([]byte(`{"skills":[{"name":"beta","description":"Beta","files":["SKILL.md"]}]}`))
		case "/.well-known/agent-skills/beta/SKILL.md":
			_, _ = response.Write([]byte("---\nname: beta\ndescription: Beta skill\n---\n"))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "snapshot")
	checkout, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/docs", destination)
	if err != nil {
		t.Fatalf("materialize() error=%v", err)
	}
	if checkout.Source != server.URL+"/.well-known/agent-skills/index.json" || len(checkout.Skills) != 1 || checkout.Skills[0].Name != "beta" {
		t.Fatalf("checkout=%#v, want complete root candidate", checkout)
	}
	if _, err := os.Stat(filepath.Join(destination, "skills", "alpha")); !os.IsNotExist(err) {
		t.Fatalf("partial candidate path error=%v, want absent", err)
	}
}

func TestWellKnownProviderCanonicalIndexDoesNotSwitchIdentity(t *testing.T) {
	var agentIndexRequests int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/skills/index.json":
			http.Error(response, "broken", http.StatusBadGateway)
		case "/.well-known/agent-skills/index.json":
			agentIndexRequests++
			_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md"]}]}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "snapshot")
	_, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/.well-known/skills/index.json", destination)
	if err == nil {
		t.Fatal("materialize() succeeded, want canonical index failure")
	}
	if agentIndexRequests != 0 {
		t.Fatalf("agent index requests=%d, want no identity switch", agentIndexRequests)
	}
	if _, statErr := os.Stat(destination); !os.IsNotExist(statErr) {
		t.Fatalf("destination error=%v, want no partial snapshot", statErr)
	}
}

func TestWellKnownProviderMaterializesDiscoveryV2SkillMarkdownZipAndTarGz(t *testing.T) {
	skillMarkdown := []byte("---\nname: markdown-name\ndescription: Markdown skill\n---\n# Markdown\n")
	zipArtifact := makeWellKnownZip(t, map[string]string{
		"SKILL.md":          "---\nname: zip-name\ndescription: Zip skill\n---\n# Zip\n",
		"references/zip.md": "zip reference\n",
	})
	tarArtifact := makeWellKnownTarGz(t, map[string]string{
		"SKILL.md":          "---\nname: tar-name\ndescription: Tar skill\n---\n# Tar\n",
		"references/tar.md": "tar reference\n",
	})
	artifacts := map[string][]byte{
		"/.well-known/agent-skills/markdown.md": skillMarkdown,
		"/.well-known/agent-skills/archive.zip": zipArtifact,
		"/.well-known/agent-skills/archive.tgz": tarArtifact,
	}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/.well-known/agent-skills/index.json" {
			_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[`+
				`{"name":"markdown-install","description":"Markdown","type":"skill-md","url":"markdown.md","digest":%q},`+
				`{"name":"zip-install","description":"Zip","type":"archive","url":"archive.zip","digest":%q},`+
				`{"name":"tar-install","description":"Tar","type":"archive","url":"archive.tgz","digest":%q},`+
				`{"name":"ignored","description":"Invalid digest","type":"skill-md","url":"ignored.md","digest":"sha256:nope"}]}`,
				wellKnownDiscoverySchemaV2, wellKnownDigest(skillMarkdown), wellKnownDigest(zipArtifact), wellKnownDigest(tarArtifact))
			return
		}
		if artifact, exists := artifacts[request.URL.Path]; exists {
			_, _ = response.Write(artifact)
			return
		}
		http.NotFound(response, request)
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "snapshot")
	checkout, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/.well-known/agent-skills/index.json", destination)
	if err != nil {
		t.Fatalf("materialize() error=%v", err)
	}
	wantNames := []string{"markdown-install", "tar-install", "zip-install"}
	var names []string
	for _, skill := range checkout.Skills {
		names = append(names, skill.Name)
	}
	if !reflect.DeepEqual(names, wantNames) {
		t.Fatalf("skill names=%#v, want %#v", names, wantNames)
	}
	assertFileContents(t, filepath.Join(destination, "skills", "markdown-install", "SKILL.md"), string(skillMarkdown))
	assertFileContents(t, filepath.Join(destination, "skills", "zip-install", "references", "zip.md"), "zip reference\n")
	assertFileContents(t, filepath.Join(destination, "skills", "tar-install", "references", "tar.md"), "tar reference\n")
}

func TestWellKnownProviderRejectsAcceptedArtifactWithDigestMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/agent-skills/index.json":
			_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[{"name":"alpha","description":"Alpha","type":"skill-md","url":"alpha.md","digest":"sha256:%s"}]}`,
				wellKnownDiscoverySchemaV2, strings.Repeat("0", 64))
		case "/.well-known/agent-skills/alpha.md":
			_, _ = response.Write([]byte("---\nname: alpha\ndescription: Alpha\n---\n"))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "snapshot")
	_, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/.well-known/agent-skills/index.json", destination)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "digest") {
		t.Fatalf("materialize() error=%v, want digest mismatch", err)
	}
	if _, statErr := os.Stat(destination); !os.IsNotExist(statErr) {
		t.Fatalf("destination error=%v, want absent", statErr)
	}
}

func TestWellKnownProviderRejectsUnsafeArchivePath(t *testing.T) {
	artifact := makeWellKnownZip(t, map[string]string{
		"SKILL.md": "---\nname: alpha\ndescription: Alpha\n---\n",
		"../evil":  "escape",
	})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/agent-skills/index.json":
			_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[{"name":"alpha","description":"Alpha","type":"archive","url":"alpha.zip","digest":%q}]}`,
				wellKnownDiscoverySchemaV2, wellKnownDigest(artifact))
		case "/.well-known/agent-skills/alpha.zip":
			_, _ = response.Write(artifact)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	_, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/.well-known/agent-skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "unsafe") {
		t.Fatalf("materialize() error=%v, want unsafe archive failure", err)
	}
}

func TestWellKnownProviderLimitsConcurrentDownloadsToEight(t *testing.T) {
	var active int32
	var maximum int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/.well-known/skills/index.json" {
			var entries []string
			for index := 0; index < 12; index++ {
				name := fmt.Sprintf("skill-%02d", index)
				entries = append(entries, fmt.Sprintf(`{"name":%q,"description":"Skill","files":["SKILL.md"]}`, name))
			}
			_, _ = fmt.Fprintf(response, `{"skills":[%s]}`, strings.Join(entries, ","))
			return
		}
		current := atomic.AddInt32(&active, 1)
		for {
			previous := atomic.LoadInt32(&maximum)
			if current <= previous || atomic.CompareAndSwapInt32(&maximum, previous, current) {
				break
			}
		}
		time.Sleep(40 * time.Millisecond)
		atomic.AddInt32(&active, -1)
		_, _ = response.Write([]byte("---\nname: skill\ndescription: Skill\n---\n"))
	}))
	defer server.Close()

	_, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
	if err != nil {
		t.Fatalf("materialize() error=%v", err)
	}
	if maximum != 8 {
		t.Fatalf("maximum concurrent downloads=%d, want 8", maximum)
	}
}

func TestWellKnownProviderStopsAfterFiveRedirects(t *testing.T) {
	var requests int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		atomic.AddInt32(&requests, 1)
		http.Redirect(response, request, server.URL+request.URL.Path, http.StatusFound)
	}))
	defer server.Close()

	_, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "redirect") {
		t.Fatalf("materialize() error=%v, want redirect failure", err)
	}
	if requests != 6 {
		t.Fatalf("requests=%d, want initial request plus five redirects", requests)
	}
}

func TestWellKnownProviderRejectsHTTPSDowngradeBeforeContactingTarget(t *testing.T) {
	var targetRequests int32
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		atomic.AddInt32(&targetRequests, 1)
		_, _ = response.Write([]byte(`{"skills":[]}`))
	}))
	defer target.Close()
	tlsSource := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, target.URL+request.URL.Path, http.StatusFound)
	}))
	defer tlsSource.Close()

	_, err := newWellKnownSkillSourceProvider(tlsSource.Client()).materialize(context.Background(), tlsSource.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "downgrade") {
		t.Fatalf("materialize() error=%v, want HTTPS downgrade failure", err)
	}
	if targetRequests != 0 {
		t.Fatalf("downgrade target requests=%d, want zero", targetRequests)
	}
}

func TestWellKnownProviderAppliesInjectableOperationAndResponseLimits(t *testing.T) {
	t.Run("index bytes", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md"]}]}`))
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.indexMaxBytes = 32
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "size limit") {
			t.Fatalf("materialize() error=%v, want index size failure", err)
		}
	})

	t.Run("response header timeout", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			time.Sleep(100 * time.Millisecond)
			_, _ = response.Write([]byte(`{"skills":[]}`))
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.operationTimeout = time.Second
		provider.limits.responseHeaderTimeout = 20 * time.Millisecond
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "timeout") {
			t.Fatalf("materialize() error=%v, want response header timeout", err)
		}
	})

	t.Run("archive files", func(t *testing.T) {
		artifact := makeWellKnownZip(t, map[string]string{
			"SKILL.md": "---\nname: alpha\ndescription: Alpha\n---\n",
			"extra.md": "extra",
		})
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/.well-known/agent-skills/index.json":
				_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[{"name":"alpha","description":"Alpha","type":"archive","url":"alpha.zip","digest":%q}]}`,
					wellKnownDiscoverySchemaV2, wellKnownDigest(artifact))
			default:
				_, _ = response.Write(artifact)
			}
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.archiveMaxFiles = 1
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/agent-skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "too many files") {
			t.Fatalf("materialize() error=%v, want archive file limit", err)
		}
	})

	t.Run("operation deadline", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			response.WriteHeader(http.StatusOK)
			if flusher, ok := response.(http.Flusher); ok {
				flusher.Flush()
			}
			<-request.Context().Done()
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.operationTimeout = 20 * time.Millisecond
		provider.limits.responseHeaderTimeout = time.Second
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "deadline") {
			t.Fatalf("materialize() error=%v, want operation deadline", err)
		}
	})

	t.Run("entry count", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md"]},{"name":"beta","description":"Beta","files":["SKILL.md"]}]}`))
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.entryMaxCount = 1
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "too many skills") {
			t.Fatalf("materialize() error=%v, want entry limit", err)
		}
	})

	t.Run("catalog files", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/.well-known/skills/index.json":
				_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md","extra.md"]}]}`))
			case "/.well-known/skills/alpha/SKILL.md":
				_, _ = response.Write([]byte("---\nname: alpha\ndescription: Alpha\n---\n"))
			default:
				_, _ = response.Write([]byte("extra"))
			}
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.catalogMaxFiles = 1
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "catalog contains too many files") {
			t.Fatalf("materialize() error=%v, want catalog file limit", err)
		}
	})

	t.Run("single file bytes", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if request.URL.Path == "/.well-known/skills/index.json" {
				_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md"]}]}`))
				return
			}
			_, _ = response.Write([]byte("---\nname: alpha\ndescription: Alpha\n---\n"))
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.fileMaxBytes = 16
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "size limit") {
			t.Fatalf("materialize() error=%v, want file size limit", err)
		}
	})

	t.Run("compressed artifact bytes", func(t *testing.T) {
		artifact := makeWellKnownZip(t, map[string]string{"SKILL.md": "---\nname: alpha\ndescription: Alpha\n---\n"})
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if request.URL.Path == "/.well-known/agent-skills/index.json" {
				_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[{"name":"alpha","description":"Alpha","type":"archive","url":"alpha.zip","digest":%q}]}`,
					wellKnownDiscoverySchemaV2, wellKnownDigest(artifact))
				return
			}
			_, _ = response.Write(artifact)
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.artifactMaxBytes = 16
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/agent-skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "size limit") {
			t.Fatalf("materialize() error=%v, want artifact size limit", err)
		}
	})

	t.Run("archive unpacked bytes", func(t *testing.T) {
		artifact := makeWellKnownZip(t, map[string]string{"SKILL.md": "---\nname: alpha\ndescription: Alpha\n---\n"})
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if request.URL.Path == "/.well-known/agent-skills/index.json" {
				_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[{"name":"alpha","description":"Alpha","type":"archive","url":"alpha.zip","digest":%q}]}`,
					wellKnownDiscoverySchemaV2, wellKnownDigest(artifact))
				return
			}
			_, _ = response.Write(artifact)
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.archiveMaxBytes = 16
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/agent-skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "maximum unpacked size") {
			t.Fatalf("materialize() error=%v, want unpacked size limit", err)
		}
	})

	t.Run("catalog bytes", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if request.URL.Path == "/.well-known/skills/index.json" {
				_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md"]}]}`))
				return
			}
			_, _ = response.Write([]byte("---\nname: alpha\ndescription: Alpha\n---\n"))
		}))
		defer server.Close()
		provider := newWellKnownSkillSourceProvider(server.Client())
		provider.limits.catalogMaxBytes = 16
		_, err := provider.materialize(context.Background(), server.URL+"/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "catalog exceeds maximum size") {
			t.Fatalf("materialize() error=%v, want catalog size limit", err)
		}
	})

	t.Run("canceled context", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		provider := newWellKnownSkillSourceProvider(http.DefaultClient)
		_, err := provider.materialize(ctx, "https://example.invalid/.well-known/skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "context canceled") {
			t.Fatalf("materialize() error=%v, want context cancellation", err)
		}
	})
}

func TestWellKnownProviderRedactsArtifactQueryFromRequestErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[{"name":"alpha","description":"Alpha","type":"skill-md","url":"http://127.0.0.1:1/alpha.md?token=super-secret","digest":"sha256:%s"}]}`,
			wellKnownDiscoverySchemaV2, strings.Repeat("0", 64))
	}))
	defer server.Close()

	_, err := newWellKnownSkillSourceProvider(server.Client()).materialize(context.Background(), server.URL+"/.well-known/agent-skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
	if err == nil {
		t.Fatal("materialize() succeeded, want artifact request failure")
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "super-secret") || strings.Contains(lower, "token=") || strings.Contains(lower, "127.0.0.1:1") {
		t.Fatalf("materialize() leaked artifact URL: %v", err)
	}
	if !strings.Contains(lower, "request failed") {
		t.Fatalf("materialize() error=%v, want request failure context", err)
	}
}

func TestWellKnownProviderAllowsCrossHostArtifactRedirectWithoutCredentials(t *testing.T) {
	skillMarkdown := []byte("---\nname: alpha\ndescription: Alpha\n---\n")
	var receivedAuthorization string
	var receivedCookie string
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		receivedAuthorization = request.Header.Get("Authorization")
		receivedCookie = request.Header.Get("Cookie")
		_, _ = response.Write(skillMarkdown)
	}))
	defer target.Close()

	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/agent-skills/index.json":
			_, _ = fmt.Fprintf(response, `{"$schema":%q,"skills":[{"name":"alpha","description":"Alpha","type":"skill-md","url":"artifact.md","digest":%q}]}`,
				wellKnownDiscoverySchemaV2, wellKnownDigest(skillMarkdown))
		case "/.well-known/agent-skills/artifact.md":
			http.Redirect(response, request, target.URL+"/alpha.md", http.StatusFound)
		default:
			http.NotFound(response, request)
		}
	}))
	defer source.Close()

	baseTransport := source.Client().Transport
	client := *source.Client()
	client.Transport = credentialInjectingRoundTripper{base: baseTransport, host: strings.TrimPrefix(source.URL, "http://")}
	_, err := newWellKnownSkillSourceProvider(&client).materialize(context.Background(), source.URL+"/.well-known/agent-skills/index.json", filepath.Join(t.TempDir(), "snapshot"))
	if err != nil {
		t.Fatalf("materialize() error=%v", err)
	}
	if receivedAuthorization != "" || receivedCookie != "" {
		t.Fatalf("redirect credentials=(%q, %q), want empty", receivedAuthorization, receivedCookie)
	}
}

func TestWellKnownSkillMarkdownRequiresExactFrontmatterDelimiter(t *testing.T) {
	malformed := []byte("---\nname: alpha\ndescription: Alpha\n---not-a-delimiter\n# Alpha\n")
	if err := validateWellKnownSkillMarkdown(malformed); err == nil {
		t.Fatal("validateWellKnownSkillMarkdown() accepted a prefix-only closing delimiter")
	}
	valid := []byte("---\nname: 'alpha'\ndescription: \"Alpha\"\n---\n# Alpha\n")
	if err := validateWellKnownSkillMarkdown(valid); err != nil {
		t.Fatalf("validateWellKnownSkillMarkdown() valid error=%v", err)
	}
}

func TestWellKnownArchiveRejectsEncryptionLinksAndMissingRootSkill(t *testing.T) {
	validSkill := "---\nname: alpha\ndescription: Alpha\n---\n"
	tests := []struct {
		name      string
		artifact  []byte
		extension string
		wantError string
	}{
		{
			name:      "encrypted zip",
			artifact:  markWellKnownZipEncrypted(t, makeWellKnownZip(t, map[string]string{"SKILL.md": validSkill})),
			extension: ".zip",
			wantError: "encrypted",
		},
		{
			name:      "zip symlink",
			artifact:  makeWellKnownZipWithSymlink(t, validSkill),
			extension: ".zip",
			wantError: "links",
		},
		{
			name:      "tar symlink",
			artifact:  makeWellKnownTarGzWithSymlink(t, validSkill),
			extension: ".tgz",
			wantError: "links",
		},
		{
			name:      "missing root",
			artifact:  makeWellKnownZip(t, map[string]string{"nested/SKILL.md": validSkill}),
			extension: ".zip",
			wantError: "missing root skill.md",
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			artifactPath := filepath.Join(t.TempDir(), "artifact"+testCase.extension)
			if err := os.WriteFile(artifactPath, testCase.artifact, 0o600); err != nil {
				t.Fatal(err)
			}
			limits := defaultWellKnownLimits()
			budget := &wellKnownCatalogBudget{maxBytes: limits.catalogMaxBytes, maxFiles: limits.catalogMaxFiles}
			err := extractWellKnownArchive(artifactPath, "https://example.com/artifact"+testCase.extension, "", filepath.Join(t.TempDir(), "skill"), limits, budget)
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), testCase.wantError) {
				t.Fatalf("extractWellKnownArchive() error=%v, want %q", err, testCase.wantError)
			}
		})
	}
}

type credentialInjectingRoundTripper struct {
	base http.RoundTripper
	host string
}

func (transport credentialInjectingRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Host == transport.host {
		request.Header.Set("Authorization", "Bearer secret")
		request.Header.Set("Cookie", "session=secret")
	}
	return transport.base.RoundTrip(request)
}

func assertFileContents(t *testing.T, path, want string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(raw) != want {
		t.Fatalf("%s contents=%q, want %q", path, raw, want)
	}
}

func makeWellKnownZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, contents := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(contents)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func makeWellKnownTarGz(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, contents := range files {
		raw := []byte(contents)
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(raw)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write(raw); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func makeWellKnownZipWithSymlink(t *testing.T, skillMarkdown string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	skill, err := writer.Create("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := skill.Write([]byte(skillMarkdown)); err != nil {
		t.Fatal(err)
	}
	header := &zip.FileHeader{Name: "link", Method: zip.Store}
	header.SetMode(os.ModeSymlink | 0o777)
	link, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := link.Write([]byte("SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func makeWellKnownTarGzWithSymlink(t *testing.T, skillMarkdown string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	raw := []byte(skillMarkdown)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "SKILL.md", Mode: 0o600, Size: int64(len(raw)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.WriteHeader(&tar.Header{Name: "link", Linkname: "SKILL.md", Typeflag: tar.TypeSymlink}); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func markWellKnownZipEncrypted(t *testing.T, artifact []byte) []byte {
	t.Helper()
	result := append([]byte(nil), artifact...)
	for offset := 0; offset+10 <= len(result); offset++ {
		signature := binary.LittleEndian.Uint32(result[offset : offset+4])
		switch signature {
		case 0x04034b50:
			flags := binary.LittleEndian.Uint16(result[offset+6 : offset+8])
			binary.LittleEndian.PutUint16(result[offset+6:offset+8], flags|0x1)
		case 0x02014b50:
			flags := binary.LittleEndian.Uint16(result[offset+8 : offset+10])
			binary.LittleEndian.PutUint16(result[offset+8:offset+10], flags|0x1)
		}
	}
	return result
}
