package tools

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestDebugWebTransferReceiverAppliesVerifiedArchive(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "web", "index.html"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	archive := debugWebZip(t, map[string]string{"index.html": "new"})
	receiver := newDebugWebTransferReceiver(root)
	transferID := "transfer-verified"
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveStart, map[string]any{"transferId": transferID, "size": len(archive), "sha256": debugWebDigest(archive)}, "accepted")
	middle := len(archive) / 2
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveChunk, map[string]any{"transferId": transferID, "sequence": 0, "data": base64.StdEncoding.EncodeToString(archive[:middle])}, "accepted")
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveChunk, map[string]any{"transferId": transferID, "sequence": 1, "data": base64.StdEncoding.EncodeToString(archive[middle:])}, "accepted")
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveFinish, map[string]any{"transferId": transferID}, "success")

	current, err := os.ReadFile(filepath.Join(root, "web", "index.html"))
	if err != nil || string(current) != "new" {
		t.Fatalf("web=%q err=%v", current, err)
	}
	if _, err := os.Stat(filepath.Join(root, updateStagingDirectoryName, updateLeaseFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("lease remains: %v", err)
	}
}

func TestDebugWebTransferReceiverPreservesWebOnDigestMismatch(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "web", "index.html"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	receiver := newDebugWebTransferReceiver(root)
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveStart, map[string]any{"transferId": "transfer-bad", "size": 3, "sha256": strings.Repeat("a", 64)}, "accepted")
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveChunk, map[string]any{"transferId": "transfer-bad", "sequence": 0, "data": base64.StdEncoding.EncodeToString([]byte("zip"))}, "accepted")
	raw, _ := json.Marshal(map[string]any{"transferId": "transfer-bad"})
	status, commandErr := receiver.Handle(rp.RegistryMethodHubDebugWebReceiveFinish, raw)
	if commandErr == nil || status.ErrorCode != "debug_web_digest_mismatch" {
		t.Fatalf("status=%#v err=%v", status, commandErr)
	}
	current, _ := os.ReadFile(filepath.Join(root, "web", "index.html"))
	if string(current) != "old" {
		t.Fatalf("existing web replaced: %q", current)
	}
}

func TestDebugWebTransferReceiverRejectsOutOfOrderChunk(t *testing.T) {
	receiver := newDebugWebTransferReceiver(t.TempDir())
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveStart, map[string]any{"transferId": "transfer-order", "size": 3, "sha256": debugWebDigest([]byte("zip"))}, "accepted")
	raw, _ := json.Marshal(map[string]any{"transferId": "transfer-order", "sequence": 1, "data": base64.StdEncoding.EncodeToString([]byte("zip"))})
	status, commandErr := receiver.Handle(rp.RegistryMethodHubDebugWebReceiveChunk, raw)
	if commandErr == nil || status.ErrorCode != "debug_web_sequence_mismatch" {
		t.Fatalf("status=%#v err=%v", status, commandErr)
	}
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveAbort, map[string]any{"transferId": "transfer-order"}, "aborted")
}

func mustHandleDebugWebTransfer(t *testing.T, receiver *debugWebTransferReceiver, method string, payload map[string]any, want string) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	status, commandErr := receiver.Handle(method, raw)
	if commandErr != nil || status.Status != want {
		t.Fatalf("method=%s status=%#v err=%v", method, status, commandErr)
	}
}

func debugWebZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
func debugWebDigest(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:])
}
