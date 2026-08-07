# Go MyFlicker Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** Build a single-source-file Windows x64 Go executable that replaces the MyFlicker Python local proxy while omitting every external client configuration writer.

**Architecture:** One Go main package owns startup configuration, Windows state discovery, authentication, model/security caches, upstream HTTP/SSE access, OpenAI/Anthropic/Responses protocol adaptation, local HTTP handlers and built-in tests. The sole Go source is myflicker_bridge.go; --self-test uses deterministic mocks, while regular mode uses the local MyFlicker login state and binds the loopback bridge.

**Tech Stack:** Go 1.26, net/http, encoding/json, crypto/aes, crypto/cipher, crypto/hmac, crypto/sha256, compress/gzip, github.com/klauspost/compress/zstd, modernc.org/sqlite, Windows x64.

---

## File structure

- Create: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\go.mod — Go module declaration plus zstd and CGo-free SQLite dependencies.
- Create: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\go.sum — Go-generated dependency checksum lockfile.
- Create: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go — all bridge logic, tests and CLI in one Go source file.
- Build: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.exe — local test artifact only.
- Do not modify: WheelMaker Go source/config, original Python source, configuration scripts, Git index, commits or remotes.

## Task 1: Bootstrap the single-file Go module and built-in test runner

**Files:**
- Create: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\go.mod
- Create: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go
- Generate: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\go.sum

- [ ] **Step 1: Write the failing settings-default test in the source file**

Create a table-driven self-test registry before defining Settings or parseSettings:

~~~~go
type selfTestCase struct {
    name string
    run  func() error
}

func require(ok bool, format string, args ...any) error {
    if ok {
        return nil
    }
    return fmt.Errorf(format, args...)
}

func testSettingsDefaults() error {
    got, err := parseSettings(nil, nil)
    if err != nil {
        return err
    }
    if err := require(got.Host == "127.0.0.1", "host = %q", got.Host); err != nil {
        return err
    }
    return require(got.Port == 17888, "port = %d", got.Port)
}
~~~~

Register settings-defaults in runSelfTests. The CLI must accept --self-test=<name> and --self-test=all, print one [PASS] line for each passing case and exit nonzero on the first failing case.

- [ ] **Step 2: Run the test and confirm it initially fails**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=settings-defaults

Expected: a compile failure naming undefined Settings or parseSettings.

- [ ] **Step 3: Define the module and minimum runtime configuration**

Create go.mod with this exact content:

~~~~text
module myflickerbridge

go 1.26.0

require (
    github.com/klauspost/compress v1.18.5
    modernc.org/sqlite v1.54.0
)
~~~~

Add the following types and parsing behavior to myflicker_bridge.go:

~~~~go
type Settings struct {
    Host              string
    Port              int
    BaseURL           string
    TokenBaseURL      string
    ChatPath          string
    CachePath         string
    LogPath           string
    BridgeAPIKey      string
    DefaultModel      string
    AuthTimeout       time.Duration
    AuthPollInterval  time.Duration
    UpstreamTimeout   time.Duration
    AllowRemote       bool
    RequirePrivateKey bool
}

