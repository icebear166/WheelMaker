package flickerbridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type v2ResponsesRequestConversion struct {
	payload    map[string]any
	effort     string
	compaction bool
	toolRefs   map[string]responsesToolRef
}

type responsesToolRef struct {
	Namespace string
	Name      string
}

const maxV2ResponseHistory = 128

type v2ResponseHistory struct {
	prompt []any
	output []any
}

type v2ResponsesStore struct {
	mu      sync.Mutex
	entries map[string]v2ResponseHistory
	order   []string
}

func newV2ResponsesStore() *v2ResponsesStore {
	return &v2ResponsesStore{entries: make(map[string]v2ResponseHistory)}
}

func (store *v2ResponsesStore) put(response map[string]any, prompt any) {
	if store == nil {
		return
	}
	id := firstText(response["id"])
	output, ok := response["output"].([]any)
	if id == "" || !ok {
		return
	}
	promptCopy := deepCopyJSON(prompt)
	outputCopy := deepCopyJSON(output)
	promptItems, ok := promptCopy.([]any)
	if !ok {
		return
	}
	outputItems, ok := outputCopy.([]any)
	if !ok {
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, exists := store.entries[id]; !exists {
		store.order = append(store.order, id)
	}
	store.entries[id] = v2ResponseHistory{prompt: promptItems, output: outputItems}
	for len(store.order) > maxV2ResponseHistory {
		oldest := store.order[0]
		store.order = store.order[1:]
		delete(store.entries, oldest)
	}
}

func (store *v2ResponsesStore) get(id string) (v2ResponseHistory, bool) {
	if store == nil || strings.TrimSpace(id) == "" {
		return v2ResponseHistory{}, false
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	history, ok := store.entries[strings.TrimSpace(id)]
	if !ok {
		return v2ResponseHistory{}, false
	}
	prompt, _ := deepCopyJSON(history.prompt).([]any)
	output, _ := deepCopyJSON(history.output).([]any)
	return v2ResponseHistory{prompt: prompt, output: output}, true
}

func (history v2ResponseHistory) promptWithOutput() ([]any, error) {
	result := append([]any(nil), history.prompt...)
	if len(history.output) == 0 {
		return result, nil
	}
	callNames := responsesFunctionCallNames(history.output)
	converted, err := responsesInputToV3(history.output, callNames, nil)
	if err != nil {
		return nil, err
	}
	return append(result, converted...), nil
}

func mergeV2ResponsePrompts(previous, current []any) []any {
	currentSystem := make([]any, 0, len(current))
	currentConversation := make([]any, 0, len(current))
	for _, item := range current {
		message, _ := item.(map[string]any)
		if role := firstText(message["role"]); role == "system" || role == "developer" {
			currentSystem = append(currentSystem, item)
			continue
		}
		currentConversation = append(currentConversation, item)
	}
	merged := make([]any, 0, len(previous)+len(current))
	merged = append(merged, currentSystem...)
	merged = append(merged, previous...)
	merged = append(merged, currentConversation...)
	return merged
}

func responsesRequestToV3(request map[string]any) (v2ResponsesRequestConversion, error) {
	return responsesRequestToV3WithCallNames(request, nil)
}

func responsesRequestToV3WithCallNames(request map[string]any, inheritedCallNames map[string]string) (v2ResponsesRequestConversion, error) {
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
	callNames := make(map[string]string, len(inheritedCallNames))
	for callID, name := range inheritedCallNames {
		callNames[callID] = name
	}
	for callID, name := range responsesFunctionCallNames(input) {
		callNames[callID] = name
	}
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
	toolRefs := map[string]responsesToolRef{}
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
		tools, refs, err := responsesToolsToV3(rawTools)
		if err != nil {
			return v2ResponsesRequestConversion{}, err
		}
		payload["tools"] = tools
		toolRefs = refs
	}
	if value := request["tool_choice"]; value != nil {
		toolChoice, err := responsesToolChoiceToV3(value)
		if err != nil {
			return v2ResponsesRequestConversion{}, err
		}
		if toolChoice != nil {
			payload["toolChoice"] = toolChoice
		}
	}
	if format, err := responsesTextFormatToV3(request["text"]); err != nil {
		return v2ResponsesRequestConversion{}, err
	} else if format != nil {
		payload["responseFormat"] = format
	}
	if providerOptions := responsesProviderOptionsToV3(request); len(providerOptions) > 0 {
		payload["providerOptions"] = map[string]any{"wanqing": providerOptions}
	}

	effort := firstText(request["reasoning_effort"])
	if reasoning, ok := request["reasoning"].(map[string]any); ok {
		effort = firstText(reasoning["effort"], effort)
	}
	return v2ResponsesRequestConversion{payload: payload, effort: strings.TrimSpace(effort), compaction: compaction, toolRefs: toolRefs}, nil
}

func responsesProviderOptionsToV3(request map[string]any) map[string]any {
	options := map[string]any{}
	for requestKey, providerKey := range map[string]string{
		"include":                "include",
		"conversation":           "conversation",
		"metadata":               "metadata",
		"service_tier":           "serviceTier",
		"parallel_tool_calls":    "parallelToolCalls",
		"max_tool_calls":         "maxToolCalls",
		"prompt_cache_key":       "promptCacheKey",
		"prompt_cache_retention": "promptCacheRetention",
		"logprobs":               "logprobs",
		"top_logprobs":           "topLogprobs",
		"store":                  "store",
		"truncation":             "truncation",
		"safety_identifier":      "safetyIdentifier",
		"user":                   "user",
	} {
		if value := request[requestKey]; value != nil {
			options[providerKey] = deepCopyJSON(value)
		}
	}
	if effort := firstText(request["reasoning_effort"]); effort != "" {
		options["reasoningEffort"] = effort
	}
	if reasoning, ok := request["reasoning"].(map[string]any); ok {
		if effort := firstText(reasoning["effort"]); effort != "" {
			options["reasoningEffort"] = effort
		}
		if summary := firstText(reasoning["summary"]); summary != "" {
			options["reasoningSummary"] = summary
		}
	}
	if text, ok := request["text"].(map[string]any); ok {
		if verbosity := firstText(text["verbosity"]); verbosity != "" {
			options["textVerbosity"] = verbosity
		}
	}
	return options
}

func responsesTextFormatToV3(raw any) (map[string]any, error) {
	if raw == nil {
		return nil, nil
	}
	text, ok := raw.(map[string]any)
	if !ok {
		return nil, errors.New("text must be an object")
	}
	format, ok := text["format"].(map[string]any)
	if !ok {
		return map[string]any{"type": "text"}, nil
	}
	typeName := firstText(format["type"], "text")
	switch typeName {
	case "text":
		return map[string]any{"type": "text"}, nil
	case "json_object":
		return map[string]any{"type": "json"}, nil
	case "json_schema":
		result := map[string]any{"type": "json"}
		for _, key := range []string{"name", "description", "strict", "schema"} {
			if value := format[key]; value != nil {
				result[key] = deepCopyJSON(value)
			}
		}
		if result["schema"] == nil {
			return nil, errors.New("text.format json_schema requires schema")
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported Responses text format %q", typeName)
	}
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
		if namespace := firstText(item["namespace"]); namespace != "" {
			name = responsesNamespacedToolName(namespace, name)
		}
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
			if namespace := firstText(item["namespace"]); namespace != "" {
				name = responsesNamespacedToolName(namespace, name)
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
			toolName := firstText(callNames[callID])
			if toolName == "" {
				return nil, fmt.Errorf("function_call_output %q has no matching function_call", callID)
			}
			output := responsesToolResultOutput(item["output"])
			result = append(result, map[string]any{
				"role": "tool",
				"content": []any{map[string]any{
					"type":       "tool-result",
					"toolCallId": callID,
					"toolName":   toolName,
					"output":     output,
				}},
			})
		case "apply_patch_call", "shell_call", "local_shell_call", "mcp_call", "file_search_call", "code_interpreter_call", "image_generation_call", "custom_tool_call", "web_search_call", "tool_search_call", "computer_call":
			message, err := responsesProviderCallToV3(item)
			if err != nil {
				return nil, err
			}
			result = append(result, message)
		case "apply_patch_call_output", "shell_call_output", "local_shell_call_output", "custom_tool_call_output", "mcp_call_output", "file_search_call_output", "code_interpreter_call_output", "image_generation_call_output", "web_search_call_output", "tool_search_call_output", "computer_call_output":
			message, err := responsesProviderOutputToV3(item)
			if err != nil {
				return nil, err
			}
			if message != nil {
				result = append(result, message)
			}
		case "reasoning":
			message, err := responsesReasoningItemToV3(item)
			if err != nil {
				return nil, err
			}
			if message != nil {
				result = append(result, message)
			}
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
	value := ""
	for _, key := range []string{"image_url", "file_url", "file_data", "url", "data", "file_id"} {
		candidate := item[key]
		if object, ok := candidate.(map[string]any); ok {
			candidate = firstText(object["url"], object["uri"])
		}
		if value = firstText(candidate); value != "" {
			break
		}
	}
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
	part := map[string]any{"type": "file", "mediaType": mediaType, "data": value}
	if lower := strings.ToLower(value); strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		part["data"] = map[string]any{"__wheelmaker_url": value}
	}
	if detail := firstText(item["detail"]); detail != "" && strings.HasPrefix(strings.ToLower(mediaType), "image/") {
		part["providerOptions"] = map[string]any{"wanqing": map[string]any{"imageDetail": detail}}
	}
	return part, nil
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
	encrypted := firstText(item["encrypted_content"], item["encryptedContent"])
	if len(parts) == 0 && encrypted == "" {
		return nil, nil
	}
	if encrypted != "" {
		part := map[string]any{"type": "reasoning", "text": ""}
		if len(parts) > 0 {
			part = parts[0].(map[string]any)
		}
		part["providerMetadata"] = map[string]any{"azure": map[string]any{"reasoningEncryptedContent": encrypted}}
		if len(parts) == 0 {
			parts = append(parts, part)
		} else {
			parts[0] = part
		}
	}
	return map[string]any{"role": "assistant", "content": parts}, nil
}

func responsesToolsToV3(raw any) ([]any, map[string]responsesToolRef, error) {
	items, ok := raw.([]any)
	if !ok {
		return nil, nil, errors.New("tools must be an array")
	}
	result := make([]any, 0, len(items))
	toolRefs := map[string]responsesToolRef{}
	for _, rawTool := range items {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			return nil, nil, errors.New("tools must contain objects")
		}
		typeName := firstText(tool["type"])
		if typeName == "namespace" {
			flattened, refs, err := responsesNamespaceToolsToV3(tool)
			if err != nil {
				return nil, nil, err
			}
			result = append(result, flattened...)
			for name, ref := range refs {
				toolRefs[name] = ref
			}
			continue
		}
		if typeName != "function" {
			if converted, supported := responsesProviderToolToV3(tool); supported {
				result = append(result, converted)
			}
			continue
		}
		converted, err := responsesFunctionToolToV3(tool)
		if err != nil {
			return nil, nil, err
		}
		result = append(result, converted)
	}
	return result, toolRefs, nil
}

func responsesProviderToolToV3(tool map[string]any) (map[string]any, bool) {
	typeName := firstText(tool["type"])
	if typeName == "provider" {
		typeName = firstText(tool["id"])
	}
	canonical := strings.TrimPrefix(typeName, "openai.")
	name := ""
	switch canonical {
	case "apply_patch", "shell", "local_shell", "file_search", "code_interpreter", "image_generation", "tool_search":
		name = canonical
	case "web_search", "web_search_preview":
		name = "web_search"
	case "computer_use", "computer_use_preview":
		name = "computer_use"
	case "mcp":
		name = "mcp"
	case "custom":
		args, _ := tool["args"].(map[string]any)
		name = firstText(tool["name"], args["name"])
	}
	if name == "" {
		return nil, false
	}
	args, _ := tool["args"].(map[string]any)
	parameters := firstPresentValue(
		tool["parameters"], tool["input_schema"],
		args["parameters"], args["inputSchema"], args["input_schema"],
		map[string]any{"type": "object"},
	)
	description := firstText(tool["description"], args["description"])
	if description == "" {
		description = "Codex " + strings.ReplaceAll(name, "_", " ") + " tool"
	}
	converted := map[string]any{
		"type":        "function",
		"name":        name,
		"description": description,
		"inputSchema": deepCopyJSON(parameters),
	}
	if strict := firstPresentValue(tool["strict"], args["strict"]); strict != nil {
		converted["strict"] = strict
	}
	return converted, true
}

func responsesFunctionToolToV3(tool map[string]any) (map[string]any, error) {
	name := firstText(tool["name"])
	description := firstText(tool["description"])
	parameters := tool["parameters"]
	strict := tool["strict"]
	if function, ok := tool["function"].(map[string]any); ok {
		name = firstText(name, function["name"])
		description = firstText(description, function["description"])
		if parameters == nil {
			parameters = function["parameters"]
		}
		if strict == nil {
			strict = function["strict"]
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
	if strict != nil {
		converted["strict"] = strict
	}
	return converted, nil
}

func responsesNamespaceToolsToV3(namespaceTool map[string]any) ([]any, map[string]responsesToolRef, error) {
	namespace := firstText(namespaceTool["name"])
	if namespace == "" {
		return nil, nil, errors.New("namespace tool requires name")
	}
	items, ok := namespaceTool["tools"].([]any)
	if !ok || len(items) == 0 {
		return nil, nil, nil
	}
	result := make([]any, 0, len(items))
	refs := make(map[string]responsesToolRef, len(items))
	for _, rawTool := range items {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			return nil, nil, errors.New("namespace tools must contain objects")
		}
		if typeName := firstText(tool["type"], "function"); typeName != "function" {
			return nil, nil, fmt.Errorf("unsupported namespace tool type %q", typeName)
		}
		converted, err := responsesFunctionToolToV3(tool)
		if err != nil {
			return nil, nil, err
		}
		name := firstText(converted["name"])
		flattened := responsesNamespacedToolName(namespace, name)
		converted["name"] = flattened
		result = append(result, converted)
		refs[flattened] = responsesToolRef{Namespace: namespace, Name: name}
	}
	return result, refs, nil
}

func responsesNamespacedToolName(namespace, name string) string {
	if strings.HasSuffix(namespace, "_") || strings.HasPrefix(name, "_") {
		return namespace + name
	}
	return namespace + "__" + name
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
		if typeName == "provider" {
			typeName = firstText(tool["id"])
		}
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
			converted, supported := responsesProviderToolToV3(map[string]any{"type": text})
			if !supported {
				return nil, nil
			}
			return map[string]any{"type": "tool", "toolName": converted["name"]}, nil
		}
	}
	choice, ok := raw.(map[string]any)
	if !ok {
		return nil, errors.New("tool_choice must be a string or object")
	}
	choiceType := firstText(choice["type"])
	if choiceType != "function" {
		converted, supported := responsesProviderToolToV3(choice)
		if !supported {
			return nil, nil
		}
		return map[string]any{"type": "tool", "toolName": converted["name"]}, nil
	}
	name := firstText(choice["name"])
	if function, ok := choice["function"].(map[string]any); ok {
		name = firstText(name, function["name"])
		if namespace := firstText(choice["namespace"], function["namespace"]); namespace != "" {
			name = responsesNamespacedToolName(namespace, name)
		}
	} else if namespace := firstText(choice["namespace"]); namespace != "" {
		name = responsesNamespacedToolName(namespace, name)
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
			"output":     responsesToolResultOutput(responsesProviderOutputValue(item)),
		}},
	}, nil
}

