package flickerbridge

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	defaultProxyHost      = "127.0.0.1"
	defaultProxyPort      = 17889
	defaultMaxRequestSize = int64(8 << 20)
	minimumMaxRequestSize = int64(1 << 10)
	maximumMaxRequestSize = int64(32 << 20)
)

type proxySettings struct {
	Host           string
	Port           int
	NodePath       string
	MyFlickerDir   string
	ModelBlacklist map[string]struct{}
	MaxRequestSize int64
}

type V2ProbeResult struct {
	Available        bool   `json:"available"`
	NodePath         string `json:"nodePath,omitempty"`
	MyFlickerVersion string `json:"myFlickerVersion,omitempty"`
	Error            string `json:"error,omitempty"`
}

const v2BundleAnchor = `j0();var mm1=PA(q1(),1);import fJ4 from"fs";`

func ProbeV2() V2ProbeResult {
	environ := environmentMap(os.Environ())
	nodePath, err := resolveNode(environ["MYFLICKER_NODE"], exec.LookPath)
	if err != nil {
		return V2ProbeResult{Error: "Node.js is unavailable"}
	}
	info, err := os.Stat(nodePath)
	if err != nil || info.IsDir() {
		return V2ProbeResult{NodePath: nodePath, Error: "Node.js is unavailable"}
	}
	versionOutput, err := newV2NodeVersionCommand(nodePath).Output()
	if err != nil {
		return V2ProbeResult{NodePath: nodePath, Error: "Node.js version check failed"}
	}
	nodeVersion := strings.TrimSpace(string(versionOutput))
	nodeMajorText := strings.TrimPrefix(strings.SplitN(nodeVersion, ".", 2)[0], "v")
	nodeMajor, err := strconv.Atoi(nodeMajorText)
	if err != nil || nodeMajor < 22 {
		return V2ProbeResult{NodePath: nodePath, Error: "Node.js 22 or newer is required"}
	}

	packageDir := findV2PackageDir(environ["MYFLICKER_CLI_DIR"], nodePath, environ)
	if packageDir == "" {
		return V2ProbeResult{NodePath: nodePath, Error: "@myflicker/cli is unavailable"}
	}
	rawPackage, err := os.ReadFile(filepath.Join(packageDir, "package.json"))
	if err != nil {
		return V2ProbeResult{NodePath: nodePath, Error: "@myflicker/cli package metadata is unreadable"}
	}
	var packageInfo struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	}
	if json.Unmarshal(rawPackage, &packageInfo) != nil ||
		packageInfo.Name != "@myflicker/cli" ||
		packageInfo.Version != "0.3.12" {
		return V2ProbeResult{NodePath: nodePath, Error: "unsupported @myflicker/cli version"}
	}
	bundle, err := os.ReadFile(filepath.Join(packageDir, "dist", "cli.mjs"))
	if err != nil || bytes.Count(bundle, []byte(v2BundleAnchor)) != 1 {
		return V2ProbeResult{
			NodePath:         nodePath,
			MyFlickerVersion: packageInfo.Version,
			Error:            "unsupported @myflicker/cli bundle",
		}
	}
	return V2ProbeResult{
		Available:        true,
		NodePath:         nodePath,
		MyFlickerVersion: packageInfo.Version,
	}
}

func findV2PackageDir(explicit, nodePath string, environ map[string]string) string {
	return findV2PackageDirWithLookPath(explicit, nodePath, environ, exec.LookPath)
}

func findV2PackageDirWithLookPath(explicit, nodePath string, environ map[string]string, lookPath func(string) (string, error)) string {
	candidates := []string{explicit}
	// Keep this command-shim lookup aligned with agent.resolveFlickerCLIEntry.
	if binaryPath, err := lookPath("myflicker"); err == nil {
		extension := strings.ToLower(filepath.Ext(binaryPath))
		if extension == ".mjs" || extension == ".js" {
			candidates = append(candidates, filepath.Dir(binaryPath))
		} else {
			binDir := filepath.Dir(binaryPath)
			candidates = append(candidates,
				filepath.Join(binDir, "node_modules", "@myflicker", "cli"),
				filepath.Join(binDir, "..", "lib", "node_modules", "@myflicker", "cli"),
				filepath.Join(binDir, "..", "node_modules", "@myflicker", "cli"),
			)
		}
	}
	candidates = append(candidates,
		filepath.Join(filepath.Dir(nodePath), "node_modules", "@myflicker", "cli"),
		filepath.Join(environ["APPDATA"], "npm", "node_modules", "@myflicker", "cli"),
	)
	for _, entry := range filepath.SplitList(environ["PATH"]) {
		candidates = append(candidates, filepath.Join(entry, "node_modules", "@myflicker", "cli"))
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(filepath.Join(candidate, "package.json")); err == nil && !info.IsDir() {
			if info, err := os.Stat(filepath.Join(candidate, "dist", "cli.mjs")); err == nil && !info.IsDir() {
				return candidate
			}
		}
	}
	return ""
}

type modelInfo struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	APIFormat   string         `json:"apiFormat,omitempty"`
	Aliases     []string       `json:"aliases,omitempty"`
	EPModelName string         `json:"epModelName,omitempty"`
	Hidden      bool           `json:"hidden,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type modelIndex struct {
	Models  map[string]modelInfo
	Aliases map[string]string
}

type anthropicTool struct {
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	InputSchema  json.RawMessage `json:"input_schema"`
	CacheControl json.RawMessage `json:"cache_control,omitempty"`
}

type anthropicMessagesRequest struct {
	Model         string                  `json:"model"`
	MaxTokens     int                     `json:"max_tokens"`
	System        json.RawMessage         `json:"system,omitempty"`
	Messages      []anthropicInputMessage `json:"messages"`
	Tools         []anthropicTool         `json:"tools,omitempty"`
	ToolChoice    *anthropicToolChoice    `json:"tool_choice,omitempty"`
	Temperature   *float64                `json:"temperature,omitempty"`
	TopP          *float64                `json:"top_p,omitempty"`
	TopK          *int                    `json:"top_k,omitempty"`
	StopSequences []string                `json:"stop_sequences,omitempty"`
	Thinking      json.RawMessage         `json:"thinking,omitempty"`
	Stream        bool                    `json:"stream,omitempty"`
}

type anthropicInputMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type anthropicContentBlock struct {
	Type         string          `json:"type"`
	Text         string          `json:"text,omitempty"`
	Thinking     string          `json:"thinking,omitempty"`
	Signature    string          `json:"signature,omitempty"`
	ID           string          `json:"id,omitempty"`
	Name         string          `json:"name,omitempty"`
	Input        json.RawMessage `json:"input,omitempty"`
	ToolUseID    string          `json:"tool_use_id,omitempty"`
	Content      json.RawMessage `json:"content,omitempty"`
	IsError      bool            `json:"is_error,omitempty"`
	CacheControl json.RawMessage `json:"cache_control,omitempty"`
}

type anthropicToolChoice struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
}

type v2RequestFieldClassification struct {
	Mapped            []string
	ProviderGenerated []string
	Ignored           []string
	Unknown           []string
}

var v2MappedRequestFields = map[string]struct{}{
	"model":          {},
	"max_tokens":     {},
	"system":         {},
	"messages":       {},
	"tools":          {},
	"tool_choice":    {},
	"temperature":    {},
	"top_p":          {},
	"top_k":          {},
	"stop_sequences": {},
	"thinking":       {},
	"stream":         {},
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

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicMessage struct {
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	Role         string         `json:"role"`
	Model        string         `json:"model"`
	Content      []any          `json:"content"`
	StopReason   string         `json:"stop_reason"`
	StopSequence any            `json:"stop_sequence"`
	Usage        anthropicUsage `json:"usage"`
}

type v2SSEEvent struct {
	Event string `json:"event"`
	Data  any    `json:"data"`
}

type workerBackend interface {
	Request(context.Context, string, any) (<-chan workerFrame, error)
}

type proxyServer struct {
	settings proxySettings
	worker   workerBackend
	models   modelIndex
	catalog  []modelInfo
}

type workerFrame struct {
	Type             string          `json:"type"`
	RequestID        string          `json:"requestId,omitempty"`
	Model            string          `json:"model,omitempty"`
	Payload          json.RawMessage `json:"payload,omitempty"`
	Part             json.RawMessage `json:"part,omitempty"`
	Error            string          `json:"error,omitempty"`
	Catalog          []modelInfo     `json:"catalog,omitempty"`
	MyFlickerVersion string          `json:"myFlickerVersion,omitempty"`
	Probe            *outboundProbe  `json:"probe,omitempty"`
}

type outboundProbe struct {
	RequestID            string   `json:"requestId"`
	Model                string   `json:"model"`
	APIFormat            string   `json:"apiFormat"`
	URL                  string   `json:"url"`
	Method               string   `json:"method"`
	HeaderNames          []string `json:"headerNames"`
	BodyKeys             []string `json:"bodyKeys"`
	BodyHash             string   `json:"bodyHash"`
	SystemBlocks         int      `json:"systemBlocks"`
	ToolNames            []string `json:"toolNames"`
	HasMyFlickerIdentity bool     `json:"hasMyFlickerIdentity"`
	HasClaudeIdentity    bool     `json:"hasClaudeIdentity"`
}

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

type workerClient struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	writeMu sync.Mutex

	mu        sync.Mutex
	pending   map[string]*workerStream
	ready     chan workerFrame
	done      chan struct{}
	closeOnce sync.Once
	nextID    uint64
}

type workerStream struct {
	mu     sync.Mutex
	frames chan workerFrame
	closed bool
}

func (s *workerStream) send(frame workerFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.frames <- frame
	}
}

func (s *workerStream) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		close(s.frames)
	}
}

const nodeWorkerSource = `
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { pathToFileURL } = require("node:url");
const { registerHooks } = require("node:module");

const BOOT_ANCHOR = 'j0();var mm1=PA(q1(),1);import fJ4 from"fs";';
const EXPORTS = 'j0();\nexport{$M0 as wanqingPlugin,FB as models,Qj as createOpenAI,Ct as createAnthropic,Kt6 as login,K7 as setContext,pQ as getContext};';
const controllers = new Map();
const probeContext = new AsyncLocalStorage();
let dispatchTail = Promise.resolve();

function emit(frame) {
  process.stdout.write(JSON.stringify(frame) + "\n");
}

function fail(message) {
  emit({type: "error", error: String(message || "worker failure")});
}

function patchBundle(source) {
  const first = source.indexOf(BOOT_ANCHOR);
  if (first < 0 || source.indexOf(BOOT_ANCHOR, first + BOOT_ANCHOR.length) >= 0) {
    throw new Error("unsupported @myflicker/cli bundle anchor");
  }
  return source.slice(0, first) + EXPORTS;
}

function packageDirectory() {
  const candidates = [
    process.env.MYFLICKER_CLI_DIR,
    path.join(path.dirname(process.execPath), "node_modules", "@myflicker", "cli"),
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@myflicker", "cli"),
  ];
  for (const entry of String(process.env.PATH || "").split(path.delimiter)) {
    if (entry) candidates.push(path.join(entry, "node_modules", "@myflicker", "cli"));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, "package.json")) &&
        fs.existsSync(path.join(candidate, "dist", "cli.mjs"))) {
      return fs.realpathSync(candidate);
    }
  }
  throw new Error("unable to locate @myflicker/cli; set MYFLICKER_CLI_DIR");
}

