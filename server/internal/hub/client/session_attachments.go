package client

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	attachmentChunkSize        = 1024 * 1024
	attachmentMaxBytes         = 50 * 1024 * 1024
	attachmentIdleTTL          = 3 * time.Minute
	attachmentThumbnailMaxEdge = 128
	attachmentThumbnailQuality = 75
)

var attachmentNow = time.Now

type attachmentManager struct {
	mu      sync.Mutex
	uploads map[string]*attachmentUpload
}

type attachmentUpload struct {
	UploadID    string
	ProjectName string
	SessionID   string
	Name        string
	MimeType    string
	Size        int64
	Received    int64
	Root        string
	PartPath    string
	CreatedAt   time.Time
	TouchedAt   time.Time
}

type attachmentSidecar struct {
	AttachmentID   string              `json:"attachmentId"`
	ProjectName    string              `json:"projectName"`
	SessionID      string              `json:"sessionId"`
	Name           string              `json:"name"`
	MimeType       string              `json:"mimeType,omitempty"`
	Size           int64               `json:"size"`
	SHA256         string              `json:"sha256"`
	FileName       string              `json:"fileName"`
	URI            string              `json:"uri"`
	CreatedAt      time.Time           `json:"createdAt"`
	Sent           bool                `json:"sent,omitempty"`
	Kind           string              `json:"kind,omitempty"`
	Thumbnail      attachmentThumbnail `json:"thumbnail,omitempty"`
	ThumbnailError string              `json:"thumbnailError,omitempty"`
}

type attachmentThumbnail struct {
	FileName string `json:"fileName,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
	Size     int64  `json:"size,omitempty"`
	SHA256   string `json:"sha256,omitempty"`
}

type attachmentRef struct {
	sidecarPath string
	filePath    string
}

func newAttachmentManager() *attachmentManager {
	return &attachmentManager{uploads: map[string]*attachmentUpload{}}
}

func (c *Client) handleSessionAttachmentStart(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID string `json:"sessionId"`
		Name      string `json:"name"`
		MimeType  string `json:"mimeType,omitempty"`
		Size      int64  `json:"size"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.start payload: %w", err)
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("sessionId is required")
	}
	if _, err := c.SessionByID(ctx, sessionID); err != nil {
		return nil, err
	}
	root, err := c.sessionAttachmentRoot(sessionID)
	if err != nil {
		return nil, err
	}
	upload, err := c.attachmentManager().start(c.projectName, sessionID, root, req.Name, req.MimeType, req.Size)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"ok":        true,
		"sessionId": sessionID,
		"uploadId":  upload.UploadID,
		"chunkSize": attachmentChunkSize,
		"expiresIn": int(attachmentIdleTTL / time.Second),
	}, nil
}

