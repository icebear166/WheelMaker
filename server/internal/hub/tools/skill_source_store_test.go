package tools

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeSkillSourceLockWritesV3ManagedSkillsWithoutLegacyFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	lock := skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{{
			Source:        "https://github.com/example/skills.git",
			SourceKey:     "github.com/example/skills",
			Branch:        "main",
			Commit:        strings.Repeat("a", 40),
			UpdatedAt:     "2026-08-18T12:00:00Z",
			ManagedSkills: []string{"zeta", "alpha"},
		}},
	}

	if _, err := writeSkillSourceLockFile(path, skillSourceMissingRevision, lock); err != nil {
		t.Fatalf("writeSkillSourceLockFile() error=%v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"version": 3`)) ||
		!bytes.Contains(raw, []byte(`"commit": "`+strings.Repeat("a", 40)+`"`)) ||
		!bytes.Contains(raw, []byte(`"managedSkills"`)) {
		t.Fatalf("raw lock=%s, want v3 fields", raw)
	}
	for _, legacy := range []string{"hashAlgorithm", "resolvedCommit", "refreshedAt", "skillList", "contentSha256"} {
		if bytes.Contains(raw, []byte(`"`+legacy+`"`)) {
			t.Fatalf("raw lock contains legacy field %q: %s", legacy, raw)
		}
	}
	loaded, _, err := readSkillSourceLockFile(path)
	if err != nil {
		t.Fatalf("readSkillSourceLockFile() error=%v", err)
	}
	if loaded.Sources[0].Commit != strings.Repeat("a", 40) || len(loaded.Sources[0].ManagedSkills) != 2 {
		t.Fatalf("loaded=%#v", loaded)
	}
}

func TestNativeSkillsCommandUninstallRemovesExplicitExternalSkillWithoutCreatingLock(t *testing.T) {
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	for _, root := range []string{".agents/skills/local", ".claude/skills/local"} {
		writeSkillSourceFixture(t, filepath.Join(home, filepath.FromSlash(root)), "# local\n", nil)
	}

	if err := command.nativeUninstall(context.Background(), target, "", []string{"local"}); err != nil {
		t.Fatalf("nativeUninstall() error=%v", err)
	}
	for _, root := range []string{".agents/skills/local", ".claude/skills/local"} {
		if _, err := os.Stat(filepath.Join(home, filepath.FromSlash(root))); !os.IsNotExist(err) {
			t.Fatalf("external skill %s still exists, err=%v", root, err)
		}
	}
	if _, err := os.Stat(filepath.Join(home, ".wheelmaker", "skills", ".skill-source-lock.json")); !os.IsNotExist(err) {
		t.Fatalf("external uninstall created a source lock: %v", err)
	}
}

func TestNativeSkillSourceLockMigrationUsesOnlyLegacyListAndInstalledNames(t *testing.T) {
	legacy := skillSourceLock{
		Version:       2,
		HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source:         "https://github.com/example/skills.git",
			SourceKey:      "github.com/example/skills",
			ResolvedCommit: strings.Repeat("b", 40),
			RefreshedAt:    "2026-08-18T12:00:00Z",
			SkillList: []skillSourceSkillSnapshot{
				{Name: "alpha"},
				{Name: "not-installed"},
			},
		}},
	}
	migrated, err := migrateSkillSourceLockToV3(legacy, map[string]struct{}{"alpha": {}, "external": {}})
	if err != nil {
		t.Fatalf("migrateSkillSourceLockToV3() error=%v", err)
	}
	if migrated.Version != 3 || migrated.Sources[0].Commit != strings.Repeat("b", 40) || migrated.Sources[0].UpdatedAt != legacy.Sources[0].RefreshedAt {
		t.Fatalf("migrated=%#v", migrated)
	}
	if got := migrated.Sources[0].ManagedSkills; len(got) != 1 || got[0] != "alpha" {
		t.Fatalf("managedSkills=%v, want only installed legacy skill", got)
	}
}

