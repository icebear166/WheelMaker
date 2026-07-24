//go:build windows

package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	maxDesktopHTMLClipboardBytes       = 16 * 1024 * 1024
	maxDesktopHTMLClipboardChunkBytes  = 128 * 1024
	maxDesktopHTMLClipboardEncodedSize = 180_000

	cfHDrop      = 15
	gmemMoveable = 0x0002
)

type desktopHTMLClipboardTransfer struct {
	id            string
	path          string
	expectedBytes int
	receivedBytes int
	nextIndex     int
}

type desktopHTMLClipboardTransferStore struct {
	mu            sync.Mutex
	rootDirectory string
	maxTotalBytes int
	maxChunkBytes int
	active        *desktopHTMLClipboardTransfer
}

func newDesktopHTMLClipboardTransferStore(
	rootDirectory string,
	maxTotalBytes int,
	maxChunkBytes int,
) *desktopHTMLClipboardTransferStore {
	return &desktopHTMLClipboardTransferStore{
		rootDirectory: rootDirectory,
		maxTotalBytes: maxTotalBytes,
		maxChunkBytes: maxChunkBytes,
	}
}

func newDefaultDesktopHTMLClipboardTransferStore() *desktopHTMLClipboardTransferStore {
	return newDesktopHTMLClipboardTransferStore(
		filepath.Join(os.TempDir(), "WheelMaker", "html-clipboard"),
		maxDesktopHTMLClipboardBytes,
		maxDesktopHTMLClipboardChunkBytes,
	)
}

func (s *desktopHTMLClipboardTransferStore) begin(fileName string, expectedBytes int) (string, error) {
	if !isSafeDesktopHTMLFileName(fileName) {
		return "", fmt.Errorf("HTML file name is invalid")
	}
	if expectedBytes < 1 || expectedBytes > s.maxTotalBytes {
		return "", fmt.Errorf("HTML file size is invalid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancelLocked()
	if err := os.MkdirAll(s.rootDirectory, 0o700); err != nil {
		return "", fmt.Errorf("create HTML clipboard directory: %w", err)
	}
	directory, err := os.MkdirTemp(s.rootDirectory, "transfer-")
	if err != nil {
		return "", fmt.Errorf("create HTML clipboard transfer: %w", err)
	}
	path := filepath.Join(directory, fileName)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		_ = os.RemoveAll(directory)
		return "", fmt.Errorf("create HTML clipboard file: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.RemoveAll(directory)
		return "", fmt.Errorf("close HTML clipboard file: %w", err)
	}
	transferID := filepath.Base(directory)
	s.active = &desktopHTMLClipboardTransfer{
		id:            transferID,
		path:          path,
		expectedBytes: expectedBytes,
	}
	return transferID, nil
}

func (s *desktopHTMLClipboardTransferStore) append(transferID string, index int, bytes []byte) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	transfer := s.activeLocked(transferID)
	if transfer == nil || index != transfer.nextIndex || len(bytes) == 0 || len(bytes) > s.maxChunkBytes {
		return false
	}
	if transfer.receivedBytes+len(bytes) > transfer.expectedBytes {
		return false
	}
	file, err := os.OpenFile(transfer.path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		s.cancelLocked()
		return false
	}
	_, writeErr := file.Write(bytes)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		s.cancelLocked()
		return false
	}
	transfer.receivedBytes += len(bytes)
	transfer.nextIndex++
	return true
}

func (s *desktopHTMLClipboardTransferStore) appendBase64(transferID string, index int, encoded string) bool {
	if len(encoded) == 0 || len(encoded) > maxDesktopHTMLClipboardEncodedSize {
		return false
	}
	bytes, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return false
	}
	return s.append(transferID, index, bytes)
}

