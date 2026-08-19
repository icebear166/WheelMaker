package wiki

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifyRootAcceptsCompleteReleaseAndRejectsTampering(t *testing.T) {
	root := createTestRelease(t)
	if err := VerifyRoot(root); err != nil {
		t.Fatalf("VerifyRoot() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "data", "catalog.json"), []byte(`{"articleCount":2}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyRoot(root); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("VerifyRoot(tampered) error = %v", err)
	}
}

func TestVerifyRootRejectsUnlistedFiles(t *testing.T) {
	root := createTestRelease(t)
	if err := os.WriteFile(filepath.Join(root, "extra.txt"), []byte("extra"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyRoot(root); err == nil || !strings.Contains(err.Error(), "unlisted") {
		t.Fatalf("VerifyRoot(unlisted) error = %v", err)
	}
}
