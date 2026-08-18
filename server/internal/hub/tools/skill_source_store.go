package tools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	"github.com/swm8023/wheelmaker/internal/shared"
)

type skillSourceCheckout struct {
	Source       string
	SourceKey    string
	Branch       string
	Path         string
	Commit       string
	RemoteCommit string
	Skills       []skillSourceSkillSnapshot
}

type skillSourceStore struct {
	root string
}

func newSkillSourceStore(homeDir string) *skillSourceStore {
	homeDir = strings.TrimSpace(homeDir)
	if homeDir == "" {
		if resolved, err := os.UserHomeDir(); err == nil {
			homeDir = resolved
		}
	}
	return &skillSourceStore{root: filepath.Join(homeDir, ".wheelmaker", "skills")}
}

func (s *skillSourceStore) repositoryPath(sourceKey string) string {
	components := skillSourcePathComponents(sourceKey)
	return filepath.Join(append([]string{s.root}, components...)...)
}

func (s *skillSourceStore) legacyRepositoryPath(sourceKey string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(sourceKey))))
	return filepath.Join(s.root, hex.EncodeToString(digest[:]))
}

func (s *skillSourceStore) lockPath(sourceKey string) string {
	components := skillSourcePathComponents(sourceKey)
	if len(components) > 0 {
		components[len(components)-1] += ".lock"
	}
	return filepath.Join(append([]string{s.root, ".locks"}, components...)...)
}

func (s *skillSourceStore) legacyLockPath(sourceKey string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(sourceKey))))
	return filepath.Join(s.root, ".locks", hex.EncodeToString(digest[:])+".lock")
}

func (s *skillSourceStore) withSourceLock(ctx context.Context, sourceKey string, fn func() (skillSourceCheckout, error)) (skillSourceCheckout, error) {
	release, err := s.acquireSourceLock(ctx, sourceKey)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	defer release()
	if err := s.migrateLegacyRepository(sourceKey); err != nil {
		return skillSourceCheckout{}, err
	}
	return fn()
}

func (s *skillSourceStore) acquireSourceLock(ctx context.Context, sourceKey string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(sourceKey) == "" {
		return nil, errors.New("skill source key is required")
	}
	lockPaths := []string{s.lockPath(sourceKey)}
	legacyRepositoryPath := s.legacyRepositoryPath(sourceKey)
	legacyLockPath := s.legacyLockPath(sourceKey)
	if pathExists(legacyRepositoryPath) || pathExists(legacyLockPath) {
		lockPaths = append(lockPaths, legacyLockPath)
	}
	releases := make([]func(), 0, len(lockPaths))
	for _, lockPath := range lockPaths {
		if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
			for index := len(releases) - 1; index >= 0; index-- {
				releases[index]()
			}
			return nil, fmt.Errorf("create skill source lock directory: %w", err)
		}
		release, err := shared.AcquireFileLock(lockPath)
		if err != nil {
			for index := len(releases) - 1; index >= 0; index-- {
				releases[index]()
			}
			return nil, fmt.Errorf("lock skill source %s: %w", sourceKey, err)
		}
		releases = append(releases, release)
	}
	return func() {
		for index := len(releases) - 1; index >= 0; index-- {
			releases[index]()
		}
	}, nil
}

func (s *skillSourceStore) migrateLegacyRepository(sourceKey string) error {
	readablePath := s.repositoryPath(sourceKey)
	if _, err := os.Stat(readablePath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect skill source store: %w", err)
	}
	legacyPath := s.legacyRepositoryPath(sourceKey)
	if _, err := os.Stat(legacyPath); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return fmt.Errorf("inspect legacy skill source store: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(readablePath), 0o755); err != nil {
		return fmt.Errorf("create readable skill source store: %w", err)
	}
	if err := os.Rename(legacyPath, readablePath); err != nil {
		return fmt.Errorf("migrate legacy skill source store: %w", err)
	}
	return nil
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil || !errors.Is(err, os.ErrNotExist)
}

func skillSourcePathComponents(sourceKey string) []string {
	parts := strings.FieldsFunc(strings.ToLower(strings.TrimSpace(sourceKey)), func(r rune) bool {
		return r == '/' || r == '\\'
	})
	components := make([]string, 0, len(parts))
	for _, part := range parts {
		components = append(components, escapeSkillSourcePathComponent(part))
	}
	return components
}

