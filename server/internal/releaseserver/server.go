package releaseserver

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var errPublisherNotConfigured = errors.New("publisher is not configured")
var errUnauthorized = errors.New("publisher authentication failed")

type Server struct {
	config         Config
	now            func() time.Time
	random         io.Reader
	diskFree       func(string) (uint64, error)
	writeJSON      func(string, any, os.FileMode) error
	randomMu       sync.Mutex
	sessionLocksMu sync.Mutex
	sessionLocks   map[string]*sync.Mutex
	statusMu       sync.Mutex
	commitMu       sync.Mutex
	debugWebMu     sync.Mutex
}

func New(cfg Config) (*Server, error) {
	return newServer(cfg, defaultServerDependencies())
}

func newServer(cfg Config, dependencies serverDependencies) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if dependencies.now == nil || dependencies.random == nil {
		return nil, errors.New("release server dependencies are incomplete")
	}
	if dependencies.diskFree == nil {
		dependencies.diskFree = availableDiskBytes
	}
	if dependencies.writeJSON == nil {
		dependencies.writeJSON = writeJSONFileAtomic
	}
	for path, mode := range map[string]os.FileMode{
		filepath.Join(cfg.DataRoot, "public"):  0o750,
		filepath.Join(cfg.DataRoot, "staging"): 0o700,
		filepath.Join(cfg.DataRoot, "data"):    0o700,
	} {
		if err := os.MkdirAll(path, mode); err != nil {
			return nil, err
		}
	}
	return &Server{
		config:       cfg,
		now:          dependencies.now,
		random:       dependencies.random,
		diskFree:     dependencies.diskFree,
		writeJSON:    dependencies.writeJSON,
		sessionLocks: map[string]*sync.Mutex{},
	}, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":                  true,
			"publisherConfigured": s.config.TokenSHA256 != "",
		})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		switch authenticate(r.Header.Get("Authorization"), s.config.TokenSHA256) {
		case nil:
		case errPublisherNotConfigured:
			writeError(w, http.StatusServiceUnavailable, "publisher_not_configured")
			return
		default:
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if s.handleAPI(w, r) {
			return
		}
	}
	writeError(w, http.StatusNotFound, "not_found")
}

func authenticate(header string, configured string) error {
	if configured == "" {
		return errPublisherNotConfigured
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) || len(header) == len(prefix) {
		return errUnauthorized
	}
	want, err := hex.DecodeString(configured)
	if err != nil || len(want) != sha256.Size {
		return errPublisherNotConfigured
	}
	got := sha256.Sum256([]byte(header[len(prefix):]))
	if subtle.ConstantTimeCompare(got[:], want) != 1 {
		return errUnauthorized
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
