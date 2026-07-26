package flickerbridge

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/klauspost/compress/zstd"
	_ "modernc.org/sqlite"
)

type selfTestCase struct {
	name string
	run  func() error
}

const (
	myFlickerCompactionPrefix        = "myflicker-bridge-compaction-v1:"
	myFlickerCompactionContextHeader = "Context checkpoint from an earlier model:\n"
	codexCompactionPrompt            = "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task. Include current progress and key decisions, important context and constraints, remaining work, and critical data or references. Be concise and structured."
)

func require(ok bool, format string, args ...any) error {
	if ok {
		return nil
	}
	return fmt.Errorf(format, args...)
}

type Settings struct {
	Host               string
	Port               int
	BaseURL            string
	TokenBaseURL       string
	ChatPath           string
	CachePath          string
	LogPath            string
	BridgeAPIKey       string
	DefaultModel       string
	AuthTimeout        time.Duration
	AuthPollInterval   time.Duration
	UpstreamTimeout    time.Duration
	AllowRemote        bool
	RequirePrivateKey  bool
	TrustDomain        string
	PlatformHeader     string
	PluginVersion      string
	DeviceScene        string
	SendAuthorization  bool
	ReasoningEffort    string
	ThinkingBudget     int
	ThinkingBudgetSet  bool
	AuthTestDeviceFlow bool
}

func parseSettings(args []string, environ map[string]string) (Settings, error) {
	lookup := func(name, fallback string) string {
		if environ != nil {
			if value, ok := environ[name]; ok && value != "" {
				return value
			}
			return fallback
		}
		if value, ok := os.LookupEnv(name); ok && value != "" {
			return value
		}
		return fallback
	}

	fs := flag.NewFlagSet("myflicker_bridge", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	host := fs.String("host", lookup("MYFLICKER_HOST", "127.0.0.1"), "")
	port := fs.Int("port", parseInt(lookup("MYFLICKER_PORT", "17999"), 17999), "")
	baseURL := fs.String("base-url", lookup("MYFLICKER_BASE_URL", "https://codeflicker.corp.kuaishou.com"), "")
	tokenURL := fs.String("token-base-url", lookup("MYFLICKER_TOKEN_BASE_URL", "https://myflicker.corp.kuaishou.com"), "")
	chatPath := fs.String("chat-path", lookup("MYFLICKER_CHAT_PATH", "/eapi/kwaipilot/plugin/composer/v3/chat/completions"), "")
	authTimeout := fs.Int("auth-timeout", parseInt(lookup("MYFLICKER_AUTH_TIMEOUT", "180"), 180), "")
	authPollInterval := fs.Float64("auth-poll-interval", parseFloat(lookup("MYFLICKER_AUTH_POLL_INTERVAL", "1"), 1), "")
	upstreamTimeout := fs.Int("upstream-timeout", parseInt(lookup("MYFLICKER_UPSTREAM_TIMEOUT", "600"), 600), "")
	logPath := fs.String("log-file", lookup("MYFLICKER_BRIDGE_LOG", ""), "")
	authTest := fs.Bool("test", false, "force the device-auth flow")
	fs.BoolVar(authTest, "Test", false, "force the device-auth flow")
	if err := fs.Parse(args); err != nil {
		return Settings{}, err
	}
	if *port < 1 || *port > 65535 {
		return Settings{}, fmt.Errorf("port %d is outside 1..65535", *port)
	}
	settings := Settings{
		Host:               *host,
		Port:               *port,
		BaseURL:            strings.TrimRight(*baseURL, "/"),
		TokenBaseURL:       strings.TrimRight(*tokenURL, "/"),
		ChatPath:           *chatPath,
		CachePath:          lookup("MYFLICKER_BRIDGE_CACHE", defaultCachePath()),
		LogPath:            *logPath,
		BridgeAPIKey:       lookup("MYFLICKER_BRIDGE_API_KEY", "00000000000000000000"),
		DefaultModel:       lookup("MYFLICKER_DEFAULT_MODEL", "CLAUDE_OPUS_4_7"),
		AuthTimeout:        time.Duration(*authTimeout) * time.Second,
		AuthPollInterval:   time.Duration(*authPollInterval * float64(time.Second)),
		UpstreamTimeout:    time.Duration(*upstreamTimeout) * time.Second,
		AllowRemote:        parseBool(lookup("MYFLICKER_ALLOW_REMOTE", "")),
		RequirePrivateKey:  parseBool(lookup("MYFLICKER_REQUIRE_PRIVATE_KEY", "")),
		TrustDomain:        lookup("MYFLICKER_TRUST_DOMAIN", ""),
		PlatformHeader:     lookup("MYFLICKER_KWAIPILOT_PLATFORM", "kwaipilot-ide"),
		PluginVersion:      lookup("MYFLICKER_KWAIPILOT_VERSION", "10.0.2605210"),
		DeviceScene:        lookup("MYFLICKER_KWAIPILOT_SCENE", "duet_window"),
		SendAuthorization:  parseBool(lookup("MYFLICKER_SEND_AUTHORIZATION", "")),
		ReasoningEffort:    normalizeReasoningEffort(lookup("MYFLICKER_REASONING_EFFORT", "max")),
		ThinkingBudget:     parseInt(lookup("MYFLICKER_THINKING_BUDGET_TOKENS", ""), -1),
		ThinkingBudgetSet:  strings.TrimSpace(lookup("MYFLICKER_THINKING_BUDGET_TOKENS", "")) != "",
		AuthTestDeviceFlow: *authTest,
	}
	if !isLoopbackHost(settings.Host) && (!settings.AllowRemote || settings.BridgeAPIKey == "00000000000000000000") {
		return Settings{}, errors.New("non-loopback listening requires MYFLICKER_ALLOW_REMOTE=1 and MYFLICKER_BRIDGE_API_KEY")
	}
	if isLoopbackHost(settings.Host) && settings.RequirePrivateKey && settings.BridgeAPIKey == "00000000000000000000" {
		return Settings{}, errors.New("MYFLICKER_REQUIRE_PRIVATE_KEY=1 requires MYFLICKER_BRIDGE_API_KEY")
	}
	return settings, nil
}

func parseInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseFloat(value string, fallback float64) float64 {
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

type sizeLimitedLogWriter struct {
	mu       sync.Mutex
	path     string
	maxBytes int64
	file     *os.File
}

func newSizeLimitedLogWriter(path string, maxBytes int64) (*sizeLimitedLogWriter, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		_ = file.Close()
		return nil, err
	}
	return &sizeLimitedLogWriter{path: path, maxBytes: maxBytes, file: file}, nil
}

func (writer *sizeLimitedLogWriter) Write(data []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if writer.file == nil {
		return 0, os.ErrClosed
	}
	if writer.maxBytes > 0 {
		size := int64(0)
		if info, err := writer.file.Stat(); err == nil {
			size = info.Size()
		}
		if size+int64(len(data)) > writer.maxBytes {
			if err := writer.file.Truncate(0); err != nil {
				return 0, err
			}
			if _, err := writer.file.Seek(0, io.SeekStart); err != nil {
				return 0, err
			}
			marker := fmt.Sprintf("[log] truncated previous log at %s after reaching max_bytes=%d\n", time.Now().Format("2006-01-02T15:04:05"), writer.maxBytes)
			if _, err := writer.file.WriteString(marker); err != nil {
				return 0, err
			}
		}
	}
	return writer.file.Write(data)
}

func (writer *sizeLimitedLogWriter) Close() error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if writer.file == nil {
		return nil
	}
	err := writer.file.Close()
	writer.file = nil
	return err
}

func configuredLogMaxBytes(environ map[string]string) int64 {
	const defaultMax = 20 * 1024 * 1024
	if value := bridgeEnv(environ, "MYFLICKER_LOG_MAX_BYTES"); value != "" {
		number, err := strconv.ParseFloat(value, 64)
		if err == nil {
			return int64(max(number, 0))
		}
	}
	if value := bridgeEnv(environ, "MYFLICKER_LOG_MAX_MB"); value != "" {
		number, err := strconv.ParseFloat(value, 64)
		if err == nil {
			return int64(max(number, 0) * 1024 * 1024)
		}
	}
	return defaultMax
}

func redirectProcessOutput(path string, maxBytes int64) (func(), error) {
	logWriter, err := newSizeLimitedLogWriter(path, maxBytes)
	if err != nil {
		return nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		_ = logWriter.Close()
		return nil, err
	}
	previousStdout, previousStderr := os.Stdout, os.Stderr
	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(logWriter, reader)
		_ = reader.Close()
		_ = logWriter.Close()
		close(done)
	}()
	os.Stdout, os.Stderr = writer, writer
	var once sync.Once
	return func() {
		once.Do(func() {
			os.Stdout, os.Stderr = previousStdout, previousStderr
			_ = writer.Close()
			<-done
		})
	}, nil
}

var thinkingBudgetByEffort = map[string]int{
	"none": 0, "native": 2000, "minimal": 512, "low": 1024, "medium": 4096,
	"high": 8192, "xhigh": 16000, "max": 16000,
}

func normalizeReasoningEffort(value string) string {
	effort := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(value, "-", "_")))
	switch effort {
	case "maximum":
		effort = "max"
	case "extra_high":
		effort = "xhigh"
	}
	if _, ok := thinkingBudgetByEffort[effort]; ok {
		return effort
	}
	return "max"
}

func resolveThinkingBudget(effort string, explicit int) int {
	if explicit >= 0 {
		return explicit
	}
	return thinkingBudgetByEffort[normalizeReasoningEffort(effort)]
}

func resolveThinkingConfig(payload map[string]any, settings Settings) map[string]any {
	if raw, ok := payload["thinking"].(map[string]any); ok {
		kind := strings.ToLower(firstText(raw["type"]))
		if kind == "disabled" || kind == "none" || kind == "off" || kind == "false" || kind == "0" {
			return map[string]any{"type": "disabled"}
		}
		explicit := firstPresentInt(raw["budget_tokens"], raw["budgetTokens"], raw["thinking_budget_tokens"], raw["thinkingBudgetTokens"])
		effort := normalizeReasoningEffort(firstText(raw["effort"], raw["effortLevel"], settings.ReasoningEffort))
		budget := resolveThinkingBudget(effort, explicit)
		if budget <= 0 {
			return map[string]any{"type": "disabled"}
		}
		return map[string]any{"type": "enabled", "budget_tokens": budget}
	}
	if raw, exists := payload["thinking"]; exists && (raw == false || strings.Contains("disabled,none,off,false,0", strings.ToLower(strings.TrimSpace(firstText(raw))))) {
		return map[string]any{"type": "disabled"}
	}
	reasoning, _ := payload["reasoning"].(map[string]any)
	effort := normalizeReasoningEffort(firstText(payload["reasoning_effort"], payload["reasoningEffort"], payload["effortLevel"], reasoning["effort"], settings.ReasoningEffort))
	explicit := firstPresentInt(payload["thinking_budget_tokens"], payload["thinkingBudgetTokens"])
	if explicit < 0 && settings.ThinkingBudgetSet {
		explicit = settings.ThinkingBudget
	}
	budget := resolveThinkingBudget(effort, explicit)
	if budget <= 0 {
		return map[string]any{"type": "disabled"}
	}
	return map[string]any{"type": "enabled", "budget_tokens": budget}
}

func firstPresentInt(values ...any) int {
	for _, value := range values {
		switch value := value.(type) {
		case float64:
			return int(value)
		case int:
			return value
		case int64:
			return int(value)
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(value)); err == nil {
				return parsed
			}
		}
	}
	return -1
}

func defaultCachePath() string {
	executable, err := os.Executable()
	if err != nil {
		return filepath.Join(".cache", "cache.json")
	}
	return filepath.Join(filepath.Dir(executable), ".cache", "cache.json")
}

func isLoopbackHost(host string) bool {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type authCache struct {
	Token    string `json:"token,omitempty"`
	Username string `json:"username,omitempty"`
	DeviceID string `json:"device_id,omitempty"`
	TokenExp int64  `json:"token_exp,omitempty"`
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(directory, ".cache-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, path)
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)

	if err != nil {
		return err
	}
	return json.Unmarshal(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}), target)
}

func decodeStateValue(raw []byte) (any, error) {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return "", nil
	}
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return text, nil
	}
	return value, nil
}

func readMyFlickerState(path string) (map[string]any, error) {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	defer database.Close()
	keys := []string{"codeflicker.userInfo", "codeflicker.deviceId", "composerPreferredModel", "kuaishou.codeflicker"}
	values := make(map[string]any, len(keys))
	for _, key := range keys {
		var raw []byte
		err := database.QueryRow("SELECT value FROM ItemTable WHERE key = ?", key).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		value, err := decodeStateValue(raw)
		if err != nil {
			return nil, err
		}
		values[key] = value
	}
	if blob, ok := values["kuaishou.codeflicker"].(map[string]any); ok {
		for key, value := range blob {
			if _, exists := values[key]; !exists {
				values[key] = value
			}
		}
	}
	return values, nil
}

func myFlickerStatePath(environ map[string]string) string {
	root := strings.TrimSpace(environ["MYFLICKER_USER_DATA_DIR"])
	if root == "" {
		root = filepath.Join(environ["APPDATA"], "MyFlicker")
	}
	return filepath.Join(root, "User", "globalStorage", "state.vscdb")
}

func resolveSecurityKey(environ map[string]string, candidates []string) ([]byte, error) {
	explicit := strings.TrimSpace(environ["MYFLICKER_SECURITY_KEY_B64"])
	if explicit != "" {
		key, err := base64.StdEncoding.DecodeString(explicit)
		if err != nil || len(key) != 32 {
			return nil, errors.New("MYFLICKER_SECURITY_KEY_B64 must be a base64-encoded 32-byte AES key")
		}
		return key, nil
	}
	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if key := findSecurityKeyInBytes(data); len(key) == 32 {
			return key, nil
		}
	}
	return nil, errors.New("MyFlicker security key was not found")
}

func findSecurityKeyInBytes(data []byte) []byte {
	marker := []byte("aes-256-gcm")
	index := bytes.Index(data, marker)
	if index < 0 {
		return nil
	}
	start := max(index-4096, 0)
	end := min(index+4096, len(data))
	window := data[start:end]
	for i := 0; i+46 <= len(window); i++ {
		if window[i] != '"' || window[i+45] != '"' {
			continue
		}
		candidate := string(window[i+1 : i+45])
		key, err := base64.StdEncoding.DecodeString(candidate)
		if err == nil && len(key) == 32 {
			return key
		}
	}
	return nil
}

type AuthManager struct {
	settings Settings
	environ  map[string]string
	client   *http.Client

	mu       sync.Mutex
	loaded   bool
	token    string
	username string
	deviceID string
}

func newAuthManager(settings Settings, environ map[string]string, client *http.Client) *AuthManager {
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &AuthManager{settings: settings, environ: environ, client: client}
}

func (manager *AuthManager) Token(ctx context.Context, forceRefresh bool) (string, error) {
	manager.mu.Lock()
	manager.loadLocked()
	if !forceRefresh && tokenUsable(manager.token) {
		token := manager.token
		manager.mu.Unlock()
		return token, nil
	}
	if manager.deviceID == "" {
		manager.deviceID = randomDeviceID()
	}
	deviceID := manager.deviceID
	username := manager.username
	manager.mu.Unlock()

	token, message, err := manager.fetchDeviceToken(ctx, deviceID, username)
	if err == nil && token != "" {
		manager.mu.Lock()
		manager.token = token
		manager.saveLocked()
		manager.mu.Unlock()
		return token, nil
	}
	if message == "" && err != nil {
		message = err.Error()
	}

	registerURL := strings.TrimRight(manager.settings.TokenBaseURL, "/") + "/identity/register?uuid=" + url.QueryEscape(deviceID)
	_ = exec.CommandContext(ctx, "rundll32", "url.dll,FileProtocolHandler", registerURL).Start()
	deadline := time.Now().Add(manager.settings.AuthTimeout)
	if manager.settings.AuthTimeout <= 0 {
		deadline = time.Now().Add(180 * time.Second)
	}
	interval := manager.settings.AuthPollInterval
	if interval <= 0 {
		interval = time.Second
	}
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(interval):
		}
		token, message, err = manager.fetchDeviceToken(ctx, deviceID, username)
		if err == nil && token != "" {
			manager.mu.Lock()
			manager.token = token
			manager.saveLocked()
			manager.mu.Unlock()
			return token, nil
		}
	}
	if message == "" {
		message = "authentication timed out"
	}
	return "", errors.New(message)
}

func (manager *AuthManager) Invalidate() {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.loadLocked()
	manager.token = ""
	manager.saveLocked()
}

func (manager *AuthManager) Username() string {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.loadLocked()
	return manager.username
}

func (manager *AuthManager) DeviceID() string {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.loadLocked()
	return manager.deviceID
}

func (manager *AuthManager) Status() map[string]any {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.loadLocked()
	return map[string]any{
		"token_present":     manager.token != "",
		"token_expires_at":  jwtExpiryISO(manager.token),
		"username_present":  manager.username != "",
		"device_id_present": manager.deviceID != "",
		"cache_path":        manager.settings.CachePath,
	}
}

func (manager *AuthManager) loadLocked() {
	if manager.loaded {
		return
	}
	manager.loaded = true
	lookup := func(name string) string {
		if manager.environ != nil {
			return strings.TrimSpace(manager.environ[name])
		}
		return strings.TrimSpace(os.Getenv(name))
	}
	manager.token = lookup("MYFLICKER_TOKEN")
	manager.username = lookup("MYFLICKER_USERNAME")
	manager.deviceID = lookup("MYFLICKER_DEVICE_ID")

	var cached authCache
	if readJSON(manager.settings.CachePath, &cached) == nil {
		if !tokenUsable(manager.token) && tokenUsable(cached.Token) {
			manager.token = cached.Token
		}
		if manager.username == "" {
			manager.username = cached.Username
		}
		if manager.deviceID == "" {
			manager.deviceID = cached.DeviceID
		}
	}
	stateEnv := manager.environ
	if stateEnv == nil {
		stateEnv = map[string]string{
			"MYFLICKER_USER_DATA_DIR": os.Getenv("MYFLICKER_USER_DATA_DIR"),
			"APPDATA":                 os.Getenv("APPDATA"),
		}
	}
	if values, err := readMyFlickerState(myFlickerStatePath(stateEnv)); err == nil {
		if manager.deviceID == "" {
			manager.deviceID = firstText(values["codeflicker.deviceId"], values["deviceId"])
		}
		if manager.username == "" {
			if user, ok := values["codeflicker.userInfo"].(map[string]any); ok {
				manager.username = firstText(user["name"], user["username"], user["email"], user["mail"])
			}
			if manager.username == "" {
				if user, ok := values["userSsoInfo"].(map[string]any); ok {
					manager.username = firstText(user["name"], user["username"], user["email"], user["mail"])
				}
			}
		}
	}
	if !tokenUsable(manager.token) {
		manager.token = ""
	}
}

func (manager *AuthManager) saveLocked() {
	cache := authCache{
		Token:    manager.token,
		Username: manager.username,
		DeviceID: manager.deviceID,
		TokenExp: jwtExpiry(manager.token),
	}
	_ = writeJSONAtomic(manager.settings.CachePath, cache)
}

func (manager *AuthManager) fetchDeviceToken(ctx context.Context, deviceID, username string) (string, string, error) {
	query := url.Values{"deviceId": {deviceID}}
	if manager.settings.TrustDomain != "" {
		query.Set("trustDomain", manager.settings.TrustDomain)
	}
	endpoint := strings.TrimRight(manager.settings.TokenBaseURL, "/") + "/api/kpandora/v1/identity/device/access-token?" + query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", "", err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("kwaipilot-username", username)
	request.Header.Set("kwaipilot-platform", manager.settings.PlatformHeader)
	request.Header.Set("kwaipilot-version", manager.settings.PluginVersion)
	request.Header.Set("kwaipilot-request-uuid", deviceID)
	response, err := manager.client.Do(request)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	var payload struct {
		Code int

		Message string
		Result  struct {
			AccessToken string
			Token       string
		}
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", "", err
	}
	if response.StatusCode/100 != 2 {
		return "", payload.Message, fmt.Errorf("device token request returned HTTP %d", response.StatusCode)
	}
	token := payload.Result.AccessToken
	if token == "" {
		token = payload.Result.Token
	}
	if payload.Code == 0 && token != "" {
		return token, "", nil
	}
	if payload.Message == "" {
		payload.Message = "authentication required"
	}
	return "", payload.Message, nil
}

func tokenUsable(token string) bool {
	if strings.TrimSpace(token) == "" {
		return false
	}
	expiry := jwtExpiry(token)
	return expiry == 0 || expiry > time.Now().Add(120*time.Second).Unix()
}

func jwtExpiry(token string) int64 {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0
	}
	var payload struct{ Exp int64 }
	if json.Unmarshal(raw, &payload) != nil {
		return 0
	}
	return payload.Exp
}

func jwtExpiryISO(token string) string {
	expiry := jwtExpiry(token)
	if expiry == 0 {
		return ""
	}
	return time.Unix(expiry, 0).UTC().Format(time.RFC3339)
}

func randomDeviceID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "bridge-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(raw[:4]) + "-" + hex.EncodeToString(raw[4:6]) + "-" + hex.EncodeToString(raw[6:8]) + "-" + hex.EncodeToString(raw[8:10]) + "-" + hex.EncodeToString(raw[10:])
}

type ModelEntry struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Image    bool   `json:"image"`
	Tool     bool   `json:"tool"`
	Think    bool   `json:"think"`
	MaxInput int    `json:"max_input"`
	Duet     bool   `json:"duet"`
	Agent    bool   `json:"agent"`
}

func builtinSupportedModels() []ModelEntry {
	models := []ModelEntry{
		{Type: "CLAUDE_4", Name: "Claude Sonnet 4", Image: true, Tool: true, MaxInput: 140000},
		{Type: "CLAUDE_4_5", Name: "Claude Sonnet 4.5", Image: true, Tool: true, Think: true, MaxInput: 140000, Duet: true, Agent: true},
		{Type: "CLAUDE_4_6", Name: "Claude Sonnet 4.6", Image: true, Tool: true, Think: true, MaxInput: 140000, Duet: true, Agent: true},
		{Type: "CLAUDE_OPUS_4_7", Name: "Claude Opus 4.7", Image: true, Tool: true, Think: true, MaxInput: 140000, Duet: true, Agent: true},
		{Type: "CLAUDE_5", Name: "Claude Opus 4.7", Image: true, Tool: true, Think: true, MaxInput: 140000},
		{Type: "CLAUDE_OPUS_4_5", Name: "Claude Opus 4.5", Image: true, Tool: true, Think: true, MaxInput: 140000},
		{Type: "CLAUDE_OPUS_4_6", Name: "Claude Opus 4.6", Image: true, Tool: true, Think: true, MaxInput: 140000},
		{Type: "CLAUDE_3", Name: "Claude 3.7 Sonnet", Image: true, Tool: true, MaxInput: 140000},
		{Type: "deepseek_v3", Name: "DeepSeek-V3", MaxInput: 200000},
		{Type: "GEMINI_PRO_25", Name: "Gemini 2.5 pro", Tool: true, MaxInput: 180000},
		{Type: "GEMINI_PRO_3", Name: "Gemini 3 pro", Image: true, Tool: true, MaxInput: 180000},
		{Type: "GEMINI_FLASH_3", Name: "Gemini 3 flash", Image: true, Tool: true, MaxInput: 300000},
		{Type: "GEMINI_PRO_3_1", Name: "Gemini 3.1 pro", Image: true, Tool: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "kwaipilot_40b", Name: "Kwai-KAT-V1", MaxInput: 50000},
		{Type: "kwaipilot_40b_agent", Name: "Kwai-KAT-V1-Agent", Tool: true, MaxInput: 50000},
		{Type: "kat_coder", Name: "KAT-Coder-Pro V1", Tool: true, MaxInput: 200000},
		{Type: "kat_coder_pro_v2", Name: "KAT-Coder-Pro V2", Tool: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "qwen3_32", Name: "Qwen3-235B-A22B-Instruct-2507", Tool: true},
		{Type: "QWEN_3", Name: "Qwen 3", Tool: true},
		{Type: "kat_200b", Name: "KAT-Coder-Test", Tool: true, MaxInput: 200000},
		{Type: "KIMI_K2", Name: "KIMI_K2", Tool: true, MaxInput: 200000},
		{Type: "KIMI_K2_5", Name: "KIMI K2.5", Image: true, Tool: true, Think: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "KIMI_K2_6", Name: "KIMI K2.6", Image: true, Tool: true, Think: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "KIMI_K3", Name: "KIMI K3", Image: true, Tool: true, Think: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "GLM_4_6", Name: "GLM 4.6", Tool: true, MaxInput: 140000},
		{Type: "MINIMAX_M2", Name: "Minimax M2", Tool: true, MaxInput: 140000},
		{Type: "MINIMAX_M2_1", Name: "Minimax M2.1", Tool: true, MaxInput: 140000},
		{Type: "MINIMAX_M2_5", Name: "MiniMax M2.5", Tool: true, MaxInput: 140000, Duet: true, Agent: true},
		{Type: "MINIMAX_M2_7", Name: "Minimax M2.7", Tool: true, MaxInput: 140000, Duet: true, Agent: true},
		{Type: "DEEPSEEK_V3_2", Name: "Deepseek-V3.2", Tool: true, MaxInput: 90000},
		{Type: "DEEPSEEK_V4_PRO", Name: "Deepseek-V4 PRO", Tool: true, MaxInput: 190000, Duet: true, Agent: true},
		{Type: "DEEPSEEK_V4_FLASH", Name: "Deepseek-V4 Flash", Tool: true, MaxInput: 190000, Duet: true, Agent: true},
		{Type: "GPT_5_2", Name: "GPT-5.2", Image: true, Tool: true, MaxInput: 200000},
		{Type: "GPT_5_3_CODEX", Name: "GPT-5.3 Codex", Image: true, Tool: true, Think: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "GPT_5_4", Name: "GPT-5.4", Image: true, Tool: true, Think: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "GPT_5_5", Name: "GPT-5.5", Image: true, Tool: true, Think: true, MaxInput: 200000},
		{Type: "GPT_5_6", Name: "GPT-5.6", Image: true, Tool: true, Think: true, MaxInput: 200000, Duet: true, Agent: true},
		{Type: "GLM_4_7", Name: "GLM-4.7", Tool: true, Think: true, MaxInput: 140000},
		{Type: "GLM_5", Name: "GLM-5", Tool: true, MaxInput: 140000},
		{Type: "GLM_5_AUTO", Name: "GLM-5", Tool: true, MaxInput: 140000},
		{Type: "GLM_5_TURBO", Name: "GLM 5 Turbo", Tool: true, MaxInput: 140000},
		{Type: "GLM_5_1", Name: "GLM-5.1", Tool: true, MaxInput: 140000, Duet: true, Agent: true},
		{Type: "AUTO", Name: "Auto", Image: true, Tool: true, MaxInput: 140000},
		{Type: "BYOK", Name: "Byok", Image: true, Tool: true, MaxInput: 140000},
	}
	for index := range models {
		models[index].ID = publicModelID(models[index].Type)
		models[index].Name = "MF " + strings.TrimPrefix(models[index].Name, "MF ")
	}
	return models
}

