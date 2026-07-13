package registry

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func (s *Server) handleDeviceSessionRequest(peer *peerConn, state *connectionState, in envelope) {
	switch in.Method {
	case rp.RegistryMethodSecuritySessionList:
		if err := decodeStrictObject(in.Payload, &struct{}{}); err != nil {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid session list payload", nil)
			return
		}
		items, err := s.webSessions.List(state.browserDeviceID)
		if err != nil {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "list device sessions failed", nil)
			return
		}
		response := rp.RegistryDeviceSessionListResponse{Sessions: make([]rp.RegistryDeviceSession, 0, len(items))}
		for _, item := range items {
			response.Sessions = append(response.Sessions, rp.RegistryDeviceSession{
				DeviceID:          item.DeviceID,
				DeviceName:        item.DeviceName,
				BasePath:          item.BasePath,
				LastLoginIP:       item.LastLoginIP,
				LastLoginLocation: item.LastLoginLocation,
				CreatedAt:         item.CreatedAt.Format(time.RFC3339Nano),
				LastSeenAt:        item.LastSeenAt.Format(time.RFC3339Nano),
				ExpiresAt:         item.ExpiresAt.Format(time.RFC3339Nano),
				Current:           item.Current,
			})
		}
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", response)
	case rp.RegistryMethodSecuritySessionRevoke:
		var payload rp.RegistryDeviceSessionRevokePayload
		if err := decodeStrictObject(in.Payload, &payload); err != nil || payload.DeviceID == "" || strings.TrimSpace(payload.DeviceID) != payload.DeviceID {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "deviceId is required", nil)
			return
		}
		revoked, err := s.webSessions.RevokeDevice(payload.DeviceID)
		if err != nil {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "revoke device session failed", nil)
			return
		}
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", rp.RegistryDeviceSessionRevokeResponse{DeviceID: payload.DeviceID, Revoked: revoked})
		if revoked {
			s.closeBrowserDevicePeers([]string{payload.DeviceID})
		}
	case rp.RegistryMethodSecuritySessionRevokeAll:
		if err := decodeStrictObject(in.Payload, &struct{}{}); err != nil {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid revokeAll payload", nil)
			return
		}
		deviceIDs, err := s.webSessions.RevokeAll()
		if err != nil {
			_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, "revoke all device sessions failed", nil)
			return
		}
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", rp.RegistryDeviceSessionRevokeAllResponse{Revoked: len(deviceIDs)})
		s.closeBrowserDevicePeers(deviceIDs)
	}
}

func (s *Server) closeBrowserDevicePeers(deviceIDs []string) {
	wanted := make(map[string]struct{}, len(deviceIDs))
	for _, deviceID := range deviceIDs {
		wanted[deviceID] = struct{}{}
	}
	if len(wanted) == 0 {
		return
	}
	peers := make(map[*peerConn]struct{})
	s.mu.RLock()
	for _, state := range s.clientPeers {
		if _, ok := wanted[state.browserDeviceID]; ok && state.browserDeviceID != "" {
			peers[state.peer] = struct{}{}
		}
	}
	s.mu.RUnlock()
	for peer := range peers {
		peer.shutdown()
	}
}

func decodeStrictObject(raw []byte, target any) error {
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = []byte("{}")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
