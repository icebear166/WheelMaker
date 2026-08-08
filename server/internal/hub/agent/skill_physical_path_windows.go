package agent

import (
	"fmt"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// skillPhysicalPathKey uses the Windows file identity of the directory so a
// junction and its target are scanned only once. Opening without
// FILE_FLAG_OPEN_REPARSE_POINT follows directory junctions to the target.
func skillPhysicalPathKey(path string) string {
	if absolute, err := filepath.Abs(path); err == nil {
		path = filepath.Clean(absolute)
	}

	handle, err := windows.CreateFile(
		windows.StringToUTF16Ptr(path),
		0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS,
		0,
	)
	if err == nil {
		var information windows.ByHandleFileInformation
		informationErr := windows.GetFileInformationByHandle(handle, &information)
		_ = windows.CloseHandle(handle)
		if informationErr == nil {
			fileIndex := uint64(information.FileIndexHigh)<<32 | uint64(information.FileIndexLow)
			return fmt.Sprintf("win:%08x:%016x", information.VolumeSerialNumber, fileIndex)
		}
	}

	if resolved, resolveErr := filepath.EvalSymlinks(path); resolveErr == nil && strings.TrimSpace(resolved) != "" {
		path = resolved
	}
	return strings.ToLower(filepath.ToSlash(filepath.Clean(path)))
}
