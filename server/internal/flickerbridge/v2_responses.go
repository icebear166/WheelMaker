package flickerbridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type v2ResponsesRequestConversion struct {
	payload    map[string]any
	effort     string
	compaction bool
}

func responsesRequestToV3(request map[string]any) (v2ResponsesRequestConversion, error) {
	model := firstText(request["model"])
	if model == "" {
		return v2ResponsesRequestConversion{}, errors.New("model is required")
	}

	prompt := make([]any, 0)
	if instructions := request["instructions"]; instructions != nil {
		converted, err := responsesInstructionsToV3(instructions)
		if err != nil {
			return v2ResponsesRequestConversion{}, err
		}
		prompt = append(prompt, converted...)
	}

	input, ok := request["input"]
	if !ok || input == nil {
		return v2ResponsesRequestConversion{}, errors.New("input is required")
	}
	callNames := responsesFunctionCallNames(input)
	compaction := false
	convertedInput, err := responsesInputToV3(input, callNames, &compaction)
	if err != nil {
		return v2ResponsesRequestConversion{}, err
	}
	prompt = append(prompt, convertedInput...)
	if len(prompt) == 0 {
		return v2ResponsesRequestConversion{}, errors.New("input must not be empty")
	}

	payload := map[string]any{
		"prompt": prompt,
	}
	if maxTokens, ok := responseInteger(request["max_output_tokens"]); ok {
		if maxTokens <= 0 {
			return v2ResponsesRequestConversion{}, errors.New("max_output_tokens must be a positive integer")
		}
		payload["maxOutputTokens"] = maxTokens
	}
	if value := request["temperature"]; value != nil {
		payload["temperature"] = value
	}
	if value := request["top_p"]; value != nil {
		payload["topP"] = value
	}
	if value := request["top_k"]; value != nil {
		payload["topK"] = value
	}
	if value := request["stop"]; value != nil {
		payload["stopSequences"] = value
	}
	if rawTools, ok := request["tools"]; ok && rawTools != nil {
		tools, err := responsesToolsToV3(rawTools)
		if err != nil {
			return v2ResponsesRequestConversion{}, err
		}
		payload["tools"] = tools
	}
	if value := request["tool_choice"]; value != nil {
		toolChoice, err := responsesToolChoiceToV3(value)
		if err != nil {
			return v2ResponsesRequestConversion{}, err
		}
		payload["toolChoice"] = toolChoice
	}
	if format := request["text"]; format != nil {
		payload["responseFormat"] = deepCopyJSON(format)
	}

	effort := firstText(request["reasoning_effort"])
	if reasoning, ok := request["reasoning"].(map[string]any); ok {
		effort = firstText(reasoning["effort"], effort)
	}
	return v2ResponsesRequestConversion{payload: payload, effort: strings.TrimSpace(effort), compaction: compaction}, nil
}

func responsesInstructionsToV3(raw any) ([]any, error) {
	if text, ok := raw.(string); ok {
		return []any{map[string]any{"role": "system", "content": v3TextContent(text)}}, nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, errors.New("instructions must be a string or text array")
	}
	result := make([]any, 0, len(items))
	for _, item := range items {
		text := firstText(item)
		if object, ok := item.(map[string]any); ok {
			text = firstText(object["text"], object["content"])
		}
		if text == "" {
			return nil, errors.New("instructions text must not be empty")
		}
		result = append(result, map[string]any{"role": "system", "content": v3TextContent(text)})
	}
	return result, nil
}

func responsesFunctionCallNames(raw any) map[string]string {
	result := map[string]string{}
	items, _ := raw.([]any)
	for _, rawItem := range items {
		item, _ := rawItem.(map[string]any)
		if firstText(item["type"]) != "function_call" {
			continue
		}
		callID := firstText(item["call_id"], item["id"])
		name := firstText(item["name"])
		if callID != "" && name != "" {
			result[callID] = name
		}
	}
	return result
}

