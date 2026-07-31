package main

import "testing"

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
