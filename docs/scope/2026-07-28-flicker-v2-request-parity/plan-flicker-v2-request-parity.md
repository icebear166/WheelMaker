# Flicker V2 Request Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flicker V2 look like MyFlicker at the Wanqing boundary where this is safe, while preserving every Claude Code tool, tool schema, cache block, and response payload.

**Architecture:** Keep all production behavior in `server/internal/flickerbridge/v2.go`. Build a request-scoped, collision-free tool-name bijection, perform exact identity/tool-reference replacements without restructuring system blocks, and carry the same mapping through request and response conversion. Extend the existing intercepted Node worker probes to classify fields and verify deterministic final Wanqing bodies without sending fixture prompts upstream.

**Tech Stack:** Go 1.24, `encoding/json`, existing embedded Node worker, MyFlicker CLI 0.3.12 AI SDK provider, Go tests and V2 self-tests.

---

### Task 1: Exact Prompt Rewriting and Collision-Free Tool Mapping

**Files:**
- Modify: `server/internal/flickerbridge/flicker_bridge_test.go`
- Modify: `server/internal/flickerbridge/v2.go`

- [ ] **Step 1: Write failing tests for exact prompt replacement and tool preservation**

Add these tests near the existing V2 tests in `flicker_bridge_test.go`:

```go
func TestV2CompatibilityMappingPreservesToolsAndAvoidsCollisions(t *testing.T) {
	tools := []anthropicTool{
		{Name: "Read", Description: "claude read", InputSchema: json.RawMessage(`{"type":"object","properties":{"file_path":{"type":"string"}}}`)},
		{Name: "mcp__demo__lookup", Description: "mcp", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "NotebookEdit", Description: "notebook", InputSchema: json.RawMessage(`{"type":"object"}`)},
	}
	mapping := buildV2ToolNameMapping(tools)
	got := mapV2Tools(tools, mapping)

	if got[0].Name != "read" || got[1].Name != "mcp__demo__lookup" || got[2].Name != "NotebookEdit" {
		t.Fatalf("mapped tool names = %q, %q, %q", got[0].Name, got[1].Name, got[2].Name)
	}
	for i := range tools {
		if got[i].Description != tools[i].Description ||
			string(got[i].InputSchema) != string(tools[i].InputSchema) {
			t.Fatalf("tool %d metadata changed: got=%+v want=%+v", i, got[i], tools[i])
		}
	}

	colliding := buildV2ToolNameMapping([]anthropicTool{
		{Name: "Agent", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "Task", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "task", InputSchema: json.RawMessage(`{"type":"object"}`)},
	})
	for _, name := range []string{"Agent", "Task", "task"} {
		if got := colliding.Upstream(name); got != name {
			t.Fatalf("collision mapped %q to %q", name, got)
		}
	}
}

func TestV2SystemRewriteChangesOnlyExactIdentityAndToolReferences(t *testing.T) {
	mapping := buildV2ToolNameMapping([]anthropicTool{
		{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "Write", InputSchema: json.RawMessage(`{"type":"object"}`)},
	})
	input := "You are Claude Code, Anthropic's official CLI.\n\nUse `Read` before `Write`.\n\nAnthropic documentation is readable."
	got := rewriteV2SystemText(input, mapping)
	want := "You are myflicker, the best coding agent on the planet.\n\nUse `read` before `write`.\n\nAnthropic documentation is readable."
	if got != want {
		t.Fatalf("rewriteV2SystemText() = %q, want %q", got, want)
	}

	nearMatch := "You are using Claude Code with Anthropic documentation."
	if got := rewriteV2SystemText(nearMatch, mapping); got != nearMatch {
		t.Fatalf("near-match changed: %q", got)
	}
}
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
go test ./internal/flickerbridge -run 'TestV2CompatibilityMapping|TestV2SystemRewrite' -count=1
```

Expected: compile failure because `buildV2ToolNameMapping`, `mapV2Tools`, and `rewriteV2SystemText` do not exist.

- [ ] **Step 3: Implement the request-scoped mapping and exact text rewrite**

Replace the mutable map-based helpers in `v2.go` with ordered aliases and a request-scoped bijection:

