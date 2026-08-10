package registry

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestShareStoreCreatePublishesMetadataAndContent(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	root := t.TempDir()
	store := newShareStore(shareStoreConfig{
		stateDir: root,
		now:      func() time.Time { return now },
		random:   bytes.NewReader(bytes.Repeat([]byte{0x42}, shareTokenBytes)),
	})

	result, err := store.create(shareCreateInput{
		ProjectID: "hub:project",
		Path:      "docs/readme.md",
		Kind:      "markdown",
		Title:     "Readme",
		Expiry:    "1d",
		Encoding:  "gzip+base64",
		Content:   gzipBase64ForTest(t, "<html><body>hello</body></html>"),
	})
	if err != nil {
		t.Fatalf("create() error = %v", err)
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(result.Record.Token) {
		t.Fatalf("token = %q, want 43-char base64url", result.Record.Token)
	}
	if result.Record.ExpiresAt == nil || !result.Record.ExpiresAt.Equal(now.Add(24*time.Hour)) {
		t.Fatalf("expiresAt = %v, want %v", result.Record.ExpiresAt, now.Add(24*time.Hour))
	}
	publicPath := filepath.Join(root, "shares", "public", "s", result.Record.Token)
	content, err := os.ReadFile(publicPath)
	if err != nil {
		t.Fatalf("read public content: %v", err)
	}
	if string(content) != "<html><body>hello</body></html>" {
		t.Fatalf("public content = %q", content)
	}
	metadataPath := filepath.Join(root, "shares", "records", result.Record.Token+".json")
	metadata, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var record shareRecord
	if err := json.Unmarshal(metadata, &record); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if record.Schema != shareRecordSchemaVersion || record.Token != result.Record.Token || record.SizeBytes != int64(len(content)) {
		t.Fatalf("metadata = %+v", record)
	}
}

func TestShareStoreRejectsOversizedDecodedContent(t *testing.T) {
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir()})
	content := strings.Repeat("x", maxShareHTMLBytes+1)
	_, err := store.create(shareCreateInput{
		ProjectID: "hub:project",
		Path:      "docs/readme.md",
		Kind:      "markdown",
		Title:     "Readme",
		Expiry:    "permanent",
		Encoding:  "gzip+base64",
		Content:   gzipBase64ForTest(t, content),
	})
	if err == nil || !strings.Contains(err.Error(), "16 MiB") {
		t.Fatalf("create() error = %v, want 16 MiB rejection", err)
	}
}

func TestShareStoreRetriesTokenCollision(t *testing.T) {
	root := t.TempDir()
	first := bytes.Repeat([]byte{0x11}, shareTokenBytes)
	second := bytes.Repeat([]byte{0x22}, shareTokenBytes)
	// First create consumes first; second create sees first again and must retry
	// before accepting the second token.
	randomBytes := append(append([]byte{}, first...), first...)
	randomBytes = append(randomBytes, second...)
	store := newShareStore(shareStoreConfig{stateDir: root, random: bytes.NewReader(randomBytes)})
	input := shareCreateInput{
		ProjectID: "hub:project", Path: "docs/readme.html", Kind: "html", Title: "Readme",
		Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>x</p>"),
	}
	firstResult, err := store.create(input)
	if err != nil {
		t.Fatal(err)
	}
	secondResult, err := store.create(input)
	if err != nil {
		t.Fatalf("collision retry create: %v", err)
	}
	if firstResult.Record.Token == secondResult.Record.Token {
		t.Fatalf("collision retry reused token %q", firstResult.Record.Token)
	}
}

func TestParseShareExpiryDefaultAndPermanent(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	got, err := parseShareExpiry("", now)
	if err != nil || got == nil || !got.Equal(now.Add(24*time.Hour)) {
		t.Fatalf("default expiry = %v, %v", got, err)
	}
	permanent, err := parseShareExpiry("permanent", now)
	if err != nil || permanent != nil {
		t.Fatalf("permanent expiry = %v, %v", permanent, err)
	}
}

func TestShareStoreRejectsInvalidUTF8(t *testing.T) {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write([]byte{0xff, 0xfe}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir()})
	_, err := store.create(shareCreateInput{
		ProjectID: "hub:project", Path: "docs/readme.html", Kind: "html", Title: "Readme",
		Expiry: "permanent", Encoding: "gzip+base64", Content: base64.StdEncoding.EncodeToString(compressed.Bytes()),
	})
	if err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("invalid UTF-8 error = %v", err)
	}
}

