package tools

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	skillSourceLockVersion     = 3
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
	HashAlgorithm string                `json:"-"` // Legacy V2 compatibility; never written in V3.
	Sources       []skillSourceSnapshot `json:"sources"`
}

type skillSourceSnapshot struct {
	Source          string   `json:"source"`
	SourceKey       string   `json:"sourceKey"`
	Branch          string   `json:"branch,omitempty"`
	Commit          string   `json:"commit,omitempty"`
	UpdatedAt       string   `json:"updatedAt,omitempty"`
	ManagedSkills   []string `json:"managedSkills"`
	RemoteCommit    string   `json:"-"`
	UpdateAvailable bool     `json:"-"`
	Status          string   `json:"-"`
	Error           string   `json:"-"`

	// These fields are retained as in-memory compatibility aliases while the
	// source catalog is migrated away from the V2 lock shape.
	ResolvedCommit string                     `json:"-"`
	RefreshedAt    string                     `json:"-"`
	SkillList      []skillSourceSkillSnapshot `json:"-"`
}

type skillSourceSkillSnapshot struct {
	Name          string `json:"name"`
	SkillPath     string `json:"skillPath"`
	ContentSHA256 string `json:"contentSha256"`
}

type skillSourceMigrationResult struct {
	Lock                  skillSourceLock
	Revision              string
	Migrated              bool
	NeedsResolutionSkills []string
	UnmanagedSkills       []string
}

type nativeSkillSourceEntry struct {
	Name       string
	Source     string
	SourceURL  string
	SourceType string
}

type nativeSkillSourceGroup struct {
	SourceKey string
	Sources   map[string]struct{}
	Skills    []string
}

func skillSourceLockPath(projectRoot, globalLockPath, homeDir string) string {
	if projectRoot = strings.TrimSpace(projectRoot); projectRoot != "" {
		return filepath.Join(projectRoot, ".skill-source-lock.json")
	}
	if homeDir = strings.TrimSpace(homeDir); homeDir == "" {
		resolved, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		homeDir = resolved
	}
	return filepath.Join(homeDir, ".wheelmaker", "skills", ".skill-source-lock.json")
}

// ManagedSkillNamesForScope returns ownership declared by the canonical source
// lock. Legacy native skills locks are intentionally not consulted.
func ManagedSkillNamesForScope(projectRoot, homeDir string) map[string]bool {
	projectRoot = strings.TrimSpace(projectRoot)
	nativeLockPath := ""
	if projectRoot != "" {
		nativeLockPath = filepath.Join(projectRoot, "skills-lock.json")
	} else {
		nativeLockPath = defaultGlobalSkillsLockPath(homeDir)
	}
	installed := map[string]struct{}{}
	if projectRoot != "" {
		for _, directory := range []string{filepath.Join(projectRoot, ".agents", "skills"), filepath.Join(projectRoot, ".claude", "skills")} {
			collectSkillDirectoryNames(directory, installed)
		}
	} else {
		home := strings.TrimSpace(homeDir)
		if home == "" {
			home, _ = os.UserHomeDir()
		}
		for _, directory := range []string{filepath.Join(home, ".agents", "skills"), filepath.Join(home, ".claude", "skills")} {
			collectSkillDirectoryNames(directory, installed)
		}
	}
	path := skillSourceLockPath(projectRoot, nativeLockPath, homeDir)
	var migration skillSourceMigrationResult
	err := withSkillSourceLockFile(path, func() error {
		var err error
		migration, err = readOrMigrateSkillSourceLockWithInstalled(nativeLockPath, path, installed)
		return err
	})
	if err != nil {
		return map[string]bool{}
	}
	out := map[string]bool{}
	for _, source := range migration.Lock.Sources {
		for _, name := range source.ManagedSkills {
			if name = strings.TrimSpace(name); name != "" {
				out[strings.ToLower(name)] = true
			}
		}
	}
	return out
}

func withSkillSourceLockFile(path string, fn func() error) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("skill source lock path is unavailable")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	release, err := shared.AcquireFileLock(path + ".lock")
	if err != nil {
		return err
	}
	defer release()
	return fn()
}

func collectSkillDirectoryNames(directory string, names map[string]struct{}) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || validateSkillNames([]string{entry.Name()}) != nil {
			continue
		}
		if info, err := os.Stat(filepath.Join(directory, entry.Name(), "SKILL.md")); err == nil && !info.IsDir() {
			names[strings.ToLower(entry.Name())] = struct{}{}
		}
	}
}

