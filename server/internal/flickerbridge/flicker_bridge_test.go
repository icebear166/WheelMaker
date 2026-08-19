package flickerbridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type failingResponseWriter struct {
	header http.Header
	err    error
}

func TestMain(m *testing.M) {
	if os.Getenv("WHEELMAKER_V2_TEST_WORKER") == "1" {
		if err := RunV2([]string{"--test-worker"}); err != nil {
			_, _ = fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		os.Exit(0)
	}
	if strings.EqualFold(filepath.Base(os.Args[0]), "powershell.exe") &&
		os.Getenv("WHEELMAKER_TEST_POWERSHELL_PROBE") == "1" {
		marker := os.Getenv("WHEELMAKER_TEST_POWERSHELL_MARKER")
		file, err := os.OpenFile(marker, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			os.Exit(2)
		}
		_, err = file.WriteString("call\n")
		_ = file.Close()
		if err != nil {
			os.Exit(2)
		}
		if output := os.Getenv("WHEELMAKER_TEST_POWERSHELL_OUTPUT"); output != "" {
			_, _ = fmt.Fprintln(os.Stdout, output)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func installPowerShellProbe(t *testing.T, output string) string {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	helper := filepath.Join(directory, "powershell.exe")
	if err := os.WriteFile(helper, binary, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(directory, "calls.log")
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("WHEELMAKER_TEST_POWERSHELL_PROBE", "1")
	t.Setenv("WHEELMAKER_TEST_POWERSHELL_MARKER", marker)
	t.Setenv("WHEELMAKER_TEST_POWERSHELL_OUTPUT", output)
	return marker
}

func powerShellProbeCalls(t *testing.T, marker string) int {
	t.Helper()
	data, err := os.ReadFile(marker)
	if errors.Is(err, os.ErrNotExist) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Count(string(data), "call\n")
}

func TestProbeV2RejectsMissingNodeWithoutLeakingEnvironment(t *testing.T) {
	t.Setenv("MYFLICKER_NODE", filepath.Join(t.TempDir(), "missing-node.exe"))
	t.Setenv("MYFLICKER_WANQING_PROXY_KEY", "must-not-leak")
	result := ProbeV2()
	if result.Available {
		t.Fatalf("ProbeV2()=%+v, want unavailable", result)
	}
	if result.Error == "" {
		t.Fatalf("ProbeV2()=%+v, want sanitized error", result)
	}
	if strings.Contains(result.Error, "must-not-leak") {
		t.Fatalf("ProbeV2() leaked the local key: %+v", result)
	}
}

func TestParseSettingsDefaultsToMyFlickerOpus5(t *testing.T) {
	settings, err := parseSettings(nil, map[string]string{})
	if err != nil {
		t.Fatalf("parseSettings: %v", err)
	}
	if settings.DefaultModel != "CLAUDE_OPUS_5" {
		t.Fatalf("default model = %q, want CLAUDE_OPUS_5", settings.DefaultModel)
	}
}

func TestProbeV2RejectsMyFlicker0313Bundle(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skipf("node is unavailable: %v", err)
	}
	packageDir := filepath.Join(t.TempDir(), "node_modules", "@myflicker", "cli")
	if err := os.MkdirAll(filepath.Join(packageDir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(packageDir, "package.json"),
		[]byte(`{"name":"@myflicker/cli","version":"0.3.13"}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(packageDir, "dist", "cli.mjs"),
		[]byte(`g0();var Ld1=jA(O1(),1);import rF4 from"fs";`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MYFLICKER_NODE", nodePath)
	t.Setenv("MYFLICKER_CLI_DIR", packageDir)

	result := ProbeV2()
	if result.Available || result.Error != "unsupported @myflicker/cli version" {
		t.Fatalf("ProbeV2() = %+v, want MyFlicker 0.3.13 rejected", result)
	}
}

func TestProbeV2AcceptsMyFlicker0316Bundle(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skipf("node is unavailable: %v", err)
	}
	packageDir := filepath.Join(t.TempDir(), "node_modules", "@myflicker", "cli")
	if err := os.MkdirAll(filepath.Join(packageDir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(packageDir, "package.json"),
		[]byte(`{"name":"@myflicker/cli","version":"0.3.16"}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(packageDir, "dist", "cli.mjs"),
		[]byte(`LQ();var UM4=H0(l4(),1);import vd2 from"fs";`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MYFLICKER_NODE", nodePath)
	t.Setenv("MYFLICKER_CLI_DIR", packageDir)

	result := ProbeV2()
	if !result.Available || result.MyFlickerVersion != "0.3.16" {
		t.Fatalf("ProbeV2() = %+v, want available MyFlicker 0.3.16", result)
	}
}

func TestProbeV2RejectsObsoleteMyFlickerVersions(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skipf("node is unavailable: %v", err)
	}
	for _, version := range []string{"0.3.15", "0.3.16-beta.2"} {
		t.Run(version, func(t *testing.T) {
			packageDir := filepath.Join(t.TempDir(), "node_modules", "@myflicker", "cli")
			if err := os.MkdirAll(filepath.Join(packageDir, "dist"), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(
				filepath.Join(packageDir, "package.json"),
				[]byte(fmt.Sprintf(`{"name":"@myflicker/cli","version":%q}`, version)),
				0o644,
			); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(
				filepath.Join(packageDir, "dist", "cli.mjs"),
				[]byte(v2BundleAnchor),
				0o644,
			); err != nil {
				t.Fatal(err)
			}
			t.Setenv("MYFLICKER_NODE", nodePath)
			t.Setenv("MYFLICKER_CLI_DIR", packageDir)

			result := ProbeV2()
			if result.Available || result.Error != "unsupported @myflicker/cli version" {
				t.Fatalf("ProbeV2() = %+v, want MyFlicker %s rejected", result, version)
			}
		})
	}
}

func TestProbeV2RejectsMyFlicker0312(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skipf("node is unavailable: %v", err)
	}
	packageDir := filepath.Join(t.TempDir(), "node_modules", "@myflicker", "cli")
	if err := os.MkdirAll(filepath.Join(packageDir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(packageDir, "package.json"),
		[]byte(`{"name":"@myflicker/cli","version":"0.3.12"}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(packageDir, "dist", "cli.mjs"),
		[]byte(`j0();var mm1=PA(q1(),1);import fJ4 from"fs";`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MYFLICKER_NODE", nodePath)
	t.Setenv("MYFLICKER_CLI_DIR", packageDir)

	result := ProbeV2()
	if result.Available || result.Error != "unsupported @myflicker/cli version" {
		t.Fatalf("ProbeV2() = %+v, want MyFlicker 0.3.12 rejected", result)
	}
}

func TestV2WorkerLoadsMyFlicker0316BundleContract(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skipf("node is unavailable: %v", err)
	}
	packageDir := filepath.Join(t.TempDir(), "node_modules", "@myflicker", "cli")
	if err := os.MkdirAll(filepath.Join(packageDir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(packageDir, "package.json"),
		[]byte(`{"name":"@myflicker/cli","version":"0.3.16","type":"module"}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	bundle := `
let appContext = {};
function LQ() {}
const R6 = () => appContext;
const hE = (value) => { appContext = value; };
async function Ej2() {
  return {login: {}, userInfo: {token: "test-token"}};
}
const g0A = {};
function e5A() {}
function WfA() {}
const QAQ = {
  async initialized() {},
  provider() {
    return {
      wanqing: {
        models: {
          "claude-opus-5": {
            name: "Claude Opus 5",
            apiFormat: "anthropic",
            defaultThinkingLevel: "medium",
            variants: {
              low: {effort: "low"},
              medium: {effort: "medium"},
              high: {effort: "high"},
              xhigh: {effort: "xhigh"},
              max: {effort: "max"}
            }
          },
          "claude-5-sonnet": {
            name: "Claude Sonnet 5",
            apiFormat: "anthropic",
            hidden: true,
            variants: {
              low: {effort: "low"},
              medium: {effort: "medium"},
              high: {effort: "high"},
              max: {effort: "max"}
            }
          },
          "deepseek-v4-pro-0813": {
            name: "DeepSeek V4 Pro 0813",
            epModelName: "DeepSeek-V4-Pro-0813",
            apiFormat: "openai",
            defaultThinkingLevel: "high",
            variants: {high: {reasoning: {enabled: true, effort: "high"}}}
          },
          "deepseek-v4-flash-0731": {
            name: "DeepSeek V4 Flash 0731",
            epModelName: "DeepSeek-V4-Flash 0731",
            apiFormat: "openai",
            defaultThinkingLevel: "high",
            inputModalities: ["text"],
            supportsTools: true,
            supportsParallelToolCalls: true,
            variants: {high: {reasoning: {enabled: true, effort: "high"}}}
          }
        },
        async createModel() {
          return {};
        }
      }
    };
  }
};
LQ();var UM4=H0(l4(),1);import vd2 from"fs";
`
	if err := os.WriteFile(filepath.Join(packageDir, "dist", "cli.mjs"), []byte(bundle), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	worker, err := startWorker(ctx, nodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + packageDir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	ready, err := worker.Ready(ctx)
	if err != nil {
		t.Fatalf("worker Ready: %v", err)
	}
	if ready.MyFlickerVersion != "0.3.16" {
		t.Fatalf("worker version = %q, want 0.3.16", ready.MyFlickerVersion)
	}
	if len(ready.Catalog) != 4 ||
		ready.Catalog[0].ID != "claude-opus-5" ||
		!slices.Equal(v2StringSlice(ready.Catalog[0].Metadata["effortLevels"]), []string{"low", "medium", "high", "xhigh", "max"}) {
		t.Fatalf("worker catalog = %#v, want Claude and DeepSeek 0.3.16 catalog", ready.Catalog)
	}
	var flash modelInfo
	for _, model := range ready.Catalog {
		if model.ID == "deepseek-v4-flash-0731" {
			flash = model
			break
		}
	}
	if !slices.Equal(v2StringSlice(flash.Metadata["inputModalities"]), []string{"text", "image"}) ||
		flash.Metadata["supportsImages"] != true ||
		flash.Metadata["supportsTools"] != true || flash.Metadata["supportsParallelToolCalls"] != true {
		t.Fatalf("flash capabilities = %#v", flash.Metadata)
	}
	index, err := buildModelIndex(ready.Catalog, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := index.Resolve("claude-opus-5"); !ok {
		t.Fatal("Claude Opus 5 is missing from the exposed model index")
	}
	if _, ok := index.Resolve("claude-5-sonnet"); ok {
		t.Fatal("hidden Claude Sonnet 5 was exposed")
	}
	for _, requested := range []string{"deepseek-v4-pro-0813", "DeepSeek-V4-Pro-0813", "deepseek-v4-flash-0731", "DeepSeek-V4-Flash 0731"} {
		if _, ok := index.Resolve(requested); !ok {
			t.Fatalf("0.3.16 model catalog did not resolve %q: %#v", requested, ready.Catalog)
		}
	}
	if _, ok := index.Resolve("glm-5.3"); ok {
		t.Fatal("glm-5.3 was force-added even though it is not in the 0.3.16 Wanqing catalog")
	}
}

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

func TestV2SystemRewriteReplacesInteractiveAgentIdentity(t *testing.T) {
	input := "You are an interactive agent that helps users with software engineering tasks."
	want := "You are myflicker, the best coding agent on the planet."

	if got := rewriteV2SystemText(input, buildV2ToolNameMapping(nil)); got != want {
		t.Fatalf("rewriteV2SystemText() = %q, want %q", got, want)
	}
}

func TestV2RequestMappingRoundTripsWithoutChangingToolSchemas(t *testing.T) {
	var request anthropicMessagesRequest
	err := json.Unmarshal([]byte(`{
		"model":"claude-4.8-opus",
		"max_tokens":128,
		"system":[
			{"type":"text","text":"You are Claude Code, Anthropic's official CLI.","cache_control":{"type":"ephemeral"}},
			{"type":"text","text":"Use `+"`Read`"+`; leave Readable unchanged."}
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
	const legacyBasePrompt = "You are MyFlicker, an interactive coding agent."
	if strings.Contains(body, legacyBasePrompt) || !strings.Contains(body, "Readable unchanged") {
		t.Fatalf("converted body changed unrelated system text: %s", body)
	}
	if mapping.Claude("read") != "Read" {
		t.Fatalf("reverse mapping = %q", mapping.Claude("read"))
	}
}

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
	if !slices.Contains(classified.Mapped, "output_config") ||
		!slices.Contains(classified.Ignored, "metadata") ||
		!slices.Contains(classified.Ignored, "service_tier") ||
		!slices.Contains(classified.Ignored, "context_management") {
		t.Fatalf("classification = %+v", classified)
	}
}

func TestV2ReadsClaudeCodeOutputEffort(t *testing.T) {
	var request anthropicMessagesRequest
	if err := json.Unmarshal([]byte(`{
		"model":"gpt-5.6-sol",
		"max_tokens":128,
		"messages":[{"role":"user","content":"hello"}],
		"output_config":{"effort":"xhigh"}
	}`), &request); err != nil {
		t.Fatal(err)
	}
	if got := requestedAnthropicEffort(request); got != "xhigh" {
		t.Fatalf("requested effort = %q, want xhigh", got)
	}
}

func TestV2WorkerCatalogExportsModelEffortCapabilities(t *testing.T) {
	for _, expected := range []string{
		"effortLevels: Object.keys(variants)",
		"defaultThinkingLevel: String(source.defaultThinkingLevel || \"\")",
	} {
		if !strings.Contains(nodeWorkerSource, expected) {
			t.Fatalf("worker catalog is missing %q", expected)
		}
	}
}

func TestV2WorkerAppliesMyFlickerModelVariant(t *testing.T) {
	for _, expected := range []string{
		"function resolveModelEffort(metadata, requested)",
		"const variant = variants[effort]",
		"providerOptions.wanqing = {...wanqing, ...variant}",
	} {
		if !strings.Contains(nodeWorkerSource, expected) {
			t.Fatalf("worker effort forwarding is missing %q", expected)
		}
	}
}

func TestV2WorkerEmitsStructuredFailureDiagnostics(t *testing.T) {
	for _, expected := range []string{
		"function diagnoseError(error)",
		"errorStatus:diagnostic.status",
		"errorFingerprint:diagnostic.fingerprint",
	} {
		if !strings.Contains(nodeWorkerSource, expected) {
			t.Fatalf("worker failure diagnostics are missing %q", expected)
		}
	}
}

func TestV2WorkerFailureDiagnosticSummarizesRequestAndRedactsSecrets(t *testing.T) {
	payload := map[string]any{
		"prompt": []any{
			map[string]any{"role": "system", "content": "system"},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "text", "text": "inspect"},
				map[string]any{
					"type":      "file",
					"mediaType": "image/png",
					"data":      "QUJDREVGRw==",
				},
			}},
		},
		"tools": []any{map[string]any{"type": "function", "name": "read"}},
	}
	diagnostic := summarizeV2Request("kimi-k3", "max", payload)
	if diagnostic.PromptMessages != 2 ||
		diagnostic.PromptParts != 3 ||
		diagnostic.ImageParts != 1 ||
		diagnostic.ImageDataChars != 12 ||
		diagnostic.ToolCount != 1 ||
		diagnostic.PayloadBytes == 0 {
		t.Fatalf("request diagnostic = %+v", diagnostic)
	}

	frame := workerFrame{
		Type:             "error",
		RequestID:        "req-19",
		Error:            `upstream rejected Authorization: Bearer secret-token data:image/png;base64,QUJDREVGRw==`,
		ErrorName:        "AI_APICallError",
		ErrorCode:        "invalid_request",
		ErrorStatus:      http.StatusBadRequest,
		ErrorFingerprint: "abc123",
	}
	var output bytes.Buffer
	logV2WorkerFailure(&output, diagnostic, &workerRequestError{frame: frame})
	logged := output.String()
	for _, expected := range []string{
		"model=\"kimi-k3\"",
		"effort=\"max\"",
		"promptMessages=2",
		"promptParts=3",
		"imageParts=1",
		"imageDataChars=12",
		"tools=1",
		"status=400",
		"name=\"AI_APICallError\"",
		"code=\"invalid_request\"",
		"fingerprint=\"abc123\"",
	} {
		if !strings.Contains(logged, expected) {
			t.Fatalf("diagnostic log missing %q: %s", expected, logged)
		}
	}
	for _, secret := range []string{"secret-token", "QUJDREVGRw=="} {
		if strings.Contains(logged, secret) {
			t.Fatalf("diagnostic log leaked %q: %s", secret, logged)
		}
	}
}

func TestV2StreamFailureIsDetailedLocallyAndGenericToClaudeCode(t *testing.T) {
	var diagnosticLog bytes.Buffer
	server := &proxyServer{diagnosticWriter: &diagnosticLog}
	frames := make(chan workerFrame, 1)
	frames <- workerFrame{
		Type:             "error",
		RequestID:        "req-27",
		Error:            "upstream rejected the final tool result",
		ErrorName:        "AI_APICallError",
		ErrorCode:        "invalid_request",
		ErrorStatus:      http.StatusBadRequest,
		ErrorFingerprint: "def456",
	}
	close(frames)

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	server.writeStream(
		response,
		request,
		"kimi-k3",
		frames,
		v2ToolNameMapping{},
		v2RequestDiagnostic{Model: "kimi-k3", Effort: "max", PayloadBytes: 512000},
	)

	clientBody := response.Body.String()
	if !strings.Contains(clientBody, "Wanqing worker request failed") {
		t.Fatalf("client error = %s", clientBody)
	}
	if strings.Contains(clientBody, "final tool result") ||
		!strings.Contains(diagnosticLog.String(), "upstream rejected the final tool result") ||
		!strings.Contains(diagnosticLog.String(), "status=400") {
		t.Fatalf("client=%s diagnostic=%s", clientBody, diagnosticLog.String())
	}
}

func TestV2OutboundProbeBodyHashIsStable(t *testing.T) {
	first := hashV2ProbeBody(json.RawMessage(`{"tools":[],"system":[{"type":"text","text":"stable"}],"model":"m"}`))
	second := hashV2ProbeBody(json.RawMessage(`{"model":"m","system":[{"text":"stable","type":"text"}],"tools":[]}`))
	if first == "" || first != second {
		t.Fatalf("hashes = %q, %q", first, second)
	}
}

func TestV2HealthReportsLoadedMyFlickerVersion(t *testing.T) {
	worker := &versionedHealthWorker{version: "0.3.16"}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		ModelBlacklist: map[string]struct{}{},
	}, worker, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/_myflicker/health", nil)
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("health status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		MyFlickerVersion string `json:"myflickerVersion"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.MyFlickerVersion != "0.3.16" {
		t.Fatalf("health version = %q, want loaded worker version 0.3.16", payload.MyFlickerVersion)
	}
}

type versionedHealthWorker struct {
	version string
}

func (*versionedHealthWorker) Request(
	context.Context,
	string,
	string,
	any,
) (<-chan workerFrame, error) {
	return nil, errors.New("unexpected request")
}

func (w *versionedHealthWorker) MyFlickerVersion() string {
	return w.version
}

func TestV2MessagesPassesOutputEffortToWorker(t *testing.T) {
	worker := &effortCaptureWorker{}
	proxy, err := newProxyServer(proxySettings{
		Host:           "127.0.0.1",
		Port:           17999,
		MaxRequestSize: 1 << 20,
	}, worker, []modelInfo{{
		ID: "gpt-5.6-sol", Name: "GPT 5.6 Sol", APIFormat: "responses",
	}})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{
		"model":"gpt-5.6-sol",
		"max_tokens":32,
		"messages":[{"role":"user","content":"hello"}],
		"output_config":{"effort":"xhigh"}
	}`))
	response := httptest.NewRecorder()
	proxy.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if worker.effort != "xhigh" {
		t.Fatalf("worker effort = %q, want xhigh", worker.effort)
	}
}

type effortCaptureWorker struct {
	effort string
}

func (w *effortCaptureWorker) Request(
	_ context.Context,
	_, effort string,
	_ any,
) (<-chan workerFrame, error) {
	w.effort = effort
	frames := make(chan workerFrame, 8)
	for _, part := range []string{
		`{"type":"response-metadata","id":"msg_effort","modelId":"gpt-5.6-sol"}`,
		`{"type":"text-start","id":"0"}`,
		`{"type":"text-delta","id":"0","delta":"ok"}`,
		`{"type":"text-end","id":"0"}`,
		`{"type":"finish","finishReason":{"unified":"stop","raw":"stop"},"usage":{"inputTokens":{"total":1},"outputTokens":{"total":1}}}`,
	} {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	return frames, nil
}

func TestV2MixedToolResultAndTextAreSplitInBlockOrder(t *testing.T) {
	var request anthropicMessagesRequest
	if err := json.Unmarshal([]byte(`{
		"max_tokens":128,
		"messages":[
			{"role":"assistant","content":[
				{"type":"tool_use","id":"toolu_read","name":"Read","input":{"file_path":"a.txt"}},
				{"type":"tool_use","id":"toolu_write","name":"Write","input":{"file_path":"b.txt","content":"b"}}
			]},
			{"role":"user","content":[
				{"type":"text","text":"before","cache_control":{"type":"ephemeral"}},
				{"type":"tool_result","tool_use_id":"toolu_read","content":"read"},
				{"type":"tool_result","tool_use_id":"toolu_write","content":"written","is_error":true},
				{"type":"text","text":"after"}
			]}
		],
		"tools":[
			{"name":"Read","description":"read","input_schema":{"type":"object"}},
			{"name":"Write","description":"write","input_schema":{"type":"object"}}
		]
	}`), &request); err != nil {
		t.Fatal(err)
	}
	converted, _, err := anthropicRequestToV3(request)
	if err != nil {
		t.Fatal(err)
	}
	prompt, _ := converted["prompt"].([]any)
	roles := make([]string, 0, len(prompt))
	for _, rawMessage := range prompt {
		message, _ := rawMessage.(map[string]any)
		roles = append(roles, firstText(message["role"]))
	}
	if !slices.Equal(roles, []string{"assistant", "user", "tool", "user"}) {
		t.Fatalf("roles = %v, want [assistant user tool user]", roles)
	}
	before := prompt[1].(map[string]any)["content"].([]any)
	if firstText(before[0].(map[string]any)["text"]) != "before" ||
		before[0].(map[string]any)["providerOptions"] == nil {
		t.Fatalf("first user segment = %#v", before)
	}
	results := prompt[2].(map[string]any)["content"].([]any)
	if len(results) != 2 ||
		firstText(results[0].(map[string]any)["toolName"]) != "read" ||
		firstText(results[1].(map[string]any)["toolName"]) != "write" {
		t.Fatalf("tool segment = %#v", results)
	}
	after := prompt[3].(map[string]any)["content"].([]any)
	if firstText(after[0].(map[string]any)["text"]) != "after" {
		t.Fatalf("last user segment = %#v", after)
	}
}

func TestV2ToolResultFollowedByUserTextDoesNotFail(t *testing.T) {
	var request anthropicMessagesRequest
	if err := json.Unmarshal([]byte(`{
		"max_tokens":128,
		"messages":[
			{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"a.txt"}}]},
			{"role":"user","content":[
				{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"},
				{"type":"text","text":"continue"}
			]}
		],
		"tools":[{"name":"Read","description":"read","input_schema":{"type":"object"}}]
	}`), &request); err != nil {
		t.Fatal(err)
	}
	converted, _, err := anthropicRequestToV3(request)
	if err != nil {
		t.Fatal(err)
	}
	prompt, _ := converted["prompt"].([]any)
	roles := make([]string, 0, len(prompt))
	for _, rawMessage := range prompt {
		message, _ := rawMessage.(map[string]any)
		roles = append(roles, firstText(message["role"]))
	}
	if !slices.Equal(roles, []string{"assistant", "tool", "user"}) {
		t.Fatalf("roles = %v, want [assistant tool user]", roles)
	}
}

func TestV2ToolResultImageMapsToV3MediaInBlockOrder(t *testing.T) {
	var request anthropicMessagesRequest
	if err := json.Unmarshal([]byte(`{
		"max_tokens":128,
		"messages":[
			{"role":"assistant","content":[
				{"type":"tool_use","id":"toolu_image","name":"Read","input":{"file_path":"image.png"}}
			]},
			{"role":"user","content":[
				{"type":"tool_result","tool_use_id":"toolu_image","content":[
					{"type":"text","text":"before"},
					{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"AA=="}},
					{"type":"text","text":"after"}
				]}
			]}
		],
		"tools":[{"name":"Read","description":"read","input_schema":{"type":"object"}}]
	}`), &request); err != nil {
		t.Fatal(err)
	}

	converted, _, err := anthropicRequestToV3(request)
	if err != nil {
		t.Fatal(err)
	}
	prompt := converted["prompt"].([]any)
	toolMessage := prompt[1].(map[string]any)
	toolResult := toolMessage["content"].([]any)[0].(map[string]any)
	output := toolResult["output"].(map[string]any)
	if firstText(output["type"]) != "content" {
		t.Fatalf("output type = %#v, want content", output["type"])
	}
	value := output["value"].([]any)
	if len(value) != 3 {
		t.Fatalf("output value = %#v, want three ordered parts", value)
	}
	if firstText(value[0].(map[string]any)["type"]) != "text" ||
		firstText(value[0].(map[string]any)["text"]) != "before" {
		t.Fatalf("first output part = %#v", value[0])
	}
	media := value[1].(map[string]any)
	if firstText(media["type"]) != "media" ||
		firstText(media["mediaType"]) != "image/jpeg" ||
		firstText(media["data"]) != "AA==" {
		t.Fatalf("image output part = %#v", media)
	}
	if firstText(value[2].(map[string]any)["type"]) != "text" ||
		firstText(value[2].(map[string]any)["text"]) != "after" {
		t.Fatalf("last output part = %#v", value[2])
	}
}

func TestV2DropsEmptyThinkingHistoryWithoutChangingSemanticContent(t *testing.T) {
	var request anthropicMessagesRequest
	if err := json.Unmarshal([]byte(`{
		"max_tokens":128,
		"messages":[
			{"role":"user","content":"before"},
			{"role":"assistant","content":[{"type":"thinking","thinking":"","signature":""}]},
			{"role":"user","content":"after"},
			{"role":"assistant","content":[
				{"type":"thinking","thinking":"","signature":""},
				{"type":"text","text":"kept"}
			]}
		]
	}`), &request); err != nil {
		t.Fatal(err)
	}

	converted, _, err := anthropicRequestToV3(request)
	if err != nil {
		t.Fatal(err)
	}
	prompt, _ := converted["prompt"].([]any)
	if len(prompt) != 3 {
		t.Fatalf("prompt = %#v, want empty-thinking-only assistant omitted", prompt)
	}
	roles := make([]string, 0, len(prompt))
	for _, rawMessage := range prompt {
		message, _ := rawMessage.(map[string]any)
		roles = append(roles, firstText(message["role"]))
	}
	if !slices.Equal(roles, []string{"user", "user", "assistant"}) {
		t.Fatalf("roles = %v, want [user user assistant]", roles)
	}
	assistant := prompt[2].(map[string]any)["content"].([]any)
	if len(assistant) != 1 ||
		firstText(assistant[0].(map[string]any)["type"]) != "text" ||
		firstText(assistant[0].(map[string]any)["text"]) != "kept" {
		t.Fatalf("assistant content = %#v, want only semantic text", assistant)
	}
}

func TestV2AnthropicBase64ImageMapsToV3FileInBlockOrder(t *testing.T) {
	var request anthropicMessagesRequest
	if err := json.Unmarshal([]byte(`{
		"max_tokens":128,
		"messages":[{
			"role":"user",
			"content":[
				{"type":"text","text":"before"},
				{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AA=="}},
				{"type":"text","text":"after"}
			]
		}]
	}`), &request); err != nil {
		t.Fatal(err)
	}

	converted, _, err := anthropicRequestToV3(request)
	if err != nil {
		t.Fatal(err)
	}
	prompt, _ := converted["prompt"].([]any)
	if len(prompt) != 1 {
		t.Fatalf("prompt length = %d, want 1", len(prompt))
	}
	content, _ := prompt[0].(map[string]any)["content"].([]any)
	if len(content) != 3 {
		t.Fatalf("content = %#v, want three ordered parts", content)
	}
	image, _ := content[1].(map[string]any)
	if firstText(content[0].(map[string]any)["text"]) != "before" ||
		firstText(image["type"]) != "file" ||
		firstText(image["mediaType"]) != "image/png" ||
		firstText(image["data"]) != "AA==" ||
		firstText(content[2].(map[string]any)["text"]) != "after" {
		t.Fatalf("content = %#v", content)
	}
}

func TestV2ClaudeCodeSmoke(t *testing.T) {
	if os.Getenv("WHEELMAKER_V2_CLAUDE_SMOKE") != "1" {
		t.Skip("set WHEELMAKER_V2_CLAUDE_SMOKE=1 to run the live Claude Code smoke test")
	}
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	ready, err := worker.Ready(ctx)
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := newProxyServer(settings, worker, ready.Catalog)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := httptest.NewServer(proxy.Handler)
	defer endpoint.Close()

	claudePath, err := resolveV2ClaudeExecutable()
	if err != nil {
		t.Fatal(err)
	}
	serverRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	configDir := t.TempDir()
	environ := os.Environ()
	for name, value := range map[string]string{
		"ANTHROPIC_BASE_URL":                         endpoint.URL,
		"ANTHROPIC_API_KEY":                          "wheelmaker-v2-smoke",
		"CLAUDE_CONFIG_DIR":                          configDir,
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":   "1",
		"CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1",
	} {
		environ = replaceV2EnvironmentValue(environ, name, value)
	}

	textOutput := runV2ClaudeSmokeCommand(
		t,
		ctx,
		claudePath,
		serverRoot,
		environ,
		"-p",
		"--model", "claude-4.8-opus",
		"--output-format", "json",
		"--max-budget-usd", "0.20",
		"Reply exactly V2-TEXT-OK without using tools.",
	)
	if !bytes.Contains(textOutput, []byte("V2-TEXT-OK")) {
		t.Fatal("Claude Code text smoke response omitted its marker")
	}

	toolOutput := runV2ClaudeSmokeCommand(
		t,
		ctx,
		claudePath,
		serverRoot,
		environ,
		"-p",
		"--model", "claude-4.8-opus",
		"--output-format", "stream-json",
		"--verbose",
		"--tools=Glob",
		"--allowedTools", "Glob",
		"--max-budget-usd", "0.30",
		"You must call the Glob tool with pattern **/go.mod before answering. After its result, reply exactly V2-TOOL-OK.",
	)
	hasGlobCall := bytes.Contains(toolOutput, []byte(`"name":"Glob"`))
	hasMappedGlobCall := bytes.Contains(toolOutput, []byte(`"name":"glob"`))
	hasToolMarker := bytes.Contains(toolOutput, []byte("V2-TOOL-OK"))
	if !hasGlobCall || !hasToolMarker {
		t.Fatalf(
			"Claude Code built-in tool smoke did not complete its tool round trip (tool call=%t, mapped call=%t, marker=%t)",
			hasGlobCall,
			hasMappedGlobCall,
			hasToolMarker,
		)
	}

	mcpScript := filepath.Join(configDir, "mcp-smoke.mjs")
	if err := os.WriteFile(mcpScript, []byte(v2MCPSmokeServer), 0o600); err != nil {
		t.Fatal(err)
	}
	mcpConfig, err := json.Marshal(map[string]any{
		"mcpServers": map[string]any{
			"v2smoke": map[string]any{
				"type":    "stdio",
				"command": settings.NodePath,
				"args":    []string{mcpScript},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	mcpOutput := runV2ClaudeSmokeCommand(
		t,
		ctx,
		claudePath,
		serverRoot,
		environ,
		"--bare", "-p",
		"--model", "claude-4.8-opus",
		"--output-format", "stream-json",
		"--verbose",
		"--strict-mcp-config",
		"--mcp-config", string(mcpConfig),
		"--allowedTools", "mcp__v2smoke__echo_marker",
		"--max-budget-usd", "0.30",
		"Call the v2smoke echo_marker MCP tool once, then reply exactly V2-MCP-OK.",
	)
	if !bytes.Contains(mcpOutput, []byte(`"name":"mcp__v2smoke__echo_marker"`)) ||
		!bytes.Contains(mcpOutput, []byte("V2-MCP-OK")) {
		t.Fatal("Claude Code MCP tool smoke did not complete its tool round trip")
	}
}

func resolveV2ClaudeExecutable() (string, error) {
	resolved, err := exec.LookPath("claude")
	if err != nil {
		return "", errors.New("Claude Code is unavailable")
	}
	if !strings.EqualFold(filepath.Ext(resolved), ".cmd") {
		return resolved, nil
	}
	native := filepath.Join(
		filepath.Dir(resolved),
		"node_modules",
		"@anthropic-ai",
		"claude-code",
		"bin",
		"claude.exe",
	)
	if info, err := os.Stat(native); err == nil && !info.IsDir() {
		return native, nil
	}
	return "", errors.New("Claude Code native executable is unavailable")
}

func runV2ClaudeSmokeCommand(
	t *testing.T,
	ctx context.Context,
	executable, workingDirectory string,
	environ []string,
	args ...string,
) []byte {
	t.Helper()
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = workingDirectory
	command.Env = environ
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Claude Code smoke command failed: %v", err)
	}
	return output
}

const v2MCPSmokeServer = `
import readline from "node:readline";

const lines = readline.createInterface({input: process.stdin});
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "notifications/initialized") return;
  let result;
  if (message.method === "initialize") {
    result = {
      protocolVersion: message.params?.protocolVersion || "2024-11-05",
      capabilities: {tools: {}},
      serverInfo: {name: "v2smoke", version: "1.0.0"},
    };
  } else if (message.method === "tools/list") {
    result = {
      tools: [{
        name: "echo_marker",
        description: "Return the fixed V2 MCP smoke marker.",
        inputSchema: {type: "object", additionalProperties: false},
      }],
    };
  } else if (message.method === "tools/call") {
    result = {content: [{type: "text", text: "MCP-CALLED"}]};
  } else {
    result = {};
  }
  process.stdout.write(JSON.stringify({jsonrpc: "2.0", id: message.id, result}) + "\n");
});
`

func TestParseProxySettingsUsesFlickerAgentBinaryDiscovery(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	packageDir := filepath.Join(binDir, "node_modules", "@myflicker", "cli")
	if err := os.MkdirAll(filepath.Join(packageDir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packageDir, "package.json"), []byte(`{"name":"@myflicker/cli","version":"0.3.16"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packageDir, "dist", "cli.mjs"), []byte(v2BundleAnchor), 0o644); err != nil {
		t.Fatal(err)
	}

	nodePath := filepath.Join(root, "node.exe")
	myFlickerPath := filepath.Join(binDir, "myflicker.cmd")
	settings, err := parseProxySettingsWithLookPath(nil, map[string]string{}, func(name string) (string, error) {
		switch name {
		case "node":
			return nodePath, nil
		case "myflicker":
			return myFlickerPath, nil
		default:
			return "", fmt.Errorf("unexpected binary lookup %q", name)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.MyFlickerDir != packageDir {
		t.Fatalf("MyFlickerDir=%q, want agent-discovered package %q", settings.MyFlickerDir, packageDir)
	}
}

func (writer *failingResponseWriter) Header() http.Header {
	if writer.header == nil {
		writer.header = make(http.Header)
	}
	return writer.header
}

func (*failingResponseWriter) WriteHeader(int) {}

func (writer *failingResponseWriter) Write([]byte) (int, error) {
	return 0, writer.err
}

func testSettings(t *testing.T) Settings {
	t.Helper()
	return Settings{
		Host:              "127.0.0.1",
		Port:              17999,
		BaseURL:           "https://example.invalid",
		TokenBaseURL:      "https://example.invalid",
		ChatPath:          "/eapi/kwaipilot/plugin/composer/v3/chat/completions",
		CachePath:         t.TempDir() + `\cache.json`,
		BridgeAPIKey:      "test-bridge-key",
		DefaultModel:      "CLAUDE_OPUS_4_7",
		AuthTimeout:       time.Second,
		AuthPollInterval:  time.Millisecond,
		UpstreamTimeout:   time.Second,
		PlatformHeader:    "kwaipilot-ide",
		PluginVersion:     "test",
		DeviceScene:       "duet_window",
		ReasoningEffort:   "max",
		ThinkingBudget:    -1,
		ThinkingBudgetSet: false,
	}
}

func seedTestModels(bridge *BridgeServer) {
	bridge.catalog.mu.Lock()
	defer bridge.catalog.mu.Unlock()
	bridge.catalog.models = []ModelEntry{
		{Type: "CLAUDE_OPUS_4_7", ID: "CLAUDE-MYFLICKER-CLAUDE_OPUS_4_7", Name: "Claude Opus", Agent: true},
		{Type: "GPT_5_4", ID: "CLAUDE-MYFLICKER-GPT_5_4", Name: "GPT 5.4", Agent: true},
	}
}

func testBridge(t *testing.T) *BridgeServer {
	t.Helper()
	settings := testSettings(t)
	bridge := newBridgeServer(settings, map[string]string{}, nil)
	seedTestModels(bridge)
	return bridge
}

func TestSecurityProcessorCachesResolvedSecurityKeyAcrossRequests(t *testing.T) {
	root := t.TempDir()
	key := strings.Repeat("A", 32)
	encoded := base64.StdEncoding.EncodeToString([]byte(key))
	bundle := filepath.Join(root, "resources", "app", "extensions", "codeflicker", "out", "extension-export.js")
	if err := os.MkdirAll(filepath.Dir(bundle), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bundle, []byte(`aes-256-gcm "`+encoded+`"`), 0o600); err != nil {
		t.Fatal(err)
	}
	marker := installPowerShellProbe(t, filepath.Join(root, "MyFlicker.exe"))

	processor := newSecurityProcessor(Settings{}, map[string]string{}, nil, nil)
	processor.config = securityConfig{
		Version: 1,
		Rules: []securityRule{{
			Path:      "/protected",
			Methods:   []string{http.MethodPost},
			Signature: true,
		}},
	}
	processor.expires = time.Now().Add(time.Hour)

	for range 2 {
		if _, _, err := processor.Protect(context.Background(), http.MethodPost, "/protected", []byte(`{"ok":true}`)); err != nil {
			t.Fatal(err)
		}
	}

	if got := powerShellProbeCalls(t, marker); got != 1 {
		t.Fatalf("PowerShell process discovery calls = %d, want 1 across repeated protected requests", got)
	}
}

func TestSecurityProcessorExplicitKeySkipsProcessDiscovery(t *testing.T) {
	marker := installPowerShellProbe(t, "")
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("B", 32)))
	processor := newSecurityProcessor(Settings{}, map[string]string{
		"MYFLICKER_SECURITY_KEY_B64": key,
	}, nil, nil)
	processor.config = securityConfig{
		Version: 1,
		Rules: []securityRule{{
			Path:      "/protected",
			Methods:   []string{http.MethodPost},
			Signature: true,
		}},
	}
	processor.expires = time.Now().Add(time.Hour)

	if _, _, err := processor.Protect(context.Background(), http.MethodPost, "/protected", []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}

	if got := powerShellProbeCalls(t, marker); got != 0 {
		t.Fatalf("PowerShell process discovery calls = %d, want 0 with an explicit security key", got)
	}
}

func TestSecurityProcessorForceRefreshInvalidatesCachedKey(t *testing.T) {
	root := t.TempDir()
	encoded := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("C", 32)))
	bundle := filepath.Join(root, "resources", "app", "extensions", "codeflicker", "out", "extension-export.js")
	if err := os.MkdirAll(filepath.Dir(bundle), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bundle, []byte(`aes-256-gcm "`+encoded+`"`), 0o600); err != nil {
		t.Fatal(err)
	}
	marker := installPowerShellProbe(t, filepath.Join(root, "MyFlicker.exe"))
	processor := newSecurityProcessor(Settings{}, map[string]string{}, nil, nil)
	config := securityConfig{
		Version: 1,
		Rules: []securityRule{{
			Path:      "/protected",
			Methods:   []string{http.MethodPost},
			Signature: true,
		}},
	}
	processor.config = config
	processor.expires = time.Now().Add(time.Hour)

	if _, _, err := processor.Protect(context.Background(), http.MethodPost, "/protected", []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	processor.ForceRefresh()
	processor.config = config
	processor.expires = time.Now().Add(time.Hour)
	if _, _, err := processor.Protect(context.Background(), http.MethodPost, "/protected", []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}

	if got := powerShellProbeCalls(t, marker); got != 2 {
		t.Fatalf("PowerShell process discovery calls = %d, want a fresh discovery after ForceRefresh", got)
	}
}

func TestBuildFlickerBodyRejectsUnknownModel(t *testing.T) {
	bridge := testBridge(t)
	_, err := bridge.buildFlickerBody(map[string]any{
		"model": "NOT_A_REAL_FLICKER_MODEL",
		"messages": []any{
			map[string]any{"role": "user", "content": "hello"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "Unsupported MyFlicker model") {
		t.Fatalf("buildFlickerBody error = %v, want unsupported model error", err)
	}
}

func TestValidateOpenAIBodyMatchesPythonPreStreamValidation(t *testing.T) {
	bridge := testBridge(t)
	model, messages, err := bridge.validateOpenAIBody(map[string]any{
		"model": "CLAUDE-MYFLICKER-GPT_5_4",
		"messages": []any{
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,not-decoded-during-validation"}},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if model != "GPT_5_4" || len(messages) != 1 {
		t.Fatalf("validateOpenAIBody = model %q, %d messages", model, len(messages))
	}
}

func TestBridgeUsesShortDedicatedAuthHTTPTimeout(t *testing.T) {
	settings := testSettings(t)
	settings.UpstreamTimeout = 10 * time.Minute
	bridge := newBridgeServer(settings, map[string]string{}, nil)
	if bridge.auth.client == bridge.client {
		t.Fatal("auth and long-running upstream requests share one HTTP client")
	}
	if got := bridge.auth.client.Timeout; got > 15*time.Second || got <= 0 {
		t.Fatalf("auth HTTP timeout = %s, want a positive timeout no longer than 15s", got)
	}
}

func TestReadRequestBodyLimitedRejectsOversizedExpansion(t *testing.T) {
	_, err := readRequestBodyLimited(strings.NewReader("12345"), 4)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("readRequestBodyLimited error = %v, want size limit error", err)
	}
}

func TestSizeLimitedLogWriterTruncatesPreviousContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.log")
	writer, err := newSizeLimitedLogWriter(path, 48)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = writer.Close() })
	if _, err := writer.Write([]byte("old-content-that-should-be-removed-1234567890\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("new-content\n")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "old-content") {
		t.Fatalf("log retained old content: %s", data)
	}
	if !strings.Contains(string(data), "[log] truncated previous log") || !strings.Contains(string(data), "new-content") {
		t.Fatalf("log after truncation = %s", data)
	}
}

func TestAttachNativeImagesKeepsOnlyCurrentImageTurn(t *testing.T) {
	bridge := testBridge(t)
	messages := []any{
		map[string]any{"role": "system", "content": []any{map[string]any{"type": "text", "text": "rules"}}},
		map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "text", "text": "old"},
			map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": "https://example.invalid/old.png"}},
		}},
		map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "old reply"}}},
		map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "text", "text": "current"},
			map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": "https://example.invalid/current.png"}},
		}},
	}

	trimmed, images, _, err := bridge.attachNativeImages(messages)
	if err != nil {
		t.Fatal(err)
	}
	if len(trimmed) != 2 {
		t.Fatalf("trimmed messages = %d, want preserved system plus current image turn", len(trimmed))
	}
	if len(images) != 1 || images[0] != "https://example.invalid/current.png" {
		t.Fatalf("native images = %#v, want only current image turn", images)
	}
}

func TestAttachNativeImagesOmitsImageWhenLatestInputIsText(t *testing.T) {
	bridge := testBridge(t)
	messages := []any{
		map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": "https://example.invalid/historical.png"}},
		}},
		map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "reply"}}},
		map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "new question"}}},
	}

	rewritten, images, _, err := bridge.attachNativeImages(messages)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 0 {
		t.Fatalf("native images = %#v, want historical image omitted", images)
	}
	encoded, err := json.Marshal(rewritten)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "historical.png") {
		t.Fatalf("rewritten messages still contain historical image: %s", encoded)
	}
}