async function loadInternals(packageDir) {
  const packageJSON = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
  if (packageJSON.name !== "@myflicker/cli" || packageJSON.version !== "0.3.12") {
    throw new Error("unsupported @myflicker/cli package or version");
  }
  const bundlePath = fs.realpathSync(path.join(packageDir, "dist", "cli.mjs"));
  const bundleURL = pathToFileURL(bundlePath);
  const target = bundleURL.pathname;
  process.env.TAKUMI_PATCH_CONSOLE = process.env.TAKUMI_PATCH_CONSOLE || "none";
  process.env.PATCH_CONSOLE = process.env.PATCH_CONSOLE || "none";
  process.env.TAKUMI_LOAD_NATIVE_MODULES = process.env.TAKUMI_LOAD_NATIVE_MODULES || "0";
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (new URL(url).pathname !== target) return result;
      const source = typeof result.source === "string"
        ? result.source
        : Buffer.from(result.source).toString("utf8");
      return {...result, source: patchBundle(source)};
    },
  });
  const originalArgv = process.argv;
  process.argv = [process.execPath, bundlePath];
  try {
    const module = await import(bundleURL.href + "?wanqing-go-proxy=" + randomUUID());
    return {module, version: packageJSON.version};
  } finally {
    process.argv = originalArgv;
  }
}

function nextContext(current) {
  return {
    ...current,
    sessionId: randomBytes(4).toString("hex"),
    promptId: randomUUID(),
  };
}

function serializeDispatch(operation) {
  const result = dispatchTail.then(operation);
  dispatchTail = result.then(() => undefined, () => undefined);
  return result;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function catalogEntry(id, metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const aliases = stringArray(source.aliases || source.alias);
  const capabilities = {};
  for (const key of ["contextWindow", "maxOutputTokens", "supportsReasoning", "supportsTools"]) {
    if (source[key] !== undefined &&
        (typeof source[key] === "string" || typeof source[key] === "number" || typeof source[key] === "boolean")) {
      capabilities[key] = source[key];
    }
  }
  return {
    id,
    name: String(source.name || source.displayName || id),
    apiFormat: String(source.apiFormat || ""),
    aliases,
    epModelName: String(source.epModelName || ""),
    hidden: Boolean(source.hidden || source.isHidden),
    metadata: capabilities,
  };
}

function anthropicFixture(model) {
  const events = [
    ["message_start", {type:"message_start", message:{id:"msg_probe",type:"message",role:"assistant",model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:3,output_tokens:0}}}],
    ["content_block_start", {type:"content_block_start",index:0,content_block:{type:"text",text:""}}],
    ["content_block_delta", {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"ok"}}],
    ["content_block_stop", {type:"content_block_stop",index:0}],
    ["message_delta", {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}}],
    ["message_stop", {type:"message_stop"}],
  ];
  return events.map(([event, data]) => "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n").join("");
}

function openAIFixture(model) {
  const chunks = [
    {id:"chatcmpl_probe",object:"chat.completion.chunk",created:0,model,choices:[{index:0,delta:{role:"assistant",content:""},finish_reason:null}]},
    {id:"chatcmpl_probe",object:"chat.completion.chunk",created:0,model,choices:[{index:0,delta:{content:"ok"},finish_reason:null}]},
    {id:"chatcmpl_probe",object:"chat.completion.chunk",created:0,model,choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}},
  ];
  return chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n";
}

function responsesFixture(model) {
  const response = {
    id:"resp_probe",
    object:"response",
    created_at:0,
    status:"completed",
    error:null,
    incomplete_details:null,
    instructions:null,
    max_output_tokens:null,
    model,
    output:[{id:"msg_probe",type:"message",status:"completed",role:"assistant",content:[{type:"output_text",text:"ok",annotations:[],logprobs:[]}]}],
    parallel_tool_calls:true,
    previous_response_id:null,
    reasoning:{effort:null,summary:null},
    store:false,
    temperature:1,
    text:{format:{type:"text"}},
    tool_choice:"auto",
    tools:[],
    top_p:1,
    truncation:"disabled",
    usage:{input_tokens:3,input_tokens_details:{cached_tokens:0},output_tokens:1,output_tokens_details:{reasoning_tokens:0},total_tokens:4},
    user:null,
    metadata:{},
  };
  const item = response.output[0];
  const content = item.content[0];
  const events = [
    {type:"response.created",sequence_number:0,response:{...response,status:"in_progress",output:[],usage:null}},
    {type:"response.output_item.added",sequence_number:1,output_index:0,item:{...item,status:"in_progress",content:[]}},
    {type:"response.content_part.added",sequence_number:2,item_id:item.id,output_index:0,content_index:0,part:{...content,text:""}},
    {type:"response.output_text.delta",sequence_number:3,item_id:item.id,output_index:0,content_index:0,delta:"ok",logprobs:[]},
    {type:"response.output_text.done",sequence_number:4,item_id:item.id,output_index:0,content_index:0,text:"ok",logprobs:[]},
    {type:"response.content_part.done",sequence_number:5,item_id:item.id,output_index:0,content_index:0,part:content},
    {type:"response.output_item.done",sequence_number:6,output_index:0,item},
    {type:"response.completed",sequence_number:7,response},
  ];
  return events.map((event) => "event: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n").join("");
}

function stableJSON(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableJSON).join(",") + "]";
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(
      (key) => JSON.stringify(key) + ":" + stableJSON(value[key]),
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

function probeSystem(body) {
  if (body.system !== undefined) return body.system;
  if (body.instructions !== undefined) return body.instructions;
  if (Array.isArray(body.messages)) {
    return body.messages.filter((message) => message && message.role === "system");
  }
  if (Array.isArray(body.input)) {
    return body.input.filter((message) => message && message.role === "system");
  }
  return "";
}

function probeToolNames(body) {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.map((tool) => String(
    tool && (tool.name || tool.function && tool.function.name) || "",
  )).filter(Boolean);
}

function installInterception() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const context = probeContext.getStore();
    if (!context) return realFetch(url, init);
    const parsedURL = new URL(String(url));
    if (parsedURL.hostname !== "takumi.corp.kuaishou.com" ||
        !parsedURL.pathname.startsWith("/rest/wanqing/api/gateway/")) {
      throw new Error("interceptor blocked an unexpected request URL");
    }
    const headers = [...new Headers(init.headers).keys()].sort();
    let body = {};
    if (typeof init.body === "string") {
      body = JSON.parse(init.body);
    } else if (init.body instanceof Uint8Array) {
      body = JSON.parse(Buffer.from(init.body).toString("utf8"));
    }
    const serializedSystem = stableJSON(probeSystem(body));
    const system = probeSystem(body);
    const toolNames = probeToolNames(body);
    emit({
      type:"probe",
      requestId:context.requestId,
      probe:{
        requestId:context.requestId,
        model:context.model,
        apiFormat:context.apiFormat,
        url:String(url),
        method:String(init.method || "GET").toUpperCase(),
        headerNames:headers,
        bodyKeys:Object.keys(body).sort(),
        bodyHash:createHash("sha256").update(stableJSON(body)).digest("hex"),
        systemBlocks:Array.isArray(system) ? system.length : system ? 1 : 0,
        toolNames,
        hasMyFlickerIdentity:serializedSystem.includes("You are myflicker, the best coding agent on the planet."),
        hasClaudeIdentity:serializedSystem.includes("You are Claude Code, Anthropic's official CLI"),
      },
    });
    const model = String(body.model || context.model);
    if (context.apiFormat === "anthropic") {
      return new Response(anthropicFixture(model), {status:200,headers:{"content-type":"text/event-stream"}});
    }
    if (context.apiFormat === "openai") {
      return new Response(openAIFixture(model), {status:200,headers:{"content-type":"text/event-stream"}});
    }
    if (context.apiFormat === "responses") {
      return new Response(responsesFixture(model), {status:200,headers:{"content-type":"text/event-stream"}});
    }
    throw new Error("interceptor has no fixture for apiFormat " + context.apiFormat);
  };
}

async function initialize() {
  if (process.env.MYFLICKER_WANQING_INTERCEPT === "1") {
    installInterception();
  }
  const loaded = await loadInternals(packageDirectory());
  const internals = loaded.module;
  const cwd = process.cwd();
  internals.setContext({
    productName: "myflicker",
    version: loaded.version,
    argvConfig: {sessionLoginOnly: false},
    command: "",
    cwd,
    sessionId: randomBytes(4).toString("hex"),
    promptId: randomUUID(),
    isKwaipilot: true,
    isTakumiSdk: false,
  });
  const auth = await internals.login("myflicker", cwd);
  internals.setContext({
    ...internals.getContext(),
    login: auth.login,
    userInfo: auth.userInfo,
  });
  await internals.wanqingPlugin.initialized.call({productName: "myflicker"});
  const providers = internals.wanqingPlugin.provider.call(
    {productName: "myflicker"},
    {},
    {
      models: internals.models,
      createOpenAI: internals.createOpenAI,
      createAnthropic: internals.createAnthropic,
    },
  );
  const wanqing = providers.wanqing;
  if (!wanqing || typeof wanqing.createModel !== "function") {
    throw new Error("MyFlicker wanqing provider is unavailable");
  }
  const catalog = [];
  for (const [id, metadata] of Object.entries(wanqing.models || {})) {
    try {
      await wanqing.createModel(id, wanqing);
      catalog.push(catalogEntry(id, metadata));
    } catch {
      // A model that the native provider cannot create is intentionally omitted.
    }
  }
  emit({type: "ready", myFlickerVersion: loaded.version, catalog});
  return {internals, wanqing};
}

async function dispatch(runtime, frame) {
  const controller = new AbortController();
  controllers.set(frame.requestId, controller);
  try {
    const result = await serializeDispatch(async () => {
      runtime.internals.setContext(nextContext(runtime.internals.getContext()));
      const model = await runtime.wanqing.createModel(frame.model, runtime.wanqing);
      const metadata = runtime.wanqing.models && runtime.wanqing.models[frame.model] || {};
      return await probeContext.run(
        {
          requestId:frame.requestId,
          model:frame.model,
          apiFormat:String(metadata.apiFormat || ""),
        },
        async () => await model.doStream({...frame.payload, abortSignal: controller.signal}),
      );
    });
    for await (const part of result.stream) {
      emit({type: "part", requestId: frame.requestId, part});
    }
    emit({type: "done", requestId: frame.requestId});
  } catch (error) {
    emit({type: "error", requestId: frame.requestId, error: String(error && error.message || "request failed")});
  } finally {
    controllers.delete(frame.requestId);
  }
}

