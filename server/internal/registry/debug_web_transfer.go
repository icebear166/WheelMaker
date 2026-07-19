package registry

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	maxDebugWebTransferSize = int64(512 << 20)
	maxDebugWebChunkSize    = 4 << 20
	debugWebTransferTimeout = 60 * time.Second
)

type debugWebTransferSession struct {
	ID           string
	SourceHubID  string
	TargetHubID  string
	Size         int64
	SHA256       string
	Received     int64
	NextSequence int64
}

type debugWebTransferStartPayload struct {
	TransferID  string `json:"transferId"`
	TargetHubID string `json:"targetHubId"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
}

type debugWebTransferChunkPayload struct {
	TransferID string `json:"transferId"`
	Sequence   int64  `json:"sequence"`
	Data       string `json:"data"`
}

type debugWebTransferIDPayload struct {
	TransferID string `json:"transferId"`
}

func (s *Server) handleHubDebugWebTransfer(peer *peerConn, state *connectionState, in envelope) {
	if in.HubID == "" || in.HubID != state.hubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "hubId mismatch", nil)
		return
	}
	switch in.Method {
	case rp.RegistryMethodHubDebugWebTransferStart:
		s.handleHubDebugWebTransferStart(peer, state, in)
	case rp.RegistryMethodHubDebugWebTransferChunk:
		s.handleHubDebugWebTransferChunk(peer, state, in)
	case rp.RegistryMethodHubDebugWebTransferFinish:
		s.handleHubDebugWebTransferFinish(peer, state, in)
	case rp.RegistryMethodHubDebugWebTransferAbort:
		s.handleHubDebugWebTransferAbort(peer, state, in)
	default:
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported debug web transfer method", nil)
	}
}

func (s *Server) handleHubDebugWebTransferStart(peer *peerConn, state *connectionState, in envelope) {
	var payload debugWebTransferStartPayload
	if decodePayload(in.Payload, &payload) != nil || !validDebugWebTransferID(payload.TransferID) || payload.TargetHubID == "" || payload.Size <= 0 || payload.Size > maxDebugWebTransferSize || !validDebugWebSHA256(payload.SHA256) {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid debug web transfer start", nil)
		return
	}
	s.mu.RLock()
	target := s.hubPeers[payload.TargetHubID]
	s.mu.RUnlock()
	if target == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnavailable, "target hub offline", map[string]any{"hubId": payload.TargetHubID})
		return
	}
	s.debugWebTransferMu.Lock()
	if _, exists := s.debugWebTransfers[payload.TransferID]; exists {
		s.debugWebTransferMu.Unlock()
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "debug web transfer already exists", nil)
		return
	}
	session := debugWebTransferSession{ID: payload.TransferID, SourceHubID: state.hubID, TargetHubID: payload.TargetHubID, Size: payload.Size, SHA256: payload.SHA256}
	s.debugWebTransfers[payload.TransferID] = session
	s.debugWebTransferMu.Unlock()
	delivered, status := s.forwardDebugWebTransfer(peer, in, target, payload.TargetHubID, rp.RegistryMethodHubDebugWebReceiveStart)
	if !delivered || status != "accepted" {
		s.deleteDebugWebTransfer(payload.TransferID)
	}
}

func (s *Server) handleHubDebugWebTransferChunk(peer *peerConn, state *connectionState, in envelope) {
	var payload debugWebTransferChunkPayload
	if decodePayload(in.Payload, &payload) != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid debug web transfer chunk", nil)
		return
	}
	decoded, err := base64.StdEncoding.DecodeString(payload.Data)
	if err != nil || len(decoded) == 0 || len(decoded) > maxDebugWebChunkSize {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid debug web transfer chunk", nil)
		return
	}
	s.debugWebTransferMu.Lock()
	session, exists := s.debugWebTransfers[payload.TransferID]
	if !exists || session.SourceHubID != state.hubID {
		s.debugWebTransferMu.Unlock()
		_ = s.writeError(peer, in.RequestID, in.Method, codeNotFound, "debug web transfer not found", nil)
		return
	}
	if payload.Sequence != session.NextSequence || session.Received+int64(len(decoded)) > session.Size {
		s.debugWebTransferMu.Unlock()
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "invalid debug web transfer sequence", nil)
		return
	}
	s.debugWebTransferMu.Unlock()
	target := s.debugWebTarget(session.TargetHubID)
	if target == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnavailable, "target hub offline", nil)
		s.deleteDebugWebTransfer(payload.TransferID)
		return
	}
	delivered, status := s.forwardDebugWebTransfer(peer, in, target, session.TargetHubID, rp.RegistryMethodHubDebugWebReceiveChunk)
	if !delivered {
		s.deleteDebugWebTransfer(payload.TransferID)
		return
	}
	if status != "accepted" {
		return
	}
	s.debugWebTransferMu.Lock()
	session, exists = s.debugWebTransfers[payload.TransferID]
	if exists {
		session.Received += int64(len(decoded))
		session.NextSequence++
		s.debugWebTransfers[payload.TransferID] = session
	}
	s.debugWebTransferMu.Unlock()
}

func (s *Server) handleHubDebugWebTransferFinish(peer *peerConn, state *connectionState, in envelope) {
	session, ok := s.debugWebTransferForRequest(peer, state, in)
	if !ok {
		return
	}
	if session.Received != session.Size {
		_ = s.writeError(peer, in.RequestID, in.Method, codeConflict, "debug web transfer size mismatch", nil)
		return
	}
	defer s.deleteDebugWebTransfer(session.ID)
	target := s.debugWebTarget(session.TargetHubID)
	if target == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnavailable, "target hub offline", nil)
		return
	}
	_, _ = s.forwardDebugWebTransfer(peer, in, target, session.TargetHubID, rp.RegistryMethodHubDebugWebReceiveFinish)
}

func (s *Server) handleHubDebugWebTransferAbort(peer *peerConn, state *connectionState, in envelope) {
	session, ok := s.debugWebTransferForRequest(peer, state, in)
	if !ok {
		return
	}
	defer s.deleteDebugWebTransfer(session.ID)
	target := s.debugWebTarget(session.TargetHubID)
	if target == nil {
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", map[string]string{"status": "aborted"})
		return
	}
	_, _ = s.forwardDebugWebTransfer(peer, in, target, session.TargetHubID, rp.RegistryMethodHubDebugWebReceiveAbort)
}

func (s *Server) debugWebTransferForRequest(peer *peerConn, state *connectionState, in envelope) (debugWebTransferSession, bool) {
	var payload debugWebTransferIDPayload
	if decodePayload(in.Payload, &payload) != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid debug web transfer", nil)
		return debugWebTransferSession{}, false
	}
	s.debugWebTransferMu.Lock()
	session, exists := s.debugWebTransfers[payload.TransferID]
	s.debugWebTransferMu.Unlock()
	if !exists || session.SourceHubID != state.hubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeNotFound, "debug web transfer not found", nil)
		return debugWebTransferSession{}, false
	}
	return session, true
}

func (s *Server) forwardDebugWebTransfer(source *peerConn, in envelope, target *peerConn, targetHubID, method string) (bool, string) {
	forwardID := s.nextForwardID.Add(1)
	wait, err := target.registerPending(forwardID)
	if err != nil {
		_ = s.writeError(source, in.RequestID, in.Method, codeBusy, "target hub request backlog is full", nil)
		return false, ""
	}
	if err := target.write(envelope{RequestID: forwardID, Type: rp.RegistryEnvelopeTypeRequest, Method: method, HubID: targetHubID, Payload: in.Payload}); err != nil {
		target.resolvePending(forwardID, envelope{})
		_ = s.writeError(source, in.RequestID, in.Method, codeInternal, "target hub request write failed", nil)
		return false, ""
	}
	select {
	case response, ok := <-wait:
		if !ok || response.Type == rp.RegistryEnvelopeTypeError {
			_ = s.writeError(source, in.RequestID, in.Method, codeUnavailable, "target hub rejected debug web transfer", nil)
			return false, ""
		}
		var payload any
		if json.Unmarshal(response.Payload, &payload) != nil {
			_ = s.writeError(source, in.RequestID, in.Method, codeInternal, "invalid target hub response", nil)
			return false, ""
		}
		var status struct {
			Status string `json:"status"`
		}
		if json.Unmarshal(response.Payload, &status) != nil || status.Status == "" {
			_ = s.writeError(source, in.RequestID, in.Method, codeInternal, "invalid target hub response", nil)
			return false, ""
		}
		_ = s.writeResponse(source, in.RequestID, in.Method, "", payload)
		return true, status.Status
	case <-time.After(debugWebTransferTimeout):
		target.resolvePending(forwardID, envelope{})
		_ = s.writeError(source, in.RequestID, in.Method, codeTimeout, "target hub timeout", nil)
		return false, ""
	}
}

func (s *Server) debugWebTarget(hubID string) *peerConn {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.hubPeers[hubID]
}

func (s *Server) deleteDebugWebTransfer(transferID string) {
	s.debugWebTransferMu.Lock()
	delete(s.debugWebTransfers, transferID)
	s.debugWebTransferMu.Unlock()
}

func (s *Server) abortDebugWebTransfersForHub(hubID string) {
	type abortTarget struct {
		transferID string
		hubID      string
	}
	var targets []abortTarget
	s.debugWebTransferMu.Lock()
	for transferID, session := range s.debugWebTransfers {
		if session.SourceHubID != hubID && session.TargetHubID != hubID {
			continue
		}
		delete(s.debugWebTransfers, transferID)
		if session.SourceHubID == hubID && session.TargetHubID != hubID {
			targets = append(targets, abortTarget{transferID: transferID, hubID: session.TargetHubID})
		}
	}
	s.debugWebTransferMu.Unlock()
	for _, item := range targets {
		target := s.debugWebTarget(item.hubID)
		if target == nil {
			continue
		}
		_ = target.write(envelope{
			RequestID: s.nextForwardID.Add(1),
			Type:      rp.RegistryEnvelopeTypeRequest,
			Method:    rp.RegistryMethodHubDebugWebReceiveAbort,
			HubID:     item.hubID,
			Payload:   rp.MustRaw(debugWebTransferIDPayload{TransferID: item.transferID}),
		})
	}
}

func validDebugWebTransferID(value string) bool {
	return value != "" && len(value) <= 128 && !strings.ContainsAny(value, "\\/\r\n\t")
}

func validDebugWebSHA256(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32 && strings.ToLower(value) == value
}
