package releaseserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxDebugWebSize = int64(512 << 20)

type debugWebStartRequest struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type debugWebStartResponse struct {
	Schema    int    `json:"schema"`
	SessionID string `json:"sessionId"`
}

type debugWebSession struct {
	Schema    int64  `json:"schema"`
	SessionID string `json:"sessionId"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
}

type debugWebCurrent struct {
	Schema      int    `json:"schema"`
	ArchivePath string `json:"archivePath"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	PublishedAt string `json:"publishedAt"`
}

func (s *Server) handleDebugWebAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path == "/api/debug-web/start" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return true
		}
		s.handleDebugWebStart(w, r)
		return true
	}
	const prefix = "/api/debug-web/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		return false
	}
	if encodedPathEscapesSegments(r.URL) || strings.Contains(r.URL.Path, "\\") {
		writeError(w, http.StatusBadRequest, "invalid_debug_web_path")
		return true
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, prefix), "/")
	if len(parts) != 2 || !validLowerHex(parts[0], 16) {
		writeError(w, http.StatusBadRequest, "invalid_debug_web_path")
		return true
	}
	switch {
	case parts[1] == "archive" && r.Method == http.MethodPut:
		s.handleDebugWebUpload(w, r, parts[0])
	case parts[1] == "commit" && r.Method == http.MethodPost:
		s.handleDebugWebCommit(w, parts[0])
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
	return true
}

func (s *Server) handleDebugWebStart(w http.ResponseWriter, r *http.Request) {
	var request debugWebStartRequest
	if err := decodeStrictJSON(r.Body, maxJSONBodySize, &request); err != nil || request.Size <= 0 || request.Size > maxDebugWebSize || !validLowerHex(request.SHA256, sha256.Size) {
		writeError(w, http.StatusBadRequest, "invalid_debug_web_start")
		return
	}
	for attempts := 0; attempts < 8; attempts++ {
		id, err := s.newSessionID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		stagingRoot := filepath.Join(s.config.DataRoot, "staging", "debug-web")
		if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		directory := s.debugWebStagingDirectory(id)
		if err := os.Mkdir(directory, 0o700); err != nil {
			if errors.Is(err, os.ErrExist) {
				continue
			}
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		if err := s.writeJSON(filepath.Join(directory, "session.json"), debugWebSession{Schema: 1, SessionID: id, Size: request.Size, SHA256: request.SHA256}, 0o600); err != nil {
			_ = os.RemoveAll(directory)
			writeError(w, http.StatusInternalServerError, "session_create_failed")
			return
		}
		writeJSON(w, http.StatusCreated, debugWebStartResponse{Schema: 1, SessionID: id})
		return
	}
	writeError(w, http.StatusInternalServerError, "session_create_failed")
}

func (s *Server) handleDebugWebUpload(w http.ResponseWriter, r *http.Request, sessionID string) {
	if r.ContentLength < 0 {
		writeError(w, http.StatusLengthRequired, "content_length_required")
		return
	}
	session, err := s.loadDebugWebSession(sessionID)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "session_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_read_failed")
		return
	}
	if r.ContentLength != session.Size || r.Header.Get("X-WheelMaker-SHA256") != session.SHA256 {
		writeError(w, http.StatusUnprocessableEntity, "archive_metadata_mismatch")
		return
	}
	temporary, err := os.CreateTemp(s.debugWebStagingDirectory(sessionID), ".archive-*.tmp")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "archive_write_failed")
		return
	}
	path := temporary.Name()
	defer func() { _ = temporary.Close(); _ = os.Remove(path) }()
	hasher := sha256.New()
	written, err := copyDeclaredFile(temporary, hasher, r.Body, session.Size)
	if err != nil || written != session.Size || hex.EncodeToString(hasher.Sum(nil)) != session.SHA256 {
		writeError(w, http.StatusUnprocessableEntity, "archive_digest_mismatch")
		return
	}
	if err := temporary.Sync(); err != nil || temporary.Close() != nil {
		writeError(w, http.StatusInternalServerError, "archive_write_failed")
		return
	}
	if err := os.Rename(path, filepath.Join(s.debugWebStagingDirectory(sessionID), "archive.zip")); err != nil {
		writeError(w, http.StatusInternalServerError, "archive_write_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDebugWebCommit(w http.ResponseWriter, sessionID string) {
	s.debugWebMu.Lock()
	defer s.debugWebMu.Unlock()
	session, err := s.loadDebugWebSession(sessionID)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "session_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_read_failed")
		return
	}
	source := filepath.Join(s.debugWebStagingDirectory(sessionID), "archive.zip")
	info, err := os.Stat(source)
	if err != nil || info.Size() != session.Size {
		writeError(w, http.StatusUnprocessableEntity, "archive_not_uploaded")
		return
	}
	archives := filepath.Join(s.config.DataRoot, "public", "debug-web", "archives")
	if err := os.MkdirAll(archives, 0o750); err != nil {
		writeError(w, http.StatusInternalServerError, "commit_failed")
		return
	}
	archivePath := filepath.Join(archives, session.SHA256+".zip")
	movedArchive := false
	if _, err := os.Stat(archivePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "commit_failed")
		return
	} else if errors.Is(err, os.ErrNotExist) {
		movedArchive = true
	}
	if err := copyDebugWebArchiveAtomic(source, archivePath); err != nil {
		writeError(w, http.StatusInternalServerError, "commit_failed")
		return
	}
	current := debugWebCurrent{Schema: 1, ArchivePath: "/debug-web/archives/" + session.SHA256 + ".zip", Size: session.Size, SHA256: session.SHA256, PublishedAt: s.now().UTC().Format(time.RFC3339)}
	currentPath := filepath.Join(s.config.DataRoot, "public", "debug-web", "current.json")
	previous, _ := readDebugWebCurrent(currentPath)
	if err := s.writeJSON(currentPath, current, 0o640); err != nil {
		if movedArchive {
			_ = os.Remove(archivePath)
		}
		writeError(w, http.StatusInternalServerError, "commit_failed")
		return
	}
	if previous != nil && previous.ArchivePath != current.ArchivePath {
		_ = os.Remove(filepath.Join(s.config.DataRoot, "public", filepath.FromSlash(strings.TrimPrefix(previous.ArchivePath, "/"))))
	}
	_ = os.RemoveAll(s.debugWebStagingDirectory(sessionID))
	writeJSON(w, http.StatusOK, current)
}

