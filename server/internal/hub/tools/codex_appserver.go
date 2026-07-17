package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

// codexWindow is one rate-limit window parsed from account/rateLimits/read.
type codexWindow struct {
	usedPercent int64
	resetsAt    int64
}

// parseCodexRateLimits extracts the 5h (windowDurationMins==300) and weekly
// (==10080) windows from an account/rateLimits/read result. Returns nil for a
// window that is absent. Windows are classified by duration, not by the
// primary/secondary label, because the server may reorder them.
func parseCodexRateLimits(payload map[string]any) (fiveHour, week *codexWindow, err error) {
	rateLimits, ok := payload["rateLimits"].(map[string]any)
	if !ok || rateLimits == nil {
		return nil, nil, fmt.Errorf("rateLimits missing from codex response")
	}
	classify := func(raw any) {
		m, ok := raw.(map[string]any)
		if !ok || m == nil {
			return
		}
		dur := toInt64(m["windowDurationMins"])
		w := &codexWindow{
			usedPercent: toInt64(m["usedPercent"]),
			resetsAt:    toInt64(m["resetsAt"]),
		}
		switch dur {
		case 300:
			if fiveHour == nil {
				fiveHour = w
			}
		case 10080:
			if week == nil {
				week = w
			}
		}
	}
	classify(rateLimits["primary"])
	classify(rateLimits["secondary"])
	return fiveHour, week, nil
}

// fetchCodexRateLimitsViaAppServer spawns `codex app-server --listen stdio://`,
// performs the JSON-RPC initialize handshake, calls account/rateLimits/read,
// parses the two windows, and kills the child process. The codex binary owns
// its own auth (~/.codex/auth.json); no bearer header is sent from here.
// The ctx must carry a deadline — on timeout, exec kills the child which
// unblocks the stdout scanner.
func fetchCodexRateLimitsViaAppServer(ctx context.Context, binary, accessToken string) (fiveHour, week *codexWindow, err error) {
	bin := strings.TrimSpace(binary)
	if bin == "" {
		bin = "codex"
	}
	cmd := exec.CommandContext(ctx, bin, "app-server", "--listen", "stdio://")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("codex app-server stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("codex app-server stdout: %w", err)
	}
	if startErr := cmd.Start(); startErr != nil {
		return nil, nil, fmt.Errorf("codex app-server start: %w", startErr)
	}
	// Ensure the child is reaped even on early return.
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = cmd.Process.Kill()
		case <-done:
		}
	}()
	defer func() {
		close(done)
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	var writeMu sync.Mutex
	var nextID int64
	writeMsg := func(method string, params map[string]any) (int64, error) {
		writeMu.Lock()
		defer writeMu.Unlock()
		nextID++
		id := nextID
		req := map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}
		raw, mErr := json.Marshal(req)
		if mErr != nil {
			return 0, mErr
		}
		if _, wErr := stdin.Write(append(raw, '\n')); wErr != nil {
			return 0, wErr
		}
		return id, nil
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	roundTrip := func(method string, params map[string]any, resultOut any) error {
		id, wErr := writeMsg(method, params)
		if wErr != nil {
			return fmt.Errorf("write %s: %w", method, wErr)
		}
		for scanner.Scan() {
			var resp struct {
				ID     int64           `json:"id"`
				Result json.RawMessage `json:"result,omitempty"`
				Error  *struct {
					Message string `json:"message"`
				} `json:"error,omitempty"`
			}
			if jErr := json.Unmarshal(scanner.Bytes(), &resp); jErr != nil {
				continue
			}
			if resp.ID != id {
				continue
			}
			if resp.Error != nil {
				return fmt.Errorf("%s: %s", method, resp.Error.Message)
			}
			if resultOut == nil {
				return nil
			}
			return json.Unmarshal(resp.Result, resultOut)
		}
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("%s cancelled: %w", method, err)
		}
		if scanErr := scanner.Err(); scanErr != nil {
			return fmt.Errorf("codex app-server stdout scan: %w", scanErr)
		}
		return fmt.Errorf("codex app-server closed stream before responding to %s", method)
	}

	// 1. initialize
	if err = roundTrip("initialize", map[string]any{
		"clientInfo":   map[string]any{"name": "wheelmaker-hub", "version": "1.0"},
		"capabilities": map[string]any{"experimentalApi": true},
	}, nil); err != nil {
		return nil, nil, err
	}

	// 2. account/rateLimits/read
	var rateLimitsResult map[string]any
	if err = roundTrip("account/rateLimits/read", map[string]any{}, &rateLimitsResult); err != nil {
		return nil, nil, fmt.Errorf("account/rateLimits/read: %w", err)
	}
	_ = accessToken // codex owns its own auth; not sent over the wire
	return parseCodexRateLimits(rateLimitsResult)
}