func responsesInputToV3(raw any, callNames map[string]string, compaction *bool) ([]any, error) {
	if text, ok := raw.(string); ok {
		return []any{map[string]any{"role": "user", "content": v3TextContent(text)}}, nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, errors.New("input must be a string or array")
	}
	result := make([]any, 0, len(items))
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil, errors.New("input items must be objects")
		}
		typeName := firstText(item["type"], "message")
		switch typeName {
		case "message":
			message, err := responsesMessageItemToV3(item)
			if err != nil {
				return nil, err
			}
			result = append(result, message)
		case "function_call":
			callID := firstText(item["call_id"], item["id"])
			if callID == "" {
				return nil, errors.New("function_call requires call_id")
			}
			name := firstText(item["name"])
			if name == "" {
				return nil, errors.New("function_call requires name")
			}
			input, err := responseJSONValue(item["arguments"], map[string]any{})
			if err != nil {
				return nil, fmt.Errorf("function_call %q arguments: %w", callID, err)
			}
			result = append(result, map[string]any{
				"role": "assistant",
				"content": []any{map[string]any{
					"type":       "tool-call",
					"toolCallId": callID,
					"toolName":   name,
					"input":      input,
				}},
			})
		case "function_call_output":
			callID := firstText(item["call_id"], item["id"])
			if callID == "" {
				return nil, errors.New("function_call_output requires call_id")
			}
			output := responsesToolResultOutput(item["output"])
			result = append(result, map[string]any{
				"role": "tool",
				"content": []any{map[string]any{
					"type":       "tool-result",
					"toolCallId": callID,
					"toolName":   callNames[callID],
					"output":     output,
				}},
			})
		case "apply_patch_call", "shell_call", "local_shell_call", "mcp_call", "file_search_call", "code_interpreter_call", "image_generation_call", "custom_tool_call", "web_search_call", "tool_search_call":
			message, err := responsesProviderCallToV3(item)
			if err != nil {
				return nil, err
			}
			result = append(result, message)
		case "apply_patch_call_output", "shell_call_output", "local_shell_call_output", "custom_tool_call_output":
			message, err := responsesProviderOutputToV3(item)
			if err != nil {
				return nil, err
			}
			result = append(result, message)
		case "reasoning":
			message, err := responsesReasoningItemToV3(item)
			if err != nil {
				return nil, err
			}
			result = append(result, message)
		case "compaction_trigger":
			if compaction != nil {
				*compaction = true
			}
			result = append(result, map[string]any{"role": "user", "content": v3TextContent(codexCompactionPrompt)})
		case "compaction":
			if summary, ok := decodeMyFlickerCompaction(firstText(item["encrypted_content"])); ok {
				result = append(result, map[string]any{"role": "system", "content": v3TextContent(myFlickerCompactionContextHeader + summary)})
			}
		default:
			return nil, fmt.Errorf("unsupported Responses input item type %q", typeName)
		}
	}
	return result, nil
}

func v3TextContent(text string) []any {
	return []any{map[string]any{"type": "text", "text": text}}
}

func responsesMessageItemToV3(item map[string]any) (map[string]any, error) {
	role := firstText(item["role"], "user")
	if role == "developer" {
		role = "system"
	}
	if role != "user" && role != "assistant" && role != "system" {
		return nil, fmt.Errorf("unsupported Responses message role %q", role)
	}
	content, err := responsesContentToV3(item["content"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"role": role, "content": content}, nil
}

func responsesContentToV3(raw any) ([]any, error) {
	if text, ok := raw.(string); ok {
		return []any{map[string]any{"type": "text", "text": text}}, nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, errors.New("Responses message content must be a string or array")
	}
	result := make([]any, 0, len(items))
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil, errors.New("Responses content items must be objects")
		}
		typeName := firstText(item["type"])
		switch typeName {
		case "input_text", "output_text", "text", "refusal":
			result = append(result, map[string]any{"type": "text", "text": firstText(item["text"], item["content"])})
		case "input_image":
			file, err := responsesFilePart(item, "image/*")
			if err != nil {
				return nil, err
			}
			result = append(result, file)
		case "input_file":
			file, err := responsesFilePart(item, "application/octet-stream")
			if err != nil {
				return nil, err
			}
			result = append(result, file)
		default:
			return nil, fmt.Errorf("unsupported Responses content type %q", typeName)
		}
	}
	return result, nil
}

func responsesInputModalities(raw any) []string {
	seen := map[string]struct{}{}
	modalities := make([]string, 0, 2)
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case []any:
			for _, item := range typed {
				visit(item)
			}
		case map[string]any:
			typeName := firstText(typed["type"])
			switch typeName {
			case "input_image":
				if _, ok := seen["image"]; !ok {
					seen["image"] = struct{}{}
					modalities = append(modalities, "image")
				}
			case "input_file":
				if _, ok := seen["file"]; !ok {
					seen["file"] = struct{}{}
					modalities = append(modalities, "file")
				}
			}
			if content, ok := typed["content"]; ok {
				visit(content)
			}
		}
	}
	visit(raw)
	return modalities
}

func modelSupportsResponsesModality(model modelInfo, modality string) bool {
	metadata := model.Metadata
	if metadata == nil {
		return false
	}
	if modality == "image" && metadata["supportsImages"] == true {
		return true
	}
	if modality == "file" && metadata["supportsFiles"] == true {
		return true
	}
	raw := metadata["inputModalities"]
	if raw == nil {
		raw = metadata["input_modalities"]
	}
	var values []string
	switch typed := raw.(type) {
	case []string:
		values = typed
	case []any:
		for _, value := range typed {
			if text, ok := value.(string); ok {
				values = append(values, text)
			}
		}
	case string:
		values = []string{typed}
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), modality) {
			return true
		}
	}
	return false
}

func validateResponsesModelInput(model modelInfo, raw any) error {
	for _, modality := range responsesInputModalities(raw) {
		if !modelSupportsResponsesModality(model, modality) {
			return fmt.Errorf("model %q does not support %s input", model.ID, modality)
		}
	}
	return nil
}