func readOrMigrateSkillSourceLock(nativeLockPath, sourceLockPath string) (skillSourceMigrationResult, error) {
	return readOrMigrateSkillSourceLockWithInstalled(nativeLockPath, sourceLockPath, nil)
}

func readOrMigrateSkillSourceLockWithInstalled(nativeLockPath, sourceLockPath string, installed map[string]struct{}) (skillSourceMigrationResult, error) {
	canonicalPath := strings.TrimSpace(sourceLockPath)
	if canonicalPath == "" {
		return skillSourceMigrationResult{}, errors.New("skill source lock path is unavailable")
	}
	readPath := canonicalPath
	canonicalExists := false
	if _, err := os.Stat(readPath); err == nil {
		canonicalExists = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return skillSourceMigrationResult{}, fmt.Errorf("stat skill source lock: %w", err)
	}
	if !canonicalExists {
		legacyPath := legacySkillSourceLockPath(nativeLockPath, canonicalPath)
		if legacyPath != "" {
			if _, legacyErr := os.Stat(legacyPath); legacyErr == nil {
				readPath = legacyPath
			} else if !errors.Is(legacyErr, os.ErrNotExist) {
				return skillSourceMigrationResult{}, fmt.Errorf("stat legacy skill source lock: %w", legacyErr)
			}
		}
		if readPath == canonicalPath {
			return skillSourceMigrationResult{Lock: newSkillSourceLock(), Revision: skillSourceMissingRevision}, nil
		}
	}
	lock, revision, rebuild, err := readSkillSourceLockForRebuild(readPath)
	if err != nil {
		return skillSourceMigrationResult{}, err
	}
	result := skillSourceMigrationResult{
		Lock:     lock,
		Revision: revision,
	}
	if rebuild {
		lock, err = migrateSkillSourceLockToV3(lock, installed)
		if err != nil {
			return skillSourceMigrationResult{}, err
		}
		writeExpected := skillSourceMissingRevision
		if readPath == canonicalPath {
			writeExpected = revision
		}
		updatedRevision, err := writeSkillSourceLockFile(canonicalPath, writeExpected, lock)
		if err != nil {
			return skillSourceMigrationResult{}, err
		}
		result.Lock = lock
		result.Revision = updatedRevision
		result.Migrated = true
	}
	return result, nil
}

func legacySkillSourceLockPath(nativeLockPath, canonicalPath string) string {
	nativeLockPath = strings.TrimSpace(nativeLockPath)
	canonicalPath = strings.TrimSpace(canonicalPath)
	if nativeLockPath == "" || canonicalPath == "" {
		return ""
	}
	legacy := filepath.Join(filepath.Dir(nativeLockPath), ".skill-source-lock.json")
	if samePath(legacy, canonicalPath) {
		return ""
	}
	return legacy
}

func samePath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return filepath.Clean(left) == filepath.Clean(right)
	}
	return strings.EqualFold(filepath.Clean(leftAbs), filepath.Clean(rightAbs))
}

func readNativeSkillSourceEntries(path string) []nativeSkillSourceEntry {
	entries, _ := loadNativeSkillSourceEntries(path)
	return entries
}