func escapeSkillSourcePathComponent(value string) string {
	if value == "." || value == ".." {
		return "~" + value
	}
	var escaped strings.Builder
	for index := 0; index < len(value); index++ {
		char := value[index]
		allowed := (char >= 'a' && char <= 'z') ||
			(char >= '0' && char <= '9') ||
			char == '.' || char == '-' || char == '_' || char == '@'
		if index == len(value)-1 && (char == '.' || char == ' ') {
			allowed = false
		}
		if allowed {
			escaped.WriteByte(char)
			continue
		}
		fmt.Fprintf(&escaped, "~%02X", char)
	}
	if escaped.Len() == 0 {
		return "~00"
	}
	component := escaped.String()
	if isWindowsReservedSkillPathComponent(component) {
		return "~" + component
	}
	return component
}

func isWindowsReservedSkillPathComponent(value string) bool {
	upper := strings.ToUpper(value)
	switch upper {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	if len(upper) == 4 && (strings.HasPrefix(upper, "COM") || strings.HasPrefix(upper, "LPT")) {
		return upper[3] >= '1' && upper[3] <= '9'
	}
	return false
}

func (s *skillSourceStore) ensureRepo(ctx context.Context, source skillSourceSnapshot) (skillSourceCheckout, error) {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	return s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		return s.ensureRepoLocked(ctx, address, sourceKey)
	})
}

func (s *skillSourceStore) ensureRepoLocked(ctx context.Context, address, sourceKey string) (skillSourceCheckout, error) {
	path := s.repositoryPath(sourceKey)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return skillSourceCheckout{}, fmt.Errorf("create skill source store: %w", err)
		}
		if _, err := runSkillSourceGitCommand(ctx, "", "clone", "--quiet", "--", address, path); err != nil {
			_ = os.RemoveAll(path)
			return skillSourceCheckout{}, fmt.Errorf("clone skill source: %w", err)
		}
	} else if err != nil {
		return skillSourceCheckout{}, fmt.Errorf("inspect skill source clone: %w", err)
	}
	if err := s.validateClone(ctx, path); err != nil {
		return skillSourceCheckout{}, err
	}
	return s.readCheckout(ctx, path, address, sourceKey)
}

func (s *skillSourceStore) withEnsuredRepo(ctx context.Context, source skillSourceSnapshot, fn func(skillSourceCheckout) error) error {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return err
	}
	_, err = s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		checkout, err := s.ensureRepoLocked(ctx, address, sourceKey)
		if err != nil {
			return skillSourceCheckout{}, err
		}
		return skillSourceCheckout{}, fn(checkout)
	})
	return err
}

func (s *skillSourceStore) withUpdatedRepo(ctx context.Context, source skillSourceSnapshot, fn func(skillSourceCheckout) error) error {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return err
	}
	_, err = s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		checkout, err := s.updateRepoLocked(ctx, address, sourceKey)
		if err != nil {
			return skillSourceCheckout{}, err
		}
		return skillSourceCheckout{}, fn(checkout)
	})
	return err
}

func (s *skillSourceStore) inspectRepo(ctx context.Context, source skillSourceSnapshot) (skillSourceCheckout, error) {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	return s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		return s.inspectRepoLocked(ctx, address, sourceKey)
	})
}

func (s *skillSourceStore) withInspectedRepo(ctx context.Context, source skillSourceSnapshot, fn func(skillSourceCheckout) error) error {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return err
	}
	_, err = s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		checkout, err := s.inspectRepoLocked(ctx, address, sourceKey)
		if err != nil {
			return skillSourceCheckout{}, err
		}
		return skillSourceCheckout{}, fn(checkout)
	})
	return err
}

func (s *skillSourceStore) inspectRepoLocked(ctx context.Context, address, sourceKey string) (skillSourceCheckout, error) {
	checkout, err := s.ensureRepoLocked(ctx, address, sourceKey)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	if _, err := runSkillSourceGitCommand(ctx, checkout.Path, "fetch", "--quiet", "--prune", "origin"); err != nil {
		return skillSourceCheckout{}, fmt.Errorf("fetch skill source: %w", err)
	}
	if err := refreshSkillSourceRemoteHead(ctx, checkout.Path); err != nil {
		return skillSourceCheckout{}, err
	}
	return s.readCheckout(ctx, checkout.Path, address, sourceKey)
}

func (s *skillSourceStore) updateRepoLocked(ctx context.Context, address, sourceKey string) (skillSourceCheckout, error) {
	path, err := s.ensureExistingClone(ctx, sourceKey, address)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	if err := ensureSkillSourceCheckoutClean(ctx, path); err != nil {
		return skillSourceCheckout{}, err
	}
	if _, err := runSkillSourceGitCommand(ctx, path, "fetch", "--quiet", "--prune", "origin"); err != nil {
		return skillSourceCheckout{}, fmt.Errorf("fetch skill source: %w", err)
	}
	if err := refreshSkillSourceRemoteHead(ctx, path); err != nil {
		return skillSourceCheckout{}, err
	}
	branch, remoteRef, err := resolveSkillSourceDefaultBranch(ctx, path)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	if _, err := runSkillSourceGitCommand(ctx, path, "checkout", "--quiet", "--detach", remoteRef); err != nil {
		return skillSourceCheckout{}, fmt.Errorf("checkout skill source default branch: %w", err)
	}
	checkout, err := s.readCheckout(ctx, path, address, sourceKey)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	checkout.Branch = branch
	return checkout, nil
}

