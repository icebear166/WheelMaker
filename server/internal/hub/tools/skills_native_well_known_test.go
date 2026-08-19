package tools

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

func TestNativeWellKnownAddInstallAndUpdateManagedSkills(t *testing.T) {
	server := newMutableWellKnownCatalogServer(t, map[string]string{
		"alpha": "alpha v1",
		"beta":  "beta v1",
	})
	defer server.Close()
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	input := server.URL + "/.well-known/skills/alpha/SKILL.md"
	normalized, sourceKey, cmdErr := normalizeNativeSkillSource(input)
	if cmdErr != nil || sourceKey != "" {
		t.Fatalf("normalizeNativeSkillSource()=(%q, %q, %v), want unresolved well-known input", normalized, sourceKey, cmdErr)
	}
	if err := command.nativeAddRepo(context.Background(), target, normalized, sourceKey); err != nil {
		t.Fatalf("nativeAddRepo() error=%v", err)
	}

	lock, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	canonical := server.URL + "/.well-known/skills/index.json"
	if lock.Version != 3 || len(lock.Sources) != 1 || lock.Sources[0].Source != canonical || lock.Sources[0].SourceKey != canonical ||
		lock.Sources[0].Branch != "" || len(lock.Sources[0].Commit) != 64 || len(lock.Sources[0].ManagedSkills) != 0 {
		t.Fatalf("lock=%#v, want canonical uninstalled source", lock)
	}
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha", ".agents/skills/beta", ".claude/skills/beta"} {
		if _, err := os.Stat(filepath.Join(home, filepath.FromSlash(root))); !os.IsNotExist(err) {
			t.Fatalf("Add installed %s: %v", root, err)
		}
	}

	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		writeSkillSourceFixture(t, filepath.Join(home, filepath.FromSlash(root)), "# unmanaged\n", nil)
	}
	if err := command.nativeInstall(context.Background(), target, canonical, []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	assertSkillMarkdownContains(t, filepath.Join(home, ".agents", "skills", "alpha", "SKILL.md"), "alpha v1")
	if sourceType := nativeSkillSourceType(canonical); sourceType != "well-known" {
		t.Fatalf("nativeSkillSourceType()=%q, want well-known", sourceType)
	}
	lock, _, err = readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil || len(lock.Sources[0].ManagedSkills) != 1 || lock.Sources[0].ManagedSkills[0] != "alpha" {
		t.Fatalf("installed lock=%#v error=%v", lock, err)
	}

	server.Set(map[string]string{"alpha": "alpha v2", "beta": "beta v1", "gamma": "gamma v1"})
	if err := command.nativeUpdateRepo(context.Background(), target, canonical); err != nil {
		t.Fatalf("nativeUpdateRepo() error=%v", err)
	}
	assertSkillMarkdownContains(t, filepath.Join(home, ".agents", "skills", "alpha", "SKILL.md"), "alpha v2")
	for _, name := range []string{"beta", "gamma"} {
		if _, err := os.Stat(filepath.Join(home, ".agents", "skills", name)); !os.IsNotExist(err) {
			t.Fatalf("Update auto-installed %s: %v", name, err)
		}
	}
	if err := command.nativeInstall(context.Background(), target, canonical, nil, true); err != nil {
		t.Fatalf("nativeInstall(installAll) error=%v", err)
	}
	for _, name := range []string{"alpha", "beta", "gamma"} {
		if _, err := os.Stat(filepath.Join(home, ".agents", "skills", name, "SKILL.md")); err != nil {
			t.Fatalf("Install all did not install %s: %v", name, err)
		}
	}

	server.Set(map[string]string{"gamma": "gamma v2"})
	if err := command.nativeUpdateRepo(context.Background(), target, canonical); err != nil {
		t.Fatalf("nativeUpdateRepo() after deletion error=%v", err)
	}
	if _, err := os.Stat(filepath.Join(home, ".agents", "skills", "alpha")); !os.IsNotExist(err) {
		t.Fatalf("deleted managed alpha still exists: %v", err)
	}
	assertSkillMarkdownContains(t, filepath.Join(home, ".agents", "skills", "gamma", "SKILL.md"), "gamma v2")
	lock, _, err = readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil || len(lock.Sources[0].ManagedSkills) != 1 || lock.Sources[0].ManagedSkills[0] != "gamma" {
		t.Fatalf("deleted managed lock=%#v error=%v", lock, err)
	}
}

func TestNativeWellKnownDuplicateAddDoesNotDuplicateOrAdvanceScope(t *testing.T) {
	server := newMutableWellKnownCatalogServer(t, map[string]string{"alpha": "alpha v1"})
	defer server.Close()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: t.TempDir()})
	target := skillsCommandTarget{scope: "hub"}
	input := server.URL + "/entry"
	source, sourceKey, cmdErr := normalizeNativeSkillSource(input)
	if cmdErr != nil {
		t.Fatal(cmdErr)
	}
	if err := command.nativeAddRepo(context.Background(), target, source, sourceKey); err != nil {
		t.Fatalf("first nativeAddRepo() error=%v", err)
	}
	first, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	server.Set(map[string]string{"alpha": "alpha v2"})
	if err := command.nativeAddRepo(context.Background(), target, source, sourceKey); err != nil {
		t.Fatalf("duplicate nativeAddRepo() error=%v", err)
	}
	second, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Sources) != 1 || second.Sources[0].Commit != first.Sources[0].Commit {
		t.Fatalf("duplicate Add changed lock from %#v to %#v", first, second)
	}
}

