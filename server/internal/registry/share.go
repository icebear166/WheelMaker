package registry

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

type shareRuntimeConfig struct {
	enabled   bool
	publicURL string
}

type shareConfigFile struct {
	Share struct {
		PublicURL string `json:"publicUrl"`
	} `json:"share"`
}

type shareCreatePayload struct {
	ProjectID string `json:"projectId"`
	Path      string `json:"path"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Expiry    string `json:"expiry"`
	Encoding  string `json:"encoding"`
	Content   string `json:"content"`
}

type shareListPayload struct {
	Cursor string `json:"cursor"`
	Limit  int    `json:"limit"`
}

type shareDeletePayload struct {
	Token string `json:"token"`
}

type shareCreateResponse struct {
	Token     string     `json:"token"`
	URL       string     `json:"url,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type shareListResponse struct {
	Enabled    bool              `json:"enabled"`
	PublicURL  string            `json:"publicUrl,omitempty"`
	Items      []shareListRecord `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
}

type shareListRecord struct {
	Token     string     `json:"token"`
	Title     string     `json:"title"`
	ProjectID string     `json:"projectId"`
	Path      string     `json:"path"`
	Kind      string     `json:"kind"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	SizeBytes int64      `json:"sizeBytes"`
	URL       string     `json:"url,omitempty"`
}

func (s *Server) currentShareConfig() shareRuntimeConfig {
	if strings.TrimSpace(s.cfg.StateDir) == "" {
		return shareRuntimeConfig{}
	}
	data, err := os.ReadFile(filepath.Join(s.cfg.StateDir, "config.json"))
	if err != nil {
		return shareRuntimeConfig{}
	}
	var file shareConfigFile
	if err := json.Unmarshal(data, &file); err != nil {
		return shareRuntimeConfig{}
	}
	publicURL, err := normalizeSharePublicURL(file.Share.PublicURL)
	if err != nil || s.shareURLConflicts(publicURL) {
		return shareRuntimeConfig{}
	}
	return shareRuntimeConfig{enabled: publicURL != "", publicURL: publicURL}
}

func normalizeSharePublicURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if strings.ContainsAny(raw, "\r\n\t?#") {
		return "", errors.New("share publicUrl contains control characters")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("share publicUrl: %w", err)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if (scheme != "http" && scheme != "https") || parsed.Opaque != "" || parsed.User != nil || parsed.Hostname() == "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.ForceQuery || (parsed.Path != "" && parsed.Path != "/") || parsed.RawPath != "" {
		return "", errors.New("share publicUrl must contain only scheme, host, optional port, and / path")
	}
	return strings.TrimSuffix(scheme+"://"+parsed.Host, "/"), nil
}

func (s *Server) shareURLConflicts(publicURL string) bool {
	// Registry does not read Gateway configuration. Host conflicts are
	// rejected by Gateway when it compiles its own config.
	return false
}

func (s *Server) handleShareRequest(state *connectionState, in envelope) {
	switch in.Method {
	case rp.RegistryMethodShareCreate:
		s.handleShareCreate(state.peer, in)
	case rp.RegistryMethodShareList:
		s.handleShareList(state.peer, in)
	case rp.RegistryMethodShareDelete:
		s.handleShareDelete(state.peer, in)
	default:
		_ = s.writeError(state.peer, in.RequestID, in.Method, codeInvalidArgument, "unsupported share method", nil)
	}
}

func (s *Server) handleShareCreate(peer *peerConn, in envelope) {
	var payload shareCreatePayload
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid share.create payload", nil)
		return
	}
	config := s.currentShareConfig()
	if !config.enabled {
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnavailable, "public sharing is disabled", nil)
		return
	}
	if s.shareStore == nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeUnavailable, "public sharing is unavailable", nil)
		return
	}
	result, err := s.shareStore.create(shareCreateInput{
		ProjectID: payload.ProjectID,
		Path:      payload.Path,
		Kind:      payload.Kind,
		Title:     payload.Title,
		Expiry:    payload.Expiry,
		Encoding:  payload.Encoding,
		Content:   payload.Content,
	})
	if err != nil {
		code := codeInternal
		if isShareRequestInputError(err) {
			code = codeInvalidArgument
		}
		_ = s.writeError(peer, in.RequestID, in.Method, code, err.Error(), nil)
		return
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", shareCreateResponse{
		Token:     result.Record.Token,
		URL:       shareURL(config.publicURL, result.Record.Token),
		CreatedAt: result.Record.CreatedAt,
		ExpiresAt: result.Record.ExpiresAt,
	})
}

func (s *Server) handleShareList(peer *peerConn, in envelope) {
	var payload shareListPayload
	if err := decodeStrictPayload(in.Payload, &payload); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid share.list payload", nil)
		return
	}
	config := s.currentShareConfig()
	response := shareListResponse{Enabled: config.enabled, Items: []shareListRecord{}}
	if config.enabled {
		response.PublicURL = config.publicURL
	}
	if s.shareStore == nil {
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", response)
		return
	}
	page, err := s.shareStore.list(payload.Cursor, payload.Limit)
	if err != nil {
		code := codeInternal
		if strings.Contains(err.Error(), "cursor") {
			code = codeInvalidArgument
		}
		_ = s.writeError(peer, in.RequestID, in.Method, code, err.Error(), nil)
		return
	}
	response.NextCursor = page.NextCursor
	response.Items = make([]shareListRecord, 0, len(page.Items))
	for _, record := range page.Items {
		item := shareListRecord{
			Token:     record.Token,
			Title:     record.Title,
			ProjectID: record.ProjectID,
			Path:      record.Path,
			Kind:      record.Kind,
			CreatedAt: record.CreatedAt,
			ExpiresAt: record.ExpiresAt,
			SizeBytes: record.SizeBytes,
		}
		if config.enabled {
			item.URL = shareURL(config.publicURL, record.Token)
		}
		response.Items = append(response.Items, item)
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", response)
}

func (s *Server) handleShareDelete(peer *peerConn, in envelope) {
	var payload shareDeletePayload
	if err := decodeStrictPayload(in.Payload, &payload); err != nil || !validShareToken(strings.TrimSpace(payload.Token)) {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInvalidArgument, "invalid share.delete payload", nil)
		return
	}
	if s.shareStore == nil {
		_ = s.writeResponse(peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
		return
	}
	if err := s.shareStore.delete(strings.TrimSpace(payload.Token)); err != nil {
		_ = s.writeError(peer, in.RequestID, in.Method, codeInternal, err.Error(), nil)
		return
	}
	_ = s.writeResponse(peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
}

func shareURL(publicURL, token string) string {
	if publicURL == "" || !validShareToken(token) {
		return ""
	}
	return publicURL + "/s/" + token
}

func isShareRequestInputError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errInvalidShareToken) || errors.Is(err, errShareContentLimit) {
		return true
	}
	message := err.Error()
	for _, marker := range []string{"required", "invalid", "encoding", "unsupported expiry", "content must", "decoded share content", "UTF-8", "too long"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}
