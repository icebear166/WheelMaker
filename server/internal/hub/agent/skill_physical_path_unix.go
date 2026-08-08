//go:build !windows

package agent

import (
	"path/filepath"
	"strings"
)

func skillPhysicalPathKey(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil && strings.TrimSpace(resolved) != "" {
		path = resolved
	}
	return strings.ToLower(filepath.ToSlash(filepath.Clean(path)))
}
