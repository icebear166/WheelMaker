package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCXFlickerRealCodexAppServerToolAndImageSmoke(t *testing.T) {
	if os.Getenv("WHEELMAKER_CX_FLICKER_REAL_SMOKE") != "1" {
		t.Skip("set WHEELMAKER_CX_FLICKER_REAL_SMOKE=1 to run the real Codex app-server smoke")
	}
	store := NewFlickerModelStore()
	store.Refresh()
	provider := NewCXFlickerProvider(t.TempDir(), os.Getenv(cxFlickerAPIKeyEnv), store)
	executable, args, environment, err := provider.Launch()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = filepath.Clean(`E:\_Code\WheelMaker`)
	command.Env = append(os.Environ(), environment...)
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = stdin.Close()
		if runtime.GOOS == "windows" {
			_ = exec.Command("taskkill", "/PID", strconv.Itoa(command.Process.Pid), "/T", "/F").Run()
		} else {
			_ = command.Process.Kill()
		}
		_ = command.Wait()
	})
	stderrDone := make(chan string, 1)
	go func() {
		data, _ := io.ReadAll(stderr)
		stderrDone <- string(data)
	}()
	stderrText := func() string {
		select {
		case value := <-stderrDone:
			return value
		default:
			return ""
		}
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	readResponse := func(id float64) (map[string]any, error) {
		for scanner.Scan() {
			var message map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
				return nil, err
			}
			method, _ := message["method"].(string)
			if method != "" {
				t.Logf("app-server method=%s", method)
			}
			if responseID, ok := message["id"].(float64); ok && responseID == id {
				return message, nil
			}
		}
		if err := scanner.Err(); err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("app-server closed stdout while waiting for response %.0f", id)
	}
	write := func(value string) error {
		if _, err := fmt.Fprintln(stdin, value); err != nil {
			return err
		}
		return nil
	}
	if err := write(`{"id":1,"method":"initialize","params":{"clientInfo":{"name":"wheelmaker-real-smoke","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}`); err != nil {
		t.Fatal(err)
	}
	if _, err := readResponse(1); err != nil {
		t.Fatalf("%v; stderr=%s", err, stderrText())
	}
	if err := write(`{"method":"initialized","params":{}}`); err != nil {
		t.Fatal(err)
	}
	if err := write(`{"id":2,"method":"thread/start","params":{"cwd":"E:\\_Code\\WheelMaker","model":"deepseek-v4-flash-0731","approvalPolicy":"never","sandbox":"danger-full-access"}}`); err != nil {
		t.Fatal(err)
	}
	threadResponse, err := readResponse(2)
	if err != nil {
		t.Fatal(err)
	}
	result, _ := threadResponse["result"].(map[string]any)
	thread, _ := result["thread"].(map[string]any)
	threadID, _ := thread["id"].(string)
	if threadID == "" {
		t.Fatalf("thread/start response missing thread id: %#v", threadResponse)
	}
	imagePath := filepath.Join(t.TempDir(), "probe.png")
	if err := os.WriteFile(imagePath, []byte{137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 0, 0, 0, 6, 0, 3, 53, 105, 9, 101, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130}, 0o600); err != nil {
		t.Fatal(err)
	}
	turn := map[string]any{
		"id": 3, "method": "turn/start", "params": map[string]any{
			"threadId": threadID,
			"input": []any{
				map[string]any{"type": "text", "text": "Use the shell tool to run Get-Location, then describe the attached image in one short sentence. Reply with APP-SERVER-OK after both are complete.", "text_elements": []any{}},
				map[string]any{"type": "localImage", "path": imagePath},
			},
			"cwd": "E:\\_Code\\WheelMaker", "model": "deepseek-v4-flash-0731", "effort": "high", "approvalPolicy": "never",
			"sandboxPolicy": map[string]any{"type": "workspaceWrite", "networkAccess": false, "excludeTmpdirEnvVar": false, "excludeSlashTmp": false},
		},
	}
	encoded, err := json.Marshal(turn)
	if err != nil {
		t.Fatal(err)
	}
	if err := write(string(encoded)); err != nil {
		t.Fatal(err)
	}
	completed := false
	toolEvent := false
	imageEvent := false
	for scanner.Scan() {
		var message map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			t.Fatal(err)
		}
		method, _ := message["method"].(string)
		if method != "" {
			t.Logf("app-server method=%s", method)
		}
		if method == "error" {
			raw, _ := json.Marshal(message)
			t.Logf("app-server error=%s", raw)
		}
		if strings.Contains(strings.ToLower(method), "commandexecution") || strings.Contains(strings.ToLower(method), "shell") {
			toolEvent = true
		}
		if strings.Contains(strings.ToLower(method), "image") || strings.Contains(strings.ToLower(string(scanner.Bytes())), "localimage") {
			imageEvent = true
		}
		params, _ := message["params"].(map[string]any)
		turnValue, _ := params["turn"].(map[string]any)
		status, _ := turnValue["status"].(string)
		if method == "turn/completed" || status == "completed" || status == "failed" {
			completed = true
			break
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if !completed {
		t.Fatal("app-server turn did not complete")
	}
	if !toolEvent {
		t.Error("app-server turn did not emit a shell/tool event")
	}
	if !imageEvent {
		t.Log("app-server stream did not echo an image event; image was supplied as localImage input")
	}
}
