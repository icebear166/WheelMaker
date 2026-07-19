package tools

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"hash"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const DebugWebTransferChunkSize = 4 << 20

type debugWebTransferReceiver struct {
	stateDir string
	mu       sync.Mutex
	current  *debugWebReceiveSession
}

type debugWebReceiveSession struct {
	id           string
	size         int64
	sha256       string
	nextSequence int64
	written      int64
	hash         hash.Hash
	directory    string
	archivePath  string
	file         *os.File
	leasePath    string
}

type debugWebReceiveStart struct {
	TransferID string `json:"transferId"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
}

type debugWebReceiveChunk struct {
	TransferID string `json:"transferId"`
	Sequence   int64  `json:"sequence"`
	Data       string `json:"data"`
}

type debugWebReceiveID struct {
	TransferID string `json:"transferId"`
}

func newDebugWebTransferReceiver(stateDir string) *debugWebTransferReceiver {
	return &debugWebTransferReceiver{stateDir: filepath.Clean(stateDir)}
}

func (r *debugWebTransferReceiver) Handle(method string, raw json.RawMessage) (ReleaseTargetStatus, *CommandError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch method {
	case rp.RegistryMethodHubDebugWebReceiveStart:
		return r.start(raw)
	case rp.RegistryMethodHubDebugWebReceiveChunk:
		return r.chunk(raw)
	case rp.RegistryMethodHubDebugWebReceiveFinish:
		return r.finish(raw)
	case rp.RegistryMethodHubDebugWebReceiveAbort:
		return r.abort(raw)
	default:
		return debugWebTransferFailure("invalid_debug_web_transfer", rp.CodeInvalidArgument, "unsupported debug web transfer method")
	}
}

func (r *debugWebTransferReceiver) start(raw json.RawMessage) (ReleaseTargetStatus, *CommandError) {
	var payload debugWebReceiveStart
	if json.Unmarshal(raw, &payload) != nil || !validDebugWebReceiveID(payload.TransferID) || payload.Size <= 0 || payload.Size > maxDebugWebArchiveBytes || !validHexDigest(payload.SHA256, 64) {
		return debugWebTransferFailure("invalid_debug_web_transfer", rp.CodeInvalidArgument, "invalid debug web transfer start")
	}
	if r.current != nil {
		return debugWebTransferFailure("update_busy", rp.CodeConflict, "another debug web transfer is active")
	}
	stagingRoot := filepath.Join(r.stateDir, updateStagingDirectoryName)
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		return debugWebTransferFailure("debug_web_stage_failed", rp.CodeInternal, "create debug web staging")
	}
	leasePath := filepath.Join(stagingRoot, updateLeaseFileName)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	created, _, err := createUpdateLease(leasePath, updateLease{Schema: 1, JobID: payload.TransferID, Owner: "debug-web", State: "receiving", StartedAt: now, HeartbeatAt: now})
	if err != nil || !created {
		return debugWebTransferFailure("update_busy", rp.CodeConflict, "another update is active")
	}
	directory := filepath.Join(stagingRoot, "debug-web-"+payload.TransferID)
	if err := os.Mkdir(directory, 0o700); err != nil {
		_ = os.Remove(leasePath)
		return debugWebTransferFailure("debug_web_stage_failed", rp.CodeInternal, "create debug web transfer directory")
	}
	archivePath := filepath.Join(directory, "archive.zip")
	file, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		_ = os.RemoveAll(directory)
		_ = os.Remove(leasePath)
		return debugWebTransferFailure("debug_web_stage_failed", rp.CodeInternal, "create debug web archive")
	}
	r.current = &debugWebReceiveSession{id: payload.TransferID, size: payload.Size, sha256: payload.SHA256, hash: sha256.New(), directory: directory, archivePath: archivePath, file: file, leasePath: leasePath}
	return ReleaseTargetStatus{Status: "accepted"}, nil
}

func (r *debugWebTransferReceiver) chunk(raw json.RawMessage) (ReleaseTargetStatus, *CommandError) {
	var payload debugWebReceiveChunk
	if json.Unmarshal(raw, &payload) != nil {
		return debugWebTransferFailure("invalid_debug_web_transfer", rp.CodeInvalidArgument, "invalid debug web transfer chunk")
	}
	session := r.current
	if session == nil || session.id != payload.TransferID {
		return debugWebTransferFailure("debug_web_transfer_not_found", rp.CodeNotFound, "debug web transfer not found")
	}
	decoded, err := base64.StdEncoding.DecodeString(payload.Data)
	if err != nil || len(decoded) == 0 || len(decoded) > DebugWebTransferChunkSize {
		return debugWebTransferFailure("invalid_debug_web_chunk", rp.CodeInvalidArgument, "invalid debug web chunk")
	}
	if payload.Sequence != session.nextSequence || session.written+int64(len(decoded)) > session.size {
		return debugWebTransferFailure("debug_web_sequence_mismatch", rp.CodeConflict, "invalid debug web transfer sequence")
	}
	if _, err := session.file.Write(decoded); err != nil {
		r.cleanupCurrent()
		return debugWebTransferFailure("debug_web_write_failed", rp.CodeInternal, "write debug web archive")
	}
	_, _ = session.hash.Write(decoded)
	session.written += int64(len(decoded))
	session.nextSequence++
	if err := session.file.Sync(); err != nil {
		r.cleanupCurrent()
		return debugWebTransferFailure("debug_web_write_failed", rp.CodeInternal, "sync debug web archive")
	}
	return ReleaseTargetStatus{Status: "accepted"}, nil
}

func (r *debugWebTransferReceiver) finish(raw json.RawMessage) (ReleaseTargetStatus, *CommandError) {
	var payload debugWebReceiveID
	if json.Unmarshal(raw, &payload) != nil || r.current == nil || r.current.id != payload.TransferID {
		return debugWebTransferFailure("debug_web_transfer_not_found", rp.CodeNotFound, "debug web transfer not found")
	}
	session := r.current
	if session.file != nil {
		if err := session.file.Close(); err != nil {
			r.cleanupCurrent()
			return debugWebTransferFailure("debug_web_write_failed", rp.CodeInternal, "close debug web archive")
		}
		session.file = nil
	}
	if session.written != session.size || hex.EncodeToString(session.hash.Sum(nil)) != session.sha256 {
		r.cleanupCurrent()
		return debugWebTransferFailure("debug_web_digest_mismatch", rp.CodeInvalidArgument, "debug web archive digest mismatch")
	}
	temporaryWeb := filepath.Join(r.stateDir, ".web-debug-"+session.id+".tmp")
	_ = os.RemoveAll(temporaryWeb)
	if err := extractDebugWebZip(session.archivePath, temporaryWeb); err != nil {
		_ = os.RemoveAll(temporaryWeb)
		r.cleanupCurrent()
		return debugWebTransferFailure("debug_web_extract_failed", rp.CodeInvalidArgument, "extract debug web archive")
	}
	if err := replaceDebugWeb(filepath.Join(r.stateDir, "web"), temporaryWeb); err != nil {
		_ = os.RemoveAll(temporaryWeb)
		r.cleanupCurrent()
		return debugWebTransferFailure("debug_web_apply_failed", rp.CodeInternal, "apply debug web archive")
	}
	r.cleanupCurrent()
	return ReleaseTargetStatus{Status: "success"}, nil
}

func (r *debugWebTransferReceiver) abort(raw json.RawMessage) (ReleaseTargetStatus, *CommandError) {
	var payload debugWebReceiveID
	if json.Unmarshal(raw, &payload) != nil || !validDebugWebReceiveID(payload.TransferID) {
		return debugWebTransferFailure("invalid_debug_web_transfer", rp.CodeInvalidArgument, "invalid debug web transfer abort")
	}
	if r.current != nil && r.current.id == payload.TransferID {
		r.cleanupCurrent()
	}
	return ReleaseTargetStatus{Status: "aborted"}, nil
}

func (r *debugWebTransferReceiver) cleanupCurrent() {
	if r.current == nil {
		return
	}
	if r.current.file != nil {
		_ = r.current.file.Close()
	}
	_ = os.RemoveAll(r.current.directory)
	_ = os.Remove(r.current.leasePath)
	r.current = nil
}

func debugWebTransferFailure(errorCode, code, message string) (ReleaseTargetStatus, *CommandError) {
	return ReleaseTargetStatus{Status: "failed", ErrorCode: errorCode}, &CommandError{Code: code, Message: message}
}

func validDebugWebReceiveID(value string) bool {
	return value != "" && len(value) <= 128 && !strings.ContainsAny(value, "\\/\r\n\t")
}
