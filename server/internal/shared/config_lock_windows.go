//go:build windows

package shared

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func acquireConfigFileLock(path string) (func(), error) {
	configProcessLock.Lock()
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		configProcessLock.Unlock()
		return nil, fmt.Errorf("open config lock %s: %w", path, err)
	}
	var overlapped windows.Overlapped
	if err := windows.LockFileEx(windows.Handle(file.Fd()), 0, 0, 1, 0, &overlapped); err != nil {
		_ = file.Close()
		configProcessLock.Unlock()
		return nil, fmt.Errorf("lock config %s: %w", path, err)
	}
	return func() {
		_ = windows.UnlockFileEx(windows.Handle(file.Fd()), 0, 1, 0, &overlapped)
		_ = file.Close()
		configProcessLock.Unlock()
	}, nil
}