func TestAttachNativeImagesSanitizesInlineImageDataFromText(t *testing.T) {
	bridge := testBridge(t)
	inline := "data:image/png;base64," + strings.Repeat("A", 5000)
	messages := []any{
		map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "text", "text": "inspect " + inline},
			map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": "https://example.invalid/current.png"}},
		}},
	}

	rewritten, images, _, err := bridge.attachNativeImages(messages)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 {
		t.Fatalf("native images = %#v", images)
	}
	encoded, err := json.Marshal(rewritten)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), strings.Repeat("A", 4096)) {
		t.Fatalf("rewritten messages retain large inline image data")
	}
	if !strings.Contains(string(encoded), "[image data omitted]") {
		t.Fatalf("rewritten messages = %s, want image data placeholder", encoded)
	}
}

func TestHandlerSupportsUnversionedAliasesAndWebsocketFallback(t *testing.T) {
	bridge := testBridge(t)
	handler := bridge.Handler()

	post := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/chat/completions", strings.NewReader(`{}`))
	post.RemoteAddr = "127.0.0.1:12345"
	postRecorder := httptest.NewRecorder()
	handler.ServeHTTP(postRecorder, post)
	if postRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("POST /chat/completions status = %d, want %d", postRecorder.Code, http.StatusUnauthorized)
	}

	get := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/responses", nil)
	get.RemoteAddr = "127.0.0.1:12345"
	get.Header.Set("Upgrade", "websocket")
	getRecorder := httptest.NewRecorder()
	handler.ServeHTTP(getRecorder, get)
	if getRecorder.Code != http.StatusUpgradeRequired {
		t.Fatalf("GET /responses websocket status = %d, want %d", getRecorder.Code, http.StatusUpgradeRequired)
	}

	plainGet := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/responses", nil)
	plainGet.RemoteAddr = "127.0.0.1:12345"
	plainGetRecorder := httptest.NewRecorder()
	handler.ServeHTTP(plainGetRecorder, plainGet)
	if plainGetRecorder.Code != http.StatusNotFound {
		t.Fatalf("GET /responses status = %d, want %d", plainGetRecorder.Code, http.StatusNotFound)
	}
}

