package registry

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/swm8023/wheelmaker/internal/security"
)

const (
	registryCSRFHeaderName = "X-WheelMaker-CSRF"
	maxWebLoginBodyBytes   = 4 * 1024
	maxDeviceNameRunes     = 80
)

type webLoginPayload struct {
	Token      string `json:"token"`
	DeviceName string `json:"deviceName"`
}

func (s *Server) handleWebLogin(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	if !security.BrowserWriteRequestAllowed(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	payload, err := decodeWebLoginPayload(w, r)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			http.Error(w, "login payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid login payload", http.StatusBadRequest)
		return
	}
	payload.DeviceName = strings.TrimSpace(payload.DeviceName)
	if payload.DeviceName == "" {
		payload.DeviceName = defaultWebSessionDeviceName
	}
	if payload.Token == "" || !utf8.ValidString(payload.DeviceName) || utf8.RuneCountInString(payload.DeviceName) > maxDeviceNameRunes {
		payload.Token = ""
		http.Error(w, "invalid login payload", http.StatusBadRequest)
		return
	}
	source := security.ClientIP(r)
	if allowed, retryAfter := s.loginLimiter.Allow(source); !allowed {
		payload.Token = ""
		seconds := int((retryAfter + time.Second - 1) / time.Second)
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		http.Error(w, "too many login attempts", http.StatusTooManyRequests)
		return
	}
	tokenMatches := subtle.ConstantTimeCompare([]byte(payload.Token), []byte(s.cfg.Token)) == 1
	payload.Token = ""
	if !tokenMatches {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s.loginLimiter.Success(source)
	basePath := requestRegistryBasePath(r)
	raw, csrf, err := s.webSessions.Create(payload.DeviceName, basePath)
	if err != nil {
		http.Error(w, "create session", http.StatusInternalServerError)
		return
	}
	expires := time.Now().Add(webSessionTTL)
	http.SetCookie(w, &http.Cookie{
		Name:     registrySessionCookieName,
		Value:    raw,
		Path:     basePath,
		Expires:  expires,
		MaxAge:   int(webSessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	writeWebAuthJSON(w, http.StatusOK, map[string]any{"authenticated": true, "csrfToken": csrf})
}

func (s *Server) handleWebAuthStatus(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	session, ok := s.authenticateWebRequest(r)
	response := map[string]any{"authenticated": ok}
	if ok {
		response["csrfToken"] = session.CSRFToken
		response["device"] = webSessionPublicView(session, true)
	}
	writeWebAuthJSON(w, http.StatusOK, response)
}

func (s *Server) handleWebLogout(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	if !security.BrowserWriteRequestAllowed(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	session, ok := s.authenticateWebRequest(r)
	if !ok || subtle.ConstantTimeCompare([]byte(r.Header.Get(registryCSRFHeaderName)), []byte(session.CSRFToken)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if cookie, err := r.Cookie(registrySessionCookieName); err == nil {
		if err := s.webSessions.Revoke(cookie.Value); err != nil {
			http.Error(w, "revoke session", http.StatusInternalServerError)
			return
		}
	}
	basePath := requestRegistryBasePath(r)
	http.SetCookie(w, &http.Cookie{
		Name:     registrySessionCookieName,
		Value:    "",
		Path:     basePath,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	writeWebAuthJSON(w, http.StatusOK, map[string]any{"authenticated": false})
}

func (s *Server) authenticateWebRequest(r *http.Request) (webSession, bool) {
	cookie, err := r.Cookie(registrySessionCookieName)
	if err != nil {
		return webSession{}, false
	}
	return s.webSessions.AuthenticateForBasePath(cookie.Value, requestRegistryBasePath(r))
}

func decodeWebLoginPayload(w http.ResponseWriter, r *http.Request) (webLoginPayload, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxWebLoginBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var payload webLoginPayload
	if err := decoder.Decode(&payload); err != nil {
		return webLoginPayload{}, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return webLoginPayload{}, err
	}
	return payload, nil
}

func webSessionPublicView(session webSession, current bool) map[string]any {
	return map[string]any{
		"deviceId":   session.DeviceID,
		"deviceName": session.DeviceName,
		"basePath":   session.BasePath,
		"createdAt":  session.CreatedAt,
		"lastSeenAt": session.LastSeenAt,
		"expiresAt":  session.ExpiresAt,
		"current":    current,
	}
}

func setNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

func writeWebAuthJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
