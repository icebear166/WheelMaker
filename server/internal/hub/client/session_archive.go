package client

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	sessionArchiveManifestVersion = 1
	sessionArchivePackFile        = "archive.pack"
	sessionArchiveSegmentMagic    = "WMSA"
	sessionArchiveSegmentVersion  = uint16(1)
	sessionArchiveCodecGzip       = byte(1)
	sessionArchiveMaxChunkCode    = byte(10)
	sessionArchiveGapMethod       = "session/archive_gap"
)

type sessionArchiveStore struct {
	root string
	mu   sync.Mutex
}

type sessionArchiveManifest struct {
	Version   int                                    `json:"version"`
	UpdatedAt string                                 `json:"updatedAt"`
	Sessions  map[string]sessionArchiveManifestEntry `json:"sessions"`
}

type sessionArchiveManifestEntry struct {
	SessionID          string `json:"sessionId"`
	ProjectName        string `json:"projectName"`
	Title              string `json:"title,omitempty"`
	AgentType          string `json:"agentType,omitempty"`
	Storage            string `json:"storage"`
	File               string `json:"file"`
	Offset             int64  `json:"offset"`
	Length             int64  `json:"length"`
	UncompressedLength int64  `json:"uncompressedLength"`
	Codec              string `json:"codec"`
	SHA256             string `json:"sha256"`
	UncompressedSHA256 string `json:"uncompressedSha256"`
	TurnCount          int    `json:"turnCount"`
	GapCount           int    `json:"gapCount"`
	WMT2Version        int    `json:"wmt2Version"`
	ChunkSizeCode      int    `json:"chunkSizeCode"`
	ArchivedAt         string `json:"archivedAt"`
	CreatedAt          string `json:"createdAt,omitempty"`
	UpdatedAt          string `json:"updatedAt,omitempty"`
	RestoredAt         string `json:"restoredAt,omitempty"`
	NativeArchivedAt   string `json:"nativeArchivedAt,omitempty"`
	NativeUnarchivedAt string `json:"nativeUnarchivedAt,omitempty"`
	NativeSyncWarning  string `json:"nativeSyncWarning,omitempty"`
}

type sessionArchiveSummary struct {
	SessionID          string `json:"sessionId"`
	ProjectName        string `json:"projectName"`
	Title              string `json:"title,omitempty"`
	AgentType          string `json:"agentType,omitempty"`
	CreatedAt          string `json:"createdAt,omitempty"`
	UpdatedAt          string `json:"updatedAt,omitempty"`
	ArchivedAt         string `json:"archivedAt"`
	RestoredAt         string `json:"restoredAt,omitempty"`
	TurnCount          int    `json:"turnCount"`
	GapCount           int    `json:"gapCount"`
	NativeArchivedAt   string `json:"nativeArchivedAt,omitempty"`
	NativeUnarchivedAt string `json:"nativeUnarchivedAt,omitempty"`
	NativeSyncWarning  string `json:"nativeSyncWarning,omitempty"`
}

type sessionArchiveNativeSyncUpdate struct {
	NativeArchivedAt   string
	NativeUnarchivedAt string
	NativeSyncWarning  string
}

func newSessionArchiveStore(root string) *sessionArchiveStore {
	return &sessionArchiveStore{root: strings.TrimSpace(root)}
}

func (s *sessionArchiveStore) HasSession(ctx context.Context, projectName, sessionID string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return false, fmt.Errorf("session archive store is required")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false, fmt.Errorf("session id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return false, err
	}
	_, ok := manifest.Sessions[sessionID]
	return ok, nil
}

