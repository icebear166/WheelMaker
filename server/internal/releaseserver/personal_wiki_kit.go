package releaseserver

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var kitVersionPattern = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)

type kitStartRequest struct {
	Version   string `json:"version"`
	SourceSHA string `json:"sourceSha"`
	Publisher string `json:"publisher"`
}

type kitStartResponse struct {
	Schema      int    `json:"schema"`
	SessionID   string `json:"sessionId"`
	Version     string `json:"version"`
	PublishedAt string `json:"publishedAt"`
}

type kitPublishSession struct {
	Schema       int                 `json:"schema"`
	SessionID    string              `json:"sessionId"`
	Version      string              `json:"version"`
	SourceSHA    string              `json:"sourceSha"`
	Publisher    string              `json:"publisher"`
	PublishedAt  string              `json:"publishedAt"`
	UpdatedAt    string              `json:"updatedAt"`
	AllowedFiles map[string]fileRule `json:"allowedFiles"`
	Files        map[string]fileInfo `json:"files"`
}

type kitArtifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type kitStableDocument struct {
	Schema      int                    `json:"schema"`
	Version     string                 `json:"version"`
	PublishedAt string                 `json:"publishedAt"`
	SourceSHA   string                 `json:"sourceSha"`
	Setup       kitArtifact            `json:"setup"`
	Artifacts   map[string]kitArtifact `json:"artifacts"`
}

func (s *Server) handlePersonalWikiKitAPI(w http.ResponseWriter, r *http.Request) bool {
	const root = "/api/personal-wiki-kit"
	if r.URL.Path == root+"/start" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return true
		}
		s.handleKitStart(w, r)
		return true
	}
	if !strings.HasPrefix(r.URL.Path, root+"/") {
		return false
	}
	if encodedPathEscapesSegments(r.URL) || strings.Contains(r.URL.Path, "\\") {
		writeError(w, http.StatusBadRequest, "invalid_publish_path")
		return true
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, root+"/"), "/")
	if len(parts) == 0 || !validLowerHex(parts[0], 16) {
		writeError(w, http.StatusBadRequest, "invalid_session_id")
		return true
	}
	sessionID := parts[0]
	switch {
	case len(parts) == 1 && r.Method == http.MethodDelete:
		s.handleKitCancel(w, sessionID)
	case len(parts) == 2 && parts[1] == "commit" && r.Method == http.MethodPost:
		s.handleKitCommit(w, sessionID)
	case len(parts) == 3 && parts[1] == "files" && r.Method == http.MethodPut:
		s.handleKitUpload(w, r, sessionID, parts[2])
	case len(parts) == 1 || (len(parts) == 2 && parts[1] == "commit") || (len(parts) >= 2 && parts[1] == "files"):
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	default:
		writeError(w, http.StatusBadRequest, "invalid_publish_path")
	}
	return true
}

func (s *Server) handleKitStart(w http.ResponseWriter, r *http.Request) {
	var request kitStartRequest
	if err := decodeStrictJSON(r.Body, maxJSONBodySize, &request); err != nil ||
		!kitVersionPattern.MatchString(request.Version) ||
		!validLowerHex(request.SourceSHA, 20) ||
		(request.Publisher != "local" && request.Publisher != "action") {
		writeError(w, http.StatusBadRequest, "invalid_kit_start_request")
		return
	}
	now := s.now().UTC().Format(time.RFC3339)
	for attempts := 0; attempts < 8; attempts++ {
		sessionID, err := s.newSessionID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		session := kitPublishSession{
			Schema:       1,
			SessionID:    sessionID,
			Version:      request.Version,
			SourceSHA:    request.SourceSHA,
			Publisher:    request.Publisher,
			PublishedAt:  now,
			UpdatedAt:    now,
			AllowedFiles: allowedKitFiles(request.Version),
			Files:        map[string]fileInfo{},
		}
		created, err := s.createKitSession(session)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		if created {
			writeJSON(w, http.StatusCreated, kitStartResponse{Schema: 1, SessionID: sessionID, Version: request.Version, PublishedAt: now})
			return
		}
	}
	writeError(w, http.StatusInternalServerError, "session_create_failed")
}

func allowedKitFiles(version string) map[string]fileRule {
	return map[string]fileRule{
		"setup-wiki.bat":                        {MaxSize: maxControlFileSize},
		kitArtifactName(version, "windows-x64"): {MaxSize: maxBinaryFileSize},
		kitArtifactName(version, "linux-x64"):   {MaxSize: maxBinaryFileSize},
	}
}

func kitArtifactName(version, platform string) string {
	extension := "zip"
	if platform == "linux-x64" {
		extension = "tar.gz"
	}
	return "personal-wiki-kit-v" + version + "-" + platform + "." + extension
}

