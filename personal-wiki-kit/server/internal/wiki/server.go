package wiki

import (
	"errors"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const sessionCookieName = "wiki_session"

type ServerConfig struct {
	Root            string
	PasswordHash    string
	LocalNoAuth     bool
	SessionTTL      time.Duration
	MaximumAttempts int
	AttemptWindow   time.Duration
	SecureCookie    bool
}

type Server struct {
	root         string
	passwordHash string
	sessions     *sessionStore
	limiter      *attemptLimiter
	secureCookie bool
	localNoAuth  bool
	loginPage    *template.Template
}

func NewServer(config ServerConfig) (*Server, error) {
	if !filepath.IsAbs(config.Root) {
		return nil, errors.New("site root must be absolute")
	}
	if err := VerifyRoot(filepath.Clean(config.Root)); err != nil {
		return nil, fmt.Errorf("verify site root: %w", err)
	}
	if config.LocalNoAuth {
		if config.PasswordHash != "" {
			return nil, errors.New("local no-auth mode must not receive a password hash")
		}
		config.SecureCookie = false
	} else if _, _, _, err := parsePasswordHash(config.PasswordHash); err != nil {
		return nil, fmt.Errorf("password hash: %w", err)
	}
	if config.SessionTTL <= 0 {
		config.SessionTTL = 12 * time.Hour
	}
	if config.MaximumAttempts <= 0 {
		config.MaximumAttempts = 5
	}
	if config.AttemptWindow <= 0 {
		config.AttemptWindow = 15 * time.Minute
	}
	page, err := template.New("login").Parse(loginPageHTML)
	if err != nil {
		return nil, fmt.Errorf("parse login page: %w", err)
	}
	return &Server{
		root:         filepath.Clean(config.Root),
		passwordHash: config.PasswordHash,
		sessions:     newSessionStore(config.SessionTTL),
		limiter:      newAttemptLimiter(config.MaximumAttempts, config.AttemptWindow),
		secureCookie: config.SecureCookie,
		localNoAuth:  config.LocalNoAuth,
		loginPage:    page,
	}, nil
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", server.health)
	mux.HandleFunc("/login", server.login)
	mux.HandleFunc("/logout", server.logout)
	mux.HandleFunc("/", server.protectedStatic)
	return server.securityHeaders(mux)
}

func (server *Server) health(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writer.Header().Set("Allow", "GET, HEAD")
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	for _, relative := range []string{"index.html", "data/catalog.json", "release-manifest.json"} {
		info, err := os.Stat(filepath.Join(server.root, filepath.FromSlash(relative)))
		if err != nil || !info.Mode().IsRegular() {
			http.Error(writer, "site unavailable", http.StatusServiceUnavailable)
			return
		}
	}
	writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(http.StatusOK)
	if request.Method != http.MethodHead {
		_, _ = writer.Write([]byte("ok\n"))
	}
}

func (server *Server) login(writer http.ResponseWriter, request *http.Request) {
	if server.localNoAuth {
		http.Redirect(writer, request, "/", http.StatusSeeOther)
		return
	}
	if request.Method == http.MethodGet || request.Method == http.MethodHead {
		if server.authenticated(request) {
			http.Redirect(writer, request, "/", http.StatusSeeOther)
			return
		}
		server.renderLogin(writer, request, "", http.StatusOK)
		return
	}
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", "GET, HEAD, POST")
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	key := clientKey(request)
	if allowed, retry := server.limiter.allowed(key); !allowed {
		writer.Header().Set("Retry-After", strconv.Itoa(max(1, int(retry.Seconds()))))
		server.renderLogin(writer, request, "尝试次数过多，请稍后再试。", http.StatusTooManyRequests)
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, 4096)
	if err := request.ParseForm(); err != nil {
		server.renderLogin(writer, request, "请求无法读取。", http.StatusBadRequest)
		return
	}
	valid, err := VerifyPassword(server.passwordHash, request.FormValue("password"))
	if err != nil {
		http.Error(writer, "authentication unavailable", http.StatusInternalServerError)
		return
	}
	if !valid {
		server.limiter.failed(key)
		server.renderLogin(writer, request, "密码不正确。", http.StatusUnauthorized)
		return
	}
	server.limiter.reset(key)
	token, expires, err := server.sessions.create()
	if err != nil {
		http.Error(writer, "authentication unavailable", http.StatusInternalServerError)
		return
	}
	http.SetCookie(writer, &http.Cookie{
		Name: sessionCookieName, Value: token, Path: "/", Expires: expires, MaxAge: int(time.Until(expires).Seconds()),
		HttpOnly: true, Secure: server.secureCookie, SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(writer, request, "/", http.StatusSeeOther)
}

func (server *Server) logout(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", "POST")
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if server.localNoAuth {
		http.Redirect(writer, request, "/", http.StatusSeeOther)
		return
	}
	if cookie, err := request.Cookie(sessionCookieName); err == nil {
		server.sessions.delete(cookie.Value)
	}
	http.SetCookie(writer, &http.Cookie{
		Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(1, 0),
		HttpOnly: true, Secure: server.secureCookie, SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(writer, request, "/login", http.StatusSeeOther)
}

func (server *Server) protectedStatic(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writer.Header().Set("Allow", "GET, HEAD")
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !server.localNoAuth && !server.authenticated(request) {
		if strings.HasPrefix(request.URL.Path, "/data/") || strings.HasPrefix(request.URL.Path, "/attachments/") || strings.HasPrefix(request.URL.Path, "/assets/") {
			http.Error(writer, "unauthorized", http.StatusUnauthorized)
			return
		}
		http.Redirect(writer, request, "/login", http.StatusSeeOther)
		return
	}
	server.serveFile(writer, request)
}

func (server *Server) serveFile(writer http.ResponseWriter, request *http.Request) {
	cleanURLPath := strings.TrimPrefix(filepath.ToSlash(filepath.Clean("/"+request.URL.Path)), "/")
	if cleanURLPath == "" || cleanURLPath == "." {
		cleanURLPath = "index.html"
	}
	for _, segment := range strings.Split(cleanURLPath, "/") {
		if strings.HasPrefix(segment, ".") {
			http.NotFound(writer, request)
			return
		}
	}
	filename := filepath.Join(server.root, filepath.FromSlash(cleanURLPath))
	relative, err := filepath.Rel(server.root, filename)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		http.NotFound(writer, request)
		return
	}
	info, err := os.Stat(filename)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(writer, request)
		return
	}
	if strings.HasPrefix(request.URL.Path, "/assets/") {
		writer.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		writer.Header().Set("Cache-Control", "no-store")
	}
	http.ServeFile(writer, request, filename)
}

func (server *Server) authenticated(request *http.Request) bool {
	if server.localNoAuth {
		return true
	}
	cookie, err := request.Cookie(sessionCookieName)
	return err == nil && server.sessions.valid(cookie.Value)
}

func ValidateListenAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("listen address must include a valid host and port: %w", err)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	parsed := net.ParseIP(host)
	if parsed == nil || !parsed.IsLoopback() {
		return errors.New("listen address must use a loopback host")
	}
	return nil
}

func (server *Server) renderLogin(writer http.ResponseWriter, request *http.Request, message string, status int) {
	writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	if request.Method == http.MethodHead {
		return
	}
	_ = server.loginPage.Execute(writer, struct{ Message string }{Message: message})
}

func (server *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		writer.Header().Set("Referrer-Policy", "no-referrer")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("X-Frame-Options", "DENY")
		writer.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		writer.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
		next.ServeHTTP(writer, request)
	})
}