func copyDebugWebArchiveAtomic(source, destination string) (retErr error) {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".debug-web-*.tmp")
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
	if err := temporary.Chmod(0o640); err != nil {
		return err
	}
	if _, err := io.Copy(temporary, input); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, destination)
}

func readDebugWebCurrent(path string) (*debugWebCurrent, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var current debugWebCurrent
	if err := json.Unmarshal(raw, &current); err != nil || current.Schema != 1 || !validLowerHex(current.SHA256, sha256.Size) || current.ArchivePath != "/debug-web/archives/"+current.SHA256+".zip" {
		return nil, errors.New("invalid debug web current")
	}
	return &current, nil
}

func (s *Server) debugWebStagingDirectory(sessionID string) string {
	return filepath.Join(s.config.DataRoot, "staging", "debug-web", sessionID)
}

func (s *Server) loadDebugWebSession(sessionID string) (debugWebSession, error) {
	raw, err := os.ReadFile(filepath.Join(s.debugWebStagingDirectory(sessionID), "session.json"))
	if err != nil {
		return debugWebSession{}, err
	}
	var session debugWebSession
	if err := json.Unmarshal(raw, &session); err != nil || session.Schema != 1 || session.SessionID != sessionID || session.Size <= 0 || !validLowerHex(session.SHA256, sha256.Size) {
		return debugWebSession{}, errors.New("invalid debug web session")
	}
	return session, nil
}
