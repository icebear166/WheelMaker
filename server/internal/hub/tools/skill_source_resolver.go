package tools

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

type skillSourceResolver struct {
	temporaryRoot string
	now           func() time.Time
}

func newSkillSourceResolver(temporaryRoot string) *skillSourceResolver {
	return &skillSourceResolver{
		temporaryRoot: strings.TrimSpace(temporaryRoot),
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (r *skillSourceResolver) Resolve(ctx context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
	address := strings.TrimSpace(source.Source)
	if address == "" || strings.HasPrefix(address, "-") || strings.ContainsAny(address, "\x00\r\n") {
		return skillSourceSnapshot{}, errors.New("invalid skill source address")
	}
	temporary, err := os.MkdirTemp(r.temporaryRoot, "wheelmaker-skill-source-*")
	if err != nil {
		return skillSourceSnapshot{}, fmt.Errorf("create temporary skill checkout: %w", err)
	}
	defer os.RemoveAll(temporary)
	checkout := filepath.Join(temporary, "checkout")
	if _, err := runSkillSourceGitCommand(ctx, "", "clone", "--quiet", "--no-checkout", address, checkout); err != nil {
		return skillSourceSnapshot{}, fmt.Errorf("clone skill source: %w", err)
	}
	commit, err := resolveSkillSourceDefaultCommit(ctx, checkout)
	if err != nil {
		return skillSourceSnapshot{}, err
	}
	if _, err := runSkillSourceGitCommand(ctx, checkout, "checkout", "--quiet", "--detach", commit); err != nil {
		return skillSourceSnapshot{}, fmt.Errorf("checkout skill source commit: %w", err)
	}
	skills, err := discoverSkillSourceCatalog(checkout)
	if err != nil {
		return skillSourceSnapshot{}, err
	}
	result := source
	result.ResolvedCommit = commit
	result.RefreshedAt = r.now().UTC().Format(time.RFC3339)
	result.SkillList = skills
	return result, nil
}

func resolveSkillSourceDefaultCommit(ctx context.Context, checkout string) (string, error) {
	remoteHead, err := runSkillSourceGitCommand(ctx, checkout, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
	if err != nil {
		return "", errors.New("skill source remote default HEAD was not found")
	}
	remoteHead = strings.TrimSpace(remoteHead)
	if !strings.HasPrefix(remoteHead, "refs/remotes/origin/") {
		return "", errors.New("skill source remote default HEAD is invalid")
	}
	output, err := runSkillSourceGitCommand(ctx, checkout, "rev-parse", "--verify", "--end-of-options", remoteHead+"^{commit}")
	if err != nil {
		return "", errors.New("skill source remote default HEAD was not found")
	}
	commit := strings.TrimSpace(output)
	if len(commit) < 40 || len(commit) > 64 || !skillSourceHexPattern.MatchString(commit) {
		return "", errors.New("skill source remote default HEAD resolved to an invalid commit")
	}
	return commit, nil
}

func runSkillSourceGitCommand(ctx context.Context, dir string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", args...)
	shared.ConfigureBackgroundCommand(command)
	if strings.TrimSpace(dir) != "" {
		command.Dir = dir
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		summary := strings.TrimSpace(stderr.String())
		if summary == "" {
			summary = err.Error()
		}
		return "", errors.New(summary)
	}
	return stdout.String(), nil
}

func discoverSkillSourceCatalog(checkout string) ([]skillSourceSkillSnapshot, error) {
	skillsRoot := filepath.Join(checkout, "skills")
	info, err := os.Lstat(skillsRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("skill source skills directory was not found")
	}
	if err != nil {
		return nil, fmt.Errorf("inspect skill source skills directory: %w", err)
	}
	if !info.IsDir() {
		return nil, errors.New("skill source skills path is not a directory")
	}
	var skillFiles []string
	err = filepath.WalkDir(skillsRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(checkout, path)
		if err != nil {
			return err
		}
		normalized := filepath.ToSlash(relative)
		if entry.IsDir() && entry.Name() == ".git" {
			return filepath.SkipDir
		}
		if normalized == ".git" || strings.HasPrefix(normalized, ".git/") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(path)
			if err != nil {
				return err
			}
			inside, err := filepath.Rel(checkout, resolved)
			if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) || filepath.IsAbs(inside) {
				return fmt.Errorf("skill source link %q escapes checkout", normalized)
			}
		}
		if !entry.IsDir() {
			return nil
		}
		// A repository-level skills/SKILL.md is not a published skill. Only
		// child directories under skills/ may become installable units.
		if filepath.Clean(path) == filepath.Clean(skillsRoot) {
			return nil
		}
		skillFile := filepath.Join(path, "SKILL.md")
		skillInfo, skillErr := os.Lstat(skillFile)
		if errors.Is(skillErr, os.ErrNotExist) {
			return nil
		}
		if skillErr != nil {
			return skillErr
		}
		if skillInfo.IsDir() {
			return nil
		}
		skillFiles = append(skillFiles, skillFile)
		return filepath.SkipDir
	})
	if err != nil {
		return nil, fmt.Errorf("discover skill source catalog: %w", err)
	}
	if len(skillFiles) == 0 {
		return nil, errors.New("skill source skills directory does not contain any skills")
	}
	sort.Strings(skillFiles)
	seen := map[string]string{}
	skills := make([]skillSourceSkillSnapshot, 0, len(skillFiles))
	for _, skillFile := range skillFiles {
		root := filepath.Dir(skillFile)
		name, err := readSkillSourceName(skillFile, filepath.Base(root))
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(name)
		relative, err := filepath.Rel(checkout, skillFile)
		if err != nil {
			return nil, err
		}
		normalized := filepath.ToSlash(relative)
		if previous, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate skill name %q at %s and %s", name, previous, normalized)
		}
		seen[key] = normalized
		contentHash, err := hashSkillDirectory(root)
		if err != nil {
			return nil, fmt.Errorf("hash skill %q: %w", name, err)
		}
		skills = append(skills, skillSourceSkillSnapshot{
			Name:          name,
			SkillPath:     normalized,
			ContentSHA256: contentHash,
		})
	}
	sort.Slice(skills, func(i, j int) bool { return strings.ToLower(skills[i].Name) < strings.ToLower(skills[j].Name) })
	return skills, nil
}

func readSkillSourceName(skillFile, fallback string) (string, error) {
	raw, err := os.ReadFile(skillFile)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", skillFile, err)
	}
	name := strings.TrimSpace(fallback)
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
		for _, line := range lines[1:] {
			line = strings.TrimSpace(line)
			if line == "---" {
				break
			}
			if key, value, found := strings.Cut(line, ":"); found && strings.EqualFold(strings.TrimSpace(key), "name") {
				candidate := strings.Trim(strings.TrimSpace(value), `"'`)
				if candidate != "" {
					name = candidate
				}
			}
		}
	}
	if !skillNamePattern.MatchString(name) {
		return "", fmt.Errorf("invalid skill name %q in %s", name, skillFile)
	}
	return name, nil
}