func responsesFilePart(item map[string]any, defaultMediaType string) (map[string]any, error) {
	value := firstText(item["image_url"], item["file_url"], item["file_data"], item["url"], item["data"])
	if value == "" {
		return nil, errors.New("Responses file content requires a URL or data")
	}
	mediaType := firstText(item["media_type"], defaultMediaType)
	if strings.HasPrefix(value, "data:") {
		comma := strings.IndexByte(value, ',')
		if comma <= len("data:") {
			return nil, errors.New("invalid Responses data URL")
		}
		header := value[len("data:"):comma]
		data := value[comma+1:]
		parts := strings.Split(header, ";")
		if parts[0] != "" {
			mediaType = parts[0]
		}
		if len(parts) < 2 || parts[len(parts)-1] != "base64" {
			return nil, errors.New("Responses file data URL must be base64 encoded")
		}
		value = data
	}
	return map[string]any{"type": "file", "mediaType": mediaType, "data": value}, nil
}

func responsesReasoningItemToV3(item map[string]any) (map[string]any, error) {
	summary, _ := item["summary"].([]any)
	parts := make([]any, 0, len(summary))
	for _, raw := range summary {
		part, _ := raw.(map[string]any)
		text := firstText(part["text"])
		if text != "" {
			parts = append(parts, map[string]any{"type": "reasoning", "text": text})
		}
	}
	if len(parts) == 0 {
		return nil, errors.New("reasoning item has no summary text")
	}
	return map[string]any{"role": "assistant", "content": parts}, nil
}

func responsesToolsToV3(raw any) ([]any, error) {
	items, ok := raw.([]any)
	if !ok {
		return nil, errors.New("tools must be an array")
	}
	result := make([]any, 0, len(items))
	for _, rawTool := range items {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			return nil, errors.New("tools must contain objects")
		}
		if firstText(tool["type"]) != "function" {
			providerID, supported := responsesProviderToolID(firstText(tool["type"]))
			if !supported {
				return nil, fmt.Errorf("unsupported Responses tool type %q", firstText(tool["type"]))
			}
			args := map[string]any{}
			for key, value := range tool {
				if key != "type" {
					args[key] = deepCopyJSON(value)
				}
			}
			result = append(result, map[string]any{"type": "provider", "id": providerID, "args": args})
			continue
		}
		name := firstText(tool["name"])
		description := firstText(tool["description"])
		parameters := tool["parameters"]
		if parameters == nil {
			if function, ok := tool["function"].(map[string]any); ok {
				name = firstText(name, function["name"])
				description = firstText(description, function["description"])
				parameters = function["parameters"]
			}
		}
		if name == "" {
			return nil, errors.New("function tool requires name")
		}
		if parameters == nil {
			parameters = map[string]any{}
		}
		converted := map[string]any{
			"type":        "function",
			"name":        name,
			"description": description,
			"inputSchema": deepCopyJSON(parameters),
		}
		if strict := tool["strict"]; strict != nil {
			converted["strict"] = strict
		}
		result = append(result, converted)
	}
	return result, nil
}

func responsesProviderToolID(typeName string) (string, bool) {
	providerID, ok := map[string]string{
		"file_search":        "openai.file_search",
		"local_shell":        "openai.local_shell",
		"shell":              "openai.shell",
		"apply_patch":        "openai.apply_patch",
		"web_search_preview": "openai.web_search_preview",
		"web_search":         "openai.web_search",
		"code_interpreter":   "openai.code_interpreter",
		"image_generation":   "openai.image_generation",
		"mcp":                "openai.mcp",
		"custom":             "openai.custom",
		"tool_search":        "openai.tool_search",
	}[typeName]
	return providerID, ok
}

func responsesProviderToolTypes(raw any) map[string]string {
	result := map[string]string{}
	items, _ := raw.([]any)
	for _, rawTool := range items {
		tool, _ := rawTool.(map[string]any)
		typeName := firstText(tool["type"])
		if typeName == "" || typeName == "function" {
			continue
		}
		responseType := responsesProviderResponseItemType(typeName)
		if responseType == "custom_tool_call" {
			if args, ok := tool["name"].(string); ok && strings.TrimSpace(args) != "" {
				result[strings.TrimSpace(args)] = responseType
			}
			if args, ok := tool["args"].(map[string]any); ok {
				if name := firstText(args["name"]); name != "" {
					result[name] = responseType
				}
			}
			continue
		}
		if responseType != "" {
			result[typeName] = responseType
		}
	}
	return result
}

func responsesProviderResponseItemType(typeName string) string {
	switch strings.TrimSpace(typeName) {
	case "apply_patch", "openai.apply_patch":
		return "apply_patch_call"
	case "shell", "openai.shell":
		return "shell_call"
	case "local_shell", "openai.local_shell":
		return "local_shell_call"
	case "mcp", "openai.mcp":
		return "mcp_call"
	case "file_search", "openai.file_search":
		return "file_search_call"
	case "code_interpreter", "openai.code_interpreter":
		return "code_interpreter_call"
	case "image_generation", "openai.image_generation":
		return "image_generation_call"
	case "web_search", "web_search_preview", "openai.web_search", "openai.web_search_preview":
		return "web_search_call"
	case "tool_search", "openai.tool_search":
		return "tool_search_call"
	case "custom", "openai.custom":
		return "custom_tool_call"
	case "computer_use", "computer_use_preview", "openai.computer_use_preview":
		return "computer_call"
	default:
		if strings.HasPrefix(typeName, "mcp.") {
			return "mcp_call"
		}
		return ""
	}
}