func parseSettings(args []string, environ map[string]string) (Settings, error) {
    lookup := func(name, fallback string) string {
        if value, ok := environ[name]; ok && value != "" {
            return value
        }
        return fallback
    }
    fs := flag.NewFlagSet("myflicker_bridge", flag.ContinueOnError)
    host := fs.String("host", lookup("MYFLICKER_HOST", "127.0.0.1"), "")
    port := fs.Int("port", parseInt(lookup("MYFLICKER_PORT", "17888"), 17888), "")
    baseURL := fs.String("base-url", lookup("MYFLICKER_BASE_URL", "https://codeflicker.corp.kuaishou.com"), "")
    tokenURL := fs.String("token-base-url", lookup("MYFLICKER_TOKEN_BASE_URL", "https://myflicker.corp.kuaishou.com"), "")
    if err := fs.Parse(args); err != nil {
        return Settings{}, err
    }
    if *port < 1 || *port > 65535 {
        return Settings{}, fmt.Errorf("port %d is outside 1..65535", *port)
    }
    settings := Settings{
        Host: *host, Port: *port, BaseURL: strings.TrimRight(*baseURL, "/"),
        TokenBaseURL: strings.TrimRight(*tokenURL, "/"),
        ChatPath: lookup("MYFLICKER_CHAT_PATH", "/eapi/kwaipilot/plugin/composer/v3/chat/completions"),
        CachePath: lookup("MYFLICKER_BRIDGE_CACHE", defaultCachePath()),
        LogPath: lookup("MYFLICKER_BRIDGE_LOG", ""),
        BridgeAPIKey: lookup("MYFLICKER_BRIDGE_API_KEY", "00000000000000000000"),
        DefaultModel: lookup("MYFLICKER_DEFAULT_MODEL", "CLAUDE_OPUS_4_7"),
        AuthTimeout: time.Duration(parseInt(lookup("MYFLICKER_AUTH_TIMEOUT", "180"), 180)) * time.Second,
        AuthPollInterval: time.Duration(parseFloat(lookup("MYFLICKER_AUTH_POLL_INTERVAL", "1"), 1) * float64(time.Second)),
        UpstreamTimeout: time.Duration(parseInt(lookup("MYFLICKER_UPSTREAM_TIMEOUT", "600"), 600)) * time.Second,
        AllowRemote: parseBool(lookup("MYFLICKER_ALLOW_REMOTE", "")),
        RequirePrivateKey: parseBool(lookup("MYFLICKER_REQUIRE_PRIVATE_KEY", "")),
    }
    if !isLoopbackHost(settings.Host) && (!settings.AllowRemote || settings.BridgeAPIKey == "00000000000000000000") {
        return Settings{}, errors.New("non-loopback listening requires MYFLICKER_ALLOW_REMOTE=1 and MYFLICKER_BRIDGE_API_KEY")
    }
    if isLoopbackHost(settings.Host) && settings.RequirePrivateKey && settings.BridgeAPIKey == "00000000000000000000" {
        return Settings{}, errors.New("MYFLICKER_REQUIRE_PRIVATE_KEY=1 requires MYFLICKER_BRIDGE_API_KEY")
    }
    return settings, nil
}
~~~~

Implement parseInt, parseFloat, parseBool, defaultCachePath and isLoopbackHost in the same file. Build defaultCachePath from os.Executable plus its directory so the executable stores .cache\cache.json next to itself.

- [ ] **Step 4: Run the passing baseline and create dependency checksums**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go mod tidy; go run . --self-test=settings-defaults

Expected: go.sum exists and output contains [PASS] settings-defaults.

- [ ] **Step 5: Keep the change local**

Run: git -C E:\_Code\kuaishou-misc-tools status --short

Expected: Go module/source changes are visible locally. Do not execute git add, git commit or git push.

## Task 2: Cache, Windows MyFlicker discovery and security-key resolution

**Files:**
- Modify: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go

- [ ] **Step 1: Write failing cache and state tests**

Register cache-round-trip, state-value-decode and security-key-priority. Each test uses a temporary directory and fixture bytes, never the real MyFlicker installation.

~~~~go
func testCacheRoundTrip() error {
    root, err := os.MkdirTemp("", "myflicker-cache-")
    if err != nil {
        return err
    }
    defer os.RemoveAll(root)
    want := authCache{DeviceID: "device-1", Token: "token-1"}
    path := filepath.Join(root, "cache.json")
    if err := writeJSONAtomic(path, want); err != nil {
        return err
    }
    var got authCache
    if err := readJSON(path, &got); err != nil {
        return err
    }
    return require(got == want, "cache = %#v", got)
}

func testStateValueDecode() error {
    values, err := decodeStateValues([]byte("{\"codeflicker.userInfo\":{\"username\":\"bridge-user\"}}"))
    if err != nil {
        return err
    }
    user, ok := values["codeflicker.userInfo"].(map[string]any)
    return require(ok && user["username"] == "bridge-user", "wrong state value")
}
~~~~