func loadNativeSkillSourceEntries(path string) ([]nativeSkillSourceEntry, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read native skill lock: %w", err)
	}
	var body struct {
		Skills map[string]struct {
			Source     string `json:"source"`
			SourceURL  string `json:"sourceUrl"`
			SourceType string `json:"sourceType"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("decode native skill lock: %w", err)
	}
	names := make([]string, 0, len(body.Skills))
	for name := range body.Skills {
		names = append(names, name)
	}
	sort.Strings(names)
	entries := make([]nativeSkillSourceEntry, 0, len(names))
	for _, name := range names {
		value := body.Skills[name]
		entries = append(entries, nativeSkillSourceEntry{
			Name:       strings.TrimSpace(name),
			Source:     strings.TrimSpace(value.Source),
			SourceURL:  strings.TrimSpace(value.SourceURL),
			SourceType: strings.ToLower(strings.TrimSpace(value.SourceType)),
		})
	}
	return entries, nil
}

func classifyNativeSkillSourceEntries(entries []nativeSkillSourceEntry) ([]nativeSkillSourceGroup, []string) {
	grouped := map[string]*nativeSkillSourceGroup{}
	var unmanaged []string
	for _, entry := range entries {
		if entry.Name == "" {
			continue
		}
		if entry.SourceType == "local" || entry.SourceType == "node_modules" {
			unmanaged = append(unmanaged, entry.Name)
			continue
		}
		address := entry.SourceURL
		if address == "" {
			address = entry.Source
		}
		normalizedSource, sourceKey, err := normalizeSkillGitSource(address)
		if err != nil {
			unmanaged = append(unmanaged, entry.Name)
			continue
		}
		group := grouped[sourceKey]
		if group == nil {
			group = &nativeSkillSourceGroup{
				SourceKey: sourceKey,
				Sources:   map[string]struct{}{},
			}
			grouped[sourceKey] = group
		}
		group.Sources[normalizedSource] = struct{}{}
		group.Skills = append(group.Skills, entry.Name)
	}
	keys := make([]string, 0, len(grouped))
	for key := range grouped {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	groups := make([]nativeSkillSourceGroup, 0, len(keys))
	for _, key := range keys {
		group := *grouped[key]
		sort.Strings(group.Skills)
		groups = append(groups, group)
	}
	sort.Strings(unmanaged)
	return groups, unmanaged
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
		user := strings.TrimSuffix(strings.TrimSpace(match[1]), "@")
		normalizedUser := ""
		sourceUser := ""
		if user != "" {
			sourceUser = user + "@"
		}
		keyHost := host
		if user != "" && !strings.EqualFold(user, "git") {
			normalizedUser = strings.ToLower(user) + "@"
			keyHost = normalizedUser + keyHost
		}
		return sourceUser + host + ":" + repoPath, keyHost + "/" + strings.ToLower(keyPath), nil
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
	port := parsed.Port()
	repoPath, keyPath, err := normalizeSkillRepositoryPath(parsed.EscapedPath())
	if err != nil {
		return "", "", err
	}
	parsed.Scheme = scheme
	parsed.Host = host
	if port != "" {
		parsed.Host += ":" + port
	}
	parsed.Path = "/" + repoPath
	parsed.RawPath = ""
	keyHost := host
	if port != "" {
		keyHost += ":" + port
	}
	if scheme == "ssh" && parsed.User != nil {
		user := strings.TrimSpace(parsed.User.Username())
		if user != "" && !strings.EqualFold(user, "git") {
			keyHost = strings.ToLower(user) + "@" + keyHost
		}
	}
	return parsed.String(), keyHost + "/" + strings.ToLower(keyPath), nil
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

func readSkillSourceLockForRebuild(path string) (skillSourceLock, string, bool, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newSkillSourceLock(), skillSourceMissingRevision, true, nil
	}
	if err != nil {
		return skillSourceLock{}, "", false, fmt.Errorf("read skill source lock: %w", err)
	}
	var envelope struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return skillSourceLock{}, "", false, fmt.Errorf("decode skill source lock: %w", err)
	}
	revision := skillSourceRevision(raw)
	if envelope.Version == 1 {
		return newSkillSourceLock(), revision, true, nil
	}
	lock, err := decodeSkillSourceLock(raw)
	if err != nil {
		return skillSourceLock{}, "", false, err
	}
	return lock, revision, lock.Version != skillSourceLockVersion, nil
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
	var envelope struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return skillSourceLock{}, fmt.Errorf("decode skill source lock: %w", err)
	}
	switch envelope.Version {
	case 2:
		var legacy skillSourceLockV2Wire
		if err := decodeStrictSkillJSON(raw, &legacy); err != nil {
			return skillSourceLock{}, fmt.Errorf("decode skill source lock: %w", err)
		}
		lock := skillSourceLock{Version: 2, HashAlgorithm: legacy.HashAlgorithm, Sources: make([]skillSourceSnapshot, 0, len(legacy.Sources))}
		for _, source := range legacy.Sources {
			lock.Sources = append(lock.Sources, skillSourceSnapshot{
				Source: source.Source, SourceKey: source.SourceKey,
				ResolvedCommit: source.ResolvedCommit, RefreshedAt: source.RefreshedAt,
				SkillList: append([]skillSourceSkillSnapshot(nil), source.SkillList...),
			})
		}
		if err := validateLegacySkillSourceLock(lock); err != nil {
			return skillSourceLock{}, err
		}
		sortSkillSourceLock(&lock)
		return lock, nil
	case skillSourceLockVersion:
		var wire skillSourceLockV3Wire
		if err := decodeStrictSkillJSON(raw, &wire); err != nil {
			return skillSourceLock{}, fmt.Errorf("decode skill source lock: %w", err)
		}
		lock := newSkillSourceLock()
		for _, source := range wire.Sources {
			snapshot := skillSourceSnapshot{
				Source: source.Source, SourceKey: source.SourceKey, Branch: source.Branch,
				Commit: source.Commit, UpdatedAt: source.UpdatedAt,
				ManagedSkills: append([]string(nil), source.ManagedSkills...),
			}
			canonicalizeSkillSourceSnapshot(&snapshot)
			lock.Sources = append(lock.Sources, snapshot)
		}
		if err := validateSkillSourceLock(lock); err != nil {
			return skillSourceLock{}, err
		}
		sortSkillSourceLock(&lock)
		return lock, nil
	default:
		return skillSourceLock{}, fmt.Errorf("unsupported skill source lock version %d", envelope.Version)
	}
}

type skillSourceLockV2Wire struct {
	Version       int                         `json:"version"`
	HashAlgorithm string                      `json:"hashAlgorithm"`
	Sources       []skillSourceSnapshotV2Wire `json:"sources"`
}

type skillSourceSnapshotV2Wire struct {
	Source         string                     `json:"source"`
	SourceKey      string                     `json:"sourceKey"`
	ResolvedCommit string                     `json:"resolvedCommit,omitempty"`
	RefreshedAt    string                     `json:"refreshedAt,omitempty"`
	SkillList      []skillSourceSkillSnapshot `json:"skillList"`
}

type skillSourceLockV3Wire struct {
	Version int                         `json:"version"`
	Sources []skillSourceSnapshotV3Wire `json:"sources"`
}

type skillSourceSnapshotV3Wire struct {
	Source        string   `json:"source"`
	SourceKey     string   `json:"sourceKey"`
	Branch        string   `json:"branch,omitempty"`
	Commit        string   `json:"commit,omitempty"`
	UpdatedAt     string   `json:"updatedAt,omitempty"`
	ManagedSkills []string `json:"managedSkills"`
}

func decodeStrictSkillJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("trailing data")
		}
		return fmt.Errorf("trailing data: %w", err)
	}
	return nil
}

func validateSkillSourceLock(lock skillSourceLock) error {
	if lock.Version != skillSourceLockVersion {
		return fmt.Errorf("unsupported skill source lock version %d", lock.Version)
	}
	seenSources := map[string]struct{}{}
	for index := range lock.Sources {
		source := &lock.Sources[index]
		canonicalizeSkillSourceSnapshot(source)
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
		if source.Commit != "" && (len(source.Commit) < 40 || len(source.Commit) > 64 || !skillSourceHexPattern.MatchString(source.Commit)) {
			return fmt.Errorf("skill source %q has invalid commit", source.SourceKey)
		}
		if source.UpdatedAt != "" {
			if _, err := time.Parse(time.RFC3339, source.UpdatedAt); err != nil {
				return fmt.Errorf("skill source %q has invalid updated time", source.SourceKey)
			}
		}
		if (source.Commit == "") != (source.UpdatedAt == "") {
			return fmt.Errorf("skill source %q has incomplete commit metadata", source.SourceKey)
		}
		seenSkills := map[string]struct{}{}
		for _, name := range source.ManagedSkills {
			name = strings.TrimSpace(name)
			nameKey := strings.ToLower(name)
			if !skillNamePattern.MatchString(name) || nameKey == "" {
				return fmt.Errorf("skill source %q has invalid skill name %q", source.SourceKey, name)
			}
			if _, exists := seenSkills[nameKey]; exists {
				return fmt.Errorf("skill source %q has duplicate skill %q", source.SourceKey, name)
			}
			seenSkills[nameKey] = struct{}{}
		}
	}
	return nil
}

func validateLegacySkillSourceLock(lock skillSourceLock) error {
	if lock.Version != 2 || lock.HashAlgorithm != skillSourceHashAlgorithm {
		return fmt.Errorf("unsupported legacy skill source lock")
	}
	for _, source := range lock.Sources {
		if _, _, err := normalizeSkillGitSource(source.Source); err != nil {
			return fmt.Errorf("invalid legacy skill source %q: %w", source.SourceKey, err)
		}
		seen := map[string]struct{}{}
		for _, skill := range source.SkillList {
			key := strings.ToLower(strings.TrimSpace(skill.Name))
			if !skillNamePattern.MatchString(skill.Name) || key == "" {
				return fmt.Errorf("invalid legacy skill name %q", skill.Name)
			}
			if _, exists := seen[key]; exists {
				return fmt.Errorf("duplicate legacy skill %q", skill.Name)
			}
			seen[key] = struct{}{}
		}
	}
	return nil
}

func canonicalizeSkillSourceSnapshot(source *skillSourceSnapshot) {
	if source == nil {
		return
	}
	if source.Commit == "" {
		source.Commit = strings.TrimSpace(source.ResolvedCommit)
	}
	if source.UpdatedAt == "" {
		source.UpdatedAt = strings.TrimSpace(source.RefreshedAt)
	}
	if source.ResolvedCommit == "" {
		source.ResolvedCommit = source.Commit
	}
	if source.RefreshedAt == "" {
		source.RefreshedAt = source.UpdatedAt
	}
	if len(source.ManagedSkills) == 0 && len(source.SkillList) > 0 {
		for _, skill := range source.SkillList {
			if strings.TrimSpace(skill.Name) != "" {
				source.ManagedSkills = append(source.ManagedSkills, skill.Name)
			}
		}
	}
	if source.SkillList == nil {
		for _, name := range source.ManagedSkills {
			source.SkillList = append(source.SkillList, skillSourceSkillSnapshot{Name: name})
		}
	}
}

func migrateSkillSourceLockToV3(legacy skillSourceLock, installed map[string]struct{}) (skillSourceLock, error) {
	if legacy.Version != 2 {
		if legacy.Version == skillSourceLockVersion {
			if err := validateSkillSourceLock(legacy); err != nil {
				return skillSourceLock{}, err
			}
			return legacy, nil
		}
		return skillSourceLock{}, fmt.Errorf("unsupported legacy skill source lock version %d", legacy.Version)
	}
	if err := validateLegacySkillSourceLock(legacy); err != nil {
		return skillSourceLock{}, err
	}
	migrated := newSkillSourceLock()
	for _, source := range legacy.Sources {
		normalizedSource, sourceKey, err := normalizeSkillGitSource(source.Source)
		if err != nil {
			return skillSourceLock{}, err
		}
		converted := skillSourceSnapshot{
			Source: normalizedSource, SourceKey: sourceKey,
			Commit: source.ResolvedCommit, UpdatedAt: source.RefreshedAt,
			ResolvedCommit: source.ResolvedCommit, RefreshedAt: source.RefreshedAt,
		}
		for _, skill := range source.SkillList {
			if _, exists := installed[strings.ToLower(strings.TrimSpace(skill.Name))]; exists {
				converted.ManagedSkills = append(converted.ManagedSkills, skill.Name)
				converted.SkillList = append(converted.SkillList, skill)
			}
		}
		migrated.Sources = append(migrated.Sources, converted)
	}
	sortSkillSourceLock(&migrated)
	if err := validateSkillSourceLock(migrated); err != nil {
		return skillSourceLock{}, err
	}
	return migrated, nil
}

func sortSkillSourceLock(lock *skillSourceLock) {
	if lock.Sources == nil {
		lock.Sources = []skillSourceSnapshot{}
	}
	sort.Slice(lock.Sources, func(i, j int) bool {
		return strings.ToLower(lock.Sources[i].SourceKey) < strings.ToLower(lock.Sources[j].SourceKey)
	})
	for index := range lock.Sources {
		canonicalizeSkillSourceSnapshot(&lock.Sources[index])
		if lock.Sources[index].SkillList == nil {
			lock.Sources[index].SkillList = []skillSourceSkillSnapshot{}
		}
		if lock.Sources[index].ManagedSkills == nil {
			lock.Sources[index].ManagedSkills = []string{}
		}
		sort.Slice(lock.Sources[index].ManagedSkills, func(i, j int) bool {
			return strings.ToLower(lock.Sources[index].ManagedSkills[i]) < strings.ToLower(lock.Sources[index].ManagedSkills[j])
		})
		sort.Slice(lock.Sources[index].SkillList, func(i, j int) bool {
			return strings.ToLower(lock.Sources[index].SkillList[i].Name) < strings.ToLower(lock.Sources[index].SkillList[j].Name)
		})
	}
}

func encodeSkillSourceLock(lock skillSourceLock) ([]byte, error) {
	for index := range lock.Sources {
		canonicalizeSkillSourceSnapshot(&lock.Sources[index])
	}
	if err := validateSkillSourceLock(lock); err != nil {
		return nil, err
	}
	sortSkillSourceLock(&lock)
	wire := skillSourceLockV3Wire{Version: skillSourceLockVersion, Sources: make([]skillSourceSnapshotV3Wire, 0, len(lock.Sources))}
	for _, source := range lock.Sources {
		wire.Sources = append(wire.Sources, skillSourceSnapshotV3Wire{
			Source: source.Source, SourceKey: source.SourceKey, Branch: source.Branch,
			Commit: source.Commit, UpdatedAt: source.UpdatedAt, ManagedSkills: append([]string(nil), source.ManagedSkills...),
		})
	}
	raw, err := json.MarshalIndent(wire, "", "  ")
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
