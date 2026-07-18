//go:build windows

package main

import (
	"context"
	"testing"
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