func (s *desktopHTMLClipboardTransferStore) commit(transferID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	transfer := s.activeLocked(transferID)
	if transfer == nil || transfer.receivedBytes != transfer.expectedBytes {
		return "", false
	}
	info, err := os.Stat(transfer.path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != int64(transfer.expectedBytes) {
		return "", false
	}
	path := transfer.path
	s.active = nil
	return path, true
}

func (s *desktopHTMLClipboardTransferStore) cancel(transferID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeLocked(transferID) == nil {
		return false
	}
	s.cancelLocked()
	return true
}

func (s *desktopHTMLClipboardTransferStore) activeLocked(transferID string) *desktopHTMLClipboardTransfer {
	if s.active == nil || s.active.id != transferID {
		return nil
	}
	return s.active
}

func (s *desktopHTMLClipboardTransferStore) cancelLocked() {
	if s.active == nil {
		return
	}
	_ = os.RemoveAll(filepath.Dir(s.active.path))
	s.active = nil
}

func isSafeDesktopHTMLFileName(fileName string) bool {
	if fileName == "" || len(fileName) > 160 || !strings.EqualFold(filepath.Ext(fileName), ".html") {
		return false
	}
	if filepath.Base(fileName) != fileName || filepath.IsAbs(fileName) {
		return false
	}
	return !strings.ContainsAny(fileName, "\x00\r\n")
}

func desktopHTMLClipboardResult(ok bool, status string, errorMessage string) string {
	if errorMessage == "" {
		return fmt.Sprintf(`{"ok":%t,"status":%q}`, ok, status)
	}
	return fmt.Sprintf(`{"ok":%t,"status":%q,"error":%q}`, ok, status, errorMessage)
}

func setDesktopHTMLFileClipboard(path string) error {
	data, err := encodeDesktopDropFiles([]string{path})
	if err != nil {
		return err
	}
	memory, _, callErr := procDesktopClipboardGlobalAlloc.Call(gmemMoveable, uintptr(len(data)))
	if memory == 0 {
		return desktopClipboardCallError("allocate clipboard memory", callErr)
	}
	ownedByClipboard := false
	defer func() {
		if !ownedByClipboard {
			procDesktopClipboardGlobalFree.Call(memory)
		}
	}()
	locked, _, callErr := procDesktopClipboardGlobalLock.Call(memory)
	if locked == 0 {
		return desktopClipboardCallError("lock clipboard memory", callErr)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(locked)), len(data)), data)
	procDesktopClipboardGlobalUnlock.Call(memory)
	opened, _, callErr := procDesktopOpenClipboard.Call(0)
	if opened == 0 {
		return desktopClipboardCallError("open clipboard", callErr)
	}
	defer procDesktopCloseClipboard.Call()
	emptied, _, callErr := procDesktopEmptyClipboard.Call()
	if emptied == 0 {
		return desktopClipboardCallError("empty clipboard", callErr)
	}
	result, _, callErr := procDesktopSetClipboardData.Call(cfHDrop, memory)
	if result == 0 {
		return desktopClipboardCallError("set clipboard file", callErr)
	}
	ownedByClipboard = true
	return nil
}

type desktopDropFiles struct {
	pFiles uint32
	ptX    int32
	ptY    int32
	fNC    int32
	fWide  int32
}

func encodeDesktopDropFiles(paths []string) ([]byte, error) {
	if len(paths) == 0 {
		return nil, fmt.Errorf("clipboard requires at least one file")
	}
	var names []uint16
	for _, path := range paths {
		if path == "" {
			return nil, fmt.Errorf("clipboard path is empty")
		}
		utf16Path, err := windows.UTF16FromString(path)
		if err != nil {
			return nil, fmt.Errorf("encode clipboard path: %w", err)
		}
		names = append(names, utf16Path...)
	}
	names = append(names, 0)
	headerSize := unsafe.Sizeof(desktopDropFiles{})
	data := make([]byte, int(headerSize)+len(names)*2)
	header := (*desktopDropFiles)(unsafe.Pointer(&data[0]))
	header.pFiles = uint32(headerSize)
	header.fWide = 1
	destination := unsafe.Slice((*uint16)(unsafe.Add(unsafe.Pointer(&data[0]), headerSize)), len(names))
	copy(destination, names)
	return data, nil
}

var (
	desktopClipboardKernel32         = windows.NewLazySystemDLL("kernel32.dll")
	procDesktopClipboardGlobalAlloc  = desktopClipboardKernel32.NewProc("GlobalAlloc")
	procDesktopClipboardGlobalFree   = desktopClipboardKernel32.NewProc("GlobalFree")
	procDesktopClipboardGlobalLock   = desktopClipboardKernel32.NewProc("GlobalLock")
	procDesktopClipboardGlobalUnlock = desktopClipboardKernel32.NewProc("GlobalUnlock")
	procDesktopOpenClipboard         = user32.NewProc("OpenClipboard")
	procDesktopCloseClipboard        = user32.NewProc("CloseClipboard")
	procDesktopEmptyClipboard        = user32.NewProc("EmptyClipboard")
	procDesktopSetClipboardData      = user32.NewProc("SetClipboardData")
)

func desktopClipboardCallError(action string, callErr error) error {
	if callErr != nil && callErr != windows.Errno(0) {
		return fmt.Errorf("%s: %w", action, callErr)
	}
	return fmt.Errorf("%s failed", action)
}
