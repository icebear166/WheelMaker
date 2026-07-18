package registry

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

type hubReleaseNotifyPayload struct {
	TargetHubID string `json:"targetHubId"`
	Kind        string `json:"kind"`
	BaseURL     string `json:"baseUrl"`
}

type hubReleaseApplyStatus struct {
	Status    string `json:"status"`
	ErrorCode string `json:"errorCode,omitempty"`
}

func (s *Server) handleHubReleaseNotify(peer *peerConn, state *connectionState, in envelope) {
	var payload hubReleaseNotifyPayload
	if err := decodePayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid hub.release.notify payload", nil)
		return
	}
	if strings.TrimSpace(in.HubID) == "" || strings.TrimSpace(in.HubID) != state.hubID {
		_ = s.writeError(peer, in.RequestID, in.Method, codeForbidden, "hubId mismatch", nil)
		return
	}
	payload.TargetHubID = strings.TrimSpace(payload.TargetHubID)
	if payload.TargetHubID == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "targetHubId is required", nil)
		return
	}
	if payload.Kind != "version" && payload.Kind != "debugWeb" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported release kind", nil)
		return
	}
	baseURL, err := cleanHTTPSOrigin(payload.BaseURL)
	if err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "baseUrl must be a clean HTTPS origin", nil)
		return
	}

	s.mu.RLock()
	target := s.hubs[payload.TargetHubID]
	targetPeer := s.hubPeers[payload.TargetHubID]
	s.mu.RUnlock()
	if target.HubID == "" {
		_ = s.writeError(peer, in.RequestID, in.Method, codeNotFound, "target hub not found", map[string]any{"hubId": payload.TargetHubID})
		return
	}
	if targetPeer == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnavailable, "target hub offline", map[string]any{"hubId": payload.TargetHubID})
		return
	}

	forwardID := s.nextForwardID.Add(1)
	waitCh, err := targetPeer.registerPending(forwardID)
	if err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeBusy, "target hub request backlog is full", nil)
		return
	}
	request := envelope{
		RequestID: forwardID,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodHubReleaseApply,
		HubID:     payload.TargetHubID,
		Payload: rp.MustRaw(map[string]string{
			"kind":    payload.Kind,
			"baseUrl": baseURL,
		}),
	}
	if err := targetPeer.write(request); err != nil {
		targetPeer.resolvePending(forwardID, envelope{})
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "target hub request write failed", nil)
		return
	}

	select {
	case response, ok := <-waitCh:
		if !ok || response.Type == rp.RegistryEnvelopeTypeError {
			_ = s.writeResponse(peer, in.RequestID, in.Method, "", hubReleaseApplyStatus{Status: "failed", ErrorCode: "target_hub_failed"})
			return
		}
		var status hubReleaseApplyStatus
		if err := json.Unmarshal(response.Payload, &status); err != nil || !validReleaseApplyStatus(status.Status) {
			_ = s.writeResponse(peer, in.RequestID, in.Method, "", hubReleaseApplyStatus{Status: "failed", ErrorCode: "target_hub_invalid_status"})
			return
		}
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", status)
	case <-time.After(60 * time.Second):
		targetPeer.resolvePending(forwardID, envelope{})
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", hubReleaseApplyStatus{Status: "failed", ErrorCode: "target_hub_timeout"})
	}
}

func cleanHTTPSOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		if err == nil {
			err = errors.New("not a clean HTTPS origin")
		}
		return "", err
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}

func validReleaseApplyStatus(status string) bool {
	return status == "accepted" || status == "success" || status == "failed"
}
