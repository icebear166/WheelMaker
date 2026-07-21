package client

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	permissionTitleMaxBytes      = 512
	permissionDetailsMaxBytes    = 8 * 1024
	permissionOptionMaxCount     = 32
	permissionOptionIDMaxBytes   = 256
	permissionOptionNameMaxBytes = 512
	permissionOptionKindMaxBytes = 64
)

type pendingPermission struct {
	permissionID     string
	requestTurnIndex int64
	options          map[string]acp.SessionTurnPermissionOption
	requestContext   context.Context
	promptContext    context.Context
	result           chan acp.PermissionResult
}

type sessionPermissionState struct {
	mu       sync.Mutex
	pending  map[string]*pendingPermission
	resolved map[string]acp.PermissionResult
}

func (s *Session) SessionRequestPermission(ctx context.Context, _ int64, params acp.PermissionRequestParams) (acp.PermissionResult, error) {
	request, options, ok := s.normalizePermissionRequest(params)
	if !ok || s.viewSink == nil {
		return acp.PermissionResult{Outcome: "cancelled"}, nil
	}

	s.mu.Lock()
	promptCtx := s.prompt.ctx
	s.mu.Unlock()
	pending := &pendingPermission{
		permissionID:   request.PermissionID,
		options:        options,
		requestContext: ctx,
		promptContext:  promptCtx,
		result:         make(chan acp.PermissionResult, 1),
	}

	s.permissions.mu.Lock()
	s.permissions.ensureMaps()
	s.permissions.pending[pending.permissionID] = pending
	requestTurnIndex, err := s.viewSink.RecordPermissionRequest(ctx, s.acpSessionID, request)
	if err != nil {
		delete(s.permissions.pending, pending.permissionID)
		s.permissions.mu.Unlock()
		return acp.PermissionResult{}, err
	}
	pending.requestTurnIndex = requestTurnIndex
	s.permissions.mu.Unlock()

	if promptCtx == nil {
		select {
		case result := <-pending.result:
			return result, nil
		case <-ctx.Done():
			return s.cancelPermissionWait(pending.permissionID, false), nil
		}
	}
	select {
	case result := <-pending.result:
		return result, nil
	case <-promptCtx.Done():
		return s.cancelPermissionWait(pending.permissionID, false), nil
	case <-ctx.Done():
		result := s.cancelPermissionWait(pending.permissionID, true)
		return result, nil
	}
}