```go
type v2ToolAlias struct {
	Claude     string
	MyFlicker  string
}

var v2ToolAliases = []v2ToolAlias{
	{Claude: "Agent", MyFlicker: "task"},
	{Claude: "Task", MyFlicker: "task"},
	{Claude: "Bash", MyFlicker: "bash"},
	{Claude: "Read", MyFlicker: "read"},
	{Claude: "Edit", MyFlicker: "edit"},
	{Claude: "Write", MyFlicker: "write"},
	{Claude: "Glob", MyFlicker: "glob"},
	{Claude: "Grep", MyFlicker: "grep"},
	{Claude: "LS", MyFlicker: "ls"},
	{Claude: "WebFetch", MyFlicker: "fetch"},
	{Claude: "WebSearch", MyFlicker: "google_search"},
	{Claude: "TodoWrite", MyFlicker: "todoWrite"},
	{Claude: "BashOutput", MyFlicker: "task_output"},
	{Claude: "TaskOutput", MyFlicker: "task_output"},
	{Claude: "AgentOutputTool", MyFlicker: "task_output"},
	{Claude: "BashOutputTool", MyFlicker: "task_output"},
	{Claude: "KillShell", MyFlicker: "kill_task"},
	{Claude: "TaskStop", MyFlicker: "kill_task"},
	{Claude: "AskUserQuestion", MyFlicker: "AskUserQuestion"},
	{Claude: "Skill", MyFlicker: "skill"},
	{Claude: "EnterPlanMode", MyFlicker: "EnterPlanMode"},
	{Claude: "ExitPlanMode", MyFlicker: "ExitPlanMode"},
}

type v2ToolNameMapping struct {
	forward map[string]string
	reverse map[string]string
}

func (m v2ToolNameMapping) Upstream(name string) string {
	if mapped, ok := m.forward[name]; ok {
		return mapped
	}
	return name
}

func (m v2ToolNameMapping) Claude(name string) string {
	if mapped, ok := m.reverse[name]; ok {
		return mapped
	}
	return name
}

func v2ToolAliasTarget(name string) string {
	for _, alias := range v2ToolAliases {
		if alias.Claude == name {
			return alias.MyFlicker
		}
	}
	return name
}

func buildV2ToolNameMapping(tools []anthropicTool) v2ToolNameMapping {
	targetCounts := make(map[string]int, len(tools))
	for _, tool := range tools {
		targetCounts[v2ToolAliasTarget(tool.Name)]++
	}
	mapping := v2ToolNameMapping{
		forward: make(map[string]string),
		reverse: make(map[string]string),
	}
	for _, tool := range tools {
		target := v2ToolAliasTarget(tool.Name)
		if target == tool.Name || targetCounts[target] != 1 {
			continue
		}
		mapping.forward[tool.Name] = target
		mapping.reverse[target] = tool.Name
	}
	return mapping
}

func mapV2Tools(tools []anthropicTool, mapping v2ToolNameMapping) []anthropicTool {
	result := append([]anthropicTool(nil), tools...)
	for i := range result {
		result[i].Name = mapping.Upstream(result[i].Name)
	}
	return result
}

const myFlickerIdentityPrompt = "You are myflicker, the best coding agent on the planet."

var v2ClaudeIdentitySentences = []string{
	"You are Claude Code, Anthropic's official CLI.",
	"You are Claude Code, Anthropic's official CLI for Claude.",
}

func rewriteV2SystemText(text string, mapping v2ToolNameMapping) string {
	for _, identity := range v2ClaudeIdentitySentences {
		if strings.Contains(text, identity) {
			text = strings.Replace(text, identity, myFlickerIdentityPrompt, 1)
			break
		}
	}
	for _, alias := range v2ToolAliases {
		if mapping.Upstream(alias.Claude) != alias.MyFlicker {
			continue
		}
		text = strings.ReplaceAll(text, "`"+alias.Claude+"`", "`"+alias.MyFlicker+"`")
	}
	return text
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: both tests pass.

- [ ] **Step 5: Commit the pure compatibility helpers**

```powershell
git add server/internal/flickerbridge/v2.go server/internal/flickerbridge/flicker_bridge_test.go
git commit -m "refactor: add scoped flicker tool mapping"
```

### Task 2: Carry the Mapping Through Prompt, History, Tools, and Responses

**Files:**
- Modify: `server/internal/flickerbridge/flicker_bridge_test.go`
- Modify: `server/internal/flickerbridge/v2.go`

- [ ] **Step 1: Write a failing end-to-end conversion test**

Add:

```go
func TestV2RequestMappingRoundTripsWithoutChangingToolSchemas(t *testing.T) {
	var request anthropicMessagesRequest
	err := json.Unmarshal([]byte(`{
		"model":"claude-4.8-opus",
		"max_tokens":128,
		"system":[
			{"type":"text","text":"You are Claude Code, Anthropic's official CLI.","cache_control":{"type":"ephemeral"}},
			{"type":"text","text":"Use `Read`; leave Readable unchanged."}
		],
		"messages":[
			{"role":"user","content":"inspect"},
			{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"a.txt"}}]},
			{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]}
		],
		"tools":[{"name":"Read","description":"exact description","input_schema":{"type":"object","required":["file_path"]},"cache_control":{"type":"ephemeral"}}],
		"tool_choice":{"type":"tool","name":"Read"}
	}`), &request)
	if err != nil {
		t.Fatal(err)
	}
	converted, mapping, err := anthropicRequestToV3(request)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(converted)
	if err != nil {
		t.Fatal(err)
	}
	body := string(encoded)
	for _, expected := range []string{
		myFlickerIdentityPrompt,
		"`read`",
		`"name":"read"`,
		`"toolName":"read"`,
		`"description":"exact description"`,
		`"required":["file_path"]`,
		`"cacheControl":{"type":"ephemeral"}`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("converted body missing %q: %s", expected, body)
		}
	}
	if strings.Contains(body, myFlickerBasePrompt) || !strings.Contains(body, "Readable unchanged") {
		t.Fatalf("converted body changed unrelated system text: %s", body)
	}
	if mapping.Claude("read") != "Read" {
		t.Fatalf("reverse mapping = %q", mapping.Claude("read"))
	}
}
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
go test ./internal/flickerbridge -run TestV2RequestMappingRoundTripsWithoutChangingToolSchemas -count=1
```

Expected: compile failure because `anthropicRequestToV3` still returns two values and uses global mapping/base-prompt normalization.

- [ ] **Step 3: Change request conversion to return and reuse the mapping**

Change:

```go
func anthropicRequestToV3(request anthropicMessagesRequest) (map[string]any, v2ToolNameMapping, error)
```

At function entry:

```go
mapping := buildV2ToolNameMapping(request.Tools)
```

Return `nil, mapping, err` on errors and `options, mapping, nil` on success. Replace every `upstreamToolName(...)` call in request conversion with `mapping.Upstream(...)`. Replace tool conversion with:

```go
for _, tool := range mapV2Tools(request.Tools, mapping) {
	// Preserve description, schema, cache control and order exactly as before.
}
```

Replace `anthropicSystemToV3` with:

```go
func anthropicSystemToV3(raw json.RawMessage, mapping v2ToolNameMapping) ([]any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return []any{map[string]any{
			"role":    "system",
			"content": rewriteV2SystemText(text, mapping),
		}}, nil
	}
	var blocks []anthropicContentBlock
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return nil, errors.New("system must be a string or text block array")
	}
	result := make([]any, 0, len(blocks))
	for _, block := range blocks {
		if block.Type != "text" {
			return nil, fmt.Errorf("unsupported Anthropic system block: %s", block.Type)
		}
		message := map[string]any{
			"role":    "system",
			"content": rewriteV2SystemText(block.Text, mapping),
		}
		addCacheControl(message, block.CacheControl)
		result = append(result, message)
	}
	return result, nil
}
```

Use the same function for top-level system and `messages[].role == "system"` without injecting a base prompt.

- [ ] **Step 4: Pass the mapping into streamed and non-streamed response conversion**

Change signatures:

```go
func anthropicSSEFromV3(model string, frames <-chan workerFrame, mapping v2ToolNameMapping) (<-chan v2SSEEvent, <-chan error)
func streamAnthropicSSE(requestedModel string, frames <-chan workerFrame, events chan<- v2SSEEvent, mapping v2ToolNameMapping) error
func anthropicMessageFromV3(requestedModel string, frames <-chan workerFrame, mapping v2ToolNameMapping) (anthropicMessage, error)
```

Replace all response `reverseToolName(...)` calls with:

```go
mapping.Claude(v2StringValue(part["toolName"]))
```

In `handleMessages`, retain the mapping returned by `anthropicRequestToV3`, then pass it to `writeStream` or `anthropicMessageFromV3`. Update `writeStream` to accept the mapping. Tests and self-tests that do not need a rename pass `v2ToolNameMapping{}`; response tests that expect `read → Read` create the mapping from a `Read` tool.

- [ ] **Step 5: Run conversion tests and verify GREEN**

```powershell
go test ./internal/flickerbridge -run 'TestV2(RequestMapping|CompatibilityMapping|SystemRewrite)' -count=1
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test=prompt,tools,request-conversion,response-conversion,http
```

Expected: all selected tests/self-tests pass.

- [ ] **Step 6: Commit request/response integration**

```powershell
git add server/internal/flickerbridge/v2.go server/internal/flickerbridge/flicker_bridge_test.go
git commit -m "feat: preserve claude tools through flicker v2"
```

### Task 3: Classify Request Fields Without Blind Passthrough

**Files:**
- Modify: `server/internal/flickerbridge/flicker_bridge_test.go`
- Modify: `server/internal/flickerbridge/v2.go`

- [ ] **Step 1: Write a failing field-classification test**

Add:

```go
func TestV2RequestFieldsAreExplicitlyClassified(t *testing.T) {
	raw := json.RawMessage(`{
		"model":"claude-4.8-opus",
		"max_tokens":128,
		"system":"system",
		"messages":[{"role":"user","content":"hello"}],
		"tools":[],
		"tool_choice":{"type":"auto"},
		"temperature":0.2,
		"top_p":0.9,
		"top_k":10,
		"stop_sequences":["STOP"],
		"thinking":{"type":"enabled","budget_tokens":64},
		"stream":true,
		"output_config":{"effort":"high"},
		"metadata":{"user_id":"redacted"},
		"service_tier":"auto",
		"context_management":{"edits":[]}
	}`)
	classified, err := classifyV2RequestFields(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(classified.Unknown) != 0 {
		t.Fatalf("unknown fields = %v", classified.Unknown)
	}
	if !slices.Contains(classified.ProviderGenerated, "output_config") ||
		!slices.Contains(classified.Ignored, "metadata") ||
		!slices.Contains(classified.Ignored, "service_tier") ||
		!slices.Contains(classified.Ignored, "context_management") {
		t.Fatalf("classification = %+v", classified)
	}
}
```

- [ ] **Step 2: Run and verify RED**

```powershell
go test ./internal/flickerbridge -run TestV2RequestFieldsAreExplicitlyClassified -count=1
```

Expected: compile failure because `classifyV2RequestFields` does not exist.

- [ ] **Step 3: Add the explicit classification helper**

Add to `v2.go`:

```go
type v2RequestFieldClassification struct {
	Mapped            []string
	ProviderGenerated []string
	Ignored           []string
	Unknown           []string
}

var v2MappedRequestFields = map[string]struct{}{
	"model": {}, "max_tokens": {}, "system": {}, "messages": {},
	"tools": {}, "tool_choice": {}, "temperature": {}, "top_p": {},
	"top_k": {}, "stop_sequences": {}, "thinking": {}, "stream": {},
}

var v2ProviderGeneratedRequestFields = map[string]struct{}{
	"output_config": {},
}

var v2IntentionallyIgnoredRequestFields = map[string]struct{}{
	"metadata":           {},
	"service_tier":       {},
	"context_management": {},
}

func classifyV2RequestFields(raw json.RawMessage) (v2RequestFieldClassification, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return v2RequestFieldClassification{}, err
	}
	var result v2RequestFieldClassification
	for name := range fields {
		switch {
		case hasV2Field(v2MappedRequestFields, name):
			result.Mapped = append(result.Mapped, name)
		case hasV2Field(v2ProviderGeneratedRequestFields, name):
			result.ProviderGenerated = append(result.ProviderGenerated, name)
		case hasV2Field(v2IntentionallyIgnoredRequestFields, name):
			result.Ignored = append(result.Ignored, name)
		default:
			result.Unknown = append(result.Unknown, name)
		}
	}
	sort.Strings(result.Mapped)
	sort.Strings(result.ProviderGenerated)
	sort.Strings(result.Ignored)
	sort.Strings(result.Unknown)
	return result, nil
}

