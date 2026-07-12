//go:build windows

package terminal

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDetectWindowsShellUsesPreferredOrder(t *testing.T) {
	var calls []string
	lookPath := func(name string) (string, error) {
		calls = append(calls, name)
		if name == "powershell.exe" {
			return `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, nil
		}
		return "", errors.New("missing")
	}
	got, err := DetectShell(lookPath)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(got) != "powershell.exe" {
		t.Fatalf("shell=%q", got)
	}
	want := []string{"pwsh.exe", "powershell.exe"}
	if strings.Join(calls, ",") != strings.Join(want, ",") {
		t.Fatalf("calls=%v, want %v", calls, want)
	}
}

func TestWindowsPTYRunsShellInRequestedDirectory(t *testing.T) {
	shell, err := DetectShell(defaultLookPath)
	if err != nil {
		t.Skip(err)
	}
	cwd := t.TempDir()
	pty, err := NewPlatformPTYFactory().Start(context.Background(), shell, cwd, 100, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer pty.Close()

	var output bytes.Buffer
	var outputMu sync.Mutex
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		buf := make([]byte, 4096)
		for {
			n, readErr := pty.Read(buf)
			if n > 0 {
				outputMu.Lock()
				_, _ = output.Write(buf[:n])
				outputMu.Unlock()
			}
			if readErr != nil {
				return
			}
		}
	}()
	command := "Write-Output 'wm-pty-marker'; (Get-Location).Path; exit\r"
	if strings.EqualFold(filepath.Base(shell), "cmd.exe") {
		command = "echo wm-pty-marker & cd & exit\r"
	}
	if _, err := pty.Write([]byte(command)); err != nil {
		t.Fatal(err)
	}
	code, err := pty.Wait()
	if err != nil || code != 0 {
		t.Fatalf("wait code=%d err=%v", code, err)
	}
	_ = pty.Close()
	select {
	case <-readDone:
	case <-time.After(5 * time.Second):
		t.Fatal("PTY output did not close")
	}
	outputMu.Lock()
	got := output.String()
	outputMu.Unlock()
	if !strings.Contains(got, "wm-pty-marker") || !strings.Contains(strings.ToLower(got), strings.ToLower(cwd)) {
		t.Fatalf("output=%q", got)
	}
}

func TestWindowsPTYKillStopsShell(t *testing.T) {
	shell, err := DetectShell(defaultLookPath)
	if err != nil {
		t.Skip(err)
	}
	pty, err := NewPlatformPTYFactory().Start(context.Background(), shell, os.TempDir(), 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitDone := make(chan struct{})
	go func() {
		_, _ = pty.Wait()
		close(waitDone)
	}()
	if err := pty.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = pty.Close()
	select {
	case <-waitDone:
	case <-time.After(5 * time.Second):
		t.Fatal("killed PTY did not exit")
	}
}
