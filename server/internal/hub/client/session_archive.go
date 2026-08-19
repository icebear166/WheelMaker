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

	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	sessionArchiveManifestVersion = 2
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
	SessionID              string                          `json:"sessionId"`
	ProjectName            string                          `json:"projectName"`
	Title                  string                          `json:"title,omitempty"`
	AgentType              string                          `json:"agentType,omitempty"`
	Storage                string                          `json:"storage"`
	File                   string                          `json:"file"`
	Offset                 int64                           `json:"offset"`
	Length                 int64                           `json:"length"`
	UncompressedLength     int64                           `json:"uncompressedLength"`
	Codec                  string                          `json:"codec"`
	SHA256                 string                          `json:"sha256"`
	UncompressedSHA256     string                          `json:"uncompressedSha256"`
	TurnCount              int                             `json:"turnCount"`
	GapCount               int                             `json:"gapCount"`
	WMT2Version            int                             `json:"wmt2Version"`
	ChunkSizeCode          int                             `json:"chunkSizeCode"`
	ArchivedAt             string                          `json:"archivedAt"`
	CreatedAt              string                          `json:"createdAt,omitempty"`
	UpdatedAt              string                          `json:"updatedAt,omitempty"`
	RestoredAt             string                          `json:"restoredAt,omitempty"`
	NativeArchivedAt       string                          `json:"nativeArchivedAt,omitempty"`
	NativeUnarchivedAt     string                          `json:"nativeUnarchivedAt,omitempty"`
	NativeSyncWarning      string                          `json:"nativeSyncWarning,omitempty"`
	ForkedFrom             *acp.SessionForkOrigin          `json:"forkedFrom,omitempty"`
	SessionFeatures        *acp.SessionFeatures            `json:"sessionFeatures,omitempty"`
	ArchiveGroupID         string                          `json:"archiveGroupId,omitempty"`
	MemberSessionIDs       []string                        `json:"memberSessionIds,omitempty"`
	SubagentCount          int                             `json:"subagentCount,omitempty"`
	SessionKind            string                          `json:"sessionKind,omitempty"`
	ParentSessionID        string                          `json:"parentSessionId,omitempty"`
	RootSessionID          string                          `json:"rootSessionId,omitempty"`
	ReadOnly               bool                            `json:"readOnly,omitempty"`
	SubagentName           string                          `json:"subagentName,omitempty"`
	SubagentRole           string                          `json:"subagentRole,omitempty"`
	SubagentStatus         subagentStatus                  `json:"subagentStatus,omitempty"`
	SubagentPrompt         string                          `json:"subagentPrompt,omitempty"`
	SpawnedAt              string                          `json:"spawnedAt,omitempty"`
	SpawnSequence          int64                           `json:"spawnSequence,omitempty"`
	ProviderThreadID       string                          `json:"providerThreadId,omitempty"`
	ParentProviderThreadID string                          `json:"parentProviderThreadId,omitempty"`
	SpawnItemID            string                          `json:"spawnItemId,omitempty"`
	ProviderReplay         sessionProviderReplayProjection `json:"providerReplay,omitempty"`
	SessionSyncJSON        string                          `json:"sessionSyncJson,omitempty"`
	AgentJSON              string                          `json:"agentJson,omitempty"`
}

type sessionArchiveSummary struct {
	SessionID          string                 `json:"sessionId"`
	ProjectName        string                 `json:"projectName"`
	Title              string                 `json:"title,omitempty"`
	AgentType          string                 `json:"agentType,omitempty"`
	CreatedAt          string                 `json:"createdAt,omitempty"`
	UpdatedAt          string                 `json:"updatedAt,omitempty"`
	ArchivedAt         string                 `json:"archivedAt"`
	RestoredAt         string                 `json:"restoredAt,omitempty"`
	TurnCount          int                    `json:"turnCount"`
	GapCount           int                    `json:"gapCount"`
	NativeArchivedAt   string                 `json:"nativeArchivedAt,omitempty"`
	NativeUnarchivedAt string                 `json:"nativeUnarchivedAt,omitempty"`
	NativeSyncWarning  string                 `json:"nativeSyncWarning,omitempty"`
	ForkedFrom         *acp.SessionForkOrigin `json:"forkedFrom,omitempty"`
	SessionFeatures    *acp.SessionFeatures   `json:"sessionFeatures,omitempty"`
	ArchiveGroupID     string                 `json:"archiveGroupId,omitempty"`
	SubagentCount      int                    `json:"subagentCount,omitempty"`
	SessionKind        string                 `json:"sessionKind,omitempty"`
	ParentSessionID    string                 `json:"parentSessionId,omitempty"`
	RootSessionID      string                 `json:"rootSessionId,omitempty"`
	ReadOnly           bool                   `json:"readOnly,omitempty"`
	SubagentName       string                 `json:"subagentName,omitempty"`
	SubagentRole       string                 `json:"subagentRole,omitempty"`
	SubagentStatus     subagentStatus         `json:"subagentStatus,omitempty"`
	SpawnedAt          string                 `json:"spawnedAt,omitempty"`
	SpawnSequence      int64                  `json:"spawnSequence,omitempty"`
}