func responsesProviderOutputValue(item map[string]any) any {
	for _, key := range []string{"output", "results", "outputs", "result", "error"} {
		if value, ok := item[key]; ok {
			return value
		}
	}
	return nil
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
	case "computer_call":
		return "computer_use"
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

func responsesIncompleteReason(raw any) string {
	reason, _ := raw.(map[string]any)
	value := firstText(reason["raw"], reason["unified"], raw)
	switch value {
	case "length", "max_tokens", "max_output_tokens":
		return "max_output_tokens"
	case "content_filter":
		return "content_filter"
	case "tool-calls", "stop", "end_turn", "tool_use", "":
		return ""
	default:
		if strings.Contains(value, "max") || strings.Contains(value, "length") {
			return "max_output_tokens"
		}
		return ""
	}
}

// v2StreamPart is the single V2 model-stream representation consumed by both
// protocol frontends. The worker still speaks AI SDK V3 parts; adapters do not
// need to decode that wire shape independently.
type v2StreamPart struct {
	typeName                  string
	id                        string
	model                     string
	delta                     string
	logprobs                  any
	toolName                  string
	toolCallID                string
	input                     any
	result                    any
	signature                 string
	reasoningEncryptedContent string
	finish                    any
	usage                     map[string]any
	errorString               string
	providerExecuted          bool
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
		logprobs:         part["logprobs"],
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
	for _, provider := range []string{"azure", "wanqing", "openai"} {
		result.reasoningEncryptedContent = firstText(
			result.reasoningEncryptedContent,
			nestedValue(part, "providerMetadata", provider, "reasoningEncryptedContent"),
			nestedValue(part, "providerMetadata", provider, "reasoning_encrypted_content"),
		)
	}
	return result, nil
}

type v2ResponsesToolState struct {
	itemID       string
	callID       string
	name         string
	namespace    string
	displayName  string
	arguments    string
	responseType string
	result       any
	outputIndex  int
}

type v2ResponsesWriter struct {
	emitter                   *streamEmitter
	payload                   map[string]any
	responseID                string
	createdAt                 int64
	messageID                 string
	reasoningID               string
	model                     string
	outputText                []string
	textLogprobs              any
	logprobsSeen              bool
	reasoningText             []string
	reasoningEncryptedContent string
	messageStarted            bool
	contentStarted            bool
	reasoningStarted          bool
	textOutputIndex           int
	reasoningOutputIndex      int
	nextOutputIndex           int
	finishSeen                bool
	toolCalls                 map[string]*v2ResponsesToolState
	toolOrder                 []string
	outputOrder               []string
	providerToolTypes         map[string]string
	toolRefs                  map[string]responsesToolRef
	usage                     map[string]any
	incompleteReason          string
}

func newV2ResponsesWriter(emitter *streamEmitter, model string, payload map[string]any, toolRefs map[string]responsesToolRef) *v2ResponsesWriter {
	return &v2ResponsesWriter{
		emitter: emitter, payload: payload, responseID: "resp_" + strings.ReplaceAll(randomDeviceID(), "-", ""), createdAt: time.Now().Unix(),
		messageID: "msg_" + randomDeviceID(), reasoningID: "rs_" + randomDeviceID(), model: model,
		textOutputIndex: -1, reasoningOutputIndex: -1, toolCalls: map[string]*v2ResponsesToolState{},
		providerToolTypes: responsesProviderToolTypes(payload["tools"]), toolRefs: toolRefs, usage: map[string]any{},
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
	cachedTokens := usageInt(writer.usage, "cachedTokens", "cached_tokens")
	if cachedTokens == 0 {
		for _, key := range []string{"inputTokens", "input_tokens"} {
			if nested, ok := writer.usage[key].(map[string]any); ok {
				cachedTokens = usageInt(nested, "cacheRead", "cachedTokens", "cached_tokens")
				if cachedTokens != 0 {
					break
				}
			}
		}
	}
	reasoningTokens := usageInt(writer.usage, "reasoningTokens", "reasoning_tokens")
	if reasoningTokens == 0 {
		for _, key := range []string{"outputTokens", "output_tokens"} {
			if nested, ok := writer.usage[key].(map[string]any); ok {
				reasoningTokens = usageInt(nested, "reasoning", "reasoningTokens", "reasoning_tokens")
				if reasoningTokens != 0 {
					break
				}
			}
		}
	}
	response := map[string]any{
		"id": writer.responseID, "object": "response", "created_at": writer.createdAt, "status": status,
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
			"input_tokens_details":  map[string]any{"cached_tokens": cachedTokens},
			"output_tokens_details": map[string]any{"reasoning_tokens": reasoningTokens},
		},
	}
	for key, fallback := range map[string]any{
		"background":        nil,
		"conversation":      nil,
		"logprobs":          nil,
		"max_tool_calls":    nil,
		"metadata":          map[string]any{},
		"prompt_cache_key":  nil,
		"safety_identifier": nil,
		"service_tier":      nil,
		"top_logprobs":      nil,
		"user":              nil,
	} {
		response[key] = firstPresentValue(writer.payload[key], fallback)
	}
	if writer.incompleteReason != "" && (status == "completed" || status == "incomplete") {
		if status == "completed" {
			response["status"] = "incomplete"
		}
		response["incomplete_details"] = map[string]any{"reason": writer.incompleteReason}
	}
	return response
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
		event := map[string]any{"type": "response.output_text.delta", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "delta": part.delta}
		if part.logprobs != nil {
			writer.logprobsSeen = true
			writer.textLogprobs = mergeV2Logprobs(writer.textLogprobs, part.logprobs)
			event["logprobs"] = deepCopyJSON(part.logprobs)
		}
		writer.emit(event)
	case "reasoning-start":
		writer.reasoningEncryptedContent = firstText(writer.reasoningEncryptedContent, part.reasoningEncryptedContent)
		writer.ensureReasoning()
	case "reasoning-delta":
		writer.reasoningEncryptedContent = firstText(writer.reasoningEncryptedContent, part.reasoningEncryptedContent)
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
		writer.incompleteReason = responsesIncompleteReason(part.finish)
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
		"item": writer.reasoningItem("in_progress"),
	})
}