func (s *Session) RespondPermission(ctx context.Context, permissionID, optionID string) (acp.PermissionResult, error) {
	if permissionID == "" || optionID == "" {
		return acp.PermissionResult{}, permissionRequestError(acp.CodeInvalidArgument, "permissionId and optionId are required")
	}
	s.permissions.mu.Lock()
	defer s.permissions.mu.Unlock()
	s.permissions.ensureMaps()
	if resolved, ok := s.permissions.resolved[permissionID]; ok {
		if resolved.OptionID == optionID {
			return resolved, nil
		}
		return acp.PermissionResult{}, permissionRequestError(acp.CodeConflict, "permission was already answered with a different option")
	}
	pending := s.permissions.pending[permissionID]
	if pending == nil {
		return acp.PermissionResult{}, permissionRequestError(acp.CodeNotFound, "permission request is no longer pending")
	}
	if pending.requestContext != nil && pending.requestContext.Err() != nil {
		return acp.PermissionResult{}, permissionRequestError(acp.CodeConflict, "permission request is no longer active")
	}
	if pending.promptContext != nil && pending.promptContext.Err() != nil {
		return acp.PermissionResult{}, permissionRequestError(acp.CodeConflict, "permission prompt is no longer active")
	}
	option, ok := pending.options[optionID]
	if !ok {
		return acp.PermissionResult{}, permissionRequestError(acp.CodeInvalidArgument, "permission option is not valid for this request")
	}
	if s.viewSink == nil {
		return acp.PermissionResult{}, permissionRequestError(acp.CodeInternal, "permission recorder is unavailable")
	}
	result := acp.PermissionResult{Outcome: "selected", OptionID: optionID}
	_, err := s.viewSink.RecordPermissionResponse(ctx, s.acpSessionID, acp.SessionTurnPermissionResponse{
		PermissionID:     permissionID,
		RequestTurnIndex: pending.requestTurnIndex,
		Outcome:          result.Outcome,
		OptionID:         optionID,
		OptionName:       option.Name,
		RespondedAt:      time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return acp.PermissionResult{}, err
	}
	s.permissions.resolved[permissionID] = result
	delete(s.permissions.pending, permissionID)
	pending.result <- result
	return result, nil
}

func (s *Session) normalizePermissionRequest(params acp.PermissionRequestParams) (acp.SessionTurnPermissionRequest, map[string]acp.SessionTurnPermissionOption, bool) {
	if params.SessionID != s.acpSessionID || strings.TrimSpace(params.ToolCall.ToolCallID) == "" {
		return acp.SessionTurnPermissionRequest{}, nil, false
	}
	if len(params.Options) == 0 || len(params.Options) > permissionOptionMaxCount {
		return acp.SessionTurnPermissionRequest{}, nil, false
	}
	permissionID := "perm_" + uuid.NewString()
	title := strings.TrimSpace(params.ToolCall.Title)
	if title == "" {
		title = "Agent requests your decision"
	}
	title = truncateUTF8Bytes(title, permissionTitleMaxBytes)
	details := make([]string, 0, len(params.ToolCall.Content))
	for _, entry := range params.ToolCall.Content {
		if entry.Type != "content" || entry.Content == nil || entry.Content.Type != acp.ContentBlockTypeText {
			continue
		}
		text := strings.TrimSpace(entry.Content.Text)
		if text != "" {
			details = append(details, text)
		}
	}
	detailsText := truncateUTF8Bytes(strings.Join(details, "\n"), permissionDetailsMaxBytes)
	turnOptions := make([]acp.SessionTurnPermissionOption, 0, len(params.Options))
	optionMap := make(map[string]acp.SessionTurnPermissionOption, len(params.Options))
	for _, option := range params.Options {
		if strings.TrimSpace(option.OptionID) == "" || len(option.OptionID) > permissionOptionIDMaxBytes {
			return acp.SessionTurnPermissionRequest{}, nil, false
		}
		if _, exists := optionMap[option.OptionID]; exists {
			return acp.SessionTurnPermissionRequest{}, nil, false
		}
		normalized := acp.SessionTurnPermissionOption{
			OptionID: option.OptionID,
			Name:     truncateUTF8Bytes(strings.TrimSpace(option.Name), permissionOptionNameMaxBytes),
			Kind:     truncateUTF8Bytes(strings.TrimSpace(option.Kind), permissionOptionKindMaxBytes),
		}
		turnOptions = append(turnOptions, normalized)
		optionMap[option.OptionID] = normalized
	}
	return acp.SessionTurnPermissionRequest{
		PermissionID: permissionID,
		Title:        title,
		DetailsText:  detailsText,
		Options:      turnOptions,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}, optionMap, true
}

func (s *sessionPermissionState) ensureMaps() {
	if s.pending == nil {
		s.pending = map[string]*pendingPermission{}
	}
	if s.resolved == nil {
		s.resolved = map[string]acp.PermissionResult{}
	}
}

func (s *Session) cancelPermissionWait(permissionID string, cancelPrompt bool) acp.PermissionResult {
	result := acp.PermissionResult{Outcome: "cancelled"}
	s.permissions.mu.Lock()
	s.permissions.ensureMaps()
	if resolved, ok := s.permissions.resolved[permissionID]; ok {
		s.permissions.mu.Unlock()
		return resolved
	}
	delete(s.permissions.pending, permissionID)
	s.permissions.mu.Unlock()
	if cancelPrompt {
		_ = s.cancelPrompt()
	}
	return result
}

func (s *Session) cancelAllPendingPermissions() {
	result := acp.PermissionResult{Outcome: "cancelled"}
	s.permissions.mu.Lock()
	s.permissions.ensureMaps()
	pending := s.permissions.pending
	s.permissions.pending = map[string]*pendingPermission{}
	for _, request := range pending {
		select {
		case request.result <- result:
		default:
		}
	}
	s.permissions.mu.Unlock()
}

func truncateUTF8Bytes(value string, limit int) string {
	if limit <= 0 || value == "" {
		return ""
	}
	if len(value) <= limit {
		return value
	}
	end := limit
	for end > 0 && !utf8.ValidString(value[:end]) {
		end--
	}
	return value[:end]
}

func permissionRequestError(code, message string) error {
	return &acp.RegistryRequestError{Code: code, Message: fmt.Sprintf("permission response: %s", message)}
}
