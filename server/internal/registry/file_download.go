package registry

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	fileDownloadSourceProject    = "project-file"
	fileDownloadSourceExternal   = "external-file"
	fileDownloadSourceAttachment = "session-attachment"
)

var (
	errFileDownloadCapabilityMissing = errors.New("download capability not found")
	errFileDownloadCapabilityExpired = errors.New("download capability expired")
	errFileDownloadCapabilityBusy    = errors.New("download capability capacity reached")
	errFileDownloadSessionMismatch   = errors.New("download capability session mismatch")
)

type fileDownloadSource struct {
	Kind         string `json:"kind"`
	Path         string `json:"path,omitempty"`
	SessionID    string `json:"sessionId,omitempty"`
	AttachmentID string `json:"attachmentId,omitempty"`
	URI          string `json:"uri,omitempty"`
}

type fileDownloadTask struct {
	DeviceID  string
	BasePath  string
	ProjectID string
	Source    fileDownloadSource
	FileName  string
	MimeType  string
	Size      int64
	Identity  string
}

type fileDownloadPreparePayload struct {
	CSRFToken string             `json:"csrfToken"`
	Source    fileDownloadSource `json:"source"`
}

type fileDownloadHubOpenResponse struct {
	OK         bool   `json:"ok"`
	TransferID string `json:"transferId"`
	FileName   string `json:"fileName"`
	MimeType   string `json:"mimeType"`
	Size       int64  `json:"size"`
	Identity   string `json:"identity"`
}

type fileDownloadHubReadResponse struct {
	OK         bool   `json:"ok"`
	Data       string `json:"data"`
	NextOffset int64  `json:"nextOffset"`
	EOF        bool   `json:"eof"`
}

type storedFileDownloadTask struct {
	task      fileDownloadTask
	expiresAt time.Time
}

type fileDownloadCapabilityStoreOptions struct {
	Now      func() time.Time
	Random   io.Reader
	TTL      time.Duration
	Capacity int
}

type fileDownloadCapabilityStore struct {
	mu       sync.Mutex
	now      func() time.Time
	random   io.Reader
	ttl      time.Duration
	capacity int
	tasks    map[string]storedFileDownloadTask
}

func newFileDownloadCapabilityStore(options fileDownloadCapabilityStoreOptions) *fileDownloadCapabilityStore {
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.Random == nil {
		options.Random = rand.Reader
	}
	if options.TTL <= 0 {
		options.TTL = 2 * time.Minute
	}
	if options.Capacity <= 0 {
		options.Capacity = 128
	}
	return &fileDownloadCapabilityStore{
		now:      options.Now,
		random:   options.Random,
		ttl:      options.TTL,
		capacity: options.Capacity,
		tasks:    make(map[string]storedFileDownloadTask),
	}
}

func (s *fileDownloadCapabilityStore) issue(task fileDownloadTask) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for token, stored := range s.tasks {
		if now.After(stored.expiresAt) {
			delete(s.tasks, token)
		}
	}
	if len(s.tasks) >= s.capacity {
		return "", errFileDownloadCapabilityBusy
	}
	for {
		raw := make([]byte, 32)
		if _, err := io.ReadFull(s.random, raw); err != nil {
			return "", err
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		if _, exists := s.tasks[token]; exists {
			continue
		}
		s.tasks[token] = storedFileDownloadTask{task: task, expiresAt: now.Add(s.ttl)}
		return token, nil
	}
}

func (s *fileDownloadCapabilityStore) claim(token, deviceID, basePath string) (fileDownloadTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.tasks[token]
	if !ok {
		return fileDownloadTask{}, errFileDownloadCapabilityMissing
	}
	if s.now().After(stored.expiresAt) {
		delete(s.tasks, token)
		return fileDownloadTask{}, errFileDownloadCapabilityExpired
	}
	if stored.task.DeviceID != deviceID || stored.task.BasePath != basePath {
		return fileDownloadTask{}, errFileDownloadSessionMismatch
	}
	delete(s.tasks, token)
	return stored.task, nil
}

