package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/portrelay"
)

const (
	desktopLocalhostListenAddress = "127.0.0.1:9633"
	desktopLocalhostOrigin        = "http://127.0.0.1:9633"
	desktopLocalhostRegistryURL   = "http://127.0.0.1:9630"
	desktopLocalhostIndexFile     = "local-index.html"
	desktopLocalhostProxyTimeout  = 3 * time.Second
	desktopLocalhostAuthMaxBytes  = 64 * 1024
)

type desktopLocalhostStateStorage interface {
	LoadOrCreate() (desktopLocalhostState, error)
	SaveSession(cookie *http.Cookie) error
	ClearSession() error
	Delete() error
}

type desktopLocalhostEdgeOptions struct {
	ListenAddress string
	RegistryURL   string
	WebRoot       string
	StateStore    desktopLocalhostStateStorage
}

type desktopLocalhostEdge struct {
	mu        sync.Mutex
	options   desktopLocalhostEdgeOptions
	server    *http.Server
	listener  net.Listener
	targetURL string
}

func newDesktopLocalhostEdge(options desktopLocalhostEdgeOptions) *desktopLocalhostEdge {
	return &desktopLocalhostEdge{options: options}
}

func desktopLocalhostFixedURL(basePath string) string {
	return desktopLocalhostOrigin + basePath
}

func (e *desktopLocalhostEdge) Start(ctx context.Context) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.server != nil {
		return e.targetURL, nil
	}
	if err := validateDesktopLocalhostEdgeOptions(e.options); err != nil {
		return "", err
	}
	indexPath := filepath.Join(e.options.WebRoot, desktopLocalhostIndexFile)
	info, err := os.Stat(indexPath)
	if err != nil {
		return "", fmt.Errorf("validate Desktop Localhost document: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("Desktop Localhost document is not a regular file")
	}
	state, err := e.options.StateStore.LoadOrCreate()
	if err != nil {
		return "", fmt.Errorf("load Desktop Localhost state: %w", err)
	}
	listener, err := net.Listen("tcp4", e.options.ListenAddress)
	if err != nil {
		return "", fmt.Errorf("listen for Desktop Localhost: %w", err)
	}
	host := listener.Addr().String()
	origin := "http://" + host
	registryURL, _ := url.Parse(e.options.RegistryURL)
	if err := probeDesktopLocalhostRegistry(ctx, registryURL, host, state, e.options.StateStore); err != nil {
		_ = listener.Close()
		return "", err
	}
	server := &http.Server{
		Addr:              host,
		Handler:           newDesktopLocalhostHandler(host, state.BasePath, e.options.WebRoot, registryURL, e.options.StateStore),
		ReadHeaderTimeout: 5 * time.Second,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
	e.listener = listener
	e.server = server
	e.targetURL = origin + state.BasePath
	go func() {
		_ = server.Serve(listener)
	}()
	return e.targetURL, nil
}

func (e *desktopLocalhostEdge) Close() error {
	e.mu.Lock()
	server := e.server
	e.server = nil
	e.listener = nil
	e.targetURL = ""
	e.mu.Unlock()
	if server == nil {
		return nil
	}
	err := server.Close()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func validateDesktopLocalhostEdgeOptions(options desktopLocalhostEdgeOptions) error {
	listenHost, _, err := net.SplitHostPort(options.ListenAddress)
	if err != nil || listenHost != "127.0.0.1" {
		return errors.New("Desktop Localhost listener must use IPv4 loopback")
	}
	registryURL, err := url.Parse(options.RegistryURL)
	if err != nil || registryURL.Scheme != "http" || registryURL.Hostname() != "127.0.0.1" ||
		registryURL.User != nil || (registryURL.Path != "" && registryURL.Path != "/") ||
		registryURL.RawQuery != "" || registryURL.Fragment != "" {
		return errors.New("Desktop Localhost Registry URL must use HTTP IPv4 loopback origin")
	}
	if options.WebRoot == "" || options.StateStore == nil {
		return errors.New("Desktop Localhost edge is not configured")
	}
	return nil
}

func newDesktopLocalhostHandler(host, basePath, webRoot string, registryURL *url.URL, stateStore desktopLocalhostStateStorage) http.Handler {
	registryProxy := newDesktopLocalhostRegistryProxy(host, basePath, registryURL, stateStore)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host || r.URL.RawPath != "" || !strings.HasPrefix(r.URL.Path, basePath) {
			http.NotFound(w, r)
			return
		}
		relativePath := strings.TrimPrefix(r.URL.Path, basePath)
		if relativePath == "ws" || strings.HasPrefix(relativePath, "ws/") {
			if !validDesktopLocalhostRelativePath(relativePath) {
				http.NotFound(w, r)
				return
			}
			state, err := stateStore.LoadOrCreate()
			if err != nil || state.BasePath != basePath {
				http.Error(w, "Desktop Localhost state unavailable", http.StatusBadGateway)
				return
			}
			registryProxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), desktopLocalhostProxyStateKey{}, state)))
			return
		}
		if r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		serveDesktopLocalhostStatic(w, r, webRoot, relativePath)
	})
}

