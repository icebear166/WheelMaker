//go:build !windows

package agent

import (
	"fmt"
	"os"
)

func createDirectoryLink(target, link string) error {
	if err := os.Symlink(target, link); err != nil {
		return fmt.Errorf("link Claude-compatible skills directory %s to %s: %w", link, target, err)
	}
	return nil
}
