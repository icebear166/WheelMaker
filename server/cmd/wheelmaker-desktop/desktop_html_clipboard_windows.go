//go:build windows

package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
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

	desktopFileDescriptorAttributes uint32 = 0x0004
	desktopFileDescriptorFileSize   uint32 = 0x0040
	desktopFileDescriptorUnicode    uint32 = 0x80000000
	desktopFileAttributeNormal      uint32 = 0x00000080
	desktopDropEffectCopy           uint32 = 0x00000001

	desktopFileDescriptorAFormatName = "FileGroupDescriptor"
	desktopFileDescriptorWFormatName = "FileGroupDescriptorW"
	desktopFileContentsFormatName    = "FileContents"
	desktopPreferredDropEffectFormat = "Preferred DropEffect"
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

type desktopHTMLClipboardOperations struct {
	openClipboard           func(uintptr) error
	closeClipboard          func()
	emptyClipboard          func() error
	registerClipboardFormat func(string) (uintptr, error)
	setClipboardData        func(uintptr, []byte, string) error
}

type desktopHTMLClipboardOLEOperations struct {
	createDataObject func(string) (uintptr, func(), error)
	setClipboard     func(uintptr) error
}

func setDesktopHTMLFileClipboard(hwnd uintptr, path string) error {
	oleErr := setDesktopHTMLFileClipboardWithOLEOperations(path, desktopHTMLClipboardOLEOperations{
		createDataObject: newDesktopShellFileDataObject,
		setClipboard:     setDesktopOLEClipboard,
	})
	if oleErr == nil {
		return nil
	}

	// Keep the raw clipboard path as a compatibility fallback for systems that
	// do not expose the Shell data-object APIs. OLE-aware targets use the path
	// above, while older targets can still consume the legacy formats below.
	rawErr := setDesktopHTMLFileClipboardWithOperations(hwnd, path, desktopHTMLClipboardOperations{
		openClipboard: func(owner uintptr) error {
			opened, _, callErr := procDesktopOpenClipboard.Call(owner)
			if opened == 0 {
				return desktopClipboardCallError("open clipboard", callErr)
			}
			return nil
		},
		closeClipboard: func() {
			procDesktopCloseClipboard.Call()
		},
		emptyClipboard: func() error {
			emptied, _, callErr := procDesktopEmptyClipboard.Call()
			if emptied == 0 {
				return desktopClipboardCallError("empty clipboard", callErr)
			}
			return nil
		},
		registerClipboardFormat: registerDesktopClipboardFormat,
		setClipboardData:        setDesktopGlobalClipboardData,
	})
	if rawErr == nil {
		return nil
	}
	return fmt.Errorf("set Shell/OLE HTML clipboard: %v; raw clipboard fallback: %w", oleErr, rawErr)
}

func setDesktopHTMLFileClipboardWithOLEOperations(
	path string,
	operations desktopHTMLClipboardOLEOperations,
) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat HTML clipboard file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("HTML clipboard path is not a regular file")
	}
	if info.Size() < 1 || info.Size() > maxDesktopHTMLClipboardBytes {
		return fmt.Errorf("HTML clipboard file size is invalid")
	}
	if operations.createDataObject == nil || operations.setClipboard == nil {
		return fmt.Errorf("HTML clipboard OLE operations are unavailable")
	}
	dataObject, release, err := operations.createDataObject(path)
	if err != nil {
		return err
	}
	if release != nil {
		defer release()
	}
	if dataObject == 0 {
		return fmt.Errorf("Shell data object is unavailable")
	}
	return operations.setClipboard(dataObject)
}

type desktopClipboardGUID struct {
	data1 uint32
	data2 uint16
	data3 uint16
	data4 [8]byte
}

var (
	desktopClipboardIIDShellFolder = desktopClipboardGUID{
		data1: 0x000214e6,
		data4: [8]byte{0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46},
	}
	desktopClipboardIIDDataObject = desktopClipboardGUID{
		data1: 0x0000010e,
		data4: [8]byte{0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46},
	}
)

