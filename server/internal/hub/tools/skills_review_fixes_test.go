package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeSkillSourceRejectsSSHPassword(t *testing.T) {
	if _, _, err := normalizeSkillGitSource("ssh://deploy:secret@example.com/owner/repo.git"); err == nil {
		t.Fatal("normalizeSkillGitSource() accepted an SSH password")
	}
}

func TestNativeSkillSourceStoreInspectFetchesExistingClone(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	first, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}
	appendSkillSourceGitCommit(t, repository, "second")

	inspected, err := store.inspectRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("inspectRepo() error=%v", err)
	}
	if inspected.RemoteCommit == "" || inspected.RemoteCommit == first.Commit {
		t.Fatalf("inspectRepo() remote commit=%q, want newer commit than %q", inspected.RemoteCommit, first.Commit)
	}
}

func TestNativeSkillSourceStoreKeepsSourceLockWhileConsumingCheckout(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	if _, err := store.ensureRepo(context.Background(), source); err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}

	entered := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- store.withEnsuredRepo(context.Background(), source, func(checkout skillSourceCheckout) error {
			if checkout.Commit == "" {
				return errors.New("checkout commit is empty")
			}
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered

	secondDone := make(chan error, 1)
	go func() {
		_, err := store.updateRepo(context.Background(), source)
		secondDone <- err
	}()
	select {
	case err := <-secondDone:
		t.Fatalf("updateRepo() completed while checkout was being consumed: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatalf("withEnsuredRepo() error=%v", err)
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("updateRepo() error=%v", err)
	}
}

func TestNativeSkillSourceStoreRefreshUsesRemoteDefaultBranch(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "main-skill")
	runSkillSourceGit(t, repository, "checkout", "-b", "develop")
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "develop-skill"), "# develop\n", nil)
	runSkillSourceGit(t, repository, "add", "-A")
	runSkillSourceGit(t, repository, "commit", "-m", "develop")
	runSkillSourceGit(t, repository, "checkout", "main")

	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	checkout, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}
	// Keep the clone's cached origin/HEAD stale after changing the remote HEAD.
	runSkillSourceGit(t, checkout.Path, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	runSkillSourceGit(t, repository, "symbolic-ref", "HEAD", "refs/heads/develop")

	refreshed, err := store.refreshRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("refreshRepo() error=%v", err)
	}
	if refreshed.Branch != "develop" {
		t.Fatalf("refreshRepo() branch=%q, want develop", refreshed.Branch)
	}
	if refreshed.RemoteCommit == "" {
		t.Fatal("refreshRepo() returned an empty remote commit")
	}
}

func TestNativeInstalledNamesIncludeDirectoryLinks(t *testing.T) {
	home := t.TempDir()
	source := filepath.Join(t.TempDir(), "alpha")
	writeSkillSourceFixture(t, source, "# alpha\n", nil)
	link := filepath.Join(home, ".agents", "skills", "alpha")
	if err := createSkillDirectoryLink(source, link); err != nil {
		t.Skipf("directory links unavailable: %v", err)
	}
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	names, err := command.nativeInstalledNames(skillsCommandTarget{scope: "hub"})
	if err != nil {
		t.Fatalf("nativeInstalledNames() error=%v", err)
	}
	if _, ok := names["alpha"]; !ok {
		t.Fatalf("nativeInstalledNames()=%#v, want linked alpha", names)
	}
}

func TestNativeSkillTargetPathRejectsManagedRootSymlink(t *testing.T) {
	managedRoot := filepath.Join(t.TempDir(), "skills")
	outside := t.TempDir()
	if err := os.Symlink(outside, managedRoot); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}
	if _, err := nativeSkillTargetPath(managedRoot, "alpha"); err == nil {
		t.Fatal("nativeSkillTargetPath() accepted a managed root symlink")
	}
}

func TestNativeGlobalV2MigrationMaterializesCentralLinks(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	home := t.TempDir()
	key := "github.com/example/skills"
	store := newSkillSourceStore(home)
	clonePath := store.repositoryPath(key)
	os.MkdirAll(filepath.Dir(clonePath), 0o755)
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)

	legacyPath := filepath.Join(home, ".agents", ".skill-source-lock.json")
	writeLegacySkillSourceLock(t, legacyPath, "https://github.com/example/skills.git", key, "alpha")
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		writeSkillSourceFixture(t, filepath.Join(home, filepath.FromSlash(root)), "# legacy\n", nil)
	}

	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	var migrated skillSourceLock
	err := command.withNativeScopeLock(target, func() error {
		var err error
		migrated, _, err = command.readNativeScopeLock(context.Background(), target)
		return err
	})
	if err != nil {
		t.Fatalf("readNativeScopeLock() migration error=%v", err)
	}
	if len(migrated.Sources) != 1 || len(migrated.Sources[0].ManagedSkills) != 1 {
		t.Fatalf("migrated lock=%#v", migrated)
	}
	centralSkill := filepath.Join(clonePath, "skills", "alpha")
	centralInfo, err := os.Stat(centralSkill)
	if err != nil {
		t.Fatalf("stat central skill: %v", err)
	}
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		installedInfo, err := os.Stat(filepath.Join(home, filepath.FromSlash(root)))
		if err != nil {
			t.Fatalf("stat migrated skill %s: %v", root, err)
		}
		if !os.SameFile(installedInfo, centralInfo) {
			t.Fatalf("migrated skill %s does not resolve to central checkout", root)
		}
	}
}