func hasV2Field(set map[string]struct{}, name string) bool {
	_, ok := set[name]
	return ok
}
```

This helper is audit/test code used on fixture bytes. Runtime decoding remains tolerant and must not reject a request solely because a newer Claude Code added a field.

- [ ] **Step 4: Add a `field-audit` V2 self-test**

Register `field-audit` in `runV2SelfTests`. The self-test passes the same fixture through `classifyV2RequestFields`, fails with unknown field names only, and never prints field values.

- [ ] **Step 5: Run and verify GREEN**

```powershell
go test ./internal/flickerbridge -run TestV2RequestFieldsAreExplicitlyClassified -count=1
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test=field-audit
```

Expected: PASS with no request values in output.

- [ ] **Step 6: Commit field audit**

```powershell
git add server/internal/flickerbridge/v2.go server/internal/flickerbridge/flicker_bridge_test.go
git commit -m "test: classify flicker v2 request fields"
```

### Task 4: Verify Final Wanqing Request Determinism

**Files:**
- Modify: `server/internal/flickerbridge/v2.go`
- Modify: `server/internal/flickerbridge/flicker_bridge_test.go`

- [ ] **Step 1: Write a failing deterministic-probe test**

Extend `outboundProbe` with a test-only body hash and add:

```go
func TestV2OutboundProbeBodyHashIsStable(t *testing.T) {
	first := hashV2ProbeBody(json.RawMessage(`{"tools":[],"system":[{"type":"text","text":"stable"}],"model":"m"}`))
	second := hashV2ProbeBody(json.RawMessage(`{"model":"m","system":[{"text":"stable","type":"text"}],"tools":[]}`))
	if first == "" || first != second {
		t.Fatalf("hashes = %q, %q", first, second)
	}
}
```

- [ ] **Step 2: Run and verify RED**

```powershell
go test ./internal/flickerbridge -run TestV2OutboundProbeBodyHashIsStable -count=1
```

Expected: compile failure because `hashV2ProbeBody` does not exist.

- [ ] **Step 3: Canonicalize intercepted JSON and emit only a hash/shape**

Add:

```go
func hashV2ProbeBody(raw json.RawMessage) string {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}
```

Add `BodyHash`, `SystemBlocks`, and `ToolNames` to `outboundProbe`. In the embedded Node interceptor, hash the parsed body with stable key ordering, count system blocks, and collect tool names; do not emit descriptions, schemas, prompt text, token/header values, or the complete body.

For each Anthropic/OpenAI/Responses format in `selfTestLiveFormats`, send the same fixture twice and assert:

```go
first.BodyHash == second.BodyHash
```

Also assert the MyFlicker identity is present through a boolean probe field and `Claude Code` identity is absent through another boolean; do not return the actual system text.

- [ ] **Step 4: Add an intercepted native MyFlicker reference capture**

Register `native-reference` in `runLiveSelfTests`. Resolve the installed `myflicker` binary and run quiet mode with a `NODE_OPTIONS=--import=data:text/javascript,...` preload. The preload must pass login/catalog requests through, intercept only `/rest/wanqing/api/gateway/`, emit a single sanitized marker, and return fixed Anthropic SSE:

```go
type v2NativeReference struct {
	ProductName       string   `json:"productName"`
	Version           string   `json:"version"`
	BodyKeys          []string `json:"bodyKeys"`
	ToolNames         []string `json:"toolNames"`
	HasNativeIdentity bool     `json:"hasNativeIdentity"`
}