func (writer *v2ResponsesWriter) reasoningItem(status string) map[string]any {
	item := map[string]any{
		"id": writer.reasoningID, "type": "reasoning", "status": status,
		"summary": []any{},
	}
	if writer.reasoningEncryptedContent != "" {
		item["encrypted_content"] = writer.reasoningEncryptedContent
	}
	return item
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
	if state == nil && callID != "" {
		for _, candidate := range writer.toolCalls {
			if candidate.callID == callID {
				state = candidate
				break
			}
		}
	}
	if state == nil {
		responseType := writer.providerToolTypes[name]
		if responseType == "" {
			responseType = responsesProviderResponseItemType(name)
		}
		ref := writer.toolRefs[name]
		state = &v2ResponsesToolState{
			itemID: "fc_" + randomDeviceID(), callID: firstText(callID, key), name: name,
			namespace: ref.Namespace, displayName: firstText(ref.Name, name),
			responseType: responseType, outputIndex: writer.nextOutputIndex,
		}
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
			if ref, ok := writer.toolRefs[name]; ok {
				state.namespace = ref.Namespace
				state.displayName = ref.Name
			}
		}
	}
	return state
}

func (writer *v2ResponsesWriter) toolItem(state *v2ResponsesToolState, status string) map[string]any {
	if state.responseType != "" {
		return writer.providerToolItem(state, status)
	}
	item := map[string]any{"id": state.itemID, "type": "function_call", "status": status, "call_id": state.callID, "name": firstText(state.displayName, state.name), "arguments": firstText(state.arguments, "{}")}
	if state.namespace != "" {
		item["namespace"] = state.namespace
	}
	return item
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
	for key, value := range input {
		switch key {
		case "type", "id", "callId", "call_id", "toolCallId", "tool_call_id":
			continue
		case "containerId":
			item["container_id"] = deepCopyJSON(value)
		case "pendingSafetyChecks":
			item["pending_safety_checks"] = deepCopyJSON(value)
		default:
			item[key] = deepCopyJSON(value)
		}
	}
	callID := firstText(input["callId"], input["call_id"], input["toolCallId"], input["tool_call_id"], state.callID)
	if callID != "" {
		item["call_id"] = callID
	}
	switch state.responseType {
	case "apply_patch_call":
		operation, _ := input["operation"].(map[string]any)
		if operation == nil {
			operation = map[string]any{"type": "update_file", "path": "", "diff": ""}
		}
		item["call_id"] = callID
		item["operation"] = operation
	case "shell_call", "local_shell_call":
		item["call_id"] = callID
		action, _ := input["action"].(map[string]any)
		if action == nil {
			action = map[string]any{}
		}
		item["action"] = action
	case "mcp_call":
		item["call_id"] = callID
		item["name"] = strings.TrimPrefix(state.name, "mcp.")
		item["arguments"] = input
		if state.result != nil {
			item["output"] = deepCopyJSON(state.result)
		}
	case "custom_tool_call":
		item["call_id"] = callID
		item["name"] = state.name
		item["input"] = firstText(input["input"], state.arguments)
	case "web_search_call":
		item["action"] = firstPresentValue(input["action"], map[string]any{})
	case "file_search_call":
		if state.result != nil {
			item["results"] = deepCopyJSON(state.result)
		}
	case "code_interpreter_call":
		if state.result != nil {
			item["outputs"] = deepCopyJSON(state.result)
		}
	case "image_generation_call":
		if state.result != nil {
			item["result"] = deepCopyJSON(state.result)
		}
	default:
		if state.result != nil {
			item["output"] = deepCopyJSON(state.result)
		}
	}
	return item
}