func TestNativeWellKnownProjectLockFailureKeepsNewCentralAndRollsBackProject(t *testing.T) {
	server := newMutableWellKnownCatalogServer(t, map[string]string{"alpha": "alpha v1"})
	defer server.Close()
	home := t.TempDir()
	project := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: home, Projects: []ProjectInfo{{Name: "project", Path: project}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: project}
	source, sourceKey, cmdErr := normalizeNativeSkillSource(server.URL + "/entry")
	if cmdErr != nil {
		t.Fatal(cmdErr)
	}
	if err := command.nativeAddRepo(context.Background(), target, source, sourceKey); err != nil {
		t.Fatalf("nativeAddRepo() error=%v", err)
	}
	canonical := server.URL + "/.well-known/skills/index.json"
	if err := command.nativeInstall(context.Background(), target, canonical, []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	before, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	beforeCommit := before.Sources[0].Commit
	lockPath := command.sourceLockFile(target)
	server.Set(map[string]string{"alpha": "alpha v2"})
	server.BeforeNextSkillResponse(func() {
		raw, readErr := os.ReadFile(lockPath)
		if readErr == nil {
			_ = os.WriteFile(lockPath, append(raw, '\n'), 0o600)
		}
	})
	err = command.nativeUpdateRepo(context.Background(), target, canonical)
	if !errors.Is(err, errSkillSourceLockChanged) {
		t.Fatalf("nativeUpdateRepo() error=%v, want lock compare-and-swap failure", err)
	}
	assertSkillMarkdownContains(t, filepath.Join(project, ".agents", "skills", "alpha", "SKILL.md"), "alpha v1")
	after, _, err := readSkillSourceLockFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	if after.Sources[0].Commit != beforeCommit {
		t.Fatalf("project lock commit=%q, want old %q", after.Sources[0].Commit, beforeCommit)
	}
	central, err := command.nativeStore().readRepo(context.Background(), skillSourceSnapshot{Source: canonical, SourceKey: canonical})
	if err != nil {
		t.Fatalf("read central snapshot: %v", err)
	}
	if central.Commit == beforeCommit {
		t.Fatalf("central commit=%q, want newly published revision", central.Commit)
	}
	assertSkillMarkdownContains(t, filepath.Join(central.Path, "skills", "alpha", "SKILL.md"), "alpha v2")
}

func TestNativeWellKnownGlobalLockFailureReportsCentralMisalignment(t *testing.T) {
	server := newMutableWellKnownCatalogServer(t, map[string]string{"alpha": "alpha v1"})
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	source, sourceKey, cmdErr := normalizeNativeSkillSource(server.URL + "/entry")
	if cmdErr != nil {
		t.Fatal(cmdErr)
	}
	if err := command.nativeAddRepo(context.Background(), target, source, sourceKey); err != nil {
		t.Fatalf("nativeAddRepo() error=%v", err)
	}
	canonical := server.URL + "/.well-known/skills/index.json"
	if err := command.nativeInstall(context.Background(), target, canonical, []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	before, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	beforeCommit := before.Sources[0].Commit
	lockPath := command.sourceLockFile(target)
	server.Set(map[string]string{"alpha": "alpha v2"})
	server.BeforeNextSkillResponse(func() {
		raw, readErr := os.ReadFile(lockPath)
		if readErr == nil {
			_ = os.WriteFile(lockPath, append(raw, '\n'), 0o600)
		}
	})
	err = command.nativeUpdateRepo(context.Background(), target, canonical)
	if !errors.Is(err, errSkillSourceLockChanged) {
		t.Fatalf("nativeUpdateRepo() error=%v, want lock compare-and-swap failure", err)
	}
	assertSkillMarkdownContains(t, filepath.Join(home, ".agents", "skills", "alpha", "SKILL.md"), "alpha v2")
	after, _, err := readSkillSourceLockFile(lockPath)
	if err != nil || after.Sources[0].Commit != beforeCommit {
		t.Fatalf("lock=%#v error=%v, want old revision %q", after, err, beforeCommit)
	}
	server.Close()
	snapshot, err := ScanSkillsSourceScope(context.Background(), SkillsSourceScopeInput{
		HomeDir: home,
		Installed: []SkillsInstalledSkillSnapshot{{
			Name: "alpha", Managed: true,
			Locations: []string{
				filepath.Join(home, ".agents", "skills", "alpha", "SKILL.md"),
				filepath.Join(home, ".claude", "skills", "alpha", "SKILL.md"),
			},
		}},
	})
	if err != nil {
		t.Fatalf("ScanSkillsSourceScope() error=%v", err)
	}
	if len(snapshot.Sources) != 1 || !snapshot.Sources[0].UpdateAvailable || snapshot.Sources[0].RemoteCommit == beforeCommit {
		t.Fatalf("snapshot=%#v, want central/scope misalignment", snapshot)
	}
}

func TestNativeWellKnownUninstallAndRemoveSourceWorkOffline(t *testing.T) {
	server := newMutableWellKnownCatalogServer(t, map[string]string{"alpha": "alpha v1"})
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	source, sourceKey, cmdErr := normalizeNativeSkillSource(server.URL + "/entry")
	if cmdErr != nil {
		t.Fatal(cmdErr)
	}
	if err := command.nativeAddRepo(context.Background(), target, source, sourceKey); err != nil {
		t.Fatalf("nativeAddRepo() error=%v", err)
	}
	canonical := server.URL + "/.well-known/skills/index.json"
	if err := command.nativeInstall(context.Background(), target, canonical, []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	centralPath := command.nativeStore().repositoryPath(canonical)
	server.Close()
	if err := command.nativeUninstall(context.Background(), target, canonical, []string{"alpha"}); err != nil {
		t.Fatalf("nativeUninstall() offline error=%v", err)
	}
	if err := command.nativeRemoveRepo(context.Background(), target, canonical); err != nil {
		t.Fatalf("nativeRemoveRepo() offline error=%v", err)
	}
	lock, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil || len(lock.Sources) != 0 {
		t.Fatalf("lock=%#v error=%v, want empty scope", lock, err)
	}
	if _, err := os.Stat(centralPath); err != nil {
		t.Fatalf("central snapshot was deleted: %v", err)
	}
}

func TestNativeWellKnownPassiveScanReportsMissingSnapshotWithoutNetwork(t *testing.T) {
	home := t.TempDir()
	canonical := "https://example.invalid/.well-known/skills/index.json"
	lockPath := skillSourceLockPath("", "", home)
	if _, err := writeSkillSourceLockFile(lockPath, skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{{
			Source: canonical, SourceKey: canonical, Commit: strings.Repeat("a", 64),
			UpdatedAt: "2026-08-19T12:00:00Z", ManagedSkills: []string{},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := ScanSkillsSourceScope(context.Background(), SkillsSourceScopeInput{HomeDir: home})
	if err != nil {
		t.Fatalf("ScanSkillsSourceScope() error=%v", err)
	}
	if len(snapshot.Sources) != 1 || snapshot.Sources[0].Status != "needs_fetch" {
		t.Fatalf("snapshot=%#v, want well-known needs_fetch status", snapshot)
	}
}

type mutableWellKnownCatalogServer struct {
	*httptest.Server
	mu                 sync.RWMutex
	skills             map[string]string
	beforeNextResponse func()
}

func newMutableWellKnownCatalogServer(t *testing.T, skills map[string]string) *mutableWellKnownCatalogServer {
	t.Helper()
	fixture := &mutableWellKnownCatalogServer{skills: cloneWellKnownSkills(skills)}
	fixture.Server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		if request.URL.Path == "/.well-known/skills/index.json" {
			names := make([]string, 0, len(fixture.skills))
			for name := range fixture.skills {
				names = append(names, name)
			}
			sort.Strings(names)
			entries := make([]map[string]any, 0, len(names))
			for _, name := range names {
				entries = append(entries, map[string]any{"name": name, "description": name, "files": []string{"SKILL.md"}})
			}
			raw, _ := json.Marshal(map[string]any{"skills": entries})
			_, _ = response.Write(raw)
			return
		}
		parts := strings.Split(strings.Trim(request.URL.Path, "/"), "/")
		if len(parts) == 4 && parts[0] == ".well-known" && parts[1] == "skills" && parts[3] == "SKILL.md" {
			if body, exists := fixture.skills[parts[2]]; exists {
				if fixture.beforeNextResponse != nil {
					callback := fixture.beforeNextResponse
					fixture.beforeNextResponse = nil
					callback()
				}
				_, _ = response.Write([]byte("---\nname: frontmatter-" + parts[2] + "\ndescription: " + parts[2] + "\n---\n# " + body + "\n"))
				return
			}
		}
		http.NotFound(response, request)
	}))
	return fixture
}

func (server *mutableWellKnownCatalogServer) Set(skills map[string]string) {
	server.mu.Lock()
	defer server.mu.Unlock()
	server.skills = cloneWellKnownSkills(skills)
}

func (server *mutableWellKnownCatalogServer) BeforeNextSkillResponse(callback func()) {
	server.mu.Lock()
	defer server.mu.Unlock()
	server.beforeNextResponse = callback
}

func cloneWellKnownSkills(skills map[string]string) map[string]string {
	cloned := make(map[string]string, len(skills))
	for name, body := range skills {
		cloned[name] = body
	}
	return cloned
}

func assertSkillMarkdownContains(t *testing.T, path, want string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if !strings.Contains(string(raw), want) {
		t.Fatalf("%s contents=%q, want substring %q", path, raw, want)
	}
}