func TestNativeSkillSourceStoreRefreshFetchesWithoutChangingCheckout(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	first, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}
	appendSkillSourceGitCommit(t, repository, "second")
	refreshed, err := store.refreshRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("refreshRepo() error=%v", err)
	}
	if refreshed.Commit != first.Commit {
		t.Fatalf("refresh changed checkout commit from %s to %s", first.Commit, refreshed.Commit)
	}
	if refreshed.RemoteCommit == "" || refreshed.RemoteCommit == first.Commit {
		t.Fatalf("refresh remote commit=%q, want newer remote SHA", refreshed.RemoteCommit)
	}
	updated, err := store.updateRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("updateRepo() error=%v", err)
	}
	if updated.Commit != refreshed.RemoteCommit {
		t.Fatalf("updated commit=%s, want remote %s", updated.Commit, refreshed.RemoteCommit)
	}
}

func TestNativeSkillSourceStoreUsesReadableSourceKeyPaths(t *testing.T) {
	home := t.TempDir()
	store := newSkillSourceStore(home)

	if got, want := filepath.ToSlash(store.repositoryPath("github.com/owner/repo")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com_owner_repo")); got != want {
		t.Fatalf("repositoryPath()=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.repositoryPath("github.com:8443/owner/repo")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com~3A8443_owner_repo")); got != want {
		t.Fatalf("repositoryPath(port)=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.repositoryPath("github.com/owner/repo-name")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com_owner_repo-name")); got != want {
		t.Fatalf("repositoryPath(dash)=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.repositoryPath("github.com/owner/repo_name")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com_owner_repo~5Fname")); got != want {
		t.Fatalf("repositoryPath(underscore)=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.lockPath("github.com/owner/repo")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", ".locks", "github.com_owner_repo.lock")); got != want {
		t.Fatalf("lockPath()=%q, want %q", got, want)
	}
}

func TestNativeSkillSourceStoreDoesNotAdoptLegacyRepositoryPaths(t *testing.T) {
	key := "github.com/example/skills"
	legacyPath := func(name string, home string) string {
		switch name {
		case "flat":
			return filepath.Join(home, ".wheelmaker", "skills", "github.com--example--skills")
		case "nested":
			return filepath.Join(home, ".wheelmaker", "skills", "github.com", "example", "skills")
		case "hash":
			digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(key))))
			return filepath.Join(home, ".wheelmaker", "skills", hex.EncodeToString(digest[:]))
		default:
			t.Fatalf("unknown legacy path %q", name)
			return ""
		}
	}

	for _, name := range []string{"flat", "nested", "hash"} {
		t.Run(name, func(t *testing.T) {
			repository := t.TempDir()
			initSkillSourceGitFixture(t, repository, "alpha")
			home := t.TempDir()
			oldPath := legacyPath(name, home)
			if err := os.MkdirAll(filepath.Dir(oldPath), 0o755); err != nil {
				t.Fatal(err)
			}
			runSkillSourceGit(t, filepath.Dir(oldPath), "clone", "--quiet", repository, oldPath)

			store := newSkillSourceStore(home)
			checkout, err := store.ensureRepo(context.Background(), skillSourceSnapshot{Source: repository, SourceKey: key})
			if err != nil {
				t.Fatalf("ensureRepo() error=%v", err)
			}
			wantPath := filepath.Join(home, ".wheelmaker", "skills", "github.com_example_skills")
			if checkout.Path != wantPath {
				t.Fatalf("checkout.Path=%q, want %q", checkout.Path, wantPath)
			}
			if _, err := os.Stat(oldPath); err != nil {
				t.Fatalf("legacy repository was adopted or removed: %v", err)
			}
		})
	}
}

func TestNativeSkillSourceStoreRejectsDirtyCheckoutBeforeUpdate(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	checkout, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(checkout.Path, "untracked.txt"), []byte("dirty\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.updateRepo(context.Background(), source); err == nil || !strings.Contains(strings.ToLower(err.Error()), "dirty") {
		t.Fatalf("updateRepo() error=%v, want dirty checkout failure", err)
	}
}

