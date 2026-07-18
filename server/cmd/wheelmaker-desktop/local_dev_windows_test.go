//go:build windows

package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestWindowsLocalDevExecutorRequiresConfirmation(t *testing.T) {
	called := false
	executor := &windowsLocalDevExecutor{
		confirm: func(localDevOperation, string) bool { return false },
		run: func(context.Context, string, []string, string, []string) error {
			called = true
			return nil
		},
	}
	if err := executor.Run(context.Background(), `D:\Code\WheelMaker`, localDevBuild); err == nil {
		t.Fatal("Run succeeded after confirmation was declined")
	}
	if called {
		t.Fatal("Run invoked the build script after confirmation was declined")
	}
}

func TestWindowsLocalDevExecutorUsesNodeScriptAndFixedOperation(t *testing.T) {
	var file string
	var args []string
	executor := &windowsLocalDevExecutor{
		confirm: func(localDevOperation, string) bool { return true },
		run: func(_ context.Context, gotFile string, gotArgs []string, _ string, _ []string) error {
			file, args = gotFile, gotArgs
			return nil
		},
	}
	if err := executor.Run(context.Background(), `D:\Code\WheelMaker`, localDevRestart); err != nil {
		t.Fatal(err)
	}
	if file != "node.exe" {
		t.Fatalf("file = %q", file)
	}
	want := []string{`D:\Code\WheelMaker\scripts\dev-local.mjs`, "restart"}
	if len(args) != len(want) || args[0] != want[0] || args[1] != want[1] {
		t.Fatalf("args = %q, want %q", args, want)
	}
}

func TestFormatWindowsLocalDevCommandErrorDropsInvalidOutputBytes(t *testing.T) {
	err := formatWindowsLocalDevCommandError(
		errors.New("exit status 1"),
		[]byte{'[', 'd', 'e', 'v', ']', ' ', 'f', 'a', 'i', 'l', 'e', 'd', ' ', 0x81, 0x82},
	)
	if !utf8.ValidString(err.Error()) {
		t.Fatalf("error is not valid UTF-8: %q", err)
	}
	if strings.ContainsRune(err.Error(), utf8.RuneError) {
		t.Fatalf("error contains replacement glyphs: %q", err)
	}
}
