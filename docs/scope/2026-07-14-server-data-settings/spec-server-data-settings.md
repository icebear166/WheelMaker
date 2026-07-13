# Server Data 配置与 Android 语音直连

> 由 scope skill 于 2026-07-14 生成

## 目标

将目前分散在浏览器持久化、`config.json` 和 Registry 包内的 Voice Input、Text-to-Speech、DeepSeek 配置收敛为一组服务端 `Server` 配置，并以 `~/.wheelmaker/db/server-data.json` 作为唯一持久化来源。客户端不再持久化这些配置；是否存在对应 Key 直接决定功能是否启用，不再保留独立 `enabled` 开关。

同时恢复 Android APK 直接连接火山语音的能力。Volcengine ASR Key 仍只在服务端长期保存，Android 每个应用进程从服务端读取一次并仅缓存在 Native 内存中。Web 与 Desktop 不读取任何 Key 明文，语音、TTS 和 DeepSeek 调用继续使用服务端能力。

本规格修订 `docs/scope/2026-07-13-system-security-baseline/spec-system-security-baseline.md` 中“Native Bridge 不得获得语音密钥原文”和“Android 语音必须由后端执行”的目标状态：只有经过认证、声明为 Android 的客户端可读取 Volcengine ASR Key，且这一限制采用简单客户端标识，不提供密码学设备证明。

## 决策

- Server 配置统一保存到 `~/.wheelmaker/db/server-data.json`，不再写入 `~/.wheelmaker/config.json`。
- 文件采用明文 JSON、当前系统账户私有权限和原子替换。Unix 权限为 `0600`；Windows 使用当前用户与 SYSTEM 的受保护 ACL。
- `server-data.json` 保存 DeepSeek API Key、Volcengine ASR Access Token、ASR Model、MiMo TTS API Key、TTS Model、TTS Voice，以及各配置项更新时间。
- 缺少对应 Key 即表示功能关闭；不在服务端或客户端保存 Voice Input/TTS `enabled` 字段。
- 新版不迁移 `config.json.secrets`、浏览器 Key、浏览器 Speech/TTS 配置或旧 Android Key。用户必须在 Server 设置中重新配置。
- 旧浏览器敏感数据可以被无条件删除，但不得读取后迁移。旧 Key 迁移、提取、重试 UI 和迁移测试全部删除。
- 非 Key 类旧版本兼容行为继续保留，但兼容代码集中到明确的 compatibility 模块，不散落在业务流程中。
- 所有已认证客户端都可读取非敏感 Server 配置：Model、Voice、是否已配置和更新时间。Web/Desktop 不能读取任何 Key 原文。
- Android 只可读取 Volcengine ASR Key，不可读取 DeepSeek 或 MiMo Key。
- Android 读取权限采用“有效设备 Session + Android 客户端标识”的简单门禁。客户端标识可以被持有有效登录 Cookie 的调用方伪造；该风险在当前单用户模型下接受，不引入 Keystore 设备配对、硬件证明或远程 attestation。
- Android 每个应用进程在服务端认证成功后同步一次 ASR Key，并缓存于 Native 内存，语音启动不重复读取。进程重启、服务器切换、Key 版本变化或火山鉴权失败时重新同步。
- Android 不把 ASR Key 写入 Web Storage、SharedPreferences、SQLite、文件、日志或诊断数据。登出、服务器切换和服务端清除 Key 时清空 Native 缓存。
- Web 与 Desktop 的 ASR 继续把 PCM 音频交给服务端；TTS 与 DeepSeek 继续由服务端使用相应 Key。Desktop 不新增第三方直连能力。
- Server Data 的存储和业务逻辑从 Registry 包移出。Registry 只保留认证、协议入口和路由职责，通过接口调用独立的 Server Data 与 Speech 服务。
- 不修改用户 Nginx 配置，不新增必须单独代理的公开路径；新增能力复用现有认证连接和 Registry 协议入口。

## 架构

```text
Settings UI ── authenticated protocol ──> Registry adapter
                                                │
                                                ▼
                                      Server Data service
                                                │
                              ~/.wheelmaker/db/server-data.json
                                  │             │             │
                                  ▼             ▼             ▼
                            Speech service   TTS service   DeepSeek flow
                                  │
                  ┌───────────────┴────────────────┐
                  │                                │
            Web / Desktop                    Android Native
          PCM through server          ASR Key once per process
                  │                                │
                  └──────> Volcengine <────────────┘
```

