package protocol

import (
	"encoding/base64"
	"fmt"
)

const MaxTerminalEventBytes = 64 * 1024

type TerminalStatus string

const (
	TerminalStatusRunning TerminalStatus = "running"
	TerminalStatusExited  TerminalStatus = "exited"
	TerminalStatusError   TerminalStatus = "error"
)

type TerminalMetadata struct {
	TerminalID  string         `json:"terminalId"`
	RunID       string         `json:"runId"`
	HubID       string         `json:"hubId"`
	ProjectID   string         `json:"projectId"`
	ProjectName string         `json:"projectName"`
	InitialCWD  string         `json:"initialCwd"`
	Shell       string         `json:"shell"`
	Status      TerminalStatus `json:"status"`
	Cols        int            `json:"cols"`
	Rows        int            `json:"rows"`
	ExitCode    *int           `json:"exitCode,omitempty"`
	CreatedAt   string         `json:"createdAt"`
	ExitedAt    string         `json:"exitedAt,omitempty"`
}

type TerminalListResponse struct {
	Terminals []TerminalMetadata `json:"terminals"`
}

type TerminalCreateRequest struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

type TerminalCreateResponse struct {
	Terminal    TerminalMetadata `json:"terminal"`
	ResizeToken string           `json:"resizeToken"`
}

type TerminalGetRequest struct {
	TerminalID string `json:"terminalId"`
}

type TerminalGetResponse struct {
	Terminal    TerminalMetadata `json:"terminal"`
	SnapshotSeq uint64           `json:"snapshotSeq"`
	Snapshot    string           `json:"snapshot"`
}

type TerminalResizeRequest struct {
	TerminalID  string `json:"terminalId"`
	Cols        int    `json:"cols"`
	Rows        int    `json:"rows"`
	Claim       bool   `json:"claim,omitempty"`
	ResizeToken string `json:"resizeToken,omitempty"`
}

type TerminalResizeResponse struct {
	Terminal    TerminalMetadata `json:"terminal"`
	ResizeToken string           `json:"resizeToken,omitempty"`
}

type TerminalRefRequest struct {
	TerminalID string `json:"terminalId"`
}

type TerminalInputEvent struct {
	TerminalID string `json:"terminalId"`
	RunID      string `json:"runId"`
	Data       string `json:"data"`
}

type TerminalOutputEvent struct {
	TerminalID string `json:"terminalId"`
	RunID      string `json:"runId"`
	Seq        uint64 `json:"seq"`
	Data       string `json:"data"`
}

type TerminalChangedEvent struct {
	Change     string            `json:"change"`
	TerminalID string            `json:"terminalId"`
	Terminal   *TerminalMetadata `json:"terminal,omitempty"`
}

func DecodeTerminalData(value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("invalid terminal data: %w", err)
	}
	if len(decoded) > MaxTerminalEventBytes {
		return nil, fmt.Errorf("terminal data exceeds %d bytes", MaxTerminalEventBytes)
	}
	return decoded, nil
}
