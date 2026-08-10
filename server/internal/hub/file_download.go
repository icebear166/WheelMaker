package hub

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	fileDownloadChunkSize    = 256 * 1024
	fileDownloadMaxTransfers = 128
)

const (
	fileDownloadSourceProject    = "project-file"
	fileDownloadSourceExternal   = "external-file"
	fileDownloadSourceAttachment = "session-attachment"
)

type fileDownloadSource struct {
	Kind         string `json:"kind"`
	Path         string `json:"path,omitempty"`
	SessionID    string `json:"sessionId,omitempty"`
	AttachmentID string `json:"attachmentId,omitempty"`
	URI          string `json:"uri,omitempty"`
}

type fileDownloadOpenPayload struct {
	Source fileDownloadSource `json:"source"`
}

type fileDownloadOpenResponse struct {
	OK         bool   `json:"ok"`
	TransferID string `json:"transferId"`
	FileName   string `json:"fileName"`
	MimeType   string `json:"mimeType"`
	Size       int64  `json:"size"`
	Identity   string `json:"identity"`
}

type fileDownloadReadPayload struct {
	TransferID string `json:"transferId"`
	Offset     int64  `json:"offset"`
	MaxBytes   int    `json:"maxBytes"`
}

type fileDownloadReadResponse struct {
	OK         bool   `json:"ok"`
	Data       string `json:"data"`
	NextOffset int64  `json:"nextOffset"`
	EOF        bool   `json:"eof"`
}

type fileDownloadClosePayload struct {
	TransferID string `json:"transferId"`
}

type sessionAttachmentDownloadResolver interface {
	ResolveSessionAttachmentDownload(ctx context.Context, sessionID, attachmentID, uri string) (path, fileName, mimeType string, err error)
}

type fileDownloadTransfer struct {
	mu       sync.Mutex
	file     *os.File
	path     string
	info     os.FileInfo
	offset   int64
	identity string
}

type fileDownloadManager struct {
	mu        sync.Mutex
	transfers map[string]*fileDownloadTransfer
}

func newFileDownloadManager() *fileDownloadManager {
	return &fileDownloadManager{transfers: make(map[string]*fileDownloadTransfer)}
}

