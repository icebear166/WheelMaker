package flickerbridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestV2ResponsesEndpointStreamsResponseEvents(t *testing.T) {
	worker := &v2ResponsesCaptureWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "openai",
		Metadata: map[string]any{"effortLevels": []any{"low", "high"}, "defaultThinkingLevel": "high"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"instructions":"You are Codex.",
		"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}],
		"reasoning":{"effort":"high"},
		"max_output_tokens":32,
		"stream":true
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Header().Get("content-type"), "text/event-stream") {
		t.Fatalf("content type = %q, want event stream", response.Header().Get("content-type"))
	}
	body := response.Body.String()
	for _, expected := range []string{
		`"type":"response.created"`,
		`"type":"response.output_text.delta"`,
		`"delta":"pong"`,
		`"type":"response.completed"`,
		"data: [DONE]",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("stream body missing %q: %s", expected, body)
		}
	}
	if worker.effort != "high" {
		t.Fatalf("worker effort = %q, want high", worker.effort)
	}

	payload, ok := worker.payload.(map[string]any)
	if !ok {
		t.Fatalf("worker payload = %#v, want object", worker.payload)
	}
	prompt, ok := payload["prompt"].([]any)
	if !ok || len(prompt) != 2 {
		t.Fatalf("worker prompt = %#v, want instructions and user message", payload["prompt"])
	}
	instructionsContent, _ := prompt[0].(map[string]any)["content"].([]any)
	if firstText(prompt[0].(map[string]any)["role"]) != "system" || len(instructionsContent) != 1 ||
		firstText(instructionsContent[0].(map[string]any)["text"]) != "You are Codex." {
		t.Fatalf("instructions prompt = %#v", prompt[0])
	}
}

func TestV2ResponsesEndpointSupportsPreflight(t *testing.T) {
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, &v2ResponsesCaptureWorker{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodOptions, "/v1/responses", nil)
	request.Header.Set("Origin", "http://127.0.0.1")
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("preflight = status %d headers %#v body %s", response.Code, response.Header(), response.Body.String())
	}
}

func TestV2ResponsesEndpointConvertsFunctionItemsAndReturnsJSON(t *testing.T) {
	worker := &v2ResponsesCaptureWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":[
			{"type":"message","role":"user","content":[{"type":"input_text","text":"read a.txt"}]},
			{"type":"function_call","call_id":"call_1","name":"read","arguments":"{\"path\":\"a.txt\"}"},
			{"type":"function_call_output","call_id":"call_1","output":"contents"}
		],
		"tools":[{"type":"function","name":"read","description":"Read a file","parameters":{"type":"object"}}],
		"max_output_tokens":32
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var output map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, response.Body.String())
	}
	if firstText(output["status"]) != "completed" || firstText(output["model"]) != "deepseek-v4-flash-0731" {
		t.Fatalf("response = %#v", output)
	}

	payload, ok := worker.payload.(map[string]any)
	if !ok {
		t.Fatalf("worker payload = %#v, want object", worker.payload)
	}
	prompt, ok := payload["prompt"].([]any)
	if !ok || len(prompt) != 3 {
		t.Fatalf("worker prompt = %#v, want user/assistant/tool messages", payload["prompt"])
	}
	roles := make([]string, 0, len(prompt))
	for _, raw := range prompt {
		roles = append(roles, firstText(raw.(map[string]any)["role"]))
	}
	if strings.Join(roles, ",") != "user,assistant,tool" {
		t.Fatalf("prompt roles = %v", roles)
	}
	tools, ok := payload["tools"].([]any)
	if !ok || len(tools) != 1 || firstText(tools[0].(map[string]any)["name"]) != "read" {
		t.Fatalf("prompt tools = %#v", payload["tools"])
	}
}