func (s *sessionArchiveStore) AppendSession(ctx context.Context, rec SessionRecord, contents []string, gapCount int) (sessionArchiveManifestEntry, bool, error) {
	if err := ctx.Err(); err != nil {
		return sessionArchiveManifestEntry{}, false, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return sessionArchiveManifestEntry{}, false, fmt.Errorf("session archive store is required")
	}
	sessionID := strings.TrimSpace(rec.ID)
	projectName := strings.TrimSpace(rec.ProjectName)
	if sessionID == "" {
		return sessionArchiveManifestEntry{}, false, fmt.Errorf("session id is required")
	}
	if projectName == "" {
		return sessionArchiveManifestEntry{}, false, fmt.Errorf("project name is required")
	}

	wmt2Raw, chunkSizeCode, err := buildArchiveWMT2(contents)
	if err != nil {
		return sessionArchiveManifestEntry{}, false, err
	}
	compressed, err := gzipBytes(wmt2Raw)
	if err != nil {
		return sessionArchiveManifestEntry{}, false, err
	}
	segment, err := buildArchiveSegment(sessionID, compressed, int64(len(wmt2Raw)))
	if err != nil {
		return sessionArchiveManifestEntry{}, false, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return sessionArchiveManifestEntry{}, false, err
	}
	if existing, ok := manifest.Sessions[sessionID]; ok {
		return existing, false, nil
	}

	projectDir := s.projectDir(projectName)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return sessionArchiveManifestEntry{}, false, fmt.Errorf("mkdir archive dir: %w", err)
	}
	packPath := filepath.Join(projectDir, sessionArchivePackFile)
	offset, err := appendArchiveSegment(packPath, segment)
	if err != nil {
		return sessionArchiveManifestEntry{}, false, err
	}

	now := time.Now().UTC()
	entry := sessionArchiveManifestEntry{
		SessionID:          sessionID,
		ProjectName:        projectName,
		Title:              strings.TrimSpace(rec.Title),
		AgentType:          strings.TrimSpace(rec.AgentType),
		Storage:            "pack",
		File:               sessionArchivePackFile,
		Offset:             offset,
		Length:             int64(len(segment)),
		UncompressedLength: int64(len(wmt2Raw)),
		Codec:              "gzip",
		SHA256:             sha256Hex(segment),
		UncompressedSHA256: sha256Hex(wmt2Raw),
		TurnCount:          len(contents),
		GapCount:           gapCount,
		WMT2Version:        int(sessionTurnFileVersion),
		ChunkSizeCode:      int(chunkSizeCode),
		ArchivedAt:         now.Format(time.RFC3339),
		CreatedAt:          formatArchiveTime(rec.CreatedAt),
		UpdatedAt:          formatArchiveTime(rec.LastActiveAt),
	}
	manifest.Version = sessionArchiveManifestVersion
	manifest.UpdatedAt = entry.ArchivedAt
	manifest.Sessions[sessionID] = entry
	if err := s.writeManifestLocked(projectName, manifest); err != nil {
		return sessionArchiveManifestEntry{}, false, err
	}
	return entry, true, nil
}

func (s *sessionArchiveStore) ListSessions(ctx context.Context, projectName string) ([]sessionArchiveManifestEntry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return nil, fmt.Errorf("session archive store is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return nil, err
	}
	entries := make([]sessionArchiveManifestEntry, 0, len(manifest.Sessions))
	for _, entry := range manifest.Sessions {
		if strings.TrimSpace(entry.RestoredAt) != "" {
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		left := archiveSortTime(entries[i])
		right := archiveSortTime(entries[j])
		if left == right {
			return entries[i].SessionID < entries[j].SessionID
		}
		return left > right
	})
	return entries, nil
}