- [ ] **Step 2: Verify the new tests fail**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=cache-round-trip; go run . --self-test=state-value-decode; go run . --self-test=security-key-priority

Expected: FAIL because authCache, JSON helpers, state decoding and security-key resolution are absent.

- [ ] **Step 3: Implement cache and Windows discovery**

Define authCache with DeviceID, Token and UpdatedAt. Implement writeJSONAtomic through a same-directory temporary file and rename; implement readJSON with object validation. Add a discovery result carrying username, device ID, token, preferred model, user-data path and install root.

Resolve the Windows state/install data in this order:

1. MYFLICKER_USER_DATA_DIR.
2. APPDATA\MyFlicker\globalStorage\state.vscdb and compatible nested CodeFlicker directories.
3. MYFLICKER_INSTALL_DIR.
4. PATH entries that contain MyFlicker.exe, MyFlicker.cmd or MyFlicker.bat, stepping to the install root.
5. resources\app extension and bundle paths under that root.

Use database/sql with the blank-imported CGo-free modernc.org/sqlite driver to read only codeflicker.userInfo, userSsoInfo, codeflicker.deviceId and composerPreferredModel. If the state DB is unavailable, return an empty discovery value; an explicit usable token remains sufficient to start. Make decodeStateValues the fixture seam so tests never open SQLite.

Implement resolveSecurityKey with this priority: MYFLICKER_SECURITY_KEY_B64, explicit/discovered install bundle key, then an empty result. Base64-decode and require exactly 32 bytes; a malformed explicit variable is a startup error.

- [ ] **Step 4: Verify the cache/discovery tests pass**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=cache-round-trip; go run . --self-test=state-value-decode; go run . --self-test=security-key-priority

Expected: each command prints its [PASS] line.

## Task 3: Device authentication, model catalog and health state

**Files:**
- Modify: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go

- [ ] **Step 1: Write failing auth and catalog mock tests**

Register auth-refresh and model-catalog-merge. Use httptest.Server endpoints and a temporary auth cache. The mock token endpoint returns accessToken fresh-token; the mock catalog endpoints return a base GPT_5_4 entry plus duet and agent capabilities.

- [ ] **Step 2: Verify auth and catalog cases fail**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=auth-refresh; go run . --self-test=model-catalog-merge

Expected: FAIL because AuthManager and ModelCatalog are absent.

- [ ] **Step 3: Implement AuthManager**

Define AuthManager with Settings, an injected HTTP client, a mutex, authCache, discovery result and a browser opener. Implement Load, Ensure, Refresh and Status using these exact rules:

- prefer a usable cached token, then MYFLICKER_TOKEN, then usable app state token;
- JWT expiry must exceed now plus 120 seconds;
- generate/persist a UUID device ID when absent;
- when no usable token exists, GET /identity/register?uuid=<deviceID>, open its URL with rundll32 url.dll,FileProtocolHandler, then poll the device access-token endpoint until AuthTimeout;
- retry one forced refresh after a Flicker upstream 401 or 403;
- Status returns authenticated, device_id and expiry only, never token text.

- [ ] **Step 4: Implement ModelCatalog**

Define ModelEntry with Type, ID, DisplayName, ContextWindow, MaxTokens, SupportsDuet, SupportsAgent and SupportsReasoning. Implement load/save cache, Refresh, Exposed, Resolve and publicModelID. Fetch the agent-model endpoint then model/list?feature=duet and model/list?feature=agent, merge by modelType, prefix display names with MF and map public IDs to CLAUDE-MYFLICKER-<type>. On refresh failure use a valid cache; only then use a defined fallback catalog.

- [ ] **Step 5: Verify auth and catalog cases pass**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=auth-refresh; go run . --self-test=model-catalog-merge

Expected: both commands print [PASS].

## Task 4: Security config, AES/HMAC, zstd and upstream SSE primitives

**Files:**
- Modify: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go

- [ ] **Step 1: Write failing transport tests**

