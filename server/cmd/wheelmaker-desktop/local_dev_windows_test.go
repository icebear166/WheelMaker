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

func TestWindowsLocalDevExecutorUsesFixedBatchAndOperation(t *testing.T) {
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
	if file != "cmd.exe" {
		t.Fatalf("file = %q", file)
	}
	if got := args[len(args)-1]; got != "restart" {
		t.Fatalf("operation = %q", got)
	}
}
