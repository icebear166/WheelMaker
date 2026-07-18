package releaseserver

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxControlFileSize = int64(5 << 20)
	maxBinaryFileSize  = int64(2 << 30)
	maxSessionSize     = int64(8 << 30)
	maxJSONBodySize    = int64(64 << 10)
	staleSessionAge    = 24 * time.Hour
)

var versionPattern = regexp.MustCompile(`^v1\.(0|[1-9]\d*)$`)
var errorCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

var releasePlatforms = [...]string{
	"windows-amd64",
	"linux-amd64",
	"darwin-amd64",
	"darwin-arm64",
}

type startRequest struct {
	Version     string `json:"version"`
	SourceSHA   string `json:"sourceSha"`
	Publisher   string `json:"publisher"`
	WithDesktop bool   `json:"withDesktop"`
	WithAndroid bool   `json:"withAndroid"`
}

type startResponse struct {
	Schema      int    `json:"schema"`
	SessionID   string `json:"sessionId"`
	Version     string `json:"version"`
	PublishedAt string `json:"publishedAt"`
}

type publishSession struct {
	Schema       int                 `json:"schema"`
	SessionID    string              `json:"sessionId"`
	Version      string              `json:"version"`
	SourceSHA    string              `json:"sourceSha"`
	Publisher    string              `json:"publisher"`
	WithDesktop  bool                `json:"withDesktop"`
	WithAndroid  bool                `json:"withAndroid"`
	PublishedAt  string              `json:"publishedAt"`
	UpdatedAt    string              `json:"updatedAt"`
	AllowedFiles map[string]fileRule `json:"allowedFiles"`
	Files        map[string]fileInfo `json:"files"`
}

type fileRule struct {
	MaxSize int64 `json:"maxSize"`
}

