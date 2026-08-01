package main

import (
	"os"
	"strings"
	"testing"
)

func TestDeepSeekLoginScriptTargetsUserTokenKey(t *testing.T) {
	if !strings.Contains(deepSeekLoginScript, `localStorage.getItem('userToken')`) {
		t.Fatal("login script must read the userToken key precisely")
	}
	if strings.Contains(deepSeekLoginScript, "localStorage.key(") || strings.Contains(deepSeekLoginScript, "localStorage.length") {
		t.Fatal("login script must not scan unrelated localStorage keys")
	}
}

func TestDeepSeekLoginOverlayRunsOnOneLockedThread(t *testing.T) {
	body, err := os.ReadFile("deepseek_login_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(body)
	for _, want := range []string{
		"runtime.LockOSThread()",
		"setWindowParent(hwnd, parentHwnd)",
		"window.Run()",
	} {
		if !strings.Contains(source, want) {
			t.Errorf("login overlay missing %q", want)
		}
	}
	if strings.Contains(source, "go window.Run()") {
		t.Error("login overlay must run its message loop on the window's own thread")
	}
}

func TestExtractDeepSeekToken(t *testing.T) {
	const token = "abcdefghijklmnopqrstuvwxyz012345"
	cases := map[string]string{
		`"` + token + `"`:            token,
		`""`:                         "",
		`"Bearer ` + token + `"`:     token,
		token:                        token,
		`"short"`:                    "",
		`"token with spaces and xx"`: "",
	}
	for input, want := range cases {
		if got := extractDeepSeekToken(input); got != want {
			t.Fatalf("extractDeepSeekToken(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDeepSeekLoginSessionPollsUntilToken(t *testing.T) {
	reads := 0
	read := func() (string, bool) {
		reads++
		if reads < 2 {
			return "", false
		}
		return "session-token", true
	}
	session := newDeepSeekLoginSession(read)
	for i := 0; i < 5; i++ {
		if token, done := session.Poll(); done {
			if token != "session-token" {
				t.Fatalf("token=%q", token)
			}
			return
		}
	}
	t.Fatal("session did not resolve")
}