func (writer *v2ResponsesWriter) outputItem(key, status string) any {
	switch key {
	case "reasoning":
		item := writer.reasoningItem(status)
		item["summary"] = []any{map[string]any{"type": "summary_text", "text": strings.Join(writer.reasoningText, "")}}
		return item
	case "message":
		return map[string]any{"id": writer.messageID, "type": "message", "status": status, "role": "assistant", "content": []any{writer.outputTextContent()}}
	default:
		if strings.HasPrefix(key, "tool:") {
			return writer.toolItem(writer.toolCalls[strings.TrimPrefix(key, "tool:")], status)
		}
	}
	return nil
}

func (writer *v2ResponsesWriter) outputTextContent() map[string]any {
	content := map[string]any{"type": "output_text", "text": strings.Join(writer.outputText, ""), "annotations": []any{}}
	if writer.logprobsSeen {
		content["logprobs"] = deepCopyJSON(writer.textLogprobs)
	}
	return content
}

func mergeV2Logprobs(current, next any) any {
	if currentItems, ok := current.([]any); ok {
		if nextItems, ok := next.([]any); ok {
			return append(append([]any(nil), currentItems...), nextItems...)
		}
	}
	return deepCopyJSON(next)
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
		textDone := map[string]any{"type": "response.output_text.done", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "text": text}
		if writer.logprobsSeen {
			textDone["logprobs"] = deepCopyJSON(writer.textLogprobs)
		}
		writer.emit(textDone)
		writer.emit(map[string]any{"type": "response.content_part.done", "response_id": writer.responseID, "item_id": writer.messageID, "output_index": writer.textOutputIndex, "content_index": 0, "part": writer.outputTextContent()})
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
	status := "completed"
	eventType := "response.completed"
	if writer.incompleteReason != "" {
		status = "incomplete"
		eventType = "response.incomplete"
	}
	response := writer.base(status, items)
	writer.emit(map[string]any{"type": eventType, "response": response})
	return response
}

