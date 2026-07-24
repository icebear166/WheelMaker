//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

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