func (s *skillSourceStore) readRepo(ctx context.Context, source skillSourceSnapshot) (skillSourceCheckout, error) {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	return s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		path := s.repositoryPath(sourceKey)
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			return skillSourceCheckout{}, errors.New("skill source clone is missing")
		} else if err != nil {
			return skillSourceCheckout{}, fmt.Errorf("inspect skill source clone: %w", err)
		}
		if err := s.validateClone(ctx, path); err != nil {
			return skillSourceCheckout{}, err
		}
		return s.readCheckout(ctx, path, address, sourceKey)
	})
}

func (s *skillSourceStore) refreshRepo(ctx context.Context, source skillSourceSnapshot) (skillSourceCheckout, error) {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	return s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		path, err := s.ensureExistingClone(ctx, sourceKey, address)
		if err != nil {
			return skillSourceCheckout{}, err
		}
		if _, err := runSkillSourceGitCommand(ctx, path, "fetch", "--quiet", "--prune", "origin"); err != nil {
			return skillSourceCheckout{}, fmt.Errorf("fetch skill source: %w", err)
		}
		if err := refreshSkillSourceRemoteHead(ctx, path); err != nil {
			return skillSourceCheckout{}, err
		}
		return s.readCheckout(ctx, path, address, sourceKey)
	})
}

func (s *skillSourceStore) updateRepo(ctx context.Context, source skillSourceSnapshot) (skillSourceCheckout, error) {
	address, sourceKey, err := skillSourceStoreInput(source)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	return s.withSourceLock(ctx, sourceKey, func() (skillSourceCheckout, error) {
		return s.updateRepoLocked(ctx, address, sourceKey)
	})
}

func (s *skillSourceStore) ensureExistingClone(ctx context.Context, sourceKey, address string) (string, error) {
	path := s.repositoryPath(sourceKey)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return "", fmt.Errorf("create skill source store: %w", err)
		}
		if _, err := runSkillSourceGitCommand(ctx, "", "clone", "--quiet", "--", address, path); err != nil {
			_ = os.RemoveAll(path)
			return "", fmt.Errorf("clone skill source: %w", err)
		}
	} else if err != nil {
		return "", fmt.Errorf("inspect skill source clone: %w", err)
	}
	if err := s.validateClone(ctx, path); err != nil {
		return "", err
	}
	return path, nil
}

func refreshSkillSourceRemoteHead(ctx context.Context, checkout string) error {
	if _, err := runSkillSourceGitCommand(ctx, checkout, "remote", "set-head", "origin", "--auto"); err != nil {
		// Some Git remotes do not advertise a symbolic HEAD. Preserve a usable
		// cached remote HEAD in that case; a remote that does advertise one is
		// refreshed authoritatively by the command above.
		if _, cachedErr := runSkillSourceGitCommand(ctx, checkout, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"); cachedErr == nil {
			return nil
		}
		return fmt.Errorf("resolve skill source remote default branch: %w", err)
	}
	return nil
}

func (s *skillSourceStore) validateClone(ctx context.Context, path string) error {
	if _, err := runSkillSourceGitCommand(ctx, path, "rev-parse", "--git-dir"); err != nil {
		return fmt.Errorf("skill source store entry is not a Git clone: %w", err)
	}
	return nil
}

func (s *skillSourceStore) readCheckout(ctx context.Context, path, address, sourceKey string) (skillSourceCheckout, error) {
	branch, remoteRef, branchErr := resolveSkillSourceDefaultBranch(ctx, path)
	if branchErr != nil {
		return skillSourceCheckout{}, branchErr
	}
	commitOutput, err := runSkillSourceGitCommand(ctx, path, "rev-parse", "--verify", "HEAD^{commit}")
	if err != nil {
		return skillSourceCheckout{}, fmt.Errorf("resolve skill source checkout commit: %w", err)
	}
	commit := strings.TrimSpace(commitOutput)
	if !validSkillSourceCommit(commit) {
		return skillSourceCheckout{}, errors.New("skill source checkout commit is invalid")
	}
	remoteOutput, err := runSkillSourceGitCommand(ctx, path, "rev-parse", "--verify", remoteRef+"^{commit}")
	if err != nil {
		remoteOutput = commit
	}
	remoteCommit := strings.TrimSpace(remoteOutput)
	if !validSkillSourceCommit(remoteCommit) {
		remoteCommit = commit
	}
	skills, err := discoverSkillSourceCatalog(path)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	return skillSourceCheckout{
		Source: address, SourceKey: sourceKey, Branch: branch, Path: path,
		Commit: commit, RemoteCommit: remoteCommit, Skills: skills,
	}, nil
}