func TestShareStoreNextExpiryReturnsNearestDeadline(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir(), now: func() time.Time { return now }})
	if err := store.ensure(); err != nil {
		t.Fatal(err)
	}
	for index, expiresAt := range []*time.Time{timePtr(now.Add(3 * time.Hour)), timePtr(now.Add(time.Hour))} {
		token := strings.Repeat(string(rune('a'+index)), shareTokenLength)
		if !validShareToken(token) {
			t.Fatalf("test token %q is invalid", token)
		}
		writeTestShareRecord(t, filepath.Join(store.recordsDir, token+".json"), shareRecord{
			Schema: shareRecordSchemaVersion, Token: token, Title: "share", ProjectID: "hub:p", Path: "docs/a.html", Kind: "html",
			CreatedAt: now, ExpiresAt: expiresAt, SizeBytes: 1,
		})
	}
	next, ok := store.nextExpiry()
	if !ok || !next.Equal(now.Add(time.Hour)) {
		t.Fatalf("next expiry = %v, %v", next, ok)
	}
}

func TestShareStoreListUsesCursorAndLimit(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	root := t.TempDir()
	randomBytes := bytes.Repeat([]byte{0x7f}, shareTokenBytes)
	randomBytes = append(randomBytes, bytes.Repeat([]byte{0x7e}, shareTokenBytes)...)
	randomBytes = append(randomBytes, bytes.Repeat([]byte{0x7d}, shareTokenBytes)...)
	store := newShareStore(shareStoreConfig{stateDir: root, now: func() time.Time { return now }, random: bytes.NewReader(randomBytes)})
	for index, title := range []string{"first", "second", "third"} {
		created := now.Add(time.Duration(index) * time.Minute)
		store.now = func() time.Time { return created }
		if _, err := store.create(shareCreateInput{
			ProjectID: "hub:project", Path: "docs/readme.md", Kind: "markdown", Title: title,
			Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, title),
		}); err != nil {
			t.Fatalf("create %q: %v", title, err)
		}
	}
	store.now = func() time.Time { return now.Add(10 * time.Minute) }
	page, err := store.list("", 2)
	if err != nil {
		t.Fatalf("list() error = %v", err)
	}
	if len(page.Items) != 2 || page.NextCursor == "" || page.Items[0].Title != "third" {
		t.Fatalf("first page = %+v", page)
	}
	page2, err := store.list(page.NextCursor, 2)
	if err != nil {
		t.Fatalf("list(cursor) error = %v", err)
	}
	if len(page2.Items) != 1 || page2.Items[0].Title != "first" || page2.NextCursor != "" {
		t.Fatalf("second page = %+v", page2)
	}
}

func TestShareStoreRepairRemovesExpiredAndOrphanedFiles(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	root := t.TempDir()
	store := newShareStore(shareStoreConfig{stateDir: root, now: func() time.Time { return now }})
	if err := store.ensure(); err != nil {
		t.Fatal(err)
	}
	expired := strings.Repeat("a", 43)
	orphan := strings.Repeat("b", 43)
	writeTestShareRecord(t, filepath.Join(root, "shares", "records", expired+".json"), shareRecord{
		Schema: shareRecordSchemaVersion, Token: expired, Title: "old", ProjectID: "hub:p", Path: "old.md", Kind: "markdown",
		CreatedAt: now.Add(-2 * time.Hour), ExpiresAt: timePtr(now.Add(-time.Hour)), SizeBytes: 3,
	})
	if err := os.WriteFile(filepath.Join(root, "shares", "public", "s", expired), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "shares", "public", "s", orphan), []byte("orphan"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "shares", "records", ".share-temp"), []byte("temp"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.repair(); err != nil {
		t.Fatalf("repair() error = %v", err)
	}
	for _, path := range []string{
		filepath.Join(root, "shares", "records", expired+".json"),
		filepath.Join(root, "shares", "public", "s", expired),
		filepath.Join(root, "shares", "public", "s", orphan),
		filepath.Join(root, "shares", "records", ".share-temp"),
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("%s still exists, stat error = %v", path, err)
		}
	}
}

func TestShareStoreDeleteIsIdempotent(t *testing.T) {
	root := t.TempDir()
	store := newShareStore(shareStoreConfig{stateDir: root})
	result, err := store.create(shareCreateInput{
		ProjectID: "hub:project", Path: "docs/readme.html", Kind: "html", Title: "Readme",
		Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>x</p>"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.delete(result.Record.Token); err != nil {
		t.Fatalf("delete() error = %v", err)
	}
	if err := store.delete(result.Record.Token); err != nil {
		t.Fatalf("second delete() error = %v", err)
	}
}

func gzipBase64ForTest(t *testing.T, content string) string {
	t.Helper()
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	if _, err := writer.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func writeTestShareRecord(t *testing.T, path string, record shareRecord) {
	t.Helper()
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func timePtr(value time.Time) *time.Time { return &value }