type ModelCatalog struct {
	mu     sync.RWMutex
	models []ModelEntry
}

func newModelCatalog() *ModelCatalog {
	return &ModelCatalog{models: builtinSupportedModels()}
}

func (catalog *ModelCatalog) Exposed() []ModelEntry {
	catalog.mu.RLock()
	defer catalog.mu.RUnlock()
	exposed := make([]ModelEntry, 0, len(catalog.models))
	for _, model := range catalog.models {
		if model.Duet || model.Agent {
			exposed = append(exposed, model)
		}
	}
	return exposed
}

func (catalog *ModelCatalog) Supported() []ModelEntry {
	catalog.mu.RLock()
	defer catalog.mu.RUnlock()
	return append([]ModelEntry(nil), catalog.models...)
}

func (catalog *ModelCatalog) Resolve(value string) (ModelEntry, bool) {
	catalog.mu.RLock()
	defer catalog.mu.RUnlock()
	for _, model := range catalog.models {
		if model.ID == value || model.Type == value {
			return model, true
		}
	}
	return ModelEntry{}, false
}

type modelCatalogCache struct {
	Version   int          `json:"version"`
	Source    string       `json:"source_path"`
	FetchedAt int64        `json:"fetched_at"`
	Models    []ModelEntry `json:"models"`
}

func modelCachePath(cachePath string) string {
	return filepath.Join(filepath.Dir(cachePath), "models.json")
}

func (catalog *ModelCatalog) loadCache(cachePath string) bool {
	var cache modelCatalogCache
	if readJSON(cachePath, &cache) != nil || cache.Version != 2 || len(cache.Models) == 0 {
		return false
	}
	models := make([]ModelEntry, 0, len(cache.Models))
	exposedCount := 0
	for _, model := range cache.Models {
		if model.Type == "" {
			continue
		}
		if model.ID == "" {
			model.ID = publicModelID(model.Type)
		}
		if model.Name == "" {
			model.Name = "MF " + model.Type
		}
		if model.Duet || model.Agent {
			exposedCount++
		}
		models = append(models, model)
	}
	if exposedCount == 0 {
		return false
	}
	catalog.mu.Lock()
	catalog.models = models
	catalog.mu.Unlock()
	return true
}

func (catalog *ModelCatalog) saveCache(cachePath string) error {
	catalog.mu.RLock()
	models := append([]ModelEntry(nil), catalog.models...)
	catalog.mu.RUnlock()
	if len(models) == 0 {
		return errors.New("model catalog is empty")
	}
	return writeJSONAtomic(cachePath, modelCatalogCache{Version: 2, Source: "/eapi/kwaipilot/plugin/agent/models", FetchedAt: time.Now().Unix(), Models: models})
}

func extractModelItems(payload any) []any {
	switch value := payload.(type) {
	case []any:
		return value
	case map[string]any:
		for _, key := range []string{"models", "data", "result", "list"} {
			if nested, ok := value[key]; ok {
				if items := extractModelItems(nested); len(items) > 0 {
					return items
				}
			}
		}
	}
	return nil
}

func normalizeModelEntry(item any) (ModelEntry, bool) {
	object, ok := item.(map[string]any)
	if !ok {
		return ModelEntry{}, false
	}
	modelType := firstText(object["type"], object["modelType"], object["model_type"], object["id"], object["model"])
	if modelType == "" {
		return ModelEntry{}, false
	}
	name := firstText(object["name"], object["displayName"], object["display_name"], object["modelName"], object["label"])
	if name == "" {
		name = modelType
	}
	return ModelEntry{
		Type: modelType, ID: publicModelID(modelType), Name: "MF " + strings.TrimPrefix(name, "MF "),
		Image:    truthy(object["image"], object["supportImage"], object["vision"], object["multimodal"]),
		Tool:     truthy(object["tool"], object["supportTool"], object["supportToolUse"], object["functionCalling"]),
		Think:    truthy(object["think"], object["thinking"], object["supportThink"], object["supportThinking"]),
		MaxInput: parseAnyInt(object["max_input"], object["maxInput"], object["maxInputTokens"], object["contextLength"]),
	}, true
}

func publicModelID(modelType string) string {
	if strings.HasPrefix(strings.ToUpper(modelType), "CLAUDE") {
		return modelType
	}
	return "CLAUDE-MYFLICKER-" + modelType
}

func firstText(values ...any) string {
	for _, value := range values {
		if text := strings.TrimSpace(fmt.Sprint(value)); text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

func truthy(values ...any) bool {
	for _, value := range values {
		switch value := value.(type) {
		case bool:
			return value
		case float64:
			return value != 0
		case string:
			if parseBool(value) {
				return true
			}
		}
	}
	return false
}

func parseAnyInt(values ...any) int {
	for _, value := range values {
		switch value := value.(type) {
		case float64:
			return int(value)
		case int:
			return value
		case string:
			if parsed, err := strconv.Atoi(value); err == nil {
				return parsed
			}
		}
	}
	return 0
}

type securityRule struct {
	Path           string
	Methods        []string
	EncryptRequest bool
	Signature      bool
}

type sseEvent struct {
	Event string
	Data  string
	ID    string
}

func protectRequest(rule securityRule, key []byte, method, uri string, body []byte, nonceSource io.Reader, now time.Time, nonce string) ([]byte, http.Header, error) {
	headers := make(http.Header)
	protected := append([]byte(nil), body...)
	if rule.EncryptRequest {
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, nil, err
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return nil, nil, err
		}
		iv := make([]byte, gcm.NonceSize())
		if _, err := io.ReadFull(nonceSource, iv); err != nil {
			return nil, nil, err
		}
		sealed := gcm.Seal(nil, iv, body, nil)
		tagSize := gcm.Overhead()
		payload := map[string]string{
			"iv":         base64.StdEncoding.EncodeToString(iv),
			"ciphertext": base64.StdEncoding.EncodeToString(sealed[:len(sealed)-tagSize]),
			"tag":        base64.StdEncoding.EncodeToString(sealed[len(sealed)-tagSize:]),
		}
		protected, err = json.Marshal(payload)
		if err != nil {
			return nil, nil, err
		}
		headers.Set("X-Encrypted", "true")
	}
	if rule.Signature {
		if len(key) != 32 {
			return nil, nil, errors.New("signing requires a 32-byte security key")
		}
		timestamp := strconv.FormatInt(now.UnixMilli(), 10)
		normalized := bytes.TrimSpace(protected)
		hash := sha256.Sum256(normalized)
		bodyHash := base64.StdEncoding.EncodeToString(hash[:])
		material := strings.Join([]string{strings.ToUpper(method), uri, timestamp, nonce, bodyHash}, "\n")
		mac := hmac.New(sha256.New, key)
		_, _ = mac.Write([]byte(material))
		headers.Set("X-Signature", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
		headers.Set("X-Timestamp", timestamp)
		headers.Set("X-Nonce", nonce)
		headers.Set("X-Body-Hash", bodyHash)
	}
	return protected, headers, nil
}

func decodeRequestBody(raw []byte, contentEncoding string) ([]byte, error) {
	const maxRequestBytes = 256 * 1024 * 1024
	switch strings.ToLower(strings.TrimSpace(contentEncoding)) {
	case "", "identity":
		if len(raw) > maxRequestBytes {
			return nil, fmt.Errorf("request body exceeds %d bytes", maxRequestBytes)
		}
		return raw, nil
	case "gzip":
		reader, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		return readRequestBodyLimited(reader, maxRequestBytes)
	case "zstd":
		reader, err := zstd.NewReader(bytes.NewReader(raw), zstd.WithDecoderMaxMemory(maxRequestBytes))
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		return readRequestBodyLimited(reader, maxRequestBytes)
	default:
		return nil, fmt.Errorf("unsupported Content-Encoding %q", contentEncoding)
	}
}

func readRequestBodyLimited(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("decompressed request body exceeds %d bytes", limit)
	}
	return data, nil
}

func parseSSE(reader io.Reader) ([]sseEvent, error) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	var events []sseEvent
	current := sseEvent{}
	var data []string
	flush := func() {
		if len(data) == 0 && current.Event == "" && current.ID == "" {
			return
		}
		current.Data = strings.Join(data, "\n")
		events = append(events, current)
		current = sseEvent{}
		data = nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			flush()
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		name, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch name {
		case "event":
			current.Event = value
		case "data":
			data = append(data, value)
		case "id":
			current.ID = value
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	flush()
	return events, nil
}

type BridgeServer struct {
	settings            Settings
	auth                *AuthManager
	catalog             *ModelCatalog
	client              *http.Client
	environ             map[string]string
	security            *SecurityProcessor
	codexDir            string
	officialCodexModels []map[string]any
	imageMu             sync.Mutex
	imageCache          map[string]map[string]any
}

func newBridgeServer(settings Settings, environ map[string]string, client *http.Client) *BridgeServer {
	authClient := client
	if client == nil {
		client = &http.Client{Timeout: settings.UpstreamTimeout}
		authClient = &http.Client{Timeout: 15 * time.Second}
	}
	auth := newAuthManager(settings, environ, authClient)
	catalog := newModelCatalog()
	codexDir := resolveCodexDir(environ)
	bridge := &BridgeServer{
		settings: settings, auth: auth, catalog: catalog, client: client, environ: environ,
		codexDir: codexDir, officialCodexModels: loadCodexOfficialModels(codexDir),
		imageCache: map[string]map[string]any{},
	}
	bridge.security = newSecurityProcessor(settings, environ, auth, client)
	_ = catalog.loadCache(modelCachePath(settings.CachePath))
	return bridge
}

func resolveCodexDir(environ map[string]string) string {
	if configured := bridgeEnv(environ, "MYFLICKER_CODEX_DIR"); configured != "" {
		return configured
	}
	home := bridgeEnv(environ, "USERPROFILE")
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	ccSwitchDir := filepath.Join(home, ".cc-switch")
	var settings map[string]any
	if readJSON(filepath.Join(ccSwitchDir, "settings.json"), &settings) == nil {
		if configured := firstText(settings["codexConfigDir"]); configured != "" {
			return configured
		}
	}
	return filepath.Join(home, ".codex")
}

func loadCodexOfficialModels(codexDir string) []map[string]any {
	cached := readCodexModels(filepath.Join(codexDir, "models_cache.json"))
	bundled := loadBundledCodexModels()
	if len(cached) == 0 {
		return bundled
	}
	bundledBySlug := make(map[string]map[string]any, len(bundled))
	for _, model := range bundled {
		bundledBySlug[firstText(model["slug"])] = model
	}
	for _, model := range cached {
		bundledModel := bundledBySlug[firstText(model["slug"])]
		if bundledModel == nil {
			continue
		}
		levels := mergeCodexReasoningLevels(model["supported_reasoning_levels"], bundledModel["supported_reasoning_levels"])
		if len(levels) > 0 {
			model["supported_reasoning_levels"] = levels
		}
	}
	return cached
}

func readCodexModels(path string) []map[string]any {
	var payload map[string]any
	if readJSON(path, &payload) != nil {
		return nil
	}
	rawModels, _ := payload["models"].([]any)
	models := make([]map[string]any, 0, len(rawModels))
	for _, rawModel := range rawModels {
		model, ok := rawModel.(map[string]any)
		if !ok || firstText(model["slug"]) == "" {
			continue
		}
		copy, _ := deepCopyJSON(model).(map[string]any)
		models = append(models, copy)
	}
	return models
}

var (
	bundledCodexModelsOnce sync.Once
	bundledCodexModels     []map[string]any
)

func loadBundledCodexModels() []map[string]any {
	bundledCodexModelsOnce.Do(func() {
		bundledCodexModels = loadBundledCodexModelsUncached()
	})
	models := make([]map[string]any, 0, len(bundledCodexModels))
	for _, model := range bundledCodexModels {
		copy, _ := deepCopyJSON(model).(map[string]any)
		models = append(models, copy)
	}
	return models
}

func loadBundledCodexModelsUncached() []map[string]any {
	command, err := exec.LookPath("codex")
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, command, "debug", "models", "--bundled").Output()
	if err != nil {
		return nil
	}
	var payload map[string]any
	if json.Unmarshal(bytes.TrimPrefix(output, []byte{0xef, 0xbb, 0xbf}), &payload) != nil {
		return nil
	}
	rawModels, _ := payload["models"].([]any)
	models := make([]map[string]any, 0, len(rawModels))
	for _, rawModel := range rawModels {
		model, ok := rawModel.(map[string]any)
		if !ok || firstText(model["slug"]) == "" || firstText(model["display_name"]) == "" {
			continue
		}
		models = append(models, model)
	}
	return models
}

func mergeCodexReasoningLevels(values ...any) []any {
	levels := make([]any, 0)
	seen := map[string]bool{}
	for _, value := range values {
		rawLevels, _ := value.([]any)
		for _, rawLevel := range rawLevels {
			level, ok := rawLevel.(map[string]any)
			effort := firstText(level["effort"])
			if !ok || effort == "" || seen[effort] {
				continue
			}
			seen[effort] = true
			levels = append(levels, deepCopyJSON(level))
		}
	}
	return levels
}

func (bridge *BridgeServer) isOfficialCodexModel(model any) bool {
	requested := firstText(model)
	for _, entry := range bridge.officialCodexModels {
		if requested != "" && requested == firstText(entry["slug"]) {
			return true
		}
	}
	return false
}

func (bridge *BridgeServer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", bridge.handleHealth)
	mux.HandleFunc("/_myflicker/health", bridge.handleHealth)
	mux.HandleFunc("/v1/models", bridge.handleModels)
	mux.HandleFunc("/v1/chat/completions", bridge.handleChatCompletions)
	mux.HandleFunc("/chat/completions", bridge.handleChatCompletions)
	mux.HandleFunc("/v1/messages", bridge.handleMessages)
	mux.HandleFunc("/v1/messages/count_tokens", bridge.handleCountTokens)
	mux.HandleFunc("/v1/responses", bridge.handleResponsesEndpoint)
	mux.HandleFunc("/responses", bridge.handleResponsesEndpoint)
	mux.HandleFunc("/_myflicker/auth", bridge.handleAuthStatus)
	mux.HandleFunc("/_myflicker/auth/refresh", bridge.handleAuthRefresh)
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if !bridge.originAllowed(request) {
			writeOpenAIError(response, http.StatusForbidden, "Origin is not allowed.")
			return
		}
		bridge.writeCORSHeaders(response, request)
		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(response, request)
	})
}

type upstreamHTTPError struct {
	Status int
	Body   string
}

func (err *upstreamHTTPError) Error() string {
	return fmt.Sprintf("Upstream HTTP %d: %s", err.Status, err.Body)
}

type upstreamStreamError struct {
	Code    int
	Tip     string
	TraceID string
}

func (err *upstreamStreamError) Error() string {
	return fmt.Sprintf("Upstream stream error %d: %s", err.Code, err.Tip)
}

type SecurityProcessor struct {
	settings Settings
	environ  map[string]string
	auth     *AuthManager
	client   *http.Client
	mu       sync.Mutex
	config   securityConfig
	expires  time.Time
}

type securityConfig struct {
	Version any
	Rules   []securityRule
}

func newSecurityProcessor(settings Settings, environ map[string]string, auth *AuthManager, client *http.Client) *SecurityProcessor {
	return &SecurityProcessor{settings: settings, environ: environ, auth: auth, client: client}
}

func (processor *SecurityProcessor) ForceRefresh() {
	processor.mu.Lock()
	processor.config = securityConfig{}
	processor.expires = time.Time{}
	processor.mu.Unlock()
}

func (processor *SecurityProcessor) Protect(ctx context.Context, method, path string, body []byte) ([]byte, http.Header, error) {
	config, err := processor.getConfig(ctx)
	if err != nil {
		return nil, nil, err
	}
	headers := make(http.Header)
	if config.Version != nil {
		headers.Set("X-Config-Version", fmt.Sprint(config.Version))
	}
	rule, ok := matchSecurityRule(config.Rules, method, strings.Split(path, "?")[0])
	if !ok {
		return body, headers, nil
	}
	key, err := resolveSecurityKey(processor.environment(), securityKeyCandidatePaths(processor.environment()))
	if err != nil {
		return nil, nil, err
	}
	protected, secureHeaders, err := protectRequest(rule, key, method, path, body, rand.Reader, time.Now(), randomDeviceID())
	if err != nil {
		return nil, nil, err
	}
	for name, values := range secureHeaders {
		headers[name] = values
	}
	return protected, headers, nil
}

func (processor *SecurityProcessor) getConfig(ctx context.Context) (securityConfig, error) {
	processor.mu.Lock()

	if !processor.expires.IsZero() && time.Now().Before(processor.expires) {
		config := processor.config
		processor.mu.Unlock()
		return config, nil
	}
	processor.mu.Unlock()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(processor.settings.BaseURL, "/")+"/eapi/kwaipilot/security/config", nil)
	if err != nil {
		return securityConfig{}, err
	}
	applyCommonUpstreamHeaders(request.Header, processor.settings, processor.auth)
	response, err := processor.client.Do(request)
	if err != nil {
		return securityConfig{}, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return securityConfig{}, &upstreamHTTPError{Status: response.StatusCode, Body: redact(string(body))}
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return securityConfig{}, err
	}
	if data, ok := payload["data"].(map[string]any); ok {
		payload = data
	}
	config := securityConfig{Version: payload["version"]}
	if values, ok := payload["config"].([]any); ok {
		for _, value := range values {
			object, ok := value.(map[string]any)
			if !ok {
				continue
			}
			rule := securityRule{Path: firstText(object["path"]), EncryptRequest: truthy(object["encryptRequest"]), Signature: truthy(object["signature"])}
			if methods, ok := object["methods"].([]any); ok {
				for _, method := range methods {
					rule.Methods = append(rule.Methods, strings.ToUpper(firstText(method)))
				}
			}
			config.Rules = append(config.Rules, rule)
		}
	}
	processor.mu.Lock()
	processor.config = config
	processor.expires = time.Now().Add(5 * time.Minute)
	processor.mu.Unlock()
	return config, nil
}

func (processor *SecurityProcessor) environment() map[string]string {
	if processor.environ != nil {
		return processor.environ
	}
	return map[string]string{
		"MYFLICKER_SECURITY_KEY_B64": os.Getenv("MYFLICKER_SECURITY_KEY_B64"),
		"MYFLICKER_INSTALL_DIR":      os.Getenv("MYFLICKER_INSTALL_DIR"),
		"PATH":                       os.Getenv("PATH"),
	}
}

func securityKeyCandidatePaths(environ map[string]string) []string {
	return securityKeyCandidatePathsForRunning(environ, runningMyFlickerExecutablePaths())
}

func securityKeyCandidatePathsForRunning(environ map[string]string, runningPaths []string) []string {
	var roots []string
	if install := strings.TrimSpace(environ["MYFLICKER_INSTALL_DIR"]); install != "" {
		roots = append(roots, install)
	} else {
		for _, entry := range filepath.SplitList(environ["PATH"]) {
			entry = strings.Trim(strings.TrimSpace(entry), "\"")
			for _, name := range []string{"MyFlicker.exe", "MyFlicker.cmd", "MyFlicker.bat", "myflicker.exe", "myflicker.cmd"} {
				if entry != "" {
					if _, err := os.Stat(filepath.Join(entry, name)); err == nil {
						roots = append(roots, filepath.Dir(entry))
						break
					}
				}
			}
		}
	}
	for _, executable := range runningPaths {
		if strings.EqualFold(filepath.Base(executable), "MyFlicker.exe") {
			roots = append(roots, filepath.Dir(executable))
		}
	}
	seen := map[string]bool{}
	var paths []string
	for _, root := range roots {
		for _, app := range []string{root, filepath.Join(root, "app"), filepath.Join(root, "resources", "app"), filepath.Join(root, "Contents", "Resources", "app")} {
			for _, candidate := range []string{
				filepath.Join(app, "extensions", "codeflicker", "local-agent", "kwaipilot-binary"),
				filepath.Join(app, "extensions", "codeflicker", "local-agent", "kwaipilot-binary.exe"),
				filepath.Join(app, "extensions", "codeflicker", "out", "extension-export.js"),
			} {
				if !seen[candidate] {
					seen[candidate] = true
					paths = append(paths, candidate)
				}
			}
		}
	}
	return paths
}

func runningMyFlickerExecutablePaths() []string {
	command := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "(Get-Process -Name MyFlicker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path)")
	output, err := command.Output()
	if err != nil {
		return nil
	}
	var paths []string
	for _, line := range strings.Split(string(output), "\n") {
		path := strings.TrimSpace(line)
		if path != "" {
			paths = append(paths, path)
		}
	}
	return paths
}

func matchSecurityRule(rules []securityRule, method, path string) (securityRule, bool) {
	for _, rule := range rules {
		for _, allowed := range rule.Methods {
			if strings.EqualFold(allowed, method) && (rule.Path == path || wildcardPathMatch(rule.Path, path)) {
				return rule, true
			}
		}
	}
	return securityRule{}, false
}

func wildcardPathMatch(pattern, path string) bool {
	if !strings.Contains(pattern, "*") {
		return false
	}
	segments := strings.Split(pattern, "*")
	if !strings.HasPrefix(path, segments[0]) {
		return false
	}
	rest := path[len(segments[0]):]
	for _, segment := range segments[1:] {
		index := strings.Index(rest, segment)
		if index < 0 || strings.Contains(rest[:index], "/") {
			return false
		}
		rest = rest[index+len(segment):]
	}
	return rest == "" || !strings.Contains(rest, "/")
}

