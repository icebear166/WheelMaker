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

func TestSkillsCommandScopeUpdateProcessesEveryRepository(t *testing.T) {
	firstRepository := t.TempDir()
	secondRepository := t.TempDir()
	initSkillSourceGitFixture(t, firstRepository, "alpha")
	initSkillSourceGitFixture(t, secondRepository, "beta")
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	firstSource := "https://github.com/example/first.git"
	secondSource := "https://github.com/example/second.git"
	seedNativeSkillSourceClone(t, command, firstRepository, firstSource, "github.com/example/first")
	seedNativeSkillSourceClone(t, command, secondRepository, secondSource, "github.com/example/second")
	appendSkillSourceGitCommit(t, firstRepository, "alpha-new")
	appendSkillSourceGitCommit(t, secondRepository, "beta-new")
	lock := skillSourceLock{Version: 3, Sources: []skillSourceSnapshot{
		{Source: firstSource, SourceKey: "github.com/example/first", ManagedSkills: []string{}},
		{Source: secondSource, SourceKey: "github.com/example/second", ManagedSkills: []string{}},
	}}
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, lock); err != nil {
		t.Fatal(err)
	}

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "updateScope",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr != nil {
		t.Fatalf("scope update error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope update", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "succeeded" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want two successful source results", operation)
	}
	for _, result := range operation.Results {
		if result.Status != "succeeded" || result.Action != "update" {
			t.Fatalf("source result=%#v, want successful update", result)
		}
	}
	updated, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range updated.Sources {
		if source.Commit == "" {
			t.Fatalf("source=%#v has no updated commit", source)
		}
	}
}

func TestSkillsCommandScopeUpdateContinuesAfterSourceFailure(t *testing.T) {
	workingRepository := t.TempDir()
	initSkillSourceGitFixture(t, workingRepository, "alpha")
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	workingSource := "https://github.com/example/working.git"
	missingSource := "https://github.com/example/missing.git"
	seedNativeSkillSourceClone(t, command, workingRepository, workingSource, "github.com/example/working")
	if err := os.MkdirAll(command.nativeStore().repositoryPath("github.com/example/missing"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{
			{Source: workingSource, SourceKey: "github.com/example/working"},
			{Source: missingSource, SourceKey: "github.com/example/missing"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "updateScope",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr != nil {
		t.Fatalf("scope update error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope update", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "partial" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want partial results for both sources", operation)
	}
	statuses := map[string]string{}
	for _, result := range operation.Results {
		statuses[result.Skill] = result.Status
	}
	if statuses["github.com/example/working"] != "succeeded" || statuses["github.com/example/missing"] != "failed" {
		t.Fatalf("source statuses=%#v, want working succeeded and missing failed", statuses)
	}
	if _, err := os.Stat(command.nativeStore().repositoryPath("github.com/example/working")); err != nil {
		t.Fatalf("successful source was not processed: %v", err)
	}
}

func TestSkillsCommandScopeInstallAllUpdatesBeforeInstalling(t *testing.T) {
	firstRepository := t.TempDir()
	secondRepository := t.TempDir()
	initSkillSourceGitFixture(t, firstRepository, "alpha")
	initSkillSourceGitFixture(t, secondRepository, "beta")
	projectRoot := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: t.TempDir(), Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: projectRoot}
	firstSource := "https://github.com/example/first.git"
	secondSource := "https://github.com/example/second.git"
	firstInitial := seedNativeSkillSourceClone(t, command, firstRepository, firstSource, "github.com/example/first")
	secondInitial := seedNativeSkillSourceClone(t, command, secondRepository, secondSource, "github.com/example/second")
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{
			{Source: firstSource, SourceKey: "github.com/example/first", Commit: firstInitial, UpdatedAt: "2026-08-19T00:00:00Z"},
			{Source: secondSource, SourceKey: "github.com/example/second", Commit: secondInitial, UpdatedAt: "2026-08-19T00:00:00Z"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	appendSkillSourceGitCommit(t, firstRepository, "new-alpha")
	appendSkillSourceGitCommit(t, secondRepository, "new-beta")

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "installAllScope",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "project",
	}))
	if cmdErr != nil {
		t.Fatalf("scope install all error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope install all", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "succeeded" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want two successful install results", operation)
	}
	lock, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range lock.Sources {
		if source.Commit == firstInitial || source.Commit == secondInitial {
			t.Fatalf("source=%#v did not advance before install", source)
		}
	}
	for _, root := range []string{".agents/skills/new-alpha", ".claude/skills/new-alpha", ".agents/skills/new-beta", ".claude/skills/new-beta"} {
		if _, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(root), "SKILL.md")); err != nil {
			t.Fatalf("latest Skill copy %s missing: %v", root, err)
		}
	}
}

func TestSkillsCommandScopeInstallAllSkipsFailedSource(t *testing.T) {
	workingRepository := t.TempDir()
	initSkillSourceGitFixture(t, workingRepository, "alpha")
	projectRoot := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: t.TempDir(), Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: projectRoot}
	workingSource := "https://github.com/example/working.git"
	missingSource := "https://github.com/example/missing.git"
	seedNativeSkillSourceClone(t, command, workingRepository, workingSource, "github.com/example/working")
	if err := os.MkdirAll(command.nativeStore().repositoryPath("github.com/example/missing"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{
			{Source: workingSource, SourceKey: "github.com/example/working"},
			{Source: missingSource, SourceKey: "github.com/example/missing"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "installAllScope",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "project",
	}))
	if cmdErr != nil {
		t.Fatalf("scope install all error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope install all", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "partial" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want partial results for both sources", operation)
	}
	statuses := map[string]string{}
	for _, result := range operation.Results {
		statuses[result.Skill] = result.Status
	}
	if statuses["github.com/example/working"] != "succeeded" || statuses["github.com/example/missing"] != "failed" {
		t.Fatalf("source statuses=%#v, want working succeeded and missing failed", statuses)
	}
	if _, err := os.Stat(filepath.Join(projectRoot, ".agents", "skills", "alpha", "SKILL.md")); err != nil {
		t.Fatalf("successful source was not installed: %v", err)
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

func seedNativeSkillSourceClone(t *testing.T, command *SkillsCommand, repository, source, sourceKey string) string {
	t.Helper()
	clonePath := command.nativeStore().repositoryPath(sourceKey)
	if err := os.MkdirAll(filepath.Dir(clonePath), 0o755); err != nil {
		t.Fatal(err)
	}
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)
	checkout, err := command.nativeStore().ensureRepo(context.Background(), skillSourceSnapshot{Source: source, SourceKey: sourceKey})
	if err != nil {
		t.Fatalf("seed source %s: %v", source, err)
	}
	return checkout.Commit
}