func selfTestLiveNativeReference() error {
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		return err
	}
	entry := filepath.Join(settings.MyFlickerDir, "cli.mjs")
	command := exec.Command(
		settings.NodePath,
		entry,
		"-q",
		"--no-rules",
		"--approval-mode", "dontAsk",
		"--model", "claude-4.8-opus",
		"--output-format", "json",
		"Reply with capture-ok and do not use tools.",
	)
	command.Env = append(os.Environ(),
		"NODE_OPTIONS=--import=data:text/javascript,"+url.PathEscape(v2NativeCapturePreload),
	)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("native MyFlicker capture: %w", err)
	}
	const marker = "WM_NATIVE_CAPTURE="
	index := bytes.Index(output, []byte(marker))
	if index < 0 {
		return errors.New("native MyFlicker capture marker missing")
	}
	line := output[index+len(marker):]
	if end := bytes.IndexByte(line, '\n'); end >= 0 {
		line = line[:end]
	}
	var reference v2NativeReference
	if err := json.Unmarshal(line, &reference); err != nil {
		return fmt.Errorf("decode native MyFlicker capture: %w", err)
	}
	if reference.ProductName != "myflicker" ||
		reference.Version != "0.3.12" ||
		!reference.HasNativeIdentity ||
		len(reference.ToolNames) == 0 {
		return fmt.Errorf("unexpected native MyFlicker reference: %+v", reference)
	}
	return nil
}
```

Define `v2NativeCapturePreload` as a complete JS module next to `nodeWorkerSource`. It must:

```js
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  if (parsed.hostname !== "takumi.corp.kuaishou.com" ||
      !parsed.pathname.startsWith("/rest/wanqing/api/gateway/")) {
    return realFetch(url, init);
  }
  const body = JSON.parse(typeof init.body === "string"
    ? init.body
    : Buffer.from(init.body).toString("utf8"));
  const headers = new Headers(init.headers);
  const system = JSON.stringify(body.system ?? "");
  console.error("WM_NATIVE_CAPTURE=" + JSON.stringify({
    productName: headers.get("x-takumi-product-name"),
    version: headers.get("x-takumi-version"),
    bodyKeys: Object.keys(body).sort(),
    toolNames: (body.tools ?? []).map(tool => tool.name).sort(),
    hasNativeIdentity: system.includes(
      "You are myflicker, the best coding agent on the planet."
    ),
  }));
  const model = String(body.model || "Claude Opus 4.8");
  const events = [
    ["message_start", {type:"message_start", message:{id:"msg_capture",type:"message",role:"assistant",model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:3,output_tokens:0}}}],
    ["content_block_start", {type:"content_block_start",index:0,content_block:{type:"text",text:""}}],
    ["content_block_delta", {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"capture-ok"}}],
    ["content_block_stop", {type:"content_block_stop",index:0}],
    ["message_delta", {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}}],
    ["message_stop", {type:"message_stop"}],
  ];
  return new Response(
    events.map(([event, data]) =>
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    ).join(""),
    {status:200, headers:{"content-type":"text/event-stream"}},
  );
};
```

The marker contains only names, keys, booleans and public version/product metadata. It must never contain prompt text, schemas, token/header values or the complete body.

- [ ] **Step 5: Run unit and intercepted live-format/reference tests**

```powershell
go test ./internal/flickerbridge -run TestV2OutboundProbeBodyHashIsStable -count=1
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test-live=native-reference,formats
```

Expected: PASS for all three formats. The live-format command may perform MyFlicker login/catalog discovery, but its fixture gateway calls are intercepted and never reach Wanqing.

- [ ] **Step 6: Commit deterministic probe coverage**

```powershell
git add server/internal/flickerbridge/v2.go server/internal/flickerbridge/flicker_bridge_test.go
git commit -m "test: verify flicker v2 request stability"
```

### Task 5: Regression Verification and Documentation

**Files:**
- Modify: `docs/wiki/protocols/acp.md`
- Create: `docs/scope/2026-07-28-flicker-v2-request-parity/spec-flicker-v2-request-parity.md`
- Create: `docs/scope/2026-07-28-flicker-v2-request-parity/plan-flicker-v2-request-parity.md`

- [ ] **Step 1: Run all V2 self-tests**

```powershell
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test=all
```

Expected: settings, models, prompt, tools, worker-transport, request-conversion, response-conversion, field-audit, and HTTP all pass.

- [ ] **Step 2: Run scoped Go tests and vet**

```powershell
go test ./internal/flickerbridge ./internal/hub/agent ./internal/hub -count=1
go vet ./internal/flickerbridge ./internal/hub/agent ./internal/hub
```

Expected: PASS with no vet findings.

- [ ] **Step 3: Run the complete server test suite**

```powershell
go test ./... -count=1
```

Expected: all server packages pass.

- [ ] **Step 4: Run the final live-format interception**

```powershell
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test-live=all
```

Expected: catalog and formats pass; no fixture prompt reaches Wanqing.

- [ ] **Step 5: Check documentation and worktree quality**

```powershell
rg -n "TB[D]|TO[D]O|implement lat[e]r" docs/scope/2026-07-28-flicker-v2-request-parity
git diff --check
git status --short
```

Expected: no placeholders, no whitespace errors, and only the intended V2/test/spec/wiki/plan files changed.

- [ ] **Step 6: Commit and push the complete change**

```powershell
git add -A
git commit -m "feat: align flicker v2 request identity"
git push origin main
```