func (bridge *BridgeServer) handleChatCompletions(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !bridge.authorized(request) {
		writeOpenAIError(response, http.StatusUnauthorized, "Unauthorized")
		return
	}
	raw, err := decodeRequestBodyFromRequest(request)
	if err != nil {
		writeOpenAIError(response, http.StatusUnsupportedMediaType, err.Error())
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeOpenAIError(response, http.StatusBadRequest, "Request body must be a JSON object")
		return
	}
	if _, ok := payload["messages"].([]any); !ok {
		writeOpenAIError(response, http.StatusBadRequest, "messages must be an array")
		return
	}
	if stream, _ := payload["stream"].(bool); stream {
		if _, _, err := bridge.validateOpenAIBody(payload); err != nil {
			writeOpenAIError(response, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := bridge.auth.Token(request.Context(), false); err != nil {
			writeOpenAIError(response, statusForError(err), err.Error())
			return
		}
		bridge.startOpenAIStream(response)
		err := bridge.streamFlickerChat(request.Context(), payload, func(chunk map[string]any) error {
			return bridge.writeOpenAIChunk(response, payload, chunk)
		})
		if err != nil {
			data, _ := json.Marshal(map[string]any{"error": map[string]any{"message": err.Error(), "type": fmt.Sprintf("%T", err)}})
			_, _ = fmt.Fprintf(response, "data: %s\n\n", data)
		}
		fmt.Fprint(response, "data: [DONE]\n\n")
		return
	}
	events, err := bridge.openFlickerChat(request.Context(), payload)
	if err != nil {
		writeOpenAIError(response, statusForError(err), err.Error())
		return
	}
	writeJSON(response, http.StatusOK, bridge.openAICompletion(payload, events))
}

func decodeRequestBodyFromRequest(request *http.Request) ([]byte, error) {
	raw, err := readRequestBodyLimited(request.Body, 256*1024*1024)
	if err != nil {
		return nil, err
	}
	return decodeRequestBody(raw, request.Header.Get("Content-Encoding"))
}

func statusForError(err error) int {
	var upstream *upstreamHTTPError
	if errors.As(err, &upstream) && upstream.Status >= 400 && upstream.Status < 500 {
		return upstream.Status
	}
	var stream *upstreamStreamError
	if errors.As(err, &stream) && stream.Code == 520 {
		return 520
	}
	return http.StatusBadGateway
}

func mergeUsage(target map[string]any, source map[string]any) {
	for key, value := range source {
		if value != nil {
			target[key] = value
		}
	}
}

func (bridge *BridgeServer) logChatStart(requestID string, payload, body map[string]any) {
	if !usageLoggingEnabled(bridge.environ) {
		return
	}
	messages, _ := body["messages"].([]any)
	images, _ := body["images"].([]any)
	tools, _ := body["tools"].([]any)
	thinking, _ := body["thinking"].(map[string]any)
	fmt.Printf(
		"[chat:%s] start model=%s upstream=%s stream=%t messages=%d native_image=%d tools=%d effort=%s budget=%d\n",
		requestID,
		firstText(payload["model"], bridge.settings.DefaultModel),
		firstText(body["model"]),
		payload["stream"] == true,
		len(messages),
		len(images),
		len(tools),
		bridge.settings.ReasoningEffort,
		parseAnyInt(thinking["budget_tokens"]),
	)
}

func (bridge *BridgeServer) logChatDone(requestID string, startedAt time.Time, payload map[string]any, usage map[string]any, chunkCount int, resultErr error) {
	if !usageLoggingEnabled(bridge.environ) {
		return
	}
	status := "done"
	errorText := ""
	if resultErr != nil {
		status = "error"
		errorText = " error=" + redact(resultErr.Error())
	}
	fmt.Printf(
		"[chat:%s] %s elapsed=%dms model=%s chunks=%d usage=%s%s\n",
		requestID,
		status,
		time.Since(startedAt).Milliseconds(),
		firstText(payload["model"], bridge.settings.DefaultModel),
		chunkCount,
		formatUsage(usage),
		errorText,
	)
	if !creditLoggingEnabled(bridge.environ) || bridge.auth.Username() == "" {
		return
	}
	go func() {
		credit := bridge.getCreditInfo(context.Background())
		formatted := formatCreditInfo(credit)
		if formatted == "" {
			formatted = "N/A"
		}
		fmt.Printf("[chat:%s] credit=%s\n", requestID, formatted)
	}()
}

func (bridge *BridgeServer) openFlickerChat(ctx context.Context, payload map[string]any) (result []sseEvent, resultErr error) {
	requestID := "req-" + strings.ReplaceAll(randomDeviceID(), "-", "")[:8]
	startedAt := time.Now()
	defer func() {
		usage := map[string]any{}
		chunkCount := 0
		for _, event := range result {
			for _, chunk := range normalizeUpstreamChunk(event.Data) {
				chunkCount++
				if chunkUsage, ok := chunk["usage"].(map[string]any); ok {
					mergeUsage(usage, chunkUsage)
				}
			}
		}
		bridge.logChatDone(requestID, startedAt, payload, usage, chunkCount, resultErr)
	}()
	if _, err := bridge.auth.Token(ctx, false); err != nil {
		return nil, err
	}
	if err := bridge.requireCreditAvailable(ctx); err != nil {
		return nil, err
	}
	body, err := bridge.buildFlickerBody(payload)
	if err != nil {
		return nil, err
	}
	bridge.logChatStart(requestID, payload, body)
	retries := busyRetryCount(bridge.environ)
	delay := busyRetryDelay(bridge.environ)
	for attempt := 0; ; attempt++ {
		events, err := bridge.openFlickerChatBody(ctx, body)
		if err == nil {
			return events, nil
		}
		if !isUpstreamBusyError(err) {
			return nil, err
		}
		if attempt >= retries {
			return nil, upstreamBusyErrorForClient(err)
		}
		if err := waitForRetry(ctx, delay); err != nil {
			return nil, err
		}
		refreshRequestID(body)
	}
}

func (bridge *BridgeServer) openFlickerChatBody(ctx context.Context, body map[string]any) ([]sseEvent, error) {
	attempts := bridge.flickerChatAttempts(body)
	var lastError error
	for index, attempt := range attempts {
		events, attemptErr := bridge.openFlickerAttempt(ctx, attempt.path, attempt.body)
		if attemptErr == nil {
			attemptErr = upstreamEventError(events)
		}
		if attemptErr != nil {
			lastError = attemptErr
			if index+1 < len(attempts) && retryableChatAttemptError(attemptErr) {
				continue
			}
			return nil, attemptErr
		}
		if eventsHaveVisibleOutput(events) {
			return events, nil
		}
		if index+1 < len(attempts) {
			continue
		}
	}
	if lastError != nil {
		return nil, lastError
	}
	return nil, &upstreamStreamError{Code: http.StatusBadGateway, Tip: "upstream produced no visible output"}
}

type flickerChatAttempt struct {
	path string
	body map[string]any
	kind string
}

func (bridge *BridgeServer) flickerChatAttempts(body map[string]any) []flickerChatAttempt {
	const primaryPath = "/eapi/kwaipilot/plugin/composer/v3/chat/completions"
	const duetPath = "/eapi/kwaipilot/plugin/composer/v2/duet/completions"
	const legacyPath = "/eapi/kwaipilot/plugin/composer/v2/chat/completions"
	path := bridge.settings.ChatPath
	if path == "" {
		path = primaryPath
	}
	paths := []string{path}
	if strings.EqualFold(firstText(body["mode"]), "duet") && path == primaryPath {
		paths = []string{duetPath, legacyPath}
	} else if path == primaryPath {
		paths = append(paths, legacyPath)
	}
	attempts := make([]flickerChatAttempt, 0, len(paths)+1)
	for _, candidate := range paths {
		if candidate != legacyPath {
			attempts = append(attempts, flickerChatAttempt{path: candidate, body: body, kind: "primary"})
			continue
		}
		legacy := legacyFlickerBody(body, false)
		attempts = append(attempts, flickerChatAttempt{path: candidate, body: legacy, kind: "legacy"})
		retry := legacyFlickerBody(body, true)
		refreshRequestID(retry)
		kind := "legacy-retry"
		if !sameJSONValue(retry["tools"], legacy["tools"]) {
			kind = "legacy-compact-tools"
		}
		attempts = append(attempts, flickerChatAttempt{path: candidate, body: retry, kind: kind})
	}
	return attempts
}

func (bridge *BridgeServer) openFlickerAttempt(ctx context.Context, path string, body map[string]any) ([]sseEvent, error) {
	response, err := bridge.openFlickerRequest(ctx, path, body)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {

		return parseSSE(response.Body)
	}
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	return []sseEvent{{Data: string(raw)}}, nil
}

func (bridge *BridgeServer) openFlickerRequest(ctx context.Context, path string, body map[string]any) (*http.Response, error) {
	plain, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	retryAuth, retrySecurity := true, true
	for {
		protected, securityHeaders, err := bridge.security.Protect(ctx, http.MethodPost, path, plain)
		if err != nil {
			return nil, err
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(bridge.settings.BaseURL, "/")+path, bytes.NewReader(protected))
		if err != nil {
			return nil, err
		}
		applyCommonUpstreamHeaders(request.Header, bridge.settings, bridge.auth)
		request.Header.Set("Content-Type", "application/json;charset=UTF-8")
		request.Header.Set("flicker-source", deriveFlickerSourceForChat(body["deviceInfo"]))
		for name, values := range securityHeaders {
			request.Header[name] = values
		}
		response, err := bridge.client.Do(request)
		if err != nil {
			return nil, err
		}
		if response.StatusCode/100 == 2 {
			return response, nil
		}
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		response.Body.Close()
		upstream := &upstreamHTTPError{Status: response.StatusCode, Body: redact(string(raw))}
		if (upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden) && retryAuth {
			retryAuth = false
			bridge.auth.Invalidate()
			if _, err := bridge.auth.Token(ctx, true); err != nil {
				return nil, err
			}
			continue
		}
		if upstream.Status == http.StatusBadRequest && retrySecurity && (strings.Contains(upstream.Body, `"code":1315`) || strings.Contains(strings.ToUpper(upstream.Body), "CONFIG_EXPIRED")) {
			retrySecurity = false
			bridge.security.ForceRefresh()
			continue
		}
		return nil, upstream
	}
}

func (bridge *BridgeServer) streamFlickerChat(ctx context.Context, payload map[string]any, emit func(map[string]any) error) (resultErr error) {
	requestID := "req-" + strings.ReplaceAll(randomDeviceID(), "-", "")[:8]
	startedAt := time.Now()
	usage := map[string]any{}
	chunkCount := 0
	defer func() {
		bridge.logChatDone(requestID, startedAt, payload, usage, chunkCount, resultErr)
	}()
	if _, err := bridge.auth.Token(ctx, false); err != nil {
		return err
	}
	if err := bridge.requireCreditAvailable(ctx); err != nil {
		return err
	}
	body, err := bridge.buildFlickerBody(payload)
	if err != nil {
		return err
	}
	bridge.logChatStart(requestID, payload, body)
	retries := busyRetryCount(bridge.environ)
	delay := busyRetryDelay(bridge.environ)
	for attempt := 0; ; attempt++ {
		emitted := false
		err := bridge.streamFlickerChatBody(ctx, body, func(chunk map[string]any) error {
			emitted = true
			chunkCount++
			if chunkUsage, ok := chunk["usage"].(map[string]any); ok {
				mergeUsage(usage, chunkUsage)
			}
			return emit(chunk)
		})
		if err == nil {
			return nil
		}
		if emitted || !isUpstreamBusyError(err) {
			return err
		}
		if attempt >= retries {
			return upstreamBusyErrorForClient(err)
		}
		if err := waitForRetry(ctx, delay); err != nil {
			return err
		}
		refreshRequestID(body)
	}
}

func (bridge *BridgeServer) streamFlickerChatBody(ctx context.Context, body map[string]any, emit func(map[string]any) error) error {
	attempts := bridge.flickerChatAttempts(body)
	var lastError error
	for index, attempt := range attempts {
		visible := false
		pending := make([]map[string]any, 0)
		err := bridge.streamFlickerAttempt(ctx, attempt.path, attempt.body, func(event sseEvent) error {
			if eventErr := upstreamEventError([]sseEvent{event}); eventErr != nil {
				return eventErr
			}
			for _, chunk := range normalizeUpstreamChunk(event.Data) {
				if !visible && chunkHasVisibleOutput(chunk) {
					visible = true
					for _, buffered := range pending {
						if err := emit(buffered); err != nil {
							return err
						}
					}
					pending = nil
				}
				if visible {
					if err := emit(chunk); err != nil {
						return err
					}
				} else {
					pending = append(pending, chunk)
				}
			}
			return nil
		})
		if err != nil {
			lastError = err
			if index+1 < len(attempts) && !visible && retryableChatAttemptError(err) {
				continue
			}
			return err
		}
		if visible {
			return nil
		}
	}
	if lastError != nil {
		return lastError
	}
	return &upstreamStreamError{Code: http.StatusBadGateway, Tip: "upstream produced no visible output"}
}

func (bridge *BridgeServer) streamFlickerAttempt(ctx context.Context, path string, body map[string]any, emit func(sseEvent) error) error {
	response, err := bridge.openFlickerRequest(ctx, path, body)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			return err
		}
		return emit(sseEvent{Data: string(raw)})
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	current := sseEvent{}
	dataLines := make([]string, 0)
	flush := func() error {
		if len(dataLines) == 0 && current.Event == "" && current.ID == "" {
			return nil
		}
		current.Data = strings.Join(dataLines, "\n")
		err := emit(current)
		current, dataLines = sseEvent{}, nil
		return err
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		name, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch name {
		case "event":
			current.Event = value
		case "data":
			dataLines = append(dataLines, value)
		case "id":
			current.ID = value
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return flush()
}

func deriveFlickerSourceForChat(deviceInfo any) string {
	info, ok := deviceInfo.(map[string]any)
	if !ok {
		return "IDE"
	}
	if firstText(info["scene"]) == "duet_window" {
		return "AGENT_WINDOW_CODE"
	}
	switch firstText(info["platform"]) {
	case "kwaipilot-vscode", "vscode":
		return "VSCODE"
	case "kwaipilot-intellij":
		return "JETBRAINS"
	default:
		return "IDE"
	}
}

func (bridge *BridgeServer) getUpstreamJSON(ctx context.Context, path string) (any, error) {
	retryAuth, retrySecurity := true, true
	for {
		protected, securityHeaders, err := bridge.security.Protect(ctx, http.MethodGet, path, nil)
		if err != nil {
			return nil, err
		}
		var body io.Reader
		if len(protected) > 0 {
			body = bytes.NewReader(protected)
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(bridge.settings.BaseURL, "/")+path, body)
		if err != nil {
			return nil, err
		}
		applyCommonUpstreamHeaders(request.Header, bridge.settings, bridge.auth)
		for name, values := range securityHeaders {
			request.Header[name] = values
		}
		response, err := bridge.client.Do(request)
		if err != nil {
			return nil, err
		}
		if response.StatusCode/100 == 2 {
			defer response.Body.Close()
			var payload any
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				return nil, err
			}
			return payload, nil
		}
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		response.Body.Close()
		upstream := &upstreamHTTPError{Status: response.StatusCode, Body: redact(string(raw))}
		if (upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden) && retryAuth {
			retryAuth = false
			bridge.auth.Invalidate()
			if _, err := bridge.auth.Token(ctx, true); err != nil {
				return nil, err
			}
			continue
		}
		if upstream.Status == http.StatusBadRequest && retrySecurity && (strings.Contains(upstream.Body, `"code":1315`) || strings.Contains(strings.ToUpper(upstream.Body), "CONFIG_EXPIRED")) {
			retrySecurity = false
			bridge.security.ForceRefresh()
			continue
		}
		return nil, upstream
	}
}

func (bridge *BridgeServer) refreshModelCatalog(ctx context.Context) error {
	payload, err := bridge.getUpstreamJSON(ctx, "/eapi/kwaipilot/plugin/agent/models")
	if err != nil {
		return err
	}
	items := extractModelItems(payload)
	models := make([]ModelEntry, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		model, ok := normalizeModelEntry(item)
		if !ok || seen[model.Type] {
			continue
		}
		seen[model.Type] = true
		models = append(models, model)
	}
	if len(models) == 0 {
		return errors.New("model endpoint returned no models")
	}
	duetPayload, err := bridge.getUpstreamJSON(ctx, "/eapi/kwaipilot/model/list?feature=duet")
	if err != nil {
		return err
	}
	agentPayload, err := bridge.getUpstreamJSON(ctx, "/eapi/kwaipilot/model/list?feature=agent")
	if err != nil {
		return err
	}
	modelTypes := func(value any) map[string]bool {
		output := map[string]bool{}
		for _, item := range extractModelItems(value) {
			if object, ok := item.(map[string]any); ok {
				if modelType := firstText(object["modelType"], object["type"], object["id"], object["model"]); modelType != "" {
					output[modelType] = true
				}
			}
		}
		return output
	}
	duet, agent := modelTypes(duetPayload), modelTypes(agentPayload)
	if len(duet) == 0 || len(agent) == 0 {
		return errors.New("model capability endpoint returned no models")
	}
	exposedCount := 0
	for index := range models {
		models[index].Duet, models[index].Agent = duet[models[index].Type], agent[models[index].Type]
		if models[index].Duet || models[index].Agent {
			exposedCount++
		}
	}
	if exposedCount == 0 {
		return errors.New("model catalog contains no agent or duet capable model")
	}
	bridge.catalog.mu.Lock()
	bridge.catalog.models = models
	bridge.catalog.mu.Unlock()
	_ = bridge.catalog.saveCache(modelCachePath(bridge.settings.CachePath))
	return nil
}

func legacyFlickerBody(body map[string]any, compactTools bool) map[string]any {
	keep := map[string]bool{
		"model": true, "messages": true, "images": true, "contextItems": true,
		"sessionId": true, "chatId": true, "requestId": true, "round": true,

		"temperature": true, "thinking": true, "tools": true,
	}
	legacy := make(map[string]any, len(keep))
	for key, value := range body {
		if keep[key] && value != nil {
			legacy[key] = deepCopyJSON(value)
		}
	}
	if compactTools {
		if tools, ok := legacy["tools"].([]any); ok {
			legacy["tools"] = compactLegacyTools(tools)
		}
	}
	return legacy
}

func refreshRequestID(body map[string]any) {
	body["requestId"] = strconv.FormatInt(time.Now().UnixMilli(), 10) + "-" + strings.ReplaceAll(randomDeviceID(), "-", "")[:12]
}

func sameJSONValue(left, right any) bool {
	leftBytes, leftErr := json.Marshal(left)
	rightBytes, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftBytes, rightBytes)
}

func deepCopyJSON(value any) any {
	data, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var copy any
	if json.Unmarshal(data, &copy) != nil {
		return value
	}
	return copy
}

func compactLegacyTools(tools []any) []any {
	compacted := make([]any, 0, len(tools))
	for _, rawTool := range tools {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			continue
		}
		function, _ := tool["function"].(map[string]any)
		name := firstText(function["name"])
		if name == "" {
			continue
		}
		compacted = append(compacted, map[string]any{
			"type": firstText(tool["type"], "function"),
			"function": map[string]any{
				"name":       name,
				"parameters": compactLegacySchema(function["parameters"]),
			},
		})
	}
	return compacted
}

func compactLegacySchema(value any) map[string]any {
	schema, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	for _, unionKey := range []string{"anyOf", "oneOf", "allOf"} {
		if choices, ok := schema[unionKey].([]any); ok {
			for _, rawChoice := range choices {
				choice, ok := rawChoice.(map[string]any)
				if !ok || firstText(choice["type"]) == "null" {
					continue
				}
				return compactLegacySchema(choice)
			}
		}
	}
	compact := map[string]any{}
	switch rawType := schema["type"].(type) {
	case string:
		compact["type"] = rawType
	case []any:
		for _, raw := range rawType {
			if kind := firstText(raw); kind != "" && kind != "null" {
				compact["type"] = kind
				break
			}
		}
	}
	if values, ok := schema["enum"].([]any); ok && len(values) > 0 {
		compact["enum"] = append([]any(nil), values[:min(len(values), 16)]...)
	}
	if constant, exists := schema["const"]; exists {
		compact["const"] = deepCopyJSON(constant)
	}
	if properties, ok := schema["properties"].(map[string]any); ok {
		requiredSet := map[string]bool{}
		var names []string
		if required, ok := schema["required"].([]any); ok {
			for _, raw := range required {
				name := firstText(raw)
				if _, present := properties[name]; name != "" && present {
					requiredSet[name] = true
					names = append(names, name)
				}
			}
		}
		for name := range properties {
			if !requiredSet[name] {
				names = append(names, name)
			}
		}
		if len(names) > 2 {
			names = names[:2]
		}
		compact["type"] = "object"
		selected := make(map[string]any, len(names))
		var selectedRequired []any
		for _, name := range names {
			selected[name] = compactLegacySchema(properties[name])
			if requiredSet[name] {
				selectedRequired = append(selectedRequired, name)
			}
		}
		compact["properties"] = selected
		if len(selectedRequired) > 0 {
			compact["required"] = selectedRequired
		}
	} else if compact["type"] == "array" {
		if items, exists := schema["items"]; exists {
			compact["items"] = compactLegacySchema(items)
		}
	}
	return compact
}

func retryableChatAttemptError(err error) bool {
	var upstream *upstreamHTTPError
	if errors.As(err, &upstream) {
		return upstream.Status == http.StatusNotAcceptable || (upstream.Status >= http.StatusInternalServerError && strings.Contains(strings.ToLower(upstream.Body), "messages is empty"))
	}
	var stream *upstreamStreamError
	if errors.As(err, &stream) {
		lower := strings.ToLower(stream.Tip)
		return stream.Code == http.StatusNotAcceptable || (stream.Code >= http.StatusInternalServerError && !upstreamBusyText(stream.Tip) && (strings.Contains(lower, "messages is empty") || stream.Code >= http.StatusInternalServerError))
	}
	return false
}

func upstreamEventError(events []sseEvent) error {
	for _, event := range events {
		var payload map[string]any
		if json.Unmarshal([]byte(event.Data), &payload) != nil || firstText(payload["type"]) != "error" {
			continue
		}
		return &upstreamStreamError{Code: parseAnyInt(payload["code"]), Tip: firstText(payload["tip"], "unknown error"), TraceID: firstText(payload["traceId"])}
	}
	return nil
}

func upstreamBusyText(text string) bool {
	lower := strings.ToLower(text)
	return strings.Contains(text, "当前模型繁忙") || strings.Contains(text, "当前系统繁忙") || strings.Contains(lower, "service is temporarily busy") || strings.Contains(lower, "serviceunavailable") || strings.Contains(lower, "too many requests") || strings.Contains(lower, "throttl") || strings.Contains(lower, "capacity limit") || strings.Contains(lower, "try again later")
}

func quotaExhaustedText(text string) bool {
	lower := strings.ToLower(text)
	return strings.Contains(text, "额度已用尽") ||
		strings.Contains(text, "积分额度已用尽") ||
		strings.Contains(lower, "quota exhausted") ||
		strings.Contains(lower, "quota exceeded") ||
		strings.Contains(lower, "insufficient quota") ||
		strings.Contains(lower, "credit exhausted")
}

func isUpstreamBusyError(err error) bool {
	var upstream *upstreamHTTPError
	if errors.As(err, &upstream) {
		if quotaExhaustedText(upstream.Body) {
			return false
		}
		lower := strings.ToLower(upstream.Body)
		return upstream.Status == http.StatusTooManyRequests ||
			upstream.Status == 520 ||
			strings.Contains(lower, `"code":520`) ||
			strings.Contains(lower, `"status":520`) ||
			upstreamBusyText(upstream.Body) ||
			(upstream.Status >= 500 && (strings.Contains(upstream.Body, "繁忙") || strings.Contains(lower, "busy")))
	}
	var stream *upstreamStreamError
	if errors.As(err, &stream) {
		if quotaExhaustedText(stream.Tip) {
			return false
		}
		lower := strings.ToLower(stream.Tip)
		return stream.Code == 520 ||
			upstreamBusyText(stream.Tip) ||
			(stream.Code >= 500 && (strings.Contains(stream.Tip, "繁忙") || strings.Contains(lower, "busy")))
	}
	return false
}

func upstreamBusyErrorForClient(err error) error {
	traceID := ""
	var stream *upstreamStreamError
	if errors.As(err, &stream) {
		traceID = stream.TraceID
	}
	return &upstreamStreamError{Code: 520, Tip: "当前模型繁忙，请稍后再试", TraceID: traceID}
}

func bridgeEnv(environ map[string]string, name string) string {
	if environ != nil {
		return strings.TrimSpace(environ[name])
	}
	return strings.TrimSpace(os.Getenv(name))
}