func resolveSkillSourceDefaultBranch(ctx context.Context, checkout string) (string, string, error) {
	remoteHead, err := runSkillSourceGitCommand(ctx, checkout, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
	if err == nil {
		ref := strings.TrimSpace(remoteHead)
		if strings.HasPrefix(ref, "refs/remotes/origin/") {
			branch := strings.TrimPrefix(ref, "refs/remotes/origin/")
			if branch != "" {
				return branch, "origin/" + branch, nil
			}
		}
	}
	current, currentErr := runSkillSourceGitCommand(ctx, checkout, "symbolic-ref", "--quiet", "--short", "HEAD")
	if currentErr == nil {
		branch := strings.TrimSpace(current)
		if branch != "" && !strings.Contains(branch, " ") {
			return branch, "origin/" + branch, nil
		}
	}
	refs, refsErr := runSkillSourceGitCommand(ctx, checkout, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
	if refsErr != nil {
		return "", "", errors.New("skill source remote default branch was not found")
	}
	var candidates []string
	for _, line := range strings.Split(refs, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "origin/") && line != "origin/HEAD" {
			candidates = append(candidates, strings.TrimPrefix(line, "origin/"))
		}
	}
	if len(candidates) == 0 {
		return "", "", errors.New("skill source remote default branch was not found")
	}
	sort.Strings(candidates)
	return candidates[0], "origin/" + candidates[0], nil
}

func ensureSkillSourceCheckoutClean(ctx context.Context, path string) error {
	output, err := runSkillSourceGitCommand(ctx, path, "status", "--porcelain", "--untracked-files=all")
	if err != nil {
		return fmt.Errorf("inspect skill source checkout: %w", err)
	}
	if strings.TrimSpace(output) != "" {
		return errors.New("skill source checkout is dirty; commit or remove local changes before updating")
	}
	return nil
}

func skillSourceStoreInput(source skillSourceSnapshot) (string, string, error) {
	address := strings.TrimSpace(source.Source)
	if address == "" {
		return "", "", errors.New("skill source is required")
	}
	key := strings.ToLower(strings.TrimSpace(source.SourceKey))
	if key == "" {
		_, key, _ = normalizeSkillGitSource(address)
		if key == "" {
			return "", "", errors.New("skill source key is required")
		}
	}
	return address, key, nil
}

func validSkillSourceCommit(commit string) bool {
	return len(commit) >= 40 && len(commit) <= 64 && skillSourceHexPattern.MatchString(strings.ToLower(commit))
}

func copySkillDirectory(source, target string) error {
	source, err := filepath.Abs(source)
	if err != nil {
		return fmt.Errorf("resolve skill source directory: %w", err)
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return fmt.Errorf("resolve skill target directory: %w", err)
	}
	info, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("inspect skill source directory: %w", err)
	}
	if !info.IsDir() {
		return errors.New("skill source path is not a directory")
	}
	if _, err := os.Lstat(target); err == nil {
		return fmt.Errorf("skill target already exists: %s", target)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect skill target: %w", err)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return fmt.Errorf("create skill target directory: %w", err)
	}
	if err := filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		destination := filepath.Join(target, relative)
		if entry.Type()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(path)
			if err != nil {
				return err
			}
			inside, err := filepath.Rel(source, resolved)
			if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) || filepath.IsAbs(inside) {
				return fmt.Errorf("skill source symlink escapes its root: %s", relative)
			}
			resolvedInfo, err := os.Stat(resolved)
			if err != nil {
				return err
			}
			if resolvedInfo.IsDir() {
				return fmt.Errorf("skill source directory symlink is unsupported: %s", relative)
			}
			return copySkillFile(resolved, destination, resolvedInfo.Mode())
		}
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		return copySkillFile(path, destination, info.Mode())
	}); err != nil {
		_ = os.RemoveAll(target)
		return fmt.Errorf("copy skill directory: %w", err)
	}
	return nil
}

func copySkillFile(source, target string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode.Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	return nil
}

func createSkillDirectoryLink(source, target string) error {
	if _, err := os.Lstat(target); err == nil {
		return fmt.Errorf("skill target already exists: %s", target)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect skill link target: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("create skill link parent: %w", err)
	}
	if err := agent.CreateDirectoryLink(source, target); err != nil {
		return fmt.Errorf("link skill directory: %w", err)
	}
	return nil
}
