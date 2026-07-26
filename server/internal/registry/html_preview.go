package registry

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"unicode/utf8"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/security"
)

const (
	registryHTMLPreviewSuffix        = "/preview/"
	maxHTMLPreviewDescriptorBytes    = 64 * 1024
	htmlPreviewContentSecurityPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'self'; sandbox allow-scripts"
	htmlPreviewErrorSecurityPolicy   = "default-src 'none'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox"
)

var (
	errHTMLPreviewMediaType          = errors.New("unsupported preview media type")
	errHTMLPreviewUnsupportedContent = errors.New("unsupported preview content")
)

type registryHTMLPreviewRequest struct {
	ProjectID string
	CSRFToken string
	Method    string
	Payload   json.RawMessage
	Source    string
}

var registryHTMLPreviewFields = map[string]struct{}{
	"source":       {},
	"projectId":    {},
	"csrfToken":    {},
	"path":         {},
	"sessionId":    {},
	"attachmentId": {},
	"uri":          {},
}

func registryHTMLPreviewBasePath(requestPath string) (string, bool) {
	if !strings.HasSuffix(requestPath, registryHTMLPreviewSuffix) {
		return "", false
	}
	return registryBasePath(strings.TrimSuffix(requestPath, registryHTMLPreviewSuffix))
}

func registryHTMLPreviewRequestAllowed(r *http.Request) bool {
	return security.RequestOriginMatchesHost(r) &&
		r.Header.Get("Sec-Fetch-Site") == "same-origin" &&
		r.Header.Get("Sec-Fetch-Mode") == "navigate" &&
		r.Header.Get("Sec-Fetch-Dest") == "iframe"
}

func decodeRegistryHTMLPreviewForm(w http.ResponseWriter, r *http.Request) (registryHTMLPreviewRequest, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/x-www-form-urlencoded" {
		return registryHTMLPreviewRequest{}, errHTMLPreviewMediaType
	}
	if r.URL.RawQuery != "" {
		return registryHTMLPreviewRequest{}, errors.New("query fields are not allowed")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxHTMLPreviewDescriptorBytes)
	if err := r.ParseForm(); err != nil {
		return registryHTMLPreviewRequest{}, err
	}
	for key, values := range r.PostForm {
		if _, ok := registryHTMLPreviewFields[key]; !ok || len(values) != 1 {
			return registryHTMLPreviewRequest{}, errors.New("invalid preview field")
		}
	}
	one := func(name string) string {
		values := r.PostForm[name]
		if len(values) != 1 {
			return ""
		}
		return values[0]
	}
	out := registryHTMLPreviewRequest{
		ProjectID: strings.TrimSpace(one("projectId")),
		CSRFToken: one("csrfToken"),
		Source:    strings.TrimSpace(one("source")),
	}
	if out.ProjectID == "" || out.CSRFToken == "" {
		return registryHTMLPreviewRequest{}, errors.New("missing common preview field")
	}

	switch out.Source {
	case "project-file", "external-file":
		path := one("path")
		if !registryHTMLPreviewHasExactFields(
			r.PostForm,
			"source",
			"projectId",
			"csrfToken",
			"path",
		) || !isHTMLPreviewPath(path) {
			return registryHTMLPreviewRequest{}, errors.New("invalid file preview source")
		}
		if out.Source == "external-file" && !isAbsoluteHTMLPreviewPath(path) {
			return registryHTMLPreviewRequest{}, errors.New("external path must be absolute")
		}
		out.Method = rp.RegistryMethodProjectFSRead
		if out.Source == "external-file" {
			out.Method = rp.RegistryMethodProjectFSExternalRead
		}
		out.Payload = rp.MustRaw(map[string]string{"path": path})
	case "session-attachment":
		sessionID := strings.TrimSpace(one("sessionId"))
		attachmentID, uri := one("attachmentId"), one("uri")
		hasAttachmentID := attachmentID != "" && registryHTMLPreviewHasExactFields(
			r.PostForm,
			"source",
			"projectId",
			"csrfToken",
			"sessionId",
			"attachmentId",
		)
		hasURI := uri != "" && registryHTMLPreviewHasExactFields(
			r.PostForm,
			"source",
			"projectId",
			"csrfToken",
			"sessionId",
			"uri",
		)
		if sessionID == "" || hasAttachmentID == hasURI {
			return registryHTMLPreviewRequest{}, errors.New("invalid attachment preview source")
		}
		payload := map[string]string{"sessionId": sessionID}
		if hasAttachmentID {
			payload["attachmentId"] = attachmentID
		} else {
			payload["uri"] = uri
		}
		out.Method = rp.RegistryMethodSessionAttachmentRead
		out.Payload = rp.MustRaw(payload)
	default:
		return registryHTMLPreviewRequest{}, errors.New("unsupported preview source")
	}
	return out, nil
}