func bridgeEnvNumber(environ map[string]string, name string, fallback, minimum float64) float64 {
	value := bridgeEnv(environ, name)
	if value == "" {
		return fallback
	}
	number, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return max(number, minimum)
}

func usageLoggingEnabled(environ map[string]string) bool {
	value := bridgeEnv(environ, "MYFLICKER_LOG_USAGE")
	if value == "" {
		return true
	}
	return parseBool(value)
}

func creditLoggingEnabled(environ map[string]string) bool {
	value := bridgeEnv(environ, "MYFLICKER_LOG_CREDIT")
	if value == "" {
		return true
	}
	return parseBool(value)
}

func usageNumber(usage map[string]any, keys ...string) (int64, bool) {
	for _, key := range keys {
		if number, ok := numberValue(usage[key]); ok {
			return int64(number), true
		}
	}
	return 0, false
}

func formatUsage(usage map[string]any) string {
	if len(usage) == 0 {
		return "N/A"
	}
	prompt, promptOK := usageNumber(usage, "prompt_tokens", "input_tokens", "promptTokens", "inputTokens")
	completion, completionOK := usageNumber(usage, "completion_tokens", "output_tokens", "completionTokens", "outputTokens")
	total, totalOK := usageNumber(usage, "total_tokens", "totalTokens")
	if !totalOK && (promptOK || completionOK) {
		total, totalOK = prompt+completion, true
	}
	parts := make([]string, 0, 3)
	if promptOK {
		parts = append(parts, fmt.Sprintf("in=%d", prompt))
	}
	if completionOK {
		parts = append(parts, fmt.Sprintf("out=%d", completion))
	}
	if totalOK {
		parts = append(parts, fmt.Sprintf("total=%d", total))
	}
	if len(parts) > 0 {
		return strings.Join(parts, ",")
	}
	keys := make([]string, 0, len(usage))
	for key := range usage {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) > 6 {
		keys = keys[:6]
	}
	compact := make(map[string]any, len(keys))
	for _, key := range keys {
		compact[key] = usage[key]
	}
	data, _ := json.Marshal(compact)
	return string(data)
}

func busyRetryCount(environ map[string]string) int {
	return min(5, int(bridgeEnvNumber(environ, "MYFLICKER_BUSY_RETRIES", 2, 0)))
}

func busyRetryDelay(environ map[string]string) time.Duration {
	seconds := min(30, bridgeEnvNumber(environ, "MYFLICKER_BUSY_RETRY_DELAY_SECONDS", 2, 0))
	return time.Duration(seconds * float64(time.Second))
}

func waitForRetry(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func eventsHaveVisibleOutput(events []sseEvent) bool {
	for _, event := range events {
		for _, chunk := range normalizeUpstreamChunk(event.Data) {
			if chunkHasVisibleOutput(chunk) {
				return true
			}
		}
	}
	return false
}

func applyCommonUpstreamHeaders(headers http.Header, settings Settings, auth *AuthManager) {
	headers.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	headers.Set("kwaipilot-username", auth.Username())
	headers.Set("kwaipilot-platform", settings.PlatformHeader)
	headers.Set("kwaipilot-version", settings.PluginVersion)
	headers.Set("kwaipilot-request-uuid", auth.DeviceID())
	if settings.SendAuthorization {
		if token, err := auth.Token(context.Background(), false); err == nil && token != "" {
			headers.Set("Authorization", "Bearer "+token)
		}
	}
}

func (bridge *BridgeServer) requireCreditAvailable(ctx context.Context) error {
	credit := bridge.getCreditInfo(ctx)
	if !creditIsExhausted(credit) {
		return nil
	}
	if usageLoggingEnabled(bridge.environ) {
		formatted := formatCreditInfo(credit)
		if formatted == "" {
			formatted = "N/A"
		}
		fmt.Printf("[credit] quota exhausted before upstream request credit=%s\n", formatted)
	}
	message := "本月积分额度已用尽，如需继续使用请联系 MyToken 消息号，了解如何申请提额获取超额积分或如何接入自定义模型。"
	if formatted := formatCreditInfo(credit); formatted != "" {
		message += " (" + formatted + ")"
	}
	return &upstreamStreamError{Code: 520, Tip: message}
}

func (bridge *BridgeServer) getCreditInfo(ctx context.Context) map[string]any {
	username := bridge.auth.Username()
	if username == "" {
		return nil
	}
	timeoutSeconds := bridgeEnvNumber(bridge.environ, "MYFLICKER_CREDIT_TIMEOUT", 2, 0.1)
	queryContext, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds*float64(time.Second)))
	defer cancel()
	request, err := http.NewRequestWithContext(queryContext, http.MethodGet, strings.TrimRight(bridge.settings.BaseURL, "/")+"/api/v1/billing/credit-alert", nil)
	if err != nil {
		return nil
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	request.Header.Set("User-Agent", "myflicker-bridge/0.1")
	request.Header.Set("kwaipilot-username", username)
	response, err := bridge.client.Do(request)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil
	}
	var payload map[string]any
	if json.NewDecoder(io.LimitReader(response.Body, 1024*1024)).Decode(&payload) != nil {
		return nil
	}
	data, _ := payload["data"].(map[string]any)
	if data == nil {
		return nil
	}
	return map[string]any{
		"creditTotal":     data["creditTotal"],
		"creditUsed":      data["creditUsed"],
		"creditAvailable": data["creditAvailable"],
	}
}

func numberValue(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case float32:
		return float64(number), true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case json.Number:
		parsed, err := number.Float64()
		return parsed, err == nil
	default:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
		return parsed, err == nil
	}
}

func creditAvailableAmount(credit map[string]any) (float64, bool) {
	if credit == nil {
		return 0, false
	}
	if available, ok := numberValue(credit["creditAvailable"]); ok {
		return available, true
	}
	total, totalOK := numberValue(credit["creditTotal"])
	used, usedOK := numberValue(credit["creditUsed"])
	if totalOK && usedOK {
		return total - used, true
	}
	return 0, false
}

func creditIsExhausted(credit map[string]any) bool {
	total, totalOK := numberValue(credit["creditTotal"])
	available, availableOK := creditAvailableAmount(credit)
	return totalOK && total > 0 && availableOK && available <= 0
}

func formatCreditInfo(credit map[string]any) string {
	total, totalOK := numberValue(credit["creditTotal"])
	if !totalOK || total <= 0 {
		return ""
	}
	used, usedOK := numberValue(credit["creditUsed"])
	available, availableOK := creditAvailableAmount(credit)
	if !usedOK && availableOK {
		used, usedOK = total-available, true
	}
	parts := make([]string, 0, 4)
	if usedOK {
		parts = append(parts, fmt.Sprintf("used=%.2f", used))
	}
	parts = append(parts, fmt.Sprintf("total=%.0f", total))
	if availableOK {
		parts = append(parts, fmt.Sprintf("available=%.2f", available), fmt.Sprintf("remaining=%.0f%%", available/total*100))
	}
	return strings.Join(parts, ",")
}

func (bridge *BridgeServer) validateOpenAIBody(payload map[string]any) (string, []any, error) {
	messages, ok := payload["messages"].([]any)
	if !ok || len(messages) == 0 {
		return "", nil, errors.New("messages must contain at least one item")
	}
	model := firstText(payload["model"], bridge.settings.DefaultModel)
	if resolved, ok := bridge.catalog.Resolve(model); ok {
		model = resolved.Type
	} else if model == bridge.settings.DefaultModel {
		model = bridge.settings.DefaultModel
	} else {
		models := bridge.catalog.Supported()
		supported := make([]string, 0, len(models)+1)
		for _, entry := range models {
			supported = append(supported, entry.Type)
		}
		if len(supported) == 0 {
			supported = append(supported, bridge.settings.DefaultModel)
		}
		return "", nil, fmt.Errorf("Unsupported MyFlicker model %q. Use a supported modelType: %s", model, strings.Join(supported, ", "))
	}
	hasPayload := false
	for _, raw := range messages {
		message, ok := raw.(map[string]any)
		if !ok {
			return "", nil, errors.New("each message must be an object")
		}
		if messageHasPayload(message) {
			hasPayload = true
		}
	}
	if !hasPayload {
		return "", nil, errors.New("messages must contain at least one non-empty text, image, or tool payload")
	}
	return model, messages, nil
}

func (bridge *BridgeServer) buildFlickerBody(payload map[string]any) (map[string]any, error) {
	model, messages, err := bridge.validateOpenAIBody(payload)
	if err != nil {
		return nil, err
	}
	converted := make([]any, 0, len(messages))
	for _, raw := range messages {
		converted = append(converted, convertOpenAIMessage(raw.(map[string]any)))
	}
	converted, nativeImages, nativeContextItems, err := bridge.attachNativeImages(converted)
	if err != nil {
		return nil, err
	}
	workingDirectory, _ := os.Getwd()
	mode := firstText(payload["mode"], "agent")
	if mode == "jam" {
		mode = "agent"
	}
	body := map[string]any{
		"model": model, "messages": converted, "tools": convertOpenAITools(payload["tools"]),
		"sessionId": firstText(payload["sessionId"], payload["session_id"], "bridge-"+randomDeviceID()),
		"chatId":    firstText(payload["chatId"], payload["chat_id"], "chat-"+randomDeviceID()),
		"requestId": strconv.FormatInt(time.Now().UnixMilli(), 10) + "-" + randomDeviceID()[:8],
		"mode":      mode, "round": 0, "temperature": 1,
		"rules":       payload["rules"],
		"deviceInfo":  map[string]any{"platform": bridge.settings.PlatformHeader, "scene": bridge.settings.DeviceScene, "deviceId": bridge.auth.DeviceID(), "pluginVersion": bridge.settings.PluginVersion, "appName": "myflicker", "os": "windows"},
		"projectInfo": map[string]any{"cwd": workingDirectory, "workspaceRoot": workingDirectory, "projectName": filepath.Base(workingDirectory)},
		"thinking":    resolveThinkingConfig(payload, bridge.settings),
	}
	for _, key := range []string{"images", "contextItems", "systemPromptVersion", "extraPrompt", "environment", "assemblePromptParams", "commitId", "clearWorkspace"} {
		if value, exists := payload[key]; exists && value != nil {
			body[key] = deepCopyJSON(value)
		}
	}
	if len(nativeImages) > 0 {
		existing, _ := body["images"].([]any)
		body["images"] = append(existing, nativeImages...)
	}
	if len(nativeContextItems) > 0 {
		existing, _ := body["contextItems"].([]any)
		body["contextItems"] = append(existing, nativeContextItems...)
	}
	if value, ok := payload["deviceInfo"].(map[string]any); ok {
		body["deviceInfo"] = deepCopyJSON(value)
	}
	if value, ok := payload["projectInfo"].(map[string]any); ok {
		body["projectInfo"] = deepCopyJSON(value)
	}
	if body["rules"] == nil {
		body["rules"] = []any{}
	}
	if body["tools"] == nil {
		delete(body, "tools")
	}
	return body, nil
}

func convertOpenAIMessage(message map[string]any) map[string]any {
	role := firstText(message["role"], "user")
	converted := map[string]any{"role": convertRole(role), "content": convertContent(message["content"])}
	if role == "function" && message["name"] != nil {
		converted["name"] = message["name"]
	}
	if role == "assistant" {
		var calls []any
		if rawCalls, ok := message["tool_calls"].([]any); ok {
			for index, raw := range rawCalls {
				call, ok := raw.(map[string]any)
				if !ok || firstText(call["type"]) == "custom" {
					continue
				}
				calls = append(calls, map[string]any{"id": call["id"], "index": index, "type": call["type"], "function": deepCopyJSON(call["function"])})
			}
		}
		if len(calls) > 0 {
			converted["tool_calls"] = calls
		}
	}
	if chatID := message["chatId"]; chatID != nil {
		converted["chatId"] = chatID
	}
	if role == "tool" && message["tool_call_id"] != nil {
		converted["tool_call_id"] = message["tool_call_id"]
	}
	if value := firstText(message["reasoningContent"], message["reasoning_content"]); value != "" {
		converted["reasoning_content"] = value
	}
	if value := message["reasoningDetails"]; value != nil {
		converted["reasoning_details"] = deepCopyJSON(value)
	} else if value := message["reasoning_details"]; value != nil {
		converted["reasoning_details"] = deepCopyJSON(value)
	}
	return converted

}

func convertOpenAITools(raw any) []any {
	tools, ok := raw.([]any)
	if !ok {
		return nil
	}
	converted := make([]any, 0, len(tools))
	for _, rawTool := range tools {
		tool, ok := rawTool.(map[string]any)
		if !ok || firstText(tool["type"]) == "custom" {
			continue
		}
		converted = append(converted, map[string]any{"type": tool["type"], "function": deepCopyJSON(tool["function"])})
	}
	return converted
}

func convertRole(role string) string {
	switch role {
	case "system", "developer":
		return "system"
	case "user", "assistant":
		return role
	case "function", "tool":
		return "tool"
	default:
		return "user"
	}
}

func convertContent(raw any) []any {
	if text, ok := raw.(string); ok {
		if strings.TrimSpace(text) == "" {
			return []any{}
		}
		return []any{map[string]any{"type": "text", "text": text}}
	}
	if object, ok := raw.(map[string]any); ok {
		raw = []any{object}
	}
	items, ok := raw.([]any)
	if !ok {
		return []any{}
	}
	parts := make([]any, 0, len(items))
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		kind := firstText(item["type"])
		switch kind {
		case "text", "input_text", "output_text", "":
			text := firstText(item["text"], item["content"])
			if text != "" {
				parts = append(parts, map[string]any{"type": "text", "text": text})
			}
		case "image", "image_url", "input_image":
			if image := imageBlockToUpstreamContent(item); image != nil {
				parts = append(parts, image)
			}
		case "document", "file", "input_file":
			parts = append(parts, resourceBlockToUpstreamContent(item))
		}
	}
	return parts
}

func imageBlockToUpstreamContent(block map[string]any) map[string]any {
	source, _ := block["source"].(map[string]any)
	if source != nil {
		if kind := strings.ToLower(firstText(source["type"])); kind == "base64" && firstText(source["data"]) != "" {
			return map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": firstText(source["media_type"], source["mime_type"], "image/png"), "data": firstText(source["data"])}}
		}
		if value := firstText(source["url"]); value != "" {
			return imageSourceFromURL(value)
		}
		if value := firstText(source["data"]); value != "" {
			return map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": firstText(source["media_type"], source["mime_type"], "image/png"), "data": value}}
		}
	}
	if imageURL, ok := block["image_url"].(map[string]any); ok {
		if value := firstText(imageURL["url"]); value != "" {
			return imageSourceFromURL(value)
		}
	}
	if value := firstText(block["image_url"], block["url"], block["image"]); value != "" {
		return imageSourceFromURL(value)
	}
	return nil
}

func imageSourceFromURL(value string) map[string]any {
	if mediaType, data, ok := splitDataURL(value); ok {
		return map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": mediaType, "data": data}}
	}
	return map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": value}}
}

func splitDataURL(value string) (string, string, bool) {
	if !strings.HasPrefix(strings.ToLower(value), "data:") {
		return "", "", false
	}
	head, data, found := strings.Cut(value[5:], ",")
	if !found || !strings.HasSuffix(strings.ToLower(head), ";base64") {
		return "", "", false
	}
	mediaType := strings.TrimSuffix(head, ";base64")
	if mediaType == "" {
		return "", "", false
	}
	return mediaType, data, true
}

func resourceBlockToUpstreamContent(block map[string]any) map[string]any {
	name := firstText(block["filename"], block["file_name"], block["name"], block["title"], block["file_id"], "attachment")
	mediaType := firstText(block["media_type"], block["mime_type"], "application/octet-stream")
	text := firstText(block["text"], block["content"])
	if source, ok := block["source"].(map[string]any); ok {
		mediaType = firstText(source["media_type"], source["mime_type"], mediaType)
		text = firstText(text, source["text"], source["content"])
		if text == "" && strings.EqualFold(firstText(source["type"]), "base64") {
			text = decodeBase64Text(firstText(source["data"]), mediaType)
		}
	}
	if text == "" {
		if fileData := firstText(block["file_data"]); fileData != "" {
			if parsedType, encoded, ok := splitDataURL(fileData); ok {
				text = decodeBase64Text(encoded, parsedType)
			} else {
				text = decodeBase64Text(fileData, mediaType)
			}
		}
	}
	if text == "" {
		if fileID := firstText(block["file_id"]); fileID != "" {
			text = "[file_id=" + fileID + "; content was not inlined]"
		} else {
			text = "[content was not inlined]"
		}
	}
	return map[string]any{"type": "text", "text": "[Attached file: " + name + "; media_type=" + mediaType + "]\n" + text}
}

func decodeBase64Text(data, mediaType string) string {
	if data == "" || !(strings.HasPrefix(strings.ToLower(strings.Split(mediaType, ";")[0]), "text/") || strings.Contains(strings.ToLower(mediaType), "json") || strings.Contains(strings.ToLower(mediaType), "xml")) {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.ReplaceAll(data, "\n", ""), "\r", ""))
	if err != nil {
		return ""
	}
	return string(decoded)
}

func (bridge *BridgeServer) attachNativeImages(messages []any) ([]any, []any, []any, error) {
	const maxImages = 10
	imageURLs := make([]any, 0)
	contextItems := make([]any, 0)
	seen := map[string]bool{}
	lastImageMessageIndex := -1
	lastInputMessageIndex := -1
	for messageIndex, rawMessage := range messages {
		message, ok := rawMessage.(map[string]any)
		if !ok {
			continue
		}
		if contentContainsImage(message["content"]) {
			lastImageMessageIndex = messageIndex
		}
		role := firstText(message["role"])
		if (role == "user" || role == "tool") && messageHasPayload(message) {
			lastInputMessageIndex = messageIndex
		}
	}
	activeImageMessageIndex := -1
	if lastImageMessageIndex == lastInputMessageIndex {
		activeImageMessageIndex = lastImageMessageIndex
	}
	rewrittenMessages := make([]any, 0, len(messages))
	imageIndex := 1
	for messageIndex, rawMessage := range messages {
		message, ok := rawMessage.(map[string]any)
		if !ok {
			rewrittenMessages = append(rewrittenMessages, rawMessage)
			continue
		}
		content, contentIsArray := message["content"].([]any)
		if !contentIsArray {
			rewrittenMessages = append(rewrittenMessages, rawMessage)
			continue
		}
		rewrittenContent := make([]any, 0, len(content))
		messageImageURLs := make([]any, 0)
		messageContextItems := make([]any, 0)
		omittedImages := 0
		for _, rawPart := range content {
			part, ok := rawPart.(map[string]any)
			if !ok || firstText(part["type"]) != "image" {
				rewrittenContent = append(rewrittenContent, rawPart)
				continue
			}
			if messageIndex != activeImageMessageIndex || len(imageURLs) >= maxImages {
				omittedImages++
				continue
			}
			source, _ := part["source"].(map[string]any)
			url, uploadInfo, filename, err := bridge.nativeImageReference(source, imageIndex)
			imageIndex++
			if err != nil {
				rewrittenContent = append(rewrittenContent, rawPart)
				continue
			}
			if url == "" || seen[url] {
				if url == "" {
					rewrittenContent = append(rewrittenContent, rawPart)
				} else {
					omittedImages++
				}
				continue
			}
			seen[url] = true
			imageURLs = append(imageURLs, url)
			contextItem := map[string]any{"type": "remoteImage", "uri": url, "relativePath": filename, "uploadInfo": uploadInfo}
			contextItems = append(contextItems, contextItem)
			messageImageURLs = append(messageImageURLs, url)
			messageContextItems = append(messageContextItems, contextItem)
			rewrittenContent = append(rewrittenContent, map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": url}})
		}
		if len(messageImageURLs) == 0 && omittedImages > 0 && !contentHasUsefulPayload(rewrittenContent) {
			rewrittenContent = append(rewrittenContent, map[string]any{"type": "text", "text": "[Previous image attachment omitted]"})
		}
		rewritten, _ := deepCopyJSON(message).(map[string]any)
		rewritten["content"] = rewrittenContent
		if len(messageImageURLs) > 0 {
			existingImages, _ := rewritten["images"].([]any)
			rewritten["images"] = append(existingImages, messageImageURLs...)
			existingContextItems, _ := rewritten["contextItems"].([]any)
			rewritten["contextItems"] = append(existingContextItems, messageContextItems...)
		}
		rewrittenMessages = append(rewrittenMessages, rewritten)
	}
	if len(imageURLs) > 0 {
		rewrittenMessages = trimMessagesForNativeImages(rewrittenMessages)
		rewrittenMessages = sanitizeMessagesForNativeImages(rewrittenMessages)
	}
	return rewrittenMessages, imageURLs, contextItems, nil
}

func contentHasUsefulPayload(content []any) bool {
	for _, rawPart := range content {
		part, ok := rawPart.(map[string]any)
		if !ok {
			if strings.TrimSpace(stringValue(rawPart)) != "" {
				return true
			}
			continue
		}
		if firstText(part["text"], part["content"]) != "" || part["source"] != nil {
			return true
		}
		switch firstText(part["type"]) {
		case "tool_use", "tool_result":
			return true
		}
	}
	return false
}

var (
	nativeImageDataURLPattern = regexp.MustCompile(`(?i)data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+`)
	nativeLongBase64Pattern   = regexp.MustCompile(`[A-Za-z0-9+/]+={0,2}`)
)

func sanitizeMessagesForNativeImages(messages []any) []any {
	sanitized := make([]any, 0, len(messages))
	for _, rawMessage := range messages {
		message, ok := rawMessage.(map[string]any)
		if !ok {
			sanitized = append(sanitized, rawMessage)
			continue
		}
		updated, _ := deepCopyJSON(message).(map[string]any)
		updated["content"] = sanitizeContentForNativeImages(updated["content"])
		sanitized = append(sanitized, updated)
	}
	return sanitized
}

func sanitizeContentForNativeImages(content any) any {
	if text, ok := content.(string); ok {
		return sanitizeTextForNativeImages(text)
	}
	if object, ok := content.(map[string]any); ok {
		content = []any{object}
	}
	items, ok := content.([]any)
	if !ok {
		return content
	}
	sanitized := make([]any, 0, len(items))
	for _, rawItem := range items {
		switch item := rawItem.(type) {
		case string:
			sanitized = append(sanitized, sanitizeTextForNativeImages(item))
		case map[string]any:
			updated, _ := deepCopyJSON(item).(map[string]any)
			for _, key := range []string{"text", "content"} {
				if text, ok := updated[key].(string); ok {
					updated[key] = sanitizeTextForNativeImages(text)
				}
			}
			sanitized = append(sanitized, updated)
		default:
			sanitized = append(sanitized, rawItem)
		}
	}
	return sanitized
}

func sanitizeTextForNativeImages(text string) string {
	const maxTextBytes = 120_000
	text = nativeImageDataURLPattern.ReplaceAllString(text, "[image data omitted]")
	text = nativeLongBase64Pattern.ReplaceAllStringFunc(text, func(candidate string) string {
		if len(candidate) >= 4096 {
			return "[large base64 data omitted]"
		}
		return candidate
	})
	if len(text) > maxTextBytes {
		text = text[:maxTextBytes] + "\n[truncated by MyFlickerBridge: text exceeded image prompt limit]"
	}
	return text
}

func trimMessagesForNativeImages(messages []any) []any {
	lastImageIndex := -1
	for index, rawMessage := range messages {
		message, _ := rawMessage.(map[string]any)
		if contentContainsImage(message["content"]) {
			lastImageIndex = index
		}
	}
	if lastImageIndex < 0 {
		return messages
	}
	trimStartIndex := lastImageIndex
	lastMessage, _ := messages[lastImageIndex].(map[string]any)
	if firstText(lastMessage["role"]) == "tool" {
		for index := lastImageIndex - 1; index >= 0; index-- {
			message, _ := messages[index].(map[string]any)
			role := firstText(message["role"])
			if role == "user" {
				trimStartIndex = index
				break
			}
			if role == "assistant" && message["tool_calls"] != nil {
				trimStartIndex = index
			}
		}
	}
	trimmed := make([]any, 0, len(messages)-trimStartIndex+1)
	for _, rawMessage := range messages[:trimStartIndex] {
		message, _ := rawMessage.(map[string]any)
		if firstText(message["role"]) == "system" {
			trimmed = append(trimmed, rawMessage)
		}
	}
	return append(trimmed, messages[trimStartIndex:]...)
}

func contentContainsImage(content any) bool {
	items, ok := content.([]any)
	if !ok {
		if item, isObject := content.(map[string]any); isObject {
			items = []any{item}
		} else {
			return false
		}
	}
	for _, rawItem := range items {
		item, _ := rawItem.(map[string]any)
		switch firstText(item["type"]) {
		case "image", "image_url", "input_image":
			return true
		}
	}
	return false
}

func (bridge *BridgeServer) nativeImageReference(source map[string]any, index int) (string, map[string]any, string, error) {
	mediaType := firstText(source["media_type"], source["mime_type"], "image/png")
	filename := safeUploadFilename(fmt.Sprintf("bridge-image-%d%s", index, imageExtensionForMediaType(mediaType)))
	if firstText(source["type"]) == "url" && firstText(source["url"]) != "" {
		return firstText(source["url"]), map[string]any{"url": firstText(source["url"])}, filename, nil
	}
	encoded := stringValue(source["data"])
	if encoded == "" {
		return "", nil, filename, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.ReplaceAll(encoded, "\r", ""), "\n", ""))
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(encoded, "="))
		if err != nil {
			return "", nil, filename, nil
		}
	}
	if !strings.HasPrefix(strings.ToLower(mediaType), "image/") {
		mediaType = "image/png"
	}
	uploadInfo, err := bridge.uploadImageBytes(decoded, mediaType, filename)
	if err != nil {
		return "", nil, filename, err
	}
	return firstText(uploadInfo["url"]), uploadInfo, filename, nil
}

