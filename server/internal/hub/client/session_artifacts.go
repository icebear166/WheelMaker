package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	sessionArtifactTypeDiff   = "diff"
	sessionArtifactFormatDiff = "unified-diff"
)

type fileSessionArtifactStore struct {
	root string
}

type sessionArtifactReadResult struct {
	ArtifactID string `json:"artifactId"`
	Type       string `json:"type"`
	Format     string `json:"format"`
	Content    string `json:"content"`
}

func newFileSessionArtifactStore(root string) *fileSessionArtifactStore {
	return &fileSessionArtifactStore{root: root}
}

func (s *fileSessionArtifactStore) WriteDiffArtifact(ctx context.Context, projectName, sessionID, content string) (acp.SessionTurnPromptArtifact, error) {
	if err := ctx.Err(); err != nil {
		return acp.SessionTurnPromptArtifact{}, err
	}
	if s == nil {
		return acp.SessionTurnPromptArtifact{}, fmt.Errorf("session artifact store is required")
	}
	if content == "" {
		return acp.SessionTurnPromptArtifact{}, fmt.Errorf("artifact content is required")
	}
	sum := sha256.Sum256([]byte(content))
	artifactID := "diff-" + hex.EncodeToString(sum[:])[:16]
	path, err := s.artifactPath(projectName, sessionID, artifactID)
	if err != nil {
		return acp.SessionTurnPromptArtifact{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return acp.SessionTurnPromptArtifact{}, fmt.Errorf("mkdir artifact dir: %w", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return acp.SessionTurnPromptArtifact{}, fmt.Errorf("write artifact: %w", err)
	}
	files := parseUnifiedDiffArtifactFiles(content)
	return acp.SessionTurnPromptArtifact{
		ArtifactID: artifactID,
		Type:       sessionArtifactTypeDiff,
		Format:     sessionArtifactFormatDiff,
		FileCount:  len(files),
		Files:      files,
	}, nil
}

func (s *fileSessionArtifactStore) ReadArtifact(ctx context.Context, projectName, sessionID, artifactID string) (sessionArtifactReadResult, error) {
	if err := ctx.Err(); err != nil {
		return sessionArtifactReadResult{}, err
	}
	if s == nil {
		return sessionArtifactReadResult{}, fmt.Errorf("session artifact store is required")
	}
	path, err := s.artifactPath(projectName, sessionID, artifactID)
	if err != nil {
		return sessionArtifactReadResult{}, err
	}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return sessionArtifactReadResult{}, fmt.Errorf("artifact not found: %s", artifactID)
	}
	if err != nil {
		return sessionArtifactReadResult{}, fmt.Errorf("read artifact: %w", err)
	}
	return sessionArtifactReadResult{
		ArtifactID: artifactID,
		Type:       sessionArtifactTypeDiff,
		Format:     sessionArtifactFormatDiff,
		Content:    string(raw),
	}, nil
}

func (s *fileSessionArtifactStore) DeleteArtifacts(ctx context.Context, projectName, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s == nil {
		return nil
	}
	if err := os.RemoveAll(s.artifactDir(projectName, sessionID)); err != nil {
		return fmt.Errorf("delete artifact dir: %w", err)
	}
	return nil
}

func (s *fileSessionArtifactStore) artifactDir(projectName, sessionID string) string {
	return filepath.Join(s.root, safeHistoryPathPart(projectName), safeHistoryPathPart(sessionID), "artifacts")
}

func (s *fileSessionArtifactStore) artifactPath(projectName, sessionID, artifactID string) (string, error) {
	if !validSessionArtifactID(artifactID) {
		return "", fmt.Errorf("invalid artifact id: %s", artifactID)
	}
	return filepath.Join(s.artifactDir(projectName, sessionID), artifactID+".diff"), nil
}

func validSessionArtifactID(artifactID string) bool {
	if artifactID == "" || artifactID == "." || artifactID == ".." {
		return false
	}
	for _, r := range artifactID {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '.', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

func parseUnifiedDiffArtifactFiles(diff string) []acp.SessionTurnPromptArtifactFile {
	lines := strings.Split(diff, "\n")
	files := make([]acp.SessionTurnPromptArtifactFile, 0)
	var current *acp.SessionTurnPromptArtifactFile
	var oldPath string
	var newPath string

	flush := func() {
		if current == nil {
			return
		}
		if current.Path == "" {
			current.Path = preferredDiffArtifactPath(oldPath, newPath)
		}
		if current.Path == "" {
			current.Path = "unknown"
		}
		files = append(files, *current)
	}

	for _, line := range lines {
		if strings.HasPrefix(line, "diff --git ") {
			flush()
			oldPath, newPath = parseDiffGitPaths(line)
			current = &acp.SessionTurnPromptArtifactFile{
				Path:   preferredDiffArtifactPath(oldPath, newPath),
				Status: "M",
			}
			continue
		}
		if current == nil {
			continue
		}
		switch {
		case strings.HasPrefix(line, "new file mode "):
			current.Status = "A"
		case strings.HasPrefix(line, "deleted file mode "):
			current.Status = "D"
		case strings.HasPrefix(line, "rename from "):
			current.Status = "R"
			oldPath = cleanDiffArtifactPath(strings.TrimPrefix(line, "rename from "))
		case strings.HasPrefix(line, "rename to "):
			current.Status = "R"
			newPath = cleanDiffArtifactPath(strings.TrimPrefix(line, "rename to "))
			current.Path = preferredDiffArtifactPath(oldPath, newPath)
		case strings.HasPrefix(line, "copy from "):
			current.Status = "C"
			oldPath = cleanDiffArtifactPath(strings.TrimPrefix(line, "copy from "))
		case strings.HasPrefix(line, "copy to "):
			current.Status = "C"
			newPath = cleanDiffArtifactPath(strings.TrimPrefix(line, "copy to "))
			current.Path = preferredDiffArtifactPath(oldPath, newPath)
		case strings.HasPrefix(line, "Binary files ") || strings.HasPrefix(line, "GIT binary patch"):
			current.Status = "B"
		case strings.HasPrefix(line, "--- "):
			oldPath = cleanDiffArtifactPath(strings.TrimPrefix(line, "--- "))
			if current.Status == "D" {
				current.Path = preferredDiffArtifactPath(oldPath, newPath)
			}
		case strings.HasPrefix(line, "+++ "):
			newPath = cleanDiffArtifactPath(strings.TrimPrefix(line, "+++ "))
			current.Path = preferredDiffArtifactPath(oldPath, newPath)
		case strings.HasPrefix(line, "+"):
			current.Additions++
		case strings.HasPrefix(line, "-"):
			current.Deletions++
		}
	}
	flush()
	return files
}

func parseDiffGitPaths(line string) (string, string) {
	parts := strings.Fields(line)
	if len(parts) < 4 {
		return "", ""
	}
	return cleanDiffArtifactPath(parts[2]), cleanDiffArtifactPath(parts[3])
}

func preferredDiffArtifactPath(oldPath, newPath string) string {
	if newPath != "" {
		return newPath
	}
	return oldPath
}

func cleanDiffArtifactPath(path string) string {
	path = strings.TrimSpace(path)
	path = strings.Trim(path, `"`)
	if path == "/dev/null" {
		return ""
	}
	if strings.HasPrefix(path, "a/") || strings.HasPrefix(path, "b/") {
		return path[2:]
	}
	return path
}
