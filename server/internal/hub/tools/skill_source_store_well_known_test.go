package tools

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestSkillSourceStorePublishesAndReadsWellKnownSnapshotOffline(t *testing.T) {
	server := newMutableLegacyWellKnownServer(t, "first\n", false)
	store := newSkillSourceStore(t.TempDir())
	checkout, err := store.ensureLatestRepo(context.Background(), skillSourceSnapshot{Source: server.URL + "/entry"})
	if err != nil {
		t.Fatalf("ensureLatestRepo() error=%v", err)
	}
	canonical := server.URL + "/.well-known/skills/index.json"
	wantPath := store.repositoryPath(canonical)
	if checkout.Source != canonical || checkout.SourceKey != canonical || checkout.Path != wantPath || len(checkout.Commit) != 64 {
		t.Fatalf("checkout=%#v, want stable canonical snapshot", checkout)
	}
	if _, err := os.Stat(filepath.Join(wantPath, ".git")); !os.IsNotExist(err) {
		t.Fatalf(".git error=%v, want no Git clone", err)
	}
	if _, err := os.Stat(filepath.Join(wantPath, ".wheelmaker-source.json")); err != nil {
		t.Fatalf("metadata error=%v", err)
	}
	assertFileContents(t, filepath.Join(wantPath, "skills", "alpha", "references", "guide.md"), "first\n")

	server.Close()
	offline, err := store.readRepo(context.Background(), skillSourceSnapshot{Source: canonical, SourceKey: canonical})
	if err != nil {
		t.Fatalf("readRepo() offline error=%v", err)
	}
	if offline.Commit != checkout.Commit || offline.Path != wantPath || len(offline.Skills) != 1 || offline.Skills[0].Name != "alpha" {
		t.Fatalf("offline checkout=%#v, want persisted snapshot", offline)
	}
}

func TestSkillSourceStoreUsesDistinctHashedPathsForExactWellKnownKeys(t *testing.T) {
	store := newSkillSourceStore(t.TempDir())
	keys := []string{
		"https://example.com/Docs/.well-known/skills/index.json",
		"https://example.com/docs/.well-known/skills/index.json",
		"https://example.com/docs//.well-known/skills/index.json",
	}
	paths := map[string]struct{}{}
	lockPaths := map[string]struct{}{}
	for _, key := range keys {
		path := store.repositoryPath(key)
		if !strings.HasPrefix(filepath.Base(path), "well-known-") {
			t.Fatalf("repositoryPath(%q)=%q, want hashed well-known path", key, path)
		}
		if _, exists := paths[path]; exists {
			t.Fatalf("repositoryPath(%q)=%q collides with another exact key", key, path)
		}
		paths[path] = struct{}{}

		lockPath := store.lockPath(key)
		if _, exists := lockPaths[lockPath]; exists {
			t.Fatalf("lockPath(%q)=%q collides with another exact key", key, lockPath)
		}
		lockPaths[lockPath] = struct{}{}
	}
}

func TestSkillSourceStoreWellKnownFailurePreservesPublishedSnapshot(t *testing.T) {
	server := newMutableLegacyWellKnownServer(t, "first\n", false)
	defer server.Close()
	store := newSkillSourceStore(t.TempDir())
	first, err := store.ensureLatestRepo(context.Background(), skillSourceSnapshot{Source: server.URL + "/entry"})
	if err != nil {
		t.Fatalf("initial ensureLatestRepo() error=%v", err)
	}
	server.Set("second\n", true)
	_, err = store.ensureLatestRepo(context.Background(), skillSourceSnapshot{Source: first.Source, SourceKey: first.SourceKey})
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "http 404") {
		t.Fatalf("ensureLatestRepo() error=%v, want missing supporting file", err)
	}

	offline, err := store.readRepo(context.Background(), skillSourceSnapshot{Source: first.Source, SourceKey: first.SourceKey})
	if err != nil {
		t.Fatalf("readRepo() error=%v", err)
	}
	if offline.Commit != first.Commit {
		t.Fatalf("revision=%q, want preserved %q", offline.Commit, first.Commit)
	}
	assertFileContents(t, filepath.Join(offline.Path, "skills", "alpha", "references", "guide.md"), "first\n")
}

func TestSkillSourceStoreWellKnownPublishFailureRestoresPreviousSnapshot(t *testing.T) {
	server := newMutableLegacyWellKnownServer(t, "first\n", false)
	defer server.Close()
	store := newSkillSourceStore(t.TempDir())
	first, err := store.ensureLatestRepo(context.Background(), skillSourceSnapshot{Source: server.URL + "/entry"})
	if err != nil {
		t.Fatalf("initial ensureLatestRepo() error=%v", err)
	}
	server.Set("second\n", false)
	stablePath := first.Path
	store.renamePath = func(oldPath, newPath string) error {
		if newPath == stablePath && strings.Contains(filepath.Base(filepath.Dir(oldPath)), ".well-known-stage-") {
			return errors.New("injected publish failure")
		}
		return os.Rename(oldPath, newPath)
	}
	_, err = store.ensureLatestRepo(context.Background(), skillSourceSnapshot{Source: first.Source, SourceKey: first.SourceKey})
	if err == nil || !strings.Contains(err.Error(), "injected publish failure") {
		t.Fatalf("ensureLatestRepo() error=%v, want injected publish failure", err)
	}
	store.renamePath = nil

	offline, err := store.readRepo(context.Background(), skillSourceSnapshot{Source: first.Source, SourceKey: first.SourceKey})
	if err != nil {
		t.Fatalf("readRepo() error=%v", err)
	}
	if offline.Commit != first.Commit {
		t.Fatalf("revision=%q, want restored %q", offline.Commit, first.Commit)
	}
	assertFileContents(t, filepath.Join(stablePath, "skills", "alpha", "references", "guide.md"), "first\n")
}

type mutableLegacyWellKnownServer struct {
	*httptest.Server
	mu      sync.RWMutex
	guide   string
	missing bool
}

func newMutableLegacyWellKnownServer(t *testing.T, guide string, missing bool) *mutableLegacyWellKnownServer {
	t.Helper()
	fixture := &mutableLegacyWellKnownServer{guide: guide, missing: missing}
	fixture.Server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		fixture.mu.RLock()
		defer fixture.mu.RUnlock()
		switch request.URL.Path {
		case "/.well-known/skills/index.json":
			_, _ = response.Write([]byte(`{"skills":[{"name":"alpha","description":"Alpha","files":["SKILL.md","references/guide.md"]}]}`))
		case "/.well-known/skills/alpha/SKILL.md":
			_, _ = response.Write([]byte("---\nname: frontmatter-alpha\ndescription: Alpha skill\n---\n# Alpha\n"))
		case "/.well-known/skills/alpha/references/guide.md":
			if fixture.missing {
				http.NotFound(response, request)
				return
			}
			_, _ = response.Write([]byte(fixture.guide))
		default:
			http.NotFound(response, request)
		}
	}))
	return fixture
}

func (server *mutableLegacyWellKnownServer) Set(guide string, missing bool) {
	server.mu.Lock()
	defer server.mu.Unlock()
	server.guide = guide
	server.missing = missing
}
