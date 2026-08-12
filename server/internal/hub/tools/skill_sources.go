package tools

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	skillSourceLockVersion     = 1
	skillSourceHashAlgorithm   = "sha256-v1"
	skillSourceMissingRevision = "missing"
)

var (
	errSkillSourceLockChanged = errors.New("skill source lock changed")
	skillSourceSCPPattern     = regexp.MustCompile(`^([^@\s]+@)?([^:\s/]+):(.+)$`)
	skillSourceHexPattern     = regexp.MustCompile(`^[0-9a-f]+$`)
)

type skillSourceLock struct {
	Version       int                   `json:"version"`
	HashAlgorithm string                `json:"hashAlgorithm"`
	Sources       []skillSourceSnapshot `json:"sources"`
}

type skillSourceSnapshot struct {
	Source         string                     `json:"source"`
	SourceKey      string                     `json:"sourceKey"`
	Ref            string                     `json:"ref"`
	ResolvedCommit string                     `json:"resolvedCommit,omitempty"`
	RefreshedAt    string                     `json:"refreshedAt,omitempty"`
	SkillList      []skillSourceSkillSnapshot `json:"skillList"`
}

type skillSourceSkillSnapshot struct {
	Name          string `json:"name"`
	SkillPath     string `json:"skillPath"`
	ContentSHA256 string `json:"contentSha256"`
}

func skillSourceLockPath(projectRoot, globalLockPath, homeDir string) string {
	if projectRoot = strings.TrimSpace(projectRoot); projectRoot != "" {
		return filepath.Join(projectRoot, ".skill-source-lock.json")
	}
	if globalLockPath = strings.TrimSpace(globalLockPath); globalLockPath != "" {
		return filepath.Join(filepath.Dir(globalLockPath), ".skill-source-lock.json")
	}
	if stateHome := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); stateHome != "" {
		return filepath.Join(stateHome, "skills", ".skill-source-lock.json")
	}
	if homeDir = strings.TrimSpace(homeDir); homeDir == "" {
		resolved, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		homeDir = resolved
	}
	return filepath.Join(homeDir, ".agents", ".skill-source-lock.json")
}

func normalizeSkillGitSource(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", errors.New("skill source is required")
	}
	if len(raw) >= 3 && raw[1] == ':' && (raw[2] == '/' || raw[2] == '\\') {
		return "", "", errors.New("local skill sources are unsupported")
	}
	if skillSourceRepoPattern.MatchString(raw) {
		raw = "https://github.com/" + raw + ".git"
	}

	if match := skillSourceSCPPattern.FindStringSubmatch(raw); len(match) == 4 && !strings.Contains(raw, "://") {
		host := strings.ToLower(strings.TrimSpace(match[2]))
		repoPath, keyPath, err := normalizeSkillRepositoryPath(match[3])
		if err != nil {
			return "", "", err
		}
		return match[1] + host + ":" + repoPath, host + "/" + strings.ToLower(keyPath), nil
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return "", "", errors.New("skill source must be a remote Git repository")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && scheme != "http" && scheme != "ssh" {
		return "", "", errors.New("unsupported skill source scheme")
	}
	if (scheme == "https" || scheme == "http") && parsed.User != nil {
		return "", "", errors.New("HTTP skill source must not contain credentials")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", "", errors.New("skill source must not contain query or fragment data")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", "", errors.New("skill source host is required")
	}
	repoPath, keyPath, err := normalizeSkillRepositoryPath(parsed.EscapedPath())
	if err != nil {
		return "", "", err
	}
	parsed.Scheme = scheme
	parsed.Host = host
	if port := parsed.Port(); port != "" {
		parsed.Host += ":" + port
	}
	parsed.Path = "/" + repoPath
	parsed.RawPath = ""
	return parsed.String(), host + "/" + strings.ToLower(keyPath), nil
}

func normalizeSkillRepositoryPath(raw string) (string, string, error) {
	decoded, err := url.PathUnescape(strings.TrimSpace(raw))
	if err != nil {
		return "", "", errors.New("skill source path is invalid")
	}
	value := strings.Trim(strings.ReplaceAll(decoded, "\\", "/"), "/")
	if strings.ContainsRune(value, '\x00') || value == "" {
		return "", "", errors.New("skill source repository path is required")
	}
	parts := strings.Split(value, "/")
	if len(parts) < 2 {
		return "", "", errors.New("skill source must identify a repository")
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", "", errors.New("skill source repository path is invalid")
		}
	}
	keyPath := strings.TrimSuffix(value, ".git")
	if keyPath == "" || strings.HasSuffix(keyPath, "/") {
		return "", "", errors.New("skill source repository path is invalid")
	}
	return keyPath + ".git", keyPath, nil
}

