package flickerbridge

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResponsesToolsFlattenNamespacesForNonOpenAIUpstream(t *testing.T) {
	raw := []any{
		map[string]any{
			"type": "namespace",
			"name": "mcp__docs__",
			"tools": []any{map[string]any{
				"type":        "function",
				"name":        "search",
				"description": "Search docs",
				"parameters":  map[string]any{"type": "object"},
			}},
		},
		map[string]any{"type": "namespace", "name": "collaboration", "tools": []any{}},
	}

	tools, refs, err := responsesToolsToV3(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 1 {
		t.Fatalf("flattened tools = %#v, want one function", tools)
	}
	tool, _ := tools[0].(map[string]any)
	if firstText(tool["type"]) != "function" || firstText(tool["name"]) != "mcp__docs__search" {
		t.Fatalf("flattened tool = %#v", tool)
	}
	ref, ok := refs["mcp__docs__search"]
	if !ok || ref.Namespace != "mcp__docs__" || ref.Name != "search" {
		t.Fatalf("namespace ref = %#v, refs=%#v", ref, refs)
	}
}

func TestResponsesInputPreservesEncryptedReasoning(t *testing.T) {
	converted, err := responsesInputToV3([]any{map[string]any{
		"type":              "reasoning",
		"id":                "rs_previous",
		"encrypted_content": "encrypted-reasoning",
		"summary":           []any{},
	}}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(converted) != 1 {
		t.Fatalf("converted reasoning = %#v, want one assistant message", converted)
	}
	message, _ := converted[0].(map[string]any)
	content, _ := message["content"].([]any)
	part, _ := content[0].(map[string]any)
	if firstText(part["type"]) != "reasoning" || firstText(part["text"]) != "" {
		t.Fatalf("reasoning part = %#v", part)
	}
	metadata, _ := part["providerMetadata"].(map[string]any)
	azure, _ := metadata["azure"].(map[string]any)
	if firstText(azure["reasoningEncryptedContent"]) != "encrypted-reasoning" {
		t.Fatalf("reasoning metadata = %#v", part["providerMetadata"])
	}
}

func TestResponsesImageContentPreservesURLAndDetail(t *testing.T) {
	content, err := responsesContentToV3([]any{map[string]any{
		"type":      "input_image",
		"image_url": map[string]any{"url": "https://example.com/probe.png"},
		"detail":    "high",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(content) != 1 {
		t.Fatalf("converted image content = %#v", content)
	}
	part, _ := content[0].(map[string]any)
	if firstText(part["type"]) != "file" || firstText(part["mediaType"]) != "image/*" {
		t.Fatalf("image part = %#v", part)
	}
	urlValue, _ := part["data"].(map[string]any)
	if firstText(urlValue["__wheelmaker_url"]) != "https://example.com/probe.png" {
		t.Fatalf("image URL marker = %#v", part["data"])
	}
	providerOptions, _ := part["providerOptions"].(map[string]any)
	wanqing, _ := providerOptions["wanqing"].(map[string]any)
	if firstText(wanqing["imageDetail"]) != "high" {
		t.Fatalf("image detail options = %#v", part["providerOptions"])
	}
}

func TestResponsesRequestPassesProviderIncludeOptions(t *testing.T) {
	conversion, err := responsesRequestToV3(map[string]any{
		"model":   "deepseek-v4-flash-0731",
		"input":   "hello",
		"include": []any{"reasoning.encrypted_content"},
		"reasoning": map[string]any{
			"effort":  "high",
			"summary": "auto",
		},
		"service_tier":        "default",
		"parallel_tool_calls": false,
		"max_tool_calls":      3,
		"metadata":            map[string]any{"trace": "test"},
		"store":               false,
		"top_logprobs":        2,
	})
	if err != nil {
		t.Fatal(err)
	}
	providerOptions, _ := conversion.payload["providerOptions"].(map[string]any)
	wanqing, _ := providerOptions["wanqing"].(map[string]any)
	include, _ := wanqing["include"].([]any)
	maxToolCalls, _ := responseInteger(wanqing["maxToolCalls"])
	topLogprobs, _ := responseInteger(wanqing["topLogprobs"])
	if len(include) != 1 || firstText(include[0]) != "reasoning.encrypted_content" ||
		firstText(wanqing["reasoningSummary"]) != "auto" || firstText(wanqing["serviceTier"]) != "default" ||
		wanqing["parallelToolCalls"] != false || maxToolCalls != 3 ||
		wanqing["store"] != false || topLogprobs != 2 {
		t.Fatalf("Responses provider options = %#v", conversion.payload["providerOptions"])
	}
	metadata, _ := wanqing["metadata"].(map[string]any)
	if firstText(metadata["trace"]) != "test" || firstText(wanqing["reasoningEffort"]) != "high" {
		t.Fatalf("Responses provider metadata = %#v", conversion.payload["providerOptions"])
	}
}

func TestResponsesTextFormatConvertsStructuredOutput(t *testing.T) {
	conversion, err := responsesRequestToV3(map[string]any{
		"model": "deepseek-v4-flash-0731",
		"input": "return JSON",
		"text": map[string]any{
			"format": map[string]any{
				"type":        "json_schema",
				"name":        "answer",
				"description": "The answer object",
				"strict":      true,
				"schema":      map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	format, _ := conversion.payload["responseFormat"].(map[string]any)
	if firstText(format["type"]) != "json" || firstText(format["name"]) != "answer" ||
		firstText(format["description"]) != "The answer object" || format["strict"] != true || format["schema"] == nil {
		t.Fatalf("V3 response format = %#v", conversion.payload["responseFormat"])
	}
}

func TestResponsesProviderCallHistoryIncludesExtendedCallTypes(t *testing.T) {
	converted, err := responsesInputToV3([]any{
		map[string]any{"type": "mcp_call", "id": "mcp_1", "call_id": "call_mcp", "name": "docs", "arguments": "{}"},
		map[string]any{"type": "mcp_call_output", "call_id": "call_mcp", "output": "ok"},
		map[string]any{"type": "code_interpreter_call", "id": "code_1", "call_id": "call_code", "code": "print(1)"},
		map[string]any{"type": "code_interpreter_call_output", "call_id": "call_code", "output": "1"},
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(converted) != 4 {
		t.Fatalf("extended provider history = %#v", converted)
	}
	for index, role := range []string{"assistant", "tool", "assistant", "tool"} {
		message, _ := converted[index].(map[string]any)
		if firstText(message["role"]) != role {
			t.Fatalf("history[%d] = %#v, want role %q", index, message, role)
		}
	}
}

func TestV2ResponsesWriterPreservesEncryptedReasoning(t *testing.T) {
	writer := newV2ResponsesWriter(nil, "deepseek-v4-flash-0731", map[string]any{}, nil)
	for _, part := range []string{
		`{"type":"reasoning-start","id":"rs_1","providerMetadata":{"azure":{"reasoningEncryptedContent":"encrypted-reasoning"}}}`,
		`{"type":"reasoning-delta","id":"rs_1","delta":"summary","providerMetadata":{"azure":{"reasoningEncryptedContent":"encrypted-reasoning"}}}`,
		`{"type":"finish","finishReason":{"unified":"stop","raw":"stop"}}`,
	} {
		if err := writer.add(workerFrame{Type: "part", Part: json.RawMessage(part)}); err != nil {
			t.Fatal(err)
		}
	}
	response := writer.stop(false)
	items, _ := response["output"].([]any)
	if len(items) != 1 {
		t.Fatalf("writer output = %#v", response["output"])
	}
	reasoning, _ := items[0].(map[string]any)
	if firstText(reasoning["type"]) != "reasoning" || firstText(reasoning["encrypted_content"]) != "encrypted-reasoning" {
		t.Fatalf("writer reasoning item = %#v", reasoning)
	}
}

func TestV2ResponsesWriterEchoesResponseControls(t *testing.T) {
	writer := newV2ResponsesWriter(nil, "deepseek-v4-flash-0731", map[string]any{
		"metadata":            map[string]any{"trace": "test"},
		"user":                "user-1",
		"service_tier":        "default",
		"prompt_cache_key":    "cache-1",
		"max_tool_calls":      3,
		"parallel_tool_calls": false,
	}, nil)
	response := writer.stop(false)
	metadata, _ := response["metadata"].(map[string]any)
	if firstText(metadata["trace"]) != "test" || firstText(response["user"]) != "user-1" ||
		firstText(response["service_tier"]) != "default" || firstText(response["prompt_cache_key"]) != "cache-1" ||
		response["max_tool_calls"] != 3 || response["parallel_tool_calls"] != false {
		t.Fatalf("response controls = %#v", response)
	}
}

func TestV2ResponsesWriterMarksLengthAsIncomplete(t *testing.T) {
	writer := newV2ResponsesWriter(nil, "deepseek-v4-flash-0731", map[string]any{}, nil)
	for _, part := range []string{
		`{"type":"text-start","id":"text_1"}`,
		`{"type":"text-delta","id":"text_1","delta":"partial"}`,
		`{"type":"finish","finishReason":{"unified":"length","raw":"max_tokens"}}`,
	} {
		if err := writer.add(workerFrame{Type: "part", Part: json.RawMessage(part)}); err != nil {
			t.Fatal(err)
		}
	}
	response := writer.stop(false)
	if firstText(response["status"]) != "incomplete" {
		t.Fatalf("response status = %#v, want incomplete", response["status"])
	}
	incomplete, _ := response["incomplete_details"].(map[string]any)
	if firstText(incomplete["reason"]) != "max_output_tokens" {
		t.Fatalf("incomplete details = %#v", response["incomplete_details"])
	}
}

func TestV2ResponsesWriterMapsNestedUsage(t *testing.T) {
	writer := newV2ResponsesWriter(nil, "deepseek-v4-flash-0731", map[string]any{}, nil)
	for _, part := range []string{
		`{"type":"text-start","id":"text_usage"}`,
		`{"type":"text-delta","id":"text_usage","delta":"ok","logprobs":[{"token":"ok","logprob":-0.1}]}`,
		`{"type":"finish","finishReason":{"unified":"stop","raw":"stop"},"usage":{"inputTokens":{"total":7},"outputTokens":{"total":5,"reasoning":2}}}`,
	} {
		if err := writer.add(workerFrame{Type: "part", Part: json.RawMessage(part)}); err != nil {
			t.Fatal(err)
		}
	}
	response := writer.stop(false)
	usage, _ := response["usage"].(map[string]any)
	if usage["input_tokens"] != 7 || usage["output_tokens"] != 5 || usage["total_tokens"] != 12 {
		t.Fatalf("nested usage = %#v", usage)
	}
	outputDetails, _ := usage["output_tokens_details"].(map[string]any)
	if outputDetails["reasoning_tokens"] != 2 {
		t.Fatalf("nested reasoning usage = %#v", usage)
	}
	items, _ := response["output"].([]any)
	message, _ := items[0].(map[string]any)
	content, _ := message["content"].([]any)
	textPart, _ := content[0].(map[string]any)
	if textPart["logprobs"] == nil {
		t.Fatalf("response text part omitted logprobs: %#v", textPart)
	}
}

func TestV2ResponsesEndpointResolvesPreviousResponseHistory(t *testing.T) {
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
	post := func(body string) map[string]any {
		request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body))
		response := httptest.NewRecorder()
		proxy.Handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
		}
		var output map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &output); err != nil {
			t.Fatalf("decode response: %v; body=%s", err, response.Body.String())
		}
		return output
	}
	first := post(`{"model":"deepseek-v4-flash-0731","input":"first"}`)
	previousID := firstText(first["id"])
	if previousID == "" {
		t.Fatalf("first response has no id: %#v", first)
	}
	post(fmt.Sprintf(`{"model":"deepseek-v4-flash-0731","previous_response_id":%q,"input":"second"}`, previousID))

	payload, _ := worker.payload.(map[string]any)
	prompt, _ := payload["prompt"].([]any)
	if len(prompt) != 3 {
		t.Fatalf("resolved prompt = %#v, want previous user/assistant plus current user", prompt)
	}
	texts := make([]string, 0, len(prompt))
	for _, raw := range prompt {
		message, _ := raw.(map[string]any)
		content, _ := message["content"].([]any)
		if len(content) > 0 {
			texts = append(texts, firstText(content[0].(map[string]any)["text"]))
		}
	}
	if strings.Join(texts, ",") != "first,pong,second" {
		t.Fatalf("resolved prompt texts = %v", texts)
	}
}
