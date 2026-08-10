package hub

import (
	"bytes"
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

type stubSessionAttachmentDownloadResolver struct {
	path     string
	fileName string
	mimeType string
	err      error
}

func (s stubSessionAttachmentDownloadResolver) ResolveSessionAttachmentDownload(context.Context, string, string, string) (string, string, string, error) {
	return s.path, s.fileName, s.mimeType, s.err
}

func TestFileDownloadManagerStreamsProjectFileInBoundedChunks(t *testing.T) {
	root := t.TempDir()
	want := bytes.Repeat([]byte("wheelmaker-download\x00"), fileDownloadChunkSize/10+31)
	path := filepath.Join(root, "large.bin")
	if err := os.WriteFile(path, want, 0o600); err != nil {
		t.Fatal(err)
	}

	manager := newFileDownloadManager()
	opened, err := manager.open(context.Background(), root, fileDownloadSource{Kind: fileDownloadSourceProject, Path: "large.bin"}, nil)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if opened.FileName != "large.bin" || opened.Size != int64(len(want)) || opened.TransferID == "" || opened.Identity == "" {
		t.Fatalf("open response=%+v", opened)
	}

	var got []byte
	var offset int64
	reads := 0
	for {
		chunk, readErr := manager.read(opened.TransferID, offset, fileDownloadChunkSize*4)
		if readErr != nil {
			t.Fatalf("read offset %d: %v", offset, readErr)
		}
		decoded, decodeErr := base64.StdEncoding.DecodeString(chunk.Data)
		if decodeErr != nil {
			t.Fatalf("decode: %v", decodeErr)
		}
		if len(decoded) > fileDownloadChunkSize {
			t.Fatalf("chunk size=%d, want <=%d", len(decoded), fileDownloadChunkSize)
		}
		got = append(got, decoded...)
		offset = chunk.NextOffset
		reads++
		if chunk.EOF {
			break
		}
	}
	if reads < 3 {
		t.Fatalf("reads=%d, want at least 3", reads)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("streamed content differs")
	}
	if manager.active() != 0 {
		t.Fatalf("active transfers=%d, want 0 after EOF", manager.active())
	}
}

func TestFileDownloadManagerRejectsInvalidTargetsAndOffsets(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "folder"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newFileDownloadManager()
	for name, source := range map[string]fileDownloadSource{
		"traversal":         {Kind: fileDownloadSourceProject, Path: "../escape.txt"},
		"directory":         {Kind: fileDownloadSourceProject, Path: "folder"},
		"relative external": {Kind: fileDownloadSourceExternal, Path: "relative.txt"},
	} {
		t.Run(name, func(t *testing.T) {
			if opened, err := manager.open(context.Background(), root, source, nil); err == nil {
				t.Fatalf("open=%+v, want error", opened)
			}
		})
	}

	opened, err := manager.open(context.Background(), root, fileDownloadSource{Kind: fileDownloadSourceProject, Path: "ok.txt"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.read(opened.TransferID, 1, fileDownloadChunkSize); err == nil {
		t.Fatal("out-of-order offset should fail")
	}
	if manager.active() != 0 {
		t.Fatal("invalid read should close the transfer")
	}
}

func TestFileDownloadManagerOpensExternalAndAttachmentFiles(t *testing.T) {
	root := t.TempDir()
	externalRoot := t.TempDir()
	externalPath := filepath.Join(externalRoot, "outside.txt")
	if err := os.WriteFile(externalPath, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newFileDownloadManager()
	external, err := manager.open(context.Background(), root, fileDownloadSource{Kind: fileDownloadSourceExternal, Path: externalPath}, nil)
	if err != nil || external.FileName != "outside.txt" {
		t.Fatalf("external=%+v err=%v", external, err)
	}
	manager.close(external.TransferID)

	attachment, err := manager.open(
		context.Background(),
		root,
		fileDownloadSource{Kind: fileDownloadSourceAttachment, SessionID: "session-1", AttachmentID: "sha256-value"},
		stubSessionAttachmentDownloadResolver{path: externalPath, fileName: "original name.txt", mimeType: "text/plain"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if attachment.FileName != "original name.txt" || attachment.MimeType != "text/plain" {
		t.Fatalf("attachment=%+v", attachment)
	}
	manager.closeAll()
	if manager.active() != 0 {
		t.Fatal("closeAll leaked a transfer")
	}
}

func TestFileDownloadManagerStopsWhenSourceChanges(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "changing.txt")
	if err := os.WriteFile(path, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newFileDownloadManager()
	opened, err := manager.open(context.Background(), root, fileDownloadSource{Kind: fileDownloadSourceProject, Path: "changing.txt"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("changed-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.read(opened.TransferID, 0, fileDownloadChunkSize); err == nil {
		t.Fatal("changed source should terminate transfer")
	}
	if manager.active() != 0 {
		t.Fatal("changed source leaked a transfer")
	}
}

func TestFileDownloadManagerBoundsConcurrentOpenTransfers(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "bounded.txt"), []byte("content"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newFileDownloadManager()
	for index := 0; index < fileDownloadMaxTransfers; index++ {
		if _, err := manager.open(context.Background(), root, fileDownloadSource{Kind: fileDownloadSourceProject, Path: "bounded.txt"}, nil); err != nil {
			t.Fatalf("open %d: %v", index, err)
		}
	}
	if _, err := manager.open(context.Background(), root, fileDownloadSource{Kind: fileDownloadSourceProject, Path: "bounded.txt"}, nil); err == nil {
		t.Fatal("transfer beyond capacity should fail")
	}
	if manager.active() != fileDownloadMaxTransfers {
		t.Fatalf("active=%d, want %d", manager.active(), fileDownloadMaxTransfers)
	}
	manager.closeAll()
}

func TestReporterHandlesFileDownloadOpen(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "report.txt"), []byte("report body"), 0o600); err != nil {
		t.Fatal(err)
	}
	responses := make(chan testEnvelope, 1)
	errorsSeen := make(chan error, 1)
	server := newFakeReporterRegistry(t, "hub-download", testEnvelope{
		RequestID: 81,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadOpen,
		ProjectID: rp.ProjectID("hub-download", "proj1"),
		Payload: map[string]any{
			"source": map[string]any{"kind": fileDownloadSourceProject, "path": "report.txt"},
		},
	}, responses, errorsSeen)

	ctx, cancel := context.WithCancel(context.Background())
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(server.URL, "http://"),
		HubID:             "hub-download",
		ReconnectInterval: time.Second,
	}, []ProjectInfo{{Name: "proj1", Path: root, Online: true}})
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()

	select {
	case err := <-errorsSeen:
		stopReporterForTest(t, cancel, done)
		t.Fatal(err)
	case response := <-responses:
		stopReporterForTest(t, cancel, done)
		if response.Type != rp.RegistryEnvelopeTypeResponse || response.Method != rp.RegistryMethodFileDownloadOpen {
			t.Fatalf("response=%+v", response)
		}
		if response.Payload["fileName"] != "report.txt" || response.Payload["size"] != float64(len("report body")) {
			t.Fatalf("payload=%+v", response.Payload)
		}
		if response.Payload["transferId"] == "" || response.Payload["identity"] == "" {
			t.Fatalf("payload=%+v", response.Payload)
		}
	case <-time.After(3 * time.Second):
		stopReporterForTest(t, cancel, done)
		t.Fatal("file download open response timed out")
	}
}
