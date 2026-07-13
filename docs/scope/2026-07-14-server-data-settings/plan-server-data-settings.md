# Server Data Settings and Android Direct Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Voice Input, TTS, and DeepSeek configuration into a private server-owned `db/server-data.json`, derive feature availability from configured keys, remove client persistence and legacy key migration, and restore Android direct Volcengine speech with one in-memory credential sync per process.

**Architecture:** A new `internal/serverdata` package exclusively owns the JSON file, validation, private permissions, and atomic writes. Registry exposes authenticated protocol adapters and delegates provider work to focused service packages; Web/Desktop use non-secret snapshots and backend provider calls, while Android declares `wheelmaker-android`, receives only the Volcengine credential, transfers it immediately to Native, and reuses it from process memory for direct speech.

**Tech Stack:** Go 1.26, JSON + existing private atomic writer, Gorilla WebSocket, React 19/TypeScript/Jest, Android Kotlin/OkHttp/JUnit, existing Registry Cookie session and origin-restricted WebMessage bridge.

---

### Task 1: Commit the approved design baseline

**Files:**

- Add: `docs/scope/2026-07-14-server-data-settings/spec-server-data-settings.md`
- Add: `docs/scope/2026-07-14-server-data-settings/plan-server-data-settings.md`

- [x] **Step 1: Verify both documents are internally clean**

Run:

```powershell
$terms = @('TB' + 'D', 'TO' + 'DO', 'implement' + ' later', '待' + '定', '暂' + '定')
rg -n ($terms -join '|') docs/scope/2026-07-14-server-data-settings
git diff --check -- docs/scope/2026-07-14-server-data-settings
```

Expected: the first command has no matches and `git diff --check` emits no errors.

- [ ] **Step 2: Commit the approved scope**

```powershell
git add docs/scope/2026-07-14-server-data-settings
git commit -m "docs: specify server data settings"
```

Expected: one documentation commit containing the approved spec and this plan.

### Task 2: Build the independent Server Data store

**Files:**

- Create: `server/internal/serverdata/store.go`
- Create: `server/internal/serverdata/store_test.go`
- Modify: `server/internal/shared/config.go`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `server/config.example.json`

- [ ] **Step 1: Write failing store tests**

Define the public model in the test before implementing it:

```go
func TestStoreDefaultsAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "server-data.json")
	store := New(path)

	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.VoiceInput.Configured || snapshot.TextToSpeech.Configured || snapshot.DeepSeek.Configured {
		t.Fatalf("default snapshot=%+v", snapshot)
	}
	if snapshot.VoiceInput.Model != VoiceInputModelDoubaoStreamingASR2 {
		t.Fatalf("voice model=%q", snapshot.VoiceInput.Model)
	}
	if snapshot.TextToSpeech.Model != TTSModelMiMoV25 || snapshot.TextToSpeech.Voice != TTSVoiceMia {
		t.Fatalf("tts defaults=%+v", snapshot.TextToSpeech)
	}

	now := time.Date(2026, 7, 14, 1, 2, 3, 0, time.UTC)
	if err := store.UpdateSecret(SecretVolcengineASR, "set", "speech-key", now); err != nil {
		t.Fatal(err)
	}
	value, version, err := store.Secret(SecretVolcengineASR)
	if err != nil || value != "speech-key" || version != now.Format(time.RFC3339) {
		t.Fatalf("secret=%q version=%q err=%v", value, version, err)
	}
}
```

Add focused tests for:

```go
func TestStoreRejectsUnknownFieldsWithoutOverwriting(t *testing.T)
func TestStoreWriteFailurePreservesExistingFile(t *testing.T)
func TestStoreUpdatesModelAndVoiceWithoutReturningSecrets(t *testing.T)
func TestStoreWritesPrivateFile(t *testing.T)
func TestStoreSerializesConcurrentUpdates(t *testing.T)
```

The malformed-file fixture must contain `{"version":1,"unexpected":true}`; after `Snapshot` fails, assert the bytes remain exactly unchanged.

- [ ] **Step 2: Run tests and verify the red state**

Run:

```powershell
Set-Location server
go test ./internal/serverdata -count=1 -v
```

Expected: FAIL because `internal/serverdata` does not exist.

- [ ] **Step 3: Implement the store and schema**

Use this exact shape and keep secret values out of `Snapshot`:

```go
package serverdata

type SecretKind string

const (
	SecretDeepSeek      SecretKind = "deepseek"
	SecretVolcengineASR SecretKind = "volcengineAsr"
	SecretMiMoTTS       SecretKind = "mimoTts"

	VoiceInputModelDoubaoStreamingASR2 = "doubao-streaming-asr-2.0"
	TTSModelMiMoV25                    = "mimo-v2.5-tts"
	TTSVoiceMia                        = "Mia"
)

type secretValue struct {
	Value     string    `json:"value,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type fileData struct {
	Version      int `json:"version"`
	VoiceInput   struct {
		AccessToken secretValue `json:"accessToken"`
		Model       string      `json:"model"`
	} `json:"voiceInput"`
	TextToSpeech struct {
		APIKey secretValue `json:"apiKey"`
		Model  string      `json:"model"`
		Voice  string      `json:"voice"`
	} `json:"textToSpeech"`
	DeepSeek struct {
		APIKey secretValue `json:"apiKey"`
	} `json:"deepseek"`
}

type FeatureSnapshot struct {
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

type VoiceInputSnapshot struct {
	FeatureSnapshot
	Model string `json:"model"`
}

type TTSSnapshot struct {
	FeatureSnapshot
	Model string `json:"model"`
	Voice string `json:"voice"`
}

type Snapshot struct {
	VoiceInput   VoiceInputSnapshot `json:"voiceInput"`
	TextToSpeech TTSSnapshot        `json:"textToSpeech"`
	DeepSeek     FeatureSnapshot    `json:"deepseek"`
}

type Store struct {
	path  string
	mu    sync.Mutex
	write func(string, []byte) error
}
```

Expose only:

```go
func New(path string) *Store
func (s *Store) Snapshot() (Snapshot, error)
func (s *Store) UpdateSecret(kind SecretKind, action, value string, now time.Time) error
func (s *Store) UpdateVoiceInputModel(model string, now time.Time) error
func (s *Store) UpdateTTS(model, voice string, now time.Time) error
func (s *Store) Secret(kind SecretKind) (value, version string, err error)
```

Use `json.Decoder.DisallowUnknownFields`, accept only the existing model/voice option sets, cap the file at 64 KiB, cap secret input at 16 KiB, and call `shared.WriteConfigFile` for private atomic replacement. A missing file returns defaults without creating a file. A parse/permission failure returns an error and never rewrites the source.

- [ ] **Step 4: Remove third-party secrets from runtime config**

Delete these fields and types from `server/internal/shared/config.go`:

```go
Secrets SecretsConfig `json:"secrets,omitempty"`
type SecretValueConfig struct { /* removed */ }
type SecretsConfig struct { /* removed */ }
```

Update `server/internal/shared/shared_test.go` so `config.json` with top-level `secrets` is rejected by strict decoding. Keep `registry.token` unchanged. Confirm `server/config.example.json` contains no third-party secrets.

- [ ] **Step 5: Run store and shared config tests**

Run:

```powershell
Set-Location server
go test ./internal/serverdata ./internal/shared -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit the Server Data foundation**

```powershell
Set-Location ..
git add server/internal/serverdata server/internal/shared server/config.example.json
git commit -m "feat: add server data store"
```

### Task 3: Replace secret protocol with Server configuration protocol

**Files:**

- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Create: `server/internal/registry/server_data_handler.go`
- Create: `server/internal/registry/server_data_handler_test.go`
- Delete: `server/internal/registry/secret_store.go`
- Delete: `server/internal/registry/secret_store_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/cmd/wheelmaker/main.go`
- Modify: `server/cmd/wheelmaker/main_test.go`
- Modify: `docs/registry-protocol.md`

- [ ] **Step 1: Write failing protocol descriptor tests**

Replace the two `security.secret.*` methods with:

```go
const (
	RegistryMethodServerConfigGet                 = "server.config.get"
	RegistryMethodServerConfigUpdate              = "server.config.update"
	RegistryMethodServerAndroidSpeechCredentialGet = "server.androidSpeechCredential.get"
)
```

All three use a new `RegistryRouteServerData`; all allow `client`. Add assertions that the old methods are absent:

```go
for _, method := range []string{"security.secret.status", "security.secret.update"} {
	if _, ok := RegistryMethod(method); ok {
		t.Fatalf("legacy method remains: %s", method)
	}
}
```

Define wire DTOs matching the store snapshot:

```go
type ServerConfigUpdatePayload struct {
	Section string `json:"section"`
	Field   string `json:"field"`
	Action  string `json:"action"`
	Value   string `json:"value,omitempty"`
}

type AndroidSpeechCredentialResponse struct {
	AccessToken string `json:"accessToken"`
	Version     string `json:"version"`
	Model       string `json:"model"`
}
```

- [ ] **Step 2: Write failing Registry handler tests**

Create a fake implementing:

```go
type ServerDataStore interface {
	Snapshot() (serverdata.Snapshot, error)
	UpdateSecret(serverdata.SecretKind, string, string, time.Time) error
	UpdateVoiceInputModel(string, time.Time) error
	UpdateTTS(string, string, time.Time) error
	Secret(serverdata.SecretKind) (string, string, error)
}
```

Cover these cases:

```go
func TestServerConfigGetNeverReturnsSecretValues(t *testing.T)
func TestServerConfigUpdateValidatesSectionFieldAndAction(t *testing.T)
func TestAndroidSpeechCredentialRequiresAndroidClientName(t *testing.T)
func TestAndroidSpeechCredentialReturnsOnlyVolcengineValue(t *testing.T)
func TestConnectInitPersistsClientNameForServerDataGate(t *testing.T)
```

Use `wheelmaker-web` for the rejected connection and `wheelmaker-android` for the accepted connection. Assert the accepted JSON contains `speech-key` but not the fake DeepSeek or MiMo values.

- [ ] **Step 3: Run protocol and handler tests in red state**

```powershell
Set-Location server
go test ./internal/protocol ./internal/registry ./cmd/wheelmaker -run "ServerConfig|AndroidSpeechCredential|ConnectInitPersistsClientName" -count=1 -v
```

Expected: FAIL because the methods, handler, client-name state, and injected store do not exist.

- [ ] **Step 4: Wire the store without making Registry own persistence**

Change Registry configuration to accept an injected interface:

```go
type Config struct {
	Addr               string
	Token              string
	ProtocolVersion    string
	ServerVersion      string
	LogDir             string
	StateDir           string
	ServerData         ServerDataStore
	IPLocationResolver IPLocationResolver
}
```

Remove `ConfigPath` and `secrets *secretStore`. In `cmd/wheelmaker`, create the store once:

```go
ServerData: serverdata.New(filepath.Join(stateDir, "db", "server-data.json")),
```

Add `clientName string` to `connectionState`, normalize `ConnectInitPayload.ClientName` at the input boundary, reject empty or values longer than 80 bytes, and store it after successful init. The Android credential handler must require all of:

```go
state.browserSession &&
state.role == string(rp.RegistryRoleClient) &&
state.clientName == "wheelmaker-android"
```

Return `not_configured` when the Volcengine value is absent. Do not add a new HTTP endpoint or Nginx path.

- [ ] **Step 5: Update DeepSeek/Speech/TTS resolvers to use the injected store**

Replace `s.secrets.Value(...)` calls with narrow helpers backed by `s.serverData.Secret(...)`. Never expose the generic `Secret` method through protocol DTOs. Remove `secret_store.go` completely after all callers compile.

- [ ] **Step 6: Update protocol documentation and run tests**

Document the three methods, explicitly marking `server.androidSpeechCredential.get` as a single-user convenience gate based on spoofable client name rather than device attestation.

Run:

```powershell
go test ./internal/protocol ./internal/registry ./cmd/wheelmaker -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit protocol and Registry integration**

```powershell
Set-Location ..
git add server/internal/protocol server/internal/registry server/cmd/wheelmaker docs/registry-protocol.md
git commit -m "refactor: route server configuration through registry"
```

### Task 4: Extract provider implementations from Registry storage concerns

**Files:**

- Create: `server/internal/speech/volcengine.go`
- Create: `server/internal/speech/volcengine_protocol.go`
- Create: `server/internal/speech/volcengine_test.go`
- Modify: `server/internal/registry/speech_service.go`
- Delete: `server/internal/registry/speech_volcengine.go`
- Delete: `server/internal/registry/speech_volcengine_test.go`
- Create: `server/internal/tts/client.go`
- Create: `server/internal/tts/client_test.go`
- Modify: `server/internal/registry/tts_service.go`
- Modify: `server/internal/registry/tts_service_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write package-boundary tests before moving code**

The Speech package must expose provider concepts without Registry envelopes:

```go
type AudioConfig struct {
	Format  string
	Codec   string
	Rate    int
	Bits    int
	Channel int
}

type Events interface {
	Transcript(text string, final bool)
	Error(code, message string, retryable bool)
}

type Stream interface {
	WriteAudio(context.Context, []byte) error
	Finish(context.Context) error
	Cancel()
}

type Provider interface {
	Start(context.Context, string, AudioConfig, Events) (Stream, error)
}
```

Move the existing Volcengine frame tests unchanged in behavior: full request frame, audio frames, nested transcript extraction, final/error frames, and final empty transcript.

For TTS, define:

```go
type Request struct {
	APIKey string
	Model  string
	Voice  string
	Text   string
}

type Response struct {
	AudioBase64 string
	Format      string
}

type Client interface {
	Synthesize(context.Context, Request) (Response, error)
}
```

Test fixed upstream URL, Authorization injection, request/response size limits, timeout, allowed model/voice values, and redacted upstream errors.

- [ ] **Step 2: Run new package tests in red state**

```powershell
Set-Location server
go test ./internal/speech ./internal/tts -count=1 -v
```

Expected: FAIL because the packages do not exist.

- [ ] **Step 3: Move Volcengine implementation using the known historical/current code**

Use current `registry/speech_volcengine.go` as the source for frame encoding and parsing, changing only package/API types. `registry/speech_service.go` remains the Registry stream adapter and depends on `speech.Provider`; it must not contain endpoint URLs, HTTP headers, binary frame constants, or response parsing.

- [ ] **Step 4: Move MiMo upstream client behind a narrow adapter**

Move fixed URL, HTTP request construction, Authorization, body limits, timeout, response parsing, and model/voice validation into `internal/tts`. Keep `registry/tts_service.go` limited to strict wire decoding, Server Data credential lookup, calling `tts.Client`, and wire response mapping.

- [ ] **Step 5: Run focused and Registry regression tests**

```powershell
go test ./internal/speech ./internal/tts ./internal/registry -run "Speech|Volcengine|TTS|DeepSeek" -count=1
```

Expected: PASS; `rg -n "openspeech.bytedance.com|token-plan-cn.xiaomimimo.com" server/internal/registry` has no matches.

- [ ] **Step 6: Commit provider extraction**

```powershell
Set-Location ..
git add server/internal/speech server/internal/tts server/internal/registry
git commit -m "refactor: extract server provider services"
```

### Task 5: Add the Web Server configuration client model

**Files:**

- Create: `app/web/src/settings/serverSettings.ts`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/registry/RegistryClient.ts`
- Modify: `app/web/src/debug/registryDebug.ts`
- Create: `app/__tests__/web-server-settings-protocol.test.ts`
- Modify: `app/__tests__/web-registry-client-debug.test.ts`

- [ ] **Step 1: Write failing Web protocol and redaction tests**

Define the client model:

```ts
export type ServerSettings = {
  voiceInput: {configured: boolean; updatedAt?: string; model: 'doubao-streaming-asr-2.0'};
  textToSpeech: {configured: boolean; updatedAt?: string; model: TtsModelId; voice: TtsVoiceId};
  deepSeek: {configured: boolean; updatedAt?: string};
};

export type ServerSettingsUpdate = {
  section: 'voiceInput' | 'textToSpeech' | 'deepSeek';
  field: 'key' | 'model' | 'voice';
  action: 'set' | 'clear';
  value?: string;
};
```

Test repository normalization against malformed values, the three exact method names, `wheelmaker-android` connect init selection, and credential debug redaction:

```ts
expect(redactRegistryDebugEnvelope({
  type: 'response',
  method: 'server.androidSpeechCredential.get',
  payload: {accessToken: 'must-not-log', version: 'v1', model: 'doubao-streaming-asr-2.0'},
})).toEqual(expect.objectContaining({
  payload: {accessToken: '[redacted]', version: 'v1', model: 'doubao-streaming-asr-2.0'},
}));
```

- [ ] **Step 2: Run Web tests in red state**

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-server-settings-protocol.test.ts __tests__/web-registry-client-debug.test.ts
```

Expected: FAIL because Server Settings types/methods are absent.

- [ ] **Step 3: Implement repository/service APIs and client name injection**

Use:

```ts
async getServerSettings(): Promise<ServerSettings>
async updateServerSettings(payload: ServerSettingsUpdate): Promise<ServerSettings>
async getAndroidSpeechCredential(): Promise<{accessToken: string; version: string; model: SpeechModelId}>
```

Add `clientName?: 'wheelmaker-web' | 'wheelmaker-desktop' | 'wheelmaker-android'` to `RegistryWorkspaceServiceOptions`, default it to `wheelmaker-web`, and pass it to `RegistryRepository.initialize(url, clientName)`. At module initialization choose:

```ts
const registryClientName = isAndroidNativeSpeechHost()
  ? 'wheelmaker-android'
  : getDesktopWindowBridge()
    ? 'wheelmaker-desktop'
    : 'wheelmaker-web';
```

Do not infer Android from user-agent text.

- [ ] **Step 4: Remove old secret protocol types**

Delete `RegistrySecretKind`, `RegistrySecretStatus`, `RegistrySecretUpdatePayload`, `SecuritySecretStatus`, and `SecuritySecretUpdate`. Update debug redaction so raw debug JSON also contains `[redacted]`, never the credential.

- [ ] **Step 5: Run Web protocol tests and typecheck**

```powershell
npm test -- --runInBand __tests__/web-server-settings-protocol.test.ts __tests__/web-registry-client-debug.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit Web protocol model**

```powershell
Set-Location ..
git add app/web/src/settings/serverSettings.ts app/web/src/registry app/web/src/debug/registryDebug.ts app/__tests__
git commit -m "feat: add web server settings protocol"
```

### Task 6: Move the Settings UI and remove client persistence

**Files:**

- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/web/src/workspace/WorkspaceStore.ts`
- Delete: `app/web/src/settings/backendSecretSettings.ts`
- Delete: `app/web/src/features/speech/speechSettings.ts`
- Delete: `app/web/src/features/tts/ttsSettings.ts`
- Create: `app/web/src/compatibility/browserCredentialCleanup.ts`
- Modify: `app/web/src/features/tts/ttsClient.ts`
- Modify: `app/web/src/features/tts/ttsPlayback.ts`
- Modify: `app/web/src/features/speech/VoiceInputButton.tsx`
- Modify: `app/__tests__/web-backend-secret-settings.test.ts`
- Modify: `app/__tests__/web-browser-credential-hard-cut.test.ts`
- Modify: `app/__tests__/web-speech-settings.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-workspace-persistence-safety.test.ts`

- [ ] **Step 1: Rewrite UI tests to the approved Server section contract**

Assert exact section order and row order:

```ts
expect(source.indexOf("title: 'Chat'"))
  .toBeLessThan(source.indexOf("title: 'Server'"));
expect(source.indexOf("title: 'Server'"))
  .toBeLessThan(source.indexOf("title: 'Connection'"));

const serverSection = source.slice(
  source.indexOf("title: 'Server'"),
  source.indexOf("title: 'Connection'"),
);
expect(serverSection.indexOf('Voice Input')).toBeLessThan(serverSection.indexOf('Text-to-Speech'));
expect(serverSection.indexOf('Text-to-Speech')).toBeLessThan(serverSection.indexOf('DeepSeek'));
expect(serverSection).not.toMatch(/checked=|enabled/);
```

Add behavior assertions that configured status derives feature availability and Key inputs remain empty after successful Set/Replace.

- [ ] **Step 2: Rewrite persistence tests to require a hard cut**

The new contract is:

```ts
expect(persistence).not.toContain('speechSettings: SpeechSettings');
expect(persistence).not.toContain('ttsSettings: TtsSettings');
expect(persistence).not.toContain("speechSettings: 'speechSettings'");
expect(persistence).not.toContain("ttsSettings: 'ttsSettings'");
expect(app).not.toContain('migrateLegacyBackendSecrets');
expect(app).not.toContain('retryBackendSecretMigration');
```

Keep a purge-only test: obsolete `deepseekApiKey`, `speechSettings`, and `ttsSettings` rows are deleted, never converted or uploaded.

- [ ] **Step 3: Run UI/persistence tests in red state**

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-backend-secret-settings.test.ts __tests__/web-browser-credential-hard-cut.test.ts __tests__/web-speech-settings.test.ts __tests__/web-chat-ui.test.ts __tests__/web-workspace-persistence-safety.test.ts
```

Expected: FAIL because the settings are still split and persisted.

- [ ] **Step 4: Implement transient Server Settings state**

Replace `speechSettings`, `ttsSettings`, and `backendSecretStatuses` with one transient state:

```ts
const [serverSettings, setServerSettings] = useState<ServerSettings>(DEFAULT_SERVER_SETTINGS);
const voiceInputEnabled = serverSettings.voiceInput.configured;
const ttsEnabled = serverSettings.textToSpeech.configured;
```

Fetch it after authenticated Registry connection. Set/replace/clear and model/voice changes call `updateServerSettings` and replace the transient snapshot with the response. Do not call `workspaceStore.rememberGlobalState` for Server Settings.

- [ ] **Step 5: Build the Server UI in the approved order**

Move Voice Input and TTS out of Chat. Add `server` to `SettingsSectionId`; render it between Chat and Connection. Each credential editor accepts only draft text and status:

```tsx
<ServerSecretEditor
  label="Volcengine ASR Access Token"
  configured={serverSettings.voiceInput.configured}
  updatedAt={serverSettings.voiceInput.updatedAt}
  onSet={value => updateServerSecret('voiceInput', value)}
  onClear={() => clearServerSecret('voiceInput')}
/>
```

Render order within Voice Input as Key then Model; within TTS as Key then Model then Voice; then DeepSeek Key. Keep fields visible when unconfigured.

- [ ] **Step 6: Delete client configuration and migration code**

Delete the old feature settings modules after moving option IDs/labels to `settings/serverSettings.ts`. Update TTS runtime imports to use the new shared types. Delete legacy extraction/get/clear APIs and retry state. Consolidate purge-only browser cleanup in `app/web/src/compatibility/browserCredentialCleanup.ts`; it deletes known obsolete rows without parsing or migrating their values.

- [ ] **Step 7: Run Web tests, typecheck, and production build**

```powershell
npm test -- --runInBand __tests__/web-backend-secret-settings.test.ts __tests__/web-browser-credential-hard-cut.test.ts __tests__/web-speech-settings.test.ts __tests__/web-chat-ui.test.ts __tests__/web-workspace-persistence-safety.test.ts
npm run tsc:web
npm run build:web
```

Expected: PASS.

- [ ] **Step 8: Commit UI and persistence hard cut**

```powershell
Set-Location ..
git add app/web/src app/__tests__
git commit -m "feat: centralize server settings UI"
```

### Task 7: Restore the Android direct Volcengine client

**Files:**

- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/DoubaoSpeechClient.kt`
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/DoubaoSpeechProtocol.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/DoubaoSpeechProtocolTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidSpeechBridgeProtocol.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidSpeechRuntime.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidSpeechBridgeProtocolTest.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/MainActivityPortRelayCookieTest.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidSpeechCredentialCacheTest.kt`

- [ ] **Step 1: Write failing credential-cache and direct-runtime tests**

The Native runtime contract must be:

```kotlin
data class AndroidSpeechCredentialState(
    val configured: Boolean,
    val version: String
)

fun credentialState(): String
fun configureCredential(accessToken: String, version: String): String
fun clearCredential(): String
```

Tests must assert:

- configuring stores the value only in the current `AndroidSpeechRuntime` instance;
- `credentialState` never returns the Key;
- starting without a credential returns `NOT_CONFIGURED`;
- starting uses `DoubaoSpeechClient` directly and emits transcript events, not PCM `audio` events;
- clear, app background, and server reset cancel active speech and clear the credential where required;
- no Android production source contains `SharedPreferences` or file writes for the ASR Key.

- [ ] **Step 2: Run Android tests in red state**

```powershell
Set-Location mobile/android
./gradlew.bat :app:testDebugUnitTest --tests "com.wheelmaker.android.AndroidSpeech*" --tests "com.wheelmaker.android.DoubaoSpeechProtocolTest"
```

Expected: FAIL because direct client/protocol and credential APIs are absent.

- [ ] **Step 3: Restore protocol/client behavior from the last direct version**

Use these repository blobs as the exact behavioral source instead of reimplementing the binary protocol from memory:

```powershell
git show d3fb055c^:mobile/android/app/src/main/java/com/wheelmaker/android/DoubaoSpeechClient.kt
git show d3fb055c^:mobile/android/app/src/main/java/com/wheelmaker/android/DoubaoSpeechProtocol.kt
git show d3fb055c^:mobile/android/app/src/test/java/com/wheelmaker/android/DoubaoSpeechProtocolTest.kt
```

Restore them through patches, then adapt the constructor so the credential comes from `AndroidSpeechRuntime` memory rather than `AndroidSpeechStartRequest`. Keep fixed endpoint/resource ID, `X-Api-Key`, request ID/sequence headers, frame limits, final handling, and existing OkHttp timeout behavior.

- [ ] **Step 4: Change Native start/events back to direct recognition**

Use a start payload without a Registry stream ID or Key:

```kotlin
data class AndroidSpeechStartRequest(
    val provider: String,
    val model: String,
    val audio: SpeechAudioConfig
)
```

Generate `android-speech-<uuid>` inside Native. Restore `AndroidSpeechEvent.Transcript(text, final)` and remove `AndroidSpeechEvent.Audio`. `AndroidSpeechRuntime` copies the cached credential into the new `DoubaoSpeechClient` only when starting, never serializes it back to Web, and clears references when the session ends.

- [ ] **Step 5: Add origin-restricted credential bridge actions**

Add:

```text
speech.credentialState
speech.configureCredential
speech.clearCredential
```

to the business allowlist only. They require trusted configured Origin/Base Path and main frame through the existing WebMessage listener. They do not require a fresh gesture because synchronization occurs immediately after authenticated connect; `speech.start` continues to require a recent user gesture. `bootstrap.*` must never access these actions.

- [ ] **Step 6: Clear Native credential on server reset/switch**

Call `androidSpeechRuntime.clearCredential()` from the existing `clearCurrentServerState` path before navigating to Bootstrap. Web logout will separately invoke the clear bridge action.

- [ ] **Step 7: Run Android unit tests and lint**

```powershell
./gradlew.bat :app:testDebugUnitTest :app:lintDebug
```

Expected: PASS.

- [ ] **Step 8: Commit Android direct speech**

```powershell
Set-Location ../..
git add mobile/android
git commit -m "feat: restore android direct speech"
```

### Task 8: Synchronize Android credential once and split voice transport

**Files:**

- Modify: `app/web/src/platform/android/androidNativeMessageBridge.ts`
- Modify: `app/web/src/platform/android/androidNativeSpeechRuntime.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/features/speech/voiceInputRuntime.ts`
- Modify: `app/__tests__/web-android-native-message-bridge.test.ts`
- Modify: `app/__tests__/web-android-native-speech-runtime.test.ts`
- Modify: `app/__tests__/web-voice-input-runtime.test.ts`
- Modify: `app/__tests__/web-voice-input-controller.test.ts`

- [ ] **Step 1: Write failing bridge/cache synchronization tests**

Expose in the facade:

```ts
getSpeechCredentialState(): Promise<string>;
configureSpeechCredential(accessToken: string, version: string): Promise<string>;
clearSpeechCredential(): Promise<string>;
```

Test this sync policy:

```ts
if (!serverSettings.voiceInput.configured) clear native;
else if (!nativeState.configured || nativeState.version !== serverSettings.voiceInput.updatedAt) {
  fetch credential once;
  configure native once;
}
```

Two calls with an unchanged version must perform one server credential read total. A changed version, server switch, logout, or `not_configured` performs a clear/refetch as specified.

- [ ] **Step 2: Rewrite native voice-flow tests**

Android expectations:

- never call `service.startSpeech`, `sendSpeechChunk`, `finishSpeech`, or `cancelSpeech`;
- start Native with provider/model/audio only;
- consume Native `transcript`, `level`, `status`, `error`, and `closed` events;
- no `audio` event decoding or `finishAndroidRegistryStream` remains;
- one provider authentication error invalidates the cached version and re-syncs once for the next attempt, without an automatic retry loop.

Web/Desktop expectations remain the existing Registry PCM stream behavior.

- [ ] **Step 3: Run voice tests in red state**

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-android-native-message-bridge.test.ts __tests__/web-android-native-speech-runtime.test.ts __tests__/web-voice-input-runtime.test.ts __tests__/web-voice-input-controller.test.ts
```

Expected: FAIL because Android still starts a Registry speech stream and forwards PCM.

- [ ] **Step 4: Implement credential synchronization after authenticated connect**

Keep Key data out of React state. Implement a single function with local variables only:

```ts
async function synchronizeAndroidSpeechCredential(snapshot: ServerSettings): Promise<void> {
  const runtime = createAndroidNativeSpeechRuntime();
  if (!runtime) return;
  const state = await runtime.credentialState();
  const version = snapshot.voiceInput.updatedAt ?? '';
  if (!snapshot.voiceInput.configured) {
    if (state.configured) await runtime.clearCredential();
    return;
  }
  if (state.configured && state.version === version) return;
  const credential = await service.getAndroidSpeechCredential();
  await runtime.configureCredential(credential.accessToken, credential.version);
  credential.accessToken = '';
}
```

Call it after Server Settings load/update only when `isAndroidNativeSpeechHost()` is true. The Registry debug redactor must run before recording the credential response.

- [ ] **Step 5: Restore the direct Android branch in WorkspaceApp**

Use Native-generated stream IDs and direct transcript events. Remove all Android calls to Registry speech lifecycle methods and PCM queue handling. Keep the Web/Desktop registry branch unchanged. Feature visibility derives from `serverSettings.voiceInput.configured`, not a local toggle.

- [ ] **Step 6: Run voice tests, typecheck, and build**

```powershell
npm test -- --runInBand __tests__/web-android-native-message-bridge.test.ts __tests__/web-android-native-speech-runtime.test.ts __tests__/web-voice-input-runtime.test.ts __tests__/web-voice-input-controller.test.ts
npm run tsc:web
npm run build:web
```

Expected: PASS.

- [ ] **Step 7: Commit Android/Web integration**

```powershell
Set-Location ..
git add app/web/src app/__tests__
git commit -m "feat: sync android speech credential in memory"
```

### Task 9: Centralize retained compatibility and update security documentation

**Files:**

- Rename: `server/cmd/wheelmaker-deploy/legacy_monitor.go` to `server/cmd/wheelmaker-deploy/compatibility.go`
- Modify: `server/cmd/wheelmaker-deploy/main.go`
- Modify: `server/cmd/wheelmaker-deploy/main_test.go`
- Modify: `app/web/src/compatibility/browserCredentialCleanup.ts`
- Modify: `app/__tests__/web-browser-credential-hard-cut.test.ts`
- Modify: `docs/security.md`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `scripts/security_acceptance.ps1`
- Modify: `scripts/security_acceptance.sh`

- [ ] **Step 1: Write structural compatibility and security gates**

Add source assertions that:

```text
migrateLegacyBackendSecrets
extractLegacyBackendSecrets
getLegacyBackendSecrets
clearLegacyBackendSecret
retryBackendSecretMigration
config.json.secrets
```

are absent from production source. Require deploy compatibility entry points (`migrateRegistryToken`, Monitor cleanup, legacy service cleanup) to live in `compatibility.go` or existing platform-specific compatibility files, not in the main install orchestration body.

Allow historical terms only in tests, compatibility modules, and archived scope documents. Add an acceptance assertion that Android production sources contain no Server Data Key persistence APIs.

- [ ] **Step 2: Run the gates in red state**

```powershell
./scripts/security_acceptance.ps1
```

Expected: FAIL until old key migration and scattered deploy compatibility are removed.

- [ ] **Step 3: Consolidate retained deploy compatibility**

Move `migrateRegistryToken` and `retireLegacyMonitor` orchestration beside existing Monitor compatibility functions. Keep current behavior and tests; do not remove Token or Monitor upgrade cleanup. Main deploy flows call named compatibility entry points without embedding migration implementations.

- [ ] **Step 4: Update current documentation**

Document:

- `db/server-data.json` path, plaintext/private permission model, and backups warning;
- Server UI and Key-derived feature availability;
- Android direct speech and the accepted spoofable client-name gate;
- Web/Desktop backend speech/TTS behavior;
- no old Key migration and mandatory new clients/reconfiguration;
- Registry as authenticated adapter, with Server Data/provider implementation in independent packages.

Update the earlier security baseline language so current documentation no longer claims Android can never receive the Volcengine Key.

- [ ] **Step 5: Run compatibility/security tests**

```powershell
Set-Location server
go test ./cmd/wheelmaker-deploy -count=1
Set-Location ..
./scripts/security_acceptance.ps1
```

Expected: PASS.

- [ ] **Step 6: Commit cleanup and documentation**

```powershell
git add server/cmd/wheelmaker-deploy app/web/src/compatibility app/__tests__/web-browser-credential-hard-cut.test.ts docs/security.md README.md INSTALL.md scripts
git commit -m "chore: centralize server compatibility paths"
```

### Task 10: Run full verification and publish the implementation

**Files:**

- Modify only files required to fix failures discovered by the commands below.

- [ ] **Step 1: Run all Go tests**

```powershell
Set-Location server
go test ./... -count=1
```

Expected: PASS.

- [ ] **Step 2: Run all Web tests, typecheck, and production build**

```powershell
Set-Location ../app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: PASS.

- [ ] **Step 3: Run Android tests and lint**

```powershell
Set-Location ../mobile/android
./gradlew.bat :app:testDebugUnitTest :app:lintDebug
```

Expected: PASS.

- [ ] **Step 4: Run security acceptance and source leak scans**

```powershell
Set-Location ../..
./scripts/security_acceptance.ps1
rg -n --glob '!**/dist/**' --glob '!docs/scope/**' "migrateLegacyBackendSecrets|extractLegacyBackendSecrets|config\.json.*secrets|volcengineApiKey|deepseekApiKey"
rg -n --glob '!**/dist/**' "server\.androidSpeechCredential\.get" app/web/src server/internal
```

Expected: acceptance PASS; the first `rg` has no production matches; the second shows only protocol, handler, repository, and redaction paths.

- [ ] **Step 5: Inspect the final diff and working tree**

```powershell
git diff --check
git status --short
git log --oneline --decorate -10
```

Expected: no whitespace errors; only intentional final fixes may be uncommitted.

- [ ] **Step 6: Apply any final verification fixes**

Resolve every intentional issue found in Step 5, rerun its affected verification command, and leave the final plan checkbox update for the repository completion commit.

- [ ] **Step 7: Execute the repository completion gate**

```powershell
git add -A
git commit -m "feat: complete server data settings"
git push origin main
```

Expected: all three commands succeed. The final plan checkbox update ensures the completion commit is non-empty, and `git push origin main` publishes the exact verified tree.

- [ ] **Step 8: Record external acceptance remaining for the owner**

The automated work is complete only after all preceding gates pass. Report one external acceptance item without claiming it was run: install the newly signed APK on a real Android device, authenticate against the HTTPS deployment, configure Volcengine in Server settings, verify the APK connects directly to firehose endpoint, verify a second recording does not issue another credential read, and verify Web voice still traverses the server.