func TestV2ResponsesEndpointConvertsCodexProviderTools(t *testing.T) {
	worker := &v2ResponsesCaptureWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":"use the available tools",
		"tools":[
			{"type":"function","name":"read","parameters":{"type":"object"}},
			{"type":"apply_patch"},
			{"type":"web_search_preview","search_context_size":"low"},
			{"type":"mcp","server_label":"docs","server_url":"https://example.com/mcp","require_approval":"never"}
		],
		"tool_choice":{"type":"apply_patch"}
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}

	payload, ok := worker.payload.(map[string]any)
	if !ok {
		t.Fatalf("worker payload = %#v, want object", worker.payload)
	}
	tools, ok := payload["tools"].([]any)
	if !ok || len(tools) != 4 {
		t.Fatalf("converted tools = %#v, want four tools", payload["tools"])
	}
	if firstText(tools[0].(map[string]any)["type"]) != "function" {
		t.Fatalf("function tool = %#v", tools[0])
	}
	for index, expectedID := range []string{"openai.apply_patch", "openai.web_search_preview", "openai.mcp"} {
		tool := tools[index+1].(map[string]any)
		if firstText(tool["type"]) != "provider" || firstText(tool["id"]) != expectedID {
			t.Fatalf("provider tool %d = %#v, want %q", index, tool, expectedID)
		}
	}
	toolChoice, ok := payload["toolChoice"].(map[string]any)
	if !ok || firstText(toolChoice["type"]) != "tool" || firstText(toolChoice["toolName"]) != "apply_patch" {
		t.Fatalf("provider tool choice = %#v", payload["toolChoice"])
	}
}

func TestV2ResponsesEndpointConvertsCodexProviderCallHistory(t *testing.T) {
	worker := &v2ResponsesCaptureWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":[
			{"type":"apply_patch_call","id":"patch_1","call_id":"call_patch","operation":{"type":"update_file","path":"a.txt"}},
			{"type":"apply_patch_call_output","call_id":"call_patch","status":"completed","output":{"status":"completed"}},
			{"type":"shell_call","id":"shell_1","call_id":"call_shell","action":{"commands":["Get-Location"]}},
			{"type":"shell_call_output","call_id":"call_shell","output":[{"stdout":"E:/workspace","stderr":"","outcome":{"type":"exit","exit_code":0}}]}
		]
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}

	payload, ok := worker.payload.(map[string]any)
	if !ok {
		t.Fatalf("worker payload = %#v, want object", worker.payload)
	}
	prompt, ok := payload["prompt"].([]any)
	if !ok || len(prompt) != 4 {
		t.Fatalf("prompt = %#v, want four provider history messages", payload["prompt"])
	}
	assistant, _ := prompt[0].(map[string]any)
	assistantContent, _ := assistant["content"].([]any)
	if firstText(assistant["role"]) != "assistant" || firstText(assistantContent[0].(map[string]any)["toolName"]) != "apply_patch" {
		t.Fatalf("apply_patch assistant history = %#v", prompt[0])
	}
	tool, _ := prompt[1].(map[string]any)
	toolContent, _ := tool["content"].([]any)
	if firstText(tool["role"]) != "tool" || firstText(toolContent[0].(map[string]any)["toolName"]) != "apply_patch" {
		t.Fatalf("apply_patch output history = %#v", prompt[1])
	}
	assistant, _ = prompt[2].(map[string]any)
	assistantContent, _ = assistant["content"].([]any)
	if firstText(assistantContent[0].(map[string]any)["toolName"]) != "shell" {
		t.Fatalf("shell assistant history = %#v", prompt[2])
	}
	tool, _ = prompt[3].(map[string]any)
	if firstText(tool["role"]) != "tool" {
		t.Fatalf("shell output history = %#v", prompt[3])
	}
}

func TestV2ResponsesEndpointStreamsFunctionCallItems(t *testing.T) {
	worker := &v2ResponsesToolWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":"read a.txt",
		"tools":[{"type":"function","name":"read","parameters":{"type":"object"}}],
		"stream":true
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, expected := range []string{
		`"type":"response.function_call_arguments.delta"`,
		`"delta":"{\"path\":\"a.txt\"}"`,
		`"type":"response.function_call_arguments.done"`,
		`"type":"function_call"`,
		`"name":"read"`,
		`"type":"response.completed"`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("stream body missing %q: %s", expected, body)
		}
	}
	if strings.Count(body, `"type":"response.function_call_arguments.delta"`) != 1 {
		t.Fatalf("tool arguments were emitted more than once: %s", body)
	}
}

func TestV2ResponsesEndpointStreamsCodexProviderCallItems(t *testing.T) {
	worker := &v2ResponsesProviderToolWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":"update a.txt",
		"tools":[{"type":"apply_patch"}],
		"stream":true
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, `"type":"apply_patch_call"`) {
		t.Fatalf("stream body missing apply_patch_call item: %s", body)
	}
	if strings.Contains(body, `"type":"function_call"`) {
		t.Fatalf("provider call was downgraded to function_call: %s", body)
	}
}