func (writer *v2ResponsesWriter) terminalError(compaction bool) error {
	if writer.incompleteReason != "" || len(writer.toolOrder) > 0 || strings.TrimSpace(strings.Join(writer.outputText, "")) != "" {
		return nil
	}
	if compaction && strings.TrimSpace(strings.Join(writer.reasoningText, "")) != "" {
		return nil
	}
	return errors.New("AI SDK completed without assistant text or tool call")
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
	var previousPrompt []any
	var inheritedCallNames map[string]string
	var err error
	if previousID := firstText(input["previous_response_id"]); previousID != "" {
		history, ok := s.responses.get(previousID)
		if !ok {
			writeResponsesError(response, http.StatusBadRequest, fmt.Sprintf("previous_response_id %q cannot be resolved", previousID))
			return
		}
		previousPrompt, err = history.promptWithOutput()
		if err != nil {
			writeResponsesError(response, http.StatusBadRequest, fmt.Sprintf("previous_response_id %q cannot be resolved: %v", previousID, err))
			return
		}
		inheritedCallNames = responsesFunctionCallNames(history.output)
	}
	conversion, err := responsesRequestToV3WithCallNames(input, inheritedCallNames)
	if err != nil {
		writeResponsesError(response, http.StatusBadRequest, err.Error())
		return
	}
	if len(previousPrompt) > 0 {
		currentPrompt, _ := conversion.payload["prompt"].([]any)
		conversion.payload["prompt"] = mergeV2ResponsePrompts(previousPrompt, currentPrompt)
	}
	frames, err := s.worker.Request(request.Context(), model.ID, conversion.effort, conversion.payload)
	if err != nil {
		logV2WorkerFailure(s.diagnosticWriter, summarizeV2Request(model.ID, conversion.effort, conversion.payload), err)
		writeResponsesError(response, http.StatusBadGateway, "Wanqing worker request failed")
		return
	}
	if stream, _ := input["stream"].(bool); stream {
		prompt, _ := conversion.payload["prompt"].([]any)
		s.writeResponsesStream(response, request, model.ID, input, prompt, frames, conversion.compaction, conversion.toolRefs,
			summarizeV2Request(model.ID, conversion.effort, conversion.payload))
		return
	}
	writer := newV2ResponsesWriter(nil, model.ID, input, conversion.toolRefs)
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
	if err := writer.terminalError(conversion.compaction); err != nil {
		logV2WorkerFailure(s.diagnosticWriter, summarizeV2Request(model.ID, conversion.effort, conversion.payload), err)
		writeResponsesError(response, http.StatusBadGateway, err.Error())
		return
	}
	result := writer.stop(conversion.compaction)
	s.responses.put(result, conversion.payload["prompt"])
	writeV2JSON(response, http.StatusOK, result)
}

func (s *proxyServer) writeResponsesStream(response http.ResponseWriter, request *http.Request, model string, payload map[string]any, prompt []any, frames <-chan workerFrame, compaction bool, toolRefs map[string]responsesToolRef, diagnostic v2RequestDiagnostic) {
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
	writer := newV2ResponsesWriter(&emitter, model, payload, toolRefs)
	writer.start()
	for frame := range frames {
		if err := writer.add(frame); err != nil {
			if request.Context().Err() == nil {
				logV2WorkerFailure(s.diagnosticWriter, diagnostic, err)
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
	if err := writer.terminalError(compaction); err != nil {
		if request.Context().Err() == nil {
			logV2WorkerFailure(s.diagnosticWriter, diagnostic, err)
			writer.fail(err)
			fmt.Fprint(response, "data: [DONE]\n\n")
			flusher.Flush()
		}
		return
	}
	result := writer.stop(compaction)
	s.responses.put(result, prompt)
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