Register security-encrypt-sign, zstd-request-decode and sse-parse. Use a fixed 32-byte key, nonce reader and HMAC key for the first case. Use a klauspost zstd writer fixture for the second case. Parse one event/data block for the third.

~~~~go
func testSSEParse() error {
    events := parseSSE([]byte("event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n"))
    if err := require(len(events) == 1, "events = %d", len(events)); err != nil {
        return err
    }
    return require(events[0].Data != "", "event data is empty")
}
~~~~

- [ ] **Step 2: Verify transport tests fail**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=security-encrypt-sign; go run . --self-test=zstd-request-decode; go run . --self-test=sse-parse

Expected: FAIL because SecurityProcessor, request decoding and SSE parsing are absent.

- [ ] **Step 3: Implement request protection and decoding**

Define SecurityProcessor with Refresh, Protect and ForceRefresh. Refresh caches the upstream security config for 300 seconds. Protect marshals normalized request JSON, applies AES-256-GCM only when the selected rule requires encryption, computes required HMAC-SHA256 signature headers and sets X-Encrypted/X-Config-Version only for matching rules. Decode identity, gzip and zstd request bodies; reject unrecognized content encodings with HTTP 415.

- [ ] **Step 4: Implement upstream client and streaming parser**

Define upstreamRequest, upstreamResponse, UpstreamHTTPError and SSEEvent. Build kwaipilot headers with content type, language, username, platform, bundle version and fresh request UUID; append Authorization only when MYFLICKER_SEND_AUTHORIZATION is true. Parse SSE line-by-line while retaining event/data grouping and recognizing [DONE]. Do not write local response headers before authentication and upstream request setup have succeeded.

- [ ] **Step 5: Verify transport tests pass**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=security-encrypt-sign; go run . --self-test=zstd-request-decode; go run . --self-test=sse-parse

Expected: all three commands print [PASS].

## Task 5: OpenAI Chat conversion, media/tools and bounded upstream retry

**Files:**
- Modify: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go

- [ ] **Step 1: Write failing OpenAI tests**

Register openai-tools-images, openai-stream-reasoning, busy-retry-before-output, no-retry-after-output, quota-precheck-blocks and credit-logging-nonblocking. Fixtures must contain a data URL image, a text attachment, a function tool, reasoning delta, content delta, tool-call delta, 520 busy before output and 520 busy after visible output.

- [ ] **Step 2: Verify OpenAI tests fail**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=openai-tools-images; go run . --self-test=openai-stream-reasoning; go run . --self-test=busy-retry-before-output; go run . --self-test=no-retry-after-output; go run . --self-test=quota-precheck-blocks; go run . --self-test=credit-logging-nonblocking

Expected: FAIL because the OpenAI conversion and relay functions are absent.

- [ ] **Step 3: Implement OpenAI normalization**

Define OpenAIChatRequest, UpstreamChatRequest, convertOpenAIMessages, convertOpenAITools, convertTextAttachment, resolveThinkingConfig and normalizeOpenAIChunk. Convert text, image_url data URLs, text attachments, tool calls and tool result messages to the native schema. Accept only exact known real or public model IDs, reject provider-family aliases, translate reasoning_effort to the existing thinking budget rules and omit OpenAI-only fields from upstream JSON.

- [ ] **Step 4: Implement Chat relay and fallback policy**

Add handleChatCompletions. Call auth, catalog model validation, security protection and v3 chat. Before a visible client chunk, retry 520 up to MYFLICKER_BUSY_RETRIES with MYFLICKER_BUSY_RETRY_DELAY_SECONDS. Switch to v2 standalone only for v3 406, v3 messages-is-empty 500, normal completion with zero visible chunks or non-busy SSE code at least 500 before output. After a visible chunk, neither retry nor fallback. Before dispatch, use a cached credit result to block a known exhausted quota; after the final response, query credit asynchronously with MYFLICKER_CREDIT_TIMEOUT and log usage/credit without delaying the client stream. Emit OpenAI JSON or SSE chunks preserving reasoning, tool calls, finish reason, usage and [DONE].