func imageExtensionForMediaType(mediaType string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(mediaType, ";")[0])) {
	case "image/gif":
		return ".gif"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

func safeUploadFilename(value string) string {
	var builder strings.Builder
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '.' || character == '_' || character == '-' {
			builder.WriteRune(character)
		} else {
			builder.WriteByte('_')
		}
	}
	return strings.Trim(builder.String(), "._")
}

func (bridge *BridgeServer) uploadImageBytes(image []byte, mediaType, filename string) (map[string]any, error) {
	hash := sha256.Sum256(append(append([]byte(mediaType), 0), image...))
	cacheKey := hex.EncodeToString(hash[:])
	bridge.imageMu.Lock()
	if cached := bridge.imageCache[cacheKey]; cached != nil {
		copy, _ := deepCopyJSON(cached).(map[string]any)
		bridge.imageMu.Unlock()
		return copy, nil
	}
	bridge.imageMu.Unlock()
	boundary := "----MyFlickerBridge" + strings.ReplaceAll(randomDeviceID(), "-", "")
	escaped := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(filename, "\\", "\\\\"), "\"", "\\\""), "\r", "")
	escaped = strings.ReplaceAll(escaped, "\n", "")
	var body bytes.Buffer
	fmt.Fprintf(&body, "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\nContent-Type: %s\r\n\r\n", boundary, escaped, mediaType)
	body.Write(image)
	fmt.Fprintf(&body, "\r\n--%s--\r\n", boundary)
	paths := []string{"/eapi/kwaipilot/file/upload", "/api/proxy/upload/eapi/kwaipilot/file/upload"}
	var lastErr error
	for _, path := range paths {
		info, err := bridge.postImageUpload(context.Background(), path, body.Bytes(), boundary)
		if err != nil {
			lastErr = err
			var upstream *upstreamHTTPError
			if errors.As(err, &upstream) && (upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden || upstream.Status == http.StatusNotFound || upstream.Status == http.StatusMethodNotAllowed) {
				continue
			}
			return nil, err
		}
		if firstText(info["url"]) != "" {
			bridge.imageMu.Lock()
			bridge.imageCache[cacheKey] = info
			bridge.imageMu.Unlock()
			return info, nil
		}
		lastErr = errors.New("unexpected image upload response")
	}
	if lastErr == nil {
		lastErr = errors.New("image upload failed")
	}
	return nil, lastErr
}

func (bridge *BridgeServer) postImageUpload(ctx context.Context, path string, body []byte, boundary string) (map[string]any, error) {
	token, err := bridge.auth.Token(ctx, false)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(bridge.settings.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := bridge.client.Do(request)
	if err != nil {
		return nil, err

	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	if response.StatusCode/100 != 2 {
		return nil, &upstreamHTTPError{Status: response.StatusCode, Body: redact(string(raw))}
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	data, _ := payload["data"].(map[string]any)
	if data == nil {
		return nil, errors.New("image upload response did not contain data")
	}
	return data, nil
}

func messageHasPayload(message map[string]any) bool {
	if message["tool_calls"] != nil || message["tool_call_id"] != nil || firstText(message["reasoning_content"]) != "" {
		return true
	}
	for _, raw := range convertContent(message["content"]) {
		if part, ok := raw.(map[string]any); ok && (firstText(part["text"]) != "" || part["source"] != nil) {
			return true
		}
	}
	return false
}

func normalizeUpstreamChunk(data string) []map[string]any {
	if strings.TrimSpace(data) == "[DONE]" || strings.TrimSpace(data) == "D" || strings.TrimSpace(data) == "d" {
		return nil
	}
	var payload map[string]any
	if json.Unmarshal([]byte(data), &payload) != nil {
		return []map[string]any{newOpenAIChunk("", 0, "", []any{map[string]any{"index": 0, "delta": map[string]any{"content": data}, "finish_reason": nil}}, nil)}
	}
	if firstText(payload["type"]) == "ack" || firstText(payload["type"]) == "error" {
		return nil
	}
	if firstText(payload["type"]) == "data" {
		nested, _ := payload["data"].(map[string]any)
		if nested == nil {
			return nil
		}
		choices := normalizeOpenAIChoices(nested["choices"])
		if len(choices) == 0 && nested["usage"] == nil {
			return nil
		}
		return []map[string]any{newOpenAIChunk(firstText(nested["id"]), parseAnyInt(nested["created"]), firstText(nested["model"]), choices, nested["usage"])}
	}
	if _, ok := payload["choices"]; ok {
		chunk, _ := deepCopyJSON(payload).(map[string]any)
		chunk["choices"] = normalizeOpenAIChoices(payload["choices"])
		return []map[string]any{chunk}
	}
	if text := extractContent(payload); text != "" {
		return []map[string]any{newOpenAIChunk("", 0, "", []any{map[string]any{"index": 0, "delta": map[string]any{"content": text}, "finish_reason": nil}}, nil)}
	}
	return nil
}

func newOpenAIChunk(id string, created int, model string, choices []any, usage any) map[string]any {
	if id == "" {
		id = "chatcmpl-" + strings.ReplaceAll(randomDeviceID(), "-", "")
	}
	if created <= 0 {
		created = int(time.Now().Unix())
	}
	chunk := map[string]any{"id": id, "object": "chat.completion.chunk", "created": created, "model": model, "choices": choices}
	if usage != nil {
		chunk["usage"] = deepCopyJSON(usage)
	}
	return chunk
}

func normalizeOpenAIChoices(raw any) []any {
	choices, _ := raw.([]any)
	normalized := make([]any, 0, len(choices))
	for index, rawChoice := range choices {
		choice, ok := rawChoice.(map[string]any)
		if !ok {
			continue
		}
		delta := choiceDeltaFromMessageOrDelta(choice)
		if delta == nil {
			continue
		}
		choiceIndex := choice["index"]
		if choiceIndex == nil {
			choiceIndex = index
		}
		normalized = append(normalized, map[string]any{"index": choiceIndex, "delta": delta, "finish_reason": choice["finish_reason"]})
	}
	return normalized
}

func choiceDeltaFromMessageOrDelta(choice map[string]any) map[string]any {
	message, _ := choice["message"].(map[string]any)
	if delta, ok := choice["delta"].(map[string]any); ok {
		normalized, _ := deepCopyJSON(delta).(map[string]any)
		if normalized == nil {
			normalized = map[string]any{}
		}
		if normalized["role"] == nil && message["role"] != nil {
			normalized["role"] = message["role"]
		}
		if _, exists := normalized["content"]; !exists && message["content"] != nil {
			normalized["content"] = fmt.Sprint(message["content"])
		}
		if normalized["reasoning_content"] == nil && message["reasoning_content"] != nil {
			normalized["reasoning_content"] = message["reasoning_content"]
		}
		if normalized["reasoning_details"] == nil && message["reasoning_details"] != nil {
			normalized["reasoning_details"] = deepCopyJSON(message["reasoning_details"])
		}
		if normalized["tool_calls"] == nil && message["tool_calls"] != nil {
			normalized["tool_calls"] = message["tool_calls"]
		}
		if normalized["tool_calls"] != nil {
			normalized["tool_calls"] = normalizeToolCalls(normalized["tool_calls"])
		}
		return normalized
	}
	if message == nil {
		return nil
	}
	delta := map[string]any{"role": firstText(message["role"], "assistant"), "content": ""}
	if message["content"] != nil {
		delta["content"] = fmt.Sprint(message["content"])
	}
	if message["reasoning_content"] != nil {
		delta["reasoning_content"] = message["reasoning_content"]
	}
	if message["reasoning_details"] != nil {
		delta["reasoning_details"] = deepCopyJSON(message["reasoning_details"])
	}
	if message["tool_calls"] != nil {
		delta["tool_calls"] = normalizeToolCalls(message["tool_calls"])
	}
	return delta
}

func normalizeToolCalls(raw any) []any {
	values, _ := raw.([]any)
	output := make([]any, 0, len(values))
	for fallbackIndex, rawCall := range values {
		call, ok := rawCall.(map[string]any)
		if !ok {
			continue
		}
		normalized, _ := deepCopyJSON(call).(map[string]any)
		if normalized == nil {
			continue
		}
		normalized["index"] = toolCallIndex(normalized, fallbackIndex)
		output = append(output, normalized)
	}
	return output
}

func toolCallIndex(call map[string]any, fallback int) int {
	if index := firstPresentInt(call["index"]); index >= 0 {
		return index
	}
	return fallback
}

func extractContent(payload map[string]any) string {
	if choices, ok := payload["choices"].([]any); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]any); ok {
			if delta, ok := choice["delta"].(map[string]any); ok && stringValue(delta["content"]) != "" {
				return stringValue(delta["content"])
			}
			if message, ok := choice["message"].(map[string]any); ok && stringValue(message["content"]) != "" {
				return stringValue(message["content"])
			}
		}
	}
	if delta, ok := payload["delta"].(map[string]any); ok && stringValue(delta["content"]) != "" {
		return stringValue(delta["content"])
	}
	if message, ok := payload["message"].(map[string]any); ok && stringValue(message["content"]) != "" {
		return stringValue(message["content"])
	}
	if payload["content"] != nil {
		return stringValue(payload["content"])
	}
	return stringValue(payload["text"])
}

func chunkHasVisibleOutput(chunk map[string]any) bool {
	choices, _ := chunk["choices"].([]any)
	for _, rawChoice := range choices {
		choice, _ := rawChoice.(map[string]any)
		delta, _ := choice["delta"].(map[string]any)
		if stringValue(delta["content"]) != "" || stringValue(delta["reasoning_content"]) != "" || len(normalizeToolCalls(delta["tool_calls"])) > 0 {
			return true
		}
	}
	return false
}

type openAIAccumulator struct {
	responseID     string
	model          string
	contentParts   []string
	reasoningParts []string
	toolCalls      map[int]map[string]string
	usage          map[string]any
	finishReason   string
}

func newOpenAIAccumulator() *openAIAccumulator {
	return &openAIAccumulator{responseID: "chatcmpl-" + strings.ReplaceAll(randomDeviceID(), "-", ""), toolCalls: map[int]map[string]string{}, usage: map[string]any{}}
}

func (accumulator *openAIAccumulator) add(chunk map[string]any) {
	if id := firstText(chunk["id"]); id != "" {
		accumulator.responseID = id
	}
	if model := firstText(chunk["model"]); model != "" {
		accumulator.model = model
	}
	if usage, ok := chunk["usage"].(map[string]any); ok {
		for key, value := range usage {
			accumulator.usage[key] = value
		}
	}
	choices, _ := chunk["choices"].([]any)
	for _, rawChoice := range choices {
		choice, _ := rawChoice.(map[string]any)
		if finishReason := firstText(choice["finish_reason"]); finishReason != "" {
			accumulator.finishReason = finishReason
		}
		delta, _ := choice["delta"].(map[string]any)
		if content := stringValue(delta["content"]); content != "" {
			accumulator.contentParts = append(accumulator.contentParts, content)
		}
		if reasoning := stringValue(delta["reasoning_content"]); reasoning != "" {
			accumulator.reasoningParts = append(accumulator.reasoningParts, reasoning)
		}
		for fallbackIndex, rawCall := range normalizeToolCalls(delta["tool_calls"]) {
			call, _ := rawCall.(map[string]any)
			index := toolCallIndex(call, fallbackIndex)
			state := accumulator.toolCalls[index]
			if state == nil {
				state = map[string]string{"id": "call_" + strings.ReplaceAll(randomDeviceID(), "-", ""), "name": "", "arguments": ""}
				accumulator.toolCalls[index] = state
			}
			if id := firstText(call["id"]); id != "" {
				state["id"] = id
			}
			if function, ok := call["function"].(map[string]any); ok {
				if name := firstText(function["name"]); name != "" {
					state["name"] = name
				}
				if arguments := stringValue(function["arguments"]); arguments != "" {
					state["arguments"] += arguments
				}
			}
		}
	}
}

func (accumulator *openAIAccumulator) openAIToolCalls() []any {
	indices := make([]int, 0, len(accumulator.toolCalls))
	for index := range accumulator.toolCalls {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	calls := make([]any, 0, len(indices))
	for _, index := range indices {
		state := accumulator.toolCalls[index]
		arguments := state["arguments"]
		if arguments == "" {
			arguments = "{}"
		}
		calls = append(calls, map[string]any{"id": state["id"], "type": "function", "function": map[string]any{"name": state["name"], "arguments": arguments}})
	}
	return calls
}

func (accumulator *openAIAccumulator) toCompletion(requestedModel string) map[string]any {
	message := map[string]any{"role": "assistant", "content": strings.Join(accumulator.contentParts, "")}
	if reasoning := strings.Join(accumulator.reasoningParts, ""); reasoning != "" {
		message["reasoning_content"] = reasoning
	}
	calls := accumulator.openAIToolCalls()
	if len(calls) > 0 {
		message["tool_calls"] = calls
	}
	finishReason := accumulator.finishReason
	if finishReason == "" {
		if len(calls) > 0 {
			finishReason = "tool_calls"
		} else {
			finishReason = "stop"
		}
	}

	result := map[string]any{"id": accumulator.responseID, "object": "chat.completion", "created": time.Now().Unix(), "model": firstText(requestedModel, accumulator.model), "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finishReason}}}
	if len(accumulator.usage) > 0 {
		result["usage"] = accumulator.usage
	}
	return result
}

func openAIFinishToAnthropicStop(reason string) string {
	switch reason {
	case "length":
		return "max_tokens"
	case "tool_calls":
		return "tool_use"
	case "content_filter":
		return "stop_sequence"
	default:
		return "end_turn"
	}
}

func usageInt(usage map[string]any, keys ...string) int {
	for _, key := range keys {
		if value := firstPresentInt(usage[key]); value >= 0 {
			return value
		}
	}
	return 0
}

func parseJSONObject(text string) map[string]any {
	value := map[string]any{}
	if json.Unmarshal([]byte(text), &value) != nil {
		return map[string]any{}
	}
	return value
}

func (accumulator *openAIAccumulator) toAnthropicMessage(requestedModel string) map[string]any {
	content := make([]any, 0, len(accumulator.toolCalls)+2)
	if reasoning := strings.Join(accumulator.reasoningParts, ""); reasoning != "" {
		content = append(content, map[string]any{"type": "thinking", "thinking": reasoning})
	}
	if text := strings.Join(accumulator.contentParts, ""); text != "" {
		content = append(content, map[string]any{"type": "text", "text": text})
	}
	for _, rawCall := range accumulator.openAIToolCalls() {
		call, _ := rawCall.(map[string]any)
		function, _ := call["function"].(map[string]any)
		content = append(content, map[string]any{"type": "tool_use", "id": firstText(call["id"]), "name": firstText(function["name"]), "input": parseJSONObject(firstText(function["arguments"], "{}"))})
	}
	if len(content) == 0 {
		content = append(content, map[string]any{"type": "text", "text": ""})
	}
	stopReason := openAIFinishToAnthropicStop(accumulator.finishReason)
	if len(accumulator.toolCalls) > 0 && stopReason == "end_turn" {
		stopReason = "tool_use"
	}
	return map[string]any{
		"id": "msg_" + strings.TrimPrefix(accumulator.responseID, "chatcmpl_"), "type": "message", "role": "assistant", "model": firstText(requestedModel, accumulator.model),
		"content": content, "stop_reason": stopReason, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": usageInt(accumulator.usage, "prompt_tokens", "input_tokens", "promptTokens", "inputTokens"), "output_tokens": usageInt(accumulator.usage, "completion_tokens", "output_tokens", "completionTokens", "outputTokens")},
	}
}

func (accumulator *openAIAccumulator) toResponsePayload(requestPayload map[string]any) map[string]any {
	output := make([]any, 0, len(accumulator.toolCalls)+2)
	text := strings.Join(accumulator.contentParts, "")
	if reasoning := strings.Join(accumulator.reasoningParts, ""); reasoning != "" {
		output = append(output, map[string]any{"id": "rs_" + randomDeviceID(), "type": "reasoning", "status": "completed", "summary": []any{map[string]any{"type": "summary_text", "text": reasoning}}})
	}
	if text != "" || len(accumulator.toolCalls) == 0 {
		output = append(output, map[string]any{"id": "msg_" + randomDeviceID(), "type": "message", "status": "completed", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": text, "annotations": []any{}}}})
	}
	for _, rawCall := range accumulator.openAIToolCalls() {
		call, _ := rawCall.(map[string]any)
		function, _ := call["function"].(map[string]any)
		output = append(output, map[string]any{"id": "fc_" + randomDeviceID(), "type": "function_call", "status": "completed", "call_id": firstText(call["id"], "call_"+randomDeviceID()), "name": firstText(function["name"]), "arguments": firstText(function["arguments"], "{}")})
	}
	promptTokens := usageInt(accumulator.usage, "prompt_tokens", "input_tokens")
	completionTokens := usageInt(accumulator.usage, "completion_tokens", "output_tokens")
	promptDetails, _ := accumulator.usage["prompt_tokens_details"].(map[string]any)
	if promptDetails == nil {
		promptDetails, _ = accumulator.usage["input_tokens_details"].(map[string]any)
	}
	completionDetails, _ := accumulator.usage["completion_tokens_details"].(map[string]any)
	if completionDetails == nil {
		completionDetails, _ = accumulator.usage["output_tokens_details"].(map[string]any)
	}
	return map[string]any{
		"id": "resp_" + randomDeviceID(), "object": "response", "created_at": time.Now().Unix(), "status": "completed", "error": nil, "incomplete_details": nil,
		"instructions": requestPayload["instructions"], "max_output_tokens": requestPayload["max_output_tokens"], "model": firstText(requestPayload["model"], accumulator.model), "output": output,
		"parallel_tool_calls": true, "previous_response_id": requestPayload["previous_response_id"], "reasoning": firstPresentValue(requestPayload["reasoning"], map[string]any{"effort": requestPayload["reasoning_effort"]}), "store": requestPayload["store"] == true,
		"temperature": requestPayload["temperature"], "text": firstPresentValue(requestPayload["text"], map[string]any{"format": map[string]any{"type": "text"}}), "tool_choice": firstPresentValue(requestPayload["tool_choice"], "auto"), "tools": firstPresentValue(requestPayload["tools"], []any{}), "top_p": requestPayload["top_p"], "truncation": firstPresentValue(requestPayload["truncation"], "disabled"),
		"usage": map[string]any{"input_tokens": promptTokens, "output_tokens": completionTokens, "total_tokens": promptTokens + completionTokens, "input_tokens_details": map[string]any{"cached_tokens": usageInt(promptDetails, "cached_tokens")}, "output_tokens_details": map[string]any{"reasoning_tokens": usageInt(completionDetails, "reasoning_tokens")}},
	}
}

func (accumulator *openAIAccumulator) compactionSummary() (string, error) {
	summary := strings.TrimSpace(strings.Join(accumulator.contentParts, ""))
	if summary == "" {
		summary = strings.TrimSpace(strings.Join(accumulator.reasoningParts, ""))
	}
	if summary == "" {
		return "", errors.New("MyFlicker returned an empty compaction summary")
	}
	return summary, nil
}

func makeMyFlickerCompactionItem(summary string) map[string]any {
	return map[string]any{
		"id":                "cmp_" + strings.ReplaceAll(randomDeviceID(), "-", ""),
		"type":              "compaction",
		"encrypted_content": encodeMyFlickerCompaction(summary),
	}
}

func (accumulator *openAIAccumulator) toCompactionResponse(requestPayload map[string]any) (map[string]any, error) {
	summary, err := accumulator.compactionSummary()
	if err != nil {
		return nil, err
	}
	response := accumulator.toResponsePayload(requestPayload)
	response["output"] = []any{makeMyFlickerCompactionItem(summary)}
	return response, nil
}

func firstPresentValue(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func (bridge *BridgeServer) openAICompletion(payload map[string]any, events []sseEvent) map[string]any {
	accumulator := accumulatorFromEvents(events)
	return accumulator.toCompletion(firstText(payload["model"], bridge.settings.DefaultModel))
}

func accumulatorFromEvents(events []sseEvent) *openAIAccumulator {
	accumulator := newOpenAIAccumulator()
	for _, event := range events {
		for _, chunk := range normalizeUpstreamChunk(event.Data) {
			accumulator.add(chunk)
		}
	}
	return accumulator
}

func (bridge *BridgeServer) startOpenAIStream(response http.ResponseWriter) {
	response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
}

func (bridge *BridgeServer) writeOpenAIChunk(response http.ResponseWriter, payload map[string]any, chunk map[string]any) error {
	if firstText(chunk["id"]) == "" {
		chunk["id"] = "chatcmpl-" + randomDeviceID()
	}
	if firstText(chunk["object"]) == "" {
		chunk["object"] = "chat.completion.chunk"
	}
	if firstPresentInt(chunk["created"]) < 0 {
		chunk["created"] = time.Now().Unix()
	}
	if firstText(chunk["model"]) == "" {
		chunk["model"] = firstText(payload["model"], bridge.settings.DefaultModel)
	}
	data, err := json.Marshal(chunk)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(response, "data: %s\n\n", data); err != nil {
		return err
	}
	flusher, _ := response.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}
	return nil
}

func redact(value string) string {
	value = strings.ReplaceAll(strings.ReplaceAll(value, "\r", "\\r"), "\n", "\\n")
	if len(value) > 800 {
		return value[:800]
	}
	return value
}

func anthropicToOpenAI(payload map[string]any) (map[string]any, error) {
	messages := make([]any, 0)
	if system := payload["system"]; system != nil {
		messages = append(messages, map[string]any{"role": "system", "content": anthropicContent(system)})
	}
	rawMessages, ok := payload["messages"].([]any)
	if !ok {
		return nil, errors.New("messages must be an array")
	}
	for _, raw := range rawMessages {
		message, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("each Anthropic message must be an object")
		}
		messages = append(messages, anthropicMessageToOpenAIMessages(message)...)
	}
	out := map[string]any{"model": payload["model"], "messages": messages, "stream": payload["stream"]}
	if tools, ok := payload["tools"].([]any); ok {
		converted := make([]any, 0, len(tools))
		for _, raw := range tools {
			tool, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			converted = append(converted, map[string]any{"type": "function", "function": map[string]any{"name": firstText(tool["name"]), "description": firstText(tool["description"]), "parameters": tool["input_schema"]}})
		}
		out["tools"] = converted
	}
	if payload["thinking"] != nil {
		out["thinking"] = payload["thinking"]
	}
	if effort := firstText(payload["reasoning_effort"], payload["effortLevel"]); effort != "" {
		out["reasoning_effort"] = effort
	}
	for key, value := range map[string]any{
		"temperature":            payload["temperature"],
		"max_tokens":             payload["max_tokens"],
		"top_p":                  payload["top_p"],
		"stop":                   payload["stop_sequences"],
		"thinking_budget_tokens": firstPresentValue(payload["thinking_budget_tokens"], payload["thinkingBudgetTokens"]),
	} {
		if value != nil {
			out[key] = deepCopyJSON(value)
		}
	}
	return out, nil
}

func anthropicMessageToOpenAIMessages(message map[string]any) []any {
	role := firstText(message["role"], "user")
	content := message["content"]
	if text, ok := content.(string); ok {
		return []any{map[string]any{"role": role, "content": text}}
	}
	blocks, ok := content.([]any)
	if !ok {
		return []any{map[string]any{"role": role, "content": ""}}
	}

	output := make([]any, 0, 3)
	textBlocks := make([]any, 0, len(blocks))
	toolCalls := make([]any, 0)
	flushUserText := func() {
		if len(textBlocks) == 0 {
			return
		}
		output = append(output, map[string]any{"role": "user", "content": anthropicContent(textBlocks)})
		textBlocks = nil
	}
	for _, rawBlock := range blocks {
		block, ok := rawBlock.(map[string]any)
		if !ok {
			continue
		}
		blockType := firstText(block["type"])
		switch {
		case blockType == "tool_use" && role == "assistant":
			arguments, _ := json.Marshal(firstPresentValue(block["input"], map[string]any{}))
			toolCalls = append(toolCalls, map[string]any{
				"id": firstText(block["id"], "toolu_"+randomDeviceID()), "type": "function",
				"function": map[string]any{"name": firstText(block["name"]), "arguments": string(arguments)},
			})
		case blockType == "tool_result":
			flushUserText()
			toolContent := anthropicContent(block["content"])
			if parts, ok := toolContent.([]any); ok {
				hasText := false
				for _, rawPart := range parts {
					part, _ := rawPart.(map[string]any)
					if strings.TrimSpace(firstText(part["text"])) != "" {
						hasText = true
						break
					}
				}
				if !hasText {
					toolContent = append([]any{map[string]any{"type": "text", "text": "[Tool result contains non-text content]"}}, parts...)
				}
			} else if strings.TrimSpace(stringValue(toolContent)) == "" {
				toolContent = "[Tool returned no content]"
			}
			output = append(output, map[string]any{"role": "tool", "tool_call_id": firstText(block["tool_use_id"]), "content": toolContent})
		default:
			if blockType == "text" || blockType == "input_text" ||
				blockType == "image" || blockType == "image_url" || blockType == "input_image" ||
				blockType == "document" || blockType == "file" || blockType == "input_file" ||
				block["text"] != nil {
				textBlocks = append(textBlocks, block)
			}
		}
	}
	if role == "assistant" {
		item := map[string]any{"role": "assistant", "content": anthropicContentToText(textBlocks)}
		if len(toolCalls) > 0 {
			item["tool_calls"] = toolCalls
		}
		output = append(output, item)
	} else if len(textBlocks) > 0 {
		flushUserText()
	} else if len(output) == 0 {
		output = append(output, map[string]any{"role": "user", "content": ""})
	}
	return output
}

func anthropicContentToText(raw any) string {
	if text, ok := raw.(string); ok {
		return text
	}
	if object, ok := raw.(map[string]any); ok {
		raw = []any{object}
	}
	blocks, ok := raw.([]any)
	if !ok {
		if raw == nil {
			return ""
		}
		return stringValue(raw)
	}
	parts := make([]string, 0, len(blocks))
	for _, rawBlock := range blocks {
		if text, ok := rawBlock.(string); ok {
			parts = append(parts, text)
			continue
		}
		block, ok := rawBlock.(map[string]any)
		if !ok {
			continue
		}
		switch {
		case firstText(block["type"]) == "text" || firstText(block["type"]) == "input_text":
			parts = append(parts, firstText(block["text"], block["content"]))
		case block["content"] != nil:
			parts = append(parts, anthropicContentToText(block["content"]))
		case block["text"] != nil:
			parts = append(parts, firstText(block["text"]))
		}
	}
	filtered := parts[:0]
	for _, part := range parts {
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, "\n")
}

func anthropicContent(raw any) any {
	switch value := raw.(type) {
	case string:
		return value
	case map[string]any:
		return anthropicContent([]any{value})
	case []any:
		var parts []any
		for _, rawPart := range value {
			part, ok := rawPart.(map[string]any)
			if !ok {
				if text := firstText(rawPart); text != "" {
					parts = append(parts, map[string]any{"type": "text", "text": text})
				}
				continue
			}
			switch part["type"] {
			case "image", "image_url", "input_image":
				image := imageBlockToUpstreamContent(part)
				source, _ := image["source"].(map[string]any)
				url := firstText(source["url"])
				if source["type"] == "base64" && firstText(source["data"]) != "" {
					url = "data:" + firstText(source["media_type"], "image/png") + ";base64," + firstText(source["data"])
				}
				if url != "" {
					parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}})
				}
			case "document", "file", "input_file":
				parts = append(parts, resourceBlockToUpstreamContent(part))
			default:
				parts = append(parts, map[string]any{"type": "text", "text": firstText(part["text"], part["content"])})
			}
		}
		if len(parts) == 1 {
			if text, ok := parts[0].(map[string]any); ok && text["type"] == "text" {
				return firstText(text["text"])
			}
		}
		return parts
	default:
		return firstText(raw)
	}
}