func responsesToolChoiceToV3(raw any) (any, error) {
	if text, ok := raw.(string); ok {
		switch text {
		case "auto", "none", "required":
			return map[string]any{"type": text}, nil
		default:
			if _, supported := responsesProviderToolID(text); supported {
				return map[string]any{"type": "tool", "toolName": text}, nil
			}
			return nil, fmt.Errorf("unsupported tool_choice %q", text)
		}
	}
	choice, ok := raw.(map[string]any)
	if !ok {
		return nil, errors.New("tool_choice must be a string or object")
	}
	choiceType := firstText(choice["type"])
	if _, supported := responsesProviderToolID(choiceType); supported {
		toolName := choiceType
		if choiceType == "custom" {
			toolName = firstText(choice["name"])
		}
		if toolName == "" {
			return nil, errors.New("provider tool_choice requires a tool name")
		}
		return map[string]any{"type": "tool", "toolName": toolName}, nil
	}
	if choiceType != "function" {
		return nil, fmt.Errorf("unsupported tool_choice type %q", choiceType)
	}
	name := firstText(choice["name"])
	if function, ok := choice["function"].(map[string]any); ok {
		name = firstText(name, function["name"])
	}
	if name == "" {
		return nil, errors.New("function tool_choice requires name")
	}
	return map[string]any{"type": "tool", "toolName": name}, nil
}

func responseJSONValue(raw any, fallback any) (any, error) {
	if raw == nil {
		return fallback, nil
	}
	if text, ok := raw.(string); ok {
		if strings.TrimSpace(text) == "" {
			return fallback, nil
		}
		var value any
		if err := json.Unmarshal([]byte(text), &value); err != nil {
			return nil, err
		}
		return value, nil
	}
	return deepCopyJSON(raw), nil
}

func responseOutputValue(raw any) any {
	if raw == nil {
		return ""
	}
	if text, ok := raw.(string); ok {
		return text
	}
	return deepCopyJSON(raw)
}

func responsesToolResultOutput(raw any) map[string]any {
	if raw == nil {
		return map[string]any{"type": "text", "value": ""}
	}
	if text, ok := raw.(string); ok {
		return map[string]any{"type": "text", "value": text}
	}
	return map[string]any{"type": "json", "value": deepCopyJSON(raw)}
}

func responsesProviderCallToV3(item map[string]any) (map[string]any, error) {
	typeName := firstText(item["type"])
	callID := firstText(item["call_id"], item["id"])
	if callID == "" {
		return nil, fmt.Errorf("%s requires call_id", typeName)
	}
	toolName := responsesProviderCallToolName(typeName, item)
	if toolName == "" {
		return nil, fmt.Errorf("unsupported Responses provider call type %q", typeName)
	}
	var input any
	switch typeName {
	case "apply_patch_call":
		input = map[string]any{"callId": callID, "operation": deepCopyJSON(item["operation"])}
	case "shell_call", "local_shell_call":
		input = map[string]any{"action": deepCopyJSON(item["action"])}
	case "mcp_call":
		input = deepCopyJSON(item["arguments"])
	case "custom_tool_call":
		input = deepCopyJSON(item["input"])
	default:
		input = deepCopyJSON(item)
	}
	if input == nil {
		input = map[string]any{}
	}
	return map[string]any{
		"role": "assistant",
		"content": []any{map[string]any{
			"type":       "tool-call",
			"toolCallId": callID,
			"toolName":   toolName,
			"input":      input,
		}},
	}, nil
}

func responsesProviderOutputToV3(item map[string]any) (map[string]any, error) {
	typeName := firstText(item["type"])
	callID := firstText(item["call_id"], item["id"])
	if callID == "" {
		return nil, fmt.Errorf("%s requires call_id", typeName)
	}
	toolName := responsesProviderCallToolName(strings.TrimSuffix(typeName, "_output"), item)
	if toolName == "" {
		return nil, fmt.Errorf("unsupported Responses provider output type %q", typeName)
	}
	return map[string]any{
		"role": "tool",
		"content": []any{map[string]any{
			"type":       "tool-result",
			"toolCallId": callID,
			"toolName":   toolName,
			"output":     responsesToolResultOutput(item["output"]),
		}},
	}, nil
}

func responsesProviderCallToolName(typeName string, item map[string]any) string {
	switch typeName {
	case "apply_patch_call":
		return "apply_patch"
	case "shell_call":
		return "shell"
	case "local_shell_call":
		return "local_shell"
	case "mcp_call":
		if name := firstText(item["name"]); name != "" {
			return "mcp." + name
		}
		return "mcp"
	case "file_search_call":
		return "file_search"
	case "code_interpreter_call":
		return "code_interpreter"
	case "image_generation_call":
		return "image_generation"
	case "custom_tool_call":
		return firstText(item["name"])
	case "web_search_call":
		return "web_search"
	case "tool_search_call":
		return "tool_search"
	default:
		return ""
	}
}

func responseInteger(raw any) (int, bool) {
	switch value := raw.(type) {
	case int:
		return value, true
	case float64:
		return int(value), value == float64(int(value))
	case json.Number:
		parsed, err := value.Int64()
		return int(parsed), err == nil
	default:
		return 0, false
	}
}