func clientKey(request *http.Request) string {
	forwarded := strings.Split(request.Header.Get("X-Forwarded-For"), ",")
	for index := len(forwarded) - 1; index >= 0; index-- {
		candidate := strings.TrimSpace(forwarded[index])
		if net.ParseIP(candidate) != nil {
			return candidate
		}
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func validatePublicURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
		return errors.New("public URL must be an HTTPS origin")
	}
	return nil
}

const loginPageHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>登录 · Knowledge Registry</title>
<style>
:root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#17212b;background:#eef2f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}body>main{width:min(420px,100%)}.shell{width:100%;border:1px solid #bcc8d3;background:#fff}.head{padding:28px 30px 22px;border-bottom:1px solid #d7dee5}.mark{display:grid;width:34px;height:34px;place-items:center;margin-bottom:22px;background:#244a6a;color:#fff;font:600 14px ui-monospace,monospace}.head small{display:block;margin-bottom:7px;color:#687887;font-size:11px;letter-spacing:.12em;text-transform:uppercase}.head h1{margin:0;font-size:27px;font-weight:500;letter-spacing:-.025em}.head p{margin:9px 0 0;color:#687887;font-size:13px;line-height:1.55}.form{padding:26px 30px 30px}.form label{display:block;margin-bottom:8px;color:#3f4d5a;font-size:12px;font-weight:600}.form input{width:100%;height:43px;border:1px solid #aebbc7;padding:0 12px;font:15px ui-monospace,monospace;outline:0}.form input:focus{border-color:#315f85;box-shadow:0 0 0 1px #315f85}.form button{width:100%;height:43px;margin-top:14px;border:1px solid #244a6a;background:#244a6a;color:#fff;cursor:pointer;font-size:13px;font-weight:600}.form button:hover{background:#315f85}.error{margin:0 0 14px;border-left:3px solid #934949;background:#f7eded;color:#773838;padding:9px 11px;font-size:12px}.foot{margin-top:14px;color:#7a8792;font-size:10px;text-align:center}
</style></head><body><main><div class="shell"><div class="head"><div class="mark">KR</div><small>Verified personal knowledge</small><h1>Knowledge Registry</h1><p>输入密码后读取经过确认、整理与版本化的个人知识。</p></div><form class="form" method="post" action="/login">{{if .Message}}<p class="error">{{.Message}}</p>{{end}}<label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus required maxlength="1024"><button type="submit">进入知识库</button></form></div><p class="foot">Private · Reviewed · Versioned</p></main></body></html>`