type skillSourceHashFile struct {
	path string
	raw  []byte
}

func hashSkillDirectory(root string) (string, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve skill root: %w", err)
	}
	root = filepath.Clean(root)
	var files []skillSourceHashFile
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		normalized := filepath.ToSlash(relative)
		if normalized == ".git" || strings.HasPrefix(normalized, ".git/") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(path)
			if err != nil {
				return fmt.Errorf("resolve skill symlink %q: %w", normalized, err)
			}
			inside, err := filepath.Rel(root, resolved)
			if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) || filepath.IsAbs(inside) {
				return fmt.Errorf("skill symlink %q escapes its root", normalized)
			}
			info, err := os.Stat(resolved)
			if err != nil {
				return err
			}
			if info.IsDir() {
				return fmt.Errorf("skill directory symlink %q is unsupported", normalized)
			}
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() && entry.Type()&os.ModeSymlink == 0 {
			return fmt.Errorf("skill entry %q is not a regular file", normalized)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read skill file %q: %w", normalized, err)
		}
		files = append(files, skillSourceHashFile{path: normalized, raw: raw})
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })
	hasher := sha256.New()
	var length [8]byte
	for _, file := range files {
		binary.BigEndian.PutUint64(length[:], uint64(len(file.path)))
		_, _ = hasher.Write(length[:])
		_, _ = hasher.Write([]byte(file.path))
		binary.BigEndian.PutUint64(length[:], uint64(len(file.raw)))
		_, _ = hasher.Write(length[:])
		_, _ = hasher.Write(file.raw)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func newSkillSourceLock() skillSourceLock {
	return skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm, Sources: []skillSourceSnapshot{}}
}

func readSkillSourceLockFile(path string) (skillSourceLock, string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newSkillSourceLock(), skillSourceMissingRevision, nil
	}
	if err != nil {
		return skillSourceLock{}, "", fmt.Errorf("read skill source lock: %w", err)
	}
	lock, err := decodeSkillSourceLock(raw)
	if err != nil {
		return skillSourceLock{}, "", err
	}
	return lock, skillSourceRevision(raw), nil
}

func decodeSkillSourceLock(raw []byte) (skillSourceLock, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var lock skillSourceLock
	if err := decoder.Decode(&lock); err != nil {
		return skillSourceLock{}, fmt.Errorf("decode skill source lock: %w", err)
	}
	if decoder.More() {
		return skillSourceLock{}, errors.New("decode skill source lock: trailing data")
	}
	if err := validateSkillSourceLock(lock); err != nil {
		return skillSourceLock{}, err
	}
	sortSkillSourceLock(&lock)
	return lock, nil
}