func (s *Server) handleKitUpload(w http.ResponseWriter, r *http.Request, sessionID, filename string) {
	if filename == "" || strings.ContainsAny(filename, "/\\") {
		writeError(w, http.StatusBadRequest, "invalid_file_name")
		return
	}
	if r.ContentLength < 0 {
		writeError(w, http.StatusLengthRequired, "content_length_required")
		return
	}
	digest := r.Header.Get("X-WheelMaker-SHA256")
	if !validLowerHex(digest, sha256.Size) {
		writeError(w, http.StatusBadRequest, "invalid_file_digest")
		return
	}
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	session, err := s.loadKitSession(sessionID)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "session_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_read_failed")
		return
	}
	rule, allowed := session.AllowedFiles[filename]
	if !allowed {
		writeError(w, http.StatusBadRequest, "file_not_allowed")
		return
	}
	if r.ContentLength > rule.MaxSize {
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large")
		return
	}
	var total int64 = r.ContentLength
	for name, existing := range session.Files {
		if name != filename {
			total += existing.Size
		}
	}
	if total > maxSessionSize {
		writeError(w, http.StatusRequestEntityTooLarge, "session_too_large")
		return
	}
	freeBytes, err := s.diskFree(s.config.DataRoot)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_check_failed")
		return
	}
	if freeBytes < uint64(r.ContentLength)+(1<<30) {
		writeError(w, http.StatusInsufficientStorage, "insufficient_storage")
		return
	}
	filesDirectory := s.kitSessionFilesDirectory(sessionID)
	temporary, err := os.CreateTemp(filesDirectory, ".upload-*.tmp")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	temporaryPath := temporary.Name()
	completed := false
	defer func() {
		_ = temporary.Close()
		if !completed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	hasher := sha256.New()
	written, err := copyDeclaredFile(temporary, hasher, r.Body, r.ContentLength)
	if err != nil || written != r.ContentLength {
		writeError(w, http.StatusUnprocessableEntity, "file_size_mismatch")
		return
	}
	actualDigest := hex.EncodeToString(hasher.Sum(nil))
	if actualDigest != digest {
		writeError(w, http.StatusUnprocessableEntity, "file_digest_mismatch")
		return
	}
	if err := temporary.Sync(); err != nil || temporary.Close() != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	if err := os.Rename(temporaryPath, filepath.Join(filesDirectory, filename)); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	completed = true
	session.Files[filename] = fileInfo{Size: written, SHA256: actualDigest}
	session.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	if err := s.writeKitSession(session); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleKitCommit(w http.ResponseWriter, sessionID string) {
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	session, err := s.loadKitSession(sessionID)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "session_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_read_failed")
		return
	}
	for name := range session.AllowedFiles {
		if _, ok := session.Files[name]; !ok {
			writeError(w, http.StatusUnprocessableEntity, "incomplete_kit_release")
			return
		}
	}
	stable, err := s.commitKitSession(session)
	if errors.Is(err, errVersionConflict) {
		writeError(w, http.StatusConflict, "kit_version_conflict")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "kit_commit_failed")
		return
	}
	s.removeSessionLock(sessionID, lock)
	writeJSON(w, http.StatusOK, stable)
}

func (s *Server) commitKitSession(session kitPublishSession) (kitStableDocument, error) {
	s.commitMu.Lock()
	defer s.commitMu.Unlock()
	previous, err := s.readKitStable()
	if err != nil {
		return kitStableDocument{}, fmt.Errorf("read Kit stable: %w", err)
	}
	if previous != nil && compareKitVersions(session.Version, previous.Version) <= 0 {
		return kitStableDocument{}, errVersionConflict
	}
	publicRoot := filepath.Join(s.config.DataRoot, "public")
	releasesRoot := filepath.Join(publicRoot, "personal-wiki-kit", "releases")
	versionDirectory := filepath.Join(releasesRoot, "v"+session.Version)
	if _, err := os.Stat(versionDirectory); err == nil {
		return kitStableDocument{}, errVersionConflict
	} else if !errors.Is(err, os.ErrNotExist) {
		return kitStableDocument{}, err
	}
	if err := os.MkdirAll(releasesRoot, 0o750); err != nil {
		return kitStableDocument{}, err
	}
	stagedDirectory, err := os.MkdirTemp(releasesRoot, ".v"+session.Version+"-*")
	if err != nil {
		return kitStableDocument{}, err
	}
	stagedPublished := false
	defer func() {
		if !stagedPublished {
			_ = os.RemoveAll(stagedDirectory)
		}
	}()
	for _, platform := range []string{"windows-x64", "linux-x64"} {
		name := kitArtifactName(session.Version, platform)
		if err := copyFileAtomic(filepath.Join(s.kitSessionFilesDirectory(session.SessionID), name), filepath.Join(stagedDirectory, name), 0o640); err != nil {
			return kitStableDocument{}, err
		}
	}
	if err := os.Rename(stagedDirectory, versionDirectory); err != nil {
		if os.IsExist(err) {
			return kitStableDocument{}, errVersionConflict
		}
		return kitStableDocument{}, err
	}
	stagedPublished = true
	setupPath := filepath.Join(publicRoot, "setup-wiki.bat")
	stablePath := filepath.Join(publicRoot, "personal-wiki-kit", "stable.json")
	snapshots, err := captureFileSnapshots([]string{setupPath, stablePath})
	if err != nil {
		_ = os.RemoveAll(versionDirectory)
		return kitStableDocument{}, err
	}
	rollback := func() {
		_ = restoreFileSnapshots(snapshots)
		_ = os.RemoveAll(versionDirectory)
	}
	if err := copyFileAtomic(filepath.Join(s.kitSessionFilesDirectory(session.SessionID), "setup-wiki.bat"), setupPath, 0o640); err != nil {
		rollback()
		return kitStableDocument{}, err
	}
	stable := buildKitStableDocument(session)
	if err := s.writeJSON(stablePath, stable, 0o640); err != nil {
		rollback()
		return kitStableDocument{}, err
	}
	if err := s.verifyPublicKit(stable, session); err != nil {
		rollback()
		return kitStableDocument{}, fmt.Errorf("verify public Kit release: %w", err)
	}
	if err := os.RemoveAll(s.kitSessionDirectory(session.SessionID)); err != nil {
		log.Printf("release server: committed Kit staging cleanup failed version=%s: %v", session.Version, err)
	}
	return stable, nil
}