func TestNativeGlobalV2MigrationFailureLeavesCanonicalLockAndTargetsUnchanged(t *testing.T) {
	home := t.TempDir()
	legacyPath := filepath.Join(home, ".agents", ".skill-source-lock.json")
	writeLegacySkillSourceLock(t, legacyPath, "https://example.invalid/missing/skills.git", "example.invalid/missing/skills", "alpha")
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		writeSkillSourceFixture(t, filepath.Join(home, filepath.FromSlash(root)), "# legacy\n", nil)
	}
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	err := command.withNativeScopeLock(target, func() error {
		_, _, err := command.readNativeScopeLock(context.Background(), target)
		return err
	})
	if err == nil {
		t.Fatal("readNativeScopeLock() unexpectedly migrated a source whose clone failed")
	}
	if _, statErr := os.Stat(command.sourceLockFile(target)); !os.IsNotExist(statErr) {
		t.Fatalf("canonical lock exists after failed migration: %v", statErr)
	}
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		info, statErr := os.Stat(filepath.Join(home, filepath.FromSlash(root)))
		if statErr != nil || !info.IsDir() {
			t.Fatalf("migration failure changed target %s: info=%#v err=%v", root, info, statErr)
		}
	}
}

func TestNativeAddRepoDoesNotAdvanceProjectLockWithoutSynchronizingCopies(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	home := t.TempDir()
	project := t.TempDir()
	key := "github.com/example/skills"
	store := newSkillSourceStore(home)
	clonePath := store.repositoryPath(key)
	os.MkdirAll(filepath.Dir(clonePath), 0o755)
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)

	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: home, Projects: []ProjectInfo{{Name: "project", Path: project}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: project}
	source := "https://github.com/example/skills.git"
	if err := command.nativeAddRepo(context.Background(), target, source, key); err != nil {
		t.Fatalf("initial nativeAddRepo() error=%v", err)
	}
	if err := command.nativeInstall(context.Background(), target, source, []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	lockPath := command.sourceLockFile(target)
	firstLock, _, err := readSkillSourceLockFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "alpha"), "# alpha v2\n", nil)
	runSkillSourceGit(t, repository, "add", "-A")
	runSkillSourceGit(t, repository, "commit", "-m", "alpha v2")
	if _, err := command.nativeStore().updateRepo(context.Background(), skillSourceSnapshot{Source: source, SourceKey: key}); err != nil {
		t.Fatalf("central updateRepo() error=%v", err)
	}
	if err := command.nativeAddRepo(context.Background(), target, source, key); err != nil {
		t.Fatalf("duplicate nativeAddRepo() error=%v", err)
	}
	secondLock, _, err := readSkillSourceLockFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	if secondLock.Sources[0].Commit != firstLock.Sources[0].Commit {
		t.Fatalf("duplicate Add Repo advanced project commit from %s to %s without copying", firstLock.Sources[0].Commit, secondLock.Sources[0].Commit)
	}
	raw, err := os.ReadFile(filepath.Join(project, ".agents", "skills", "alpha", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(raw)) != "# alpha" {
		t.Fatalf("project copy changed during duplicate Add Repo: %q", raw)
	}
}

func TestSkillsOperationsHaveUniqueIDsAtSecondResolution(t *testing.T) {
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a"})
	fixed := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)
	command.now = func() time.Time { return fixed }
	payload := skillsCommandPayload{Action: "install", HubID: "hub-a", Scope: "hub"}
	first, err := command.acceptOperation(payload)
	if err != nil {
		t.Fatal(err)
	}
	command.finishOperation(first, "succeeded", nil, "", "")
	second, err := command.acceptOperation(payload)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || second.ID == "" || first.ID == second.ID {
		t.Fatalf("operation IDs=%q,%q, want unique non-empty IDs", first.ID, second.ID)
	}
}

func TestNativeDirectoryTransactionRollbackReportsFailure(t *testing.T) {
	transaction := &nativeDirectoryTransaction{items: []nativeStagedChange{{
		nativeDirectoryChange: nativeDirectoryChange{Final: filepath.Join(t.TempDir(), "final")},
		Backup:                filepath.Join(t.TempDir(), "missing-backup"),
		HadExist:              true,
	}}}
	if err := transaction.Rollback(); err == nil {
		t.Fatal("Rollback() returned nil after failing to restore a missing backup")
	}
}

func writeLegacySkillSourceLock(t *testing.T, path, source, sourceKey, skillName string) {
	t.Helper()
	legacy := skillSourceLockV2Wire{
		Version:       2,
		HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshotV2Wire{{
			Source: source, SourceKey: sourceKey, ResolvedCommit: strings.Repeat("a", 40),
			RefreshedAt: "2026-08-18T12:00:00Z", SkillList: []skillSourceSkillSnapshot{{Name: skillName}},
		}},
	}
	raw, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}