func responsesToOpenAI(payload map[string]any) (map[string]any, error) {
	messages := make([]any, 0)
	compactionRequest := isCodexCompactionRequest(payload)
	if instructions := firstText(payload["instructions"]); instructions != "" {
		messages = append(messages, map[string]any{"role": "system", "content": instructions})
	}
	switch input := payload["input"].(type) {
	case string:
		messages = append(messages, map[string]any{"role": "user", "content": input})
	case []any:
		for _, raw := range input {
			item, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			switch item["type"] {
			case "function_call_output":
				messages = append(messages, map[string]any{"role": "tool", "tool_call_id": firstText(item["call_id"], item["id"]), "content": responseContent(item["output"])})
			case "function_call":
				messages = append(messages, map[string]any{"role": "assistant", "content": "", "tool_calls": []any{map[string]any{"id": firstText(item["call_id"], item["id"], "call-"+randomDeviceID()), "type": "function", "function": map[string]any{"name": firstText(item["name"]), "arguments": firstText(item["arguments"], "{}")}}}})
			case "compaction_trigger":
				continue
			case "compaction":
				if summary, ok := decodeMyFlickerCompaction(firstText(item["encrypted_content"])); ok {
					messages = append(messages, map[string]any{"role": "system", "content": myFlickerCompactionContextHeader + summary})
				}
			default:
				messages = append(messages, map[string]any{"role": firstText(item["role"], "user"), "content": responseContent(item["content"])})
			}
		}
	default:
		return nil, errors.New("input must be a string or array")
	}
	if compactionRequest {
		messages = append(messages, map[string]any{"role": "user", "content": codexCompactionPrompt})
	}
	out := map[string]any{"model": payload["model"], "messages": messages, "stream": payload["stream"]}
	if !compactionRequest {
		if tools := responsesToolsToOpenAITools(payload["tools"]); len(tools) > 0 {
			out["tools"] = tools
		}
		if value := payload["tool_choice"]; value != nil {
			out["tool_choice"] = deepCopyJSON(value)
		}
	}
	reasoning, _ := payload["reasoning"].(map[string]any)
	for key, value := range map[string]any{
		"temperature":            payload["temperature"],
		"max_tokens":             firstPresentValue(payload["max_output_tokens"], payload["max_tokens"]),
		"top_p":                  payload["top_p"],
		"reasoning_effort":       firstPresentValue(payload["reasoning_effort"], payload["reasoningEffort"], reasoning["effort"]),
		"thinking":               payload["thinking"],
		"thinking_budget_tokens": firstPresentValue(payload["thinking_budget_tokens"], payload["thinkingBudgetTokens"]),
	} {
		if value != nil {
			out[key] = deepCopyJSON(value)
		}
	}
	return out, nil
}

func responsesToolsToOpenAITools(raw any) []any {
	tools, ok := raw.([]any)
	if !ok {
		return nil
	}
	converted := make([]any, 0, len(tools))
	for _, rawTool := range tools {
		tool, ok := rawTool.(map[string]any)
		if !ok || firstText(tool["type"]) != "function" {
			continue
		}
		function, _ := tool["function"].(map[string]any)
		if function == nil {
			function = tool
		}
		converted = append(converted, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        firstText(function["name"]),
				"description": firstText(function["description"]),
				"parameters":  firstPresentValue(function["parameters"], map[string]any{}),
			},
		})
	}
	return converted
}

func isCodexCompactionRequest(payload map[string]any) bool {
	items, _ := payload["input"].([]any)
	for _, rawItem := range items {
		item, _ := rawItem.(map[string]any)
		if firstText(item["type"]) == "compaction_trigger" {
			return true
		}
	}
	return false
}

func encodeMyFlickerCompaction(summary string) string {
	return myFlickerCompactionPrefix + base64.URLEncoding.EncodeToString([]byte(summary))
}

func decodeMyFlickerCompaction(value string) (string, bool) {
	if !strings.HasPrefix(value, myFlickerCompactionPrefix) {
		return "", false
	}
	encoded := strings.TrimPrefix(value, myFlickerCompactionPrefix)
	decoded, err := base64.URLEncoding.DecodeString(encoded)
	if err != nil {
		decoded, err = base64.RawURLEncoding.DecodeString(encoded)
	}
	return string(decoded), err == nil
}

func expandMyFlickerCompactionItems(payload map[string]any) map[string]any {
	items, ok := payload["input"].([]any)
	if !ok {
		return payload
	}
	expanded := make([]any, 0, len(items))
	changed := false
	for _, rawItem := range items {
		item, _ := rawItem.(map[string]any)
		if firstText(item["type"]) != "compaction" {
			expanded = append(expanded, rawItem)
			continue
		}
		summary, ok := decodeMyFlickerCompaction(firstText(item["encrypted_content"]))
		if !ok {
			expanded = append(expanded, rawItem)
			continue
		}
		changed = true
		expanded = append(expanded, map[string]any{
			"type": "message", "role": "developer",
			"content": []any{map[string]any{"type": "input_text", "text": myFlickerCompactionContextHeader + summary}},
		})
	}
	if !changed {
		return payload
	}
	copy, _ := deepCopyJSON(payload).(map[string]any)
	copy["input"] = expanded
	return copy
}

func responseContent(raw any) any {
	if text, ok := raw.(string); ok {
		return text
	}
	if items, ok := raw.([]any); ok {
		if parts := convertContent(items); len(parts) > 0 {
			return parts
		}
	}
	return firstText(raw)
}