func (s *Server) handleFileDownloadPrepare(clientPeer *peerConn, state *connectionState, in envelope) {
	if !state.browserSession || state.browserDeviceID == "" || state.browserBasePath == "" {
		_ = s.writeError(clientPeer, in.RequestID, in.Method, codeForbidden, "file download requires a Web session", nil)
		return
	}
	var payload fileDownloadPreparePayload
	if err := json.Unmarshal(in.Payload, &payload); err != nil || !validFileDownloadSource(payload.Source) {
		_ = s.writeError(clientPeer, in.RequestID, in.Method, codeInvalidArgument, "invalid file download source", nil)
		return
	}
	if subtle.ConstantTimeCompare([]byte(payload.CSRFToken), []byte(state.browserCSRFToken)) != 1 {
		_ = s.writeError(clientPeer, in.RequestID, in.Method, codeForbidden, "invalid CSRF token", nil)
		return
	}
	open := s.executeProjectRequest(context.Background(), state.scopeHubID, envelope{
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadOpen,
		ProjectID: in.ProjectID,
		Payload:   rp.MustRaw(map[string]any{"source": payload.Source}),
	})
	if open.Type != rp.RegistryEnvelopeTypeResponse {
		_ = s.writeError(clientPeer, in.RequestID, in.Method, codeUnavailable, "file download is unavailable on this Hub", nil)
		return
	}
	var opened fileDownloadHubOpenResponse
	if err := json.Unmarshal(open.Payload, &opened); err != nil || !validFileDownloadOpenResponse(opened) {
		_ = s.writeError(clientPeer, in.RequestID, in.Method, codeUnavailable, "Hub returned invalid file download metadata", nil)
		return
	}
	closed := s.executeProjectRequest(context.Background(), state.scopeHubID, envelope{
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadClose,
		ProjectID: in.ProjectID,
		Payload:   rp.MustRaw(map[string]any{"transferId": opened.TransferID}),
	})
	if closed.Type != rp.RegistryEnvelopeTypeResponse {
		_ = s.writeError(clientPeer, in.RequestID, in.Method, codeUnavailable, "Hub could not close file download probe", nil)
		return
	}
	token, err := s.fileDownloads.issue(fileDownloadTask{
		DeviceID:  state.browserDeviceID,
		BasePath:  state.browserBasePath,
		ProjectID: in.ProjectID,
		Source:    payload.Source,
		FileName:  opened.FileName,
		MimeType:  opened.MimeType,
		Size:      opened.Size,
		Identity:  opened.Identity,
	})
	if err != nil {
		_ = s.writeError(clientPeer, in.RequestID, in.Method, codeBusy, "too many pending file downloads", nil)
		return
	}
	downloadPath := state.browserBasePath + "download/" + token
	_ = s.writeResponse(clientPeer, in.RequestID, in.Method, in.ProjectID, map[string]any{
		"ok":           true,
		"downloadPath": downloadPath,
		"fileName":     opened.FileName,
		"mimeType":     opened.MimeType,
		"size":         opened.Size,
	})
}

func validFileDownloadSource(source fileDownloadSource) bool {
	switch source.Kind {
	case fileDownloadSourceProject, fileDownloadSourceExternal:
		return source.Path != "" && source.SessionID == "" && source.AttachmentID == "" && source.URI == ""
	case fileDownloadSourceAttachment:
		return source.Path == "" && source.SessionID != "" && (source.AttachmentID == "") != (source.URI == "")
	default:
		return false
	}
}

func validFileDownloadOpenResponse(opened fileDownloadHubOpenResponse) bool {
	return opened.OK && opened.TransferID != "" && opened.FileName != "" && opened.MimeType != "" && opened.Size >= 0 && opened.Identity != ""
}

func registryFileDownloadRoute(requestPath string) (basePath, token string, ok bool) {
	if requestPath == "" || !strings.HasPrefix(requestPath, "/") || strings.Contains(requestPath, "\\") || path.Clean(requestPath) != requestPath {
		return "", "", false
	}
	const marker = "/download/"
	if strings.Count(requestPath, marker) != 1 {
		return "", "", false
	}
	index := strings.Index(requestPath, marker)
	token = requestPath[index+len(marker):]
	if token == "" || strings.Contains(token, "/") {
		return "", "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != 32 || base64.RawURLEncoding.EncodeToString(raw) != token {
		return "", "", false
	}
	basePath = requestPath[:index+1]
	if !validRegistryBasePath(basePath) {
		return "", "", false
	}
	return basePath, token, true
}

