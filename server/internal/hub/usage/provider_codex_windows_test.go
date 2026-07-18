//go:build windows

package usage

import (
	"context"
	"testing"
)

func TestCodexCommandHidesWindow(t *testing.T) {
	cmd := newBackgroundCommand(context.Background(), "cmd", "/c", "exit", "0")
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("Codex helper must hide its Windows console window")
	}
}