- [ ] **Step 5: Verify OpenAI cases pass**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=openai-tools-images; go run . --self-test=openai-stream-reasoning; go run . --self-test=busy-retry-before-output; go run . --self-test=no-retry-after-output; go run . --self-test=quota-precheck-blocks; go run . --self-test=credit-logging-nonblocking

Expected: all four commands print [PASS].

## Task 6: Anthropic Messages, token counting and Responses conversion

**Files:**
- Modify: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go

- [ ] **Step 1: Write failing Anthropic and Responses tests**

Register anthropic-tool-roundtrip, anthropic-stream-stop, anthropic-count-tokens, responses-conversion and responses-compaction. The Anthropic fixture must include tool_use followed by tool_result. The stream fixture asserts message_start, content_block_delta, message_delta and message_stop order. The Responses fixture includes function-call items and a compaction marker.

- [ ] **Step 2: Verify conversion tests fail**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=anthropic-tool-roundtrip; go run . --self-test=anthropic-stream-stop; go run . --self-test=anthropic-count-tokens; go run . --self-test=responses-conversion; go run . --self-test=responses-compaction

Expected: FAIL because protocol adapters and stream writers are absent.

- [ ] **Step 3: Implement Anthropic compatibility**

Implement anthropicToOpenAIRequest, anthropicContentToOpenAI, anthropicToolsToOpenAI, openAIResultToAnthropic and AnthropicStreamWriter. Preserve system blocks, text, image source blocks, tool_use IDs and tool_result IDs as structured data. Implement /v1/messages/count_tokens over normalized text, tool JSON and media placeholder units with Anthropic request validation and response shape.

- [ ] **Step 4: Implement Flicker Responses compatibility**

Implement responsesToOpenAIRequest, responsesInputToMessages, responsesToolsToOpenAI, openAIResultToResponse, ResponsesStreamWriter and compaction marker encode/decode functions. Preserve item IDs, function arguments, reasoning content and compaction state for non-stream and stream requests. Use the same Flicker chat/retry/fallback transport path as OpenAI Chat.

- [ ] **Step 5: Verify all conversion cases pass**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=anthropic-tool-roundtrip; go run . --self-test=anthropic-stream-stop; go run . --self-test=anthropic-count-tokens; go run . --self-test=responses-conversion; go run . --self-test=responses-compaction

Expected: all five commands print [PASS].

## Task 7: Official Codex transparent relay and local HTTP contract

**Files:**
- Modify: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go

- [ ] **Step 1: Write failing server tests**

Register codex-official-transparent-relay, local-api-key-guard, health-models-endpoints, auth-status-redacts-token and no-client-config-writers. The Codex mock returns status 207, X-Relay: kept and raw SSE bytes. The configuration boundary test supplies temporary Claude, Codex, CC Switch and CCR folders and asserts they remain absent after startup and one request.

- [ ] **Step 2: Verify server tests fail**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=codex-official-transparent-relay; go run . --self-test=local-api-key-guard; go run . --self-test=health-models-endpoints; go run . --self-test=auth-status-redacts-token; go run . --self-test=no-client-config-writers

Expected: FAIL because BridgeServer and Codex relay routes are absent.

- [ ] **Step 3: Implement exact official Codex routing**

Load official Codex slugs from the local Codex catalog plus built-in known slugs. For an exact official model only, resolve the current Codex OAuth bearer/account headers or an sk API key, decode the client body, then forward it to chatgpt.com or api.openai.com. Copy upstream status, safe response headers and raw response bytes without Flicker conversion, retry or fallback. A failed official request must return that failure directly.

- [ ] **Step 4: Implement BridgeServer and all routes**

Define BridgeServer with Settings, AuthManager, ModelCatalog, SecurityProcessor, upstream client and log writer. Register exactly:

~~~~text
GET  /health
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
POST /v1/messages
POST /v1/messages/count_tokens
GET  /_myflicker/auth
POST /_myflicker/auth/refresh
~~~~