func newDesktopShellFileDataObject(path string) (uintptr, func(), error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return 0, nil, fmt.Errorf("resolve HTML clipboard path: %w", err)
	}
	fullPIDL, err := parseDesktopShellPIDL(absolutePath)
	if err != nil {
		return 0, nil, err
	}
	defer windows.CoTaskMemFree(fullPIDL)

	parentPIDL, err := parseDesktopShellPIDL(filepath.Dir(absolutePath))
	if err != nil {
		return 0, nil, err
	}
	defer windows.CoTaskMemFree(parentPIDL)

	var parentFolder unsafe.Pointer
	var childPIDL unsafe.Pointer
	result, _, callErr := procDesktopClipboardSHBindToParent.Call(
		uintptr(fullPIDL),
		uintptr(unsafe.Pointer(&desktopClipboardIIDShellFolder)),
		uintptr(unsafe.Pointer(&parentFolder)),
		uintptr(unsafe.Pointer(&childPIDL)),
	)
	if err := desktopClipboardHRESULTError("bind HTML clipboard file to its parent", result, callErr); err != nil {
		return 0, nil, err
	}
	if parentFolder == nil || childPIDL == nil {
		return 0, nil, fmt.Errorf("Shell parent data for HTML clipboard file is unavailable")
	}
	defer releaseDesktopClipboardCOM(parentFolder)

	childPIDLs := [1]unsafe.Pointer{childPIDL}
	var dataObject unsafe.Pointer
	result, _, callErr = procDesktopClipboardSHCreateDataObject.Call(
		uintptr(parentPIDL),
		1,
		uintptr(unsafe.Pointer(&childPIDLs[0])),
		0,
		uintptr(unsafe.Pointer(&desktopClipboardIIDDataObject)),
		uintptr(unsafe.Pointer(&dataObject)),
	)
	runtime.KeepAlive(fullPIDL)
	runtime.KeepAlive(parentPIDL)
	runtime.KeepAlive(childPIDLs)
	if err := desktopClipboardHRESULTError("create HTML clipboard Shell data object", result, callErr); err != nil {
		return 0, nil, err
	}
	if dataObject == nil {
		return 0, nil, fmt.Errorf("HTML clipboard Shell data object is unavailable")
	}
	return uintptr(dataObject), func() {
		releaseDesktopClipboardCOM(dataObject)
	}, nil
}

func parseDesktopShellPIDL(path string) (unsafe.Pointer, error) {
	encodedPath, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, fmt.Errorf("encode Shell path: %w", err)
	}
	var pidl unsafe.Pointer
	var attributes uint32
	result, _, callErr := procDesktopClipboardSHParseDisplayName.Call(
		uintptr(unsafe.Pointer(encodedPath)),
		0,
		uintptr(unsafe.Pointer(&pidl)),
		0,
		uintptr(unsafe.Pointer(&attributes)),
	)
	if err := desktopClipboardHRESULTError("parse Shell path", result, callErr); err != nil {
		return nil, err
	}
	if pidl == nil {
		return nil, fmt.Errorf("Shell path returned an empty PIDL")
	}
	return pidl, nil
}

func releaseDesktopClipboardCOM(value unsafe.Pointer) {
	if value == nil {
		return
	}
	unknown := (*struct{ Vtbl *desktopIUnknownVtbl })(value)
	if unknown.Vtbl == nil {
		return
	}
	_, _, _ = unknown.Vtbl.Release.Call(uintptr(value))
}

func setDesktopOLEClipboard(dataObject uintptr) error {
	result, _, callErr := procDesktopClipboardOleSetClipboard.Call(dataObject)
	return desktopClipboardHRESULTError("set OLE clipboard", result, callErr)
}

func initializeDesktopClipboardOLE() error {
	result, _, callErr := procDesktopClipboardOleInitialize.Call(0)
	return desktopClipboardHRESULTError("initialize OLE clipboard", result, callErr)
}

func uninitializeDesktopClipboardOLE() {
	procDesktopClipboardOleUninitialize.Call()
}

func desktopClipboardHRESULTError(action string, result uintptr, _ error) error {
	if int32(result) < 0 {
		return fmt.Errorf("%s failed: HRESULT 0x%08x", action, uint32(result))
	}
	return nil
}