func buildKitStableDocument(session kitPublishSession) kitStableDocument {
	artifactFor := func(name, publicPath string) kitArtifact {
		identity := session.Files[name]
		return kitArtifact{Path: publicPath, SHA256: identity.SHA256, Size: identity.Size}
	}
	windowsName := kitArtifactName(session.Version, "windows-x64")
	linuxName := kitArtifactName(session.Version, "linux-x64")
	return kitStableDocument{
		Schema:      1,
		Version:     session.Version,
		PublishedAt: session.PublishedAt,
		SourceSHA:   session.SourceSHA,
		Setup:       artifactFor("setup-wiki.bat", "/setup-wiki.bat"),
		Artifacts: map[string]kitArtifact{
			"windows-x64": artifactFor(windowsName, "/personal-wiki-kit/releases/v"+session.Version+"/"+windowsName),
			"linux-x64":   artifactFor(linuxName, "/personal-wiki-kit/releases/v"+session.Version+"/"+linuxName),
		},
	}
}

func (s *Server) handleKitCancel(w http.ResponseWriter, sessionID string) {
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	directory := s.kitSessionDirectory(sessionID)
	if _, err := os.Stat(directory); errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "session_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "session_cancel_failed")
		return
	}
	if err := os.RemoveAll(directory); err != nil {
		writeError(w, http.StatusInternalServerError, "session_cancel_failed")
		return
	}
	s.removeSessionLock(sessionID, lock)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) kitSessionDirectory(sessionID string) string {
	return filepath.Join(s.config.DataRoot, "staging", "personal-wiki-kit", sessionID)
}

func (s *Server) kitSessionFilesDirectory(sessionID string) string {
	return filepath.Join(s.kitSessionDirectory(sessionID), "files")
}

func (s *Server) createKitSession(session kitPublishSession) (bool, error) {
	root := filepath.Join(s.config.DataRoot, "staging", "personal-wiki-kit")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return false, err
	}
	directory := s.kitSessionDirectory(session.SessionID)
	if err := os.Mkdir(directory, 0o700); err != nil {
		if os.IsExist(err) {
			return false, nil
		}
		return false, err
	}
	if err := os.Mkdir(filepath.Join(directory, "files"), 0o700); err != nil {
		_ = os.RemoveAll(directory)
		return false, err
	}
	if err := s.writeKitSession(session); err != nil {
		_ = os.RemoveAll(directory)
		return false, err
	}
	return true, nil
}

func (s *Server) loadKitSession(sessionID string) (kitPublishSession, error) {
	var session kitPublishSession
	if !validLowerHex(sessionID, 16) {
		return session, os.ErrNotExist
	}
	raw, err := os.ReadFile(filepath.Join(s.kitSessionDirectory(sessionID), "session.json"))
	if err != nil {
		return session, err
	}
	if err := decodeStrictJSON(bytesReader(raw), maxControlFileSize, &session); err != nil {
		return session, err
	}
	if session.Schema != 1 || session.SessionID != sessionID || !kitVersionPattern.MatchString(session.Version) || !validLowerHex(session.SourceSHA, 20) || session.Files == nil {
		return session, errors.New("invalid Kit session")
	}
	return session, nil
}

