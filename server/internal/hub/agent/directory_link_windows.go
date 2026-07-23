package agent

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func createDirectoryLink(target, link string) error {
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return fmt.Errorf("resolve junction target %s: %w", target, err)
	}
	linkAbs, err := filepath.Abs(link)
	if err != nil {
		return fmt.Errorf("resolve junction path %s: %w", link, err)
	}
	if err := os.Mkdir(linkAbs, 0o755); err != nil {
		return fmt.Errorf("create junction directory %s: %w", linkAbs, err)
	}
	if err := setDirectoryJunction(linkAbs, targetAbs); err != nil {
		_ = os.Remove(linkAbs)
		return fmt.Errorf("link Claude-compatible skills directory %s to %s: %w", linkAbs, targetAbs, err)
	}
	return nil
}

func setDirectoryJunction(link, target string) error {
	handle, err := windows.CreateFile(
		windows.StringToUTF16Ptr(link),
		windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS,
		0,
	)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)

	printName := filepath.Clean(target)
	substituteName := junctionSubstituteName(printName)
	substituteUTF16, err := windows.UTF16FromString(substituteName)
	if err != nil {
		return err
	}
	printUTF16, err := windows.UTF16FromString(printName)
	if err != nil {
		return err
	}

	pathBytes := make([]byte, (len(substituteUTF16)+len(printUTF16))*2)
	offset := 0
	for _, value := range substituteUTF16 {
		binary.LittleEndian.PutUint16(pathBytes[offset:], value)
		offset += 2
	}
	for _, value := range printUTF16 {
		binary.LittleEndian.PutUint16(pathBytes[offset:], value)
		offset += 2
	}

	reparseDataLength := 8 + len(pathBytes)
	buffer := make([]byte, 8+reparseDataLength)
	binary.LittleEndian.PutUint32(buffer[0:], windows.IO_REPARSE_TAG_MOUNT_POINT)
	binary.LittleEndian.PutUint16(buffer[4:], uint16(reparseDataLength))
	binary.LittleEndian.PutUint16(buffer[8:], 0)
	binary.LittleEndian.PutUint16(buffer[10:], uint16((len(substituteUTF16)-1)*2))
	binary.LittleEndian.PutUint16(buffer[12:], uint16(len(substituteUTF16)*2))
	binary.LittleEndian.PutUint16(buffer[14:], uint16((len(printUTF16)-1)*2))
	copy(buffer[16:], pathBytes)

	var bytesReturned uint32
	return windows.DeviceIoControl(
		handle,
		windows.FSCTL_SET_REPARSE_POINT,
		&buffer[0],
		uint32(len(buffer)),
		nil,
		0,
		&bytesReturned,
		nil,
	)
}

func junctionSubstituteName(target string) string {
	if strings.HasPrefix(target, `\\?\UNC\`) {
		return `\??\UNC\` + strings.TrimPrefix(target, `\\?\UNC\`)
	}
	if strings.HasPrefix(target, `\\?\`) {
		return `\??\` + strings.TrimPrefix(target, `\\?\`)
	}
	if strings.HasPrefix(target, `\\`) {
		return `\??\UNC\` + strings.TrimPrefix(target, `\\`)
	}
	return `\??\` + target
}
