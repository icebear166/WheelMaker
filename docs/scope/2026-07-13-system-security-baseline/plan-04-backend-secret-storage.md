# Backend Long-Term Secret Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 DeepSeek、火山语音和 MiMo TTS 长期 API Key 迁移到受保护后端 `config.json`，页面只可 set/replace/clear/status，所有需要密钥的第三方请求由 Registry/Hub 后端完成。

**Architecture:** `shared.AppConfig.Secrets` 保存 set-only secret record，Registry 每次更新都重新读取、窄化修改并通过现有原子私有 writer 写回。协议只暴露 secret kind、configured 和 updatedAt。Speech/TTS 由 Registry 加载密钥；DeepSeek 统计由 Registry 在可信后端转发边界注入密钥，浏览器 payload 明确拒绝 `apiKey`。Web 首次连接后迁移旧本地值，成功或服务端已有值后删除旧字段。

**Tech Stack:** Go JSON config、现有跨平台 ACL/atomic writer、Registry protocol、React/TypeScript/Jest、Volcengine WebSocket、MiMo HTTPS API。

---

### Task 1: 建立 set-only 后端 Secret Store 和协议

**Files:**

- Modify: `server/internal/shared/config.go`
- Modify: `server/internal/shared/shared_test.go`
- Create: `server/internal/registry/secret_store.go`
- Create: `server/internal/registry/secret_store_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/cmd/wheelmaker/main.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/protocol/registry.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Create: `app/__tests__/web-backend-secret-protocol.test.ts`

- [ ] **Step 1: 写配置和 store 测试**

固定后端配置模型：

```go
type SecretValueConfig struct {
	Value     string    `json:"value,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type SecretsConfig struct {
	DeepSeek       SecretValueConfig `json:"deepseek,omitempty"`
	VolcengineASR  SecretValueConfig `json:"volcengineAsr,omitempty"`
	MiMoTTS        SecretValueConfig `json:"mimoTts,omitempty"`
}
```

测试 set/replace/clear；写后仍为当前用户私有权限；每次 update 从磁盘 fresh load，保留 projects/registry/log；配置写失败不改变内存可见状态；读取 status 永远不含 `Value`。

- [ ] **Step 2: 写协议契约测试**

固定方法：

```text
security.secret.status       {}
security.secret.update       { kind: "deepseek"|"volcengineAsr"|"mimoTts", action: "set"|"clear", value?: string }
```

Status item 只能为：

```json
{"kind":"deepseek","configured":true,"updatedAt":"2026-07-13T00:00:00Z"}
```

测试序列化响应不含 `value`、`apiKey`、摘要或配置路径。`set` 拒绝空值和大于 16 KiB 的值；`clear` 拒绝附带非空 value。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/shared ./internal/registry ./internal/protocol -run 'TestSecret' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-backend-secret-protocol.test.ts
```

Expected: FAIL；配置、store 和协议方法尚不存在。

- [ ] **Step 4: 实现 store 和 Registry handler**

`registry.Config` 增加 `ConfigPath`，由 `cmd/wheelmaker` 传 `<baseDir>/config.json`。只允许完成认证的 client role 调用；handler 日志只记录 kind/action/success，不记录 request payload。Update 成功后清空局部 `value` 变量。

Store API 固定为：

```go
type secretKind string
func (s *secretStore) Status() ([]rp.SecretStatus, error)
func (s *secretStore) Set(kind secretKind, value string, now time.Time) error
func (s *secretStore) Clear(kind secretKind, now time.Time) error
func (s *secretStore) Value(kind secretKind) (string, bool, error)
```

`Value` 只在 Registry 后端 package 内使用，不放入 protocol DTO。

- [ ] **Step 5: 实现 TypeScript repository 并提交**

Run:

```powershell
Set-Location server
go test ./internal/shared ./internal/registry ./internal/protocol -run 'TestSecret' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-backend-secret-protocol.test.ts
npm run tsc:web
Set-Location ..
git add server/internal/shared server/internal/registry server/internal/protocol server/cmd/wheelmaker app/web/src/registry app/__tests__/web-backend-secret-protocol.test.ts
git commit -m "feat: add set-only backend secret store"
```

Expected: PASS；Web 类型中不存在可读取 secret value 的 response。

### Task 2: 火山语音改为后端读取密钥

**Files:**

- Modify: `server/internal/registry/speech_protocol.go`
- Modify: `server/internal/registry/speech_service.go`
- Modify: `server/internal/registry/speech_volcengine.go`
- Modify: `server/internal/registry/speech_test.go`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/features/speech/speechSettings.ts`
- Modify: `app/__tests__/web-android-native-speech-runtime.test.ts`
- Modify: `app/__tests__/web-speech-client.test.ts`

- [ ] **Step 1: 写无页面 API Key 的语音测试**

Go payload 删除 `apiKey`：

```go
type speechStartPayload struct {
	Provider string            `json:"provider"`
	Audio    speechAudioConfig `json:"audio"`
}
```

测试：客户端包含 `apiKey` 因 `DisallowUnknownFields` 被拒绝；后端未配置返回稳定 `not_configured`；配置后 provider 收到 key；日志/错误/response 不含 key。

Web 测试断言 `speech.start` envelope 和 persisted `SpeechSettings` 不含 `volcengineApiKey`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestSpeech.*(BackendSecret|RejectsAPIKey|NotConfigured)' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-android-native-speech-runtime.test.ts __tests__/web-speech-client.test.ts
```

Expected: FAIL；当前 API key 来自页面 payload。

- [ ] **Step 3: 注入后端 secret resolver**

`speechService` 接收 `func() (string, error)` resolver；只在建立 provider stream 前取值，不把 key 放入长期 speech session struct。Provider request 可在 Registry 内部保留 unexported credential 字段，debug redactor 在任何日志前删除。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestSpeech' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-android-native-speech-runtime.test.ts __tests__/web-speech-client.test.ts
npm run tsc:web
Set-Location ..
git add server/internal/registry app/web/src/registry/registryTypes.ts app/web/src/app/WorkspaceApp.tsx app/web/src/features/speech/speechSettings.ts app/__tests__/web-android-native-speech-runtime.test.ts app/__tests__/web-speech-client.test.ts
git commit -m "refactor: keep speech credentials on backend"
```

Expected: PASS；浏览器发送的语音协议不含长期密钥。

### Task 3: MiMo TTS 改为 Registry 代理

**Files:**

- Create: `server/internal/registry/tts_service.go`
- Create: `server/internal/registry/tts_service_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/protocol/registry.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Rewrite: `app/web/src/features/tts/ttsClient.ts`
- Modify: `app/web/src/features/tts/ttsPlayback.ts`
- Modify: `app/web/src/features/tts/ttsSettings.ts`
- Create: `app/__tests__/web-backend-tts.test.ts`

- [ ] **Step 1: 写 TTS 协议和上游边界测试**

固定方法 `tts.synthesize`，request 只含 `model`、`voice`、`text`；response 为 `audioBase64`、`format`。限制 text 16 KiB，上游 response body 16 MiB、HTTP timeout 45 秒、只请求固定 `https://token-plan-cn.xiaomimimo.com/v1/chat/completions`，禁止客户端提供 URL。

测试 fake upstream 收到后端 `Authorization: Bearer <secret>`，但 Registry response、日志和错误不回显 header/body secret。错误 body 最多读取 4 KiB 并脱敏。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/registry ./internal/protocol -run 'TestTTS' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-backend-tts.test.ts
```

Expected: FAIL；当前浏览器直接 fetch MiMo 并组装 Authorization。

- [ ] **Step 3: 实现后端 service 和 Web repository client**

Registry 只接受允许的 model/voice 枚举；用 `json.Decoder` 解析限定响应。Web `ttsClient` 改为调用当前 `RegistryRepository.synthesizeTTS`，`TtsSettings` 只保留 enabled/model/voice。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/registry ./internal/protocol -run 'TestTTS' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-backend-tts.test.ts
npm run tsc:web
Set-Location ..
git add server/internal/registry server/internal/protocol app/web/src/registry app/web/src/features/tts app/__tests__/web-backend-tts.test.ts
git commit -m "feat: proxy tts through registry backend"
```

Expected: PASS；Web 源码中不再出现 TTS Authorization header。

### Task 4: DeepSeek 统计由可信后端注入密钥

**Files:**

- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/hub/tools/token.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/settings/tokenStatsView.ts`
- Create: `app/__tests__/web-backend-deepseek-secret.test.ts`

- [ ] **Step 1: 写客户端 payload 拒绝和后端注入测试**

客户端 `deepseekStats` payload 只允许 `rangeType`/`month`。若浏览器发送 `apiKey`，Registry 返回 invalid argument，而不是悄悄接受。Registry 从 secret store 取值，构造仅在 Registry→Hub 后端链路存在的内部 payload；debug logging 对该字段一律 `[redacted]`。

未配置时不向 Hub 发请求，返回 `not_configured`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/registry ./internal/hub ./internal/hub/tools -run 'Test.*DeepSeek.*Secret' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-backend-deepseek-secret.test.ts
```

Expected: FAIL；当前 repository 把页面 apiKey 发送给 Hub。

- [ ] **Step 3: 实现可信转发边界**

Registry 在 `tokenStats/deepseekStats` 专用 handler 内注入；不要做通用“任意 payload secret merge”。Hub 工具保留后端参数，但所有 envelope redactor 必须在日志前处理 `apiKey`。Registry↔Hub 公网连接继续依赖现有 WSS；明文 ws 只允许 loopback。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/registry ./internal/hub ./internal/hub/tools -run 'Test.*DeepSeek' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-backend-deepseek-secret.test.ts
npm run tsc:web
Set-Location ..
git add server/internal/registry server/internal/hub app/web/src/registry/RegistryRepository.ts app/web/src/settings/tokenStatsView.ts app/__tests__/web-backend-deepseek-secret.test.ts
git commit -m "refactor: inject deepseek secret on backend"
```

Expected: PASS；浏览器 payload 不含 DeepSeek key。

### Task 5: 设置 UI 改为 set-only 并迁移旧浏览器值

**Files:**

- Create: `app/web/src/settings/backendSecretSettings.ts`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/web/src/features/speech/speechSettings.ts`
- Modify: `app/web/src/features/tts/ttsSettings.ts`
- Create: `app/__tests__/web-backend-secret-settings.test.ts`
- Modify: `app/__tests__/web-chat-selection-persistence.test.ts`

- [ ] **Step 1: 写 set-only UI 和一次性迁移测试**

UI 每个密钥只显示 `Configured/Not configured`、updatedAt、Replace、Clear；输入框始终为空，保存成功立即清空组件 state。不得用 masked value 填回 input。

迁移规则：认证连接后先读后端 status；若本地旧值非空且服务端未配置，调用一次 set；set 成功或服务端本就 configured 后，删除 IndexedDB/global state 中的旧 key。失败时显示迁移失败并允许用户重试，但阶段 5 硬切换前必须完成或由用户重新输入，最终版本不保留旧值。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-backend-secret-settings.test.ts __tests__/web-chat-selection-persistence.test.ts
```

Expected: FAIL；当前设置把原文绑定到持久 state 和 input value。

- [ ] **Step 3: 实现状态 UI 和迁移器**

Migration 只识别三个已知旧字段：`deepseekApiKey`、`speechSettings.volcengineApiKey`、`ttsSettings.apiKey`。不要递归上传未知字段。清理时保留 speech/TTS 的非敏感 enabled/model/voice。

- [ ] **Step 4: 运行 Web 全量门并提交**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-backend-secret-settings.test.ts __tests__/web-chat-selection-persistence.test.ts
npm run tsc:web
npm run build:web
Set-Location ..
git add app/web/src/settings app/web/src/app/WorkspaceApp.tsx app/web/src/workspace/WorkspacePersistence.ts app/web/src/features app/__tests__
git commit -m "feat: migrate browser secrets to backend"
```

Expected: PASS；build 不含直接第三方密钥请求代码。

### Task 6: 执行后端密钥泄漏验收

- [ ] **Step 1: 运行 Go/Web 全量测试**

Run:

```powershell
Set-Location server
go test ./internal/shared ./internal/protocol ./internal/registry ./internal/hub ./internal/hub/tools
Set-Location ..\app
npm test -- --runInBand
npm run tsc:web
```

Expected: PASS。

- [ ] **Step 2: 运行结构化源码门**

Run:

```powershell
rg -n 'Authorization.*apiKey|volcengineApiKey|deepseekApiKey|apiKey: settings\.apiKey|payload: \{apiKey' app/web/src
rg -n 'json:"value"|SecretValueConfig' server/internal/protocol app/web/src/registry
```

Expected: 第一条只允许一次性 migration 读取旧字段及测试 fixture；第二条无输出。任何生产 Web 发送/返回原文路径都必须删除。

- [ ] **Step 3: 推送阶段提交**

Run:

```powershell
git status --short
git push origin HEAD
```

Expected: 工作树为空，阶段 4 已推送。