func (s *sessionArchiveStore) ReadSession(ctx context.Context, projectName, sessionID string) (sessionArchiveManifestEntry, []string, error) {
	if err := ctx.Err(); err != nil {
		return sessionArchiveManifestEntry{}, nil, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return sessionArchiveManifestEntry{}, nil, fmt.Errorf("session archive store is required")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return sessionArchiveManifestEntry{}, nil, fmt.Errorf("session id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return sessionArchiveManifestEntry{}, nil, err
	}
	entry, ok := manifest.Sessions[sessionID]
	if !ok {
		return sessionArchiveManifestEntry{}, nil, fmt.Errorf("session archive not found: %s", sessionID)
	}
	if strings.TrimSpace(entry.RestoredAt) != "" {
		return sessionArchiveManifestEntry{}, nil, fmt.Errorf("session archive already restored: %s", sessionID)
	}
	contents, err := s.readSessionContentsLocked(ctx, projectName, entry)
	if err != nil {
		return sessionArchiveManifestEntry{}, nil, err
	}
	return entry, contents, nil
}

func (s *sessionArchiveStore) MarkRestored(ctx context.Context, projectName, sessionID, restoredAt string, nativeUpdate sessionArchiveNativeSyncUpdate) (sessionArchiveManifestEntry, error) {
	if err := ctx.Err(); err != nil {
		return sessionArchiveManifestEntry{}, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return sessionArchiveManifestEntry{}, fmt.Errorf("session archive store is required")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return sessionArchiveManifestEntry{}, fmt.Errorf("session id is required")
	}
	restoredAt = strings.TrimSpace(restoredAt)
	if restoredAt == "" {
		restoredAt = time.Now().UTC().Format(time.RFC3339)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return sessionArchiveManifestEntry{}, err
	}
	entry, ok := manifest.Sessions[sessionID]
	if !ok {
		return sessionArchiveManifestEntry{}, fmt.Errorf("session archive not found: %s", sessionID)
	}
	if strings.TrimSpace(entry.RestoredAt) != "" {
		return sessionArchiveManifestEntry{}, fmt.Errorf("session archive already restored: %s", sessionID)
	}
	entry.RestoredAt = restoredAt
	applySessionArchiveNativeSyncUpdate(&entry, nativeUpdate)
	manifest.Sessions[sessionID] = entry
	manifest.UpdatedAt = restoredAt
	if err := s.writeManifestLocked(projectName, manifest); err != nil {
		return sessionArchiveManifestEntry{}, err
	}
	return entry, nil
}

func (s *sessionArchiveStore) CopyArtifactsFromSession(ctx context.Context, sourceRoot, projectName, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return fmt.Errorf("session archive store is required")
	}
	sourceStore := newFileSessionArtifactStore(sourceRoot)
	return copySessionArtifactDir(ctx, sourceStore.artifactDir(projectName, sessionID), s.artifactDir(projectName, sessionID))
}

func (s *sessionArchiveStore) RestoreArtifactsToSession(ctx context.Context, targetRoot, projectName, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return fmt.Errorf("session archive store is required")
	}
	targetStore := newFileSessionArtifactStore(targetRoot)
	return copySessionArtifactDir(ctx, s.artifactDir(projectName, sessionID), targetStore.artifactDir(projectName, sessionID))
}

func (s *sessionArchiveStore) ReadArtifact(ctx context.Context, projectName, sessionID, artifactID string) (sessionArtifactReadResult, error) {
	if err := ctx.Err(); err != nil {
		return sessionArtifactReadResult{}, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return sessionArtifactReadResult{}, fmt.Errorf("session archive store is required")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return sessionArtifactReadResult{}, fmt.Errorf("session id is required")
	}
	if !validSessionArtifactID(artifactID) {
		return sessionArtifactReadResult{}, fmt.Errorf("invalid artifact id: %s", artifactID)
	}
	raw, err := os.ReadFile(filepath.Join(s.artifactDir(projectName, sessionID), artifactID+".diff"))
	if os.IsNotExist(err) {
		return sessionArtifactReadResult{}, fmt.Errorf("artifact not found: %s", artifactID)
	}
	if err != nil {
		return sessionArtifactReadResult{}, fmt.Errorf("read archived artifact: %w", err)
	}
	return sessionArtifactReadResult{
		ArtifactID: artifactID,
		Type:       sessionArtifactTypeDiff,
		Format:     sessionArtifactFormatDiff,
		Content:    string(raw),
	}, nil
}

func (s *sessionArchiveStore) UpdateNativeSync(ctx context.Context, projectName, sessionID string, update sessionArchiveNativeSyncUpdate) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return fmt.Errorf("session archive store is required")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return err
	}
	entry, ok := manifest.Sessions[sessionID]
	if !ok {
		return fmt.Errorf("session archive not found: %s", sessionID)
	}
	applySessionArchiveNativeSyncUpdate(&entry, update)
	manifest.Sessions[sessionID] = entry
	manifest.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return s.writeManifestLocked(projectName, manifest)
}

func (s *sessionArchiveStore) readSessionContentsLocked(ctx context.Context, projectName string, entry sessionArchiveManifestEntry) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(entry.Storage) != "pack" {
		return nil, fmt.Errorf("unsupported archive storage: %s", entry.Storage)
	}
	if strings.TrimSpace(entry.File) == "" {
		return nil, fmt.Errorf("archive file is required")
	}
	if entry.Offset < 0 || entry.Length <= 0 {
		return nil, fmt.Errorf("invalid archive segment bounds")
	}
	packPath := filepath.Join(s.projectDir(projectName), entry.File)
	f, err := os.Open(packPath)
	if err != nil {
		return nil, fmt.Errorf("open archive pack: %w", err)
	}
	defer f.Close()
	segment := make([]byte, entry.Length)
	if _, err := f.ReadAt(segment, entry.Offset); err != nil {
		return nil, fmt.Errorf("read archive segment: %w", err)
	}
	return decodeArchiveSegment(entry, segment)
}