type desktopLocalhostProxyStateKey struct{}

func newDesktopLocalhostRegistryProxy(host, basePath string, registryURL *url.URL, stateStore desktopLocalhostStateStorage) *httputil.ReverseProxy {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(registryURL)
			request.Out.Host = host
			for _, header := range []string{"Cookie", "Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP", portrelay.RelayMarkerHeader} {
				request.Out.Header.Del(header)
			}
			request.Out.Header.Set("X-Forwarded-Proto", "http")
			request.Out.Header.Set("X-Forwarded-Host", host)
			request.Out.Header.Set("X-Real-IP", "127.0.0.1")
			state, _ := request.In.Context().Value(desktopLocalhostProxyStateKey{}).(desktopLocalhostState)
			if state.BasePath == basePath && state.SessionCookie != "" {
				request.Out.Header.Set("Cookie", (&http.Cookie{
					Name:  desktopRegistrySessionCookieName,
					Value: state.SessionCookie,
				}).String())
			}
		},
		ModifyResponse: func(response *http.Response) error {
			return modifyDesktopLocalhostRegistryResponse(response, basePath, stateStore)
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "Local Registry request failed", http.StatusBadGateway)
		},
		ErrorLog: log.New(io.Discard, "", 0),
	}
	return proxy
}

func modifyDesktopLocalhostRegistryResponse(response *http.Response, basePath string, stateStore desktopLocalhostStateStorage) error {
	cookies := response.Cookies()
	response.Header.Del("Set-Cookie")
	action := response.Request.URL.Query().Get("auth")
	var sessionCookie *http.Cookie
	for _, cookie := range cookies {
		if cookie.Name == desktopRegistrySessionCookieName {
			if sessionCookie != nil {
				return errors.New("multiple Registry session cookies")
			}
			sessionCookie = cookie
		}
	}
	if sessionCookie != nil {
		if sessionCookie.Value == "" || sessionCookie.MaxAge < 0 {
			if err := stateStore.ClearSession(); err != nil {
				return errors.New("clear Desktop Localhost session")
			}
		} else if err := stateStore.SaveSession(sessionCookie); err != nil {
			return errors.New("persist Desktop Localhost session")
		}
	}
	if response.StatusCode == http.StatusUnauthorized {
		if err := stateStore.ClearSession(); err != nil {
			return errors.New("clear unauthorized Desktop Localhost session")
		}
	}
	if action == "login" && response.StatusCode >= 200 && response.StatusCode < 300 && sessionCookie == nil {
		return errors.New("Registry login omitted the session cookie")
	}
	if action == "status" && response.StatusCode >= 200 && response.StatusCode < 300 {
		authenticated, err := readDesktopLocalhostAuthStatus(response)
		if err != nil {
			return err
		}
		if !authenticated {
			if err := stateStore.ClearSession(); err != nil {
				return errors.New("clear unauthenticated Desktop Localhost session")
			}
		}
	}
	return nil
}

