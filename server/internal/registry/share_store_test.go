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

func TestShareStoreSchema2Sources(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 30, 0, 0, time.UTC)
	tests := []struct {
		name       string
		input      shareCreateInput
		sourceType string
		sessionID  string
		turnIndex  int
	}{
		{
			name: "chat response",
			input: shareCreateInput{
				SourceType: "chat_response", ProjectID: "hub:p", SessionID: "sess-1", TurnIndex: 9,
				Title: "Answer", Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>answer</p>"),
			},
			sourceType: "chat_response",
			sessionID:  "sess-1",
			turnIndex:  9,
		},
		{
			name: "chat session",
			input: shareCreateInput{
				SourceType: "chat_session", ProjectID: "hub:p", SessionID: "sess-2",
				Title: "Session", Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>session</p>"),
			},
			sourceType: "chat_session",
			sessionID:  "sess-2",
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := newShareStore(shareStoreConfig{
				stateDir: t.TempDir(),
				now:      func() time.Time { return now },
				random:   bytes.NewReader(bytes.Repeat([]byte{byte(0x31 + index)}, shareTokenBytes)),
			})
			result, err := store.create(test.input)
			if err != nil {
				t.Fatalf("create() error = %v", err)
			}
			if result.Record.Schema != 2 || result.Record.SourceType != test.sourceType || result.Record.SessionID != test.sessionID || result.Record.TurnIndex != test.turnIndex {
				t.Fatalf("created record = %+v", result.Record)
			}
			if result.Record.Path != "" || result.Record.Kind != "" {
				t.Fatalf("chat record has project-document fields: %+v", result.Record)
			}
			page, err := store.list("", 10)
			if err != nil {
				t.Fatalf("list() error = %v", err)
			}
			if len(page.Items) != 1 || page.Items[0].SourceType != test.sourceType || page.Items[0].SessionID != test.sessionID || page.Items[0].TurnIndex != test.turnIndex {
				t.Fatalf("listed records = %+v", page.Items)
			}
		})
	}
}

func TestShareStoreRejectsInvalidSourceCombinations(t *testing.T) {
	validContent := gzipBase64ForTest(t, "<p>share</p>")
	tests := []struct {
		name  string
		input shareCreateInput
	}{
		{
			name:  "response missing session",
			input: shareCreateInput{SourceType: "chat_response", ProjectID: "hub:p", TurnIndex: 1, Title: "Answer", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "response non-positive turn",
			input: shareCreateInput{SourceType: "chat_response", ProjectID: "hub:p", SessionID: "sess-1", Title: "Answer", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "response with path",
			input: shareCreateInput{SourceType: "chat_response", ProjectID: "hub:p", SessionID: "sess-1", TurnIndex: 1, Path: "chat.md", Title: "Answer", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "session with kind",
			input: shareCreateInput{SourceType: "chat_session", ProjectID: "hub:p", SessionID: "sess-1", Kind: "html", Title: "Session", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "session with turn",
			input: shareCreateInput{SourceType: "chat_session", ProjectID: "hub:p", SessionID: "sess-1", TurnIndex: 2, Title: "Session", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "project missing path",
			input: shareCreateInput{SourceType: "project_document", ProjectID: "hub:p", Kind: "markdown", Title: "Doc", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "legacy project with session",
			input: shareCreateInput{ProjectID: "hub:p", Path: "docs/a.md", Kind: "markdown", SessionID: "sess-1", Title: "Doc", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := newShareStore(shareStoreConfig{stateDir: t.TempDir()})
			if _, err := store.create(test.input); err == nil {
				t.Fatalf("create(%+v) succeeded, want invalid source error", test.input)
			}
		})
	}
}

func TestShareStorePreservesSchema1ProjectRecord(t *testing.T) {
	now := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir(), now: func() time.Time { return now }})
	if err := store.ensure(); err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("l", shareTokenLength)
	metadataPath := filepath.Join(store.recordsDir, token+".json")
	writeTestShareRecord(t, metadataPath, shareRecord{
		Schema: 1, Token: token, Title: "Legacy", ProjectID: "hub:p", Path: "docs/legacy.md", Kind: "markdown",
		CreatedAt: now.Add(-time.Hour), ExpiresAt: timePtr(now.Add(time.Hour)), SizeBytes: 6,
	})
	if err := os.WriteFile(store.publicPath(token), []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.repair(); err != nil {
		t.Fatalf("repair() error = %v", err)
	}
	page, err := store.list("", 10)
	if err != nil {
		t.Fatalf("list() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].Schema != 1 || page.Items[0].SourceType != "project_document" || page.Items[0].Path != "docs/legacy.md" || page.Items[0].Kind != "markdown" {
		t.Fatalf("legacy list = %+v", page.Items)
	}
	metadata, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatalf("read legacy metadata: %v", err)
	}
	if bytes.Contains(metadata, []byte(`"sourceType"`)) {
		t.Fatalf("legacy metadata was rewritten: %s", metadata)
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