func decodeArchiveSegment(entry sessionArchiveManifestEntry, segment []byte) ([]string, error) {
	if strings.TrimSpace(entry.SHA256) != "" {
		if got := sha256Hex(segment); got != strings.TrimSpace(entry.SHA256) {
			return nil, fmt.Errorf("archive segment sha256 mismatch: got %s want %s", got, entry.SHA256)
		}
	}
	if len(segment) < 26 {
		return nil, fmt.Errorf("archive segment too short")
	}
	if string(segment[0:4]) != sessionArchiveSegmentMagic {
		return nil, fmt.Errorf("invalid archive segment magic")
	}
	if version := binary.LittleEndian.Uint16(segment[4:6]); version != sessionArchiveSegmentVersion {
		return nil, fmt.Errorf("unsupported archive segment version %d", version)
	}
	if codec := segment[6]; codec != sessionArchiveCodecGzip {
		return nil, fmt.Errorf("unsupported archive codec %d", codec)
	}
	sessionIDLen := int(binary.LittleEndian.Uint16(segment[8:10]))
	compressedLen := int64(binary.LittleEndian.Uint64(segment[10:18]))
	uncompressedLen := int64(binary.LittleEndian.Uint64(segment[18:26]))
	payloadStart := 26 + sessionIDLen
	payloadEnd := payloadStart + int(compressedLen)
	if sessionIDLen <= 0 || payloadStart > len(segment) || payloadEnd != len(segment) {
		return nil, fmt.Errorf("invalid archive segment payload bounds")
	}
	if gotSessionID := string(segment[26:payloadStart]); gotSessionID != strings.TrimSpace(entry.SessionID) {
		return nil, fmt.Errorf("archive segment session id = %q, want %q", gotSessionID, entry.SessionID)
	}
	if entry.UncompressedLength > 0 && uncompressedLen != entry.UncompressedLength {
		return nil, fmt.Errorf("archive uncompressed length = %d, want %d", uncompressedLen, entry.UncompressedLength)
	}
	reader, err := gzip.NewReader(bytes.NewReader(segment[payloadStart:payloadEnd]))
	if err != nil {
		return nil, fmt.Errorf("open archive gzip payload: %w", err)
	}
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read archive gzip payload: %w", err)
	}
	if int64(len(raw)) != uncompressedLen {
		return nil, fmt.Errorf("archive gzip length = %d, want %d", len(raw), uncompressedLen)
	}
	if strings.TrimSpace(entry.UncompressedSHA256) != "" {
		if got := sha256Hex(raw); got != strings.TrimSpace(entry.UncompressedSHA256) {
			return nil, fmt.Errorf("archive payload sha256 mismatch: got %s want %s", got, entry.UncompressedSHA256)
		}
	}
	return decodeArchiveWMT2(entry, raw)
}

func decodeArchiveWMT2(entry sessionArchiveManifestEntry, raw []byte) ([]string, error) {
	if len(raw) < sessionTurnFilePreambleSize {
		return nil, fmt.Errorf("archive WMT2 payload too short")
	}
	if string(raw[0:4]) != sessionTurnFileMagic {
		return nil, fmt.Errorf("invalid archive WMT2 magic")
	}
	if version := binary.LittleEndian.Uint16(raw[4:6]); version != sessionTurnFileVersion {
		return nil, fmt.Errorf("unsupported archive WMT2 version %d", version)
	}
	code := raw[6]
	if code > sessionArchiveMaxChunkCode {
		return nil, fmt.Errorf("unsupported archive WMT2 chunk size code %d", code)
	}
	if raw[7] != sessionTurnFileReservedByte {
		return nil, fmt.Errorf("unsupported archive WMT2 reserved byte %d", raw[7])
	}
	capacity := int(sessionTurnCapacityForCode(code))
	if entry.TurnCount < 0 || entry.TurnCount > capacity {
		return nil, fmt.Errorf("archive turn count %d exceeds capacity %d", entry.TurnCount, capacity)
	}
	headerSize := sessionTurnFilePreambleSize + capacity*sessionTurnFileMetaSize
	if len(raw) < headerSize {
		return nil, fmt.Errorf("archive WMT2 header too short")
	}
	contents := make([]string, 0, entry.TurnCount)
	for slot := 0; slot < entry.TurnCount; slot++ {
		pos := sessionTurnFilePreambleSize + slot*sessionTurnFileMetaSize
		offset := binary.LittleEndian.Uint32(raw[pos : pos+4])
		length := binary.LittleEndian.Uint32(raw[pos+4 : pos+8])
		if offset == 0 || length == 0 {
			return nil, fmt.Errorf("archive turn %d is missing", slot+1)
		}
		end := int(offset) + int(length)
		if int(offset) < headerSize || end > len(raw) {
			return nil, fmt.Errorf("archive turn %d points outside payload", slot+1)
		}
		contents = append(contents, string(raw[int(offset):end]))
	}
	return contents, nil
}

