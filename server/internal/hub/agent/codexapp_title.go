package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	codexappTitleGenerationTimeout = 30 * time.Second
	codexappTitlePromptLimit       = 2000
	codexappTitleMaximumLength     = 36
	codexappTitleGenerationModel   = "gpt-5.6-luna"
)

const codexappTitleOutputSchema = `{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":36},"description":{"type":"string","minLength":1}},"required":["title","description"],"additionalProperties":false}`

type appServerTitleThreadStartParams struct {
	Model                      *string        `json:"model"`
	ModelProvider              *string        `json:"modelProvider"`
	AllowProviderModelFallback bool           `json:"allowProviderModelFallback"`
	CWD                        *string        `json:"cwd"`
	ApprovalPolicy             string         `json:"approvalPolicy"`
	Permissions                string         `json:"permissions"`
	RuntimeWorkspaceRoots      []string       `json:"runtimeWorkspaceRoots"`
	Config                     map[string]any `json:"config"`
	Personality                *string        `json:"personality"`
	Ephemeral                  bool           `json:"ephemeral"`
	ThreadSource               string         `json:"threadSource"`
	ExperimentalRawEvents      bool           `json:"experimentalRawEvents"`
	DynamicTools               []any          `json:"dynamicTools"`
	ServiceTier                *string        `json:"serviceTier"`
}

type appServerTitleTurnStartParams struct {
	ThreadID              string               `json:"threadId"`
	Input                 []appServerUserInput `json:"input"`
	CWD                   *string              `json:"cwd"`
	Model                 *string              `json:"model"`
	Effort                *string              `json:"effort"`
	ApprovalPolicy        *string              `json:"approvalPolicy"`
	Permissions           string               `json:"permissions"`
	RuntimeWorkspaceRoots []string             `json:"runtimeWorkspaceRoots"`
	ServiceTier           *string              `json:"serviceTier"`
	Summary               string               `json:"summary"`
	OutputSchema          json.RawMessage      `json:"outputSchema"`
}

type appServerThreadNameSetParams struct {
	ThreadID string `json:"threadId"`
	Name     string `json:"name"`
}

type codexappTitleNotification struct {
	method string
	params json.RawMessage
}

type codexappTitleErrorParams struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId,omitempty"`
	Error    struct {
		Message           string `json:"message,omitempty"`
		AdditionalDetails string `json:"additionalDetails,omitempty"`
	} `json:"error"`
}

type codexappGeneratedTitle struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

func (c *codexappConn) generateAndSetTitle(ctx context.Context, threadID string, prompt string) error {
	if c == nil || c.runtime == nil {
		return errors.New("codexapp title generation runtime is not ready")
	}
	title, err := c.runtime.generateTitle(ctx, c.cwd, prompt)
	if err != nil {
		return err
	}
	var ignored json.RawMessage
	return c.runtime.request(ctx, "thread/name/set", appServerThreadNameSetParams{
		ThreadID: threadID,
		Name:     title,
	}, &ignored)
}

func (c *codexappConn) setAutoTitleEligibility(eligible bool) {
	if c == nil {
		return
	}
	eligible = eligible && c.profile.Provider == protocol.ACPProviderCodex
	c.mu.Lock()
	previousCancel := c.autoTitleCancel
	c.autoTitleCancel = nil
	c.autoTitleRun++
	c.autoTitleEligible = eligible
	c.autoTitleStarted = false
	c.mu.Unlock()
	if previousCancel != nil {
		previousCancel()
	}
}

func (c *codexappConn) cancelAutoTitleGeneration() {
	if c == nil {
		return
	}
	c.mu.Lock()
	cancel := c.autoTitleCancel
	c.autoTitleCancel = nil
	c.autoTitleRun++
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (c *codexappConn) startAutoTitleGeneration(threadID string, input []appServerUserInput) {
	if c == nil {
		return
	}
	prompt := codexappTitleSourcePrompt(input)
	if strings.TrimSpace(prompt) == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), codexappTitleGenerationTimeout)
	c.mu.Lock()
	if !c.autoTitleEligible || c.autoTitleStarted {
		c.mu.Unlock()
		cancel()
		return
	}
	c.autoTitleStarted = true
	c.autoTitleCancel = cancel
	run := c.autoTitleRun + 1
	c.autoTitleRun = run
	c.mu.Unlock()

	go func() {
		defer func() {
			cancel()
			c.mu.Lock()
			if c.autoTitleRun == run {
				c.autoTitleCancel = nil
			}
			c.mu.Unlock()
		}()
		_ = c.generateAndSetTitle(ctx, threadID, prompt)
	}()
}