func TestNativeSkillDirectoryCopyAndLinkMaterializers(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	writeSkillSourceFixture(t, source, "# Skill\n", map[string]string{"references/guide.md": "guide\n"})
	copyTarget := filepath.Join(t.TempDir(), "copy")
	if err := copySkillDirectory(source, copyTarget); err != nil {
		t.Fatalf("copySkillDirectory() error=%v", err)
	}
	copyRaw, err := os.ReadFile(filepath.Join(copyTarget, "SKILL.md"))
	if err != nil || string(copyRaw) != "# Skill\n" {
		t.Fatalf("copied skill=%q err=%v", copyRaw, err)
	}
	linkTarget := filepath.Join(t.TempDir(), "link")
	if err := createSkillDirectoryLink(source, linkTarget); err != nil {
		t.Skipf("directory links unavailable: %v", err)
	}
	linkRaw, err := os.ReadFile(filepath.Join(linkTarget, "references", "guide.md"))
	if err != nil || string(linkRaw) != "guide\n" {
		t.Fatalf("linked skill=%q err=%v", linkRaw, err)
	}
}

func initSkillSourceGitFixture(t *testing.T, repository, skillName string) {
	t.Helper()
	runSkillSourceGit(t, repository, "init", "-b", "main")
	runSkillSourceGit(t, repository, "config", "user.email", "skills@example.com")
	runSkillSourceGit(t, repository, "config", "user.name", "Skills Test")
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", skillName), "# "+skillName+"\n", nil)
	runSkillSourceGit(t, repository, "add", ".")
	runSkillSourceGit(t, repository, "commit", "-m", "initial")
}

func appendSkillSourceGitCommit(t *testing.T, repository, skillName string) {
	t.Helper()
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", skillName), "# "+skillName+"\n", nil)
	runSkillSourceGit(t, repository, "add", ".")
	runSkillSourceGit(t, repository, "commit", "-m", skillName)
}