Apply loopback Origin/remote-address checks and constant-time Bearer/x-api-key validation. Return OpenAI error JSON for Chat/Responses and Anthropic error JSON for Messages. Do not register configuration routes, execute client programs, open client configuration databases or write outside the bridge cache/log paths.

- [ ] **Step 5: Add bounded logs and graceful shutdown**

Implement a synchronized log writer obeying MYFLICKER_LOG_MAX_BYTES or MYFLICKER_LOG_MAX_MB. It may truncate only the bridge log and must write a truncation marker. Redact tokens, bridge keys and Authorization values. Authenticate and load models before ListenAndServe; use signal.NotifyContext and a five-second Server.Shutdown timeout on Ctrl+C.

- [ ] **Step 6: Verify all server cases pass**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=codex-official-transparent-relay; go run . --self-test=local-api-key-guard; go run . --self-test=health-models-endpoints; go run . --self-test=auth-status-redacts-token; go run . --self-test=no-client-config-writers

Expected: all five commands print [PASS].

## Task 8: Build, locally verify and perform authorized upstream smoke tests

**Files:**
- Modify: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go only when a failed verification demonstrates a defect.
- Build: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.exe

- [ ] **Step 1: Run the full deterministic suite**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go run . --self-test=all

Expected: every registered case prints [PASS] and exits 0.

- [ ] **Step 2: Build Windows x64 executable**

Run: cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge; go build -trimpath -o myflicker_bridge.exe .

Expected: myflicker_bridge.exe exists with no build errors.

- [ ] **Step 3: Start the exe with isolated bridge cache and validate local routes**

Run in a PowerShell window:

~~~~powershell
$env:MYFLICKER_BRIDGE_CACHE = "$PWD\.cache\go-test-cache.json"
$env:MYFLICKER_BRIDGE_API_KEY = "local-test-key"
.\myflicker_bridge.exe
~~~~

Run from a second PowerShell window:

~~~~powershell
Invoke-RestMethod http://127.0.0.1:17888/health
Invoke-RestMethod http://127.0.0.1:17888/v1/models -Headers @{ Authorization = "Bearer local-test-key" }
~~~~

Expected: health reports ready after device auth, models has a data array and a wrong token returns HTTP 401.

- [ ] **Step 4: Run authorized MyFlicker live checks**

Send one minimal non-stream and stream request through POST /v1/chat/completions, POST /v1/messages and POST /v1/responses using an exposed Flicker model. Assert HTTP 200, non-empty assistant output and stream terminator. Send one data URL image request, one text attachment and one function-tool request through Chat; assert the upstream accepts them and tool-call chunks remain structured.

- [ ] **Step 5: Run authorized official Codex relay check**

Send a zstd-compressed minimal Responses JSON body to POST /v1/responses with an exact official Codex model. Assert the returned HTTP status and SSE/JSON body match the upstream bytes. Send a deliberately unauthorized official request and assert its error is returned without a Flicker retry.

- [ ] **Step 6: Preserve only local artifacts**

Run:

~~~~powershell
Get-Item .\myflicker_bridge.exe | Select-Object Name,Length,LastWriteTime
git -C E:\_Code\kuaishou-misc-tools status --short
git -C E:\_Code\WheelMaker status --short
~~~~

Expected: the exe is present for user testing, the only WheelMaker changes are scope documents, and no git add, git commit or git push command has run.

## Task 9: Hand off local testing and hold WheelMaker integration

**Files:**
- Deliver: E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.exe

- [ ] **Step 1: Give the user the direct launch command**

~~~~powershell
$env:MYFLICKER_BRIDGE_API_KEY = "<local-bridge-key>"
.\myflicker_bridge.exe
~~~~

Explain that the exe never edits Claude, Codex, CC Switch or CCR configuration; first run may open MyFlicker SSO only when existing local device auth is unavailable.

- [ ] **Step 2: Report evidence without secrets**

Report the self-test result, exe path, local endpoint result and live smoke result using success markers only. Do not print device tokens, API keys, OAuth credentials or upstream response text. Do not touch WheelMaker integration until the user confirms their local exe test passed.
