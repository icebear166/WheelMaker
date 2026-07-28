//go:build windows

package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSetDesktopFileClipboardUsesShellOLEDataObject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.bin")
	if err := os.WriteFile(path, []byte{1, 2, 3}, 0o600); err != nil {
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

	if err := setDesktopFileClipboardWithOLEOperations(path, operations); err != nil {
		t.Fatal(err)
	}
	if createdPath != path || setDataObject != dataObject || !released {
		t.Fatalf("createdPath=%q setDataObject=%#x released=%v", createdPath, setDataObject, released)
	}
}

func TestSetDesktopFileClipboardRawFallbackPublishesDropFormats(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large-file.bin")
	if err := os.WriteFile(path, []byte{1}, 0o600); err != nil {
		t.Fatal(err)
	}

	const ownerWindow = uintptr(0x1234)
	var openedWindow uintptr
	var labels []string
	nextFormat := uintptr(100)
	operations := desktopFileClipboardOperations{
		openClipboard: func(hwnd uintptr) error {
			openedWindow = hwnd
			return nil
		},
		closeClipboard: func() {},
		emptyClipboard: func() error { return nil },
		registerClipboardFormat: func(name string) (uintptr, error) {
			if name != desktopPreferredDropEffectFormat {
				t.Fatalf("registered format %q", name)
			}
			format := nextFormat
			nextFormat++
			return format, nil
		},
		setClipboardData: func(_ uintptr, _ []byte, label string) error {
			labels = append(labels, label)
			return nil
		},
	}

	if err := setDesktopFileClipboardWithOperations(ownerWindow, path, operations); err != nil {
		t.Fatal(err)
	}
	if openedWindow != ownerWindow {
		t.Fatalf("OpenClipboard hwnd=%#x, want %#x", openedWindow, ownerWindow)
	}
	if got, want := labels, []string{"file drop", "preferred drop effect"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("clipboard labels=%v, want %v", got, want)
	}
}

func TestSetDesktopFileClipboardRejectsInvalidTargets(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "folder")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"relative.txt",
		filepath.Join(root, "missing.txt"),
		directory,
	} {
		t.Run(path, func(t *testing.T) {
			if err := setDesktopFileClipboardWithOLEOperations(path, desktopFileClipboardOLEOperations{}); err == nil {
				t.Fatal("setDesktopFileClipboardWithOLEOperations() error=nil")
			}
		})
	}
}