// v2StreamPart is the single V2 model-stream representation consumed by both
// protocol frontends. The worker still speaks AI SDK V3 parts; adapters do not
// need to decode that wire shape independently.
type v2StreamPart struct {
	typeName         string
	id               string
	model            string
	delta            string
	toolName         string
	toolCallID       string
	input            any
	result           any
	signature        string
	finish           any
	usage            map[string]any
	errorString      string
	providerExecuted bool
}

func decodeV2StreamPart(frame workerFrame) (v2StreamPart, error) {
	if frame.Type == "error" {
		return v2StreamPart{typeName: "error", errorString: frame.Error}, nil
	}
	if frame.Type != "part" {
		return v2StreamPart{}, nil
	}
	part, err := decodeV3Part(frame.Part)
	if err != nil {
		return v2StreamPart{}, err
	}
	result := v2StreamPart{
		typeName:         v2StringValue(part["type"]),
		id:               v2StringValue(part["id"]),
		model:            v2StringValue(part["modelId"]),
		delta:            v2StringValue(part["delta"]),
		toolName:         v2StringValue(part["toolName"]),
		toolCallID:       v2StringValue(part["toolCallId"]),
		input:            part["input"],
		result:           part["result"],
		finish:           part["finishReason"],
		providerExecuted: part["providerExecuted"] == true,
	}
	if usage, ok := part["usage"].(map[string]any); ok {
		result.usage = usage
	}
	result.signature = v2StringValue(nestedValue(part, "providerMetadata", "anthropic", "signature"))
	if result.signature == "" {
		result.signature = v2StringValue(nestedValue(part, "providerMetadata", "wanqing", "signature"))
	}
	return result, nil
}

type v2ResponsesToolState struct {
	itemID       string
	callID       string
	name         string
	arguments    string
	responseType string
	result       any
	outputIndex  int
}

type v2ResponsesWriter struct {
	emitter              *streamEmitter
	payload              map[string]any
	responseID           string
	messageID            string
	reasoningID          string
	model                string
	outputText           []string
	reasoningText        []string
	messageStarted       bool
	contentStarted       bool
	reasoningStarted     bool
	textOutputIndex      int
	reasoningOutputIndex int
	nextOutputIndex      int
	finishSeen           bool
	toolCalls            map[string]*v2ResponsesToolState
	toolOrder            []string
	outputOrder          []string
	providerToolTypes    map[string]string
	usage                map[string]any
}

func newV2ResponsesWriter(emitter *streamEmitter, model string, payload map[string]any) *v2ResponsesWriter {
	return &v2ResponsesWriter{
		emitter: emitter, payload: payload, responseID: "resp_" + strings.ReplaceAll(randomDeviceID(), "-", ""),
		messageID: "msg_" + randomDeviceID(), reasoningID: "rs_" + randomDeviceID(), model: model,
		textOutputIndex: -1, reasoningOutputIndex: -1, toolCalls: map[string]*v2ResponsesToolState{},
		providerToolTypes: responsesProviderToolTypes(payload["tools"]), usage: map[string]any{},
	}
}

func (writer *v2ResponsesWriter) emit(value any) {
	if writer.emitter != nil {
		writer.emitter.responseEvent(value)
	}
}

func (writer *v2ResponsesWriter) base(status string, output []any) map[string]any {
	inputTokens := usageInt(writer.usage, "inputTokens", "input_tokens", "prompt_tokens")
	outputTokens := usageInt(writer.usage, "outputTokens", "output_tokens", "completion_tokens")
	return map[string]any{
		"id": writer.responseID, "object": "response", "created_at": time.Now().Unix(), "status": status,
		"error": nil, "incomplete_details": nil, "instructions": writer.payload["instructions"],
		"max_output_tokens": writer.payload["max_output_tokens"], "model": writer.model, "output": output,
		"parallel_tool_calls":  firstPresentValue(writer.payload["parallel_tool_calls"], true),
		"previous_response_id": writer.payload["previous_response_id"],
		"reasoning":            firstPresentValue(writer.payload["reasoning"], map[string]any{"effort": writer.payload["reasoning_effort"]}),
		"store":                writer.payload["store"] == true, "temperature": writer.payload["temperature"],
		"text":        firstPresentValue(writer.payload["text"], map[string]any{"format": map[string]any{"type": "text"}}),
		"tool_choice": firstPresentValue(writer.payload["tool_choice"], "auto"), "tools": firstPresentValue(writer.payload["tools"], []any{}),
		"top_p": writer.payload["top_p"], "truncation": firstPresentValue(writer.payload["truncation"], "disabled"),
		"usage": map[string]any{
			"input_tokens": inputTokens, "output_tokens": outputTokens, "total_tokens": inputTokens + outputTokens,
			"input_tokens_details":  map[string]any{"cached_tokens": usageInt(writer.usage, "cachedTokens")},
			"output_tokens_details": map[string]any{"reasoning_tokens": usageInt(writer.usage, "reasoningTokens")},
		},
	}
}