func TestV2ResponsesEndpointReturnsCompactionItem(t *testing.T) {
	worker := &v2ResponsesSummaryWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":[{"type":"compaction_trigger"}],
		"max_output_tokens":64
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var output map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, response.Body.String())
	}
	items, ok := output["output"].([]any)
	if !ok || len(items) != 1 || firstText(items[0].(map[string]any)["type"]) != "compaction" {
		t.Fatalf("response output = %#v, want one compaction item", output["output"])
	}
}

func TestV2ResponsesEndpointRejectsUnsupportedImageInput(t *testing.T) {
	worker := &v2ResponsesCaptureWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "openai",
		Metadata: map[string]any{"inputModalities": []any{"text"}},
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":[{"type":"message","role":"user","content":[{"type":"input_image","image_url":"https://example.com/image.png"}]}]
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "image") {
		t.Fatalf("status = %d, body = %s; want unsupported image error", response.Code, response.Body.String())
	}
	if worker.requestCount != 0 {
		t.Fatalf("worker request count = %d, want zero", worker.requestCount)
	}
}

func TestV2ResponsesEndpointRejectsAnthropicBackedModel(t *testing.T) {
	worker := &v2ResponsesCaptureWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "claude-sonnet", Name: "Claude Sonnet", APIFormat: "anthropic",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"claude-sonnet",
		"input":"hello"
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "does not support Responses") {
		t.Fatalf("status = %d, body = %s; want Responses capability error", response.Code, response.Body.String())
	}
	if worker.requestCount != 0 {
		t.Fatalf("worker request count = %d, want zero", worker.requestCount)
	}
}

func TestV2ResponsesEndpointReturnsOpenAIErrorForWorkerFailure(t *testing.T) {
	worker := &v2ResponsesErrorWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":"hello"
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "Wanqing worker request failed") {
		t.Fatalf("status = %d, body = %s; want provider error", response.Code, response.Body.String())
	}
	var output map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatalf("decode error response: %v; body=%s", err, response.Body.String())
	}
	errorObject, ok := output["error"].(map[string]any)
	if !ok || firstText(errorObject["type"]) != "api_error" {
		t.Fatalf("error envelope = %#v", output)
	}
}

func TestV2ResponsesEndpointKeepsOutputItemOrder(t *testing.T) {
	worker := &v2ResponsesMixedWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":"hello"
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var output map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, response.Body.String())
	}
	items, ok := output["output"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("output items = %#v, want message then reasoning", output["output"])
	}
	if firstText(items[0].(map[string]any)["type"]) != "message" || firstText(items[1].(map[string]any)["type"]) != "reasoning" {
		t.Fatalf("output item order = %#v, want message then reasoning", items)
	}
}

func TestV2ResponsesEndpointIncludesReasoningSummaryIndex(t *testing.T) {
	worker := &v2ResponsesMixedWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":"hello",
		"stream":true
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, event := range []string{
		`"type":"response.reasoning_summary_text.delta"`,
		`"type":"response.reasoning_summary_text.done"`,
	} {
		if !strings.Contains(body, event) {
			t.Fatalf("stream body missing %q: %s", event, body)
		}
	}
	if strings.Count(body, `"summary_index":0`) < 2 {
		t.Fatalf("reasoning events missing summary_index=0: %s", body)
	}
}

func TestV2ResponsesEndpointRejectsIncompleteWorkerStream(t *testing.T) {
	worker := &v2ResponsesIncompleteWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "deepseek-v4-flash-0731", Name: "DeepSeek-V4-Flash 0731", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"input":"hello"
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "finish") {
		t.Fatalf("status = %d, body = %s; want incomplete stream error", response.Code, response.Body.String())
	}
}

type v2ResponsesCaptureWorker struct {
	payload      any
	effort       string
	requestCount int
}

type v2ResponsesToolWorker struct{}

type v2ResponsesProviderToolWorker struct{}