func (bridge *BridgeServer) handleMessages(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !bridge.authorized(request) {
		writeOpenAIError(response, http.StatusUnauthorized, "Unauthorized")
		return
	}
	raw, err := decodeRequestBodyFromRequest(request)
	if err != nil {
		writeOpenAIError(response, http.StatusUnsupportedMediaType, err.Error())
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeOpenAIError(response, http.StatusBadRequest, "Request body must be a JSON object")
		return
	}
	openAI, err := anthropicToOpenAI(payload)
	if err != nil {
		writeOpenAIError(response, http.StatusBadRequest, err.Error())
		return
	}
	if stream, _ := payload["stream"].(bool); stream {
		if _, _, err := bridge.validateOpenAIBody(openAI); err != nil {
			writeOpenAIError(response, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := bridge.auth.Token(request.Context(), false); err != nil {
			writeOpenAIError(response, statusForError(err), err.Error())
			return
		}
		response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		response.Header().Set("Cache-Control", "no-cache")
		response.WriteHeader(http.StatusOK)
		writer := newAnthropicStreamWriter(response, firstText(payload["model"]))
		writer.start()
		err := bridge.streamFlickerChat(request.Context(), openAI, func(chunk map[string]any) error {
			writer.add(chunk)
			return writer.emitter.Err()
		})
		if err != nil {
			writer.emitter.anthropicEvent("error", map[string]any{"type": "error", "error": map[string]any{"type": fmt.Sprintf("%T", err), "message": err.Error()}})
		}
		writer.stop()
		return
	}
	events, err := bridge.openFlickerChat(request.Context(), openAI)
	if err != nil {
		writeOpenAIError(response, statusForError(err), err.Error())
		return
	}
	writeJSON(response, http.StatusOK, accumulatorFromEvents(events).toAnthropicMessage(firstText(payload["model"])))
}

func (bridge *BridgeServer) handleCountTokens(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !bridge.authorized(request) {
		writeOpenAIError(response, http.StatusUnauthorized, "Unauthorized")
		return
	}
	raw, err := decodeRequestBodyFromRequest(request)
	if err != nil {
		writeOpenAIError(response, http.StatusUnsupportedMediaType, err.Error())
		return
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		writeOpenAIError(response, http.StatusBadRequest, "Request body must be a JSON object")
		return
	}
	text := firstText(payload["system"])
	if messages, ok := payload["messages"].([]any); ok {
		for _, rawMessage := range messages {
			message, _ := rawMessage.(map[string]any)
			text += "\n" + firstText(anthropicContent(message["content"]))
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{"input_tokens": max(1, len(text)/4)})
}

func (bridge *BridgeServer) handleResponsesEndpoint(response http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodGet {
		if strings.EqualFold(request.Header.Get("Upgrade"), "websocket") {
			writeOpenAIError(response, http.StatusUpgradeRequired, "WebSocket transport is not supported; use HTTP Responses.")
			return
		}
		writeOpenAIError(response, http.StatusNotFound, "Not found")
		return
	}
	bridge.handleResponses(response, request)
}

func (bridge *BridgeServer) handleResponses(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	raw, err := decodeRequestBodyFromRequest(request)
	if err != nil {
		writeOpenAIError(response, http.StatusUnsupportedMediaType, err.Error())
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeOpenAIError(response, http.StatusBadRequest, "Request body must be a JSON object")
		return
	}
	if bridge.isOfficialCodexModel(payload["model"]) {
		if !bridge.authorizedOfficialResponses(request) {
			writeOpenAIError(response, http.StatusUnauthorized, "Unauthorized")
			return
		}
		bridge.proxyCodexOfficialResponses(response, request, payload)
		return
	}
	if !bridge.authorized(request) {
		writeOpenAIError(response, http.StatusUnauthorized, "Unauthorized")
		return
	}
	openAI, err := responsesToOpenAI(payload)
	if err != nil {
		writeOpenAIError(response, http.StatusBadRequest, err.Error())
		return
	}
	if stream, _ := payload["stream"].(bool); stream {
		if _, _, err := bridge.validateOpenAIBody(openAI); err != nil {
			writeOpenAIError(response, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := bridge.auth.Token(request.Context(), false); err != nil {
			writeOpenAIError(response, statusForError(err), err.Error())
			return
		}
		response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		response.Header().Set("Cache-Control", "no-cache")
		response.WriteHeader(http.StatusOK)
		if isCodexCompactionRequest(payload) {
			writer := newResponsesCompactionStreamWriter(response, payload)
			writer.start()
			err := bridge.streamFlickerChat(request.Context(), openAI, func(chunk map[string]any) error {
				writer.add(chunk)
				return writer.emitter.Err()
			})
			if err == nil {
				err = writer.stop()
			}
			if err != nil {
				writer.fail(err)
			}
			return
		}
		writer := newResponsesStreamWriter(response, payload)
		writer.start()
		err := bridge.streamFlickerChat(request.Context(), openAI, func(chunk map[string]any) error {
			writer.add(chunk)
			return writer.emitter.Err()
		})
		if err != nil {
			failed := writer.base("failed")
			failed["error"] = map[string]any{"type": fmt.Sprintf("%T", err), "message": err.Error()}
			writer.emitter.responseEvent(map[string]any{"type": "response.failed", "response": failed})
			fmt.Fprint(response, "data: [DONE]\n\n")
			return
		}
		writer.stop()
		return
	}
	events, err := bridge.openFlickerChat(request.Context(), openAI)
	if err != nil {
		writeOpenAIError(response, statusForError(err), err.Error())
		return
	}
	accumulator := accumulatorFromEvents(events)
	if isCodexCompactionRequest(payload) {
		compaction, err := accumulator.toCompactionResponse(payload)
		if err != nil {
			writeOpenAIError(response, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(response, http.StatusOK, compaction)
		return
	}
	writeJSON(response, http.StatusOK, accumulator.toResponsePayload(payload))
}

type streamEmitter struct {
	response http.ResponseWriter
	flusher  http.Flusher
	err      error
}

func newStreamEmitter(response http.ResponseWriter) streamEmitter {
	flusher, _ := response.(http.Flusher)
	return streamEmitter{response: response, flusher: flusher}
}

func (emitter *streamEmitter) anthropicEvent(name string, payload any) {
	if emitter.err != nil {
		return
	}
	data, _ := json.Marshal(payload)
	_, emitter.err = fmt.Fprintf(emitter.response, "event: %s\ndata: %s\n\n", name, data)
	if emitter.flusher != nil {
		emitter.flusher.Flush()
	}
}

func (emitter *streamEmitter) responseEvent(payload any) {
	if emitter.err != nil {
		return
	}
	data, _ := json.Marshal(payload)
	_, emitter.err = fmt.Fprintf(emitter.response, "data: %s\n\n", data)
	if emitter.flusher != nil {
		emitter.flusher.Flush()
	}
}

func (emitter *streamEmitter) Err() error {
	return emitter.err
}

type anthropicStreamWriter struct {
	emitter            streamEmitter
	messageID          string
	model              string
	textStarted        bool
	textBlockIndex     int
	thinkingStarted    bool
	thinkingBlockIndex int
	thinkingClosed     bool
	startedTools       map[int]int
	toolBuffers        map[int]map[string]any
	usage              map[string]any
	nextBlockIndex     int
	stopReason         string
}

func newAnthropicStreamWriter(response http.ResponseWriter, model string) *anthropicStreamWriter {
	return &anthropicStreamWriter{emitter: newStreamEmitter(response), messageID: "msg_" + randomDeviceID(), model: model, textBlockIndex: -1, thinkingBlockIndex: -1, startedTools: map[int]int{}, toolBuffers: map[int]map[string]any{}, usage: map[string]any{}, stopReason: "end_turn"}
}

func (writer *anthropicStreamWriter) start() {
	writer.emitter.anthropicEvent("message_start", map[string]any{"type": "message_start", "message": map[string]any{"id": writer.messageID, "type": "message", "role": "assistant", "model": writer.model, "content": []any{}, "stop_reason": nil, "stop_sequence": nil, "usage": map[string]any{"input_tokens": 0, "output_tokens": 0}}})
}

func (writer *anthropicStreamWriter) add(chunk map[string]any) {
	if id := firstText(chunk["id"]); id != "" {
		writer.messageID = "msg_" + strings.TrimPrefix(id, "chatcmpl_")
	}
	if writer.model == "" {
		writer.model = firstText(chunk["model"])
	}
	if usage, ok := chunk["usage"].(map[string]any); ok {
		for key, value := range usage {
			writer.usage[key] = value
		}
	}
	choices, _ := chunk["choices"].([]any)
	for _, rawChoice := range choices {
		choice, _ := rawChoice.(map[string]any)
		if finish := firstText(choice["finish_reason"]); finish != "" {
			writer.stopReason = openAIFinishToAnthropicStop(finish)
		}
		delta, _ := choice["delta"].(map[string]any)
		if reasoning := stringValue(delta["reasoning_content"]); reasoning != "" {
			writer.ensureThinking()
			writer.emitter.anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": writer.thinkingBlockIndex, "delta": map[string]any{"type": "thinking_delta", "thinking": reasoning}})
		}
		if content := stringValue(delta["content"]); content != "" {
			writer.closeThinking()
			writer.ensureText()
			writer.emitter.anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": writer.textBlockIndex, "delta": map[string]any{"type": "text_delta", "text": content}})
		}
		for fallback, rawCall := range normalizeToolCalls(delta["tool_calls"]) {
			call, _ := rawCall.(map[string]any)
			writer.closeThinking()
			writer.addTool(call, fallback)
		}

	}
}

func (writer *anthropicStreamWriter) ensureThinking() {
	if writer.thinkingStarted {
		return
	}
	writer.thinkingStarted, writer.thinkingBlockIndex = true, writer.nextBlockIndex
	writer.nextBlockIndex++
	writer.emitter.anthropicEvent("content_block_start", map[string]any{"type": "content_block_start", "index": writer.thinkingBlockIndex, "content_block": map[string]any{"type": "thinking", "thinking": ""}})
}

func (writer *anthropicStreamWriter) closeThinking() {
	if !writer.thinkingStarted || writer.thinkingClosed {
		return
	}
	writer.thinkingClosed = true
	writer.emitter.anthropicEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": writer.thinkingBlockIndex})
}

func (writer *anthropicStreamWriter) ensureText() {
	if writer.textStarted {
		return
	}
	writer.textStarted, writer.textBlockIndex = true, writer.nextBlockIndex
	writer.nextBlockIndex++
	writer.emitter.anthropicEvent("content_block_start", map[string]any{"type": "content_block_start", "index": writer.textBlockIndex, "content_block": map[string]any{"type": "text", "text": ""}})
}

func (writer *anthropicStreamWriter) addTool(call map[string]any, fallback int) {
	index := toolCallIndex(call, fallback)
	state := writer.toolBuffers[index]
	if state == nil {
		state = map[string]any{"id": firstText(call["id"], "toolu_"+randomDeviceID()), "name": "", "arguments": "", "emitted": 0}
		writer.toolBuffers[index] = state
	}
	if id := firstText(call["id"]); id != "" {
		state["id"] = id
	}
	if function, ok := call["function"].(map[string]any); ok {
		if name := firstText(function["name"]); name != "" {
			state["name"] = name
		}
		if arguments := stringValue(function["arguments"]); arguments != "" {
			state["arguments"] = firstText(state["arguments"]) + arguments
		}
	}
	if _, started := writer.startedTools[index]; !started && firstText(state["name"]) != "" {
		writer.startedTools[index] = writer.nextBlockIndex
		writer.nextBlockIndex++
		writer.emitter.anthropicEvent("content_block_start", map[string]any{"type": "content_block_start", "index": writer.startedTools[index], "content_block": map[string]any{"type": "tool_use", "id": state["id"], "name": state["name"], "input": map[string]any{}}})
	}
	block, started := writer.startedTools[index]
	if !started {
		return
	}
	arguments := firstText(state["arguments"])
	emitted := firstPresentInt(state["emitted"])
	if emitted < 0 {
		emitted = 0
	}
	if emitted < len(arguments) {
		delta := arguments[emitted:]
		writer.emitter.anthropicEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": block, "delta": map[string]any{"type": "input_json_delta", "partial_json": delta}})
		state["emitted"] = len(arguments)
	}
}

func (writer *anthropicStreamWriter) stop() {
	if len(writer.startedTools) > 0 && writer.stopReason == "end_turn" {
		writer.stopReason = "tool_use"
	}
	writer.closeThinking()
	if writer.textStarted {
		writer.emitter.anthropicEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": writer.textBlockIndex})
	}
	blocks := make([]int, 0, len(writer.startedTools))
	for _, block := range writer.startedTools {
		blocks = append(blocks, block)
	}
	sort.Ints(blocks)
	for _, block := range blocks {
		writer.emitter.anthropicEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": block})
	}
	writer.emitter.anthropicEvent("message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": writer.stopReason, "stop_sequence": nil}, "usage": map[string]any{"output_tokens": usageInt(writer.usage, "completion_tokens", "output_tokens", "completionTokens", "outputTokens")}})
	writer.emitter.anthropicEvent("message_stop", map[string]any{"type": "message_stop"})
}

type responsesStreamWriter struct {
	emitter              streamEmitter
	payload              map[string]any
	responseID           string
	messageID            string
	reasoningID          string
	model                string
	outputText           []string
	reasoningText        []string
	messageStarted       bool
	contentStarted       bool
	reasoningStarted     bool
	textOutputIndex      int
	reasoningOutputIndex int
	nextOutputIndex      int
	toolCalls            map[int]map[string]any
	usage                map[string]any
}

type responsesCompactionStreamWriter struct {
	emitter     streamEmitter
	payload     map[string]any
	responseID  string
	accumulator *openAIAccumulator
}

func newResponsesCompactionStreamWriter(response http.ResponseWriter, payload map[string]any) *responsesCompactionStreamWriter {
	return &responsesCompactionStreamWriter{
		emitter: newStreamEmitter(response), payload: payload,
		responseID:  "resp_" + strings.ReplaceAll(randomDeviceID(), "-", ""),
		accumulator: newOpenAIAccumulator(),
	}
}

func (writer *responsesCompactionStreamWriter) response(status string, output []any) map[string]any {
	response := writer.accumulator.toResponsePayload(writer.payload)
	response["id"] = writer.responseID
	response["status"] = status
	response["output"] = output
	return response
}

func (writer *responsesCompactionStreamWriter) start() {
	response := writer.response("in_progress", []any{})
	writer.emitter.responseEvent(map[string]any{"type": "response.created", "response": response})
	writer.emitter.responseEvent(map[string]any{"type": "response.in_progress", "response": response})
}

func (writer *responsesCompactionStreamWriter) add(chunk map[string]any) {
	writer.accumulator.add(chunk)
}

func (writer *responsesCompactionStreamWriter) stop() error {
	summary, err := writer.accumulator.compactionSummary()
	if err != nil {
		return err
	}
	item := makeMyFlickerCompactionItem(summary)
	writer.emitter.responseEvent(map[string]any{
		"type": "response.output_item.done", "response_id": writer.responseID,
		"output_index": 0, "item": item,
	})
	writer.emitter.responseEvent(map[string]any{
		"type": "response.completed", "response": writer.response("completed", []any{item}),
	})
	fmt.Fprint(writer.emitter.response, "data: [DONE]\n\n")
	if writer.emitter.flusher != nil {
		writer.emitter.flusher.Flush()
	}
	return nil
}

func (writer *responsesCompactionStreamWriter) fail(err error) {
	response := writer.response("failed", []any{})
	response["error"] = map[string]any{"message": err.Error(), "type": fmt.Sprintf("%T", err)}
	writer.emitter.responseEvent(map[string]any{"type": "response.failed", "response": response})
	fmt.Fprint(writer.emitter.response, "data: [DONE]\n\n")
	if writer.emitter.flusher != nil {
		writer.emitter.flusher.Flush()
	}
}

func newResponsesStreamWriter(response http.ResponseWriter, payload map[string]any) *responsesStreamWriter {
	return &responsesStreamWriter{
		emitter: newStreamEmitter(response), payload: payload,
		responseID: "resp_" + randomDeviceID(), messageID: "msg_" + randomDeviceID(), reasoningID: "rs_" + randomDeviceID(),
		model: firstText(payload["model"]), textOutputIndex: -1, reasoningOutputIndex: -1,
		toolCalls: map[int]map[string]any{}, usage: map[string]any{},
	}
}

func (writer *responsesStreamWriter) base(status string) map[string]any {
	promptTokens := usageInt(writer.usage, "prompt_tokens", "input_tokens")
	completionTokens := usageInt(writer.usage, "completion_tokens", "output_tokens")
	return map[string]any{
		"id": writer.responseID, "object": "response", "status": status, "model": writer.model, "output": []any{}, "error": nil, "created_at": time.Now().Unix(),
		"instructions": writer.payload["instructions"], "max_output_tokens": writer.payload["max_output_tokens"], "parallel_tool_calls": true,
		"previous_response_id": writer.payload["previous_response_id"], "reasoning": firstPresentValue(writer.payload["reasoning"], map[string]any{"effort": writer.payload["reasoning_effort"]}),
		"store": writer.payload["store"] == true, "temperature": writer.payload["temperature"], "text": firstPresentValue(writer.payload["text"], map[string]any{"format": map[string]any{"type": "text"}}),
		"tool_choice": firstPresentValue(writer.payload["tool_choice"], "auto"), "tools": firstPresentValue(writer.payload["tools"], []any{}),
		"top_p": writer.payload["top_p"], "truncation": firstPresentValue(writer.payload["truncation"], "disabled"),
		"usage": map[string]any{"input_tokens": promptTokens, "output_tokens": completionTokens, "total_tokens": promptTokens + completionTokens},
	}
}

func (writer *responsesStreamWriter) start() {
	response := writer.base("in_progress")
	writer.emitter.responseEvent(map[string]any{"type": "response.created", "response": response})
	writer.emitter.responseEvent(map[string]any{"type": "response.in_progress", "response": response})
}

func (writer *responsesStreamWriter) add(chunk map[string]any) {
	if usage, ok := chunk["usage"].(map[string]any); ok {
		for key, value := range usage {
			writer.usage[key] = value
		}
	}
	choices, _ := chunk["choices"].([]any)
	for _, rawChoice := range choices {
		choice, _ := rawChoice.(map[string]any)
		delta, _ := choice["delta"].(map[string]any)
		if reasoning := stringValue(delta["reasoning_content"]); reasoning != "" {
			writer.ensureReasoningOutput()
			writer.reasoningText = append(writer.reasoningText, reasoning)
			writer.emitter.responseEvent(map[string]any{"type": "response.reasoning_summary_text.delta", "response_id": writer.responseID, "item_id": writer.reasoningID, "output_index": writer.reasoningOutputIndex, "delta": reasoning})
		}
		if content := stringValue(delta["content"]); content != "" {
			writer.ensureTextOutput()
			writer.outputText = append(writer.outputText, content)
			writer.emitter.responseEvent(map[string]any{"type": "response.output_text.delta", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "delta": content})
		}
		for fallback, rawCall := range normalizeToolCalls(delta["tool_calls"]) {
			call, _ := rawCall.(map[string]any)
			writer.addToolDelta(call, fallback)
		}
	}
}

func (writer *responsesStreamWriter) ensureReasoningOutput() {
	if writer.reasoningStarted {
		return
	}
	writer.reasoningStarted = true
	writer.reasoningOutputIndex = writer.nextOutputIndex
	writer.nextOutputIndex++
	writer.emitter.responseEvent(map[string]any{
		"type": "response.output_item.added", "response_id": writer.responseID, "output_index": writer.reasoningOutputIndex,
		"item": map[string]any{"id": writer.reasoningID, "type": "reasoning", "status": "in_progress", "summary": []any{}},
	})
}

func (writer *responsesStreamWriter) ensureTextOutput() {
	if !writer.messageStarted {
		writer.messageStarted = true
		writer.textOutputIndex = writer.nextOutputIndex
		writer.nextOutputIndex++
		writer.emitter.responseEvent(map[string]any{
			"type": "response.output_item.added", "response_id": writer.responseID, "output_index": writer.textOutputIndex,
			"item": map[string]any{"id": writer.messageID, "type": "message", "status": "in_progress", "role": "assistant", "content": []any{}},
		})
	}
	if writer.contentStarted {
		return
	}
	writer.contentStarted = true
	writer.emitter.responseEvent(map[string]any{
		"type": "response.content_part.added", "response_id": writer.responseID, "item_id": writer.messageID,
		"output_index": writer.textOutputIndex, "content_index": 0,
		"part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}},
	})
}

func (writer *responsesStreamWriter) addToolDelta(call map[string]any, fallback int) {
	index := toolCallIndex(call, fallback)
	state := writer.toolCalls[index]
	if state == nil {
		state = map[string]any{
			"item_id": "fc_" + randomDeviceID(), "output_index": -1,
			"call_id": firstText(call["id"], "call_"+randomDeviceID()),
			"name":    "", "arguments": "", "emitted": 0, "started": false,
		}
		writer.toolCalls[index] = state
	}
	if id := firstText(call["id"]); id != "" {
		state["call_id"] = id
	}
	if function, ok := call["function"].(map[string]any); ok {
		if name := firstText(function["name"]); name != "" {
			state["name"] = name
		}
		if arguments := stringValue(function["arguments"]); arguments != "" {
			state["arguments"] = firstText(state["arguments"]) + arguments
		}
	}
	if firstText(state["name"]) == "" {
		return
	}
	writer.ensureToolOutput(index)
	emitted := firstPresentInt(state["emitted"])
	if emitted < 0 {
		emitted = 0
	}
	arguments := firstText(state["arguments"])
	if emitted >= len(arguments) {
		return
	}
	delta := arguments[emitted:]
	writer.emitter.responseEvent(map[string]any{
		"type": "response.function_call_arguments.delta", "response_id": writer.responseID,
		"item_id": state["item_id"], "output_index": state["output_index"], "delta": delta,
	})
	state["emitted"] = len(arguments)
}

func (writer *responsesStreamWriter) ensureToolOutput(index int) {
	state := writer.toolCalls[index]
	started, _ := state["started"].(bool)
	if started {
		return
	}
	state["started"] = true
	state["output_index"] = writer.nextOutputIndex
	writer.nextOutputIndex++
	writer.emitter.responseEvent(map[string]any{
		"type": "response.output_item.added", "response_id": writer.responseID, "output_index": state["output_index"],
		"item": writer.toolResponseItem(state, "in_progress", ""),
	})
}

func (writer *responsesStreamWriter) toolResponseItem(state map[string]any, status, arguments string) map[string]any {
	if arguments == "" && status == "completed" {
		arguments = firstText(state["arguments"], "{}")
	}
	return map[string]any{
		"id": state["item_id"], "type": "function_call", "status": status,
		"call_id": state["call_id"], "name": firstText(state["name"]), "arguments": arguments,
	}
}

func (writer *responsesStreamWriter) stop() {
	if !writer.messageStarted && len(writer.toolCalls) == 0 && !writer.reasoningStarted {
		writer.ensureTextOutput()
	}
	text := strings.Join(writer.outputText, "")
	reasoning := strings.Join(writer.reasoningText, "")
	output := make([]any, 0, len(writer.toolCalls)+2)
	if writer.reasoningStarted {
		item := map[string]any{"id": writer.reasoningID, "type": "reasoning", "status": "completed", "summary": []any{map[string]any{"type": "summary_text", "text": reasoning}}}
		output = append(output, item)
		writer.emitter.responseEvent(map[string]any{"type": "response.reasoning_summary_text.done", "response_id": writer.responseID, "item_id": writer.reasoningID, "output_index": writer.reasoningOutputIndex, "text": reasoning})
		writer.emitter.responseEvent(map[string]any{"type": "response.output_item.done", "response_id": writer.responseID, "output_index": writer.reasoningOutputIndex, "item": item})
	}
	if writer.messageStarted {
		item := map[string]any{"id": writer.messageID, "type": "message", "status": "completed", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": text, "annotations": []any{}}}}
		output = append(output, item)
		writer.emitter.responseEvent(map[string]any{"type": "response.output_text.done", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "text": text})
		writer.emitter.responseEvent(map[string]any{
			"type": "response.content_part.done", "response_id": writer.responseID, "item_id": writer.messageID,
			"output_index": writer.textOutputIndex, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": text, "annotations": []any{}},
		})
		writer.emitter.responseEvent(map[string]any{"type": "response.output_item.done", "response_id": writer.responseID, "output_index": writer.textOutputIndex, "item": item})
	}
	indices := make([]int, 0, len(writer.toolCalls))
	for index := range writer.toolCalls {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	for _, index := range indices {
		state := writer.toolCalls[index]
		if firstText(state["name"]) == "" {
			continue
		}
		writer.ensureToolOutput(index)
		item := writer.toolResponseItem(state, "completed", "")
		output = append(output, item)
		writer.emitter.responseEvent(map[string]any{
			"type": "response.function_call_arguments.done", "response_id": writer.responseID,
			"item_id": state["item_id"], "output_index": state["output_index"], "arguments": firstText(state["arguments"], "{}"),
		})
		writer.emitter.responseEvent(map[string]any{
			"type": "response.output_item.done", "response_id": writer.responseID,
			"output_index": state["output_index"], "item": item,
		})
	}
	response := writer.base("completed")
	response["output"] = output
	writer.emitter.responseEvent(map[string]any{"type": "response.completed", "response": response})
	fmt.Fprint(writer.emitter.response, "data: [DONE]\n\n")
	if writer.emitter.flusher != nil {
		writer.emitter.flusher.Flush()
	}
}

func (bridge *BridgeServer) handleHealth(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"ok":                true,
		"bridge_build":      "go-local",
		"upstream_base_url": bridge.settings.BaseURL,
		"chat_path":         bridge.settings.ChatPath,
		"default_model":     bridge.settings.DefaultModel,
		"auth":              bridge.auth.Status(),
	})
}

func (bridge *BridgeServer) handleModels(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	models := bridge.catalog.Exposed()
	if len(models) == 0 {
		models = []ModelEntry{{Type: bridge.settings.DefaultModel, ID: publicModelID(bridge.settings.DefaultModel), Name: "MF " + bridge.settings.DefaultModel, Agent: true}}
	}
	data := make([]map[string]any, 0, len(models))
	for _, model := range models {
		data = append(data, map[string]any{
			"id": model.ID, "object": "model", "created": 0, "owned_by": "myflicker",
			"display_name": model.Name,
			"capabilities": map[string]any{"image": model.Image, "tool": model.Tool, "think": model.Think, "duet": model.Duet, "agent": model.Agent},
		})
	}
	writeJSON(response, http.StatusOK, map[string]any{"object": "list", "data": data, "models": []any{}})
}

func (bridge *BridgeServer) handleAuthStatus(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !bridge.authorized(request) {
		writeOpenAIError(response, http.StatusUnauthorized, "Unauthorized")
		return
	}
	writeJSON(response, http.StatusOK, bridge.auth.Status())
}

func (bridge *BridgeServer) handleAuthRefresh(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeOpenAIError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !bridge.authorized(request) {
		writeOpenAIError(response, http.StatusUnauthorized, "Unauthorized")
		return
	}
	bridge.auth.Invalidate()
	if _, err := bridge.auth.Token(request.Context(), true); err != nil {
		writeOpenAIError(response, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, bridge.auth.Status())
}

type codexOfficialAuth struct {
	mode      string
	endpoint  string
	token     string
	accountID string
}

func requestAPIKey(request *http.Request) string {
	value := strings.TrimSpace(request.Header.Get("X-API-Key"))
	if value != "" {
		return value
	}
	authorization := request.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[len("Bearer "):])
	}
	return ""
}

func (bridge *BridgeServer) codexAuthPayload() map[string]any {
	var payload map[string]any
	if readJSON(filepath.Join(bridge.codexDir, "auth.json"), &payload) != nil {
		return map[string]any{}
	}
	return payload
}

func codexAuthMode(payload map[string]any) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(firstText(payload["auth_mode"])) {
		if character >= 'a' && character <= 'z' {
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

func codexStoredBearer(payload map[string]any) string {
	tokens, _ := payload["tokens"].(map[string]any)
	if token := firstText(tokens["access_token"]); token != "" {
		return token
	}
	return firstText(payload["OPENAI_API_KEY"])
}

func (bridge *BridgeServer) authorizedOfficialResponses(request *http.Request) bool {
	if !isLoopbackRequest(request) {
		return false
	}
	provided := requestAPIKey(request)
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(bridge.settings.BridgeAPIKey)) == 1 {
		return false
	}
	if !strings.HasPrefix(strings.ToLower(request.Header.Get("Authorization")), "bearer ") {
		return false
	}
	if strings.HasPrefix(provided, "sk-") || firstText(request.Header.Get("ChatGPT-Account-ID"), request.Header.Get("ChatGPT-Account-Id")) != "" {
		return true
	}
	stored := codexStoredBearer(bridge.codexAuthPayload())
	return stored != "" && subtle.ConstantTimeCompare([]byte(provided), []byte(stored)) == 1
}

func (bridge *BridgeServer) resolveCodexOfficialAuth(request *http.Request) (codexOfficialAuth, error) {
	provided := requestAPIKey(request)
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(bridge.settings.BridgeAPIKey)) == 1 {
		return codexOfficialAuth{}, errors.New("Official OpenAI routing requires a Codex ChatGPT login or OpenAI API key")
	}
	payload := bridge.codexAuthPayload()
	tokens, _ := payload["tokens"].(map[string]any)
	incomingAccountID := firstText(request.Header.Get("ChatGPT-Account-ID"), request.Header.Get("ChatGPT-Account-Id"))
	openAIEndpoint := firstText(bridgeEnv(bridge.environ, "MYFLICKER_OPENAI_RESPONSES_URL"), "https://api.openai.com/v1/responses")
	chatGPTEndpoint := firstText(bridgeEnv(bridge.environ, "MYFLICKER_CHATGPT_CODEX_RESPONSES_URL"), "https://chatgpt.com/backend-api/codex/responses")
	if strings.HasPrefix(provided, "sk-") {
		return codexOfficialAuth{mode: "api_key", endpoint: openAIEndpoint, token: provided}, nil
	}
	if incomingAccountID != "" {
		return codexOfficialAuth{mode: "chatgpt", endpoint: chatGPTEndpoint, token: provided, accountID: incomingAccountID}, nil
	}
	mode := codexAuthMode(payload)
	if mode == "api" || mode == "apikey" || firstText(payload["OPENAI_API_KEY"]) != "" {
		return codexOfficialAuth{mode: "api_key", endpoint: openAIEndpoint, token: provided}, nil
	}
	if mode == "chatgpt" || mode == "chatgptauthtokens" {
		accountID := firstText(tokens["account_id"])
		if accountID == "" {
			return codexOfficialAuth{}, errors.New("Codex ChatGPT authentication is missing ChatGPT-Account-ID")
		}
		return codexOfficialAuth{mode: "chatgpt", endpoint: chatGPTEndpoint, token: provided, accountID: accountID}, nil
	}
	return codexOfficialAuth{}, errors.New("Could not determine whether the Codex credential is ChatGPT OAuth or an OpenAI API key")
}

var officialRequestHopHeaders = map[string]bool{
	"accept-encoding": true, "connection": true, "content-encoding": true, "content-length": true,
	"host": true, "keep-alive": true, "origin": true, "proxy-authenticate": true,
	"proxy-authorization": true, "proxy-connection": true, "te": true, "trailer": true,
	"transfer-encoding": true, "upgrade": true, "x-api-key": true,
}

var officialResponseHopHeaders = map[string]bool{
	"access-control-allow-origin": true, "connection": true, "content-length": true, "keep-alive": true, "proxy-authenticate": true,
	"proxy-authorization": true, "proxy-connection": true, "te": true, "trailer": true,
	"transfer-encoding": true, "upgrade": true, "set-cookie": true,
}

func (bridge *BridgeServer) proxyCodexOfficialResponses(response http.ResponseWriter, inbound *http.Request, payload map[string]any) {
	auth, err := bridge.resolveCodexOfficialAuth(inbound)
	if err != nil {
		writeOpenAIError(response, http.StatusBadRequest, err.Error())
		return
	}
	forwardedBody := expandMyFlickerCompactionItems(payload)
	data, err := json.Marshal(forwardedBody)
	if err != nil {
		writeOpenAIError(response, http.StatusBadRequest, err.Error())
		return
	}
	request, err := http.NewRequestWithContext(inbound.Context(), http.MethodPost, auth.endpoint, bytes.NewReader(data))
	if err != nil {
		writeOpenAIError(response, http.StatusBadGateway, err.Error())
		return
	}
	for name, values := range inbound.Header {
		lower := strings.ToLower(name)
		if officialRequestHopHeaders[lower] || lower == "authorization" || lower == "chatgpt-account-id" {
			continue
		}
		request.Header[name] = append([]string(nil), values...)
	}
	request.Header.Set("Authorization", "Bearer "+auth.token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept-Encoding", "identity")
	if auth.mode == "chatgpt" {
		request.Header.Set("ChatGPT-Account-ID", auth.accountID)
	}
	upstream, err := bridge.client.Do(request)
	if err != nil {
		if inbound.Context().Err() != nil {
			return
		}
		writeOpenAIError(response, http.StatusBadGateway, redact(err.Error()))
		return
	}
	defer upstream.Body.Close()
	for name, values := range upstream.Header {
		if officialResponseHopHeaders[strings.ToLower(name)] {
			continue
		}
		response.Header()[name] = append([]string(nil), values...)
	}
	response.WriteHeader(upstream.StatusCode)
	streaming := upstream.StatusCode < 400 && (forwardedBody["stream"] == true || strings.Contains(strings.ToLower(upstream.Header.Get("Content-Type")), "text/event-stream"))
	if !streaming {
		_, _ = io.Copy(response, upstream.Body)
		return
	}
	reader := bufio.NewReader(upstream.Body)
	flusher, _ := response.(http.Flusher)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			if _, writeErr := response.Write(line); writeErr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			return
		}
	}
}

func (bridge *BridgeServer) authorized(request *http.Request) bool {
	if !isLoopbackRequest(request) && !bridge.settings.AllowRemote {
		return false
	}
	if !bridge.originAllowed(request) {
		return false
	}
	value := requestAPIKey(request)
	if value == "" || bridge.settings.BridgeAPIKey == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(bridge.settings.BridgeAPIKey)) == 1
}

func (bridge *BridgeServer) originAllowed(request *http.Request) bool {
	origin := request.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && isLoopbackHost(parsed.Hostname())
}

func (bridge *BridgeServer) writeCORSHeaders(response http.ResponseWriter, request *http.Request) {
	if origin := request.Header.Get("Origin"); origin != "" && bridge.originAllowed(request) {
		response.Header().Set("Access-Control-Allow-Origin", origin)
		response.Header().Set("Vary", "Origin")
	}
	response.Header().Set("Access-Control-Allow-Headers", "authorization,content-type,x-api-key,chatgpt-account-id,anthropic-version,anthropic-beta")
	response.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
}

func isLoopbackRequest(request *http.Request) bool {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return request.RemoteAddr == "" || isLoopbackHost(request.RemoteAddr)
	}
	return isLoopbackHost(host)
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		http.Error(response, "JSON encoding failed", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Content-Length", strconv.Itoa(len(data)))
	response.WriteHeader(status)
	_, _ = response.Write(data)
}

func writeOpenAIError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, map[string]any{"error": map[string]any{"message": message}})
}

func testSettingsDefaults() error {
	got, err := parseSettings(nil, nil)
	if err != nil {
		return err
	}
	if err := require(got.Host == "127.0.0.1", "host = %q", got.Host); err != nil {
		return err

	}
	return require(got.Port == 17999, "port = %d", got.Port)
}

func testCacheRoundTrip() error {
	root, err := os.MkdirTemp("", "myflicker-cache-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	path := filepath.Join(root, "cache.json")
	want := authCache{DeviceID: "device-1", Token: "token-1", Username: "bridge-user"}
	if err := writeJSONAtomic(path, want); err != nil {
		return err
	}
	var got authCache
	if err := readJSON(path, &got); err != nil {
		return err
	}
	return require(got == want, "cache = %#v", got)
}

func testCacheSchemaCompatibility() error {
	root, err := os.MkdirTemp("", "myflicker-cache-schema-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	path := filepath.Join(root, "cache.json")
	if err := writeJSONAtomic(path, authCache{Token: "token-1", Username: "bridge-user", DeviceID: "device-1"}); err != nil {
		return err
	}
	var raw map[string]any
	if err := readJSON(path, &raw); err != nil {
		return err
	}
	return require(raw["token"] == "token-1" && raw["device_id"] == "device-1", "cache schema = %#v", raw)
}

func testStateValueDecode() error {
	value, err := decodeStateValue([]byte("{\"username\":\"bridge-user\"}"))
	if err != nil {
		return err
	}
	user, ok := value.(map[string]any)
	return require(ok && user["username"] == "bridge-user", "state = %#v", value)
}

func testSQLiteStateRead() error {
	root, err := os.MkdirTemp("", "myflicker-state-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	path := filepath.Join(root, "state.vscdb")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer database.Close()
	if _, err := database.Exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)"); err != nil {
		return err
	}
	if _, err := database.Exec("INSERT INTO ItemTable(key, value) VALUES (?, ?)", "codeflicker.userInfo", "{\"username\":\"bridge-user\"}"); err != nil {
		return err
	}
	values, err := readMyFlickerState(path)
	if err != nil {
		return err
	}
	user, ok := values["codeflicker.userInfo"].(map[string]any)
	return require(ok && user["username"] == "bridge-user", "values = %#v", values)
}

func testSecurityKeyPriority() error {
	want := bytes.Repeat([]byte{7}, 32)
	encoded := base64.StdEncoding.EncodeToString(want)
	got, err := resolveSecurityKey(map[string]string{"MYFLICKER_SECURITY_KEY_B64": encoded}, nil)
	if err != nil {
		return err
	}
	return require(bytes.Equal(got, want), "security key did not use explicit environment value")
}

func testRunningInstallDiscovery() error {
	root, err := os.MkdirTemp("", "myflicker-running-install-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	key := bytes.Repeat([]byte{9}, 32)
	encoded := base64.StdEncoding.EncodeToString(key)
	bundle := filepath.Join(root, "resources", "app", "extensions", "codeflicker", "out", "extension-export.js")
	if err := os.MkdirAll(filepath.Dir(bundle), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(bundle, []byte("aes-256-gcm \""+encoded+"\""), 0o600); err != nil {
		return err
	}
	paths := securityKeyCandidatePathsForRunning(map[string]string{}, []string{filepath.Join(root, "MyFlicker.exe")})
	got, err := resolveSecurityKey(map[string]string{}, paths)
	if err != nil {
		return err
	}
	return require(bytes.Equal(got, key), "running install key was not discovered")
}

func testAuthRefresh() error {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/kpandora/v1/identity/device/access-token" {
			http.NotFound(response, request)
			return
		}
		json.NewEncoder(response).Encode(map[string]any{
			"code": 0,
			"result": map[string]any{
				"accessToken": "fresh-token",
			},
		})
	}))
	defer server.Close()

	root, err := os.MkdirTemp("", "myflicker-auth-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	settings := Settings{
		TokenBaseURL: server.URL,
		CachePath:    filepath.Join(root, "cache.json"),
		AuthTimeout:  time.Second,
	}
	manager := newAuthManager(settings, map[string]string{"MYFLICKER_DEVICE_ID": "device-1"}, server.Client())
	token, err := manager.Token(context.Background(), true)
	if err != nil {
		return err
	}
	if err := require(token == "fresh-token", "token = %q", token); err != nil {
		return err
	}
	var cache authCache
	if err := readJSON(settings.CachePath, &cache); err != nil {
		return err
	}
	return require(cache.Token == "fresh-token", "cached token = %q", cache.Token)
}