type sessionArchiveAppend struct {
	Record           SessionRecord
	Contents         []string
	GapCount         int
	ArchiveGroupID   string
	MemberSessionIDs []string
	SubagentCount    int
}

type sessionArchiveReadMember struct {
	Entry    sessionArchiveManifestEntry
	Contents []string
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
	entries, written, err := s.AppendSessions(ctx, []sessionArchiveAppend{{
		Record:           rec,
		Contents:         contents,
		GapCount:         gapCount,
		ArchiveGroupID:   rec.ID,
		MemberSessionIDs: []string{rec.ID},
	}})
	if err != nil || len(entries) == 0 {
		return sessionArchiveManifestEntry{}, written, err
	}
	return entries[0], written, nil
}

func (s *sessionArchiveStore) AppendSessions(ctx context.Context, members []sessionArchiveAppend) ([]sessionArchiveManifestEntry, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return nil, false, fmt.Errorf("session archive store is required")
	}
	if len(members) == 0 {
		return nil, false, fmt.Errorf("archive members are required")
	}

	type preparedMember struct {
		append        sessionArchiveAppend
		segment       []byte
		wmt2Raw       []byte
		chunkSizeCode byte
	}
	prepared := make([]preparedMember, 0, len(members))
	projectName := strings.TrimSpace(members[0].Record.ProjectName)
	seen := make(map[string]bool, len(members))
	for _, member := range members {
		rec := member.Record
		rec.ID = strings.TrimSpace(rec.ID)
		rec.ProjectName = strings.TrimSpace(rec.ProjectName)
		if rec.ID == "" {
			return nil, false, fmt.Errorf("session id is required")
		}
		if rec.ProjectName == "" || rec.ProjectName != projectName {
			return nil, false, fmt.Errorf("archive members must share one project")
		}
		if seen[rec.ID] {
			return nil, false, fmt.Errorf("duplicate archive member: %s", rec.ID)
		}
		seen[rec.ID] = true
		member.Record = rec
		wmt2Raw, chunkSizeCode, err := buildArchiveWMT2(member.Contents)
		if err != nil {
			return nil, false, err
		}
		compressed, err := gzipBytes(wmt2Raw)
		if err != nil {
			return nil, false, err
		}
		segment, err := buildArchiveSegment(rec.ID, compressed, int64(len(wmt2Raw)))
		if err != nil {
			return nil, false, err
		}
		prepared = append(prepared, preparedMember{append: member, segment: segment, wmt2Raw: wmt2Raw, chunkSizeCode: chunkSizeCode})
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return nil, false, err
	}
	existingEntries := make([]sessionArchiveManifestEntry, 0, len(prepared))
	existingCount := 0
	for _, member := range prepared {
		if existing, ok := manifest.Sessions[member.append.Record.ID]; ok {
			existingEntries = append(existingEntries, existing)
			existingCount++
		}
	}
	if existingCount == len(prepared) {
		return existingEntries, false, nil
	}
	if existingCount != 0 {
		return nil, false, fmt.Errorf("archive group is only partially committed")
	}

	projectDir := s.projectDir(projectName)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return nil, false, fmt.Errorf("mkdir archive dir: %w", err)
	}
	packPath := filepath.Join(projectDir, sessionArchivePackFile)
	now := time.Now().UTC()
	archivedAt := now.Format(time.RFC3339)
	entries := make([]sessionArchiveManifestEntry, 0, len(prepared))
	for _, member := range prepared {
		offset, err := appendArchiveSegment(packPath, member.segment)
		if err != nil {
			return nil, false, err
		}
		rec := member.append.Record
		projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
		groupID := firstNonEmpty(strings.TrimSpace(member.append.ArchiveGroupID), rec.ID)
		memberIDs := append([]string(nil), member.append.MemberSessionIDs...)
		if len(memberIDs) == 0 {
			memberIDs = []string{rec.ID}
		}
		entry := sessionArchiveManifestEntry{
			SessionID: rec.ID, ProjectName: projectName, Title: strings.TrimSpace(rec.Title), AgentType: strings.TrimSpace(rec.AgentType),
			Storage: "pack", File: sessionArchivePackFile, Offset: offset, Length: int64(len(member.segment)),
			UncompressedLength: int64(len(member.wmt2Raw)), Codec: "gzip", SHA256: sha256Hex(member.segment),
			UncompressedSHA256: sha256Hex(member.wmt2Raw), TurnCount: len(member.append.Contents), GapCount: member.append.GapCount,
			WMT2Version: int(sessionTurnFileVersion), ChunkSizeCode: int(member.chunkSizeCode), ArchivedAt: archivedAt,
			CreatedAt: formatArchiveTime(rec.CreatedAt), UpdatedAt: formatArchiveTime(rec.LastActiveAt),
			ForkedFrom: cloneSessionForkOrigin(projection.ForkedFrom), SessionFeatures: sessionFeaturesFromAgentJSON(rec.AgentJSON),
			ArchiveGroupID: groupID, MemberSessionIDs: memberIDs, SubagentCount: member.append.SubagentCount,
			SessionKind: projection.SessionKind, ParentSessionID: projection.ParentSessionID, RootSessionID: projection.RootSessionID,
			ReadOnly: projection.ReadOnly, SubagentName: projection.SubagentName, SubagentRole: projection.SubagentRole,
			SubagentStatus: projection.SubagentStatus, SubagentPrompt: projection.SubagentPrompt, SpawnedAt: projection.SpawnedAt,
			SpawnSequence: projection.SpawnSequence, ProviderThreadID: projection.ProviderThreadID,
			ParentProviderThreadID: projection.ParentProviderThreadID, SpawnItemID: projection.SpawnItemID,
			ProviderReplay: projection.ProviderReplay, SessionSyncJSON: rec.SessionSyncJSON, AgentJSON: rec.AgentJSON,
		}
		entries = append(entries, entry)
		manifest.Sessions[rec.ID] = entry
	}
	manifest.Version = sessionArchiveManifestVersion
	manifest.UpdatedAt = archivedAt
	if err := s.writeManifestLocked(projectName, manifest); err != nil {
		return nil, false, err
	}
	return entries, true, nil
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
		if entry.SessionKind == sessionKindSubagent || (entry.RootSessionID != "" && entry.RootSessionID != entry.SessionID) {
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

func (s *sessionArchiveStore) ReadGroup(ctx context.Context, projectName, rootSessionID string) ([]sessionArchiveReadMember, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return nil, fmt.Errorf("session archive store is required")
	}
	rootSessionID = strings.TrimSpace(rootSessionID)
	if rootSessionID == "" {
		return nil, fmt.Errorf("root session id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return nil, err
	}
	root, ok := manifest.Sessions[rootSessionID]
	if !ok {
		return nil, fmt.Errorf("session archive not found: %s", rootSessionID)
	}
	if root.SessionKind == sessionKindSubagent || (root.RootSessionID != "" && root.RootSessionID != rootSessionID) {
		return nil, fmt.Errorf("archive group root is required: %s", rootSessionID)
	}
	if strings.TrimSpace(root.RestoredAt) != "" {
		return nil, fmt.Errorf("session archive already restored: %s", rootSessionID)
	}
	memberIDs := append([]string(nil), root.MemberSessionIDs...)
	if len(memberIDs) == 0 {
		memberIDs = []string{rootSessionID}
	}
	members := make([]sessionArchiveReadMember, 0, len(memberIDs))
	for _, memberID := range memberIDs {
		entry, ok := manifest.Sessions[strings.TrimSpace(memberID)]
		if !ok {
			return nil, fmt.Errorf("archive group %s is missing member %s", rootSessionID, memberID)
		}
		if entry.ArchiveGroupID != "" && entry.ArchiveGroupID != rootSessionID {
			return nil, fmt.Errorf("archive member %s belongs to group %s", memberID, entry.ArchiveGroupID)
		}
		if strings.TrimSpace(entry.RestoredAt) != "" {
			return nil, fmt.Errorf("session archive already restored: %s", memberID)
		}
		contents, err := s.readSessionContentsLocked(ctx, projectName, entry)
		if err != nil {
			return nil, err
		}
		members = append(members, sessionArchiveReadMember{Entry: entry, Contents: contents})
	}
	return members, nil
}

func (s *sessionArchiveStore) ReadGroupSession(ctx context.Context, projectName, rootSessionID, sessionID string) (sessionArchiveManifestEntry, []string, error) {
	members, err := s.ReadGroup(ctx, projectName, rootSessionID)
	if err != nil {
		return sessionArchiveManifestEntry{}, nil, err
	}
	sessionID = strings.TrimSpace(sessionID)
	for _, member := range members {
		if member.Entry.SessionID == sessionID {
			return member.Entry, member.Contents, nil
		}
	}
	return sessionArchiveManifestEntry{}, nil, fmt.Errorf("session %s is not a member of archive group %s", sessionID, rootSessionID)
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

func (s *sessionArchiveStore) MarkGroupRestored(ctx context.Context, projectName, rootSessionID, restoredAt string, nativeUpdate sessionArchiveNativeSyncUpdate) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	rootSessionID = strings.TrimSpace(rootSessionID)
	if rootSessionID == "" {
		return fmt.Errorf("root session id is required")
	}
	if restoredAt = strings.TrimSpace(restoredAt); restoredAt == "" {
		restoredAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.readManifestLocked(projectName)
	if err != nil {
		return err
	}
	root, ok := manifest.Sessions[rootSessionID]
	if !ok {
		return fmt.Errorf("session archive not found: %s", rootSessionID)
	}
	memberIDs := append([]string(nil), root.MemberSessionIDs...)
	if len(memberIDs) == 0 {
		memberIDs = []string{rootSessionID}
	}
	for _, memberID := range memberIDs {
		entry, ok := manifest.Sessions[memberID]
		if !ok {
			return fmt.Errorf("archive group %s is missing member %s", rootSessionID, memberID)
		}
		if strings.TrimSpace(entry.RestoredAt) != "" {
			return fmt.Errorf("session archive already restored: %s", memberID)
		}
	}
	for _, memberID := range memberIDs {
		entry := manifest.Sessions[memberID]
		entry.RestoredAt = restoredAt
		if memberID == rootSessionID {
			applySessionArchiveNativeSyncUpdate(&entry, nativeUpdate)
		}
		manifest.Sessions[memberID] = entry
	}
	manifest.Version = sessionArchiveManifestVersion
	manifest.UpdatedAt = restoredAt
	return s.writeManifestLocked(projectName, manifest)
}

func (s *sessionArchiveStore) DeleteProjectArtifacts(ctx context.Context, projectName string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s == nil || strings.TrimSpace(s.root) == "" {
		return fmt.Errorf("session archive store is required")
	}
	if err := os.RemoveAll(filepath.Join(s.projectDir(projectName), "artifacts")); err != nil {
		return fmt.Errorf("delete archived artifact dir: %w", err)
	}
	return nil
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
		manifest.Version = 1
	}
	if manifest.Version < 1 || manifest.Version > sessionArchiveManifestVersion {
		return manifest, fmt.Errorf("unsupported archive manifest version %d", manifest.Version)
	}
	if manifest.Sessions == nil {
		manifest.Sessions = map[string]sessionArchiveManifestEntry{}
	}
	return manifest, nil
}

func (s *sessionArchiveStore) writeManifestLocked(projectName string, manifest sessionArchiveManifest) error {
	manifest.Version = sessionArchiveManifestVersion
	for sessionID, entry := range manifest.Sessions {
		if strings.TrimSpace(entry.ArchiveGroupID) == "" {
			entry.ArchiveGroupID = sessionID
		}
		if len(entry.MemberSessionIDs) == 0 {
			entry.MemberSessionIDs = []string{sessionID}
		}
		manifest.Sessions[sessionID] = entry
	}
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