func TestHandlerListsModelsWithoutAPIKeyLikePythonProxy(t *testing.T) {
	bridge := testBridge(t)
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/models", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	response := httptest.NewRecorder()

	bridge.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET /v1/models status = %d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if _, ok := payload["models"].([]any); !ok {
		t.Fatalf("GET /v1/models payload = %#v, want compatibility models array", payload)
	}
}

func TestHandlerOPTIONSWritesLoopbackCORSHeaders(t *testing.T) {
	bridge := testBridge(t)
	request := httptest.NewRequest(http.MethodOptions, "http://127.0.0.1/v1/responses", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Origin", "http://127.0.0.1:5173")
	response := httptest.NewRecorder()

	bridge.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestOpenFlickerChatRetriesBusyBeforeVisibleOutput(t *testing.T) {
	var chatRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/billing/credit-alert":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"creditTotal": 100, "creditUsed": 1, "creditAvailable": 99}})
		case "/eapi/kwaipilot/security/config":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"version": 1, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			response.Header().Set("Content-Type", "text/event-stream")
			if chatRequests.Add(1) == 1 {
				_, _ = response.Write([]byte("data: {\"type\":\"error\",\"code\":520,\"tip\":\"当前模型繁忙\"}\n\n"))
				return
			}
			_, _ = response.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n"))
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()

	settings := testSettings(t)
	settings.BaseURL = upstream.URL
	settings.TokenBaseURL = upstream.URL
	if err := writeJSONAtomic(settings.CachePath, authCache{Token: "cached-token", Username: "tester", DeviceID: "device-1"}); err != nil {
		t.Fatal(err)
	}
	bridge := newBridgeServer(settings, map[string]string{
		"MYFLICKER_BUSY_RETRIES":             "2",
		"MYFLICKER_BUSY_RETRY_DELAY_SECONDS": "0",
	}, upstream.Client())
	seedTestModels(bridge)

	events, err := bridge.openFlickerChat(context.Background(), map[string]any{
		"model":    "CLAUDE_OPUS_4_7",
		"messages": []any{map[string]any{"role": "user", "content": "hello"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatRequests.Load(); got != 2 {
		t.Fatalf("chat requests = %d, want busy request plus retry", got)
	}
	if !eventsHaveVisibleOutput(events) {
		t.Fatalf("events = %#v, want visible output", events)
	}
}

func TestOpenFlickerChatStopsBeforeUpstreamWhenCreditIsExhausted(t *testing.T) {
	var chatRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/billing/credit-alert":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"creditTotal": 100, "creditUsed": 100, "creditAvailable": 0}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			chatRequests.Add(1)
			http.Error(response, "should not be called", http.StatusInternalServerError)
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()

	settings := testSettings(t)
	settings.BaseURL = upstream.URL
	settings.TokenBaseURL = upstream.URL
	if err := writeJSONAtomic(settings.CachePath, authCache{Token: "cached-token", Username: "tester", DeviceID: "device-1"}); err != nil {
		t.Fatal(err)
	}
	bridge := newBridgeServer(settings, map[string]string{"MYFLICKER_CREDIT_TIMEOUT": "1"}, upstream.Client())
	seedTestModels(bridge)

	_, err := bridge.openFlickerChat(context.Background(), map[string]any{
		"model":    "CLAUDE_OPUS_4_7",
		"messages": []any{map[string]any{"role": "user", "content": "hello"}},
	})
	var streamErr *upstreamStreamError
	if err == nil || !strings.Contains(err.Error(), "本月积分额度已用尽") || !errors.As(err, &streamErr) {
		t.Fatalf("openFlickerChat error = %v, want quota upstream stream error", err)
	}
	if got := chatRequests.Load(); got != 0 {
		t.Fatalf("chat requests = %d, want zero", got)
	}
}

func TestStatusForBusyAndQuotaStreamErrorsIs520(t *testing.T) {
	if got := statusForError(&upstreamStreamError{Code: 520, Tip: "当前模型繁忙"}); got != 520 {
		t.Fatalf("statusForError = %d, want 520", got)
	}
}

func TestUsageLoggingDefaultsAndFormattingMatchPythonProxy(t *testing.T) {
	if !usageLoggingEnabled(map[string]string{}) {
		t.Fatal("usage logging should default to enabled")
	}
	if usageLoggingEnabled(map[string]string{"MYFLICKER_LOG_USAGE": "false"}) {
		t.Fatal("usage logging did not honor MYFLICKER_LOG_USAGE=false")
	}
	if got := formatUsage(map[string]any{"prompt_tokens": 10, "completion_tokens": 4}); got != "in=10,out=4,total=14" {
		t.Fatalf("formatUsage = %q", got)
	}
}

func TestStreamEmitterSurfacesClientWriteFailure(t *testing.T) {
	want := errors.New("client disconnected")
	response := &failingResponseWriter{err: want}
	emitter := newStreamEmitter(response)
	emitter.responseEvent(map[string]any{"type": "response.created"})
	if !errors.Is(emitter.Err(), want) {
		t.Fatalf("stream emitter error = %v, want %v", emitter.Err(), want)
	}
}

func TestResponsesToOpenAIAddsCompactionPromptAndDisablesTools(t *testing.T) {
	openAI, err := responsesToOpenAI(map[string]any{
		"model": "CLAUDE_OPUS_4_7",
		"input": []any{
			map[string]any{"type": "message", "role": "user", "content": []any{map[string]any{"type": "input_text", "text": "conversation"}}},
			map[string]any{"type": "compaction_trigger"},
		},
		"tools": []any{map[string]any{"type": "function", "name": "tool"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	messages, _ := openAI["messages"].([]any)
	if len(messages) == 0 {
		t.Fatal("responses conversion produced no messages")
	}
	last, _ := messages[len(messages)-1].(map[string]any)
	content := firstText(last["content"])
	if !strings.Contains(content, "CONTEXT CHECKPOINT COMPACTION") {
		t.Fatalf("last message content = %q, want compaction prompt", content)
	}
	if _, exists := openAI["tools"]; exists {
		t.Fatalf("compaction request retained tools: %#v", openAI["tools"])
	}
}

func TestResponsesToOpenAIPreservesControlsAndConvertsFlatTools(t *testing.T) {
	openAI, err := responsesToOpenAI(map[string]any{
		"model":                "CLAUDE_OPUS_4_7",
		"input":                "hello",
		"max_output_tokens":    321,
		"temperature":          0.2,
		"top_p":                0.8,
		"tool_choice":          "required",
		"reasoningEffort":      "high",
		"thinking":             map[string]any{"type": "enabled"},
		"thinkingBudgetTokens": 4096,
		"tools": []any{
			map[string]any{
				"type": "function", "name": "lookup", "description": "Lookup a value",
				"parameters": map[string]any{"type": "object"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if parseAnyInt(openAI["max_tokens"]) != 321 || openAI["temperature"] != 0.2 || openAI["top_p"] != 0.8 {
		t.Fatalf("Responses controls were not preserved: %#v", openAI)
	}
	if openAI["tool_choice"] != "required" || openAI["reasoning_effort"] != "high" || parseAnyInt(openAI["thinking_budget_tokens"]) != 4096 {
		t.Fatalf("Responses tool/reasoning controls were not preserved: %#v", openAI)
	}
	tools, _ := openAI["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("Responses tools = %#v, want one converted tool", openAI["tools"])
	}
	tool, _ := tools[0].(map[string]any)
	function, _ := tool["function"].(map[string]any)
	if firstText(function["name"]) != "lookup" || function["parameters"] == nil {
		t.Fatalf("Responses flat function tool was not converted: %#v", openAI["tools"])
	}
}

func TestResponsesStreamWriterUsesActualTextOutputIndex(t *testing.T) {
	response := httptest.NewRecorder()
	writer := newResponsesStreamWriter(response, map[string]any{"model": "CLAUDE_OPUS_4_7"})
	writer.start()
	writer.add(newOpenAIChunk("", 0, "", []any{
		map[string]any{"index": 0, "delta": map[string]any{"content": "hello"}, "finish_reason": nil},
	}, nil))
	writer.stop()

	events, err := parseSSE(strings.NewReader(response.Body.String()))
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		var payload map[string]any
		if json.Unmarshal([]byte(event.Data), &payload) == nil && firstText(payload["type"]) == "response.output_text.delta" {
			if firstPresentInt(payload["output_index"]) != 0 {
				t.Fatalf("text delta output_index = %v, want 0; stream=%s", payload["output_index"], response.Body.String())
			}
			return
		}
	}
	t.Fatalf("text delta event missing: %s", response.Body.String())
}

func TestResponsesStreamWriterEmitsFunctionCallEvents(t *testing.T) {
	response := httptest.NewRecorder()
	writer := newResponsesStreamWriter(response, map[string]any{"model": "CLAUDE_OPUS_4_7"})
	writer.start()
	writer.add(newOpenAIChunk("", 0, "", []any{
		map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{
			map[string]any{"index": 0, "id": "call_lookup", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"q":`}},
		}}, "finish_reason": nil},
	}, nil))
	writer.add(newOpenAIChunk("", 0, "", []any{
		map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{
			map[string]any{"index": 0, "function": map[string]any{"arguments": `"wheel"}`}},
		}}, "finish_reason": "tool_calls"},
	}, nil))
	writer.stop()

	eventTypes := map[string]bool{}
	var completed map[string]any
	events, err := parseSSE(strings.NewReader(response.Body.String()))
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		var payload map[string]any
		if json.Unmarshal([]byte(event.Data), &payload) != nil {
			continue
		}
		eventTypes[firstText(payload["type"])] = true
		if firstText(payload["type"]) == "response.completed" {
			completed, _ = payload["response"].(map[string]any)
		}
	}
	for _, eventType := range []string{
		"response.output_item.added",
		"response.function_call_arguments.delta",
		"response.function_call_arguments.done",
		"response.output_item.done",
	} {
		if !eventTypes[eventType] {
			t.Fatalf("%s event missing: %s", eventType, response.Body.String())
		}
	}
	output, _ := completed["output"].([]any)
	if len(output) != 1 || firstText(output[0].(map[string]any)["type"]) != "function_call" {
		t.Fatalf("completed response output = %#v, want one function_call", output)
	}
}

func TestAnthropicMixedToolResultPreservesBlockOrderAndImagePlaceholder(t *testing.T) {
	openAI, err := anthropicToOpenAI(map[string]any{
		"model":                  "CLAUDE_OPUS_4_7",
		"max_tokens":             123,
		"temperature":            0.3,
		"top_p":                  0.9,
		"stop_sequences":         []any{"STOP"},
		"thinking_budget_tokens": 2048,
		"messages": []any{
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "text", "text": "before"},
				map[string]any{"type": "tool_result", "tool_use_id": "toolu_image", "content": []any{
					map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": "AA=="}},
				}},
				map[string]any{"type": "text", "text": "after"},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if parseAnyInt(openAI["max_tokens"]) != 123 || openAI["temperature"] != 0.3 || openAI["top_p"] != 0.9 || parseAnyInt(openAI["thinking_budget_tokens"]) != 2048 {
		t.Fatalf("Anthropic controls were not preserved: %#v", openAI)
	}
	messages := openAI["messages"].([]any)
	if len(messages) != 3 {
		t.Fatalf("converted messages = %#v, want user/tool/user", messages)
	}
	roles := []string{
		firstText(messages[0].(map[string]any)["role"]),
		firstText(messages[1].(map[string]any)["role"]),
		firstText(messages[2].(map[string]any)["role"]),
	}
	if !slices.Equal(roles, []string{"user", "tool", "user"}) {
		t.Fatalf("converted roles = %v, want [user tool user]", roles)
	}
	toolContent, _ := messages[1].(map[string]any)["content"].([]any)
	hasPlaceholder := false
	hasImage := false
	for _, rawPart := range toolContent {
		part, _ := rawPart.(map[string]any)
		hasPlaceholder = hasPlaceholder || strings.Contains(firstText(part["text"]), "non-text content")
		hasImage = hasImage || firstText(part["type"]) == "image_url"
	}
	if !hasPlaceholder || !hasImage {
		t.Fatalf("tool result content = %#v, want placeholder and image", toolContent)
	}
}

func TestAnthropicAdapterPreservesInputImageURL(t *testing.T) {
	openAI, err := anthropicToOpenAI(map[string]any{
		"model": "CLAUDE_OPUS_4_7",
		"messages": []any{
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "input_image", "image_url": "https://example.com/image.png"},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	messages := openAI["messages"].([]any)
	content := messages[0].(map[string]any)["content"].([]any)
	imagePart := content[0].(map[string]any)
	imageURL := imagePart["image_url"].(map[string]any)
	if firstText(imagePart["type"]) != "image_url" || firstText(imageURL["url"]) != "https://example.com/image.png" {
		t.Fatalf("converted image = %#v, want preserved input_image URL", imagePart)
	}
}

func TestProtocolAdaptersPreserveInlineTextFileAttachments(t *testing.T) {
	file := map[string]any{
		"type": "input_file", "filename": "notes.txt", "file_data": "data:text/plain;base64,aGVsbG8=",
	}
	responses, err := responsesToOpenAI(map[string]any{
		"model": "CLAUDE_OPUS_4_7",
		"input": []any{
			map[string]any{"type": "message", "role": "user", "content": []any{file}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	responseMessages := responses["messages"].([]any)
	responseText := fmt.Sprint(responseMessages[0].(map[string]any)["content"])
	if !strings.Contains(responseText, "notes.txt") || !strings.Contains(responseText, "hello") {
		t.Fatalf("Responses file attachment was lost: %#v", responseMessages)
	}

	anthropic, err := anthropicToOpenAI(map[string]any{
		"model": "CLAUDE_OPUS_4_7",
		"messages": []any{
			map[string]any{"role": "user", "content": []any{file}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	anthropicMessages := anthropic["messages"].([]any)
	anthropicText := fmt.Sprint(anthropicMessages[0].(map[string]any)["content"])
	if !strings.Contains(anthropicText, "notes.txt") || !strings.Contains(anthropicText, "hello") {
		t.Fatalf("Anthropic file attachment was lost: %#v", anthropicMessages)
	}
}

func TestHandlerRoutesOfficialCodexModelWithCallerCredential(t *testing.T) {
	var receivedAuthorization string
	var receivedBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/responses" {
			http.NotFound(response, request)
			return
		}
		receivedAuthorization = request.Header.Get("Authorization")
		if err := json.NewDecoder(request.Body).Decode(&receivedBody); err != nil {
			t.Error(err)
		}
		response.Header().Set("X-Request-ID", "official-request")
		response.Header().Set("Access-Control-Allow-Origin", "*")
		response.Header().Set("Set-Cookie", "official_session=must-not-leak")
		writeJSON(response, http.StatusCreated, map[string]any{"id": "official-response", "object": "response"})
	}))
	defer upstream.Close()

	codexDir := t.TempDir()
	if err := writeJSONAtomic(codexDir+`\models_cache.json`, map[string]any{
		"models": []any{map[string]any{"slug": "gpt-5.5", "display_name": "GPT-5.5"}},
	}); err != nil {
		t.Fatal(err)
	}
	settings := testSettings(t)
	bridge := newBridgeServer(settings, map[string]string{
		"MYFLICKER_CODEX_DIR":                   codexDir,
		"MYFLICKER_OPENAI_RESPONSES_URL":        upstream.URL + "/v1/responses",
		"MYFLICKER_CHATGPT_CODEX_RESPONSES_URL": upstream.URL + "/backend-api/codex/responses",
	}, upstream.Client())
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/responses", strings.NewReader(`{"model":"gpt-5.5","input":"hello","stream":false}`))
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Authorization", "Bearer sk-caller-owned")
	response := httptest.NewRecorder()

	bridge.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("response status = %d body=%s, want %d", response.Code, response.Body.String(), http.StatusCreated)
	}
	if receivedAuthorization != "Bearer sk-caller-owned" {
		t.Fatalf("upstream Authorization = %q", receivedAuthorization)
	}
	if firstText(receivedBody["model"]) != "gpt-5.5" {
		t.Fatalf("upstream body = %#v", receivedBody)
	}
	if got := response.Header().Get("X-Request-ID"); got != "official-request" {
		t.Fatalf("relayed X-Request-ID = %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("relayed upstream Access-Control-Allow-Origin = %q", got)
	}
	if got := response.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("relayed upstream Set-Cookie = %q", got)
	}
}

func TestHandlerReturnsCompactionItemsForResponsesCompaction(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/billing/credit-alert":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"creditTotal": 100, "creditUsed": 1, "creditAvailable": 99}})
		case "/eapi/kwaipilot/security/config":
			writeJSON(response, http.StatusOK, map[string]any{"data": map[string]any{"version": 1, "config": []any{}}})
		case "/eapi/kwaipilot/plugin/composer/v3/chat/completions":
			response.Header().Set("Content-Type", "text/event-stream")
			_, _ = response.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"handoff summary\"},\"finish_reason\":\"stop\"}]}\n\n"))
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()

	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "json", true: "stream"}[stream], func(t *testing.T) {
			settings := testSettings(t)
			settings.BaseURL = upstream.URL
			settings.TokenBaseURL = upstream.URL
			if err := writeJSONAtomic(settings.CachePath, authCache{Token: "cached-token", Username: "tester", DeviceID: "device-1"}); err != nil {
				t.Fatal(err)
			}
			bridge := newBridgeServer(settings, map[string]string{}, upstream.Client())
			seedTestModels(bridge)
			body, err := json.Marshal(map[string]any{
				"model":  "CLAUDE_OPUS_4_7",
				"stream": stream,
				"input": []any{
					map[string]any{"type": "message", "role": "user", "content": "history"},
					map[string]any{"type": "compaction_trigger"},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/responses", strings.NewReader(string(body)))
			request.RemoteAddr = "127.0.0.1:12345"
			request.Header.Set("Authorization", "Bearer "+settings.BridgeAPIKey)
			response := httptest.NewRecorder()

			bridge.Handler().ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), `"type":"compaction"`) {
				t.Fatalf("response body = %s, want compaction item", response.Body.String())
			}
			if !strings.Contains(response.Body.String(), myFlickerCompactionPrefix) {
				t.Fatalf("response body = %s, want encoded MyFlicker compaction", response.Body.String())
			}
		})
	}
}

func TestRunningMyFlickerExecutablePathsCommandHidesConsoleWindow(t *testing.T) {
	command := newRunningMyFlickerExecutablePathsCommand()

	if command.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil, want hidden window settings")
	}
	if !command.SysProcAttr.HideWindow {
		t.Fatal("HideWindow=false, want true")
	}
}

func TestV2NodeVersionCommandHidesConsoleWindow(t *testing.T) {
	command := newV2NodeVersionCommand("node.exe")

	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatal("V2 Node version command must hide its console window")
	}
}

func TestV2WorkerCommandHidesConsoleWindow(t *testing.T) {
	command := newV2WorkerCommand(context.Background(), "node.exe", "")

	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatal("V2 worker command must hide its console window")
	}
}

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
	for index, expectedName := range []string{"apply_patch", "web_search", "mcp"} {
		tool := tools[index+1].(map[string]any)
		if firstText(tool["type"]) != "function" || firstText(tool["name"]) != expectedName {
			t.Fatalf("Codex tool %d = %#v, want function %q", index, tool, expectedName)
		}
	}
	toolChoice, ok := payload["toolChoice"].(map[string]any)
	if !ok || firstText(toolChoice["type"]) != "tool" || firstText(toolChoice["toolName"]) != "apply_patch" {
		t.Fatalf("Codex tool choice = %#v", payload["toolChoice"])
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

func TestV2ResponsesDeepSeekFlashSmoke(t *testing.T) {
	if os.Getenv("WHEELMAKER_V2_RESPONSES_SMOKE") != "1" {
		t.Skip("set WHEELMAKER_V2_RESPONSES_SMOKE=1 to run the live DeepSeek Responses smoke test")
	}
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	ready, err := worker.Ready(ctx)
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := newProxyServer(settings, worker, ready.Catalog)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := httptest.NewServer(proxy.Handler)
	defer endpoint.Close()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL+"/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"instructions":"Reply with the requested marker and no extra text.",
		"input":"Reply exactly V2-RESPONSES-OK.",
		"reasoning":{"effort":"high"},
		"max_output_tokens":64,
		"stream":true
	}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), `"type":"response.completed"`) || !strings.Contains(string(body), "V2-RESPONSES-OK") {
		t.Fatalf("status = %d, body = %s", response.StatusCode, body)
	}
}

func TestV2ResponsesDeepSeekFlashCodexProviderToolsSmoke(t *testing.T) {
	if os.Getenv("WHEELMAKER_V2_RESPONSES_SMOKE") != "1" {
		t.Skip("set WHEELMAKER_V2_RESPONSES_SMOKE=1 to run the live DeepSeek Codex tool smoke test")
	}
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
		"MYFLICKER_WANQING_INTERCEPT=1",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	if _, err := worker.Ready(ctx); err != nil {
		t.Fatal(err)
	}

	frames, err := worker.Request(ctx, "deepseek-v4-flash-0731", "high", map[string]any{
		"prompt": []any{map[string]any{
			"role":    "user",
			"content": []any{map[string]any{"type": "text", "text": "inspect the workspace"}},
		}},
		"tools": []any{
			map[string]any{"type": "function", "name": "read", "description": "Read a file", "inputSchema": map[string]any{"type": "object"}},
			map[string]any{"type": "provider", "id": "openai.apply_patch", "args": map[string]any{}},
			map[string]any{"type": "provider", "id": "openai.web_search_preview", "args": map[string]any{"search_context_size": "low"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	finished := false
	probeSeen := false
	for frame := range frames {
		if frame.Type == "error" {
			t.Fatalf("worker rejected Codex provider tools: %s", frame.Error)
		}
		if frame.Type == "probe" {
			probeSeen = true
			if !containsString(frame.Probe.BodyKeys, "tools") {
				t.Fatalf("intercepted request omitted tools: %#v", frame.Probe)
			}
		}
		if frame.Type == "part" {
			part, err := decodeV3Part(frame.Part)
			if err != nil {
				t.Fatal(err)
			}
			finished = finished || v2StringValue(part["type"]) == "finish"
		}
	}
	if !probeSeen || !finished {
		t.Fatalf("provider tool smoke probeSeen=%t finished=%t", probeSeen, finished)
	}
}