func (c *Client) handleSessionAttachmentChunk(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID string `json:"sessionId"`
		UploadID  string `json:"uploadId"`
		Offset    int64  `json:"offset"`
		Data      string `json:"data"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.chunk payload: %w", err)
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("sessionId is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	received, err := c.attachmentManager().appendChunk(sessionID, req.UploadID, req.Offset, req.Data)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "sessionId": sessionID, "uploadId": strings.TrimSpace(req.UploadID), "received": received}, nil
}

func (c *Client) handleSessionAttachmentFinish(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID string `json:"sessionId"`
		UploadID  string `json:"uploadId"`
		SHA256    string `json:"sha256"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.finish payload: %w", err)
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("sessionId is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	attachment, block, err := c.attachmentManager().finish(sessionID, req.UploadID, req.SHA256)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "sessionId": sessionID, "attachment": attachment, "block": block}, nil
}

func (c *Client) handleSessionAttachmentCancel(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID string `json:"sessionId"`
		UploadID  string `json:"uploadId"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.cancel payload: %w", err)
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("sessionId is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := c.attachmentManager().cancel(sessionID, req.UploadID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "sessionId": sessionID, "uploadId": strings.TrimSpace(req.UploadID)}, nil
}

func (c *Client) handleSessionAttachmentDelete(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID    string `json:"sessionId"`
		AttachmentID string `json:"attachmentId"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.delete payload: %w", err)
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("sessionId is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	root, err := c.sessionAttachmentRoot(sessionID)
	if err != nil {
		return nil, err
	}
	if err := c.attachmentManager().deleteAttachment(root, sessionID, req.AttachmentID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "sessionId": sessionID, "attachmentId": strings.TrimSpace(req.AttachmentID)}, nil
}

func (c *Client) handleSessionAttachmentThumbnail(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID    string `json:"sessionId"`
		AttachmentID string `json:"attachmentId,omitempty"`
		URI          string `json:"uri,omitempty"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.thumbnail payload: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resolved, err := c.resolveSessionAttachment(ctx, req.SessionID, req.AttachmentID, req.URI)
	if err != nil {
		return nil, err
	}
	kind := resolved.sidecar.Kind
	if kind == "" {
		kind = attachmentKind(resolved.sidecar.MimeType, resolved.sidecar.Name, resolved.sidecar.URI)
	}
	if kind != "image" {
		return nil, fmt.Errorf("not_image: attachment is not an image")
	}
	if resolved.sidecar.Thumbnail.FileName == "" {
		return nil, fmt.Errorf("thumbnail not found")
	}
	thumbPath := filepath.Join(resolved.root, resolved.sidecar.Thumbnail.FileName)
	raw, err := os.ReadFile(thumbPath)
	if err != nil {
		return nil, fmt.Errorf("read thumbnail: %w", err)
	}
	return map[string]any{
		"ok":           true,
		"sessionId":    resolved.sidecar.SessionID,
		"attachmentId": resolved.sidecar.AttachmentID,
		"mimeType":     firstNonEmpty(resolved.sidecar.Thumbnail.MimeType, "image/jpeg"),
		"encoding":     "base64",
		"content":      base64.StdEncoding.EncodeToString(raw),
		"width":        resolved.sidecar.Thumbnail.Width,
		"height":       resolved.sidecar.Thumbnail.Height,
		"size":         len(raw),
		"hash":         hashBytesForAttachment(raw),
	}, nil
}

func (c *Client) handleSessionAttachmentRead(ctx context.Context, payload json.RawMessage) (any, error) {
	var req struct {
		SessionID    string `json:"sessionId"`
		AttachmentID string `json:"attachmentId,omitempty"`
		URI          string `json:"uri,omitempty"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.attachment.read payload: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resolved, err := c.resolveSessionAttachment(ctx, req.SessionID, req.AttachmentID, req.URI)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(resolved.filePath)
	if err != nil {
		return nil, fmt.Errorf("read attachment: %w", err)
	}

	// Detect if binary and get MIME type
	isBinary, mimeType := detectAttachmentBinaryAndMime(raw)
	if mimeType == "" {
		mimeType = resolved.sidecar.MimeType
	}

	// Return different format based on file type
	if isBinary {
		return map[string]any{
			"ok":           true,
			"sessionId":    resolved.sidecar.SessionID,
			"attachmentId": resolved.sidecar.AttachmentID,
			"mimeType":     mimeType,
			"encoding":     "base64",
			"content":      base64.StdEncoding.EncodeToString(raw),
			"isBinary":     true,
			"size":         len(raw),
			"hash":         hashBytesForAttachment(raw),
		}, nil
	}

	// Text files return UTF-8 string
	return map[string]any{
		"ok":           true,
		"sessionId":    resolved.sidecar.SessionID,
		"attachmentId": resolved.sidecar.AttachmentID,
		"mimeType":     mimeType,
		"encoding":     "utf-8",
		"content":      string(raw),
		"isBinary":     false,
		"size":         len(raw),
		"hash":         hashBytesForAttachment(raw),
	}, nil
}

type resolvedSessionAttachment struct {
	root     string
	filePath string
	sidecar  attachmentSidecar
}

// ResolveSessionAttachmentDownload resolves a persisted attachment without
// loading its contents into memory.
func (c *Client) ResolveSessionAttachmentDownload(
	ctx context.Context,
	sessionID string,
	attachmentID string,
	uri string,
) (path, fileName, mimeType string, err error) {
	resolved, err := c.resolveSessionAttachment(ctx, sessionID, attachmentID, uri)
	if err != nil {
		return "", "", "", err
	}
	fileName = resolved.sidecar.Name
	if fileName == "" {
		fileName = filepath.Base(resolved.sidecar.FileName)
	}
	return resolved.filePath, fileName, resolved.sidecar.MimeType, nil
}

func (c *Client) resolveSessionAttachment(ctx context.Context, sessionID, attachmentID, uri string) (resolvedSessionAttachment, error) {
	if err := ctx.Err(); err != nil {
		return resolvedSessionAttachment{}, err
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return resolvedSessionAttachment{}, fmt.Errorf("sessionId is required")
	}
	root, err := c.sessionAttachmentRoot(sessionID)
	if err != nil {
		return resolvedSessionAttachment{}, err
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return resolvedSessionAttachment{}, err
	}
	attachmentID = strings.TrimSpace(attachmentID)
	uri = strings.TrimSpace(uri)
	if attachmentID == "" && uri == "" {
		return resolvedSessionAttachment{}, fmt.Errorf("attachmentId or uri is required")
	}

	var filePath string
	var sidecarPath string
	if uri != "" {
		parsed, err := url.Parse(uri)
		if err != nil || !strings.EqualFold(parsed.Scheme, "file") {
			return resolvedSessionAttachment{}, fmt.Errorf("attachment uri must be file://")
		}
		filePath = attachmentFileURIPath(parsed)
		if filePath == "" {
			return resolvedSessionAttachment{}, fmt.Errorf("attachment uri has no path")
		}
	} else {
		if !validAttachmentID(attachmentID) {
			return resolvedSessionAttachment{}, fmt.Errorf("invalid attachmentId")
		}
		sidecarPath = filepath.Join(rootAbs, attachmentID+".json")
	}

	if filePath != "" {
		filePath, err = filepath.Abs(filePath)
		if err != nil {
			return resolvedSessionAttachment{}, err
		}
		if !pathWithinRoot(rootAbs, filePath) {
			return resolvedSessionAttachment{}, fmt.Errorf("attachment file is outside session attachments")
		}
		sidecarPath = attachmentSidecarPath(filePath)
	}
	sidecar, err := readAttachmentSidecar(sidecarPath)
	if err != nil {
		return resolvedSessionAttachment{}, fmt.Errorf("attachment sidecar: %w", err)
	}
	if attachmentID != "" && sidecar.AttachmentID != attachmentID {
		return resolvedSessionAttachment{}, fmt.Errorf("attachmentId mismatch")
	}
	if strings.TrimSpace(sidecar.ProjectName) != strings.TrimSpace(c.projectName) || strings.TrimSpace(sidecar.SessionID) != sessionID {
		return resolvedSessionAttachment{}, fmt.Errorf("attachment does not belong to session")
	}
	if strings.TrimSpace(sidecar.FileName) == "" {
		return resolvedSessionAttachment{}, fmt.Errorf("attachment file name is missing")
	}
	expectedFilePath := filepath.Join(rootAbs, sidecar.FileName)
	expectedFilePath, err = filepath.Abs(expectedFilePath)
	if err != nil {
		return resolvedSessionAttachment{}, err
	}
	if !pathWithinRoot(rootAbs, expectedFilePath) {
		return resolvedSessionAttachment{}, fmt.Errorf("attachment file is outside session attachments")
	}
	if filePath != "" && filepath.Clean(filePath) != filepath.Clean(expectedFilePath) {
		return resolvedSessionAttachment{}, fmt.Errorf("attachment sidecar path mismatch")
	}
	return resolvedSessionAttachment{root: rootAbs, filePath: expectedFilePath, sidecar: sidecar}, nil
}

func validAttachmentID(attachmentID string) bool {
	return strings.HasPrefix(attachmentID, "sha256-") && len(attachmentID) == len("sha256-")+sha256.Size*2
}

func pathWithinRoot(rootAbs, pathAbs string) bool {
	rel, err := filepath.Rel(rootAbs, pathAbs)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && !filepath.IsAbs(rel)
}

func hashBytesForAttachment(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (c *Client) validateSessionAttachmentBlocks(ctx context.Context, sessionID string, blocks []acp.ContentBlock) ([]attachmentRef, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || len(blocks) == 0 {
		return nil, nil
	}
	root, err := c.sessionAttachmentRoot(sessionID)
	if err != nil {
		return nil, err
	}
	var refs []attachmentRef
	for _, block := range blocks {
		if block.Type != acp.ContentBlockTypeImage && block.Type != acp.ContentBlockTypeResourceLink {
			continue
		}
		uri := strings.TrimSpace(block.URI)
		if uri == "" {
			continue
		}
		parsed, err := url.Parse(uri)
		if err != nil || !strings.EqualFold(parsed.Scheme, "file") {
			continue
		}
		ref, err := c.attachmentManager().validateFileBlock(root, c.projectName, sessionID, parsed)
		if err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	return refs, nil
}

func (c *Client) markSessionAttachmentsSent(refs []attachmentRef) error {
	if len(refs) == 0 {
		return nil
	}
	if c.markAttachmentsSent != nil {
		return c.markAttachmentsSent(refs)
	}
	return c.attachmentManager().markSent(refs)
}

func (c *Client) attachmentManager() *attachmentManager {
	if c.attachments != nil {
		return c.attachments
	}
	c.attachments = newAttachmentManager()
	return c.attachments
}

func (c *Client) sessionAttachmentRoot(sessionID string) (string, error) {
	root, err := c.sessionHistoryRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, safeHistoryPathPart(c.projectName), safeHistoryPathPart(sessionID), "attachments"), nil
}

func (c *Client) copyForkAttachment(ctx context.Context, sourceSessionID, targetSessionID, uri string) (string, error) {
	resolved, err := c.resolveSessionAttachment(ctx, sourceSessionID, "", uri)
	if err != nil {
		return "", err
	}
	targetRoot, err := c.sessionAttachmentRoot(targetSessionID)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(targetRoot, 0o755); err != nil {
		return "", fmt.Errorf("mkdir target attachment dir: %w", err)
	}
	targetFilePath := filepath.Join(targetRoot, resolved.sidecar.FileName)
	raw, err := os.ReadFile(resolved.filePath)
	if err != nil {
		return "", fmt.Errorf("read source attachment: %w", err)
	}
	if err := os.WriteFile(targetFilePath, raw, 0o600); err != nil {
		return "", fmt.Errorf("write target attachment: %w", err)
	}
	sidecar := resolved.sidecar
	sidecar.ProjectName = c.projectName
	sidecar.SessionID = targetSessionID
	sidecar.URI, err = fileURI(targetFilePath)
	if err != nil {
		return "", err
	}
	if thumbnailFileName := strings.TrimSpace(sidecar.Thumbnail.FileName); thumbnailFileName != "" {
		sourceThumbnailPath := filepath.Join(resolved.root, thumbnailFileName)
		targetThumbnailPath := filepath.Join(targetRoot, thumbnailFileName)
		thumbnail, readErr := os.ReadFile(sourceThumbnailPath)
		if readErr != nil {
			return "", fmt.Errorf("read source attachment thumbnail: %w", readErr)
		}
		if err := os.WriteFile(targetThumbnailPath, thumbnail, 0o600); err != nil {
			return "", fmt.Errorf("write target attachment thumbnail: %w", err)
		}
	}
	if err := writeAttachmentSidecar(attachmentSidecarPath(targetFilePath), sidecar); err != nil {
		return "", fmt.Errorf("write target attachment sidecar: %w", err)
	}
	return sidecar.URI, nil
}

func (c *Client) sessionHistoryRoot() (string, error) {
	if c != nil && c.sessionRecorder != nil && c.sessionRecorder.turnStore != nil {
		if root := strings.TrimSpace(c.sessionRecorder.turnStore.root); root != "" {
			return root, nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".wheelmaker", "db", "session"), nil
}

func (m *attachmentManager) start(projectName, sessionID, root, name, mimeType string, size int64) (*attachmentUpload, error) {
	if m == nil {
		return nil, fmt.Errorf("attachment manager is required")
	}
	name = attachmentDisplayName(name)
	mimeType = strings.TrimSpace(mimeType)
	if size < 0 {
		return nil, fmt.Errorf("attachment size must be non-negative")
	}
	if size > attachmentMaxBytes {
		return nil, fmt.Errorf("attachment size %d exceeds %d bytes", size, attachmentMaxBytes)
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	now := attachmentNow()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupExpiredLocked(now)

	var uploadID string
	var partPath string
	for i := 0; i < 8; i++ {
		uploadID = "upload-" + randomHex(12)
		if _, exists := m.uploads[uploadID]; exists {
			continue
		}
		partPath = filepath.Join(root, "."+uploadID+".part")
		f, err := os.OpenFile(partPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			_ = f.Close()
			break
		}
		if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		uploadID = ""
	}
	if uploadID == "" {
		return nil, fmt.Errorf("allocate upload id")
	}
	upload := &attachmentUpload{
		UploadID:    uploadID,
		ProjectName: strings.TrimSpace(projectName),
		SessionID:   strings.TrimSpace(sessionID),
		Name:        name,
		MimeType:    mimeType,
		Size:        size,
		Root:        root,
		PartPath:    partPath,
		CreatedAt:   now,
		TouchedAt:   now,
	}
	m.uploads[uploadID] = upload
	return upload, nil
}

func (m *attachmentManager) appendChunk(sessionID, uploadID string, offset int64, encoded string) (int64, error) {
	if m == nil {
		return 0, fmt.Errorf("attachment manager is required")
	}
	now := attachmentNow()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupExpiredLocked(now)
	upload, err := m.uploadLocked(sessionID, uploadID)
	if err != nil {
		return 0, err
	}
	if offset != upload.Received {
		return 0, fmt.Errorf("attachment upload offset mismatch: got %d want %d", offset, upload.Received)
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return 0, fmt.Errorf("attachment chunk data must be valid base64: %w", err)
	}
	if len(data) > attachmentChunkSize {
		return 0, fmt.Errorf("attachment chunk exceeds %d bytes", attachmentChunkSize)
	}
	if upload.Received+int64(len(data)) > upload.Size {
		return 0, fmt.Errorf("attachment chunk exceeds declared size")
	}
	f, err := os.OpenFile(upload.PartPath, os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return 0, err
	}
	if _, err := f.Write(data); err != nil {
		return 0, err
	}
	upload.Received += int64(len(data))
	upload.TouchedAt = now
	return upload.Received, nil
}

func (m *attachmentManager) finish(sessionID, uploadID, expectedSHA string) (map[string]any, acp.ContentBlock, error) {
	if m == nil {
		return nil, acp.ContentBlock{}, fmt.Errorf("attachment manager is required")
	}
	now := attachmentNow()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupExpiredLocked(now)
	upload, err := m.uploadLocked(sessionID, uploadID)
	if err != nil {
		return nil, acp.ContentBlock{}, err
	}
	expectedSHA = strings.ToLower(strings.TrimSpace(expectedSHA))
	if len(expectedSHA) != sha256.Size*2 {
		return nil, acp.ContentBlock{}, fmt.Errorf("attachment sha256 is required")
	}
	if upload.Received != upload.Size {
		return nil, acp.ContentBlock{}, fmt.Errorf("attachment upload incomplete: received %d of %d bytes", upload.Received, upload.Size)
	}
	raw, err := os.ReadFile(upload.PartPath)
	if err != nil {
		return nil, acp.ContentBlock{}, err
	}
	sum := sha256.Sum256(raw)
	actualSHA := hex.EncodeToString(sum[:])
	if actualSHA != expectedSHA {
		_ = os.Remove(upload.PartPath)
		delete(m.uploads, upload.UploadID)
		return nil, acp.ContentBlock{}, fmt.Errorf("attachment sha256 mismatch")
	}
	attachmentID := "sha256-" + actualSHA
	ext := attachmentExtension(upload.Name, upload.MimeType)
	fileName := attachmentID + ext
	finalPath := filepath.Join(upload.Root, fileName)
	if _, err := os.Stat(finalPath); errors.Is(err, os.ErrNotExist) {
		if err := os.Rename(upload.PartPath, finalPath); err != nil {
			return nil, acp.ContentBlock{}, err
		}
	} else if err != nil {
		return nil, acp.ContentBlock{}, err
	} else if err := os.Remove(upload.PartPath); err != nil {
		return nil, acp.ContentBlock{}, err
	}
	uri, err := fileURI(finalPath)
	if err != nil {
		return nil, acp.ContentBlock{}, err
	}
	sidecar := attachmentSidecar{
		AttachmentID: attachmentID,
		ProjectName:  upload.ProjectName,
		SessionID:    upload.SessionID,
		Name:         upload.Name,
		MimeType:     upload.MimeType,
		Size:         upload.Size,
		SHA256:       actualSHA,
		FileName:     fileName,
		URI:          uri,
		CreatedAt:    now,
	}
	sidecar.Kind = attachmentKind(sidecar.MimeType, sidecar.Name, sidecar.URI)
	if sidecar.Kind == "image" {
		thumb, err := buildAttachmentThumbnail(finalPath, attachmentID)
		if err != nil {
			sidecar.ThumbnailError = err.Error()
		} else {
			sidecar.Thumbnail = thumb
		}
	}
	if err := writeAttachmentSidecar(attachmentSidecarPath(finalPath), sidecar); err != nil {
		return nil, acp.ContentBlock{}, err
	}
	delete(m.uploads, upload.UploadID)
	attachment := attachmentView(sidecar)
	block := attachmentContentBlock(sidecar)
	return attachment, block, nil
}

func (m *attachmentManager) cancel(sessionID, uploadID string) error {
	if m == nil {
		return fmt.Errorf("attachment manager is required")
	}
	now := attachmentNow()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupExpiredLocked(now)
	upload, err := m.uploadLocked(sessionID, uploadID)
	if err != nil {
		return err
	}
	_ = os.Remove(upload.PartPath)
	delete(m.uploads, upload.UploadID)
	return nil
}

func (m *attachmentManager) deleteAttachment(root, sessionID, attachmentID string) error {
	if m == nil {
		return fmt.Errorf("attachment manager is required")
	}
	attachmentID = strings.TrimSpace(attachmentID)
	if attachmentID == "" {
		return fmt.Errorf("attachmentId is required")
	}
	if !strings.HasPrefix(attachmentID, "sha256-") || len(attachmentID) != len("sha256-")+sha256.Size*2 {
		return fmt.Errorf("invalid attachmentId")
	}
	sidecarPath := filepath.Join(root, attachmentID+".json")
	sidecar, err := readAttachmentSidecar(sidecarPath)
	if err != nil {
		return err
	}
	if strings.TrimSpace(sidecar.SessionID) != strings.TrimSpace(sessionID) {
		return fmt.Errorf("attachment does not belong to session")
	}
	if sidecar.Sent {
		return fmt.Errorf("sent attachment cannot be deleted")
	}
	var thumbPath string
	if thumbFileName := strings.TrimSpace(sidecar.Thumbnail.FileName); thumbFileName != "" {
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		thumbPath, err = filepath.Abs(filepath.Join(rootAbs, thumbFileName))
		if err != nil {
			return err
		}
		if !pathWithinRoot(rootAbs, thumbPath) {
			return fmt.Errorf("attachment thumbnail is outside session attachments")
		}
	}
	filePath := filepath.Join(root, sidecar.FileName)
	if err := os.Remove(filePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if thumbPath != "" {
		if err := os.Remove(thumbPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := os.Remove(sidecarPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (m *attachmentManager) validateFileBlock(root, projectName, sessionID string, parsed *url.URL) (attachmentRef, error) {
	path := attachmentFileURIPath(parsed)
	if strings.TrimSpace(path) == "" {
		return attachmentRef{}, fmt.Errorf("attachment file uri has no path")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return attachmentRef{}, err
	}
	pathAbs, err := filepath.Abs(path)
	if err != nil {
		return attachmentRef{}, err
	}
	rel, err := filepath.Rel(rootAbs, pathAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return attachmentRef{}, fmt.Errorf("attachment file is outside session attachments")
	}
	sidecarPath := attachmentSidecarPath(pathAbs)
	sidecar, err := readAttachmentSidecar(sidecarPath)
	if err != nil {
		return attachmentRef{}, fmt.Errorf("attachment sidecar: %w", err)
	}
	if strings.TrimSpace(sidecar.ProjectName) != strings.TrimSpace(projectName) || strings.TrimSpace(sidecar.SessionID) != strings.TrimSpace(sessionID) {
		return attachmentRef{}, fmt.Errorf("attachment does not belong to session")
	}
	if filepath.Clean(filepath.Join(rootAbs, sidecar.FileName)) != filepath.Clean(pathAbs) {
		return attachmentRef{}, fmt.Errorf("attachment sidecar path mismatch")
	}
	return attachmentRef{sidecarPath: sidecarPath, filePath: pathAbs}, nil
}

func (m *attachmentManager) markSent(refs []attachmentRef) error {
	for _, ref := range refs {
		sidecar, err := readAttachmentSidecar(ref.sidecarPath)
		if err != nil {
			return err
		}
		sidecar.Sent = true
		if err := writeAttachmentSidecar(ref.sidecarPath, sidecar); err != nil {
			return err
		}
	}
	return nil
}

func (m *attachmentManager) uploadLocked(sessionID, uploadID string) (*attachmentUpload, error) {
	uploadID = strings.TrimSpace(uploadID)
	if uploadID == "" {
		return nil, fmt.Errorf("uploadId is required")
	}
	upload := m.uploads[uploadID]
	if upload == nil {
		return nil, fmt.Errorf("attachment upload not found or expired")
	}
	if strings.TrimSpace(upload.SessionID) != strings.TrimSpace(sessionID) {
		return nil, fmt.Errorf("attachment upload does not belong to session")
	}
	return upload, nil
}

func (m *attachmentManager) cleanupExpiredLocked(now time.Time) {
	for uploadID, upload := range m.uploads {
		if now.Sub(upload.TouchedAt) <= attachmentIdleTTL {
			continue
		}
		_ = os.Remove(upload.PartPath)
		delete(m.uploads, uploadID)
	}
}

func attachmentKind(mimeType, name, uri string) string {
	if _, ok := promptImageMimeType(mimeType, name, uri); ok {
		return "image"
	}
	return "file"
}

func buildAttachmentThumbnail(path string, attachmentID string) (attachmentThumbnail, error) {
	f, err := os.Open(path)
	if err != nil {
		return attachmentThumbnail{}, err
	}
	defer f.Close()
	src, _, err := image.Decode(f)
	if err != nil {
		return attachmentThumbnail{}, fmt.Errorf("decode image: %w", err)
	}
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		return attachmentThumbnail{}, fmt.Errorf("image has empty dimensions")
	}
	dstW, dstH := thumbnailDimensions(srcW, srcH)
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	background := color.NRGBA{R: 244, G: 245, B: 247, A: 255}
	for y := 0; y < dstH; y++ {
		srcY := bounds.Min.Y + y*srcH/dstH
		for x := 0; x < dstW; x++ {
			srcX := bounds.Min.X + x*srcW/dstW
			dst.Set(x, y, compositeOverBackground(color.NRGBAModel.Convert(src.At(srcX, srcY)).(color.NRGBA), background))
		}
	}
	thumbPath := filepath.Join(filepath.Dir(path), attachmentID+".thumb.jpg")
	out, err := os.OpenFile(thumbPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return attachmentThumbnail{}, err
	}
	if err := jpeg.Encode(out, dst, &jpeg.Options{Quality: attachmentThumbnailQuality}); err != nil {
		_ = out.Close()
		return attachmentThumbnail{}, err
	}
	if err := out.Close(); err != nil {
		return attachmentThumbnail{}, err
	}
	raw, err := os.ReadFile(thumbPath)
	if err != nil {
		return attachmentThumbnail{}, err
	}
	sum := sha256.Sum256(raw)
	return attachmentThumbnail{
		FileName: filepath.Base(thumbPath),
		MimeType: "image/jpeg",
		Width:    dstW,
		Height:   dstH,
		Size:     int64(len(raw)),
		SHA256:   hex.EncodeToString(sum[:]),
	}, nil
}

func thumbnailDimensions(width, height int) (int, int) {
	if width <= attachmentThumbnailMaxEdge && height <= attachmentThumbnailMaxEdge {
		return width, height
	}
	if width >= height {
		scaledHeight := maxInt(1, height*attachmentThumbnailMaxEdge/width)
		return attachmentThumbnailMaxEdge, scaledHeight
	}
	scaledWidth := maxInt(1, width*attachmentThumbnailMaxEdge/height)
	return scaledWidth, attachmentThumbnailMaxEdge
}

func compositeOverBackground(pixel color.NRGBA, background color.NRGBA) color.NRGBA {
	if pixel.A == 255 {
		return pixel
	}
	if pixel.A == 0 {
		return background
	}
	alpha := uint32(pixel.A)
	inv := uint32(255 - pixel.A)
	return color.NRGBA{
		R: uint8((uint32(pixel.R)*alpha + uint32(background.R)*inv) / 255),
		G: uint8((uint32(pixel.G)*alpha + uint32(background.G)*inv) / 255),
		B: uint8((uint32(pixel.B)*alpha + uint32(background.B)*inv) / 255),
		A: 255,
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (m *attachmentManager) uploadPartPathForTest(uploadID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if upload := m.uploads[strings.TrimSpace(uploadID)]; upload != nil {
		return upload.PartPath
	}
	return ""
}

func attachmentView(sidecar attachmentSidecar) map[string]any {
	return map[string]any{
		"id":       sidecar.AttachmentID,
		"name":     sidecar.Name,
		"mimeType": sidecar.MimeType,
		"size":     sidecar.Size,
		"sha256":   sidecar.SHA256,
		"uri":      sidecar.URI,
	}
}

func attachmentContentBlock(sidecar attachmentSidecar) acp.ContentBlock {
	return acp.ContentBlock{
		Type:     acp.ContentBlockTypeResourceLink,
		URI:      sidecar.URI,
		Name:     sidecar.Name,
		MimeType: sidecar.MimeType,
		Size:     int(sidecar.Size),
	}
}

func attachmentDisplayName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "." || name == string(os.PathSeparator) || name == "" {
		return "attachment"
	}
	name = strings.NewReplacer("\\", "_", "/", "_").Replace(name)
	return name
}

func attachmentExtension(name, mimeType string) string {
	if ext := safeAttachmentExtension(filepath.Ext(name)); ext != "" {
		return ext
	}
	extensions, err := mime.ExtensionsByType(strings.TrimSpace(mimeType))
	if err == nil && len(extensions) > 0 {
		return safeAttachmentExtension(extensions[0])
	}
	return ""
}

func safeAttachmentExtension(ext string) string {
	ext = strings.ToLower(strings.TrimSpace(ext))
	if len(ext) < 2 || len(ext) > 24 || ext[0] != '.' {
		return ""
	}
	for _, r := range ext[1:] {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return ""
	}
	return ext
}

func attachmentSidecarPath(path string) string {
	return strings.TrimSuffix(path, filepath.Ext(path)) + ".json"
}

func writeAttachmentSidecar(path string, sidecar attachmentSidecar) error {
	raw, err := json.MarshalIndent(sidecar, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func readAttachmentSidecar(path string) (attachmentSidecar, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return attachmentSidecar{}, err
	}
	var sidecar attachmentSidecar
	if err := json.Unmarshal(raw, &sidecar); err != nil {
		return attachmentSidecar{}, err
	}
	return sidecar, nil
}

func fileURI(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	uriPath := filepath.ToSlash(abs)
	if len(uriPath) >= 2 && uriPath[1] == ':' {
		uriPath = "/" + uriPath
	}
	u := url.URL{Scheme: "file", Path: uriPath}
	return u.String(), nil
}

func attachmentFileURIPath(parsed *url.URL) string {
	if parsed == nil {
		return ""
	}
	path := parsed.Path
	if parsed.Host != "" {
		path = "//" + parsed.Host + path
	}
	if len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(path)
}

func randomHex(n int) string {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%d", attachmentNow().UnixNano())))
		return hex.EncodeToString(sum[:n])
	}
	return hex.EncodeToString(raw)
}

func detectAttachmentBinaryAndMime(data []byte) (bool, string) {
	sample := data
	if len(sample) > 512 {
		sample = sample[:512]
	}
	mimeType := http.DetectContentType(sample)
	isBinary := bytes.IndexByte(sample, 0) >= 0
	if strings.HasPrefix(mimeType, "text/") || strings.Contains(mimeType, "json") || strings.Contains(mimeType, "xml") {
		isBinary = false
	}
	return isBinary, mimeType
}
