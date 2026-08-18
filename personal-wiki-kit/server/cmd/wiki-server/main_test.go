package main

import "testing"

func TestValidateServeModeRequiresSecureCookiesOnline(t *testing.T) {
	if err := validateServeMode("online", false); err == nil {
		t.Fatal("online mode accepted insecure session cookies")
	}
	for _, input := range []struct {
		mode         string
		secureCookie bool
	}{
		{mode: "online", secureCookie: true},
		{mode: "local", secureCookie: false},
	} {
		if err := validateServeMode(input.mode, input.secureCookie); err != nil {
			t.Fatalf("validateServeMode(%q, %v) error = %v", input.mode, input.secureCookie, err)
		}
	}
}
