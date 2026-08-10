package registry

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	shareRecordSchemaVersion = 1
	shareTokenBytes          = 32
	shareTokenLength         = 43
	maxShareHTMLBytes        = 16 * 1024 * 1024
	defaultShareLimit        = 50
	maxShareLimit            = 100
	shareTokenAttempts       = 16
	shareTempFilePrefix      = ".share-"
)

var (
	errInvalidShareToken = errors.New("invalid share token")
	errShareContentLimit = fmt.Errorf("decoded share content exceeds 16 MiB")
	shareTokenPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
)

// shareStoreConfig contains the filesystem and clock dependencies used by the
// Registry share store. Tests inject a deterministic clock and random source.
type shareStoreConfig struct {
	stateDir string
	now      func() time.Time
	random   io.Reader
}

type shareStore struct {
	root       string
	recordsDir string
	publicDir  string
	now        func() time.Time
	random     io.Reader

	mu   sync.Mutex
	wake chan struct{}
}

type shareCreateInput struct {
	ProjectID string
	Path      string
	Kind      string
	Title     string
	Expiry    string
	Encoding  string
	Content   string
}

type shareRecord struct {
	Schema    int        `json:"schema"`
	Token     string     `json:"token"`
	Title     string     `json:"title"`
	ProjectID string     `json:"projectId"`
	Path      string     `json:"path"`
	Kind      string     `json:"kind"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	SizeBytes int64      `json:"sizeBytes"`
}

type shareCreateResult struct {
	Record shareRecord
}

type shareListPage struct {
	Items      []shareRecord
	NextCursor string
}

type shareCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	Token     string    `json:"token"`
}

func newShareStore(cfg shareStoreConfig) *shareStore {
	now := cfg.now
	if now == nil {
		now = time.Now
	}
	randomSource := cfg.random
	if randomSource == nil {
		randomSource = rand.Reader
	}
	root := filepath.Join(cfg.stateDir, "shares")
	return &shareStore{
		root:       root,
		recordsDir: filepath.Join(root, "records"),
		publicDir:  filepath.Join(root, "public", "s"),
		now:        now,
		random:     randomSource,
		wake:       make(chan struct{}, 1),
	}
}

func (s *shareStore) ensure() error {
	if s.root == "" || s.recordsDir == "" || s.publicDir == "" {
		return errors.New("share state directory is required")
	}
	for _, dir := range []string{s.recordsDir, s.publicDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create share directory %s: %w", dir, err)
		}
		if err := os.Chmod(dir, 0o700); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("protect share directory %s: %w", dir, err)
		}
	}
	return nil
}

func (s *shareStore) create(input shareCreateInput) (shareCreateResult, error) {
	var result shareCreateResult
	if err := validateShareInput(input); err != nil {
		return result, err
	}
	content, err := decodeShareContent(input.Encoding, input.Content)
	if err != nil {
		return result, err
	}
	now := s.now().UTC()
	expiresAt, err := parseShareExpiry(input.Expiry, now)
	if err != nil {
		return result, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensure(); err != nil {
		return result, err
	}
	createdAt := now
	for attempt := 0; attempt < shareTokenAttempts; attempt++ {
		token, err := s.newToken()
		if err != nil {
			return result, fmt.Errorf("generate share token: %w", err)
		}
		metadataPath := s.metadataPath(token)
		publicPath := s.publicPath(token)
		if pathExists(metadataPath) || pathExists(publicPath) {
			continue
		}
		record := shareRecord{
			Schema:    shareRecordSchemaVersion,
			Token:     token,
			Title:     input.Title,
			ProjectID: input.ProjectID,
			Path:      input.Path,
			Kind:      input.Kind,
			CreatedAt: createdAt,
			ExpiresAt: expiresAt,
			SizeBytes: int64(len(content)),
		}
		publicTemp, err := writeShareTemp(s.publicDir, content)
		if err != nil {
			return result, fmt.Errorf("stage share content: %w", err)
		}
		metadata, err := json.Marshal(record)
		if err != nil {
			_ = os.Remove(publicTemp)
			return result, fmt.Errorf("encode share metadata: %w", err)
		}
		metadataTemp, err := writeShareTemp(s.recordsDir, metadata)
		if err != nil {
			_ = os.Remove(publicTemp)
			return result, fmt.Errorf("stage share metadata: %w", err)
		}
		// Publish metadata first. A crash between these renames is repaired by
		// startup/list repair because records without public content are hidden.
		if err := os.Rename(metadataTemp, metadataPath); err != nil {
			_ = os.Remove(metadataTemp)
			_ = os.Remove(publicTemp)
			return result, fmt.Errorf("publish share metadata: %w", err)
		}
		if err := os.Rename(publicTemp, publicPath); err != nil {
			_ = os.Remove(publicTemp)
			_ = os.Remove(metadataPath)
			return result, fmt.Errorf("publish share content: %w", err)
		}
		s.signal()
		return shareCreateResult{Record: record}, nil
	}
	return result, errors.New("unable to allocate unique share token")
}

func (s *shareStore) newToken() (string, error) {
	var raw [shareTokenBytes]byte
	if _, err := io.ReadFull(s.random, raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func (s *shareStore) list(cursor string, limit int) (shareListPage, error) {
	if limit <= 0 {
		limit = defaultShareLimit
	}
	if limit > maxShareLimit {
		limit = maxShareLimit
	}
	wantCursor, err := decodeShareCursor(cursor)
	if err != nil {
		return shareListPage{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.repairLocked(); err != nil {
		return shareListPage{}, err
	}
	entries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		return shareListPage{}, fmt.Errorf("list share records: %w", err)
	}
	records := make([]shareRecord, 0, len(entries))
	now := s.now()
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		record, err := s.readRecordFile(filepath.Join(s.recordsDir, entry.Name()))
		if err != nil || !s.recordIsActive(record, now) || !isRegularFile(s.publicPath(record.Token)) {
			continue
		}
		if wantCursor != nil && !shareAfter(record, *wantCursor) {
			continue
		}
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return shareBefore(records[i], records[j]) })
	page := shareListPage{}
	if len(records) > limit {
		page.NextCursor = encodeShareCursor(shareCursorForRecord(records[limit-1]))
		records = records[:limit]
	}
	page.Items = records
	return page, nil
}

func (s *shareStore) delete(token string) error {
	if !validShareToken(token) {
		return errInvalidShareToken
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Remove public content before metadata so an interrupted delete cannot
	// leave an anonymously readable file with no management record.
	if err := removeIfExists(s.publicPath(token)); err != nil {
		return fmt.Errorf("remove share content: %w", err)
	}
	if err := removeIfExists(s.metadataPath(token)); err != nil {
		return fmt.Errorf("remove share metadata: %w", err)
	}
	s.signal()
	return nil
}

func (s *shareStore) repair() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repairLocked()
}

func (s *shareStore) repairLocked() error {
	if err := s.ensure(); err != nil {
		return err
	}
	for _, dir := range []string{s.recordsDir, s.publicDir} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return fmt.Errorf("scan share directory %s: %w", dir, err)
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), shareTempFilePrefix) {
				if !entry.IsDir() {
					_ = os.Remove(filepath.Join(dir, entry.Name()))
				}
			}
		}
	}
	recordEntries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		return fmt.Errorf("scan share records: %w", err)
	}
	now := s.now()
	for _, entry := range recordEntries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".json") {
			continue
		}
		token := strings.TrimSuffix(name, ".json")
		record, readErr := s.readRecordFile(filepath.Join(s.recordsDir, name))
		if readErr != nil || record.Token != token || !s.recordIsValid(record) || !s.recordIsActive(record, now) || !isRegularFile(s.publicPath(token)) {
			if validShareToken(token) {
				_ = os.Remove(s.publicPath(token))
			}
			_ = os.Remove(filepath.Join(s.recordsDir, name))
		}
	}
	publicEntries, err := os.ReadDir(s.publicDir)
	if err != nil {
		return fmt.Errorf("scan share public files: %w", err)
	}
	for _, entry := range publicEntries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !validShareToken(name) || !pathExists(s.metadataPath(name)) || !isRegularFile(filepath.Join(s.publicDir, name)) {
			_ = os.Remove(filepath.Join(s.publicDir, name))
		}
	}
	return nil
}

func (s *shareStore) start(ctx context.Context) error {
	if err := s.repair(); err != nil {
		return err
	}
	go s.expiryLoop(ctx)
	return nil
}

func (s *shareStore) expiryLoop(ctx context.Context) {
	for {
		next, ok := s.nextExpiry()
		if !ok {
			select {
			case <-ctx.Done():
				return
			case <-s.wake:
				continue
			}
		}
		delay := time.Until(next)
		if delay < 0 {
			delay = 0
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-s.wake:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			continue
		case <-timer.C:
			_ = s.cleanupExpired()
		}
	}
}

func (s *shareStore) cleanupExpired() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repairLocked()
}

func (s *shareStore) nextExpiry() (time.Time, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		return time.Time{}, false
	}
	var next time.Time
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		record, err := s.readRecordFile(filepath.Join(s.recordsDir, entry.Name()))
		if err != nil || record.ExpiresAt == nil {
			continue
		}
		if next.IsZero() || record.ExpiresAt.Before(next) {
			next = *record.ExpiresAt
		}
	}
	return next, !next.IsZero()
}

func (s *shareStore) signal() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *shareStore) metadataPath(token string) string {
	return filepath.Join(s.recordsDir, token+".json")
}

func (s *shareStore) publicPath(token string) string {
	return filepath.Join(s.publicDir, token)
}

func (s *shareStore) readRecordFile(path string) (shareRecord, error) {
	var record shareRecord
	data, err := os.ReadFile(path)
	if err != nil {
		return record, err
	}
	if err := json.Unmarshal(data, &record); err != nil {
		return record, err
	}
	return record, nil
}

func (s *shareStore) recordIsValid(record shareRecord) bool {
	return record.Schema == shareRecordSchemaVersion &&
		validShareToken(record.Token) &&
		(record.Kind == "markdown" || record.Kind == "html") &&
		validShareSourcePath(record.Path, record.Kind) &&
		!record.CreatedAt.IsZero() &&
		record.SizeBytes >= 0 && record.SizeBytes <= maxShareHTMLBytes &&
		(record.ExpiresAt == nil || !record.ExpiresAt.IsZero())
}

func (s *shareStore) recordIsActive(record shareRecord, now time.Time) bool {
	return s.recordIsValid(record) && (record.ExpiresAt == nil || now.Before(*record.ExpiresAt))
}

func validateShareInput(input shareCreateInput) error {
	if strings.TrimSpace(input.ProjectID) == "" {
		return errors.New("projectId is required")
	}
	if !validShareSourcePath(input.Path, input.Kind) {
		return errors.New("path or kind is invalid")
	}
	if strings.TrimSpace(input.Title) == "" {
		return errors.New("title is required")
	}
	if len(input.Title) > 512 {
		return errors.New("title is too long")
	}
	if input.Encoding != "gzip+base64" {
		return errors.New("encoding must be gzip+base64")
	}
	return nil
}

func validShareSourcePath(rawPath, kind string) bool {
	path := strings.TrimSpace(strings.ReplaceAll(rawPath, "\\", "/"))
	if path == "" || strings.HasPrefix(path, "/") || strings.Contains(path, "../") || path == ".." || strings.Contains(path, ":") {
		return false
	}
	if kind != "markdown" && kind != "html" {
		return false
	}
	ext := strings.ToLower(filepath.Ext(path))
	if kind == "markdown" {
		return ext == ".md" || ext == ".markdown"
	}
	return ext == ".html" || ext == ".htm"
}

func parseShareExpiry(raw string, now time.Time) (*time.Time, error) {
	switch strings.TrimSpace(raw) {
	case "", "1d":
		value := now.Add(24 * time.Hour)
		return &value, nil
	case "1h":
		value := now.Add(time.Hour)
		return &value, nil
	case "7d":
		value := now.Add(7 * 24 * time.Hour)
		return &value, nil
	case "30d":
		value := now.Add(30 * 24 * time.Hour)
		return &value, nil
	case "permanent":
		return nil, nil
	default:
		return nil, fmt.Errorf("unsupported expiry %q", raw)
	}
}

func decodeShareContent(encoding, encoded string) ([]byte, error) {
	if encoding != "gzip+base64" {
		return nil, errors.New("encoding must be gzip+base64")
	}
	compressed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("content must be base64: %w", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("content must be gzip: %w", err)
	}
	defer reader.Close()
	var output strings.Builder
	output.Grow(minInt(len(compressed)*2, maxShareHTMLBytes))
	limited := io.LimitReader(reader, maxShareHTMLBytes+1)
	if _, err := io.Copy(&output, limited); err != nil {
		return nil, fmt.Errorf("decompress content: %w", err)
	}
	content := []byte(output.String())
	if len(content) > maxShareHTMLBytes {
		return nil, errShareContentLimit
	}
	if !utf8.Valid(content) {
		return nil, errors.New("content must be valid UTF-8")
	}
	return content, nil
}

func writeShareTemp(dir string, data []byte) (string, error) {
	file, err := os.CreateTemp(dir, shareTempFilePrefix+"*")
	if err != nil {
		return "", err
	}
	path := file.Name()
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(path)
		}
	}()
	if err := file.Chmod(0o600); err != nil {
		return "", err
	}
	if _, err := file.Write(data); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	cleanup = false
	return path, nil
}

func removeIfExists(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func pathExists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func isRegularFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular()
}

func validShareToken(token string) bool {
	return len(token) == shareTokenLength && shareTokenPattern.MatchString(token)
}

func shareBefore(left, right shareRecord) bool {
	if !left.CreatedAt.Equal(right.CreatedAt) {
		return left.CreatedAt.After(right.CreatedAt)
	}
	return left.Token < right.Token
}

func shareAfter(record shareRecord, cursor shareCursor) bool {
	if !record.CreatedAt.Equal(cursor.CreatedAt) {
		return record.CreatedAt.Before(cursor.CreatedAt)
	}
	return record.Token > cursor.Token
}

func shareCursorForRecord(record shareRecord) shareCursor {
	return shareCursor{CreatedAt: record.CreatedAt, Token: record.Token}
}

func encodeShareCursor(cursor shareCursor) string {
	data, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(data)
}

func decodeShareCursor(raw string) (*shareCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, errors.New("invalid share cursor")
	}
	var cursor shareCursor
	if err := json.Unmarshal(data, &cursor); err != nil || cursor.Token == "" || cursor.CreatedAt.IsZero() {
		return nil, errors.New("invalid share cursor")
	}
	return &cursor, nil
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