func (writer *v2ResponsesWriter) start() {
	response := writer.base("in_progress", []any{})
	writer.emit(map[string]any{"type": "response.created", "response": response})
	writer.emit(map[string]any{"type": "response.in_progress", "response": response})
}

func (writer *v2ResponsesWriter) add(frame workerFrame) error {
	part, err := decodeV2StreamPart(frame)
	if err != nil {
		return err
	}
	if part.typeName == "" {
		return nil
	}
	if part.typeName == "error" {
		return errors.New(part.errorString)
	}
	if part.model != "" && writer.model == "" {
		writer.model = part.model
	}
	for key, value := range part.usage {
		writer.usage[key] = value
	}
	switch part.typeName {
	case "response-metadata", "stream-start":
		return nil
	case "text-start":
		writer.ensureText()
	case "text-delta":
		writer.ensureText()
		writer.outputText = append(writer.outputText, part.delta)
		writer.emit(map[string]any{"type": "response.output_text.delta", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "delta": part.delta})
	case "reasoning-start":
		writer.ensureReasoning()
	case "reasoning-delta":
		writer.ensureReasoning()
		writer.reasoningText = append(writer.reasoningText, part.delta)
		writer.emit(map[string]any{"type": "response.reasoning_summary_text.delta", "response_id": writer.responseID, "item_id": writer.reasoningID, "output_index": writer.reasoningOutputIndex, "summary_index": 0, "delta": part.delta})
	case "tool-input-start":
		writer.ensureTool(part.id, part.toolCallID, part.toolName)
	case "tool-input-delta":
		state := writer.ensureTool(part.id, part.toolCallID, part.toolName)
		state.arguments += part.delta
		if state.responseType == "" {
			writer.emit(map[string]any{"type": "response.function_call_arguments.delta", "response_id": writer.responseID, "item_id": state.itemID, "output_index": state.outputIndex, "delta": part.delta})
		}
	case "tool-call":
		callID := firstText(part.toolCallID, part.id)
		state := writer.ensureTool(callID, callID, part.toolName)
		if err := writer.mergeToolArguments(state, part.input); err != nil {
			return fmt.Errorf("encode tool call %q: %w", callID, err)
		}
	case "tool-result":
		state := writer.ensureTool(part.toolCallID, part.toolCallID, part.toolName)
		state.result = deepCopyJSON(part.result)
	case "finish":
		writer.finishSeen = true
		return nil
	}
	return nil
}

func (writer *v2ResponsesWriter) mergeToolArguments(state *v2ResponsesToolState, input any) error {
	if state == nil || input == nil {
		return nil
	}
	encoded, ok := input.(string)
	if !ok {
		raw, err := json.Marshal(input)
		if err != nil {
			return err
		}
		encoded = string(raw)
	}
	if encoded == "" || encoded == state.arguments {
		return nil
	}
	if state.responseType != "" {
		state.arguments = encoded
		return nil
	}
	delta := encoded
	if strings.HasPrefix(encoded, state.arguments) {
		delta = strings.TrimPrefix(encoded, state.arguments)
	}
	state.arguments = encoded
	if delta != "" {
		writer.emit(map[string]any{"type": "response.function_call_arguments.delta", "response_id": writer.responseID, "item_id": state.itemID, "output_index": state.outputIndex, "delta": delta})
	}
	return nil
}

func (writer *v2ResponsesWriter) ensureReasoning() {
	if writer.reasoningStarted {
		return
	}
	writer.reasoningStarted = true
	writer.reasoningOutputIndex = writer.nextOutputIndex
	writer.nextOutputIndex++
	writer.outputOrder = append(writer.outputOrder, "reasoning")
	writer.emit(map[string]any{
		"type": "response.output_item.added", "response_id": writer.responseID, "output_index": writer.reasoningOutputIndex,
		"item": map[string]any{"id": writer.reasoningID, "type": "reasoning", "status": "in_progress", "summary": []any{}},
	})
}

func (writer *v2ResponsesWriter) ensureText() {
	if !writer.messageStarted {
		writer.messageStarted = true
		writer.textOutputIndex = writer.nextOutputIndex
		writer.nextOutputIndex++
		writer.outputOrder = append(writer.outputOrder, "message")
		writer.emit(map[string]any{
			"type": "response.output_item.added", "response_id": writer.responseID, "output_index": writer.textOutputIndex,
			"item": map[string]any{"id": writer.messageID, "type": "message", "status": "in_progress", "role": "assistant", "content": []any{}},
		})
	}
	if writer.contentStarted {
		return
	}
	writer.contentStarted = true
	writer.emit(map[string]any{
		"type": "response.content_part.added", "response_id": writer.responseID, "item_id": writer.messageID,
		"output_index": writer.textOutputIndex, "content_index": 0,
		"part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}},
	})
}

