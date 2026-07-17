# Agent Usage Panel

> 由 scope skill 于 2026-07-17 生成

## 目标

当前项目的 token 用量统计功能藏在设置详情页深处（`TokenStatsSettingsDetail.tsx`），入口深、纯文本展示、只覆盖 Codex/Copilot/DeepSeek 三家且 Codex 走不稳定的内部 REST。本次改造把它提升为一级常驻功能：在设置按钮旁加独立按钮 + chat 左下角常驻紧凑列表，两种入口打开同一面板；UI 改用进度条 + 紧凑度颜色；数据源替换为 Codex/Kimi/ZAI/DeepSeek 四家（移除 Copilot）；Codex 查询改用 `codex app-server` JSON-RPC；Kimi/ZAI/DeepSeek 的 key 统一从 opencode auth.json 读，删除前端独立的 DeepSeek key 配置入口。

## 决策

### 数据源

- **保留并改造**：Codex、DeepSeek
- **新增**：Kimi（`kimi-for-coding`）、ZAI（`zai-coding-plan`）
- **移除**：Copilot（彻底删除 `scanCopilotProvider` 及依赖代码）
- 四家的 key 来源：
  - Codex：`~/.codex/auth.json`（codex 独立 CLI，不经过 opencode）
  - Kimi / ZAI / DeepSeek：`~/.local/share/opencode/auth.json`，分别读 `kimi-for-coding.key` / `zai-coding-plan.key` / `deepseek.key`
- **删除** DeepSeek 原有多源凭据发现（env `DEEPSEEK_API_KEY*`、`~/.config/deepseek-cli/`、`~/.wheelmaker/deepseek-*`）——改为只从 opencode auth.json 读
- **删除**前端 DeepSeek key 配置入口（`SettingsRootContent.tsx` 的 `ServerSecretEditor section="deepSeek"` + `serverSettings.ts` 的 `deepSeek` 字段 + `browserCredentialCleanup.ts` 的 `deepseekApiKey`）。该配置在 server 端 Go 代码零引用，是孤立未消费状态，删除安全

### 各 provider 的查询接口

| Provider | 接口 | 取值字段 |
|---|---|---|
| Codex | hub spawn `codex app-server --listen stdio://`（短连接：init → `account/rateLimits/read` → kill），不常驻进程 | `rateLimits.primary` + `rateLimits.secondary`（按 `windowDurationMins` 识别 5h=300 / 周=10080）|
| Kimi | `GET api.kimi.com/coding/v1/usages`，Bearer key | `limits[0].detail`（5h：limit/used/remaining）+ `usage`（周：limit/remaining）|
| ZAI | `GET api.z.ai/api/monitor/usage/quota/limit`，Bearer key | `limits` 数组：`TOKENS_LIMIT unit=3`（5h%）+ `TOKENS_LIMIT unit=6`（周%）+ `TIME_LIMIT unit=5`（MCP 月度 used/remaining/total）|
| DeepSeek | `GET api.deepseek.com/user/balance`，Bearer key | `balance_infos[]`（currency/total_balance/granted_balance/topped_up_balance）+ `is_available` |

- Codex **不再调** `chatgpt.com/backend-api/wham/usage`（原 REST 端点，易被 Cloudflare 拦 401/403）
- Kimi 的 `totalQuota`（含义不明）和 `parallel`（并发限制，非用量）**丢弃**
- Codex 的 `rateLimitsByLimitId` 子模型限制（`codex_bengalfox` = GPT-5.3-Codex-Spark 等）**丢弃**
- Codex 的 `account/usage/read`（lifetime/daily 历史）**不调用**，只调 `account/rateLimits/read`
- DeepSeek 官方只有 balance 接口（无 usage 历史查询），非官方的 `/user/usage` 端点**不接入**

### 查询优化（hub 侧）

- 凭据发现后，按 `sha256(apiKey)` 在**本 hub 内**去重（多个 profile 指向同 key → 只查一次）
- 去重后的目标**并行查询**（goroutine per account）
- **查到一个流式上报一个**，不等全部完成
- 复用现有 `PublishTerminalEvent` 的 sink 模式（reporter.go:801），新增 `tokenStats.update` event method，hub → server WS → web WS，链路已验证可用（terminal 实时输出走的就是这条）
- **跨 hub 容忍重复查询**：多个 hub 各自独立扫描，重复 API 调用成本可接受；web 侧按 `provider + 账号身份` 合并显示
- **key 保护**：全链路（hub → server → web）不带明文 key；hub 内用 `sha256(key)` 去重；对外只发账号身份字段（email / codex account_id / kimi userId / zai customerNumber），优先级 email > account_id > userId > customerNumber；脱敏 mask 仅用于显示