func (s *Server) writeKitSession(session kitPublishSession) error {
	return writeJSONFileAtomic(filepath.Join(s.kitSessionDirectory(session.SessionID), "session.json"), session, 0o600)
}

func (s *Server) cleanupStaleKitSessions() error {
	root := filepath.Join(s.config.DataRoot, "staging", "personal-wiki-kit")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read Kit staging directory: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() || !validLowerHex(entry.Name(), 16) {
			continue
		}
		sessionID := entry.Name()
		lock := s.sessionLock(sessionID)
		lock.Lock()
		session, loadErr := s.loadKitSession(sessionID)
		if loadErr == nil {
			updatedAt, parseErr := time.Parse(time.RFC3339, session.UpdatedAt)
			if parseErr == nil && s.now().UTC().Sub(updatedAt) > staleSessionAge {
				loadErr = os.RemoveAll(s.kitSessionDirectory(sessionID))
				if loadErr == nil {
					s.removeSessionLock(sessionID, lock)
				}
			}
		}
		lock.Unlock()
		if loadErr != nil && !errors.Is(loadErr, os.ErrNotExist) {
			return fmt.Errorf("clean stale Kit session %s: %w", sessionID, loadErr)
		}
	}
	return nil
}

func (s *Server) readKitStable() (*kitStableDocument, error) {
	raw, err := os.ReadFile(filepath.Join(s.config.DataRoot, "public", "personal-wiki-kit", "stable.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var stable kitStableDocument
	if err := decodeStrictJSON(bytesReader(raw), maxControlFileSize, &stable); err != nil {
		return nil, err
	}
	if err := validateKitStable(stable); err != nil {
		return nil, err
	}
	return &stable, nil
}

func validateKitStable(stable kitStableDocument) error {
	if stable.Schema != 1 || !kitVersionPattern.MatchString(stable.Version) || !validLowerHex(stable.SourceSHA, 20) {
		return errors.New("Kit stable identity is invalid")
	}
	if _, err := time.Parse(time.RFC3339, stable.PublishedAt); err != nil {
		return errors.New("Kit stable publishedAt is invalid")
	}
	if stable.Setup.Path != "/setup-wiki.bat" || !validKitArtifact(stable.Setup) || len(stable.Artifacts) != 2 {
		return errors.New("Kit setup pointer is invalid")
	}
	for _, platform := range []string{"windows-x64", "linux-x64"} {
		name := kitArtifactName(stable.Version, platform)
		artifact, ok := stable.Artifacts[platform]
		if !ok || artifact.Path != "/personal-wiki-kit/releases/v"+stable.Version+"/"+name || !validKitArtifact(artifact) {
			return fmt.Errorf("Kit artifact pointer is invalid: %s", platform)
		}
	}
	return nil
}

func validKitArtifact(artifact kitArtifact) bool {
	return artifact.Path != "" && artifact.Size > 0 && validLowerHex(artifact.SHA256, sha256.Size)
}

type parsedKitVersion struct {
	numbers [3]int
	pre     []string
}

func compareKitVersions(left, right string) int {
	a, aOK := parseKitVersion(left)
	b, bOK := parseKitVersion(right)
	if !aOK || !bOK {
		return strings.Compare(left, right)
	}
	for index := range a.numbers {
		if a.numbers[index] < b.numbers[index] {
			return -1
		}
		if a.numbers[index] > b.numbers[index] {
			return 1
		}
	}
	if len(a.pre) == 0 && len(b.pre) == 0 {
		return 0
	}
	if len(a.pre) == 0 {
		return 1
	}
	if len(b.pre) == 0 {
		return -1
	}
	for index := 0; index < len(a.pre) && index < len(b.pre); index++ {
		if a.pre[index] == b.pre[index] {
			continue
		}
		aNumber, aErr := strconv.Atoi(a.pre[index])
		bNumber, bErr := strconv.Atoi(b.pre[index])
		switch {
		case aErr == nil && bErr == nil:
			if aNumber < bNumber {
				return -1
			}
			return 1
		case aErr == nil:
			return -1
		case bErr == nil:
			return 1
		default:
			return strings.Compare(a.pre[index], b.pre[index])
		}
	}
	if len(a.pre) < len(b.pre) {
		return -1
	}
	if len(a.pre) > len(b.pre) {
		return 1
	}
	return 0
}

func parseKitVersion(value string) (parsedKitVersion, bool) {
	match := kitVersionPattern.FindStringSubmatch(value)
	if match == nil {
		return parsedKitVersion{}, false
	}
	var result parsedKitVersion
	for index := 0; index < 3; index++ {
		result.numbers[index], _ = strconv.Atoi(match[index+1])
	}
	if match[4] != "" {
		result.pre = strings.Split(match[4], ".")
	}
	return result, true
}
