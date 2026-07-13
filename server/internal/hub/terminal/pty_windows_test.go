//go:build windows

package terminal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

func TestWindowsConPTYRepeatedResizePreservesLongOutput(t *testing.T) {
	shell, err := DetectShell(defaultLookPath)
	if err != nil {
		t.Skip(err)
	}
	if strings.EqualFold(filepath.Base(shell), "cmd.exe") {
		t.Skip("PowerShell is required for the long-line resize regression")
	}
	pty, err := NewPlatformPTYFactory().Start(context.Background(), shell, os.TempDir(), 80, 36)
	if err != nil {
		t.Fatal(err)
	}
	defer pty.Kill()
	defer pty.Close()

	screen := newXTermScreen(80, 36)
	defer screen.Close()
	var mu sync.Mutex
	var filter conPTYResizeRepaintFilter
	var outputGeneration uint64
	lastOutput := time.Now()
	go func() {
		buffer := make([]byte, 32*1024)
		for {
			n, readErr := pty.Read(buffer)
			if n > 0 {
				mu.Lock()
				filtered := filter.Filter(buffer[:n])
				if len(filtered) > 0 {
					_, _ = screen.Write(filtered)
				}
				outputGeneration++
				lastOutput = time.Now()
				mu.Unlock()
			}
			if readErr != nil {
				return
			}
		}
	}()

	command := "1..200 | ForEach-Object { ('__WM_LINE_{0:D4}__' -f $_) + ('x' * 140) }; Write-Output ('__WM_' + 'READY__')\r"
	if _, err := pty.Write([]byte(command)); err != nil {
		t.Fatal(err)
	}
	waitForScreenCondition(t, &mu, screen, func(snapshot []byte) bool {
		return bytes.Contains(snapshot, []byte("__WM_READY__"))
	})

	for _, size := range [][2]int{{42, 18}, {126, 72}, {58, 24}, {104, 64}, {76, 32}, {132, 80}, {48, 20}, {96, 60}} {
		mu.Lock()
		generationBeforeResize := outputGeneration
		filter.Arm()
		if err := pty.Resize(size[0], size[1]); err != nil {
			filter.Cancel()
			mu.Unlock()
			t.Fatal(err)
		}
		screen.Resize(size[0], size[1])
		mu.Unlock()
		waitForConPTYResizeOutput(t, &mu, &outputGeneration, &lastOutput, generationBeforeResize)
	}

	mu.Lock()
	snapshot := screen.Snapshot()
	mu.Unlock()
	for index := 1; index <= 200; index++ {
		marker := []byte(fmt.Sprintf("__WM_LINE_%04d__", index))
		if count := bytes.Count(snapshot, marker); count != 1 {
			t.Fatalf("snapshot contains marker %d %d times after repeated ConPTY resize", index, count)
		}
	}
}

func waitForScreenCondition(t *testing.T, mu *sync.Mutex, screen Screen, ready func([]byte) bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		snapshot := screen.Snapshot()
		mu.Unlock()
		if ready(snapshot) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("timed out waiting for terminal output")
}

func waitForConPTYResizeOutput(
	t *testing.T,
	mu *sync.Mutex,
	generation *uint64,
	lastOutput *time.Time,
	previousGeneration uint64,
) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		complete := *generation > previousGeneration && time.Since(*lastOutput) >= 75*time.Millisecond
		mu.Unlock()
		if complete {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("timed out waiting for ConPTY resize repaint")
}