(async () => {
  const runtime = await initialize();
  const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
  input.on("line", (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      fail("invalid worker frame");
      return;
    }
    if (frame.type === "cancel") {
      const controller = controllers.get(frame.requestId);
      if (controller) controller.abort();
      return;
    }
    if (frame.type === "request") {
      void dispatch(runtime, frame);
    }
  });
})().catch((error) => {
  fail(error && error.message || "worker initialization failed");
  process.exitCode = 1;
});
`

type v2ToolAlias struct {
	Claude    string
	MyFlicker string
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

func RunV2(args []string) error {
	if len(args) == 1 && args[0] == "--test-worker" {
		return runTestWorker()
	}
	if names, ok := selectedTests(args, "--self-test"); ok {
		return runV2SelfTests(names)
	}
	if names, ok := selectedTests(args, "--self-test-live"); ok {
		return runLiveSelfTests(names)
	}
	return runProxy(args)
}

func selectedTests(args []string, option string) ([]string, bool) {
	if len(args) == 1 && strings.HasPrefix(args[0], option+"=") {
		return strings.Split(strings.TrimPrefix(args[0], option+"="), ","), true
	}
	if len(args) == 2 && args[0] == option {
		return strings.Split(args[1], ","), true
	}
	return nil, false
}

func runV2SelfTests(names []string) error {
	tests := map[string]func() error{
		"settings":            selfTestSettings,
		"models":              selfTestModels,
		"prompt":              selfTestPrompt,
		"tools":               selfTestTools,
		"worker-transport":    selfTestWorkerTransport,
		"request-conversion":  selfTestRequestConversion,
		"response-conversion": selfTestResponseConversion,
		"field-audit":         selfTestFieldAudit,
		"http":                selfTestHTTP,
	}
	if len(names) == 1 && names[0] == "all" {
		names = []string{
			"settings",
			"models",
			"prompt",
			"tools",
			"worker-transport",
			"request-conversion",
			"response-conversion",
			"field-audit",
			"http",
		}
	}
	for _, name := range names {
		test, ok := tests[name]
		if !ok {
			return fmt.Errorf("unknown self-test %q", name)
		}
		if err := test(); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		fmt.Printf("%s: PASS\n", name)
	}
	return nil
}

func runLiveSelfTests(names []string) error {
	tests := map[string]func() error{
		"catalog":          selfTestLiveCatalog,
		"native-reference": selfTestLiveNativeReference,
		"formats":          selfTestLiveFormats,
	}
	if len(names) == 1 && names[0] == "all" {
		names = []string{"catalog", "native-reference", "formats"}
	}
	for _, name := range names {
		test, ok := tests[name]
		if !ok {
			return fmt.Errorf("unknown live self-test %q", name)
		}
		if err := test(); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		fmt.Printf("%s: PASS\n", name)
	}
	return nil
}

func runProxy(args []string) error {
	settings, err := parseProxySettings(args, environmentMap(os.Environ()))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
	})
	if err != nil {
		return err
	}
	defer worker.Close()
	readyContext, cancelReady := context.WithTimeout(ctx, 45*time.Second)
	defer cancelReady()
	ready, err := worker.Ready(readyContext)
	if err != nil {
		return err
	}
	server, err := newProxyServer(settings, worker, ready.Catalog)
	if err != nil {
		return err
	}
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownContext)
	}()
	fmt.Fprintf(os.Stderr, "MyFlicker Wanqing proxy listening on http://%s with %d models\n", server.Addr, len(ready.Catalog))
	err = server.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	stop()
	<-shutdownDone
	return nil
}

func parseProxySettings(args []string, environ map[string]string) (proxySettings, error) {
	return parseProxySettingsWithLookPath(args, environ, exec.LookPath)
}

func parseProxySettingsWithLookPath(args []string, environ map[string]string, lookPath func(string) (string, error)) (proxySettings, error) {
	settings := proxySettings{
		Host:           defaultProxyHost,
		Port:           defaultProxyPort,
		MaxRequestSize: defaultMaxRequestSize,
		ModelBlacklist: make(map[string]struct{}),
	}

	if value, ok := environ["MYFLICKER_WANQING_PROXY_HOST"]; ok {
		settings.Host = value
	}
	if value, ok := environ["MYFLICKER_WANQING_PROXY_PORT"]; ok {
		port, err := strconv.Atoi(value)
		if err != nil {
			return proxySettings{}, fmt.Errorf("invalid MYFLICKER_WANQING_PROXY_PORT: %w", err)
		}
		settings.Port = port
	}
	if value, ok := environ["MYFLICKER_WANQING_MODEL_BLACKLIST"]; ok {
		for _, id := range strings.Split(value, ",") {
			id = strings.ToLower(strings.TrimSpace(id))
			if id != "" {
				settings.ModelBlacklist[id] = struct{}{}
			}
		}
	}
	if value, ok := environ["MYFLICKER_CLI_DIR"]; ok {
		settings.MyFlickerDir = value
	}
	if value, ok := environ["MYFLICKER_NODE"]; ok {
		settings.NodePath = value
	}

	flags := flag.NewFlagSet("myflicker-wanqing-proxy", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.StringVar(&settings.Host, "host", settings.Host, "loopback listen host")
	flags.IntVar(&settings.Port, "port", settings.Port, "listen port")
	flags.StringVar(&settings.NodePath, "node", settings.NodePath, "Node executable")
	flags.StringVar(&settings.MyFlickerDir, "myflicker-dir", settings.MyFlickerDir, "@myflicker/cli directory")
	flags.Int64Var(&settings.MaxRequestSize, "max-request-size", settings.MaxRequestSize, "maximum request body size")
	if err := flags.Parse(args); err != nil {
		return proxySettings{}, err
	}
	if flags.NArg() != 0 {
		return proxySettings{}, fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}

	if !isV2LoopbackHost(settings.Host) {
		return proxySettings{}, fmt.Errorf("host %q is not an allowed loopback address", settings.Host)
	}
	if settings.Port < 1 || settings.Port > 65535 {
		return proxySettings{}, fmt.Errorf("port %d is outside 1..65535", settings.Port)
	}
	if settings.MaxRequestSize < minimumMaxRequestSize || settings.MaxRequestSize > maximumMaxRequestSize {
		return proxySettings{}, fmt.Errorf("max request size %d is outside 1 KiB..32 MiB", settings.MaxRequestSize)
	}
	nodePath, err := resolveNode(settings.NodePath, lookPath)
	if err != nil {
		return proxySettings{}, err
	}
	settings.NodePath = nodePath
	if packageDir := findV2PackageDirWithLookPath(settings.MyFlickerDir, nodePath, environ, lookPath); packageDir != "" {
		settings.MyFlickerDir = packageDir
	}
	if settings.MyFlickerDir != "" {
		absolute, err := filepath.Abs(settings.MyFlickerDir)
		if err != nil {
			return proxySettings{}, fmt.Errorf("resolve MyFlicker directory: %w", err)
		}
		settings.MyFlickerDir = absolute
	}
	return settings, nil
}

func resolveNode(explicit string, lookPath func(string) (string, error)) (string, error) {
	if explicit != "" {
		absolute, err := filepath.Abs(explicit)
		if err != nil {
			return "", fmt.Errorf("resolve Node executable: %w", err)
		}
		return absolute, nil
	}
	resolved, err := lookPath("node")
	if err != nil {
		return "", fmt.Errorf("find Node executable: %w", err)
	}
	return resolved, nil
}

func newV2NodeVersionCommand(nodePath string) *exec.Cmd {
	command := exec.Command(nodePath, "--version")
	shared.ConfigureBackgroundCommand(command)
	return command
}

func isV2LoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.Equal(net.ParseIP("127.0.0.1")) || ip.Equal(net.ParseIP("::1")))
}

func buildModelIndex(models []modelInfo, blacklist map[string]struct{}) (modelIndex, error) {
	index := modelIndex{
		Models:  make(map[string]modelInfo),
		Aliases: make(map[string]string),
	}
	normalizedBlacklist := make(map[string]struct{}, len(blacklist))
	for id := range blacklist {
		normalizedBlacklist[strings.ToLower(id)] = struct{}{}
	}
	for _, model := range models {
		if model.ID == "" || model.Hidden {
			continue
		}
		canonical := strings.ToLower(model.ID)
		if _, blocked := normalizedBlacklist[canonical]; blocked {
			continue
		}
		if _, exists := index.Models[canonical]; exists {
			return modelIndex{}, fmt.Errorf("duplicate model ID %q", model.ID)
		}
		index.Models[canonical] = model

		names := append([]string{model.ID, "wanqing/" + model.ID}, model.Aliases...)
		if model.EPModelName != "" {
			names = append(names, model.EPModelName, "CLAUDE-MYFLICKER-"+model.EPModelName)
		}
		for _, name := range names {
			alias := strings.ToLower(name)
			if alias == "" {
				continue
			}
			if _, blocked := normalizedBlacklist[alias]; blocked {
				continue
			}
			if existing, exists := index.Aliases[alias]; exists && existing != canonical {
				return modelIndex{}, fmt.Errorf("model alias %q is shared by %q and %q", name, existing, canonical)
			}
			index.Aliases[alias] = canonical
		}
	}
	return index, nil
}

func (i modelIndex) Resolve(requested string) (modelInfo, bool) {
	canonical, ok := i.Aliases[strings.ToLower(requested)]
	if !ok {
		return modelInfo{}, false
	}
	model, ok := i.Models[canonical]
	return model, ok
}

func anthropicRequestToV3(request anthropicMessagesRequest) (map[string]any, v2ToolNameMapping, error) {
	mapping := buildV2ToolNameMapping(request.Tools)
	if request.MaxTokens <= 0 {
		return nil, mapping, errors.New("max_tokens must be a positive integer")
	}
	if len(request.Messages) == 0 {
		return nil, mapping, errors.New("messages must not be empty")
	}

	toolNames := make(map[string]string)
	for _, message := range request.Messages {
		blocks, err := anthropicBlocks(message.Content)
		if err != nil {
			return nil, mapping, err
		}
		for _, block := range blocks {
			if block.Type == "tool_use" {
				toolNames[block.ID] = mapping.Upstream(block.Name)
			}
		}
	}

	prompt, err := anthropicSystemToV3(request.System, mapping)
	if err != nil {
		return nil, mapping, err
	}
	for _, message := range request.Messages {
		if message.Role != "system" {
			continue
		}
		systemMessages, err := anthropicSystemToV3(message.Content, mapping)
		if err != nil {
			return nil, mapping, err
		}
		prompt = append(prompt, systemMessages...)
	}
	for _, message := range request.Messages {
		if message.Role == "system" {
			continue
		}
		if message.Role != "user" && message.Role != "assistant" {
			return nil, mapping, fmt.Errorf("unsupported message role %q", message.Role)
		}
		blocks, err := anthropicBlocks(message.Content)
		if err != nil {
			return nil, mapping, err
		}
		if message.Role == "user" {
			currentRole := ""
			currentContent := make([]any, 0, len(blocks))
			flush := func() {
				if currentRole == "" {
					return
				}
				prompt = append(prompt, map[string]any{
					"role":    currentRole,
					"content": currentContent,
				})
				currentRole = ""
				currentContent = nil
			}
			appendPart := func(role string, part any) {
				if currentRole != role {
					flush()
					currentRole = role
				}
				currentContent = append(currentContent, part)
			}
			for _, block := range blocks {
				switch block.Type {
				case "text":
					part := map[string]any{"type": "text", "text": block.Text}
					addCacheControl(part, block.CacheControl)
					appendPart("user", part)
				case "tool_result":
					toolName, ok := toolNames[block.ToolUseID]
					if !ok {
						return nil, mapping, fmt.Errorf("tool_result %q has no matching tool_use", block.ToolUseID)
					}
					output, err := anthropicToolResultOutput(block.Content)
					if err != nil {
						return nil, mapping, err
					}
					part := map[string]any{
						"type":       "tool-result",
						"toolCallId": block.ToolUseID,
						"toolName":   toolName,
						"output":     output,
					}
					if block.IsError {
						part["providerOptions"] = map[string]any{
							"anthropic": map[string]any{"isError": true},
						}
					}
					appendPart("tool", part)
				case "tool_use":
					return nil, mapping, errors.New("tool_use is only valid in assistant messages")
				case "thinking":
					return nil, mapping, errors.New("thinking is only valid in assistant messages")
				case "image", "document", "audio", "video":
					return nil, mapping, fmt.Errorf("unsupported Anthropic content block: %s", block.Type)
				default:
					return nil, mapping, fmt.Errorf("unsupported Anthropic content block: %s", block.Type)
				}
			}
			flush()
			if len(blocks) == 0 {
				prompt = append(prompt, map[string]any{"role": "user", "content": []any{}})
			}
			continue
		}

		converted := make([]any, 0, len(blocks))
		for _, block := range blocks {
			switch block.Type {
			case "text":
				part := map[string]any{"type": "text", "text": block.Text}
				addCacheControl(part, block.CacheControl)
				converted = append(converted, part)
			case "tool_use":
				if message.Role != "assistant" {
					return nil, mapping, errors.New("tool_use is only valid in assistant messages")
				}
				input := any(map[string]any{})
				if len(block.Input) != 0 {
					if err := json.Unmarshal(block.Input, &input); err != nil {
						return nil, mapping, fmt.Errorf("invalid tool input: %w", err)
					}
				}
				converted = append(converted, map[string]any{
					"type":       "tool-call",
					"toolCallId": block.ID,
					"toolName":   mapping.Upstream(block.Name),
					"input":      input,
				})
			case "thinking":
				if message.Role != "assistant" {
					return nil, mapping, errors.New("thinking is only valid in assistant messages")
				}
				part := map[string]any{"type": "reasoning", "text": block.Thinking}
				if block.Signature != "" {
					part["providerOptions"] = map[string]any{
						"anthropic": map[string]any{"signature": block.Signature},
					}
				}
				converted = append(converted, part)
			case "tool_result":
				return nil, mapping, errors.New("tool_result is only valid in user messages")
			case "image", "document", "audio", "video":
				return nil, mapping, fmt.Errorf("unsupported Anthropic content block: %s", block.Type)
			default:
				return nil, mapping, fmt.Errorf("unsupported Anthropic content block: %s", block.Type)
			}
		}
		prompt = append(prompt, map[string]any{"role": message.Role, "content": converted})
	}

	options := map[string]any{
		"prompt":          prompt,
		"maxOutputTokens": request.MaxTokens,
	}
	if request.Temperature != nil {
		options["temperature"] = *request.Temperature
	}
	if request.TopP != nil {
		options["topP"] = *request.TopP
	}
	if request.TopK != nil {
		options["topK"] = *request.TopK
	}
	if request.StopSequences != nil {
		options["stopSequences"] = request.StopSequences
	}
	if request.Tools != nil {
		tools := make([]any, 0, len(request.Tools))
		for _, tool := range mapV2Tools(request.Tools, mapping) {
			var schema any
			if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
				return nil, mapping, fmt.Errorf("invalid input_schema for tool %q: %w", tool.Name, err)
			}
			converted := map[string]any{
				"type":        "function",
				"name":        tool.Name,
				"description": tool.Description,
				"inputSchema": schema,
			}
			addCacheControl(converted, tool.CacheControl)
			tools = append(tools, converted)
		}
		options["tools"] = tools
	}
	if request.ToolChoice != nil {
		switch request.ToolChoice.Type {
		case "tool":
			options["toolChoice"] = map[string]any{
				"type":     "tool",
				"toolName": mapping.Upstream(request.ToolChoice.Name),
			}
		case "any":
			options["toolChoice"] = map[string]any{"type": "required"}
		case "none":
			options["toolChoice"] = map[string]any{"type": "none"}
		case "auto":
			options["toolChoice"] = map[string]any{"type": "auto"}
		default:
			return nil, mapping, fmt.Errorf("unsupported tool_choice type %q", request.ToolChoice.Type)
		}
	}
	if len(request.Thinking) != 0 && string(request.Thinking) != "null" {
		var thinking map[string]any
		if err := json.Unmarshal(request.Thinking, &thinking); err != nil {
			return nil, mapping, fmt.Errorf("invalid thinking config: %w", err)
		}
		if thinking["type"] != "disabled" {
			if budget, ok := thinking["budget_tokens"]; ok {
				thinking["budgetTokens"] = budget
				delete(thinking, "budget_tokens")
			}
			options["providerOptions"] = map[string]any{
				"wanqing": map[string]any{"thinking": thinking},
			}
		}
	}
	return options, mapping, nil
}

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

func anthropicBlocks(raw json.RawMessage) ([]anthropicContentBlock, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return []anthropicContentBlock{{Type: "text", Text: text}}, nil
	}
	var blocks []anthropicContentBlock
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return nil, errors.New("message content must be a string or block array")
	}
	return blocks, nil
}

func anthropicToolResultOutput(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{"type": "json", "value": nil}, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return map[string]any{"type": "text", "value": text}, nil
	}
	var blocks []anthropicContentBlock
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var builder strings.Builder
		for _, block := range blocks {
			if block.Type != "text" {
				return nil, fmt.Errorf("unsupported tool_result content block: %s", block.Type)
			}
			builder.WriteString(block.Text)
		}
		return map[string]any{"type": "text", "value": builder.String()}, nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, errors.New("invalid tool_result content")
	}
	return map[string]any{"type": "json", "value": value}, nil
}

func addCacheControl(target map[string]any, raw json.RawMessage) {
	if len(raw) == 0 || string(raw) == "null" {
		return
	}
	var cache map[string]any
	if json.Unmarshal(raw, &cache) != nil {
		return
	}
	cacheType, _ := cache["type"].(string)
	if cacheType == "" {
		cacheType = "ephemeral"
	}
	target["providerOptions"] = map[string]any{
		"anthropic": map[string]any{
			"cacheControl": map[string]any{"type": cacheType},
		},
	}
}

type outputBlockState struct {
	Index       int
	Type        string
	PartialJSON strings.Builder
	Block       map[string]any
}

func anthropicSSEFromV3(model string, frames <-chan workerFrame, mapping v2ToolNameMapping) (<-chan v2SSEEvent, <-chan error) {
	events := make(chan v2SSEEvent, 32)
	errs := make(chan error, 1)
	go func() {
		defer close(events)
		defer close(errs)
		errs <- streamAnthropicSSE(model, frames, events, mapping)
	}()
	return events, errs
}

func streamAnthropicSSE(requestedModel string, frames <-chan workerFrame, events chan<- v2SSEEvent, mapping v2ToolNameMapping) error {
	started := false
	finished := false
	messageID := newMessageID()
	model := requestedModel
	nextIndex := 0
	blocks := make(map[string]*outputBlockState)

	startMessage := func() {
		if started {
			return
		}
		started = true
		events <- v2SSEEvent{
			Event: "message_start",
			Data: map[string]any{
				"type": "message_start",
				"message": map[string]any{
					"id":            messageID,
					"type":          "message",
					"role":          "assistant",
					"model":         model,
					"content":       []any{},
					"stop_reason":   nil,
					"stop_sequence": nil,
					"usage":         map[string]any{"input_tokens": 0, "output_tokens": 0},
				},
			},
		}
	}

	for frame := range frames {
		if frame.Type == "error" {
			return errors.New(frame.Error)
		}
		if frame.Type != "part" {
			continue
		}
		part, err := decodeV3Part(frame.Part)
		if err != nil {
			return err
		}
		partType := v2StringValue(part["type"])
		partID := v2StringValue(part["id"])
		switch partType {
		case "response-metadata":
			if value := v2StringValue(part["id"]); value != "" {
				messageID = value
			}
			if value := v2StringValue(part["modelId"]); value != "" {
				model = value
			}
			startMessage()
		case "stream-start", "tool-call":
		case "text-start", "reasoning-start":
			startMessage()
			blockType := "text"
			contentBlock := map[string]any{"type": "text", "text": ""}
			if partType == "reasoning-start" {
				blockType = "thinking"
				contentBlock = map[string]any{"type": "thinking", "thinking": "", "signature": ""}
			}
			block := &outputBlockState{Index: nextIndex, Type: blockType}
			nextIndex++
			blocks[partID] = block
			events <- v2SSEEvent{
				Event: "content_block_start",
				Data: map[string]any{
					"type":          "content_block_start",
					"index":         block.Index,
					"content_block": contentBlock,
				},
			}
		case "text-delta", "reasoning-delta":
			startMessage()
			block := blocks[partID]
			if block == nil {
				return fmt.Errorf("%s arrived before its start event", partType)
			}
			if delta := v2StringValue(part["delta"]); delta != "" {
				deltaType := "text_delta"
				deltaValue := map[string]any{"type": deltaType, "text": delta}
				if block.Type == "thinking" {
					deltaValue = map[string]any{"type": "thinking_delta", "thinking": delta}
				}
				events <- v2SSEEvent{
					Event: "content_block_delta",
					Data: map[string]any{
						"type":  "content_block_delta",
						"index": block.Index,
						"delta": deltaValue,
					},
				}
			}
			if signature := providerSignature(part); signature != "" {
				events <- v2SSEEvent{
					Event: "content_block_delta",
					Data: map[string]any{
						"type":  "content_block_delta",
						"index": block.Index,
						"delta": map[string]any{"type": "signature_delta", "signature": signature},
					},
				}
			}
		case "text-end", "reasoning-end":
			startMessage()
			block := blocks[partID]
			if block == nil {
				return fmt.Errorf("%s arrived before its start event", partType)
			}
			events <- v2SSEEvent{
				Event: "content_block_stop",
				Data:  map[string]any{"type": "content_block_stop", "index": block.Index},
			}
			delete(blocks, partID)
		case "tool-input-start":
			startMessage()
			block := &outputBlockState{Index: nextIndex, Type: "tool_use"}
			nextIndex++
			blocks[partID] = block
			events <- v2SSEEvent{
				Event: "content_block_start",
				Data: map[string]any{
					"type":  "content_block_start",
					"index": block.Index,
					"content_block": map[string]any{
						"type":  "tool_use",
						"id":    partID,
						"name":  mapping.Claude(v2StringValue(part["toolName"])),
						"input": map[string]any{},
					},
				},
			}
		case "tool-input-delta":
			startMessage()
			block := blocks[partID]
			if block == nil {
				return errors.New("tool-input-delta arrived before its start event")
			}
			events <- v2SSEEvent{
				Event: "content_block_delta",
				Data: map[string]any{
					"type":  "content_block_delta",
					"index": block.Index,
					"delta": map[string]any{
						"type":         "input_json_delta",
						"partial_json": v2StringValue(part["delta"]),
					},
				},
			}
		case "tool-input-end":
			startMessage()
			block := blocks[partID]
			if block == nil {
				return errors.New("tool-input-end arrived before its start event")
			}
			events <- v2SSEEvent{
				Event: "content_block_stop",
				Data:  map[string]any{"type": "content_block_stop", "index": block.Index},
			}
			delete(blocks, partID)
		case "error":
			return fmt.Errorf("AI SDK stream failed: %s", v2StringValue(part["error"]))
		case "finish":
			startMessage()
			finished = true
			events <- v2SSEEvent{
				Event: "message_delta",
				Data: map[string]any{
					"type": "message_delta",
					"delta": map[string]any{
						"stop_reason":   finishStopReason(part["finishReason"]),
						"stop_sequence": nil,
					},
					"usage": map[string]any{
						"output_tokens": usageTotal(nestedValue(part, "usage", "outputTokens")),
					},
				},
			}
			events <- v2SSEEvent{Event: "message_stop", Data: map[string]any{"type": "message_stop"}}
		}
	}
	if !finished {
		return errors.New("AI SDK stream ended without a finish part")
	}
	return nil
}

func anthropicMessageFromV3(requestedModel string, frames <-chan workerFrame, mapping v2ToolNameMapping) (anthropicMessage, error) {
	message := anthropicMessage{
		ID:           newMessageID(),
		Type:         "message",
		Role:         "assistant",
		Model:        requestedModel,
		Content:      []any{},
		StopSequence: nil,
	}
	blocks := make(map[string]*outputBlockState)
	completedTools := make(map[string]struct{})
	finished := false
	for frame := range frames {
		if frame.Type == "error" {
			return anthropicMessage{}, errors.New(frame.Error)
		}
		if frame.Type != "part" {
			continue
		}
		part, err := decodeV3Part(frame.Part)
		if err != nil {
			return anthropicMessage{}, err
		}
		partType := v2StringValue(part["type"])
		partID := v2StringValue(part["id"])
		switch partType {
		case "response-metadata":
			if value := v2StringValue(part["id"]); value != "" {
				message.ID = value
			}
			if value := v2StringValue(part["modelId"]); value != "" {
				message.Model = value
			}
		case "text-start":
			block := map[string]any{"type": "text", "text": ""}
			blocks[partID] = &outputBlockState{Type: "text", Block: block}
			message.Content = append(message.Content, block)
		case "text-delta":
			state := blocks[partID]
			if state == nil {
				return anthropicMessage{}, errors.New("text-delta arrived before text-start")
			}
			state.Block["text"] = v2StringValue(state.Block["text"]) + v2StringValue(part["delta"])
		case "reasoning-start":
			block := map[string]any{"type": "thinking", "thinking": "", "signature": ""}
			blocks[partID] = &outputBlockState{Type: "thinking", Block: block}
			message.Content = append(message.Content, block)
		case "reasoning-delta":
			state := blocks[partID]
			if state == nil {
				return anthropicMessage{}, errors.New("reasoning-delta arrived before reasoning-start")
			}
			state.Block["thinking"] = v2StringValue(state.Block["thinking"]) + v2StringValue(part["delta"])
			if signature := providerSignature(part); signature != "" {
				state.Block["signature"] = signature
			}
		case "tool-input-start":
			block := map[string]any{
				"type":  "tool_use",
				"id":    partID,
				"name":  mapping.Claude(v2StringValue(part["toolName"])),
				"input": map[string]any{},
			}
			blocks[partID] = &outputBlockState{Type: "tool_use", Block: block}
			message.Content = append(message.Content, block)
		case "tool-input-delta":
			state := blocks[partID]
			if state == nil {
				return anthropicMessage{}, errors.New("tool-input-delta arrived before tool-input-start")
			}
			state.PartialJSON.WriteString(v2StringValue(part["delta"]))
		case "tool-input-end":
			state := blocks[partID]
			if state == nil {
				return anthropicMessage{}, errors.New("tool-input-end arrived before tool-input-start")
			}
			input := any(map[string]any{})
			if state.PartialJSON.Len() != 0 {
				if err := json.Unmarshal([]byte(state.PartialJSON.String()), &input); err != nil {
					return anthropicMessage{}, fmt.Errorf("invalid streamed tool input: %w", err)
				}
			}
			state.Block["input"] = input
			completedTools[partID] = struct{}{}
		case "tool-call":
			toolCallID := v2StringValue(part["toolCallId"])
			if _, exists := completedTools[toolCallID]; exists {
				continue
			}
			input := part["input"]
			if encoded, ok := input.(string); ok {
				if err := json.Unmarshal([]byte(encoded), &input); err != nil {
					return anthropicMessage{}, fmt.Errorf("invalid tool-call input: %w", err)
				}
			}
			if input == nil {
				input = map[string]any{}
			}
			message.Content = append(message.Content, map[string]any{
				"type":  "tool_use",
				"id":    toolCallID,
				"name":  mapping.Claude(v2StringValue(part["toolName"])),
				"input": input,
			})
			completedTools[toolCallID] = struct{}{}
		case "error":
			return anthropicMessage{}, fmt.Errorf("AI SDK stream failed: %s", v2StringValue(part["error"]))
		case "finish":
			finished = true
			message.StopReason = finishStopReason(part["finishReason"])
			message.Usage = anthropicUsage{
				InputTokens:  usageTotal(nestedValue(part, "usage", "inputTokens")),
				OutputTokens: usageTotal(nestedValue(part, "usage", "outputTokens")),
			}
		}
	}
	if !finished {
		return anthropicMessage{}, errors.New("AI SDK stream ended without a finish part")
	}
	return message, nil
}

func decodeV3Part(raw json.RawMessage) (map[string]any, error) {
	var part map[string]any
	if err := json.Unmarshal(raw, &part); err != nil {
		return nil, fmt.Errorf("decode AI SDK stream part: %w", err)
	}
	return part, nil
}

func newMessageID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("msg_%d", time.Now().UnixNano())
	}
	return "msg_" + hex.EncodeToString(bytes)
}

func v2StringValue(value any) string {
	text, _ := value.(string)
	return text
}

func nestedValue(root map[string]any, keys ...string) any {
	var current any = root
	for _, key := range keys {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func providerSignature(part map[string]any) string {
	return v2StringValue(nestedValue(part, "providerMetadata", "anthropic", "signature"))
}

func finishStopReason(value any) string {
	reason, _ := value.(map[string]any)
	raw := v2StringValue(reason["raw"])
	switch raw {
	case "end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal":
		return raw
	}
	switch v2StringValue(reason["unified"]) {
	case "length":
		return "max_tokens"
	case "tool-calls":
		return "tool_use"
	default:
		return "end_turn"
	}
}

func usageTotal(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case map[string]any:
		return usageTotal(typed["total"])
	default:
		return 0
	}
}

func newProxyServer(settings proxySettings, worker workerBackend, catalog []modelInfo) (*http.Server, error) {
	if worker == nil {
		return nil, errors.New("worker is required")
	}
	models, err := buildModelIndex(catalog, settings.ModelBlacklist)
	if err != nil {
		return nil, err
	}
	filtered := make([]modelInfo, 0, len(models.Models))
	for _, model := range models.Models {
		filtered = append(filtered, model)
	}
	server := &proxyServer{
		settings: settings,
		worker:   worker,
		models:   models,
		catalog:  filtered,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.handleHealth)
	mux.HandleFunc("/_myflicker/health", server.handleHealth)
	mux.HandleFunc("/v1/models", server.handleModels)
	mux.HandleFunc("/v1/messages", server.handleMessages)
	mux.HandleFunc("/v1/messages/count_tokens", server.handleCountTokens)
	return &http.Server{
		Addr:              net.JoinHostPort(settings.Host, strconv.Itoa(settings.Port)),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}, nil
}

func (s *proxyServer) handleHealth(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeAnthropicError(response, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeV2JSON(response, http.StatusOK, map[string]any{
		"ok":               true,
		"mode":             "myflicker-wanqing-provider",
		"myflickerVersion": "0.3.12",
		"models":           len(s.catalog),
	})
}

func (s *proxyServer) handleModels(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeAnthropicError(response, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !loopbackOrigin(request) {
		writeAnthropicError(response, http.StatusUnauthorized, "unauthorized")
		return
	}
	data := make([]any, 0, len(s.catalog))
	for _, model := range s.catalog {
		data = append(data, map[string]any{
			"id":           model.ID,
			"object":       "model",
			"created":      0,
			"owned_by":     "myflicker",
			"display_name": model.Name,
			"api_format":   model.APIFormat,
			"aliases":      model.Aliases,
			"capabilities": model.Metadata,
		})
	}
	writeV2JSON(response, http.StatusOK, map[string]any{"object": "list", "data": data})
}

func (s *proxyServer) handleMessages(response http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodOptions {
		writePreflight(response)
		return
	}
	if request.Method != http.MethodPost {
		writeAnthropicError(response, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !loopbackOrigin(request) {
		writeAnthropicError(response, http.StatusUnauthorized, "unauthorized")
		return
	}
	var input anthropicMessagesRequest
	if status, err := decodeRequestJSON(response, request, s.settings.MaxRequestSize, &input); err != nil {
		writeAnthropicError(response, status, err.Error())
		return
	}
	model, ok := s.models.Resolve(input.Model)
	if !ok {
		writeAnthropicError(response, http.StatusBadRequest, "unknown or unavailable model")
		return
	}
	payload, mapping, err := anthropicRequestToV3(input)
	if err != nil {
		writeAnthropicError(response, http.StatusBadRequest, err.Error())
		return
	}
	frames, err := s.worker.Request(request.Context(), model.ID, payload)
	if err != nil {
		writeAnthropicError(response, http.StatusBadGateway, "Wanqing worker request failed")
		return
	}
	if input.Stream {
		s.writeStream(response, request, model.ID, frames, mapping)
		return
	}
	message, err := anthropicMessageFromV3(model.ID, frames, mapping)
	if err != nil {
		writeAnthropicError(response, http.StatusBadGateway, sanitizeWorkerError(err))
		return
	}
	writeV2JSON(response, http.StatusOK, message)
}

func (s *proxyServer) writeStream(
	response http.ResponseWriter,
	request *http.Request,
	model string,
	frames <-chan workerFrame,
	mapping v2ToolNameMapping,
) {
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeAnthropicError(response, http.StatusInternalServerError, "streaming is unavailable")
		return
	}
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("Connection", "keep-alive")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
	events, errs := anthropicSSEFromV3(model, frames, mapping)
	for event := range events {
		encoded, err := json.Marshal(event.Data)
		if err != nil {
			return
		}
		if _, err := fmt.Fprintf(response, "event: %s\ndata: %s\n\n", event.Event, encoded); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-request.Context().Done():
			return
		default:
		}
	}
	if err := <-errs; err != nil && request.Context().Err() == nil {
		event := map[string]any{
			"type": "error",
			"error": map[string]any{
				"type":    "api_error",
				"message": sanitizeWorkerError(err),
			},
		}
		encoded, marshalErr := json.Marshal(event)
		if marshalErr == nil {
			_, _ = fmt.Fprintf(response, "event: error\ndata: %s\n\n", encoded)
			flusher.Flush()
		}
	}
}

func (s *proxyServer) handleCountTokens(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeAnthropicError(response, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !loopbackOrigin(request) {
		writeAnthropicError(response, http.StatusUnauthorized, "unauthorized")
		return
	}
	var input anthropicMessagesRequest
	if status, err := decodeRequestJSON(response, request, s.settings.MaxRequestSize, &input); err != nil {
		writeAnthropicError(response, status, err.Error())
		return
	}
	encoded, _ := json.Marshal(map[string]any{
		"system":   input.System,
		"messages": input.Messages,
		"tools":    input.Tools,
	})
	tokens := (len(encoded) + 3) / 4
	if tokens < 1 {
		tokens = 1
	}
	writeV2JSON(response, http.StatusOK, map[string]any{"input_tokens": tokens})
}

func decodeRequestJSON(response http.ResponseWriter, request *http.Request, limit int64, target any) (int, error) {
	body := http.MaxBytesReader(response, request.Body, limit)
	decoder := json.NewDecoder(body)
	if err := decoder.Decode(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return http.StatusRequestEntityTooLarge, errors.New("request body is too large")
		}
		return http.StatusBadRequest, errors.New("request body must be valid JSON")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return http.StatusBadRequest, errors.New("request body must contain one JSON value")
	}
	return 0, nil
}

func loopbackOrigin(request *http.Request) bool {
	origin := request.Header.Get("origin")
	if origin == "" {
		return true
	}
	parsed, err := neturl.Parse(origin)
	if err != nil {
		return false
	}
	return isV2LoopbackHost(parsed.Hostname())
}

func writePreflight(response http.ResponseWriter) {
	response.Header().Set("Access-Control-Allow-Origin", "http://127.0.0.1")
	response.Header().Set("Access-Control-Allow-Headers", "authorization, content-type, x-api-key, anthropic-version")
	response.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	response.WriteHeader(http.StatusNoContent)
}

func writeAnthropicError(response http.ResponseWriter, status int, message string) {
	errorType := "invalid_request_error"
	if status == http.StatusUnauthorized {
		errorType = "authentication_error"
	} else if status >= 500 {
		errorType = "api_error"
	}
	writeV2JSON(response, status, map[string]any{
		"type": "error",
		"error": map[string]any{
			"type":    errorType,
			"message": message,
		},
	})
}

func writeV2JSON(response http.ResponseWriter, status int, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		http.Error(response, "JSON encoding failed", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_, _ = response.Write(encoded)
}

func sanitizeWorkerError(_ error) string {
	return "Wanqing worker request failed"
}

func startWorker(ctx context.Context, nodePath, source string, environ []string) (*workerClient, error) {
	command := newV2WorkerCommand(ctx, nodePath, source)
	command.Env = append(os.Environ(), environ...)
	return newWorkerClient(command)
}

func newV2WorkerCommand(ctx context.Context, nodePath, source string) *exec.Cmd {
	command := exec.CommandContext(ctx, nodePath, "-e", source)
	shared.ConfigureBackgroundCommand(command)
	return command
}

func newWorkerClient(command *exec.Cmd) (*workerClient, error) {
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("open worker stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, fmt.Errorf("open worker stdout: %w", err)
	}
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		stdin.Close()
		return nil, fmt.Errorf("start worker: %w", err)
	}
	client := &workerClient{
		cmd:     command,
		stdin:   stdin,
		pending: make(map[string]*workerStream),
		ready:   make(chan workerFrame, 1),
		done:    make(chan struct{}),
	}
	go client.readLoop(stdout)
	go func() {
		err := command.Wait()
		if err == nil {
			err = errors.New("worker exited")
		}
		client.finish(err)
	}()
	return client, nil
}

func (w *workerClient) readLoop(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	for scanner.Scan() {
		var frame workerFrame
		if err := json.Unmarshal(scanner.Bytes(), &frame); err != nil {
			w.finish(errors.New("worker emitted invalid JSON"))
			return
		}
		if frame.Type == "ready" {
			select {
			case w.ready <- frame:
			default:
			}
			continue
		}
		if frame.Type == "error" && frame.RequestID == "" {
			w.finish(errors.New("worker initialization failed"))
			return
		}
		w.route(frame)
	}
	if err := scanner.Err(); err != nil {
		w.finish(errors.New("worker output exceeded the protocol limit"))
		return
	}
	w.finish(errors.New("worker output closed"))
}

func (w *workerClient) route(frame workerFrame) {
	w.mu.Lock()
	stream := w.pending[frame.RequestID]
	if stream == nil {
		w.mu.Unlock()
		return
	}
	terminal := frame.Type == "done" || frame.Type == "error"
	if terminal {
		delete(w.pending, frame.RequestID)
	}
	w.mu.Unlock()

	if frame.Type != "done" {
		stream.send(frame)
	}
	if terminal {
		stream.close()
	}
}

func (w *workerClient) Request(ctx context.Context, model string, payload any) (<-chan workerFrame, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode worker request: %w", err)
	}
	w.mu.Lock()
	select {
	case <-w.done:
		w.mu.Unlock()
		return nil, errors.New("worker is not running")
	default:
	}
	w.nextID++
	requestID := fmt.Sprintf("req-%d", w.nextID)
	stream := &workerStream{frames: make(chan workerFrame, 32)}
	w.pending[requestID] = stream
	w.mu.Unlock()

	if err := w.write(workerFrame{
		Type:      "request",
		RequestID: requestID,
		Model:     model,
		Payload:   encoded,
	}); err != nil {
		w.failRequest(requestID, "worker request could not be sent")
		return nil, err
	}
	context.AfterFunc(ctx, func() {
		_ = w.Cancel(requestID)
	})
	return stream.frames, nil
}

func (w *workerClient) Cancel(requestID string) error {
	w.mu.Lock()
	_, pending := w.pending[requestID]
	w.mu.Unlock()
	if !pending {
		return nil
	}
	return w.write(workerFrame{Type: "cancel", RequestID: requestID})
}

func (w *workerClient) Ready(ctx context.Context) (workerFrame, error) {
	select {
	case frame := <-w.ready:
		return frame, nil
	case <-w.done:
		return workerFrame{}, errors.New("worker exited before becoming ready")
	case <-ctx.Done():
		return workerFrame{}, ctx.Err()
	}
}

func (w *workerClient) write(frame workerFrame) error {
	encoded, err := json.Marshal(frame)
	if err != nil {
		return fmt.Errorf("encode worker frame: %w", err)
	}
	encoded = append(encoded, '\n')
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	if _, err := w.stdin.Write(encoded); err != nil {
		return errors.New("write worker frame")
	}
	return nil
}

func (w *workerClient) failRequest(requestID, message string) {
	w.route(workerFrame{Type: "error", RequestID: requestID, Error: message})
}

func (w *workerClient) finish(_ error) {
	w.closeOnce.Do(func() {
		w.mu.Lock()
		pending := w.pending
		w.pending = make(map[string]*workerStream)
		close(w.done)
		w.mu.Unlock()
		for requestID, stream := range pending {
			stream.send(workerFrame{
				Type:      "error",
				RequestID: requestID,
				Error:     "worker exited unexpectedly",
			})
			stream.close()
		}
	})
}

func (w *workerClient) Close() error {
	_ = w.stdin.Close()
	if w.cmd.Process != nil {
		_ = w.cmd.Process.Kill()
	}
	select {
	case <-w.done:
	case <-time.After(5 * time.Second):
		return errors.New("worker did not exit")
	}
	return nil
}

func selfTestSettings() error {
	got, err := parseProxySettings(nil, map[string]string{})
	if err != nil {
		return err
	}
	if got.Host != "127.0.0.1" || got.Port != 17889 {
		return fmt.Errorf("unexpected defaults: %+v", got)
	}
	_, err = parseProxySettings([]string{"--host", "0.0.0.0"}, map[string]string{})
	if err == nil {
		return errors.New("non-loopback host must fail")
	}
	if _, err := parseProxySettings([]string{"--port", "0"}, map[string]string{}); err == nil {
		return errors.New("invalid port must fail")
	}
	if _, err := parseProxySettings(nil, map[string]string{"MYFLICKER_WANQING_PROXY_KEY": ""}); err != nil {
		return fmt.Errorf("legacy local key must be ignored: %w", err)
	}
	if _, err := parseProxySettings([]string{"--max-request-size", "512"}, map[string]string{}); err == nil {
		return errors.New("undersized request limit must fail")
	}
	if !isV2LoopbackHost("::1") || isV2LoopbackHost("127.0.0.2") {
		return errors.New("loopback host validation mismatch")
	}
	node, err := resolveNode("", func(name string) (string, error) {
		if name != "node" {
			return "", fmt.Errorf("looked up %q", name)
		}
		return `C:\tools\node.exe`, nil
	})
	if err != nil || node != `C:\tools\node.exe` {
		return fmt.Errorf("resolve node: path=%q err=%v", node, err)
	}
	return nil
}

func selfTestModels() error {
	catalog := []modelInfo{
		{ID: "claude-4.6-sonnet", Aliases: []string{"claude-sonnet-4-6"}, EPModelName: "CLAUDE_4_6"},
		{ID: "hidden", Hidden: true},
		{ID: "blocked"},
	}
	index, err := buildModelIndex(catalog, map[string]struct{}{"blocked": {}})
	if err != nil {
		return err
	}
	for _, id := range []string{
		"claude-4.6-sonnet",
		"wanqing/claude-4.6-sonnet",
		"claude-sonnet-4-6",
		"CLAUDE_4_6",
		"CLAUDE-MYFLICKER-CLAUDE_4_6",
	} {
		model, ok := index.Resolve(id)
		if !ok || model.ID != "claude-4.6-sonnet" {
			return fmt.Errorf("model %q resolved to %+v, %t", id, model, ok)
		}
	}
	for _, id := range []string{"hidden", "blocked", "missing"} {
		if model, ok := index.Resolve(id); ok {
			return fmt.Errorf("unavailable model %q resolved to %+v", id, model)
		}
	}
	_, err = buildModelIndex([]modelInfo{
		{ID: "one", Aliases: []string{"shared"}},
		{ID: "two", Aliases: []string{"shared"}},
	}, nil)
	if err == nil {
		return errors.New("alias collision must fail")
	}
	return nil
}

func selfTestPrompt() error {
	mapping := buildV2ToolNameMapping([]anthropicTool{
		{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "Write", InputSchema: json.RawMessage(`{"type":"object"}`)},
	})
	input := `You are Claude Code, Anthropic's official CLI.