func registryHTMLPreviewHasExactFields(form url.Values, names ...string) bool {
	if len(form) != len(names) {
		return false
	}
	for _, name := range names {
		values := form[name]
		if len(values) != 1 || strings.TrimSpace(values[0]) == "" {
			return false
		}
	}
	return true
}

func isHTMLPreviewPath(value string) bool {
	switch strings.ToLower(filepath.Ext(value)) {
	case ".html", ".htm":
		return true
	default:
		return false
	}
}

func isAbsoluteHTMLPreviewPath(value string) bool {
	if filepath.IsAbs(value) || strings.HasPrefix(value, "/") || strings.HasPrefix(value, `\\`) {
		return true
	}
	return len(value) >= 3 &&
		((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) &&
		value[1] == ':' &&
		(value[2] == '\\' || value[2] == '/')
}

type registryHTMLPreviewReadResult struct {
	Content  *string `json:"content"`
	Encoding string  `json:"encoding"`
	IsBinary *bool   `json:"isBinary"`
	MIMEType string  `json:"mimeType"`
}

func (s *Server) handleRegistryHTMLPreview(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authenticateWebRequest(r)
	if !ok {
		writeRegistryHTMLPreviewError(w, http.StatusUnauthorized)
		return
	}
	if !registryHTMLPreviewRequestAllowed(r) {
		writeRegistryHTMLPreviewError(w, http.StatusForbidden)
		return
	}
	request, err := decodeRegistryHTMLPreviewForm(w, r)
	if err != nil {
		status := http.StatusBadRequest
		var maxBytesErr *http.MaxBytesError
		switch {
		case errors.As(err, &maxBytesErr):
			status = http.StatusRequestEntityTooLarge
		case errors.Is(err, errHTMLPreviewMediaType):
			status = http.StatusUnsupportedMediaType
		}
		writeRegistryHTMLPreviewError(w, status)
		return
	}
	if subtle.ConstantTimeCompare([]byte(request.CSRFToken), []byte(session.CSRFToken)) != 1 {
		writeRegistryHTMLPreviewError(w, http.StatusForbidden)
		return
	}

	response := s.executeProjectRequest(r.Context(), "", envelope{
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    request.Method,
		ProjectID: request.ProjectID,
		Payload:   request.Payload,
	})
	if status := registryHTMLPreviewResponseStatus(response); status != http.StatusOK {
		writeRegistryHTMLPreviewError(w, status)
		return
	}
	content, err := decodeRegistryHTMLPreviewResult(request.Source, response.Payload)
	if err != nil {
		writeRegistryHTMLPreviewError(w, http.StatusUnsupportedMediaType)
		return
	}
	writeRegistryHTMLPreviewSuccess(w, content)
}

func registryHTMLPreviewResponseStatus(response envelope) int {
	if response.Type == rp.RegistryEnvelopeTypeResponse {
		return http.StatusOK
	}
	if response.Type != rp.RegistryEnvelopeTypeError {
		return http.StatusBadGateway
	}
	var payload errorPayload
	if json.Unmarshal(response.Payload, &payload) != nil {
		return http.StatusBadGateway
	}
	switch payload.Code {
	case codeNotFound:
		return http.StatusNotFound
	case codeUnavailable:
		return http.StatusServiceUnavailable
	case codeTimeout:
		return http.StatusGatewayTimeout
	default:
		return http.StatusBadGateway
	}
}

func decodeRegistryHTMLPreviewResult(source string, payload json.RawMessage) (string, error) {
	if !utf8.Valid(payload) {
		return "", errHTMLPreviewUnsupportedContent
	}
	var result registryHTMLPreviewReadResult
	if err := json.Unmarshal(payload, &result); err != nil {
		return "", err
	}
	if result.Content == nil ||
		result.IsBinary == nil ||
		*result.IsBinary ||
		!strings.EqualFold(result.Encoding, "utf-8") ||
		!utf8.ValidString(*result.Content) {
		return "", errHTMLPreviewUnsupportedContent
	}
	if source == "session-attachment" {
		mediaType, _, err := mime.ParseMediaType(result.MIMEType)
		if err != nil || !strings.EqualFold(mediaType, "text/html") {
			return "", errHTMLPreviewUnsupportedContent
		}
	}
	return *result.Content, nil
}

func writeRegistryHTMLPreviewSuccess(w http.ResponseWriter, content string) {
	setRegistryHTMLPreviewHeaders(w, htmlPreviewContentSecurityPolicy)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, content)
}

func writeRegistryHTMLPreviewError(w http.ResponseWriter, status int) {
	setRegistryHTMLPreviewHeaders(w, htmlPreviewErrorSecurityPolicy)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(
		w,
		"<!doctype html><title>HTML preview unavailable</title><p>HTML preview unavailable.</p>",
	)
}

func setRegistryHTMLPreviewHeaders(w http.ResponseWriter, policy string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", policy)
}