func testModelCatalogMerge() error {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/eapi/kwaipilot/security/config":
			json.NewEncoder(response).Encode(map[string]any{"data": map[string]any{"version": 1, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/agent/models":
			json.NewEncoder(response).Encode(map[string]any{"data": []any{
				map[string]any{"modelType": "GPT_5_4", "displayName": "GPT 5.4", "supportTool": true},
			}})
		case "/eapi/kwaipilot/model/list":
			if request.URL.Query().Get("feature") == "duet" {
				json.NewEncoder(response).Encode(map[string]any{"data": []any{map[string]any{"modelType": "GPT_5_4"}}})
				return
			}
			json.NewEncoder(response).Encode(map[string]any{"data": []any{map[string]any{"modelType": "GPT_5_4"}}})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	root, err := os.MkdirTemp("", "myflicker-models-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	settings := Settings{BaseURL: server.URL, CachePath: filepath.Join(root, "cache.json")}
	bridge := newBridgeServer(settings, map[string]string{}, server.Client())
	if err := bridge.refreshModelCatalog(context.Background()); err != nil {
		return err
	}
	models := bridge.catalog.Exposed()
	if err := require(len(models) == 1, "models = %#v", models); err != nil {
		return err
	}
	return require(models[0].ID == "CLAUDE-MYFLICKER-GPT_5_4" && models[0].Duet && models[0].Agent, "model = %#v", models[0])
}

func testSecurityEncryptSign() error {
	key := bytes.Repeat([]byte{3}, 32)
	rule := securityRule{Path: "/chat", Methods: []string{http.MethodPost}, EncryptRequest: true, Signature: true}
	protected, headers, err := protectRequest(rule, key, http.MethodPost, "/chat?mode=agent", []byte("{\"model\":\"GPT_5_4\"}"), bytes.NewReader(make([]byte, 12)), time.Unix(123, 0), "nonce-1")
	if err != nil {
		return err
	}
	if err := require(!bytes.Contains(protected, []byte("GPT_5_4")), "encrypted body leaked plaintext"); err != nil {
		return err
	}
	return require(headers.Get("X-Encrypted") == "true" && headers.Get("X-Signature") != "", "headers = %#v", headers)
}

func testZstdRequestDecode() error {
	var compressed bytes.Buffer
	writer, err := zstd.NewWriter(&compressed)
	if err != nil {
		return err
	}
	if _, err := writer.Write([]byte("{\"model\":\"GPT_5_4\"}")); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	decoded, err := decodeRequestBody(compressed.Bytes(), "zstd")
	if err != nil {
		return err
	}
	return require(string(decoded) == "{\"model\":\"GPT_5_4\"}", "decoded = %q", decoded)
}

func testSSEParse() error {
	events, err := parseSSE(bytes.NewBufferString("event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
	if err != nil {
		return err
	}
	if err := require(len(events) == 2, "events = %#v", events); err != nil {
		return err
	}
	return require(events[0].Event == "message" && events[1].Data == "[DONE]", "events = %#v", events)
}

func testLocalAPIKeyGuard() error {
	bridge := newBridgeServer(Settings{BridgeAPIKey: "local-test-key", BaseURL: "https://upstream.invalid"}, nil, http.DefaultClient)
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer wrong-key")
	response := httptest.NewRecorder()
	bridge.Handler().ServeHTTP(response, request)
	return require(response.Code == http.StatusUnauthorized, "status = %d", response.Code)
}

func testHealthEndpoint() error {
	bridge := newBridgeServer(Settings{BridgeAPIKey: "local-test-key", BaseURL: "https://upstream.invalid"}, nil, http.DefaultClient)
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	bridge.Handler().ServeHTTP(response, request)
	if err := require(response.Code == http.StatusOK, "status = %d", response.Code); err != nil {
		return err
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		return err
	}
	return require(body["ok"] == true, "body = %#v", body)
}

func testOpenAIChatRelay() error {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/eapi/kwaipilot/security/config":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"version": 1, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			response.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(response, "data: {\"choices\":[{\"delta\":{\"content\":\"bridge ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()
	root, err := os.MkdirTemp("", "myflicker-chat-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	bridge := newBridgeServer(Settings{
		BridgeAPIKey: "local-test-key",
		BaseURL:      upstream.URL,
		ChatPath:     "/eapi/kwaipilot/plugin/composer/v3/chat/completions",
		CachePath:    filepath.Join(root, "cache.json"),
	}, map[string]string{"MYFLICKER_TOKEN": "mock-token"}, upstream.Client())
	body := bytes.NewBufferString("{\"model\":\"CLAUDE_OPUS_4_7\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}")
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", body)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Authorization", "Bearer local-test-key")
	response := httptest.NewRecorder()
	bridge.Handler().ServeHTTP(response, request)
	if err := require(response.Code == http.StatusOK, "status = %d body=%s", response.Code, response.Body.String()); err != nil {
		return err
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		return err
	}
	choices, ok := payload["choices"].([]any)
	if !ok || len(choices) != 1 {
		return fmt.Errorf("choices = %#v", payload["choices"])
	}
	choice := choices[0].(map[string]any)
	message := choice["message"].(map[string]any)
	return require(message["content"] == "bridge ok", "message = %#v", message)
}

func testLegacyFallbackAfterEmptyV3Stream() error {
	var v2Calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/eapi/kwaipilot/security/config":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"version": 1, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			response.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(response, "data: {\"code\":0,\"message\":\"ack\"}\n\n")

		case "/eapi/kwaipilot/plugin/composer/v2/chat/completions":
			v2Calls++
			response.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(response, "data: {\"choices\":[{\"delta\":{\"content\":\"legacy ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()
	root, err := os.MkdirTemp("", "myflicker-v3-fallback-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	bridge := newBridgeServer(Settings{BridgeAPIKey: "local-test-key", BaseURL: upstream.URL, ChatPath: "/eapi/kwaipilot/plugin/composer/v3/chat/completions", CachePath: filepath.Join(root, "cache.json")}, map[string]string{"MYFLICKER_TOKEN": "mock-token"}, upstream.Client())
	events, err := bridge.openFlickerChat(context.Background(), map[string]any{"model": "CLAUDE_OPUS_4_7", "messages": []any{map[string]any{"role": "user", "content": "hello"}}})
	if err != nil {
		return err
	}
	completion := bridge.openAICompletion(map[string]any{"model": "CLAUDE_OPUS_4_7"}, events)
	choices := completion["choices"].([]any)
	message := choices[0].(map[string]any)["message"].(map[string]any)
	return require(v2Calls == 1 && message["content"] == "legacy ok", "v2Calls=%d message=%#v", v2Calls, message)
}

func testLegacyRetryAfterEmptyV2Stream() error {
	var v2Calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/eapi/kwaipilot/security/config":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"version": 1, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			response.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(response, "data: {\"type\":\"ack\"}\n\n")
		case "/eapi/kwaipilot/plugin/composer/v2/chat/completions":
			v2Calls++
			response.Header().Set("Content-Type", "text/event-stream")
			if v2Calls == 1 {
				fmt.Fprint(response, "data: {\"type\":\"ack\"}\n\n")
				return
			}
			fmt.Fprint(response, "data: {\"type\":\"data\",\"data\":{\"choices\":[{\"delta\":{\"content\":\"legacy retry ok\"},\"finish_reason\":\"stop\"}]}}\n\ndata: [DONE]\n\n")
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()
	root, err := os.MkdirTemp("", "myflicker-v2-retry-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	bridge := newBridgeServer(Settings{BridgeAPIKey: "local-test-key", BaseURL: upstream.URL, ChatPath: "/eapi/kwaipilot/plugin/composer/v3/chat/completions", CachePath: filepath.Join(root, "cache.json")}, map[string]string{"MYFLICKER_TOKEN": "mock-token"}, upstream.Client())
	events, err := bridge.openFlickerChat(context.Background(), map[string]any{"model": "CLAUDE_OPUS_4_7", "messages": []any{map[string]any{"role": "user", "content": "hello"}}})
	if err != nil {
		return err
	}
	completion := bridge.openAICompletion(map[string]any{"model": "CLAUDE_OPUS_4_7"}, events)
	choices := completion["choices"].([]any)
	message := choices[0].(map[string]any)["message"].(map[string]any)
	return require(v2Calls == 2 && message["content"] == "legacy retry ok", "v2Calls=%d message=%#v", v2Calls, message)
}

func testFlickerBodyParity() error {
	root, err := os.MkdirTemp("", "myflicker-body-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	bridge := newBridgeServer(Settings{
		DefaultModel: "CLAUDE_OPUS_4_7", CachePath: filepath.Join(root, "cache.json"),
		PlatformHeader: "kwaipilot-vscode", DeviceScene: "duet_window", PluginVersion: "test-version", ReasoningEffort: "max",
	}, map[string]string{"MYFLICKER_TOKEN": "mock-token", "MYFLICKER_DEVICE_ID": "test-device"}, nil)
	body, err := bridge.buildFlickerBody(map[string]any{
		"model": "CLAUDE_OPUS_4_7", "mode": "jam", "messages": []any{
			map[string]any{"role": "developer", "content": "system rules"},
			map[string]any{"role": "assistant", "content": "", "tool_calls": []any{map[string]any{"id": "call_1", "type": "function", "function": map[string]any{"name": "read_file", "arguments": "{}"}}}},
			map[string]any{"role": "tool", "tool_call_id": "call_1", "content": "contents"},
		},
		"rules": []any{"r1"}, "systemPromptVersion": "v1", "extraPrompt": "extra", "environment": map[string]any{"shell": "pwsh"}, "assemblePromptParams": map[string]any{"a": 1}, "commitId": "abc", "clearWorkspace": true,
	})
	if err != nil {
		return err
	}
	if err := require(firstText(body["mode"]) == "agent", "mode=%#v", body["mode"]); err != nil {
		return err
	}
	thinking, ok := body["thinking"].(map[string]any)
	if err := require(ok && thinking["type"] == "enabled" && parseAnyInt(thinking["budget_tokens"]) == 16000, "thinking=%#v", body["thinking"]); err != nil {
		return err
	}
	if err := require(firstText(body["systemPromptVersion"]) == "v1" && firstText(body["commitId"]) == "abc" && body["clearWorkspace"] == true, "body=%#v", body); err != nil {
		return err
	}
	messages := body["messages"].([]any)
	first := messages[0].(map[string]any)
	second := messages[1].(map[string]any)
	third := messages[2].(map[string]any)
	return require(first["role"] == "system" && len(second["tool_calls"].([]any)) == 1 && firstText(third["tool_call_id"]) == "call_1", "messages=%#v", messages)
}

func testUpstreamEventAndAccumulatorParity() error {
	chunks := normalizeUpstreamChunk(`{"type":"data","data":{"id":"chatcmpl_upstream","created":123,"model":"CLAUDE_OPUS_4_7","usage":{"prompt_tokens":9,"completion_tokens":3},"choices":[{"message":{"role":"assistant","content":"tool call","reasoning_content":"think","tool_calls":[{"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\"path\":"}}]},"finish_reason":"tool_calls"}]}}`)
	if err := require(len(chunks) == 1, "chunks=%#v", chunks); err != nil {
		return err
	}
	choice := chunks[0]["choices"].([]any)[0].(map[string]any)
	delta := choice["delta"].(map[string]any)
	if err := require(firstText(delta["role"]) == "assistant" && firstText(delta["content"]) == "tool call" && firstText(delta["reasoning_content"]) == "think", "delta=%#v", delta); err != nil {
		return err
	}
	accumulator := newOpenAIAccumulator()
	accumulator.add(chunks[0])
	secondChunk := map[string]any{
		"choices": []any{
			map[string]any{
				"index": 0,
				"delta": map[string]any{
					"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": `"}`}}},
				},
			},
		},
	}
	accumulator.add(secondChunk)
	completion := accumulator.toCompletion("CLAUDE_OPUS_4_7")
	message := completion["choices"].([]any)[0].(map[string]any)["message"].(map[string]any)
	calls := message["tool_calls"].([]any)
	function := calls[0].(map[string]any)["function"].(map[string]any)
	return require(firstText(message["content"]) == "tool call" && firstText(message["reasoning_content"]) == "think" && firstText(function["arguments"]) == `{"path":"}`, "completion=%#v", completion)
}

func testUpstreamAuthAndSecurityRetries() error {
	var configCalls, chatCalls, tokenCalls int
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/kpandora/v1/identity/device/access-token":
			tokenCalls++
			writeJSON(response, http.StatusOK, map[string]any{"code": 0, "result": map[string]any{"accessToken": "new-token"}})
		case "/eapi/kwaipilot/security/config":
			configCalls++
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"version": configCalls, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			chatCalls++
			if chatCalls == 1 {
				writeJSON(response, http.StatusUnauthorized, map[string]any{"message": "expired"})
				return
			}
			if chatCalls == 2 {
				writeJSON(response, http.StatusBadRequest, map[string]any{"code": 1315, "message": "CONFIG_EXPIRED"})
				return
			}
			response.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(response, "data: {\"choices\":[{\"delta\":{\"content\":\"retry ok\"},\"finish_reason\":\"stop\"}]}\n\n")
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()
	root, err := os.MkdirTemp("", "myflicker-retries-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	bridge := newBridgeServer(Settings{BridgeAPIKey: "local-test-key", BaseURL: upstream.URL, TokenBaseURL: upstream.URL, ChatPath: "/eapi/kwaipilot/plugin/composer/v3/chat/completions", CachePath: filepath.Join(root, "cache.json"), SendAuthorization: true}, map[string]string{"MYFLICKER_TOKEN": "old-token", "MYFLICKER_DEVICE_ID": "device"}, upstream.Client())
	events, err := bridge.openFlickerChat(context.Background(), map[string]any{"model": "CLAUDE_OPUS_4_7", "messages": []any{map[string]any{"role": "user", "content": "hello"}}})
	if err != nil {
		return err
	}
	completion := bridge.openAICompletion(map[string]any{"model": "CLAUDE_OPUS_4_7"}, events)
	message := completion["choices"].([]any)[0].(map[string]any)["message"].(map[string]any)
	return require(chatCalls == 3 && tokenCalls == 1 && configCalls == 2 && message["content"] == "retry ok", "chat=%d token=%d config=%d message=%#v", chatCalls, tokenCalls, configCalls, message)
}

func testProtocolOutputParity() error {
	accumulator := newOpenAIAccumulator()
	accumulator.add(map[string]any{
		"id": "chatcmpl_1", "model": "CLAUDE_OPUS_4_7", "usage": map[string]any{"prompt_tokens": 11, "completion_tokens": 7},
		"choices": []any{map[string]any{
			"delta": map[string]any{
				"reasoning_content": "reason",
				"tool_calls":        []any{map[string]any{"index": 0, "id": "call_1", "function": map[string]any{"name": "read_file", "arguments": `{"path":"a"}`}}},
			},
			"finish_reason": "tool_calls",
		}},
	})
	anthropic := accumulator.toAnthropicMessage("CLAUDE_OPUS_4_7")
	content := anthropic["content"].([]any)
	if err := require(firstText(anthropic["stop_reason"]) == "tool_use" && len(content) == 2 && content[0].(map[string]any)["type"] == "thinking" && content[1].(map[string]any)["type"] == "tool_use", "anthropic=%#v", anthropic); err != nil {
		return err
	}
	response := accumulator.toResponsePayload(map[string]any{"model": "CLAUDE_OPUS_4_7"})
	output := response["output"].([]any)
	return require(len(output) == 2 && output[0].(map[string]any)["type"] == "reasoning" && output[1].(map[string]any)["type"] == "function_call", "response=%#v", response)
}

func testLiveStreamRelay() error {
	release := make(chan struct{})
	firstWritten := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/eapi/kwaipilot/security/config":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"version": 1, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			response.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(response, "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n")
			response.(http.Flusher).Flush()
			firstWritten <- struct{}{}
			<-release
			fmt.Fprint(response, "data: {\"choices\":[{\"delta\":{\"content\":\" second\"},\"finish_reason\":\"stop\"}]}\n\n")
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()
	root, err := os.MkdirTemp("", "myflicker-live-stream-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	bridge := newBridgeServer(Settings{BaseURL: upstream.URL, ChatPath: "/eapi/kwaipilot/plugin/composer/v3/chat/completions", CachePath: filepath.Join(root, "cache.json")}, map[string]string{"MYFLICKER_TOKEN": "mock-token"}, upstream.Client())
	chunks := make(chan string, 2)
	done := make(chan error, 1)
	go func() {
		done <- bridge.streamFlickerChat(context.Background(), map[string]any{"model": "CLAUDE_OPUS_4_7", "messages": []any{map[string]any{"role": "user", "content": "hello"}}}, func(chunk map[string]any) error {
			choice := chunk["choices"].([]any)[0].(map[string]any)
			delta := choice["delta"].(map[string]any)
			chunks <- stringValue(delta["content"])
			return nil
		})
	}()
	select {
	case <-firstWritten:
	case <-time.After(2 * time.Second):
		return errors.New("upstream did not flush the first SSE event")
	}
	select {
	case first := <-chunks:
		if first != "first" {
			return fmt.Errorf("first chunk = %q", first)
		}
	case <-time.After(2 * time.Second):
		return errors.New("bridge buffered the first visible SSE event")
	}
	close(release)
	if err := <-done; err != nil {
		return err
	}
	second := <-chunks
	return require(second == " second", "second chunk=%q", second)
}

func testNativeImageUpload() error {
	var uploads int
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/eapi/kwaipilot/file/upload" {
			http.NotFound(response, request)
			return
		}
		uploads++
		if !strings.HasPrefix(request.Header.Get("Content-Type"), "multipart/form-data; boundary=----MyFlickerBridge") {
			writeOpenAIError(response, http.StatusBadRequest, "unexpected content type")
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{"status": "200", "data": map[string]any{"url": "https://image.example/one.png", "fileId": "file_1"}})
	}))
	defer upstream.Close()
	root, err := os.MkdirTemp("", "myflicker-image-upload-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	bridge := newBridgeServer(Settings{BaseURL: upstream.URL, CachePath: filepath.Join(root, "cache.json")}, map[string]string{"MYFLICKER_TOKEN": "mock-token"}, upstream.Client())
	body, err := bridge.buildFlickerBody(map[string]any{"model": "CLAUDE_OPUS_4_7", "messages": []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,AQID"}}}}}})
	if err != nil {
		return err
	}
	images := body["images"].([]any)
	contextItems := body["contextItems"].([]any)
	return require(uploads == 1 && len(images) == 1 && images[0] == "https://image.example/one.png" && len(contextItems) == 1, "uploads=%d body=%#v", uploads, body)
}

func testAnthropicAdapter() error {
	converted, err := anthropicToOpenAI(map[string]any{
		"model":    "CLAUDE_OPUS_4_7",
		"system":   "system rules",
		"messages": []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "hello"}}}},
		"tools":    []any{map[string]any{"name": "read_file", "description": "Read a file", "input_schema": map[string]any{"type": "object"}}},
	})
	if err != nil {
		return err
	}
	messages, ok := converted["messages"].([]any)
	if err := require(ok && len(messages) == 2, "messages = %#v", converted["messages"]); err != nil {
		return err
	}
	tools, ok := converted["tools"].([]any)
	return require(ok && len(tools) == 1, "tools = %#v", converted["tools"])
}

func testResponsesAdapter() error {

	converted, err := responsesToOpenAI(map[string]any{
		"model":        "CLAUDE_OPUS_4_7",
		"instructions": "be concise",
		"input":        []any{map[string]any{"type": "message", "role": "user", "content": []any{map[string]any{"type": "input_text", "text": "hello"}}}},
	})
	if err != nil {
		return err
	}
	messages, ok := converted["messages"].([]any)
	if err := require(ok && len(messages) == 2, "messages = %#v", converted["messages"]); err != nil {
		return err
	}
	return require(firstText(converted["model"]) == "CLAUDE_OPUS_4_7", "model = %#v", converted["model"])
}

func runSelfTests(selected string) error {
	cases := []selfTestCase{
		{name: "settings-defaults", run: testSettingsDefaults},
		{name: "cache-round-trip", run: testCacheRoundTrip},
		{name: "cache-schema-compatibility", run: testCacheSchemaCompatibility},
		{name: "state-value-decode", run: testStateValueDecode},
		{name: "sqlite-state-read", run: testSQLiteStateRead},
		{name: "security-key-priority", run: testSecurityKeyPriority},
		{name: "running-install-discovery", run: testRunningInstallDiscovery},
		{name: "auth-refresh", run: testAuthRefresh},
		{name: "model-catalog-merge", run: testModelCatalogMerge},
		{name: "security-encrypt-sign", run: testSecurityEncryptSign},
		{name: "zstd-request-decode", run: testZstdRequestDecode},
		{name: "sse-parse", run: testSSEParse},
		{name: "local-api-key-guard", run: testLocalAPIKeyGuard},
		{name: "health-endpoint", run: testHealthEndpoint},
		{name: "openai-chat-relay", run: testOpenAIChatRelay},
		{name: "legacy-fallback-after-empty-v3", run: testLegacyFallbackAfterEmptyV3Stream},
		{name: "legacy-retry-after-empty-v2", run: testLegacyRetryAfterEmptyV2Stream},
		{name: "flicker-body-parity", run: testFlickerBodyParity},
		{name: "upstream-event-and-accumulator-parity", run: testUpstreamEventAndAccumulatorParity},
		{name: "upstream-auth-and-security-retries", run: testUpstreamAuthAndSecurityRetries},
		{name: "protocol-output-parity", run: testProtocolOutputParity},
		{name: "live-stream-relay", run: testLiveStreamRelay},
		{name: "native-image-upload", run: testNativeImageUpload},
		{name: "anthropic-adapter", run: testAnthropicAdapter},
		{name: "responses-adapter", run: testResponsesAdapter},
	}
	matched := 0
	for _, tc := range cases {
		if selected != "" && selected != tc.name {
			continue
		}
		matched++
		if err := tc.run(); err != nil {
			return fmt.Errorf("%s: %w", tc.name, err)
		}
		fmt.Printf("[PASS] %s\n", tc.name)
	}
	if matched == 0 {
		return errors.New("no self-test matched")
	}
	return nil
}

func Run(args []string) error {
	for index := 0; index < len(args); index++ {
		if args[index] != "--self-test" && !strings.HasPrefix(args[index], "--self-test=") {
			continue
		}
		selected := ""
		if strings.HasPrefix(args[index], "--self-test=") {
			selected = strings.TrimPrefix(args[index], "--self-test=")
		} else if index+1 < len(args) {
			selected = args[index+1]
		}
		if selected == "all" {
			selected = ""
		}
		return runSelfTests(selected)
	}

	settings, err := parseSettings(args, nil)
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}
	if settings.LogPath != "" {
		restoreOutput, err := redirectProcessOutput(settings.LogPath, configuredLogMaxBytes(nil))
		if err != nil {
			return fmt.Errorf("open bridge log: %w", err)
		}
		defer restoreOutput()
		fmt.Printf("[log] path=%s max_bytes=%d\n", settings.LogPath, configuredLogMaxBytes(nil))
	}
	bridge := newBridgeServer(settings, nil, nil)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Printf("[startup] bind=http://%s:%d base=%s chat_path=%s cache=%s\n", settings.Host, settings.Port, settings.BaseURL, settings.ChatPath, settings.CachePath)
	if _, err := bridge.auth.Token(ctx, false); err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}
	if err := bridge.refreshModelCatalog(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "model catalog refresh failed; serving fallback catalog:", err)
	}
	server := &http.Server{Addr: net.JoinHostPort(settings.Host, strconv.Itoa(settings.Port)), Handler: bridge.Handler(), ReadHeaderTimeout: 15 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	fmt.Printf("MyFlicker bridge listening on http://%s:%d/v1\n", settings.Host, settings.Port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server failed: %w", err)
	}
	return nil
}
