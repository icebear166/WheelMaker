> 由 scope skill 于 2026-08-19 生成
> 状态：已批准 2026-08-20

# 阿里云百炼 Token Plan 个人版用量统计

## 目标

在 WheelMaker 现有 Limits Monitor 中接入阿里云百炼 Token Plan 个人版的官方 Credits 用量统计。统计来源必须是百炼官方 Console 能力，不使用本地 Token/Credits 估算，也不把普通 Qwen API 调用量当作套餐用量。

## 决策基线

### 需求边界

- 内部 Provider ID 复用 `qwen`，展示名称为 `Qwen`，副标签注明“阿里云百炼 Token Plan”。
- 只有 Hub 已配置 Token Plan 专属 Qwen API Key（`sk-sp-` 前缀）时，才显示 Qwen 占位行；普通 `sk-` API Key 不触发该行。
- Qwen 占位行属于现有 Limits Monitor 的 Provider 列表。点击占位行进入详情并发起百炼登录；登录成功后由占位内容替换为当前快照数据。
- 首版登录只支持桌面/Android 原生登录窗口。普通浏览器端不实现百炼 OAuth 回调，需提示用户在原生客户端完成登录。
- 统计展示以官方 Credits 当前快照为核心：5 小时窗口、7 天窗口、用量包和订阅状态。个人版官方额度与窗口口径以百炼返回值为准。[Token Plan 个人版 FAQ](https://help.aliyun.com/zh/model-studio/token-plan-personal-faq)
- 详情展示最近 7 天的本地用量历史趋势，沿用 Limits Monitor 现有 `usage-history.json` / `usage.history.get` 路径；Qwen 只记录成功快照中的剩余比例，不把本地历史推算为 Credits 消耗，也不依赖百炼官方趋势接口。
- 模型维度仅在官方响应字段稳定、可可靠归一化时作为详情补充，不作为核心功能或首版阻塞项。
- 每个 Hub 独立保存 OAuth 凭据并独立查询；Web 端仿照 DeepSeek 将同一 `bailian-token-plan` 账号聚合为一个 Qwen Provider/账号展示，不为每个 Hub 单独渲染行。聚合只改变展示，不合并或相加不同 Hub 的 Credits；聚合账号保留全部 `hubIds/sources`，并以固定主来源 Hub 执行登录、退出和凭据写入。

### 认证与凭据决策

- 放弃 RAM AccessKey/Secret 和 Token Plan RAM 只读策略，不新增 AccessKey 配置字段。
- 使用百炼 Console OAuth。官方百炼 CLI 将用量查询归入 Console OAuth 能力；本项目不依赖 CLI 进程或其本地配置文件。[官方 CLI 认证说明](https://github.com/modelstudioai/cli/blob/main/README.md#authentication)
- OAuth 凭据只由 Hub 保存，按实际返回内容保存 access token、refresh token、过期时间或等价的会话字段；凭据不进入 Registry/Web 状态、HubState、日志、错误详情或历史文件。
- Hub 支持自动续期。续期失败后保留登录失败状态并要求重新登录；退出登录只清除主来源 Hub 的 OAuth 凭据，不清除 Qwen API Key，也不把凭据迁移为全局用户凭据。
- 登录成功但用量查询失败时保留 Provider 行，显示“已登录，统计暂不可用”，详情提供错误和重试入口，不显示估算值。

### 刷新与显示决策

- 当前快照在 Hub 启动时查询，此后每 10 分钟自动刷新，并支持现有 Monitor 手动刷新。
- 当前快照查询临时失败时沿用现有 Limits 服务的最近一次成功数据，并显式标记过期；失败采样不得写入本地历史。配置从 `sk-sp-` 变为普通 `sk-` 或被清除时，Qwen 配置状态是权威 tombstone，旧 Provider 必须移除而不是由 merge 逻辑保留。
- 本地 7 天趋势只在打开详情或用户手动刷新详情时读取，并复用现有历史查询和缓存状态；全局 10 分钟快照不携带趋势大对象。
- Provider 紧凑行显示 5 小时/7 天中剩余比例更低的窗口，并标记窗口名称；详情展示两个窗口的完整额度和重置时间。
- 未登录但 Qwen API Key 仍存在时继续显示占位行；退出登录或 Token 失效不会清除该 API Key。

## 设计视图

### 功能流程

1. 每个 Hub 读取现有 Qwen API Key，只有检测到非空且以 `sk-sp-` 开头的 Key 时，向 HubState 暴露该 Hub 的 Qwen 占位 Provider；普通 `sk-` 或 clear 会产生显式移除结果。
2. Web UsageStore 将在线 Hub 的同一 Qwen Token Plan 账号聚合成一个展示账号，保留全部来源和状态；用户在 Limits Monitor 点击这一个 Qwen 行打开详情。若主来源 Hub 没有有效 OAuth 凭据，详情显示登录操作。
3. 桌面/Android 原生运行时打开百炼 Console 登录窗口。登录完成后，凭据通过 Hub-scoped 的受保护写入路径保存到聚合账号的主来源 Hub；不得把凭据放入常规状态广播或全局用户配置。
4. 各 Hub 使用各自 OAuth 凭据请求当前 Credits 快照；聚合视图选择最新有效快照用于展示，绝不把不同 Hub 的个人订阅 Credits 相加。占位内容在可用快照出现后替换为额度数据。
5. 详情打开或手动刷新时，前端向聚合账号的全部在线 sources 查询本地历史，沿用现有候选选择规则，不跨 Hub 拼接采样序列。
6. OAuth 失效、统计接口失败或趋势不可用时，按照“登录状态”和“统计状态”分别展示，避免把登录成功误报成统计成功。

### Hub 端

- 在 `server/internal/hubconfig` 增加独立的 Bailian OAuth secret section，沿用现有 Hub secret 持久化和原子更新模式；不得复用 `apiKeys.qwen` 存放 OAuth 凭据。
- 在 `server/internal/hub/usage` 增加 Qwen/Bailian Provider scanner 或等价的 Hub-owned provider service。扫描器负责当前快照，并把成功快照交给现有本地历史记录流程。
- Qwen 快照增加独立的 Credits 数据结构，不把无限额度伪装成百分比：每个窗口包含 `state`（`limited` / `unlimited` / `unavailable`）、Credits 绝对值字符串（`total` / `used` / `remaining`）、仅对 `limited` 窗口提供的 `remainingPercent`、重置时间和窗口 ID。订阅状态、用量包和数据更新时间同样属于该结构；未知字段不得填充为推测值。
- 只有 `limited` 窗口参与紧凑行的“最受限窗口”选择；当前 5 小时窗口为 `unlimited` 时不参与比较，7 天窗口作为摘要。绝对 Credits、无限状态和用量包在 Qwen 详情模型中保留，不依赖通用百分比 `Limit` 表达。
- Qwen Provider 的 `LocalID` 在 Hub 内保持稳定；每个 Hub 只产生一个官方 Token Plan 账号。HubState/Registry 仍保持 Hub scope，Web UsageStore 仅将相同 `bailian-token-plan` 的来源聚合成一个展示账号，不合并额度数值。
- 快照扫描与现有 `usage.Service` 的启动扫描、10 分钟周期、singleflight、最近成功值合并和错误状态保持一致。
- Qwen 趋势复用现有 `usage-history.json` 的百分比序列和 `usage.history.get` 查询，不新增官方趋势接口，也不把本地剩余比例冒充 Credits 消耗趋势。

### 协议与安全

- 当前快照继续通过现有 `hub.state.get` / `hub.state.refresh` 和 `tokenStats` section 传播，Registry 只做权限校验和转发；Qwen 的账号身份和 OAuth 凭据必须保持 Hub scope，不能在 HubState/Registry 层做全局合并。跨 Hub 聚合只存在于 Web 展示模型，并保留每个来源引用。
- 不增加 Qwen 专用趋势协议；目标 Hub 继续通过既有 `usage.history.get` 提供本地历史数据，不升级协议版本。
- OAuth 保存/清除使用 Qwen 专用的结构化更新方法 `qwen.oauth.update`，动作只接受 `set`、`clear` 或与实际 OAuth 生命周期等价的有限操作；禁止把完整凭据包放入通用 `hub.config.update.value`，Registry 不持有凭据状态。
- `qwen.oauth.update` 的 debug 脱敏按 method 整体处理 Secret payload；access token、refresh token、Cookie 和嵌套凭据不能以原文出现在 inbound/outbound diagnostics 中。
- 所有返回 Web 的配置快照只包含 `configured`、`updatedAt`、登录状态、过期状态和错误摘要，不包含 token、cookie、Authorization header 或原始响应。
- 所有外部响应必须使用大小上限、超时、状态码检查和严格归一化；错误日志只能包含安全的状态/错误码，不包含响应正文中的凭据或 Cookie。

### 前端

- 扩展 `app/web/src/usage` 的 Provider 类型、排序、解析和状态逻辑，使 `qwen` 的 `hidden → placeholder → ready → stale/error → placeholder/hidden` 状态迁移可表达；Qwen 的配置移除必须删除旧来源，不能显示为旧成功数据。
- 在现有 Limits Monitor 的紧凑行和详情路径中增加 Qwen 的跨 Hub 聚合账号；主列表只显示一个 Qwen 行，紧凑行按有限窗口中更低剩余比例摘要，详情显示双窗口、订阅/用量包、本地历史趋势和来源 Hub。展示数据使用最新有效来源，不相加 Credits。
- 详情登录按钮仅在原生桥接可用时启用；浏览器端显示“请在原生客户端完成百炼登录”，不伪造浏览器 OAuth 能力。
- 历史请求在详情打开/手动刷新时触发，显示加载、成功、缓存时间和不可用状态；不得在普通 `hub.state.updated` 中携带趋势大对象。
- Qwen 沿用 DeepSeek 的展示聚合：一个账号行保留来源 Hub pills；登录、退出和凭据写入固定作用于主来源 Hub，刷新遍历在线 Hub，趋势查询遍历 sources 后按现有规则选择候选，不把多个个人订阅合计为一个 Credits 总额。

### 原生登录桥接

- 桌面和 Android 原生运行时增加 Qwen/Bailian 登录能力：打开受控登录窗口、等待登录完成、返回受保护的登录结果、处理用户关闭和超时。PC 端复用 DeepSeek 的独立线程、owned popup、完成/关闭事件、超时和安全销毁生命周期；Android 端复用 DeepSeek 的全屏 in-app 页面、宽视口、加载错误、重试和关闭处理。Qwen 仍使用官方回调/字段解析，不假设百炼使用 DeepSeek 的 localStorage 或 Token 形状。
- 登录窗口必须限制导航/脚本能力到百炼 Console 信任范围，并清理窗口生命周期；不得把浏览器 Cookie 写入普通 Web storage 或工作区文件。
- 登录成功后的凭据写入应直接关联聚合账号的主来源 Hub；多个 Hub 同时存在时不得把凭据写到全局用户配置，也不得自动复制到其他 Hub。

## 外部接口验证门槛

本轮没有真实百炼账号、OAuth 返回值或个人版统计响应可供验证。实现第一步必须是受控的真实登录/查询探测：

1. Desktop 与 Android 分别完成一次端到端原生登录探测，记录可用的 redirect/origin allowlist、嵌入式 WebView 支持边界和登录完成信号。
2. 验证 OAuth Client、scope、凭据交换、expiry、refresh/rotation 语义，以及 Hub 是否能在后台安全续期；任一宿主不支持时，按首版双端要求报告阻塞。
3. 验证个人版 OAuth 身份能否取得当前订阅、5 小时/7 天快照，并验证 `limited/unlimited/unavailable`、绝对 Credits、用量包和订阅字段；本地趋势沿用现有历史链路，不需要官方趋势接口。
4. 记录脱敏后的字段形状、状态码和错误分类，不记录 API Key、OAuth token、Cookie 或完整响应正文；同时用完整 Secret payload 验证专用 OAuth 方法的 debug 脱敏。
5. 若正式探测不能证明当前快照能力或响应 Schema 无法稳定归一化，则该功能在本契约下报告阻塞；不得静默改用 RAM、CLI 本地凭据、普通 API Key 或 Credits 估算。正式能力已证明后的运行时临时失败不阻塞交付，只显示对应不可用状态。

## 实现顺序

1. 完成 Desktop/Android OAuth、统计接口和脱敏探测，记录响应契约；正式探测失败即停止后续生产代码实现。
2. 增加 Hub OAuth secret 存储、刷新、清除和安全状态快照。
3. 增加原生登录桥接及 Hub-scoped 登录写入路径。
4. 增加 Qwen 当前快照 Provider，并接入现有 10 分钟 Limits 生命周期。
5. 扩展协议类型、Web usage store、Monitor Provider 聚合行和详情 UI，并复用本地历史趋势。
6. 运行聚焦验证、双端类型/构建检查和安全输出审查；不以编译通过替代真实登录/接口验证。

## 验收

- 配置普通 `sk-` Qwen API Key 时不显示 Qwen Provider；配置 `sk-sp-` 时显示占位行。
- 点击占位行能在支持的桌面/Android 原生运行时打开百炼登录；浏览器端不会误显示可用 OAuth 按钮。
- OAuth 成功后，多个配置 Hub 只显示一个聚合 Qwen 行；该行展示最新有效来源的官方 5 小时/7 天 Credits 数据，窗口正确表达 `limited/unlimited/unavailable`，紧凑行只在有限窗口中选择更低剩余比例，详情展示两个窗口绝对 Credits 和来源 Hub，绝不相加不同 Hub 的 Credits。
- Hub 启动和每 10 分钟刷新当前快照；手动刷新有效；临时失败保留旧值并标记过期；Qwen Key 变为普通 `sk-` 或 clear 时旧行被移除。
- 详情打开/手动刷新读取本地最近 7 天趋势；历史为空或查询失败显示不可用，不生成 Credits 消耗估算曲线，也不调用官方趋势接口。
- OAuth 自动续期成功无需重新登录；续期失败、退出登录和统计接口失败均有明确状态，且退出不清除 Qwen API Key。
- 多 Hub 的 OAuth、快照、趋势和错误在存储及查询层彼此隔离；Web 主列表只显示一个 Qwen 聚合行，主来源操作目标稳定，sources 可追溯，且不错误合计个人订阅 Credits。
- Registry/Web 状态、日志、错误和历史文件中不存在 OAuth token、Cookie、API Key 或 Authorization header；专用 OAuth 方法的 debug 脱敏测试覆盖嵌套 Secret payload。
- 真实 Desktop 与 Android 个人版账号完成一次登录和当前快照查询验证；验证结果包含 OAuth 生命周期、当前快照、无限窗口和脱敏字段证据。本地趋势由现有历史链路验证。

## 非目标

- 不接入 RAM AccessKey/Secret、`AliyunTokenPlanReadOnlyAccess` 或 BSS 权限。
- 不调用百炼 CLI，不读取 `~/.bailian/config.json`，不依赖 Node CLI 进程。
- 不支持普通浏览器端百炼 OAuth 回调。
- 不使用普通 `sk-` API Key 作为 Token Plan 统计凭据。
- 不提供本地 Token/Credits 估算、请求级调用账单或把本地百分比历史换算为 Credits 消耗。
- 不把 Qwen OAuth 迁移为全局工作区凭据，不向其他 Hub 自动复制或同步登录结果。
- 不修改 Token Plan API Key、本地 Agent 的 Qwen 模型调用配置或其他 Provider 行为。

## 预期改动面

- `server/internal/hubconfig`：OAuth secret section、状态读取、更新/清除和续期。
- `server/internal/hub/usage`、`server/internal/hub/reporter.go`：Qwen Provider、快照生命周期、本地历史记录和 Hub-scoped OAuth 更新。
- `server/internal/protocol`：Hub-scoped OAuth 更新/状态契约，复用既有本地历史方法，不升级协议版本。
- `server/cmd/wheelmaker-desktop` 与 Android native bridge：受控百炼登录窗口。
- `app/web/src/usage`、Monitor/Workspace wiring：Provider 聚合状态、单行占位/额度展示、详情、趋势和错误展示。
- 对应 Go/Jest/类型检查测试及脱敏的接口 fixture；不写入真实凭据。

本次需求修订已按 A 更新，等待用户审核；审核通过后进入实现阶段。不更新 `docs/wiki`，真实百炼账号登录、OAuth 续期和当前快照仍遵守上述外部接口验证门槛；Qwen 趋势不再依赖官方趋势能力。