Always inspect the workspace before editing. Use ` + "`Read`" + ` before ` + "`Write`" + `.

The user requires all output to remain concise.`
	want := `You are myflicker, the best coding agent on the planet.

Always inspect the workspace before editing. Use ` + "`read`" + ` before ` + "`write`" + `.

The user requires all output to remain concise.`
	if got := rewriteV2SystemText(input, mapping); got != want {
		return fmt.Errorf("rewritten prompt = %q, want %q", got, want)
	}
	nearMatch := "You are using Claude Code with Anthropic documentation."
	if got := rewriteV2SystemText(nearMatch, mapping); got != nearMatch {
		return fmt.Errorf("near-match prompt changed: %q", got)
	}
	return nil
}

func selfTestTools() error {
	input := []anthropicTool{
		{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "mcp__demo__lookup", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "NotebookEdit", InputSchema: json.RawMessage(`{"type":"object"}`)},
	}
	mapping := buildV2ToolNameMapping(input)
	tools := mapV2Tools(input, mapping)
	if len(tools) != 3 ||
		tools[0].Name != "read" ||
		tools[1].Name != "mcp__demo__lookup" ||
		tools[2].Name != "NotebookEdit" {
		return fmt.Errorf("normalized tools = %+v", tools)
	}
	if mapping.Claude("read") != "Read" {
		return fmt.Errorf("reverse read = %q", mapping.Claude("read"))
	}
	return nil
}

func v2TestWorkerCommand(executable string) *exec.Cmd {
	command := exec.Command(executable, "--flicker-bridge-v2", "--test-worker")
	command.Env = append(os.Environ(), "WHEELMAKER_V2_TEST_WORKER=1")
	return command
}

func selfTestWorkerTransport() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	client, err := newWorkerClient(v2TestWorkerCommand(executable))
	if err != nil {
		return err
	}
	defer client.Close()

	ctxA, cancelA := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelA()
	ctxB, cancelB := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelB()
	partsA, err := client.Request(ctxA, "a", map[string]any{"value": "a"})
	if err != nil {
		return err
	}
	partsB, err := client.Request(ctxB, "b", map[string]any{"value": "b"})
	if err != nil {
		return err
	}
	firstA, ok := <-partsA
	if !ok || firstA.RequestID == "" {
		return errors.New("request a ended without a part")
	}
	firstB, ok := <-partsB
	if !ok || firstB.RequestID == "" {
		return errors.New("request b ended without a part")
	}
	if firstA.RequestID == firstB.RequestID {
		return errors.New("worker streams crossed")
	}
	if err := client.Cancel(firstB.RequestID); err != nil {
		return err
	}
	cancelledB := false
	for frame := range partsB {
		var part map[string]any
		if frame.Type == "part" && json.Unmarshal(frame.Part, &part) == nil && part["cancelled"] == true {
			cancelledB = true
		}
	}
	if !cancelledB {
		return errors.New("worker did not receive cancel")
	}
	for range partsA {
	}

	eofClient, err := newWorkerClient(v2TestWorkerCommand(executable))
	if err != nil {
		return err
	}
	defer eofClient.Close()
	eofFrames, err := eofClient.Request(context.Background(), "eof", map[string]any{"secret": "must-not-leak"})
	if err != nil {
		return err
	}
	eofFrame, ok := <-eofFrames
	if !ok || eofFrame.Type != "error" {
		return fmt.Errorf("worker EOF frame = %+v, open=%t", eofFrame, ok)
	}
	if strings.Contains(eofFrame.Error, "must-not-leak") {
		return errors.New("worker EOF error leaked a frame")
	}
	return nil
}

func runTestWorker() error {
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var frame workerFrame
		if err := json.Unmarshal(scanner.Bytes(), &frame); err != nil {
			return err
		}
		switch frame.Type {
		case "request":
			if frame.Model == "eof" {
				return nil
			}
			if err := encoder.Encode(workerFrame{
				Type:      "part",
				RequestID: frame.RequestID,
				Part:      json.RawMessage(`{"started":true}`),
			}); err != nil {
				return err
			}
			if frame.Model == "a" {
				if err := encoder.Encode(workerFrame{Type: "done", RequestID: frame.RequestID}); err != nil {
					return err
				}
			}
		case "cancel":
			if err := encoder.Encode(workerFrame{
				Type:      "part",
				RequestID: frame.RequestID,
				Part:      json.RawMessage(`{"cancelled":true}`),
			}); err != nil {
				return err
			}
			if err := encoder.Encode(workerFrame{Type: "done", RequestID: frame.RequestID}); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}

func selfTestLiveCatalog() error {
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
		"MYFLICKER_WANQING_INTERCEPT=1",
	})
	if err != nil {
		return err
	}
	defer worker.Close()
	ready, err := worker.Ready(ctx)
	if err != nil {
		return err
	}
	if ready.MyFlickerVersion != "0.3.12" {
		return fmt.Errorf("version = %q", ready.MyFlickerVersion)
	}
	index, err := buildModelIndex(ready.Catalog, settings.ModelBlacklist)
	if err != nil {
		return err
	}
	if _, ok := index.Resolve("glm-5.2"); !ok {
		return errors.New("glm-5.2 missing from live catalog")
	}
	return nil
}

type v2NativeReference struct {
	ProductName         string   `json:"productName"`
	Version             string   `json:"version"`
	BodyKeys            []string `json:"bodyKeys"`
	ToolNames           []string `json:"toolNames"`
	HasNativeIdentity   bool     `json:"hasNativeIdentity"`
	HasClaudeIdentity   bool     `json:"hasClaudeIdentity"`
	HasGatewayAuthToken bool     `json:"hasGatewayAuthToken"`
}

const v2NativeCaptureMarker = "WM_NATIVE_CAPTURE="

const v2NativeCapturePreload = `
const realFetch = globalThis.fetch;