### Server Data 模块

独立 Server Data 模块拥有文件 schema、默认值、校验、并发控制、读取、字段更新、私有权限和原子写入。Registry 不解析或修改 `server-data.json`，只依赖窄接口完成：

- 读取非敏感配置快照；
- 设置、替换或清除单个 Key；
- 更新 ASR Model、TTS Model 或 TTS Voice；
- 为服务端业务读取对应 Key；
- 为通过 Android 门禁的请求读取 Volcengine ASR Key。

文件不存在时返回无 Key 的默认配置，ASR Model 使用当前唯一的 Doubao Streaming ASR 2.0，TTS Model/Voice 使用当前产品默认值。文件格式错误、权限错误或写入失败时不得覆盖原文件；相关设置操作和功能调用明确失败，普通聊天能力不因 Server Data 不可用而退出。

### Registry 与业务服务边界

Registry 负责验证设备 Session、解析协议请求、应用客户端角色门禁并把调用交给 Server Data 或相应业务服务。Server Data 文件不成为 Registry Session 状态的一部分，Registry 日志、调试 envelope 和诊断导出不得包含 Key。

Speech 服务拥有火山协议、Web/Desktop PCM 流和服务端凭据解析。Android 直连使用恢复后的 Native 火山客户端与协议实现，不为 Android 建立服务端 speech stream。TTS 服务和 DeepSeek 流程继续只在服务端解析 Key。

### Settings UI

新增 `Server` 分组，位置在 `Chat` 与 `Connection` 之间，顺序固定为：

1. Voice Input：Access Token、Model；
2. Text-to-Speech：API Key、Model、Voice；
3. DeepSeek：API Key。

Key 编辑器保持 set-only：未配置时显示 `Not configured` 与 Set，已配置时显示 `Configured`、更新时间、Replace 和 Clear，不回显现值。Model 与 Voice 由服务端快照驱动，修改后立即写回服务端。对应 Key 不存在时，功能入口不可用，但配置行始终可见。

## 流程

### Server 配置读取与更新

1. Workspace 完成设备 Session 认证并建立 Registry 连接。
2. 客户端读取非敏感 Server 配置快照，不读取 Key 原文。
3. 用户设置、替换或清除 Key，或修改 Model/Voice。
4. Registry 完成认证与输入校验后调用 Server Data 服务。
5. Server Data 服务在锁内生成完整新文档，以私有临时文件同步写入并原子替换目标文件。
6. 服务端返回更新后的非敏感快照；客户端据此更新功能可用状态。

### Android ASR Key 同步与直连

1. Android 加载远程 Workspace，并以设备 Session 建立已认证连接。
2. 页面确认存在 Android Native Bridge 后，以 Android 客户端标识请求 Volcengine ASR Key。
3. Registry 校验设备 Session 和 Android 标识，Server Data 服务只返回 Volcengine ASR Key 与版本信息。
4. Android WebView 中的受信任主页面立即把响应交给 Native Runtime，不写入 React 状态、Workspace Persistence 或浏览器存储；该值可能短暂存在于调用栈内。
5. Native Runtime 将 Key 缓存在当前应用进程内。用户开始语音时，APK 本地录音并直接使用该 Key 连接火山，识别事件返回 Workspace。
6. 后续语音会话复用 Native 缓存。服务端配置版本变化或火山返回鉴权失败时，只允许触发一次重新同步，避免无限重试。
7. 登出、服务器切换、Key 清除或应用进程结束后，缓存失效。

### Web/Desktop 语音与 TTS

1. 客户端从非敏感快照判断对应 Key 是否配置。
2. Web/Desktop Voice Input 将 PCM 通过现有 `speech.*` 协议发送给服务端 Speech 服务；客户端请求不包含 Key。
3. TTS 请求只发送文本、Model 与 Voice，服务端读取 MiMo Key 并调用上游。
4. DeepSeek 统计请求只发送统计范围，Key 始终留在服务端流程中。

## 验收标准