func archiveSortTime(entry sessionArchiveManifestEntry) string {
	if updatedAt := strings.TrimSpace(entry.UpdatedAt); updatedAt != "" {
		return updatedAt
	}
	return strings.TrimSpace(entry.ArchivedAt)
}

func applySessionArchiveNativeSyncUpdate(entry *sessionArchiveManifestEntry, update sessionArchiveNativeSyncUpdate) {
	if entry == nil {
		return
	}
	if value := strings.TrimSpace(update.NativeArchivedAt); value != "" {
		entry.NativeArchivedAt = value
	}
	if value := strings.TrimSpace(update.NativeUnarchivedAt); value != "" {
		entry.NativeUnarchivedAt = value
	}
	entry.NativeSyncWarning = strings.TrimSpace(update.NativeSyncWarning)
}

func (s *sessionArchiveStore) readManifestLocked(projectName string) (sessionArchiveManifest, error) {
	manifest := sessionArchiveManifest{
		Version:  sessionArchiveManifestVersion,
		Sessions: map[string]sessionArchiveManifestEntry{},
	}
	path := s.manifestPath(projectName)
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return manifest, nil
	}
	if err != nil {
		return manifest, fmt.Errorf("read archive manifest: %w", err)
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return manifest, fmt.Errorf("decode archive manifest: %w", err)
	}
	if manifest.Version == 0 {
		manifest.Version = sessionArchiveManifestVersion
	}
	if manifest.Sessions == nil {
		manifest.Sessions = map[string]sessionArchiveManifestEntry{}
	}
	return manifest, nil
}

func (s *sessionArchiveStore) writeManifestLocked(projectName string, manifest sessionArchiveManifest) error {
	projectDir := s.projectDir(projectName)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return fmt.Errorf("mkdir archive dir: %w", err)
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encode archive manifest: %w", err)
	}
	path := s.manifestPath(projectName)
	tmpPath := path + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open archive manifest temp: %w", err)
	}
	if _, err := f.Write(raw); err != nil {
		_ = f.Close()
		return fmt.Errorf("write archive manifest temp: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return fmt.Errorf("sync archive manifest temp: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close archive manifest temp: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(path)
		if retryErr := os.Rename(tmpPath, path); retryErr != nil {
			return fmt.Errorf("replace archive manifest: %w", err)
		}
	}
	return nil
}

func (s *sessionArchiveStore) manifestPath(projectName string) string {
	return filepath.Join(s.projectDir(projectName), "manifest.json")
}

func (s *sessionArchiveStore) projectDir(projectName string) string {
	return filepath.Join(s.root, safeHistoryPathPart(projectName))
}

func (s *sessionArchiveStore) artifactDir(projectName, sessionID string) string {
	return filepath.Join(s.projectDir(projectName), "artifacts", safeHistoryPathPart(sessionID))
}

func copySessionArtifactDir(ctx context.Context, sourceDir string, targetDir string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	entries, err := os.ReadDir(sourceDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read artifact dir: %w", err)
	}
	if err := os.RemoveAll(targetDir); err != nil {
		return fmt.Errorf("reset artifact target dir: %w", err)
	}
	wrote := false
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".diff") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(sourceDir, entry.Name()))
		if err != nil {
			return fmt.Errorf("read artifact file: %w", err)
		}
		if !wrote {
			if err := os.MkdirAll(targetDir, 0o755); err != nil {
				return fmt.Errorf("mkdir artifact target dir: %w", err)
			}
			wrote = true
		}
		if err := os.WriteFile(filepath.Join(targetDir, entry.Name()), raw, 0o644); err != nil {
			return fmt.Errorf("write artifact file: %w", err)
		}
	}
	return nil
}

