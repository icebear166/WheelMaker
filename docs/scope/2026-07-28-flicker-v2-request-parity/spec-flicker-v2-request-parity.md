> 由 scope skill 于 2026-07-28 生成

# Flicker V2 请求拟真与 Claude Code 能力保护

## 目标

WheelMaker Flicker Bridge V2 已复用 `@myflicker/cli@0.3.12` 的登录上下文、Wanqing provider 和 AI SDK 出口，但进入 provider 的 system prompt、tools 和消息历史仍来自 Claude Code。本文定义一层克制、稳定的兼容转换：在不削弱 Claude Code 工具能力、不替换其工具 schema、不扰动缓存块的前提下，让 Wanqing 可观察到的身份、已知工具名称和协议字段尽量接近原生 MyFlicker CLI。目标不是复制 MyFlicker agent pipeline，也不追求包含随机 ID、时间戳在内的逐字节相同。

## 决策

- V2 继续使用 MyFlicker CLI 的 `login → setContext → wanqingPlugin → createModel` 出口；认证、模型映射、AI SDK、Wanqing endpoint 和 `x-takumi-*` header 不另行模拟。
- Prompt 采用最小身份替换：
  - 只替换版本化 allowlist 中精确匹配的 Claude Code 身份句，目标身份使用当前原生 MyFlicker 的首句 `You are myflicker, the best coding agent on the planet.`。
  - 不再按空行拆分、trim、重组或模糊删除段落，不注入 MyFlicker 的完整 system prompt。
  - 未匹配到已知身份句时原样保留，不使用 `claude code`、`anthropic`、`you are` 等关键词做启发式删除。
  - system string 或 text block 的顺序、数量、其余文本和 `cache_control` 保持不变；没有 system 时不新增 system。
- Prompt 内的工具名只改写反引号包裹的完整工具标识符，或当前 Claude Code 版本 allowlist 中的完整固定短语，并且只使用本次请求中实际成功建立的工具映射；普通英文单词、子串、大小写近似项和未知名称不替换。
- Tools 采用能力优先的名称兼容：
  - 补全当前 MyFlicker bundle 已知的 Claude 工具别名映射。
  - 只修改 tool name，并在 `tool_choice`、assistant `tool_use`、user `tool_result` 和响应 tool call 中使用同一份请求级双向映射。
  - tool 的顺序、description、input schema、cache control 和工具 ID 保持不变。
  - 未知工具和 `mcp__*` 工具原样透传；不添加 Claude Code 没有执行器的 MyFlicker Cron、企业文档、GitLab 或内部服务工具。
  - 如果两个当前工具会映射到同一目标名，或目标名已被另一个当前工具占用，则所有冲突项保留原名；不得丢弃工具或建立有歧义的反向映射。
- 当前 MyFlicker 等价映射基线包括：
  - `Agent` / `Task` → `task`
  - `Bash` → `bash`
  - `Read` / `Edit` / `Write` / `Glob` / `Grep` / `LS` → 对应小写名称
  - `WebFetch` → `fetch`
  - `WebSearch` → `google_search`
  - `TodoWrite` → `todoWrite`
  - `BashOutput` / `TaskOutput` / `AgentOutputTool` / `BashOutputTool` → `task_output`
  - `KillShell` / `TaskStop` → `kill_task`
  - `AskUserQuestion` → `AskUserQuestion`
  - `Skill` → `skill`
  - `EnterPlanMode` → `EnterPlanMode`
  - `ExitPlanMode` → `ExitPlanMode`
- MyFlicker 原生兼容表中标记为不支持的 `NotebookEdit`、`LSP`、`REPL`、`Config` 不在 V2 中删除；如果 Claude Code 实际提供这些工具，V2 将其作为普通 function tool 原样发送，以保留 Claude Code 能力。
- 请求字段采用证据驱动映射：
  - 把链路区分为 Claude Code Anthropic JSON、AI SDK V3 `doStream` 参数、MyFlicker provider 最终 Wanqing JSON 三层。
  - 同一脱敏 fixture 对三层做 capture；每个观察到的顶层字段必须归类为“已映射”“由 provider 生成”或“有明确理由忽略”。
  - `output_config`、`metadata`、`service_tier`、`context_management` 等字段不能因为 Go 输入 struct 未声明就直接判定为缺失；只有 capture 证明最终语义丢失时才增加转换。
  - 禁止把未知字段整体塞入 `providerOptions`，也不重复生成 MyFlicker provider 已负责的 transport/header/model 字段。
- 响应转换保持克制：除请求级 tool name 的反向映射和 Anthropic 协议封装外，不改写 assistant text、reasoning、signature、usage 或 stop reason。
- 缓存稳定性优先于更强的表面拟真：
  - 身份句和工具名转换必须由固定顺序的数据结构驱动，同一输入产生同一输出。
  - 不重排 system blocks、tools 或 messages，不改变已有 cache marker 的归属。
  - 不把 session ID、prompt ID、时间戳、cwd 或动态 MyFlicker 配置注入静态 Prompt/tools。
  - Claude Code 或 MyFlicker 升级导致原始静态内容变化时允许自然形成新的缓存；V2 不尝试跨版本伪造旧缓存。
- 本项目只修改 V2；V1、Hub V1/V2 切换、模型目录和 `cc-flicker` endpoint 不变。
- Spec 批准后更新 `docs/wiki/protocols/acp.md`，记录 V2 的身份替换、工具映射、字段归类和缓存边界。

## 架构