func codexappTitleSourcePrompt(input []appServerUserInput) string {
	parts := make([]string, 0, len(input))
	for _, item := range input {
		if item.Type == "text" && strings.TrimSpace(item.Text) != "" {
			parts = append(parts, item.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func (r *codexappRuntime) generateTitle(ctx context.Context, cwd string, prompt string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", errors.New("codexapp title prompt is empty")
	}
	prompt = codexappLimitTitlePrompt(prompt)
	titleCtx, cancel := context.WithTimeout(ctx, codexappTitleGenerationTimeout)
	defer cancel()

	var threadResponse appServerThreadStartResponse
	if err := r.request(titleCtx, "thread/start", appServerTitleThreadStartParams{
		Model:                      codexappOptionalString(codexappTitleGenerationModel),
		CWD:                        codexappOptionalString(cwd),
		ApprovalPolicy:             "never",
		Permissions:                ":read-only",
		RuntimeWorkspaceRoots:      []string{},
		Config:                     codexappTitleGenerationConfig(),
		Ephemeral:                  true,
		ThreadSource:               "system",
		AllowProviderModelFallback: true,
		ExperimentalRawEvents:      false,
		DynamicTools:               []any{},
	}, &threadResponse); err != nil {
		return "", err
	}
	titleThreadID := strings.TrimSpace(threadResponse.Thread.ID)
	if titleThreadID == "" {
		return "", errors.New("codexapp title thread/start returned empty thread id")
	}

	notifications := make(chan codexappTitleNotification, 32)
	unregister := r.registerThreadNotificationHandler(titleThreadID, func(method string, params json.RawMessage) {
		select {
		case notifications <- codexappTitleNotification{method: method, params: params}:
		case <-titleCtx.Done():
		}
	})
	defer unregister()

	turnID := ""
	completed := false
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), codexappCancelCompletionTimeout)
		defer cleanupCancel()
		if !completed && turnID != "" {
			var ignored json.RawMessage
			_ = r.request(cleanupCtx, "turn/interrupt", appServerTurnInterruptParams{ThreadID: titleThreadID, TurnID: turnID}, &ignored)
		}
		var ignored json.RawMessage
		_ = r.request(cleanupCtx, "thread/unsubscribe", map[string]string{"threadId": titleThreadID}, &ignored)
	}()

	var turnResponse appServerTurnStartResponse
	if err := r.request(titleCtx, "turn/start", appServerTitleTurnStartParams{
		ThreadID:              titleThreadID,
		Input:                 []appServerUserInput{{Type: "text", Text: codexappTitleGenerationPrompt(prompt), TextElements: []any{}}},
		CWD:                   nil,
		Model:                 nil,
		Effort:                nil,
		ApprovalPolicy:        nil,
		Permissions:           ":read-only",
		RuntimeWorkspaceRoots: []string{},
		ServiceTier:           nil,
		Summary:               "none",
		OutputSchema:          json.RawMessage(codexappTitleOutputSchema),
	}, &turnResponse); err != nil {
		return "", err
	}
	turnID = strings.TrimSpace(turnResponse.Turn.ID)

	var message strings.Builder
	for {
		select {
		case notification := <-notifications:
			switch notification.method {
			case "turn/started":
				var params appServerTurnEventParams
				if json.Unmarshal(notification.params, &params) == nil && turnID == "" {
					turnID = params.turnID()
				}
			case "error":
				var params codexappTitleErrorParams
				if json.Unmarshal(notification.params, &params) == nil && params.ThreadID == titleThreadID && (params.TurnID == "" || params.TurnID == turnID) {
					message := strings.TrimSpace(strings.Join([]string{params.Error.Message, params.Error.AdditionalDetails}, " "))
					if message == "" {
						message = "structured title turn failed"
					}
					return "", errors.New(message)
				}
			case "item/agentMessage/delta":
				var params appServerAgentMessageDeltaParams
				if json.Unmarshal(notification.params, &params) == nil && params.ThreadID == titleThreadID && (params.TurnID == "" || params.TurnID == turnID) {
					message.WriteString(params.Delta)
				}
			case "item/completed":
				var params appServerItemEventParams
				if json.Unmarshal(notification.params, &params) == nil && params.ThreadID == titleThreadID && (params.TurnID == "" || params.TurnID == turnID) && params.Item.Type == "agentMessage" {
					if strings.TrimSpace(params.Item.Text) != "" {
						message.Reset()
						message.WriteString(params.Item.Text)
					}
				}
			case "turn/completed":
				var params appServerTurnCompletedParams
				if json.Unmarshal(notification.params, &params) != nil || params.ThreadID != titleThreadID || (turnID != "" && params.turnID() != turnID) {
					continue
				}
				if params.status() != "completed" {
					return "", fmt.Errorf("codexapp title turn ended with status %q", params.status())
				}
				completed = true
				return codexappParseGeneratedTitle(message.String())
			}
		case <-titleCtx.Done():
			return "", titleCtx.Err()
		case <-r.done:
			return "", errors.New("codexapp runtime stopped during title generation")
		}
	}
}

func codexappOptionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func codexappTitleGenerationConfig() map[string]any {
	return map[string]any{
		"features.enable_fanout":  false,
		"features.hooks":          false,
		"features.multi_agent":    false,
		"features.multi_agent_v2": false,
		"features.plugins":        false,
		"features.tool_suggest":   false,
		"model_reasoning_effort":  "low",
		"web_search":              "disabled",
	}
}

func codexappTitleGenerationPrompt(prompt string) string {
	return strings.Join([]string{
		"You are a helpful assistant. You will be presented with a user prompt, and your job is to provide a short title for a task that will be created from that prompt.",
		"The tasks typically have to do with coding-related tasks, for example requests for bug fixes or questions about a codebase. The title you generate will be shown in the UI to represent the prompt.",
		"Generate a concise UI title (up to 36 characters) for this task.",
		"Fill the structured title field with plain text.",
		"Fill the structured description field with a compact, search-oriented summary (up to 100 characters). Include concrete project names, code areas, artifacts, people, or recurring responsibility terms when relevant so the thread is easy to retrieve by keyword.",
		"Do not include quotes, markdown, formatting characters, or trailing punctuation in either value.",
		"If the task includes a ticket reference (e.g. ABC-123), include it verbatim.",
		"",
		"Generate a clear, informative task title based solely on the prompt provided. Follow the rules below to ensure consistency, readability, and usefulness.",
		"",
		"How to write a good title:",
		"Generate a single-line title that captures the question or core change requested. The title should be easy to scan and useful in changelogs or review queues.",
		`- Use an imperative verb first: "Add", "Fix", "Update", "Refactor", "Remove", "Locate", "Find", etc.`,
		"- Keep it under 36 characters and under 5 words where possible.",
		"- If the user's prompt is already a short clear title, reuse it verbatim.",
		"- Capitalize only the first word (unless locale requires otherwise).",
		"- Write the title in the user's locale.",
		"- Do not use punctuation at the end.",
		"- Output the title as plain text with no surrounding quotes or backticks.",
		"- Use precise, non-redundant language.",
		`- Translate fixed phrases into the user's locale (e.g., "Fix bug" -> "Corrige el error" in Spanish-ES), but leave code terms in English unless a widely adopted translation exists.`,
		`- If the user provides a title explicitly, reuse it (translated if needed) and skip generation logic.`,
		`- Make it clear when the user is requesting changes (use verbs like "Fix", "Add", etc) vs asking a question (use verbs like "Find", "Locate", "Count").`,
		"- Before writing the title, determine whether the prompt describes the task's subject specifically or merely points to an opaque resource.",
		"- Do NOT respond to the user, answer questions, or attempt to solve the problem; just write a title that can represent the user's query.",
		"",
		"Examples:",
		`- User: "Can we add dark-mode support to the settings page?" -> Add dark-mode support`,
		`- User: "Fehlerbehebung: Beim Anmelden erscheint 500." (de-DE) -> Login-Fehler 500 beheben`,
		`- User: "Refactoriser le composant sidebar pour réduire le code dupliqué." (fr-FR) -> Refactoriser composant sidebar`,
		`- User: "How do I fix our login bug?" -> Troubleshoot login bug`,
		`- User: "Where in the codebase is foo_bar created" -> Locate foo_bar`,
		`- User: "what's 2+2" -> Calculate 2+2`,
		"",
		"By following these conventions, your titles will be readable, changelog-friendly, and helpful to both users and downstream tools.",
		"",
		"User prompt:",
		prompt,
	}, "\n")
}

func codexappLimitTitlePrompt(prompt string) string {
	runes := []rune(prompt)
	if len(runes) > codexappTitlePromptLimit {
		return string(runes[:codexappTitlePromptLimit])
	}
	return prompt
}

func codexappParseGeneratedTitle(raw string) (string, error) {
	var generated codexappGeneratedTitle
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &generated); err != nil {
		return "", fmt.Errorf("decode generated title: %w", err)
	}
	if strings.TrimSpace(generated.Description) == "" {
		return "", errors.New("generated title description is empty")
	}
	title := strings.ReplaceAll(generated.Title, "\r\n", "\n")
	for _, line := range strings.Split(title, "\n") {
		if strings.TrimSpace(line) != "" {
			title = strings.TrimSpace(line)
			break
		}
	}
	if strings.HasPrefix(strings.ToLower(title), "title:") {
		title = strings.TrimSpace(title[len("title:"):])
	}
	title = strings.Trim(title, "`\"'“”‘’")
	title = strings.Join(strings.Fields(title), " ")
	title = strings.TrimRight(title, ".?!")
	title = strings.TrimSpace(title)
	if title == "" {
		return "", errors.New("generated title is empty")
	}
	if runes := []rune(title); len(runes) > codexappTitleMaximumLength {
		title = strings.TrimRight(string(runes[:codexappTitleMaximumLength-1]), " ") + "…"
	}
	return title, nil
}