func buildArchiveWMT2(contents []string) ([]byte, byte, error) {
	if len(contents) > int(sessionTurnCapacityForCode(sessionArchiveMaxChunkCode)) {
		return nil, 0, fmt.Errorf("session turn count %d exceeds archive capacity", len(contents))
	}
	chunkSizeCode := archiveChunkSizeCode(len(contents))
	capacity := int(sessionTurnCapacityForCode(chunkSizeCode))
	headerSize := sessionTurnFilePreambleSize + capacity*sessionTurnFileMetaSize
	raw := make([]byte, headerSize)
	copy(raw[0:4], sessionTurnFileMagic)
	binary.LittleEndian.PutUint16(raw[4:6], sessionTurnFileVersion)
	raw[6] = chunkSizeCode
	raw[7] = sessionTurnFileReservedByte

	for slot, content := range contents {
		if content == "" {
			return nil, 0, fmt.Errorf("archive turn content is required")
		}
		if len(content) > math.MaxUint32 {
			return nil, 0, fmt.Errorf("archive turn content too large")
		}
		offset := len(raw)
		if offset+len(content) > math.MaxUint32 {
			return nil, 0, fmt.Errorf("archive WMT2 payload too large")
		}
		raw = append(raw, content...)
		slotPos := sessionTurnFilePreambleSize + slot*sessionTurnFileMetaSize
		binary.LittleEndian.PutUint32(raw[slotPos:slotPos+4], uint32(offset))
		binary.LittleEndian.PutUint32(raw[slotPos+4:slotPos+8], uint32(len(content)))
	}
	return raw, chunkSizeCode, nil
}

func archiveChunkSizeCode(turnCount int) byte {
	for code := byte(0); code <= sessionArchiveMaxChunkCode; code++ {
		if turnCount <= int(sessionTurnCapacityForCode(code)) {
			return code
		}
	}
	return sessionArchiveMaxChunkCode
}

func sessionTurnCapacityForCode(code byte) int {
	return sessionTurnsPerFile << code
}

func buildArchiveSegment(sessionID string, compressedPayload []byte, uncompressedLen int64) ([]byte, error) {
	if strings.TrimSpace(sessionID) == "" {
		return nil, fmt.Errorf("session id is required")
	}
	if len(sessionID) > math.MaxUint16 {
		return nil, fmt.Errorf("session id too long")
	}
	if len(compressedPayload) > math.MaxInt64 {
		return nil, fmt.Errorf("archive payload too large")
	}
	headerSize := 26 + len(sessionID)
	segment := make([]byte, headerSize)
	copy(segment[0:4], sessionArchiveSegmentMagic)
	binary.LittleEndian.PutUint16(segment[4:6], sessionArchiveSegmentVersion)
	segment[6] = sessionArchiveCodecGzip
	segment[7] = 0
	binary.LittleEndian.PutUint16(segment[8:10], uint16(len(sessionID)))
	binary.LittleEndian.PutUint64(segment[10:18], uint64(len(compressedPayload)))
	binary.LittleEndian.PutUint64(segment[18:26], uint64(uncompressedLen))
	copy(segment[26:headerSize], sessionID)
	segment = append(segment, compressedPayload...)
	return segment, nil
}

func appendArchiveSegment(path string, segment []byte) (int64, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return 0, fmt.Errorf("open archive pack: %w", err)
	}
	defer f.Close()
	offset, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, fmt.Errorf("seek archive pack: %w", err)
	}
	if _, err := f.Write(segment); err != nil {
		return 0, fmt.Errorf("write archive segment: %w", err)
	}
	if err := f.Sync(); err != nil {
		return 0, fmt.Errorf("sync archive pack: %w", err)
	}
	return offset, nil
}

func gzipBytes(raw []byte) ([]byte, error) {
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	if _, err := writer.Write(raw); err != nil {
		_ = writer.Close()
		return nil, fmt.Errorf("gzip archive payload: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("close gzip archive payload: %w", err)
	}
	return buf.Bytes(), nil
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("%x", sum)
}

func archiveGapTurnJSON() string {
	return buildSessionTurnContentJSON(sessionArchiveGapMethod, map[string]string{"reason": "missing_turn"})
}

func formatArchiveTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
