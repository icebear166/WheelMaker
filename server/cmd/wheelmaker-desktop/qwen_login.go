package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	qwenLoginURL            = "https://bailian.console.aliyun.com/"
	qwenLoginDomesticOrigin = "https://bailian.console.aliyun.com"
	qwenLoginIntlOrigin     = "https://modelstudio.console.alibabacloud.com"
	qwenLoginTimeout        = 10 * time.Minute
	qwenLoginMaxBundleLen   = 16 * 1024
	qwenLoginMaxBodyLen     = 64 * 1024
)

var (
	errQwenLoginClosed  = errors.New("qwen login window closed")
	errQwenLoginTimeout = errors.New("qwen login timed out")
)

// extractQwenOAuth accepts only the sanitized JSON bundle returned by the
// callback parser. It intentionally validates the token shape without
// accepting cookies, API keys, or arbitrary response bodies.
func extractQwenOAuth(result string) string {
	value := strings.TrimSpace(result)
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	}
	value = strings.TrimSpace(value)
	if value == "" || len(value) > qwenLoginMaxBundleLen {
		return ""
	}
	var credential struct {
		AccessToken string `json:"accessToken"`
	}
	if json.Unmarshal([]byte(value), &credential) != nil || strings.TrimSpace(credential.AccessToken) == "" || strings.ContainsAny(credential.AccessToken, " \t\r\n") {
		return ""
	}
	return value
}

type qwenLoginCallback struct {
	loginURL string
	state    string
	server   *http.Server
	result   chan string
	done     chan struct{}
	once     sync.Once
}

func newQwenLoginCallback(site string) (*qwenLoginCallback, error) {
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return nil, errors.New("create Qwen login state")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, errors.New("bind Qwen login callback")
	}
	callback := &qwenLoginCallback{
		state:  hex.EncodeToString(stateBytes),
		result: make(chan string, 1),
		done:   make(chan struct{}),
	}
	callback.server = &http.Server{Handler: http.HandlerFunc(callback.handle)}
	go func() {
		_ = callback.server.Serve(listener)
	}()
	origin := qwenLoginDomesticOrigin
	if strings.EqualFold(strings.TrimSpace(site), "international") {
		origin = qwenLoginIntlOrigin
	}
	callback.loginURL = fmt.Sprintf(
		"%s/console-login?notice=127.0.0.1:%d?state=%s",
		origin, listener.Addr().(*net.TCPAddr).Port, url.QueryEscape(callback.state),
	)
	return callback, nil
}

func (c *qwenLoginCallback) handle(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if request.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if strings.TrimSpace(request.URL.Query().Get("state")) != c.state {
		http.Error(w, "bad state", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, qwenLoginMaxBodyLen+1))
	if err != nil || len(body) > qwenLoginMaxBodyLen {
		http.Error(w, "invalid callback", http.StatusBadRequest)
		return
	}
	bundle := qwenOAuthCallbackBundle(request.URL.Query(), request.Header.Get("Content-Type"), body)
	if bundle == "" {
		http.Error(w, "missing OAuth credential", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "OK\n")
	select {
	case c.result <- bundle:
	default:
	}
}

func (c *qwenLoginCallback) LoginURL() string {
	if c == nil {
		return ""
	}
	return c.loginURL
}

func (c *qwenLoginCallback) Close() {
	if c == nil {
		return
	}
	c.once.Do(func() {
		close(c.done)
		if c.server != nil {
			_ = c.server.Close()
		}
	})
}

func (c *qwenLoginCallback) Wait() (string, error) {
	if c == nil {
		return "", errQwenLoginClosed
	}
	timer := time.NewTimer(qwenLoginTimeout)
	defer timer.Stop()
	select {
	case value := <-c.result:
		c.Close()
		return value, nil
	case <-c.done:
		return "", errQwenLoginClosed
	case <-timer.C:
		c.Close()
		return "", errQwenLoginTimeout
	}
}

func qwenOAuthCallbackBundle(query url.Values, contentType string, body []byte) string {
	record := map[string]any{}
	if (strings.Contains(strings.ToLower(contentType), "application/json") || strings.HasPrefix(strings.TrimSpace(string(body)), "{")) && len(body) > 0 {
		_ = json.Unmarshal(body, &record)
	}
	if len(record) == 0 && len(body) > 0 {
		if values, err := url.ParseQuery(string(body)); err == nil {
			for key, values := range values {
				if len(values) > 0 {
					record[key] = values[0]
				}
			}
		}
	}
	field := func(keys ...string) string {
		for _, key := range keys {
			if value := strings.TrimSpace(query.Get(key)); value != "" {
				return value
			}
		}
		return qwenCallbackRecordString(record, keys...)
	}
	accessToken := field("access_token", "accessToken")
	if accessToken == "" || len(accessToken) > 4096 || strings.ContainsAny(accessToken, " \t\r\n") {
		return ""
	}
	bundle := map[string]string{"accessToken": accessToken}
	if value := field("refresh_token", "refreshToken"); value != "" && len(value) <= 4096 && !strings.ContainsAny(value, " \t\r\n") {
		bundle["refreshToken"] = value
	}
	if value := field("expires_at", "expiresAt"); value != "" {
		if normalized := qwenCallbackExpiry(value); normalized != "" {
			bundle["expiresAt"] = normalized
		}
	}
	if value := field("console_region", "consoleRegion", "region"); value != "" && len(value) <= 128 {
		bundle["region"] = value
	}
	if value := field("console_site", "consoleSite", "site"); value != "" && len(value) <= 64 {
		bundle["site"] = value
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		return ""
	}
	return extractQwenOAuth(string(raw))
}

func qwenCallbackRecordString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := record[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	if nested, ok := record["data"].(map[string]any); ok {
		for _, key := range keys {
			if value, ok := nested[key].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func qwenCallbackExpiry(value string) string {
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC().Format(time.RFC3339)
	}
	number, err := strconv.ParseInt(value, 10, 64)
	if err != nil || number <= 0 {
		return ""
	}
	if number < 1_000_000_000_000 {
		number *= 1000
	}
	return time.UnixMilli(number).UTC().Format(time.RFC3339)
}