func readDesktopLocalhostAuthStatus(response *http.Response) (bool, error) {
	raw, err := io.ReadAll(io.LimitReader(response.Body, desktopLocalhostAuthMaxBytes+1))
	if err != nil || len(raw) > desktopLocalhostAuthMaxBytes {
		return false, errors.New("invalid Registry authentication status")
	}
	response.Body.Close()
	response.Body = io.NopCloser(bytes.NewReader(raw))
	response.ContentLength = int64(len(raw))
	response.Header.Set("Content-Length", fmt.Sprintf("%d", len(raw)))
	var payload struct {
		Authenticated bool `json:"authenticated"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return false, errors.New("invalid Registry authentication status")
	}
	return payload.Authenticated, nil
}

func probeDesktopLocalhostRegistry(ctx context.Context, registryURL *url.URL, host string, state desktopLocalhostState, stateStore desktopLocalhostStateStorage) error {
	probeURL := *registryURL
	probeURL.Path = state.BasePath + "ws"
	probeURL.RawQuery = "auth=status"
	probeContext, cancel := context.WithTimeout(ctx, desktopLocalhostProxyTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(probeContext, http.MethodGet, probeURL.String(), nil)
	if err != nil {
		return errors.New("create Local Registry status request")
	}
	request.Host = host
	request.Header.Set("X-Forwarded-Proto", "http")
	request.Header.Set("X-Forwarded-Host", host)
	request.Header.Set("X-Real-IP", "127.0.0.1")
	if state.SessionCookie != "" {
		request.AddCookie(&http.Cookie{Name: desktopRegistrySessionCookieName, Value: state.SessionCookie})
	}
	response, err := (&http.Client{
		Timeout: desktopLocalhostProxyTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}).Do(request)
	if err != nil {
		return errors.New("Local Registry is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == http.StatusUnauthorized {
			_ = stateStore.ClearSession()
		}
		return errors.New("Local Registry status check failed")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, desktopLocalhostAuthMaxBytes+1))
	if err != nil || len(raw) > desktopLocalhostAuthMaxBytes {
		return errors.New("Local Registry returned an invalid status")
	}
	var payload struct {
		Authenticated bool `json:"authenticated"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return errors.New("Local Registry returned an invalid status")
	}
	if !payload.Authenticated {
		if err := stateStore.ClearSession(); err != nil {
			return errors.New("clear unauthenticated Desktop Localhost session")
		}
	}
	return nil
}

func serveDesktopLocalhostStatic(w http.ResponseWriter, r *http.Request, webRoot, relativePath string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !validDesktopLocalhostRelativePath(relativePath) {
		http.NotFound(w, r)
		return
	}
	setDesktopLocalhostStaticHeaders(w)
	if relativePath == "" {
		serveDesktopLocalhostFile(w, r, filepath.Join(webRoot, desktopLocalhostIndexFile))
		return
	}
	targetPath := filepath.Join(webRoot, filepath.FromSlash(relativePath))
	relativeTarget, err := filepath.Rel(webRoot, targetPath)
	if err != nil || relativeTarget == ".." || strings.HasPrefix(relativeTarget, ".."+string(filepath.Separator)) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(targetPath)
	if err == nil && info.Mode().IsRegular() {
		serveDesktopLocalhostFile(w, r, targetPath)
		return
	}
	if err == nil || !errors.Is(err, os.ErrNotExist) || path.Ext(relativePath) != "" || strings.HasSuffix(relativePath, "/") {
		http.NotFound(w, r)
		return
	}
	serveDesktopLocalhostFile(w, r, filepath.Join(webRoot, desktopLocalhostIndexFile))
}

func validDesktopLocalhostRelativePath(value string) bool {
	if strings.Contains(value, "\\") || strings.HasPrefix(value, "/") {
		return false
	}
	cleaned := path.Clean("/" + value)
	if value == "" {
		return cleaned == "/"
	}
	if strings.HasSuffix(value, "/") {
		return cleaned+"/" == "/"+value
	}
	return cleaned == "/"+value
}

func setDesktopLocalhostStaticHeaders(w http.ResponseWriter) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
}

func serveDesktopLocalhostFile(w http.ResponseWriter, r *http.Request, filePath string) {
	file, err := os.Open(filePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	if contentType := mime.TypeByExtension(filepath.Ext(filePath)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, filepath.Base(filePath), info.ModTime(), file)
}
