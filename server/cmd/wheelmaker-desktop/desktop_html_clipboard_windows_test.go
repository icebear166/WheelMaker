//go:build windows

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestEncodeDesktopVirtualHTMLFileClipboardData(t *testing.T) {
	if got, want := unsafe.Sizeof(desktopFileDescriptorW{}), uintptr(592); got != want {
		t.Fatalf("FILEDESCRIPTORW size = %d, want %d", got, want)
	}
	if got, want := unsafe.Sizeof(desktopFileDescriptorA{}), uintptr(332); got != want {
		t.Fatalf("FILEDESCRIPTORA size = %d, want %d", got, want)
	}
	content := []byte("<h1>Hello</h1>")
	unicodeDescriptor, err := encodeDesktopFileGroupDescriptorW("README.html", int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(unicodeDescriptor), int(unsafe.Sizeof(desktopFileGroupDescriptorW{})); got != want {
		t.Fatalf("Unicode descriptor size = %d, want %d", got, want)
	}
	unicodeHeader := (*desktopFileGroupDescriptorW)(unsafe.Pointer(&unicodeDescriptor[0]))
	if unicodeHeader.cItems != 1 {
		t.Fatalf("Unicode descriptor item count = %d, want 1", unicodeHeader.cItems)
	}
	if unicodeHeader.fgd[0].dwFlags&desktopFileDescriptorUnicode == 0 {
		t.Fatal("Unicode descriptor is missing FD_UNICODE")
	}
	if got := windows.UTF16ToString(unicodeHeader.fgd[0].cFileName[:]); got != "README.html" {
		t.Fatalf("Unicode descriptor file name = %q", got)
	}
	if got := uint64(unicodeHeader.fgd[0].nFileSizeHigh)<<32 | uint64(unicodeHeader.fgd[0].nFileSizeLow); got != uint64(len(content)) {
		t.Fatalf("Unicode descriptor file size = %d, want %d", got, len(content))
	}

	ansiDescriptor, err := encodeDesktopFileGroupDescriptorA("README.html", int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(ansiDescriptor), int(unsafe.Sizeof(desktopFileGroupDescriptorA{})); got != want {
		t.Fatalf("ANSI descriptor size = %d, want %d", got, want)
	}
	ansiHeader := (*desktopFileGroupDescriptorA)(unsafe.Pointer(&ansiDescriptor[0]))
	if ansiHeader.cItems != 1 {
		t.Fatalf("ANSI descriptor item count = %d, want 1", ansiHeader.cItems)
	}
	if got := bytes.TrimRight(ansiHeader.fgd[0].cFileName[:], "\x00"); string(got) != "README.html" {
		t.Fatalf("ANSI descriptor file name = %q", got)
	}

	if got := encodeDesktopPreferredDropEffect(); !bytes.Equal(got, []byte{1, 0, 0, 0}) {
		t.Fatalf("preferred drop effect = %v, want copy", got)
	}
}

func TestSetDesktopHTMLFileClipboardRawFallbackUsesOwnerWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "README.html")
	if err := os.WriteFile(path, []byte("<h1>Hello</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}

	const ownerWindow = uintptr(0x1234)
	var openedWindow uintptr
	setCount := 0
	nextFormat := uintptr(100)
	operations := desktopHTMLClipboardOperations{
		openClipboard: func(hwnd uintptr) error {
			openedWindow = hwnd
			return nil
		},
		closeClipboard: func() {},
		emptyClipboard: func() error { return nil },
		registerClipboardFormat: func(string) (uintptr, error) {
			format := nextFormat
			nextFormat++
			return format, nil
		},
		setClipboardData: func(uintptr, []byte, string) error {
			setCount++
			return nil
		},
	}

	if err := setDesktopHTMLFileClipboardWithOperations(ownerWindow, path, operations); err != nil {
		t.Fatal(err)
	}
	if openedWindow != ownerWindow {
		t.Fatalf("OpenClipboard hwnd = %#x, want %#x", openedWindow, ownerWindow)
	}
	if setCount != 5 {
		t.Fatalf("clipboard format count = %d, want 5", setCount)
	}
}

func TestSetDesktopHTMLFileClipboardUsesShellOLEDataObject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "README.html")
	if err := os.WriteFile(path, []byte("<h1>Hello</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}

	const dataObject = uintptr(0x4321)
	var createdPath string
	var setDataObject uintptr
	released := false
	operations := desktopFileClipboardOLEOperations{
		createDataObject: func(gotPath string) (uintptr, func(), error) {
			createdPath = gotPath
			return dataObject, func() { released = true }, nil
		},
		setClipboard: func(gotDataObject uintptr) error {
			setDataObject = gotDataObject
			return nil
		},
	}

	if err := setDesktopHTMLFileClipboardWithOLEOperations(path, operations); err != nil {
		t.Fatal(err)
	}
	if createdPath != path {
		t.Fatalf("Shell data object path = %q, want %q", createdPath, path)
	}
	if setDataObject != dataObject {
		t.Fatalf("OleSetClipboard data object = %#x, want %#x", setDataObject, dataObject)
	}
	if !released {
		t.Fatal("Shell data object was not released after OleSetClipboard")
	}
}

func TestNewDesktopShellFileDataObjectFromHTMLFile(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	path := filepath.Join(t.TempDir(), "README.html")
	if err := os.WriteFile(path, []byte("<h1>Hello</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := initializeDesktopClipboardOLE(); err != nil {
		t.Fatal(err)
	}
	defer uninitializeDesktopClipboardOLE()

	dataObject, release, err := newDesktopShellFileDataObject(path)
	if err != nil {
		t.Fatal(err)
	}
	if dataObject == 0 {
		t.Fatal("Shell data object is empty")
	}
	if release == nil {
		t.Fatal("Shell data object release function is nil")
	}
	release()
}

func TestDesktopHTMLClipboardTransferStoreKeepsNamedHtmlFile(t *testing.T) {
	store := newDesktopHTMLClipboardTransferStore(t.TempDir(), 8, 4)

	transferID, err := store.begin("README.html", 6)
	if err != nil {
		t.Fatal(err)
	}
	if ok := store.append(transferID, 0, []byte{1, 2, 3}); !ok {
		t.Fatal("first chunk was rejected")
	}
	if _, ok := store.commit(transferID); ok {
		t.Fatal("partial transfer committed")
	}
	if ok := store.append(transferID, 1, []byte{4, 5, 6}); !ok {
		t.Fatal("second chunk was rejected")
	}
	path, ok := store.commit(transferID)
	if !ok {
		t.Fatal("complete transfer was rejected")
	}
	if filepath.Base(path) != "README.html" {
		t.Fatalf("clipboard file name = %q", filepath.Base(path))
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(content), string([]byte{1, 2, 3, 4, 5, 6}); got != want {
		t.Fatalf("clipboard file content = %q, want %q", got, want)
	}
}

func TestDesktopHTMLClipboardTransferStoreRejectsUnsafeFileNames(t *testing.T) {
	store := newDesktopHTMLClipboardTransferStore(t.TempDir(), 8, 4)
	for _, fileName := range []string{"../escape.html", "report.txt", "", "folder\\report.html"} {
		if _, err := store.begin(fileName, 2); err == nil {
			t.Fatalf("begin(%q) accepted an unsafe file name", fileName)
		}
	}
}