type fileInfo struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type statusRequest struct {
	State     string `json:"state"`
	Phase     string `json:"phase"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type publishStatus struct {
	Schema    int    `json:"schema"`
	State     string `json:"state"`
	Phase     string `json:"phase"`
	Version   string `json:"version"`
	SourceSHA string `json:"sourceSha"`
	Publisher string `json:"publisher"`
	StartedAt string `json:"startedAt"`
	UpdatedAt string `json:"updatedAt"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type statusOwner struct {
	Schema    int    `json:"schema"`
	SessionID string `json:"sessionId"`
}

type serverDependencies struct {
	now       func() time.Time
	random    io.Reader
	diskFree  func(string) (uint64, error)
	writeJSON func(string, any, os.FileMode) error
}

func (s *Server) handleAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path == "/api/publish/start" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return true
		}
		s.handleStart(w, r)
		return true
	}
	const prefix = "/api/publish/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		return false
	}
	if encodedPathEscapesSegments(r.URL) || strings.Contains(r.URL.Path, "\\") {
		writeError(w, http.StatusBadRequest, "invalid_publish_path")
		return true
	}
	remainder := strings.TrimPrefix(r.URL.Path, prefix)
	parts := strings.Split(remainder, "/")
	if len(parts) == 0 || !validLowerHex(parts[0], 16) {
		writeError(w, http.StatusBadRequest, "invalid_session_id")
		return true
	}
	sessionID := parts[0]
	switch {
	case len(parts) == 1 && r.Method == http.MethodDelete:
		s.handleCancel(w, sessionID)
		return true
	case len(parts) == 2 && parts[1] == "status" && r.Method == http.MethodPut:
		s.handleStatus(w, r, sessionID)
		return true
	case len(parts) == 2 && parts[1] == "commit" && r.Method == http.MethodPost:
		s.handleCommit(w, sessionID)
		return true
	case len(parts) == 3 && parts[1] == "files" && r.Method == http.MethodPut:
		s.handleUpload(w, r, sessionID, parts[2])
		return true
	case len(parts) == 1 || (len(parts) == 2 && (parts[1] == "status" || parts[1] == "commit")) || (len(parts) >= 2 && parts[1] == "files"):
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return true
	default:
		writeError(w, http.StatusBadRequest, "invalid_publish_path")
		return true
	}
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	var request startRequest
	if err := decodeStrictJSON(r.Body, maxJSONBodySize, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_start_request")
		return
	}
	if !versionPattern.MatchString(request.Version) || !validLowerHex(request.SourceSHA, 20) || (request.Publisher != "local" && request.Publisher != "action") {
		writeError(w, http.StatusBadRequest, "invalid_start_request")
		return
	}
	now := s.now().UTC().Format(time.RFC3339)
	allowedFiles := allowedReleaseFiles(request)
	var session publishSession
	for attempts := 0; attempts < 8; attempts++ {
		sessionID, err := s.newSessionID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		session = publishSession{
			Schema:       1,
			SessionID:    sessionID,
			Version:      request.Version,
			SourceSHA:    request.SourceSHA,
			Publisher:    request.Publisher,
			WithDesktop:  request.WithDesktop,
			WithAndroid:  request.WithAndroid,
			PublishedAt:  now,
			UpdatedAt:    now,
			AllowedFiles: allowedFiles,
			Files:        map[string]fileInfo{},
		}
		created, err := s.createSession(session)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		if created {
			writeJSON(w, http.StatusCreated, startResponse{
				Schema:      1,
				SessionID:   session.SessionID,
				Version:     session.Version,
				PublishedAt: session.PublishedAt,
			})
			return
		}
	}
	writeError(w, http.StatusInternalServerError, "session_create_failed")
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request, sessionID string) {
	var request statusRequest
	if err := decodeStrictJSON(r.Body, maxJSONBodySize, &request); err != nil || !validStatusRequest(request) {
		writeError(w, http.StatusBadRequest, "invalid_status")
		return
	}
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	session, err := s.loadSession(sessionID)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "session_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_read_failed")
		return
	}
	updatedAt := s.now().UTC().Format(time.RFC3339)
	session.UpdatedAt = updatedAt
	status := publishStatus{
		Schema:    1,
		State:     request.State,
		Phase:     request.Phase,
		Version:   session.Version,
		SourceSHA: session.SourceSHA,
		Publisher: session.Publisher,
		StartedAt: session.PublishedAt,
		UpdatedAt: updatedAt,
		ErrorCode: request.ErrorCode,
	}
	if err := s.writeSession(session); err != nil {
		writeError(w, http.StatusInternalServerError, "status_write_failed")
		return
	}
	if err := s.writePublicStatus(sessionID, status); err != nil {
		writeError(w, http.StatusInternalServerError, "status_write_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request, sessionID string, filename string) {
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
	session, err := s.loadSession(sessionID)
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
	total := r.ContentLength
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
	filesDirectory := filepath.Join(s.config.DataRoot, "staging", sessionID, "files")
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
	if err := temporary.Sync(); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	if err := temporary.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	finalPath := filepath.Join(filesDirectory, filename)
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	completed = true
	session.Files[filename] = fileInfo{Size: written, SHA256: actualDigest}
	session.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	if err := s.writeSession(session); err != nil {
		writeError(w, http.StatusInternalServerError, "upload_write_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCancel(w http.ResponseWriter, sessionID string) {
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	directory := filepath.Join(s.config.DataRoot, "staging", sessionID)
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

func (s *Server) StartMaintenance(ctx context.Context) {
	go func() {
		if err := s.recoverPublishedState(); err != nil {
			log.Printf("release server: startup recovery failed: %v", err)
		}
		if err := s.cleanupStaleSessions(); err != nil {
			log.Printf("release server: staging cleanup failed: %v", err)
		}
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.cleanupStaleSessions(); err != nil {
					log.Printf("release server: staging cleanup failed: %v", err)
				}
			}
		}
	}()
}

func (s *Server) cleanupStaleSessions() error {
	stagingRoot := filepath.Join(s.config.DataRoot, "staging")
	entries, err := os.ReadDir(stagingRoot)
	if err != nil {
		return fmt.Errorf("read staging directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "recovery-") {
			info, infoErr := entry.Info()
			if infoErr != nil {
				return infoErr
			}
			if s.now().UTC().Sub(info.ModTime().UTC()) > staleSessionAge {
				if err := os.RemoveAll(filepath.Join(stagingRoot, entry.Name())); err != nil {
					return err
				}
			}
			continue
		}
		if !entry.IsDir() || !validLowerHex(entry.Name(), 16) {
			continue
		}
		sessionID := entry.Name()
		lock := s.sessionLock(sessionID)
		lock.Lock()
		session, loadErr := s.loadSession(sessionID)
		if loadErr == nil {
			updatedAt, parseErr := time.Parse(time.RFC3339, session.UpdatedAt)
			if parseErr == nil && s.now().UTC().Sub(updatedAt) > staleSessionAge {
				_ = s.writeTimeoutStatusIfCurrent(session)
				loadErr = os.RemoveAll(filepath.Join(stagingRoot, sessionID))
				if loadErr == nil {
					s.removeSessionLock(sessionID, lock)
				}
			}
		}
		lock.Unlock()
		if loadErr != nil && !errors.Is(loadErr, os.ErrNotExist) {
			return fmt.Errorf("clean stale session %s: %w", sessionID, loadErr)
		}
	}
	return nil
}

func (s *Server) createSession(session publishSession) (bool, error) {
	directory := filepath.Join(s.config.DataRoot, "staging", session.SessionID)
	if err := os.Mkdir(directory, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return false, nil
		}
		return false, err
	}
	completed := false
	defer func() {
		if !completed {
			_ = os.RemoveAll(directory)
		}
	}()
	if err := os.Mkdir(filepath.Join(directory, "files"), 0o700); err != nil {
		return false, err
	}
	if err := s.writeSession(session); err != nil {
		return false, err
	}
	completed = true
	return true, nil
}

func (s *Server) newSessionID() (string, error) {
	raw := make([]byte, 16)
	s.randomMu.Lock()
	_, err := io.ReadFull(s.random, raw)
	s.randomMu.Unlock()
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func (s *Server) loadSession(sessionID string) (publishSession, error) {
	path := filepath.Join(s.config.DataRoot, "staging", sessionID, "session.json")
	file, err := os.Open(path)
	if err != nil {
		return publishSession{}, err
	}
	defer file.Close()
	var session publishSession
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&session); err != nil {
		return publishSession{}, err
	}
	if session.Schema != 1 || session.SessionID != sessionID || !versionPattern.MatchString(session.Version) || !validLowerHex(session.SourceSHA, 20) || session.PublishedAt == "" || session.UpdatedAt == "" || session.Files == nil || session.AllowedFiles == nil {
		return publishSession{}, errors.New("invalid session metadata")
	}
	return session, nil
}

func (s *Server) writeSession(session publishSession) error {
	return s.writeJSON(
		filepath.Join(s.config.DataRoot, "staging", session.SessionID, "session.json"),
		session,
		0o600,
	)
}

func (s *Server) writePublicStatus(sessionID string, status publishStatus) error {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	if err := s.writeJSON(filepath.Join(s.config.DataRoot, "public", "publish-status.json"), status, 0o640); err != nil {
		return err
	}
	return s.writeJSON(filepath.Join(s.config.DataRoot, "data", "publish-status-owner.json"), statusOwner{Schema: 1, SessionID: sessionID}, 0o600)
}

func (s *Server) writeTimeoutStatusIfCurrent(session publishSession) error {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	ownerRaw, err := os.ReadFile(filepath.Join(s.config.DataRoot, "data", "publish-status-owner.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var owner statusOwner
	if json.Unmarshal(ownerRaw, &owner) != nil || owner.Schema != 1 || owner.SessionID != session.SessionID {
		return nil
	}
	now := s.now().UTC().Format(time.RFC3339)
	return s.writeJSON(filepath.Join(s.config.DataRoot, "public", "publish-status.json"), publishStatus{
		Schema:    1,
		State:     "failed",
		Phase:     "uploading",
		Version:   session.Version,
		SourceSHA: session.SourceSHA,
		Publisher: session.Publisher,
		StartedAt: session.PublishedAt,
		UpdatedAt: now,
		ErrorCode: "publisher_timeout",
	}, 0o640)
}

func (s *Server) sessionLock(sessionID string) *sync.Mutex {
	s.sessionLocksMu.Lock()
	defer s.sessionLocksMu.Unlock()
	lock := s.sessionLocks[sessionID]
	if lock == nil {
		lock = &sync.Mutex{}
		s.sessionLocks[sessionID] = lock
	}
	return lock
}

func (s *Server) removeSessionLock(sessionID string, lock *sync.Mutex) {
	s.sessionLocksMu.Lock()
	defer s.sessionLocksMu.Unlock()
	if s.sessionLocks[sessionID] == lock {
		delete(s.sessionLocks, sessionID)
	}
}

func allowedReleaseFiles(request startRequest) map[string]fileRule {
	files := map[string]fileRule{
		"deploy.mjs":            {MaxSize: maxControlFileSize},
		"deploy-core.mjs":       {MaxSize: maxControlFileSize},
		"release-manifest.json": {MaxSize: maxControlFileSize},
	}
	for _, platform := range releasePlatforms {
		name := "wheelmaker-" + request.Version + "-" + platform + ".tar.gz"
		files[name] = fileRule{MaxSize: maxBinaryFileSize}
	}
	if request.WithDesktop {
		files["WheelMakerDesktop.exe"] = fileRule{MaxSize: maxBinaryFileSize}
	}
	if request.WithAndroid {
		files["WheelMakerAndroid.apk"] = fileRule{MaxSize: maxBinaryFileSize}
		files["android-release.json"] = fileRule{MaxSize: maxControlFileSize}
	}
	return files
}

func validStatusRequest(request statusRequest) bool {
	validState := request.State == "running" || request.State == "succeeded" || request.State == "failed"
	validPhase := request.Phase == "validating" || request.Phase == "building" || request.Phase == "packaging" || request.Phase == "uploading" || request.Phase == "committing" || request.Phase == "updating-stable"
	if !validState || !validPhase {
		return false
	}
	if request.State == "failed" {
		return errorCodePattern.MatchString(request.ErrorCode)
	}
	return request.ErrorCode == ""
}

func decodeStrictJSON(reader io.Reader, maxBytes int64, destination any) error {
	raw, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return err
	}
	if int64(len(raw)) > maxBytes {
		return errors.New("JSON body is too large")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("JSON body contains trailing data")
	}
	return nil
}

func copyDeclaredFile(destination io.Writer, hasher hash.Hash, source io.Reader, declared int64) (int64, error) {
	limited := &io.LimitedReader{R: source, N: declared + 1}
	written, err := io.Copy(io.MultiWriter(destination, hasher), limited)
	if err != nil {
		return written, err
	}
	if written != declared {
		return written, errors.New("uploaded size does not match Content-Length")
	}
	return written, nil
}

func writeJSONFileAtomic(path string, value any, mode os.FileMode) (retErr error) {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(path), ".json-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if retErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func encodedPathEscapesSegments(value *url.URL) bool {
	escaped := strings.ToLower(value.EscapedPath())
	return strings.Contains(escaped, "%2f") || strings.Contains(escaped, "%5c")
}

func defaultServerDependencies() serverDependencies {
	return serverDependencies{
		now:       time.Now,
		random:    rand.Reader,
		diskFree:  availableDiskBytes,
		writeJSON: writeJSONFileAtomic,
	}
}