func setDesktopHTMLFileClipboardWithOperations(
	hwnd uintptr,
	path string,
	operations desktopHTMLClipboardOperations,
) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat HTML clipboard file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("HTML clipboard path is not a regular file")
	}
	if info.Size() < 1 || info.Size() > maxDesktopHTMLClipboardBytes {
		return fmt.Errorf("HTML clipboard file size is invalid")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read HTML clipboard file: %w", err)
	}
	fileName := filepath.Base(path)
	dropFiles, err := encodeDesktopDropFiles([]string{path})
	if err != nil {
		return err
	}
	descriptorW, err := encodeDesktopFileGroupDescriptorW(fileName, int64(len(content)))
	if err != nil {
		return err
	}
	descriptorA, err := encodeDesktopFileGroupDescriptorA(fileName, int64(len(content)))
	if err != nil {
		return err
	}
	descriptorAFormat, err := operations.registerClipboardFormat(desktopFileDescriptorAFormatName)
	if err != nil {
		return err
	}
	descriptorWFormat, err := operations.registerClipboardFormat(desktopFileDescriptorWFormatName)
	if err != nil {
		return err
	}
	contentsFormat, err := operations.registerClipboardFormat(desktopFileContentsFormatName)
	if err != nil {
		return err
	}
	preferredDropEffectFormat, err := operations.registerClipboardFormat(desktopPreferredDropEffectFormat)
	if err != nil {
		return err
	}

	// Keep CF_HDROP for filesystem-aware targets such as Explorer. IM/OLE
	// targets commonly consume the virtual-file descriptor and contents pair.
	if err := operations.openClipboard(hwnd); err != nil {
		return err
	}
	defer operations.closeClipboard()
	if err := operations.emptyClipboard(); err != nil {
		return err
	}
	for _, payload := range []struct {
		format uintptr
		data   []byte
		label  string
	}{
		{format: cfHDrop, data: dropFiles, label: "file drop"},
		{format: descriptorWFormat, data: descriptorW, label: "Unicode file descriptor"},
		{format: descriptorAFormat, data: descriptorA, label: "ANSI file descriptor"},
		{format: contentsFormat, data: content, label: "file contents"},
		{format: preferredDropEffectFormat, data: encodeDesktopPreferredDropEffect(), label: "preferred drop effect"},
	} {
		if err := operations.setClipboardData(payload.format, payload.data, payload.label); err != nil {
			return err
		}
	}
	return nil
}

type desktopFileTime struct {
	lowDateTime  uint32
	highDateTime uint32
}

type desktopFileDescriptorW struct {
	dwFlags          uint32
	clsid            [16]byte
	sizel            [2]int32
	pointl           [2]int32
	dwFileAttributes uint32
	ftCreationTime   desktopFileTime
	ftLastAccessTime desktopFileTime
	ftLastWriteTime  desktopFileTime
	nFileSizeHigh    uint32
	nFileSizeLow     uint32
	cFileName        [260]uint16
}

type desktopFileGroupDescriptorW struct {
	cItems uint32
	fgd    [1]desktopFileDescriptorW
}

type desktopFileDescriptorA struct {
	dwFlags          uint32
	clsid            [16]byte
	sizel            [2]int32
	pointl           [2]int32
	dwFileAttributes uint32
	ftCreationTime   desktopFileTime
	ftLastAccessTime desktopFileTime
	ftLastWriteTime  desktopFileTime
	nFileSizeHigh    uint32
	nFileSizeLow     uint32
	cFileName        [260]byte
}

type desktopFileGroupDescriptorA struct {
	cItems uint32
	fgd    [1]desktopFileDescriptorA
}

func encodeDesktopFileGroupDescriptorW(fileName string, fileSize int64) ([]byte, error) {
	if !isSafeDesktopHTMLFileName(fileName) {
		return nil, fmt.Errorf("HTML file name is invalid")
	}
	if fileSize < 0 {
		return nil, fmt.Errorf("HTML file size is invalid")
	}
	data := make([]byte, int(unsafe.Sizeof(desktopFileGroupDescriptorW{})))
	descriptor := (*desktopFileGroupDescriptorW)(unsafe.Pointer(&data[0]))
	descriptor.cItems = 1
	descriptor.fgd[0].dwFlags = desktopFileDescriptorAttributes |
		desktopFileDescriptorFileSize |
		desktopFileDescriptorUnicode
	descriptor.fgd[0].dwFileAttributes = desktopFileAttributeNormal
	descriptor.fgd[0].nFileSizeHigh = uint32(uint64(fileSize) >> 32)
	descriptor.fgd[0].nFileSizeLow = uint32(fileSize)
	encodedName, err := windows.UTF16FromString(fileName)
	if err != nil {
		return nil, fmt.Errorf("encode Unicode HTML file name: %w", err)
	}
	copy(descriptor.fgd[0].cFileName[:], encodedName)
	return data, nil
}