func (m *fileDownloadManager) open(
	ctx context.Context,
	projectRoot string,
	source fileDownloadSource,
	attachmentResolver sessionAttachmentDownloadResolver,
) (fileDownloadOpenResponse, error) {
	if err := ctx.Err(); err != nil {
		return fileDownloadOpenResponse{}, err
	}
	path, fileName, declaredMIME, err := resolveFileDownloadSource(ctx, projectRoot, source, attachmentResolver)
	if err != nil {
		return fileDownloadOpenResponse{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return fileDownloadOpenResponse{}, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return fileDownloadOpenResponse{}, err
	}
	if !info.Mode().IsRegular() {
		_ = file.Close()
		return fileDownloadOpenResponse{}, errors.New("download source must be a regular file")
	}
	identity := fileDownloadIdentity(info)
	transfer := &fileDownloadTransfer{file: file, path: path, info: info, identity: identity}
	var transferID string
	for {
		transferID, err = newFileDownloadID()
		if err != nil {
			_ = file.Close()
			return fileDownloadOpenResponse{}, err
		}
		m.mu.Lock()
		if len(m.transfers) >= fileDownloadMaxTransfers {
			m.mu.Unlock()
			_ = file.Close()
			return fileDownloadOpenResponse{}, errors.New("too many active file downloads")
		}
		if _, exists := m.transfers[transferID]; exists {
			m.mu.Unlock()
			continue
		}
		m.transfers[transferID] = transfer
		m.mu.Unlock()
		break
	}
	return fileDownloadOpenResponse{
		OK:         true,
		TransferID: transferID,
		FileName:   safeDownloadFileName(fileName, path),
		MimeType:   detectFileDownloadMIME(file, declaredMIME),
		Size:       info.Size(),
		Identity:   identity,
	}, nil
}

func resolveFileDownloadSource(
	ctx context.Context,
	projectRoot string,
	source fileDownloadSource,
	attachmentResolver sessionAttachmentDownloadResolver,
) (string, string, string, error) {
	switch source.Kind {
	case fileDownloadSourceProject:
		target, _, err := safeJoin(projectRoot, source.Path)
		return target, filepath.Base(target), "", err
	case fileDownloadSourceExternal:
		target, err := resolveExternalFilePath(source.Path)
		return target, filepath.Base(target), "", err
	case fileDownloadSourceAttachment:
		if attachmentResolver == nil {
			return "", "", "", errors.New("session attachment download is unavailable")
		}
		if source.SessionID == "" || (source.AttachmentID == "" && source.URI == "") {
			return "", "", "", errors.New("sessionId and attachmentId or uri are required")
		}
		return attachmentResolver.ResolveSessionAttachmentDownload(ctx, source.SessionID, source.AttachmentID, source.URI)
	default:
		return "", "", "", errors.New("unsupported download source")
	}
}

func (m *fileDownloadManager) read(transferID string, offset int64, maxBytes int) (fileDownloadReadResponse, error) {
	m.mu.Lock()
	transfer := m.transfers[transferID]
	m.mu.Unlock()
	if transfer == nil {
		return fileDownloadReadResponse{}, errors.New("download transfer not found")
	}

	transfer.mu.Lock()
	defer transfer.mu.Unlock()
	if offset != transfer.offset || offset < 0 || offset > transfer.info.Size() {
		m.remove(transferID, transfer)
		return fileDownloadReadResponse{}, errors.New("download offset is out of sequence")
	}
	if err := fileDownloadSourceUnchanged(transfer); err != nil {
		m.remove(transferID, transfer)
		return fileDownloadReadResponse{}, err
	}
	if maxBytes <= 0 || maxBytes > fileDownloadChunkSize {
		maxBytes = fileDownloadChunkSize
	}
	remaining := transfer.info.Size() - offset
	if remaining < int64(maxBytes) {
		maxBytes = int(remaining)
	}
	buffer := make([]byte, maxBytes)
	n, err := transfer.file.ReadAt(buffer, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		m.remove(transferID, transfer)
		return fileDownloadReadResponse{}, err
	}
	if err := fileDownloadSourceUnchanged(transfer); err != nil {
		m.remove(transferID, transfer)
		return fileDownloadReadResponse{}, err
	}
	transfer.offset += int64(n)
	eof := transfer.offset == transfer.info.Size()
	response := fileDownloadReadResponse{
		OK:         true,
		Data:       base64.StdEncoding.EncodeToString(buffer[:n]),
		NextOffset: transfer.offset,
		EOF:        eof,
	}
	if eof {
		m.remove(transferID, transfer)
	}
	return response, nil
}

func (m *fileDownloadManager) close(transferID string) {
	m.mu.Lock()
	transfer := m.transfers[transferID]
	if transfer != nil {
		delete(m.transfers, transferID)
	}
	m.mu.Unlock()
	if transfer != nil {
		_ = transfer.file.Close()
	}
}

func (m *fileDownloadManager) closeAll() {
	m.mu.Lock()
	transfers := m.transfers
	m.transfers = make(map[string]*fileDownloadTransfer)
	m.mu.Unlock()
	for _, transfer := range transfers {
		_ = transfer.file.Close()
	}
}

func (m *fileDownloadManager) active() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.transfers)
}

func (m *fileDownloadManager) remove(transferID string, transfer *fileDownloadTransfer) {
	m.mu.Lock()
	if m.transfers[transferID] == transfer {
		delete(m.transfers, transferID)
	}
	m.mu.Unlock()
	_ = transfer.file.Close()
}