func (writer *v2ResponsesWriter) ensureTool(key, callID, name string) *v2ResponsesToolState {
	key = firstText(key, callID, "call_"+randomDeviceID())
	state := writer.toolCalls[key]
	if state == nil {
		responseType := writer.providerToolTypes[name]
		if responseType == "" {
			responseType = responsesProviderResponseItemType(name)
		}
		state = &v2ResponsesToolState{itemID: "fc_" + randomDeviceID(), callID: firstText(callID, key), name: name, responseType: responseType, outputIndex: writer.nextOutputIndex}
		writer.nextOutputIndex++
		writer.toolCalls[key] = state
		writer.toolOrder = append(writer.toolOrder, key)
		writer.outputOrder = append(writer.outputOrder, "tool:"+key)
		writer.emit(map[string]any{
			"type": "response.output_item.added", "response_id": writer.responseID, "output_index": state.outputIndex,
			"item": writer.toolItem(state, "in_progress"),
		})
	} else {
		if callID != "" {
			state.callID = callID
		}
		if name != "" {
			state.name = name
		}
	}
	return state
}

func (writer *v2ResponsesWriter) toolItem(state *v2ResponsesToolState, status string) map[string]any {
	if state.responseType != "" {
		return writer.providerToolItem(state, status)
	}
	return map[string]any{"id": state.itemID, "type": "function_call", "status": status, "call_id": state.callID, "name": state.name, "arguments": firstText(state.arguments, "{}")}
}

func (writer *v2ResponsesWriter) providerToolItem(state *v2ResponsesToolState, status string) map[string]any {
	input := map[string]any{}
	if state.arguments != "" {
		if decoded, err := responseJSONValue(state.arguments, map[string]any{}); err == nil {
			input, _ = decoded.(map[string]any)
			if input == nil {
				input = map[string]any{}
			}
		}
	}
	item := map[string]any{"id": state.itemID, "type": state.responseType, "status": status}
	switch state.responseType {
	case "apply_patch_call":
		operation, _ := input["operation"].(map[string]any)
		if operation == nil {
			operation = map[string]any{"type": "update_file", "path": "", "diff": ""}
		}
		item["call_id"] = firstText(input["callId"], state.callID)
		item["operation"] = operation
	case "shell_call", "local_shell_call":
		item["call_id"] = firstText(input["callId"], state.callID)
		action, _ := input["action"].(map[string]any)
		if action == nil {
			action = map[string]any{}
		}
		item["action"] = action
	case "mcp_call":
		item["call_id"] = firstText(input["callId"], state.callID)
		item["name"] = strings.TrimPrefix(state.name, "mcp.")
		item["arguments"] = input
		if state.result != nil {
			item["output"] = deepCopyJSON(state.result)
		}
	case "custom_tool_call":
		item["call_id"] = firstText(input["callId"], state.callID)
		item["name"] = state.name
		item["input"] = firstText(input["input"], state.arguments)
	case "web_search_call":
		item["action"] = firstPresentValue(input["action"], map[string]any{})
	default:
		item["id"] = state.itemID
		item["status"] = status
		item["call_id"] = firstText(input["callId"], state.callID)
	}
	return item
}

func (writer *v2ResponsesWriter) outputItem(key, status string) any {
	switch key {
	case "reasoning":
		return map[string]any{"id": writer.reasoningID, "type": "reasoning", "status": status, "summary": []any{map[string]any{"type": "summary_text", "text": strings.Join(writer.reasoningText, "")}}}
	case "message":
		return map[string]any{"id": writer.messageID, "type": "message", "status": status, "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": strings.Join(writer.outputText, ""), "annotations": []any{}}}}
	default:
		if strings.HasPrefix(key, "tool:") {
			return writer.toolItem(writer.toolCalls[strings.TrimPrefix(key, "tool:")], status)
		}
	}
	return nil
}

func (writer *v2ResponsesWriter) outputItems() []any {
	output := make([]any, 0, len(writer.outputOrder))
	for _, key := range writer.outputOrder {
		if item := writer.outputItem(key, "completed"); item != nil {
			output = append(output, item)
		}
	}
	return output
}

func (writer *v2ResponsesWriter) stop(compaction bool) map[string]any {
	if !writer.messageStarted && !writer.reasoningStarted && len(writer.toolOrder) == 0 {
		writer.ensureText()
	}
	if compaction {
		summary := strings.TrimSpace(strings.Join(writer.outputText, ""))
		if summary == "" {
			summary = strings.TrimSpace(strings.Join(writer.reasoningText, ""))
		}
		if summary != "" {
			item := makeMyFlickerCompactionItem(summary)
			writer.emit(map[string]any{"type": "response.output_item.done", "response_id": writer.responseID, "output_index": 0, "item": item})
			response := writer.base("completed", []any{item})
			writer.emit(map[string]any{"type": "response.completed", "response": response})
			return response
		}
	}
	if writer.reasoningStarted {
		reasoning := strings.Join(writer.reasoningText, "")
		writer.emit(map[string]any{"type": "response.reasoning_summary_text.done", "response_id": writer.responseID, "item_id": writer.reasoningID, "output_index": writer.reasoningOutputIndex, "summary_index": 0, "text": reasoning})
		writer.emit(map[string]any{"type": "response.output_item.done", "response_id": writer.responseID, "output_index": writer.reasoningOutputIndex, "item": writer.outputItem("reasoning", "completed")})
	}
	if writer.messageStarted {
		text := strings.Join(writer.outputText, "")
		writer.emit(map[string]any{"type": "response.output_text.done", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "text": text})
		writer.emit(map[string]any{"type": "response.content_part.done", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "part": map[string]any{"type": "output_text", "text": text, "annotations": []any{}}})
		writer.emit(map[string]any{"type": "response.output_item.done", "response_id": writer.responseID, "output_index": writer.textOutputIndex, "item": writer.outputItem("message", "completed")})
	}
	items := writer.outputItems()
	for _, key := range writer.toolOrder {
		state := writer.toolCalls[key]
		if state.responseType == "" {
			writer.emit(map[string]any{"type": "response.function_call_arguments.done", "response_id": writer.responseID, "item_id": state.itemID, "output_index": state.outputIndex, "arguments": firstText(state.arguments, "{}")})
		}
		writer.emit(map[string]any{"type": "response.output_item.done", "response_id": writer.responseID, "output_index": state.outputIndex, "item": writer.outputItem("tool:"+key, "completed")})
	}
	response := writer.base("completed", items)
	writer.emit(map[string]any{"type": "response.completed", "response": response})
	return response
}

