package tools

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Install-message verification tests. Kept in a dedicated file so the A2
// post-install LookPath checks are exercised independently of the larger
// tools_test.go update/release test suite.

func TestNPMCommandInstallMessageReportsReadyWhenBinaryOnPath(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)
	cmd.lookPath = func(name string) (string, error) {
		if name == "codex" {
			return "/usr/local/bin/codex", nil
		}
		return "", errors.New("not found")
	}

	_, err := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	}))
	if err != nil {
		t.Fatalf("install error: %#v", err)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("status=%q want succeeded", operation.Status)
	}
	if !strings.Contains(operation.Message, "ready to use") || strings.Contains(operation.Message, "Restart WheelMaker") {
		t.Fatalf("message=%q want ready to use (no restart)", operation.Message)
	}
}

func TestNPMCommandInstallMessageReportsRestartWhenBinaryMissing(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)
	cmd.lookPath = func(string) (string, error) { return "", errors.New("not found") }

	_, err := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	}))
	if err != nil {
		t.Fatalf("install error: %#v", err)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("status=%q want succeeded", operation.Status)
	}
	if !strings.Contains(operation.Message, "Restart WheelMaker") || !strings.Contains(operation.Message, "not found") {
		t.Fatalf("message=%q want restart + not found", operation.Message)
	}
}

func TestNPMCommandBulkInstallMessageReportsMissingBinaries(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)
	cmd.lookPath = func(name string) (string, error) {
		if name == "claude" {
			return "/usr/local/bin/claude", nil
		}
		return "", errors.New("not found")
	}

	_, err := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":       "install_many",
		"hubId":        "hub-a",
		"packageNames": []string{"@openai/codex", "@anthropic-ai/claude-code"},
		"version":      "latest",
	}))
	if err != nil {
		t.Fatalf("bulk install error: %#v", err)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("status=%q want succeeded", operation.Status)
	}
	if !strings.Contains(operation.Message, "not found yet") || !strings.Contains(operation.Message, "codex") {
		t.Fatalf("message=%q want codex listed as not found yet", operation.Message)
	}
	if strings.Contains(operation.Message, "ready to use") {
		t.Fatalf("message should not claim ready when codex is missing: %q", operation.Message)
	}
}
