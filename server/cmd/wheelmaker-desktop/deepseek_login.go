package main

import (
	"strconv"
	"strings"
	"time"
)

const (
	deepSeekLoginURL          = "https://platform.deepseek.com"
	deepSeekLoginTimeout      = 10 * time.Minute
	deepSeekLoginPollInterval = time.Second
	deepSeekLoginMaxTokenLen  = 4096
)

// deepSeekLoginScript reads the first token-like value from localStorage.
const deepSeekLoginScript = `(() => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) || '';
    if (!/token/i.test(key)) continue;
    const raw = String(localStorage.getItem(key) || '');
    const match = raw.match(/[A-Za-z0-9._~+/=-]{20,}/);
    if (match) return match[0];
  }
  return '';
})()`

// deepSeekLoginPollScript polls the token finder and reports through the
// native RPC bindings installed on the login window.
func deepSeekLoginPollScript() string {
	return `(() => {
  const find = ` + deepSeekLoginScript + `;
  const poll = () => {
    try {
      const token = find();
      if (token) {
        if (window.__wheelMakerDeepSeekToken) window.__wheelMakerDeepSeekToken(token);
        if (window.__wheelMakerDeepSeekClose) window.__wheelMakerDeepSeekClose();
        return;
      }
    } catch (_) {}
    setTimeout(poll, 1000);
  };
  setTimeout(poll, 1000);
})()`
}

// extractDeepSeekToken normalizes the JSON-encoded ExecuteScript result.
func extractDeepSeekToken(result string) string {
	value := strings.TrimSpace(result)
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	}
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "Bearer ")
	if len(value) < 20 || len(value) > deepSeekLoginMaxTokenLen {
		return ""
	}
	if strings.ContainsAny(value, " \t\r\n") {
		return ""
	}
	return value
}

type deepSeekLoginSession struct {
	readToken func() (string, bool)
	started   time.Time
}

func newDeepSeekLoginSession(readToken func() (string, bool)) *deepSeekLoginSession {
	return &deepSeekLoginSession{readToken: readToken, started: time.Now()}
}

// Poll returns (token, true) when the session token is found or the timeout
// elapses; otherwise ("", false).
func (s *deepSeekLoginSession) Poll() (string, bool) {
	if time.Since(s.started) > deepSeekLoginTimeout {
		return "", true
	}
	if s.readToken == nil {
		return "", true
	}
	return s.readToken()
}