```text
Claude Code
  │ Anthropic Messages JSON
  ▼
V2 compatibility conversion
  ├─ exact identity replacement
  ├─ request-scoped tool-name bijection
  ├─ semantic field mapping
  └─ preserve blocks/order/cache metadata
  ▼
AI SDK V3 doStream options
  ▼
@myflicker/cli wanqing provider
  ├─ native login context
  ├─ native model/API-format adapter
  └─ native endpoint and x-takumi-* headers
  ▼
Wanqing
```

请求级工具映射由一次转换生成，并同时供 Prompt 工具引用、tools、tool choice、历史 tool call/result 和响应反向转换使用。该映射不保存到全局状态，避免并发请求、不同 Claude Code 版本或不同 MCP 工具集合互相污染。

## 流程

1. V2 解码 Anthropic 请求，同时保留用于字段审计的顶层 key 集合。
2. 根据当前 tools 生成无冲突的请求级双向名称映射。
3. 对 system string/text blocks 做精确身份句和精确工具引用替换；其他内容与 block/cache 边界不变。
4. 按原顺序转换 messages 和 tools；所有 tool name 位置复用同一映射，description/schema 不变。
5. 把已确认的 Anthropic 字段转换为 AI SDK V3 参数；未确认字段不盲目注入 provider options。
6. 原生 MyFlicker provider 生成最终 Wanqing 请求。
7. 测试拦截最终 fetch，归一化随机 header 后与原生 MyFlicker reference capture 比较并记录预期差异分类；由于 V2 按决策保留 Claude Code Prompt 和 tool schema，不把请求体完全相等作为通过条件。运行时不记录 Prompt、tool schema、token 或完整请求体。
8. 响应返回时只反向恢复本请求实际映射过的工具名，再交给 Claude Code。

## 验收标准

- V2 发往 Wanqing 的 product、version、client、session/prompt ID 格式、AI SDK User-Agent、endpoint 和认证仍由 `@myflicker/cli@0.3.12` 原生 provider 产生。
- 已知 Claude Code 身份句被精确替换为确认的 MyFlicker 身份句；除已批准的身份句和工具引用外，system 文本不发生变化。
- 身份模板未知或不匹配时请求仍可发送，原始 system 内容保持不变，且不会误删包含 `Claude`、`Anthropic` 或 `you are` 的普通段落。
- system string/text blocks 的顺序和数量保持不变；每个输入 cache control 仍附着在对应转换后 block。
- 输入 N 个 tools 时输出仍为 N 个 tools；顺序、description、schema 和 cache control 深度相等，只有无冲突的已知名称允许变化。
- 当前 MyFlicker bundle 中的已知安全别名全部覆盖；未知、MCP 以及 MyFlicker 原生表中标记 unsupported 的 Claude 工具均不被 V2删除。
- 名称冲突不会产生重复 tool name、丢失工具或错误反向映射。
- tool choice、历史 tool use/result、流式与非流式响应统一使用请求级映射；assistant 文本和 reasoning 不做工具名单词替换。
- 两次相同输入的转换结果完全一致；归一化随机 ID、时间戳和签名 header 后，两次最终 Wanqing body 一致。
- 原生 reference 与 V2 capture 的每个顶层请求字段都有明确归类；未证明有语义损失的 `output_config` 等字段不做猜测性修补。
- Claude Code 文本、thinking、工具调用、工具结果、MCP 工具和多轮请求现有能力不回归。
- V2 runtime 日志、health、错误响应和 Hub state 不包含 Prompt、tool schema、MyFlicker token 或完整上游请求。

### 测试

- 扩展现有 V2 self-test，不调用真实 Wanqing：
  - 精确身份句命中、未命中、近似文本和多 block 输入；
  - system 文本差异只包含批准替换，block 顺序与 cache control 保持；
  - 完整工具映射、未知工具、MCP 工具、unsupported 原样保留；
  - `Agent + Task`、`TaskOutput + BashOutput` 和目标名预占用等冲突场景；
  - description/schema/tool 顺序深度不变；
  - tool choice、tool use、tool result 和响应反向映射闭环；
  - assistant text/reasoning 不被名称替换。
- 在 Node worker fetch interceptor 中捕获脱敏后的最终请求 body；同一 fixture 连续运行两次，证明确定性与 cache block 稳定。
- 使用 `@myflicker/cli@0.3.12` 原生 quiet 模式生成 reference capture，拦截 gateway 并返回固定 SSE；不得把 fixture 真正发送到 Wanqing。
- 对 Anthropic、OpenAI Chat Completions 和 Responses 三种 Wanqing model format 各选择一个当前可用模型，比较 URL、header 名称、body key、模型转换和工具字段；随机值归一化。
- 字段审计覆盖当前支持 Claude Code 版本实际发送的顶层字段，并锁定三类归属；新增未分类字段时测试输出字段名并失败，但不得输出字段值。
- 重跑现有 V2 settings、models、worker transport、request/response conversion、HTTP 和 live-format 测试。
- 使用隔离配置的 Claude Code/ACP smoke test 完成一轮文本请求、一轮内置工具请求和一轮 MCP 工具请求；不启动、停止或替换常驻 WheelMaker 任务。

## 范围之外

- 不复制 MyFlicker 的完整 16 KB system prompt、rules、memory、task planner 或 agent pipeline。
- 不添加 Claude Code 没有本地执行器的 MyFlicker Cron、企业文档、GitLab、团队任务或内部服务工具。
- 不要求原生 MyFlicker 与 V2 产生相同的模型回答、工具选择、随机 ID、时间戳或逐字节相同请求。
- 不为了拟真删除 Claude Code 工具、改变其 schema，或修改 MCP server 配置。
- 不在本项目中增加新的 image/document/audio/video 内容转换能力；只保证现有文本、thinking 和工具链路不回归。
- 不修改 V1、本地 bridge 鉴权、Hub mode 持久化、模型排序、Web UI 或 Registry protocol version。