### UI（同一面板两种呈现）

- **入口甲**：chat session header 设置按钮**右侧新按钮**，click → 直接展开完整卡片列表
- **入口乙**：chat 界面**左下角常驻紧凑列表**，**仅 PC + chat 界面**渲染（移动端 / 非 chat 界面隐藏）。click → 展开同一完整卡片
- 紧凑列表形态（每家一行）：
  ```
  Codex     5h 77%   周 50%
  Kimi      5h 98%   周 100%
  ZAI       5h 28%   周 50%   MCP 98%
  DeepSeek  CNY 110 · USD 4.23
  ```
  - codex/kimi/zai：各窗口剩余 %，紧张度颜色（剩余 <10% 红 / 10–30% 黄 / 其余默认色）
  - deepseek：余额数字（多币种用 `·` 连接），`is_available=false` 整行红，否则默认色（余额无百分比，不参与紧张度梯度）
  - 失败家：行内显示 `—`（破折号 + 灰色），hover tooltip 显示原因（"未登录" / "token 失效" / "网络错误"）
- 完整卡片：每家一张，每个 limit 窗口一个进度条（复用 `/status` 弹窗的 `app-session-status-limits` 样式）+ reset 时间 + 账号身份；deepseek 卡片显示余额详情（granted/topped_up/total per currency）；失败家红色边框 + 错误详情

### 数据模型

```
Limit { id: string, label: string, usedPercent: number, resetsAt?: number }
Balance { isAvailable: boolean, items: Array<{currency, total, granted, toppedUp}> }
Account {
  provider: string, identity: {email?, accountId?, userId?, customerNumber?},
  status: "ok" | "error", message?: string,
  limits: Limit[],            // codex/kimi/zai 填，deepseek 空
  balance?: Balance,          // deepseek 填，其它空
}
```

### 刷新

- 进入 chat 界面自动刷一次
- 每 5 分钟自动刷
- 手动刷新按钮
- Codex 每次 spawn 短连接（不常驻 app-server 进程）

### 删除项

- `TokenStatsSettingsDetail.tsx`（旧设置详情页入口）
- `scanCopilotProvider` + 依赖（copilot profile 发现、GitHub token 发现、Credential Manager 读取、premium usage 查询）
- DeepSeek 多源凭据发现（env + 文件），改为 opencode auth.json 单一来源
- 前端 DeepSeek key 配置（`ServerSecretEditor section="deepSeek"` + `serverSettings.deepSeek`）
- Codex 的 `wham/usage` REST 调用

## 架构

```
hub 进程 (server/internal/hub/tools/token_stats.go)
  ├─ 凭据发现
  │   ├─ codex: ~/.codex/auth.json + ~/.codex/codex-cc.json
  │   └─ opencode: ~/.local/share/opencode/auth.json → kimi-for-coding / zai-coding-plan / deepseek
  ├─ sha256(key) 本 hub 内去重
  ├─ 并行查询（goroutine per account）
  │   ├─ codex: spawn `codex app-server --listen stdio://` → init → account/rateLimits/read → kill
  │   ├─ kimi: HTTP GET api.kimi.com/coding/v1/usages
  │   ├─ zai:   HTTP GET api.z.ai/api/monitor/usage/quota/limit
  │   └─ deepseek: HTTP GET api.deepseek.com/user/balance
  └─ 每完成一个 account → PublishTokenStatsEvent("tokenStats.update", {provider, account})
       ↓ WS（复用 terminal event sink 模式）
server（转发 tokenStats.update event 给订阅的 web 客户端）
       ↓ WS
web (RegistryClient onmessage → 按 method 分发)
  ├─ 增量合并：跨 hub 按 provider + 账号身份去重
  └─ 渲染：左下角紧凑列表（chat 界面 + PC）/ 完整卡片面板（设置按钮 + 紧凑列表 click）
