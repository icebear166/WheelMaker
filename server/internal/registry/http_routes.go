package registry

import (
	"context"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/swm8023/wheelmaker/internal/portrelay"
)

type registryBasePathContextKey struct{}

func registryBasePath(requestPath string) (string, bool) {
	if requestPath == "" || !strings.HasPrefix(requestPath, "/") || strings.Contains(requestPath, "\\") || path.Clean(requestPath) != requestPath {
		return "", false
	}
	if requestPath == "/ws" {
		return "/", true
	}
	if !strings.HasSuffix(requestPath, "/ws") {
		return "", false
	}
	prefix := strings.TrimSuffix(requestPath, "/ws")
	if prefix == "" || prefix == "/" {
		return "", false
	}
	for _, segment := range strings.Split(strings.TrimPrefix(prefix, "/"), "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", false
		}
	}
	return prefix + "/", true
}

func requestRegistryBasePath(r *http.Request) string {
	if basePath, ok := r.Context().Value(registryBasePathContextKey{}).(string); ok {
		return basePath
	}
	return "/"
}

func (s *Server) handleHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get(portrelay.RelayMarkerHeader) == portrelay.RelayMarkerValue {
		if s.relay == nil {
			http.Error(w, "relay controller unavailable", http.StatusServiceUnavailable)
			return
		}
		s.relay.ServeHTTP(w, r)
		return
	}
	if basePath, ok := registryHTMLPreviewBasePath(r.URL.Path); ok {
		if r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), registryBasePathContextKey{}, basePath))
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeRegistryHTMLPreviewError(w, http.StatusMethodNotAllowed)
			return
		}
		s.handleRegistryHTMLPreview(w, r)
		return
	}

	basePath, ok := registryBasePath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	r = r.WithContext(context.WithValue(r.Context(), registryBasePathContextKey{}, basePath))

	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	authValues, hasAuth := query["auth"]
	if !hasAuth {
		if len(query) != 0 {
			http.NotFound(w, r)
			return
		}
		s.handleWS(w, r)
		return
	}
	if len(query) != 1 || len(authValues) != 1 {
		http.NotFound(w, r)
		return
	}

	switch {
	case authValues[0] == "login" && r.Method == http.MethodPost:
		s.handleWebLogin(w, r)
	case authValues[0] == "status" && r.Method == http.MethodGet:
		s.handleWebAuthStatus(w, r)
	case authValues[0] == "logout" && r.Method == http.MethodPost:
		s.handleWebLogout(w, r)
	default:
		http.NotFound(w, r)
	}
}
