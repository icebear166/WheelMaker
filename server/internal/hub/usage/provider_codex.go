package usage

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

var newBackgroundCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	shared.ConfigureBackgroundCommand(cmd)
	return cmd
}

type CodexScanner struct{ Binary string }

func NewCodexScanner(binary string) *CodexScanner { return &CodexScanner{Binary: binary} }

func (s *CodexScanner) Scan(ctx context.Context) ProviderSnapshot {
	result := ProviderSnapshot{ID: ProviderCodex, Name: "Codex", Accounts: []Account{}}
	payload, err := fetchCodexRateLimits(ctx, s.Binary)
	if err != nil {
		result.Status, result.Message = ProviderUnavailable, "not authenticated"
		return result
	}
	limits, err := parseCodexRateLimits(payload)
	if err != nil {
		result.Status, result.Message = ProviderError, "invalid response"
		return result
	}
	result.Status = ProviderOK
	result.Accounts = []Account{{LocalID: "current", Identity: Identity{Kind: "profile", Label: "Current account"}, Status: ProviderOK, Limits: limits}}
	return result
}

func parseCodexRateLimits(payload map[string]any) ([]Limit, error) {
	rateLimits, ok := payload["rateLimits"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("rate limits missing")
	}
	limits := make([]Limit, 0, 2)
	for _, key := range []string{"primary", "secondary"} {
		window, _ := rateLimits[key].(map[string]any)
		duration := int64(number(window["windowDurationMins"]))
		id, label := "", ""
		switch duration {
		case 300:
			id, label = "5h", "5 hours"
		case 10080:
			id, label = "week", "Week"
		default:
			continue
		}
		var reset *time.Time
		if seconds := int64(number(window["resetsAt"])); seconds > 0 {
			value := time.Unix(seconds, 0).UTC()
			reset = &value
		}
		limits = append(limits, Limit{ID: id, Label: label, RemainingPercent: clampPercent(100 - number(window["usedPercent"])), ResetsAt: reset})
	}
	if len(limits) == 0 {
		return nil, fmt.Errorf("rate limit windows missing")
	}
	return limits, nil
}

func fetchCodexRateLimits(ctx context.Context, binary string) (map[string]any, error) {
	if strings.TrimSpace(binary) == "" {
		binary = "codex"
	}
	cmd := newBackgroundCommand(ctx, binary, "app-server", "--listen", "stdio://")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	var writeMu sync.Mutex
	var requestID int64
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	roundTrip := func(method string, params map[string]any, result any) error {
		writeMu.Lock()
		requestID++
		id := requestID
		raw, marshalErr := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
		if marshalErr == nil {
			_, marshalErr = stdin.Write(append(raw, '\n'))
		}
		writeMu.Unlock()
		if marshalErr != nil {
			return marshalErr
		}
		for scanner.Scan() {
			var response struct {
				ID     int64           `json:"id"`
				Result json.RawMessage `json:"result"`
				Error  json.RawMessage `json:"error"`
			}
			if json.Unmarshal(scanner.Bytes(), &response) != nil || response.ID != id {
				continue
			}
			if len(response.Error) > 0 && string(response.Error) != "null" {
				return fmt.Errorf("app server request failed")
			}
			if result == nil {
				return nil
			}
			return json.Unmarshal(response.Result, result)
		}
		return fmt.Errorf("app server closed")
	}
	if err := roundTrip("initialize", map[string]any{
		"clientInfo":   map[string]any{"name": "wheelmaker-hub", "version": "1.0"},
		"capabilities": map[string]any{"experimentalApi": true},
	}, nil); err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := roundTrip("account/rateLimits/read", map[string]any{}, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}
