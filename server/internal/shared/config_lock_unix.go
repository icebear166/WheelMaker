//go:build !windows

package shared

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func acquireConfigFileLock(path string) (func(), error) {
	processLock := configProcessMutex(path)
	processLock.Lock()
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		processLock.Unlock()
		return nil, fmt.Errorf("open config lock %s: %w", path, err)
	}
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX); err != nil {
		_ = file.Close()
		processLock.Unlock()
		return nil, fmt.Errorf("lock config %s: %w", path, err)
	}
	return func() {
		_ = unix.Flock(int(file.Fd()), unix.LOCK_UN)
		_ = file.Close()
		processLock.Unlock()
	}, nil
}