func (s *Server) handleFileDownloadHTTP(w http.ResponseWriter, r *http.Request, token string) {
	setNoStore(w)
	w.Header().Set("Accept-Ranges", "none")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Header.Get("Range") != "" {
		http.Error(w, "range requests are not supported", http.StatusRequestedRangeNotSatisfiable)
		return
	}
	session, ok := s.authenticateWebRequest(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	task, err := s.fileDownloads.claim(token, session.DeviceID, requestRegistryBasePath(r))
	if err != nil {
		status := http.StatusGone
		if errors.Is(err, errFileDownloadSessionMismatch) {
			status = http.StatusForbidden
		}
		http.Error(w, "download is no longer available", status)
		return
	}

	openEnvelope := s.executeProjectRequest(r.Context(), "", envelope{
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadOpen,
		ProjectID: task.ProjectID,
		Payload:   rp.MustRaw(map[string]any{"source": task.Source}),
	})
	if openEnvelope.Type != rp.RegistryEnvelopeTypeResponse {
		http.Error(w, "download source is unavailable", http.StatusServiceUnavailable)
		return
	}
	var opened fileDownloadHubOpenResponse
	if json.Unmarshal(openEnvelope.Payload, &opened) != nil || !validFileDownloadOpenResponse(opened) {
		http.Error(w, "invalid download metadata", http.StatusBadGateway)
		return
	}
	defer s.closeHubFileDownload(task.ProjectID, opened.TransferID)
	if opened.FileName != task.FileName || opened.MimeType != task.MimeType || opened.Size != task.Size || opened.Identity != task.Identity {
		http.Error(w, "download source changed", http.StatusConflict)
		return
	}

	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Disposition", fileDownloadContentDisposition(opened.FileName))
	w.Header().Set("Content-Type", safeFileDownloadMIME(opened.MimeType))
	w.Header().Set("Content-Length", strconv.FormatInt(opened.Size, 10))
	w.WriteHeader(http.StatusOK)

	var offset int64
	for offset < opened.Size {
		readEnvelope := s.executeProjectRequest(r.Context(), "", envelope{
			Type:      rp.RegistryEnvelopeTypeRequest,
			Method:    rp.RegistryMethodFileDownloadRead,
			ProjectID: task.ProjectID,
			Payload: rp.MustRaw(map[string]any{
				"transferId": opened.TransferID,
				"offset":     offset,
				"maxBytes":   fileDownloadHTTPChunkSize,
			}),
		})
		if readEnvelope.Type != rp.RegistryEnvelopeTypeResponse {
			return
		}
		var chunk fileDownloadHubReadResponse
		if json.Unmarshal(readEnvelope.Payload, &chunk) != nil || !chunk.OK {
			return
		}
		decoded, decodeErr := base64.StdEncoding.DecodeString(chunk.Data)
		if decodeErr != nil || len(decoded) == 0 || len(decoded) > fileDownloadHTTPChunkSize || chunk.NextOffset != offset+int64(len(decoded)) || chunk.NextOffset > opened.Size {
			return
		}
		if (chunk.EOF && chunk.NextOffset != opened.Size) || (!chunk.EOF && chunk.NextOffset == opened.Size) {
			return
		}
		if _, writeErr := w.Write(decoded); writeErr != nil {
			return
		}
		offset = chunk.NextOffset
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
}

const fileDownloadHTTPChunkSize = 256 * 1024

func (s *Server) closeHubFileDownload(projectID, transferID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.executeProjectRequest(ctx, "", envelope{
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadClose,
		ProjectID: projectID,
		Payload:   rp.MustRaw(map[string]any{"transferId": transferID}),
	})
}

func safeFileDownloadMIME(value string) string {
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil || mediaType == "" {
		return "application/octet-stream"
	}
	return mediaType
}

func fileDownloadContentDisposition(fileName string) string {
	fileName = safeFileDownloadName(fileName)
	var fallback strings.Builder
	for _, char := range fileName {
		if char < 0x20 || char > 0x7e || strings.ContainsRune(`"\\/;`, char) {
			fallback.WriteByte('_')
			continue
		}
		fallback.WriteRune(char)
	}
	if fallback.Len() == 0 {
		fallback.WriteString("download")
	}
	encoded := strings.ReplaceAll(url.PathEscape(fileName), "+", "%20")
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fallback.String(), encoded)
}

func safeFileDownloadName(value string) string {
	value = strings.ReplaceAll(value, "\\", "/")
	value = path.Base(value)
	if value == "" || value == "." || value == "/" {
		return "download"
	}
	return value
}
