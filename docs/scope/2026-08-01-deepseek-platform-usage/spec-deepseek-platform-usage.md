> 由 scope skill 于 2026-08-01 生成

# DeepSeek 平台用量监控

## 目标

Monitor 中 DeepSeek 目前只显示 API key 余额（剩余金额）。本次为 DeepSeek 增加“平台用量”弹窗：点击 DeepSeek 账号行后，弹窗展示本月花费、今日花费、余额，以及当前月每日 token 用量曲线；曲线每个节点显示总量、命中率、花费。数据来自 DeepSeek 开放平台的私有用量接口，需要用户登录平台账号获得 session token；登录受 hCaptcha/Turnstile/数美设备指纹风控，只能在真实浏览器环境完成，因此 Desktop/Android 在弹窗内提供内嵌官方登录页并自动抓取 token 的流程，浏览器端提供手动粘贴兜底。tokenStats 保持简短，曲线等重数据在弹窗打开时按需拉取并缓存。

## 决策

- 数据源为平台私有接口（Bearer token 认证，API key 无效）：`GET /api/v0/users/get_user_summary`、`GET /api/v0/usage/amount?year=&month=`、`GET /api/v0/usage/cost?year=&month=`。命中率 = `promptHit ÷ (promptHit + promptMiss)`，无输入 token 时按 0 处理。平台数据约有 5 分钟延迟。
- Hub 不实现平台登录协议。登录只能在真实浏览器环境完成；Desktop 用 WebView2、Android 用 WebView Dialog 打开官方登录页，登录成功后通过页面 JS 读取 token，经现有 Hub 配置更新接口写入；浏览器端由用户在弹窗内打开官方登录页并粘贴 token。
- 保持 tokenStats 简短：DeepSeek 账号仍只发布余额与连接状态，不发布每日序列；每月/今日花费与每日曲线通过新增只读 Registry 方法按需获取。
- Hub 按 `(year, month)` 缓存平台响应：当前月 TTL 5 分钟，历史月 TTL 24 小时；弹窗“刷新”强制重拉；平台请求失败或 token 失效时保留最后一次成功缓存。
- 一个 Hub 保存一个平台 session token；DeepSeek 配置多个 API key 账号时，平台数据挂在第一个账号并标注“平台用量”。
- 新增 additive Registry 只读方法 `deepseek.usage.get`（请求 `{year?, month?}`，走 Hub 路由），不修改 protocol version。
- 余额优先用平台钱包余额（与花费同账号口径）；无会话、会话过期或平台余额不可用时回退现有 API key 余额（`/user/balance`）。
- 会话状态通过 HubConfig 快照暴露（configured/updatedAt 标记，不回显 token）；token 失效（平台返回 40003）由 `deepseek.usage.get` 返回 `expired`。

## 架构

```text
Hub
  hubconfig        新增 secret: deepSeekPlatformToken（set/clear，仅暴露 configured/updatedAt）
  usage            新增 deepseek_platform.go：平台客户端（summary/amount/cost）+ (year, month) 缓存
  usage.provider   现有 DeepSeek 余额扫描保持不变（API key）
  reporter         deepseek.usage.get handler：校验参数 → 查缓存 → 请求平台 → 解析/缓存 → 返回
Registry          additive 方法注册与 Hub 转发

Web
  registryMethods/registryTypes/RegistryRepository/RegistryWorkspaceService  方法常量、DTO、请求
  DeepSeekUsageDialog  弹窗状态机 + 登录入口 + 摘要 + 懒加载 ECharts 每日曲线 + 月份切换
  settings/hub menu    平台会话配置展示与手动粘贴（浏览器兜底）

Desktop（WebView2）
  登录模态窗口：仅允许 platform.deepseek.com；登录后注入 JS 读 localStorage token → 调 Hub 配置接口 → 关闭

Android（WebView Dialog）
  登录 Dialog：打开官方登录页；登录后 evaluateJavascript 读 token → 调 Hub 配置接口 → 关闭
```

## 流程

1. 用户点击 Monitor 中 DeepSeek 账号行（余额账号首次获得可点击入口）→ Web 打开 DeepSeek 用量弹窗。
2. 弹窗读取 HubConfig 快照中的平台会话状态：
   - 未配置：Desktop/Android 显示“登录 DeepSeek”按钮，打开内嵌官方登录页，登录成功后自动保存 token 并继续；浏览器显示“打开官方登录页”链接 + token 粘贴框。
   - 已配置：直接调用 `deepseek.usage.get`。
3. Hub 收到请求：无 token → `notConnected`；有 token → 查 `(year, month)` 缓存，未命中或过期则并行请求 summary/amount/cost，解析后缓存并返回。
4. Web 渲染摘要（本月花费、今日花费、余额）与每日曲线（总量、命中率、花费）；月份切换按需请求；刷新强制重拉。
5. token 失效（40003）→ 返回 `expired`，弹窗切换到登录状态，同时保留最后一次成功缓存数据展示。

## 验收标准

- 未登录时弹窗展示登录入口：Desktop/Android 内嵌官方登录页可完成登录并自动保存 token；浏览器可粘贴保存；保存后 token 不回显、不落日志、不进入 Session/Registry 广播。
- `deepseek.usage.get` 行为：无 token → `{status: "notConnected"}`；token 失效 → `{status: "expired"}`；成功 → `{status: "ok", month, balance[], daily[], costs[]}`（daily 含 date/request/outputTokens/hitTokens/missTokens/totalTokens，costs 按币种含 monthlyCost/todayCost/daily）；非法月份 → `INVALID_ARGUMENT`。
- 缓存生效：5 分钟内重复请求当前月不重复请求平台（注入 HTTP client 验证）；刷新强制重拉；历史月 TTL 24 小时；平台失败或 token 失效不覆盖缓存。
- tokenStats 不含每日序列；Monitor 简单/Detail 的 DeepSeek 展示保持余额不变；DeepSeek 余额账号行可点击打开弹窗。
- 弹窗曲线每个节点显示总量、命中率、花费；命中率按 `hit ÷ (hit + miss)` 计算；数据来源标注“约 5 分钟延迟”。
- 平台接口网络失败/5xx 时返回明确错误并保留缓存；弹窗支持重试与关闭，关闭不中断已保存的会话。
- 登录窗口只允许访问 `platform.deepseek.com`，与聊天 WebView 隔离；Desktop/Android 登录流程可取消、可重试。

### 测试

- Go：平台客户端字段解析与容错、缓存 TTL 与强制刷新、40003 映射 `expired`、hubconfig 新 secret 的 set/clear/redact、Registry 方法注册、Hub handler（参数校验、无 token、缓存命中、平台错误、缓存保留）、Registry 转发路由。
- Web：弹窗状态机（notConnected/loading/ready/expired/error）、月份切换请求参数、命中率计算、手动粘贴保存、余额兜底展示。
- Desktop：登录窗口 URL 白名单、token 抓取回调、取消与失败路径。
- Android：登录 Dialog 打开/关闭与 token 回传。
- 不依赖真实平台登录与真实 token 的 CI 测试。

## 范围之外

- 不在 Hub 内实现平台登录/短信接口（依赖浏览器风控环境）。
- 不把每日序列放入 HubState tokenStats，不改变现有 Limits 扫描频率与其他 Provider 行为。
- 不提供多平台账号/多会话管理，不做平台 token 自动续期（token 过期后由用户重新登录）。
- 不做本地价格估算；花费一律采用平台官方金额。
- 不修改 protocol version。