```

hub → server WS 推送已具备（`reporter.go:801` `PublishTerminalEvent` sink 模式）；server → web WS 推送已具备（`RegistryClient.ts:49` WebSocket + `:246` onmessage，terminal 实时输出已验证）。本次新增一条 `tokenStats.update` event method + 对应转发规则，**不新建传输层**。

## 流程

1. 用户进入 chat 界面（PC）→ web 发起 tokenStats refresh 请求
2. server → hub（`cmd.token` action=scan）
3. hub 发现凭据（codex auth.json + opencode auth.json）→ `sha256(key)` 本 hub 去重 → 并行查 4 家
4. 每完成一个 account → hub 通过 `tokenStats.update` event 推增量 → server 转发 → web 增量渲染（卡片一个一个冒出来）
5. 全部完成 → web 持有完整数据；之后每 5 分钟自动重复 2–4
6. 跨 hub：多 hub 各自独立走 2–4，web 按 `provider + 账号身份` 合并，同账号只显示一次

## 验收标准

- 4 家数据源（Codex/Kimi/ZAI/DeepSeek）都能查询并显示
- Codex 通过 `codex app-server` JSON-RPC 查询（不再调 `wham/usage`）
- Kimi/ZAI/DeepSeek 的 key 从 opencode auth.json 读取
- 左下角紧凑列表仅在 **PC + chat 界面**显示，移动端 / 非 chat 界面隐藏
- 紧凑列表每家一行：codex/kimi/zai 显示各窗口剩余 % + 紧凑度颜色，deepseek 显示余额数字
- 紧凑度颜色规则：剩余 <10% 红 / 10–30% 黄 / 其余默认；deepseek `is_available=false` 整行红
- click 紧凑列表 → 展开完整卡片（每窗口进度条 + reset 时间 + 账号身份）
- 设置按钮右侧新按钮 → 展开同一完整卡片
- **流式上报**：hub 查到一个 account 就推一个，web 卡片增量出现（不等全部完成）
- 跨 hub 同账号只显示一次（按 `provider + 账号身份` 合并）
- **key 保护**：上报给 server/web 的数据结构里不含明文 key（验证：抓包/日志检查）
- hub 内去重：同 key 多 profile 只查一次 API
- 错误态：失败家行显示 `—` + hover 显示原因；完整卡片红色边框 + 详情
- 旧 `TokenStatsSettingsDetail.tsx` 入口从设置详情页移除
- 前端 DeepSeek key 配置（`ServerSecretEditor section="deepSeek"`）移除，`serverSettings.deepSeek` 字段移除
- Copilot 相关代码彻底删除（scanner + 凭据发现 + UI 渲染分支）
- 刷新：进入 chat 自动刷 + 每 5 分钟自动刷 + 手动按钮可用
- Codex app-server 每次 spawn 短连接（不常驻进程，查完 kill）

### 测试

- **hub token_stats.go 单测**：4 家 scanner 各自 mock（codex mock app-server stdio，其余 mock HTTP），验证字段映射正确（特别是 ZAI 的 unit=3/6/5 对应 5h/周/MCP，Kimi 的 usage vs limits[0].detail，Codex 的 primary/secondary 按 windowDurationMins 识别）
- **去重单测**：构造同 sha256(key) 的多 profile，验证只查一次
- **流式上报单测**：mock 并行查询，验证每完成一个发一次 `tokenStats.update` event
- **web 合并单测**：构造多 hub 同账号的上报数据，验证按 `provider + 账号身份` 去重
- **key 保护验证**：上报数据结构序列化后 grep 明文 key，必须为零
- **UI 渲染测试**：紧凑列表（4 家 + 错误态 + 紧凑度颜色）、完整卡片（进度条 + reset 时间）、PC/chat 界面条件渲染
- **不测**：codex app-server 协议本身（用 schema 生成器验证）、opencode auth.json 解析（标准 JSON）

## 范围之外

- Codex 的 `account/usage/read`（lifetimeTokens / dailyBuckets 历史消耗）不接入
- 中心化跨 hub 调度（避免重复查询）不做，容忍重复
- DeepSeek usage 历史查询（非官方 `/user/usage` 端点）不接入
- 移动端显示左下角小窗
- 非 chat 界面显示紧凑列表
- Copilot 重新接入