func TestNativeSkillSourceLockWireShapeIsStrictJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	if err := os.WriteFile(path, []byte(`{"version":3,"sources":[]}{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readSkillSourceLockFile(path); err == nil {
		t.Fatal("readSkillSourceLockFile() accepted trailing JSON")
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(`{"version":3,"sources":[]}`), &value); err != nil {
		t.Fatal(err)
	}
}

func TestNativeSkillSourceIdentityNormalizesEquivalentAddressesAndSeparatesSSHVariants(t *testing.T) {
	equivalent := []string{
		"owner/repo",
		"https://GitHub.com/Owner/repo.git/",
		"git@github.com:Owner/repo.git",
		"ssh://git@github.com/Owner/repo.git",
	}
	var wantKey string
	for index, input := range equivalent {
		_, key, err := normalizeSkillGitSource(input)
		if err != nil {
			t.Fatalf("normalizeSkillGitSource(%q) error=%v", input, err)
		}
		if index == 0 {
			wantKey = key
		} else if key != wantKey {
			t.Fatalf("normalizeSkillGitSource(%q) key=%q, want %q", input, key, wantKey)
		}
	}

	variants := map[string]string{
		"ssh://deploy@github.com/Owner/repo.git":   "deploy@github.com/owner/repo",
		"ssh://git@github.com:2222/Owner/repo.git": "github.com:2222/owner/repo",
		"https://github.com:8443/Owner/repo.git":   "github.com:8443/owner/repo",
	}
	for input, expectedKey := range variants {
		_, key, err := normalizeSkillGitSource(input)
		if err != nil {
			t.Fatalf("normalizeSkillGitSource(%q) error=%v", input, err)
		}
		if key != expectedKey {
			t.Fatalf("normalizeSkillGitSource(%q) key=%q, want %q", input, key, expectedKey)
		}
	}
}

func TestNativeSkillSourceCatalogMarksMissingCloneWithoutNetwork(t *testing.T) {
	home := t.TempDir()
	lockPath := filepath.Join(home, ".wheelmaker", "skills", ".skill-source-lock.json")
	lock := skillSourceLock{Version: 3, Sources: []skillSourceSnapshot{{
		Source: "https://example.invalid/owner/repo.git", SourceKey: "example.invalid/owner/repo",
		Commit: strings.Repeat("a", 40), UpdatedAt: "2026-08-18T12:00:00Z", ManagedSkills: []string{"alpha"},
	}}}
	if _, err := writeSkillSourceLockFile(lockPath, skillSourceMissingRevision, lock); err != nil {
		t.Fatal(err)
	}
	installedRoot := filepath.Join(home, ".agents", "skills", "alpha")
	writeSkillSourceFixture(t, installedRoot, "# alpha\n", nil)
	snapshot, err := ScanSkillsSourceScope(context.Background(), SkillsSourceScopeInput{
		HomeDir: home,
		Installed: []SkillsInstalledSkillSnapshot{{
			Name: "alpha", Managed: true, Locations: []string{filepath.Join(installedRoot, "SKILL.md")},
		}},
	})
	if err != nil {
		t.Fatalf("ScanSkillsSourceScope() error=%v", err)
	}
	if len(snapshot.Sources) != 1 || snapshot.Sources[0].Status != "needs_clone" {
		t.Fatalf("snapshot=%#v, want needs_clone without cloning", snapshot)
	}
	if len(snapshot.Sources[0].Skills) != 1 || snapshot.Sources[0].Skills[0].Name != "alpha" || snapshot.Sources[0].Skills[0].Status != "needs_clone" {
		t.Fatalf("missing-clone managed skill=%#v, want visible installed ownership", snapshot.Sources[0].Skills)
	}
	if _, err := os.Stat(newSkillSourceStore(home).repositoryPath("example.invalid/owner/repo")); !os.IsNotExist(err) {
		t.Fatalf("passive scan created a clone: %v", err)
	}
}

func TestNativeSkillsCommandProjectUpdateDeletesUpstreamRemovedWithoutInstallingNew(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	home := t.TempDir()
	projectRoot := t.TempDir()
	store := newSkillSourceStore(home)
	key := "github.com/example/skills"
	clonePath := store.repositoryPath(key)
	if err := os.MkdirAll(filepath.Dir(clonePath), 0o755); err != nil {
		t.Fatal(err)
	}
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: home, Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: projectRoot}
	initial, err := command.nativeStore().ensureRepo(context.Background(), skillSourceSnapshot{Source: "https://github.com/example/skills.git", SourceKey: key})
	if err != nil {
		t.Fatal(err)
	}
	lockPath := command.sourceLockFile(target)
	if _, err := writeSkillSourceLockFile(lockPath, skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{{Source: "https://github.com/example/skills.git", SourceKey: key, Commit: initial.Commit, UpdatedAt: "2026-08-18T12:00:00Z", ManagedSkills: []string{}}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := command.nativeInstall(context.Background(), target, "https://github.com/example/skills.git", []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		if _, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(root), "SKILL.md")); err != nil {
			t.Fatalf("installed copy %s missing: %v", root, err)
		}
	}
	if err := os.RemoveAll(filepath.Join(repository, "skills", "alpha")); err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "beta"), "# beta\n", nil)
	runSkillSourceGit(t, repository, "add", "-A")
	runSkillSourceGit(t, repository, "commit", "-m", "replace alpha")
	if err := command.nativeUpdateRepo(context.Background(), target, "https://github.com/example/skills.git"); err != nil {
		t.Fatalf("nativeUpdateRepo() error=%v", err)
	}
	if _, err := os.Stat(filepath.Join(projectRoot, ".agents", "skills", "alpha")); !os.IsNotExist(err) {
		t.Fatalf("removed upstream alpha still exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(projectRoot, ".agents", "skills", "beta")); !os.IsNotExist(err) {
		t.Fatalf("new upstream beta was auto-installed: %v", err)
	}
}