func (*v2ResponsesToolWorker) Request(
	_ context.Context,
	_, _ string,
	_ any,
) (<-chan workerFrame, error) {
	frames := make(chan workerFrame, 8)
	for _, part := range []string{
		`{"type":"response-metadata","id":"resp_tool","modelId":"deepseek-v4-flash-0731"}`,
		`{"type":"tool-input-start","id":"call_1","toolCallId":"call_1","toolName":"read"}`,
		`{"type":"tool-input-delta","id":"call_1","delta":"{\"path\":\"a.txt\"}"}`,
		`{"type":"tool-input-end","id":"call_1"}`,
		`{"type":"tool-call","toolCallId":"call_1","toolName":"read","input":{"path":"a.txt"}}`,
		`{"type":"finish","finishReason":{"unified":"tool-calls","raw":"tool_use"},"usage":{"inputTokens":{"total":2},"outputTokens":{"total":4}}}`,
	} {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	return frames, nil
}

func (*v2ResponsesProviderToolWorker) Request(
	_ context.Context,
	_, _ string,
	_ any,
) (<-chan workerFrame, error) {
	frames := make(chan workerFrame, 8)
	for _, part := range []string{
		`{"type":"response-metadata","id":"resp_apply_patch","modelId":"deepseek-v4-flash-0731"}`,
		`{"type":"tool-input-start","id":"call_patch","toolCallId":"call_patch","toolName":"apply_patch"}`,
		`{"type":"tool-input-delta","id":"call_patch","delta":"{\"callId\":\"call_patch\",\"operation\":{\"type\":\"update_file\",\"path\":\"a.txt\",\"diff\":\"@@ -1 +1 @@\\n-old\\n+new\\n\"}}"}`,
		`{"type":"tool-call","toolCallId":"call_patch","toolName":"apply_patch","input":{"callId":"call_patch","operation":{"type":"update_file","path":"a.txt","diff":"@@ -1 +1 @@\n-old\n+new\n"}}}`,
		`{"type":"finish","finishReason":{"unified":"tool-calls","raw":"tool_use"}}`,
	} {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	return frames, nil
}

type v2ResponsesSummaryWorker struct{}

func (*v2ResponsesSummaryWorker) Request(
	_ context.Context,
	_, _ string,
	_ any,
) (<-chan workerFrame, error) {
	frames := make(chan workerFrame, 8)
	for _, part := range []string{
		`{"type":"response-metadata","id":"resp_compact","modelId":"deepseek-v4-flash-0731"}`,
		`{"type":"text-start","id":"summary"}`,
		`{"type":"text-delta","id":"summary","delta":"handoff summary"}`,
		`{"type":"text-end","id":"summary"}`,
		`{"type":"finish","finishReason":{"unified":"stop","raw":"stop"},"usage":{"inputTokens":{"total":4},"outputTokens":{"total":2}}}`,
	} {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	return frames, nil
}

func (worker *v2ResponsesCaptureWorker) Request(
	_ context.Context,
	_, effort string,
	payload any,
) (<-chan workerFrame, error) {
	worker.requestCount++
	worker.payload = payload
	worker.effort = effort
	frames := make(chan workerFrame, 8)
	for _, part := range []string{
		`{"type":"response-metadata","id":"resp_test","modelId":"deepseek-v4-flash-0731"}`,
		`{"type":"text-start","id":"text_1"}`,
		`{"type":"text-delta","id":"text_1","delta":"pong"}`,
		`{"type":"text-end","id":"text_1"}`,
		`{"type":"finish","finishReason":{"unified":"stop","raw":"stop"},"usage":{"inputTokens":{"total":2},"outputTokens":{"total":1}}}`,
	} {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	return frames, nil
}

type v2ResponsesErrorWorker struct{}

func (*v2ResponsesErrorWorker) Request(
	context.Context,
	string,
	string,
	any,
) (<-chan workerFrame, error) {
	frames := make(chan workerFrame, 1)
	frames <- workerFrame{Type: "error", Error: "provider boom"}
	close(frames)
	return frames, nil
}

type v2ResponsesMixedWorker struct{}

func (*v2ResponsesMixedWorker) Request(
	context.Context,
	string,
	string,
	any,
) (<-chan workerFrame, error) {
	frames := make(chan workerFrame, 8)
	for _, part := range []string{
		`{"type":"text-start","id":"text_1"}`,
		`{"type":"text-delta","id":"text_1","delta":"answer"}`,
		`{"type":"text-end","id":"text_1"}`,
		`{"type":"reasoning-start","id":"reason_1"}`,
		`{"type":"reasoning-delta","id":"reason_1","delta":"thought"}`,
		`{"type":"reasoning-end","id":"reason_1"}`,
		`{"type":"finish","finishReason":{"unified":"stop","raw":"stop"}}`,
	} {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	return frames, nil
}

type v2ResponsesIncompleteWorker struct{}

func (*v2ResponsesIncompleteWorker) Request(
	context.Context,
	string,
	string,
	any,
) (<-chan workerFrame, error) {
	frames := make(chan workerFrame, 2)
	frames <- workerFrame{Type: "part", Part: json.RawMessage(`{"type":"text-start","id":"text_1"}`)}
	frames <- workerFrame{Type: "part", Part: json.RawMessage(`{"type":"text-delta","id":"text_1","delta":"partial"}`)}
	close(frames)
	return frames, nil
}