func validateSkillSourceLock(lock skillSourceLock) error {
	if lock.Version != skillSourceLockVersion {
		return fmt.Errorf("unsupported skill source lock version %d", lock.Version)
	}
	if lock.HashAlgorithm != skillSourceHashAlgorithm {
		return fmt.Errorf("unsupported skill source hash algorithm %q", lock.HashAlgorithm)
	}
	seenSources := map[string]struct{}{}
	for _, source := range lock.Sources {
		normalizedSource, normalizedKey, err := normalizeSkillGitSource(source.Source)
		if err != nil {
			return fmt.Errorf("invalid skill source %q: %w", source.SourceKey, err)
		}
		if normalizedSource != source.Source || normalizedKey != strings.ToLower(strings.TrimSpace(source.SourceKey)) {
			return fmt.Errorf("skill source %q is not normalized", source.SourceKey)
		}
		key := strings.ToLower(source.SourceKey)
		if _, exists := seenSources[key]; exists {
			return fmt.Errorf("duplicate skill source %q", source.SourceKey)
		}
		seenSources[key] = struct{}{}
		if strings.TrimSpace(source.Ref) == "" || strings.HasPrefix(source.Ref, "-") || strings.ContainsAny(source.Ref, "\x00\r\n") {
			return fmt.Errorf("skill source %q has invalid ref", source.SourceKey)
		}
		if source.ResolvedCommit != "" && (len(source.ResolvedCommit) < 40 || len(source.ResolvedCommit) > 64 || !skillSourceHexPattern.MatchString(source.ResolvedCommit)) {
			return fmt.Errorf("skill source %q has invalid resolved commit", source.SourceKey)
		}
		if source.RefreshedAt != "" {
			if _, err := time.Parse(time.RFC3339, source.RefreshedAt); err != nil {
				return fmt.Errorf("skill source %q has invalid refreshed time", source.SourceKey)
			}
		}
		if (source.ResolvedCommit == "") != (source.RefreshedAt == "") {
			return fmt.Errorf("skill source %q has incomplete refresh metadata", source.SourceKey)
		}
		seenSkills := map[string]struct{}{}
		for _, skill := range source.SkillList {
			nameKey := strings.ToLower(strings.TrimSpace(skill.Name))
			if !skillNamePattern.MatchString(skill.Name) || nameKey == "" {
				return fmt.Errorf("skill source %q has invalid skill name %q", source.SourceKey, skill.Name)
			}
			if _, exists := seenSkills[nameKey]; exists {
				return fmt.Errorf("skill source %q has duplicate skill %q", source.SourceKey, skill.Name)
			}
			seenSkills[nameKey] = struct{}{}
			path := strings.ReplaceAll(strings.TrimSpace(skill.SkillPath), "\\", "/")
			if path != skill.SkillPath || strings.HasPrefix(path, "/") || filepath.IsAbs(path) || !strings.HasSuffix(path, "/SKILL.md") && path != "SKILL.md" {
				return fmt.Errorf("skill source %q has invalid skill path %q", source.SourceKey, skill.SkillPath)
			}
			for _, part := range strings.Split(path, "/") {
				if part == "" || part == "." || part == ".." {
					return fmt.Errorf("skill source %q has unsafe skill path %q", source.SourceKey, skill.SkillPath)
				}
			}
			if len(skill.ContentSHA256) != 64 || !skillSourceHexPattern.MatchString(skill.ContentSHA256) {
				return fmt.Errorf("skill source %q has invalid content hash for %q", source.SourceKey, skill.Name)
			}
		}
	}
	return nil
}

func sortSkillSourceLock(lock *skillSourceLock) {
	if lock.Sources == nil {
		lock.Sources = []skillSourceSnapshot{}
	}
	sort.Slice(lock.Sources, func(i, j int) bool {
		return strings.ToLower(lock.Sources[i].SourceKey) < strings.ToLower(lock.Sources[j].SourceKey)
	})
	for index := range lock.Sources {
		if lock.Sources[index].SkillList == nil {
			lock.Sources[index].SkillList = []skillSourceSkillSnapshot{}
		}
		sort.Slice(lock.Sources[index].SkillList, func(i, j int) bool {
			return strings.ToLower(lock.Sources[index].SkillList[i].Name) < strings.ToLower(lock.Sources[index].SkillList[j].Name)
		})
	}
}

func encodeSkillSourceLock(lock skillSourceLock) ([]byte, error) {
	if err := validateSkillSourceLock(lock); err != nil {
		return nil, err
	}
	sortSkillSourceLock(&lock)
	raw, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode skill source lock: %w", err)
	}
	return append(raw, '\n'), nil
}

func writeSkillSourceLockFile(path, expectedRevision string, lock skillSourceLock) (string, error) {
	raw, err := encodeSkillSourceLock(lock)
	if err != nil {
		return "", err
	}
	if err := ensureSkillSourceRevision(path, expectedRevision); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("create skill source lock directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".skill-source-lock-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create temporary skill source lock: %w", err)
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return "", fmt.Errorf("secure temporary skill source lock: %w", err)
	}
	if _, err := temporary.Write(raw); err != nil {
		return "", fmt.Errorf("write temporary skill source lock: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return "", fmt.Errorf("flush temporary skill source lock: %w", err)
	}
	if err := temporary.Close(); err != nil {
		closed = true
		return "", fmt.Errorf("close temporary skill source lock: %w", err)
	}
	closed = true
	if err := ensureSkillSourceRevision(path, expectedRevision); err != nil {
		return "", err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return "", fmt.Errorf("replace skill source lock: %w", err)
	}
	return skillSourceRevision(raw), nil
}

func ensureSkillSourceRevision(path, expected string) error {
	raw, err := os.ReadFile(path)
	current := ""
	switch {
	case errors.Is(err, os.ErrNotExist):
		current = skillSourceMissingRevision
	case err != nil:
		return fmt.Errorf("read current skill source lock: %w", err)
	default:
		current = skillSourceRevision(raw)
	}
	if current != expected {
		return errSkillSourceLockChanged
	}
	return nil
}

func skillSourceRevision(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