function nativeToolNames(body) {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.map((tool) => {
    if (tool && typeof tool.name === "string") return tool.name;
    if (tool && tool.function && typeof tool.function.name === "string") return tool.function.name;
    return "";
  }).filter(Boolean);
}

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  if (!request.url.includes("takumi.corp.kuaishou.com/rest/wanqing/api/gateway/")) {
    return realFetch(input, init);
  }
  const bodyText = await request.clone().text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  const system = JSON.stringify(
    body.system !== undefined ? body.system :
    body.instructions !== undefined ? body.instructions :
    Array.isArray(body.messages) ? body.messages.filter((message) => message && message.role === "system") :
    Array.isArray(body.input) ? body.input.filter((message) => message && message.role === "system") :
    null
  );
  const headers = request.headers;
  console.error("WM_NATIVE_CAPTURE=" + JSON.stringify({
    productName: headers.get("x-takumi-product-name") || "",
    version: headers.get("x-takumi-version") || "",
    bodyKeys: Object.keys(body).sort(),
    toolNames: nativeToolNames(body),
    hasNativeIdentity: system.includes("You are myflicker, the best coding agent on the planet."),
    hasClaudeIdentity: system.includes("You are Claude Code, Anthropic's official CLI"),
    hasGatewayAuthToken: headers.has("x-takumi-token"),
  }));
  const model = String(body.model || "claude-4.8-opus");
  const events = [
    ["message_start", {type:"message_start",message:{id:"msg_native_capture",type:"message",role:"assistant",model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}}],
    ["content_block_start", {type:"content_block_start",index:0,content_block:{type:"text",text:""}}],
    ["content_block_delta", {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"capture-ok"}}],
    ["content_block_stop", {type:"content_block_stop",index:0}],
    ["message_delta", {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}}],
    ["message_stop", {type:"message_stop"}],
  ];
  const stream = events.map(([event, data]) =>
    "event: " + event + "\n" + "data: " + JSON.stringify(data) + "\n\n"
  ).join("");
  return new Response(stream, {status:200,headers:{"content-type":"text/event-stream"}});
};
`

func selfTestLiveNativeReference() error {
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		return err
	}
	entry := filepath.Join(settings.MyFlickerDir, "cli.mjs")
	if info, err := os.Stat(entry); err != nil || info.IsDir() {
		return errors.New("MyFlicker package entry is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	command := exec.CommandContext(
		ctx,
		settings.NodePath,
		entry,
		"-q",
		"--no-rules",
		"--approval-mode",
		"dontAsk",
		"--model",
		"claude-4.8-opus",
		"--output-format",
		"json",
		"Reply with capture-ok and do not use tools.",
	)
	preload := "data:text/javascript;base64," + base64.StdEncoding.EncodeToString([]byte(v2NativeCapturePreload))
	command.Env = replaceV2EnvironmentValue(os.Environ(), "NODE_OPTIONS", "--import="+preload)
	shared.ConfigureBackgroundCommand(command)
	output, commandErr := command.CombinedOutput()
	if ctx.Err() != nil {
		return errors.New("native MyFlicker reference capture timed out")
	}
	var reference v2NativeReference
	found := false
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		index := strings.Index(line, v2NativeCaptureMarker)
		if index < 0 {
			continue
		}
		encoded := line[index+len(v2NativeCaptureMarker):]
		if err := json.Unmarshal([]byte(encoded), &reference); err != nil {
			return errors.New("native MyFlicker reference capture was malformed")
		}
		found = true
		break
	}
	if err := scanner.Err(); err != nil {
		return errors.New("native MyFlicker reference capture could not be read")
	}
	if !found {
		if commandErr != nil {
			return errors.New("native MyFlicker reference command failed before request capture")
		}
		return errors.New("native MyFlicker reference did not issue a Wanqing request")
	}
	if commandErr != nil {
		return errors.New("native MyFlicker reference failed after request capture")
	}
	if reference.ProductName != "myflicker" || reference.Version != "0.3.12" {
		return fmt.Errorf("native MyFlicker product metadata = %q/%q", reference.ProductName, reference.Version)
	}
	if !reference.HasGatewayAuthToken {
		return errors.New("native MyFlicker reference omitted the Wanqing authentication header")
	}
	if !reference.HasNativeIdentity || reference.HasClaudeIdentity {
		return errors.New("native MyFlicker identity baseline was not present")
	}
	if len(reference.ToolNames) == 0 {
		return errors.New("native MyFlicker reference did not expose its tool baseline")
	}
	for _, key := range []string{"messages", "model", "system", "tools"} {
		if !containsString(reference.BodyKeys, key) {
			return fmt.Errorf("native MyFlicker request omitted %q", key)
		}
	}
	return nil
}

func replaceV2EnvironmentValue(environ []string, name, value string) []string {
	result := make([]string, 0, len(environ)+1)
	prefix := name + "="
	replaced := false
	for _, entry := range environ {
		if strings.EqualFold(entry[:min(len(entry), len(prefix))], prefix) {
			if !replaced {
				result = append(result, prefix+value)
				replaced = true
			}
			continue
		}
		result = append(result, entry)
	}
	if !replaced {
		result = append(result, prefix+value)
	}
	return result
}

func selfTestLiveFormats() error {
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
		"MYFLICKER_WANQING_INTERCEPT=1",
	})
	if err != nil {
		return err
	}
	defer worker.Close()
	ready, err := worker.Ready(ctx)
	if err != nil {
		return err
	}
	selected := make(map[string]modelInfo)
	for _, model := range ready.Catalog {
		if !model.Hidden && selected[model.APIFormat].ID == "" {
			selected[model.APIFormat] = model
		}
	}
	for _, format := range []string{"anthropic", "openai", "responses"} {
		model := selected[format]
		if model.ID == "" {
			return fmt.Errorf("live catalog has no createable %s model", format)
		}
		var request anthropicMessagesRequest
		if err := json.Unmarshal([]byte(`{
			"max_tokens":16,
			"system":"You are Claude Code, Anthropic's official CLI.",
			"messages":[
				{"role":"user","content":"probe"},
				{"role":"assistant","content":[{"type":"tool_use","id":"toolu_probe","name":"Read","input":{"file_path":"probe.txt"}}]},
				{"role":"user","content":[
					{"type":"tool_result","tool_use_id":"toolu_probe","content":"ok"},
					{"type":"text","text":"continue"}
				]}
			],
			"tools":[{
				"name":"Read",
				"description":"Read a file",
				"input_schema":{"type":"object","properties":{"file_path":{"type":"string"}}}
			}],
			"tool_choice":{"type":"auto"},
			"stream":true
		}`), &request); err != nil {
			return err
		}
		payload, _, err := anthropicRequestToV3(request)
		if err != nil {
			return err
		}
		probes := make([]*outboundProbe, 0, 2)
		for attempt := 0; attempt < 2; attempt++ {
			frames, err := worker.Request(ctx, model.ID, payload)
			if err != nil {
				return err
			}
			var probe *outboundProbe
			finished := false
			for frame := range frames {
				if frame.Type == "error" {
					return fmt.Errorf("%s intercepted request: %s", format, frame.Error)
				}
				if frame.Type == "probe" {
					probe = frame.Probe
				}
				if frame.Type == "part" {
					part, err := decodeV3Part(frame.Part)
					if err != nil {
						return err
					}
					finished = finished || v2StringValue(part["type"]) == "finish"
				}
			}
			if probe == nil || probe.APIFormat != format || probe.Model != model.ID ||
				probe.Method != http.MethodPost || !finished {
				return fmt.Errorf("%s probe=%+v finished=%t", format, probe, finished)
			}
			probes = append(probes, probe)
		}
		probe := probes[0]
		if probe.BodyHash == "" || probe.BodyHash != probes[1].BodyHash {
			return fmt.Errorf("%s request body is not stable across equivalent requests", format)
		}
		if probe.SystemBlocks == 0 || !probe.HasMyFlickerIdentity || probe.HasClaudeIdentity {
			return fmt.Errorf("%s request identity was not rewritten as expected", format)
		}
		if !containsString(probe.ToolNames, "read") {
			return fmt.Errorf("%s request tool names = %v", format, probe.ToolNames)
		}
		if !strings.Contains(probe.URL, "takumi.corp.kuaishou.com/rest/wanqing/api/gateway/") {
			return fmt.Errorf("%s used unexpected URL %q", format, probe.URL)
		}
		for _, header := range []string{
			"x-chat-id",
			"x-takumi-client-id",
			"x-takumi-product-name",
			"x-takumi-session-id",
			"x-takumi-timestamp",
			"x-takumi-token",
			"x-takumi-version",
		} {
			if !containsString(probe.HeaderNames, header) {
				return fmt.Errorf("%s request missing %s: %v", format, header, probe.HeaderNames)
			}
		}
	}
	return nil
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func environmentMap(environ []string) map[string]string {
	result := make(map[string]string, len(environ))
	for _, entry := range environ {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			result[key] = value
		}
	}
	return result
}

func selfTestRequestConversion() error {
	var request anthropicMessagesRequest
	if err := json.Unmarshal([]byte(`{
		"model":"claude-sonnet-4-6",
		"max_tokens":512,
		"system":"You are Claude Code, Anthropic's official CLI.\n\nUse `+"`Read`"+` before `+"`Write`"+`.",
		"messages":[
			{"role":"system","content":"Project policy: keep the answer concise."},
			{"role":"user","content":"inspect"},
			{"role":"assistant","content":[
				{"type":"thinking","thinking":"reason","signature":"sig"},
				{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"a.txt"}}
			]},
			{"role":"user","content":[
				{"type":"tool_result","tool_use_id":"toolu_1","content":"hello"}
			]}
		],
		"tools":[{"name":"Read","description":"Read a file","input_schema":{"type":"object"}}],
		"tool_choice":{"type":"tool","name":"Read"},
		"temperature":0.2,
		"top_p":0.8,
		"top_k":20,
		"stop_sequences":["STOP"],
		"thinking":{"type":"enabled","budget_tokens":256}
	}`), &request); err != nil {
		return err
	}
	converted, _, err := anthropicRequestToV3(request)
	if err != nil {
		return err
	}
	if converted["maxOutputTokens"] != 512 || converted["temperature"] != 0.2 ||
		converted["topP"] != 0.8 || converted["topK"] != 20 {
		return fmt.Errorf("sampling conversion = %+v", converted)
	}
	encoded, err := json.Marshal(converted)
	if err != nil {
		return err
	}
	body := string(encoded)
	for _, expected := range []string{
		`"name":"read"`,
		`"toolName":"read"`,
		`"type":"tool-result"`,
		`"budgetTokens":256`,
		myFlickerIdentityPrompt,
		"Use `read` before `Write`.",
		"Project policy: keep the answer concise.",
	} {
		if !strings.Contains(body, expected) {
			return fmt.Errorf("converted request missing %q: %s", expected, body)
		}
	}
	if strings.Contains(strings.ToLower(body), "claude code") {
		return errors.New("converted request retained Claude Code identity")
	}
	if strings.Count(body, myFlickerIdentityPrompt) != 1 {
		return fmt.Errorf("converted request duplicated MyFlicker identity: %s", body)
	}
	return nil
}

func selfTestResponseConversion() error {
	mapping := buildV2ToolNameMapping([]anthropicTool{
		{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)},
	})
	parts := []string{
		`{"type":"response-metadata","id":"msg_1","modelId":"GLM-5.2"}`,
		`{"type":"reasoning-start","id":"r1"}`,
		`{"type":"reasoning-delta","id":"r1","delta":"thinking","providerMetadata":{"anthropic":{"signature":"sig"}}}`,
		`{"type":"reasoning-end","id":"r1"}`,
		`{"type":"tool-input-start","id":"t1","toolName":"read"}`,
		`{"type":"tool-input-delta","id":"t1","delta":"{\"file_path\":\"x\"}"}`,
		`{"type":"tool-input-end","id":"t1"}`,
		`{"type":"finish","finishReason":{"unified":"tool-calls","raw":"tool_use"},"usage":{"inputTokens":{"total":10},"outputTokens":{"total":4}}}`,
	}
	frames := make(chan workerFrame, len(parts))
	for _, part := range parts {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	events, errs := anthropicSSEFromV3("requested", frames, mapping)
	var got []v2SSEEvent
	for event := range events {
		got = append(got, event)
	}
	if err := <-errs; err != nil {
		return err
	}
	var eventNames []string
	for _, event := range got {
		eventNames = append(eventNames, event.Event)
	}
	expected := []string{
		"message_start",
		"content_block_start",
		"content_block_delta",
		"content_block_delta",
		"content_block_stop",
		"content_block_start",
		"content_block_delta",
		"content_block_stop",
		"message_delta",
		"message_stop",
	}
	if strings.Join(eventNames, ",") != strings.Join(expected, ",") {
		return fmt.Errorf("SSE events = %v", eventNames)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		return err
	}
	if !strings.Contains(string(encoded), `"name":"Read"`) ||
		!strings.Contains(string(encoded), `"signature":"sig"`) {
		return fmt.Errorf("SSE mapping = %s", encoded)
	}

	jsonFrames := make(chan workerFrame, len(parts))
	for _, part := range parts {
		jsonFrames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(jsonFrames)
	message, err := anthropicMessageFromV3("requested", jsonFrames, mapping)
	if err != nil {
		return err
	}
	if message.ID != "msg_1" || message.Model != "GLM-5.2" ||
		message.StopReason != "tool_use" || message.Usage.OutputTokens != 4 {
		return fmt.Errorf("message = %+v", message)
	}
	encoded, err = json.Marshal(message)
	if err != nil {
		return err
	}
	if !strings.Contains(string(encoded), `"name":"Read"`) ||
		!strings.Contains(string(encoded), `"file_path":"x"`) {
		return fmt.Errorf("message mapping = %s", encoded)
	}
	return nil
}

func selfTestFieldAudit() error {
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
		return err
	}
	if len(classified.Unknown) != 0 {
		return fmt.Errorf("unclassified request fields: %v", classified.Unknown)
	}
	return nil
}

type fakeWorkerBackend struct {
	mu        sync.Mutex
	cancelled bool
}

func (f *fakeWorkerBackend) Request(ctx context.Context, _ string, _ any) (<-chan workerFrame, error) {
	frames := make(chan workerFrame, 8)
	context.AfterFunc(ctx, func() {
		f.mu.Lock()
		f.cancelled = true
		f.mu.Unlock()
	})
	for _, part := range []string{
		`{"type":"response-metadata","id":"msg_http","modelId":"GLM-5.2"}`,
		`{"type":"text-start","id":"0"}`,
		`{"type":"text-delta","id":"0","delta":"pong"}`,
		`{"type":"text-end","id":"0"}`,
		`{"type":"finish","finishReason":{"unified":"stop","raw":"end_turn"},"usage":{"inputTokens":{"total":1},"outputTokens":{"total":1}}}`,
	} {
		frames <- workerFrame{Type: "part", Part: json.RawMessage(part)}
	}
	close(frames)
	return frames, nil
}

func selfTestHTTP() error {
	settings := proxySettings{
		Host:           "127.0.0.1",
		Port:           17889,
		MaxRequestSize: 1024,
	}
	fake := &fakeWorkerBackend{}
	catalog := []modelInfo{{
		ID: "glm-5.2", Name: "GLM 5.2", APIFormat: "anthropic",
	}}
	server, err := newProxyServer(settings, fake, catalog)
	if err != nil {
		return err
	}

	do := func(method, target string, body []byte) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, target, bytes.NewReader(body))
		recorder := httptest.NewRecorder()
		server.Handler.ServeHTTP(recorder, request)
		return recorder
	}

	for _, target := range []string{"/health", "/_myflicker/health"} {
		response := do(http.MethodGet, target, nil)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"ok":true`) {
			return fmt.Errorf("%s response = %d %s", target, response.Code, response.Body.String())
		}
	}
	models := do(http.MethodGet, "/v1/models", nil)
	if models.Code != http.StatusOK ||
		!strings.Contains(models.Body.String(), `"id":"glm-5.2"`) ||
		!strings.Contains(models.Body.String(), `"display_name":"GLM 5.2"`) {
		return fmt.Errorf("models response = %d %s", models.Code, models.Body.String())
	}
	crossOriginRequest := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	crossOriginRequest.Header.Set("origin", "https://example.com")
	crossOrigin := httptest.NewRecorder()
	server.Handler.ServeHTTP(crossOrigin, crossOriginRequest)
	if crossOrigin.Code != http.StatusUnauthorized {
		return fmt.Errorf("cross-origin response = %d", crossOrigin.Code)
	}
	requestBody := []byte(`{"model":"glm-5.2","max_tokens":16,"messages":[{"role":"user","content":"ping"}],"stream":true}`)
	streamed := do(http.MethodPost, "/v1/messages", requestBody)
	if streamed.Code != http.StatusOK ||
		!strings.Contains(streamed.Header().Get("content-type"), "text/event-stream") ||
		!strings.Contains(streamed.Body.String(), "event: message_start") ||
		!strings.Contains(streamed.Body.String(), `"text":"pong"`) {
		return fmt.Errorf("stream response = %d %s", streamed.Code, streamed.Body.String())
	}
	nonStreamingBody := bytes.Replace(requestBody, []byte(`"stream":true`), []byte(`"stream":false`), 1)
	nonStreaming := do(http.MethodPost, "/v1/messages", nonStreamingBody)
	if nonStreaming.Code != http.StatusOK ||
		!strings.Contains(nonStreaming.Body.String(), `"text":"pong"`) {
		return fmt.Errorf("JSON response = %d %s", nonStreaming.Code, nonStreaming.Body.String())
	}
	counted := do(http.MethodPost, "/v1/messages/count_tokens", requestBody)
	if counted.Code != http.StatusOK || !strings.Contains(counted.Body.String(), `"input_tokens":`) {
		return fmt.Errorf("count response = %d %s", counted.Code, counted.Body.String())
	}
	unknownBody := bytes.Replace(requestBody, []byte(`glm-5.2`), []byte(`missing`), 1)
	unknown := do(http.MethodPost, "/v1/messages", unknownBody)
	if unknown.Code != http.StatusBadRequest {
		return fmt.Errorf("unknown model response = %d %s", unknown.Code, unknown.Body.String())
	}
	oversizedBody := append([]byte(`{"padding":"`), bytes.Repeat([]byte("x"), 1025)...)
	oversizedBody = append(oversizedBody, []byte(`"}`)...)
	oversized := do(http.MethodPost, "/v1/messages", oversizedBody)
	if oversized.Code != http.StatusRequestEntityTooLarge {
		return fmt.Errorf("oversized response = %d %s", oversized.Code, oversized.Body.String())
	}
	cancelContext, cancel := context.WithCancel(context.Background())
	cancelRequest := httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader(requestBody)).
		WithContext(cancelContext)
	cancel()
	server.Handler.ServeHTTP(httptest.NewRecorder(), cancelRequest)
	deadline := time.Now().Add(time.Second)
	for {
		fake.mu.Lock()
		cancelled := fake.cancelled
		fake.mu.Unlock()
		if cancelled {
			break
		}
		if time.Now().After(deadline) {
			return errors.New("request cancellation did not reach the worker")
		}
		time.Sleep(time.Millisecond)
	}
	return nil
}