func fileDownloadSourceUnchanged(transfer *fileDownloadTransfer) error {
	current, err := os.Stat(transfer.path)
	if err != nil {
		return fmt.Errorf("download source changed: %w", err)
	}
	if !os.SameFile(transfer.info, current) || current.Size() != transfer.info.Size() || !current.ModTime().Equal(transfer.info.ModTime()) {
		return errors.New("download source changed")
	}
	return nil
}

func fileDownloadIdentity(info os.FileInfo) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%s", info.Size(), info.ModTime().UnixNano(), info.Mode().String())))
	return hex.EncodeToString(sum[:])
}

func newFileDownloadID() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func safeDownloadFileName(fileName, path string) string {
	name := filepath.Base(strings.ReplaceAll(fileName, "\\", "/"))
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = filepath.Base(path)
	}
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "download"
	}
	return name
}

func detectFileDownloadMIME(file *os.File, declared string) string {
	if declared != "" {
		if mediaType, _, err := mime.ParseMediaType(declared); err == nil && mediaType != "" {
			return mediaType
		}
	}
	sample := make([]byte, 512)
	n, _ := file.ReadAt(sample, 0)
	if n == 0 {
		return "application/octet-stream"
	}
	return http.DetectContentType(sample[:n])
}

func (r *Reporter) replyFileDownload(conn *websocket.Conn, req envelope) {
	switch req.Method {
	case rp.RegistryMethodFileDownloadOpen:
		var payload fileDownloadOpenPayload
		if err := decodePayload(req.Payload, &payload); err != nil {
			_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid file.download.open payload")
			return
		}
		root, err := r.projectRoot(req.ProjectID)
		if err != nil {
			_ = r.writeError(conn, req.RequestID, codeNotFound, err.Error())
			return
		}
		r.mu.RLock()
		handler := r.sessionByID[req.ProjectID]
		r.mu.RUnlock()
		resolver, _ := handler.(sessionAttachmentDownloadResolver)
		result, err := r.fileDownloads.open(context.Background(), root, payload.Source, resolver)
		if err != nil {
			r.writeFileDownloadError(conn, req, err)
			return
		}
		_ = r.writeJSON(conn, "->", envelope{RequestID: req.RequestID, Type: rp.RegistryEnvelopeTypeResponse, Method: req.Method, ProjectID: req.ProjectID, Payload: rp.MustRaw(result)})
	case rp.RegistryMethodFileDownloadRead:
		var payload fileDownloadReadPayload
		if err := decodePayload(req.Payload, &payload); err != nil || payload.TransferID == "" || payload.Offset < 0 {
			_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid file.download.read payload")
			return
		}
		result, err := r.fileDownloads.read(payload.TransferID, payload.Offset, payload.MaxBytes)
		if err != nil {
			r.writeFileDownloadError(conn, req, err)
			return
		}
		_ = r.writeJSON(conn, "->", envelope{RequestID: req.RequestID, Type: rp.RegistryEnvelopeTypeResponse, Method: req.Method, ProjectID: req.ProjectID, Payload: rp.MustRaw(result)})
	case rp.RegistryMethodFileDownloadClose:
		var payload fileDownloadClosePayload
		if err := decodePayload(req.Payload, &payload); err != nil || payload.TransferID == "" {
			_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid file.download.close payload")
			return
		}
		r.fileDownloads.close(payload.TransferID)
		_ = r.writeJSON(conn, "->", envelope{RequestID: req.RequestID, Type: rp.RegistryEnvelopeTypeResponse, Method: req.Method, ProjectID: req.ProjectID, Payload: rp.MustRaw(map[string]any{"ok": true})})
	}
}

func (r *Reporter) writeFileDownloadError(conn *websocket.Conn, req envelope, err error) {
	code := codeInvalidArgument
	if os.IsNotExist(err) {
		code = codeNotFound
	}
	_ = r.writeError(conn, req.RequestID, code, err.Error())
}