func encodeDesktopFileGroupDescriptorA(fileName string, fileSize int64) ([]byte, error) {
	if !isSafeDesktopHTMLFileName(fileName) {
		return nil, fmt.Errorf("HTML file name is invalid")
	}
	if fileSize < 0 {
		return nil, fmt.Errorf("HTML file size is invalid")
	}
	data := make([]byte, int(unsafe.Sizeof(desktopFileGroupDescriptorA{})))
	descriptor := (*desktopFileGroupDescriptorA)(unsafe.Pointer(&data[0]))
	descriptor.cItems = 1
	descriptor.fgd[0].dwFlags = desktopFileDescriptorAttributes | desktopFileDescriptorFileSize
	descriptor.fgd[0].dwFileAttributes = desktopFileAttributeNormal
	descriptor.fgd[0].nFileSizeHigh = uint32(uint64(fileSize) >> 32)
	descriptor.fgd[0].nFileSizeLow = uint32(fileSize)
	copy(descriptor.fgd[0].cFileName[:], []byte(fileName))
	return data, nil
}

func encodeDesktopPreferredDropEffect() []byte {
	return []byte{
		byte(desktopDropEffectCopy),
		byte(desktopDropEffectCopy >> 8),
		byte(desktopDropEffectCopy >> 16),
		byte(desktopDropEffectCopy >> 24),
	}
}

func registerDesktopClipboardFormat(name string) (uintptr, error) {
	encodedName, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, fmt.Errorf("encode clipboard format %q: %w", name, err)
	}
	format, _, callErr := procDesktopRegisterClipboardFormat.Call(uintptr(unsafe.Pointer(encodedName)))
	if format == 0 {
		return 0, desktopClipboardCallError(fmt.Sprintf("register clipboard format %q", name), callErr)
	}
	return format, nil
}

func setDesktopGlobalClipboardData(format uintptr, data []byte, label string) error {
	if len(data) == 0 {
		return fmt.Errorf("clipboard %s is empty", label)
	}
	memory, _, callErr := procDesktopClipboardGlobalAlloc.Call(gmemMoveable, uintptr(len(data)))
	if memory == 0 {
		return desktopClipboardCallError(fmt.Sprintf("allocate clipboard %s", label), callErr)
	}
	ownedByClipboard := false
	defer func() {
		if !ownedByClipboard {
			procDesktopClipboardGlobalFree.Call(memory)
		}
	}()
	locked, _, callErr := procDesktopClipboardGlobalLock.Call(memory)
	if locked == 0 {
		return desktopClipboardCallError(fmt.Sprintf("lock clipboard %s", label), callErr)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(locked)), len(data)), data)
	procDesktopClipboardGlobalUnlock.Call(memory)
	result, _, callErr := procDesktopSetClipboardData.Call(format, memory)
	if result == 0 {
		return desktopClipboardCallError(fmt.Sprintf("set clipboard %s", label), callErr)
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
	desktopClipboardKernel32               = windows.NewLazySystemDLL("kernel32.dll")
	desktopClipboardShell32                = windows.NewLazySystemDLL("shell32.dll")
	desktopClipboardOle32                  = windows.NewLazySystemDLL("ole32.dll")
	procDesktopClipboardGlobalAlloc        = desktopClipboardKernel32.NewProc("GlobalAlloc")
	procDesktopClipboardGlobalFree         = desktopClipboardKernel32.NewProc("GlobalFree")
	procDesktopClipboardGlobalLock         = desktopClipboardKernel32.NewProc("GlobalLock")
	procDesktopClipboardGlobalUnlock       = desktopClipboardKernel32.NewProc("GlobalUnlock")
	procDesktopClipboardSHParseDisplayName = desktopClipboardShell32.NewProc("SHParseDisplayName")
	procDesktopClipboardSHBindToParent     = desktopClipboardShell32.NewProc("SHBindToParent")
	procDesktopClipboardSHCreateDataObject = desktopClipboardShell32.NewProc("SHCreateDataObject")
	procDesktopClipboardOleInitialize      = desktopClipboardOle32.NewProc("OleInitialize")
	procDesktopClipboardOleUninitialize    = desktopClipboardOle32.NewProc("OleUninitialize")
	procDesktopClipboardOleSetClipboard    = desktopClipboardOle32.NewProc("OleSetClipboard")
	procDesktopOpenClipboard               = user32.NewProc("OpenClipboard")
	procDesktopCloseClipboard              = user32.NewProc("CloseClipboard")
	procDesktopEmptyClipboard              = user32.NewProc("EmptyClipboard")
	procDesktopRegisterClipboardFormat     = user32.NewProc("RegisterClipboardFormatW")
	procDesktopSetClipboardData            = user32.NewProc("SetClipboardData")
)

func desktopClipboardCallError(action string, callErr error) error {
	if callErr != nil && callErr != windows.Errno(0) {
		return fmt.Errorf("%s: %w", action, callErr)
	}
	return fmt.Errorf("%s failed", action)
}