func (writer *v2ResponsesWriter) fail(err error) {
	response := writer.base("failed", []any{})
	response["error"] = map[string]any{"type": fmt.Sprintf("%T", err), "message": err.Error()}
	writer.emit(map[string]any{"type": "response.failed", "response": response})
}

func (s *proxyServer) handleResponses(response http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodOptions {
		writePreflight(response)
		return
	}
	if request.Method != http.MethodPost {
		writeResponsesError(response, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !loopbackOrigin(request) {
		writeResponsesError(response, http.StatusUnauthorized, "unauthorized")
		return
	}
	var input map[string]any
	if status, err := decodeRequestJSON(response, request, s.settings.MaxRequestSize, &input); err != nil {
		writeResponsesError(response, status, err.Error())
		return
	}
	model, ok := s.models.Resolve(firstText(input["model"]))
	if !ok {
		writeResponsesError(response, http.StatusBadRequest, "unknown or unavailable model")
		return
	}
	if model.APIFormat != "" && model.APIFormat != "openai" && model.APIFormat != "responses" {
		writeResponsesError(response, http.StatusBadRequest, "model does not support Responses")
		return
	}
	if err := validateResponsesModelInput(model, input["input"]); err != nil {
		writeResponsesError(response, http.StatusBadRequest, err.Error())
		return
	}
	input["model"] = model.ID
	conversion, err := responsesRequestToV3(input)
	if err != nil {
		writeResponsesError(response, http.StatusBadRequest, err.Error())
		return
	}
	frames, err := s.worker.Request(request.Context(), model.ID, conversion.effort, conversion.payload)
	if err != nil {
		logV2WorkerFailure(s.diagnosticWriter, summarizeV2Request(model.ID, conversion.effort, conversion.payload), err)
		writeResponsesError(response, http.StatusBadGateway, "Wanqing worker request failed")
		return
	}
	if stream, _ := input["stream"].(bool); stream {
		s.writeResponsesStream(response, request, model.ID, input, frames, conversion.compaction)
		return
	}
	writer := newV2ResponsesWriter(nil, model.ID, input)
	for frame := range frames {
		if err := writer.add(frame); err != nil {
			logV2WorkerFailure(s.diagnosticWriter, summarizeV2Request(model.ID, conversion.effort, conversion.payload), err)
			writeResponsesError(response, http.StatusBadGateway, sanitizeWorkerError(err))
			return
		}
	}
	if !writer.finishSeen {
		writeResponsesError(response, http.StatusBadGateway, "AI SDK stream ended without a finish part")
		return
	}
	writeV2JSON(response, http.StatusOK, writer.stop(conversion.compaction))
}

func (s *proxyServer) writeResponsesStream(response http.ResponseWriter, request *http.Request, model string, payload map[string]any, frames <-chan workerFrame, compaction bool) {
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeResponsesError(response, http.StatusInternalServerError, "streaming is unavailable")
		return
	}
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("Connection", "keep-alive")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
	emitter := newStreamEmitter(response)
	writer := newV2ResponsesWriter(&emitter, model, payload)
	writer.start()
	for frame := range frames {
		if err := writer.add(frame); err != nil {
			if request.Context().Err() == nil {
				writer.fail(err)
			}
			fmt.Fprint(response, "data: [DONE]\n\n")
			flusher.Flush()
			return
		}
		select {
		case <-request.Context().Done():
			return
		default:
		}
	}
	if !writer.finishSeen {
		if request.Context().Err() == nil {
			writer.fail(errors.New("AI SDK stream ended without a finish part"))
			fmt.Fprint(response, "data: [DONE]\n\n")
			flusher.Flush()
		}
		return
	}
	writer.stop(compaction)
	fmt.Fprint(response, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeResponsesError(response http.ResponseWriter, status int, message string) {
	errorType := "invalid_request_error"
	if status == http.StatusUnauthorized {
		errorType = "authentication_error"
	} else if status >= http.StatusInternalServerError {
		errorType = "api_error"
	}
	writeV2JSON(response, status, map[string]any{
		"error": map[string]any{"type": errorType, "message": message, "param": nil, "code": nil},
	})
}
