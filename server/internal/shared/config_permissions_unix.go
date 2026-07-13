//go:build !windows

package shared

import "os"

func secureConfigFile(path string) error {
	return os.Chmod(path, 0o600)
}