- `~/.wheelmaker/config.json` schema、示例、读写和运行时对象中不存在第三方 `secrets` 配置。
- Server 设置首次写入后只生成 `~/.wheelmaker/db/server-data.json`；Unix 权限为 `0600`，Windows ACL 只允许当前用户与 SYSTEM，更新使用原子替换。
- 不存在文件时系统以三项 Key 均未配置的默认状态运行；损坏或不可读文件不会被静默覆盖。
- 新版不会复制或恢复任何旧浏览器、旧 Android 或 `config.json` Key；旧 Key 迁移函数、失败重试 UI 和迁移协议路径全部删除。
- Workspace Persistence 不再读写 Speech/TTS Server 配置。导出、导入、IndexedDB、LocalStorage 和 Service Worker 数据中不出现三个 Key、ASR Model、TTS Model 或 TTS Voice。
- Settings 页面存在位于 Chat 和 Connection 之间的 Server 分组，字段顺序与本规格一致，不显示 Voice Input/TTS enable 开关。
- 清空 Volcengine、MiMo 或 DeepSeek Key 后，对应功能立即变为不可用；设置 Key 后无需单独开启开关。
- Web/Desktop 只能读取 Model、Voice、`configured` 与 `updatedAt`，任何协议响应均不返回三个 Key 明文。
- 非 Android 标识的客户端调用 ASR Key 读取方法会被拒绝；Android 标识且设备 Session 有效时只返回 Volcengine Key，不返回 DeepSeek 或 MiMo Key。
- Android 启动并认证后最多同步一次未变化的 ASR Key，多次开始语音不会重复读取；Key 更新、鉴权失败、服务器切换和进程重启能够重新同步。
- Android APK 恢复直接火山 WebSocket、协议编码和本地 transcript 事件，不再把 PCM 发送到 Registry；Web/Desktop 的 PCM 仍由服务端处理。
- Android Web Storage、应用私有文件、SharedPreferences、数据库、日志、诊断和备份中不存在 ASR Key。
- Server Data 与火山业务实现不位于 Registry 存储模块中；Registry 只通过接口完成认证后的适配和路由。
- 现有根路径和子路径 Nginx 配置无需增加 Location 或修改代理规则。
- 日志、Registry Debug、诊断上传和错误响应对 `apiKey`、`accessToken`、`secret` 等敏感字段递归脱敏。
- 现有非 Key 兼容行为保持可用，兼容入口集中；生产业务路径中不存在散落的旧 Key 判断或迁移分支。

### 测试

- Go 单元测试覆盖 Server Data 默认值、严格 schema、字段更新、并发写、原子替换、Unix 权限、Windows ACL 接入点、损坏文件和写入失败保留原文件。
- Go 协议测试覆盖非敏感快照、set/replace/clear、功能由 Key 派生、Android 读取门禁、只返回 Volcengine Key 及日志/错误脱敏。
- Speech/TTS/DeepSeek 测试验证服务端通过 Server Data 接口获取 Key，Web/Desktop 请求和响应不包含 Key。
- Web/Jest 测试覆盖 Server 分组位置与字段顺序、无 enable 开关、set-only 编辑器、功能可用状态、Model/Voice 服务端更新，以及 Workspace Persistence 不再保存这些字段。
- Android 单元测试覆盖每进程一次同步、Native 内存缓存、直接火山连接、Key 更新/清除/鉴权失败刷新、登出与服务器切换清理，以及非持久化约束。
- 源码门禁扫描旧 Key 迁移函数、客户端 `speechSettings`/`ttsSettings` 持久化、`config.json.secrets`、Android 本地 Key 写入和任何 Key 回显接口。
- 执行 Go 全量测试、Web Jest/类型检查/生产构建、Android 单元测试/lint，并在外部 Android 设备上验证一次真实火山直连；真实供应商验收不把 Key 写入自动化测试或仓库。

## 范围之外

- Android Keystore 持久化 ASR Key、硬件设备证明、设备配对或客户端 attestation。
- 防止持有有效设备 Cookie 的调用方伪造 Android 客户端标识。
- 抵抗已 Root/Hook/调试的 Android 在运行时截取进程内 Key。
- Web/Desktop 直连火山或在浏览器本地保存第三方 Key。
- 加密 `server-data.json`、接入 Windows DPAPI、macOS Keychain 或 Linux Secret Service。
- 迁移或兼容任何旧 Key 与旧客户端 Speech/TTS Server 配置；旧客户端必须升级并重新配置。
- 多用户权限、按设备授权不同 Key、第三方短期凭据交换或独立密钥管理服务。
- 自动修改用户 Nginx 配置。
