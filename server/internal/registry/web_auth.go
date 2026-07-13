package registry

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/swm8023/wheelmaker/internal/security"
)

const registryCSRFHeaderName = "X-WheelMaker-CSRF"

func (s *Server) handleWebLogin(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	if !security.RequestOriginMatchesHost(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var payload struct {
		Token string `json:"token"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&payload); err != nil {
		http.Error(w, "invalid login payload", http.StatusBadRequest)
		return
	}
	source := security.ClientIP(r)
	if allowed, retryAfter := s.loginLimiter.Allow(source); !allowed {
		seconds := int((retryAfter + time.Second - 1) / time.Second)
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		http.Error(w, "too many login attempts", http.StatusTooManyRequests)
		return
	}
	if subtle.ConstantTimeCompare([]byte(payload.Token), []byte(s.cfg.Token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s.loginLimiter.Success(source)
	raw, csrf, err := s.webSessions.Create()
	if err != nil {
		http.Error(w, "create session", http.StatusInternalServerError)
		return
	}
	expires := time.Now().Add(webSessionTTL)
	http.SetCookie(w, &http.Cookie{
		Name:     registrySessionCookieName,
		Value:    raw,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(webSessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   security.RequestIsHTTPS(r),
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
	}
	writeWebAuthJSON(w, http.StatusOK, response)
}

func (s *Server) handleWebLogout(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	if !security.RequestOriginMatchesHost(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	session, ok := s.authenticateWebRequest(r)
	if !ok || subtle.ConstantTimeCompare([]byte(r.Header.Get(registryCSRFHeaderName)), []byte(session.CSRFToken)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if cookie, err := r.Cookie(registrySessionCookieName); err == nil {
		s.webSessions.Revoke(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     registrySessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   security.RequestIsHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
	writeWebAuthJSON(w, http.StatusOK, map[string]any{"authenticated": false})
}

func (s *Server) authenticateWebRequest(r *http.Request) (webSession, bool) {
	cookie, err := r.Cookie(registrySessionCookieName)
	if err != nil {
		return webSession{}, false
	}
	return s.webSessions.Authenticate(cookie.Value)
}

func setNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

func writeWebAuthJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
