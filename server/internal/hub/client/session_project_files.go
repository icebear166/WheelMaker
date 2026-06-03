package client

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

func (c *Client) prepareSessionPromptBlocks(ctx context.Context, sessionID string, blocks []acp.ContentBlock) ([]acp.ContentBlock, []attachmentRef, error) {
	normalized := make([]acp.ContentBlock, 0, len(blocks))
	attachmentBlocks := make([]acp.ContentBlock, 0, len(blocks))
	for _, block := range blocks {
		if isProjectRelativeResourceLink(block) {
			next, err := c.resolveProjectRelativeResourceLink(block)
			if err != nil {
				return nil, nil, err
			}
			normalized = append(normalized, next)
			continue
		}
		normalized = append(normalized, block)
		attachmentBlocks = append(attachmentBlocks, block)
	}
	refs, err := c.validateSessionAttachmentBlocks(ctx, sessionID, attachmentBlocks)
	if err != nil {
		return nil, nil, err
	}
	return normalized, refs, nil
}

func isProjectRelativeResourceLink(block acp.ContentBlock) bool {
	if block.Type != acp.ContentBlockTypeResourceLink {
		return false
	}
	uri := strings.TrimSpace(block.URI)
	if uri == "" {
		return false
	}
	parsed, err := url.Parse(uri)
	return err != nil || parsed.Scheme == ""
}

func (c *Client) resolveProjectRelativeResourceLink(block acp.ContentBlock) (acp.ContentBlock, error) {
	target, clean, err := safeProjectFileJoin(c.cwd, block.URI)
	if err != nil {
		return acp.ContentBlock{}, fmt.Errorf("project file link %q: %w", block.URI, err)
	}
	info, err := os.Lstat(target)
	if err != nil {
		return acp.ContentBlock{}, fmt.Errorf("project file link %q: %w", clean, err)
	}
	if info.IsDir() {
		return acp.ContentBlock{}, fmt.Errorf("project file link %q is a directory", clean)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		resolved, statErr := os.Stat(target)
		if statErr != nil {
			return acp.ContentBlock{}, fmt.Errorf("project file link %q: %w", clean, statErr)
		}
		if resolved.IsDir() {
			return acp.ContentBlock{}, fmt.Errorf("project file link %q is a directory", clean)
		}
	}
	uri, err := fileURI(target)
	if err != nil {
		return acp.ContentBlock{}, fmt.Errorf("project file link %q: %w", clean, err)
	}
	block.URI = uri
	if strings.TrimSpace(block.Name) == "" {
		block.Name = filepath.Base(filepath.FromSlash(clean))
	}
	return block, nil
}

func safeProjectFileJoin(root, rel string) (string, string, error) {
	root = strings.TrimSpace(root)
	rel = strings.TrimSpace(rel)
	if root == "" {
		return "", "", fmt.Errorf("project root is empty")
	}
	if rel == "" {
		return "", "", fmt.Errorf("path is empty")
	}
	clean := filepath.Clean(filepath.FromSlash(strings.ReplaceAll(rel, "\\", "/")))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") || strings.Contains(clean, `:\`) {
		return "", "", fmt.Errorf("path escapes project root")
	}
	target := filepath.Join(root, clean)
	rootAbs, _ := filepath.Abs(root)
	targetAbs, _ := filepath.Abs(target)
	rootPrefix := rootAbs
	if !strings.HasSuffix(rootPrefix, string(filepath.Separator)) {
		rootPrefix += string(filepath.Separator)
	}
	if targetAbs != rootAbs && !strings.HasPrefix(targetAbs, rootPrefix) {
		return "", "", fmt.Errorf("path escapes project root")
	}
	return targetAbs, filepath.ToSlash(clean), nil
}
