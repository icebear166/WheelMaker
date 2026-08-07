> 由 scope skill 于 2026-08-01 生成（重做版，替换同日初版）

# DeepSeek 平台用量监控（重做）

## 目标

Monitor 中 DeepSeek 目前只显示 API key 余额。初版“平台用量”实现（f259b88f..05f133b1 共 13 个提交）因解析层按臆造响应结构编写（camelCase `bizData`、`total_balance` 等假设与真实接口完全不符，余额/用量永远解析为空）、弹窗缺失基类样式、多个初版 spec 承诺的行为未落地，整体回退重做。

本次以 2026-08-01 真实抓包验证的接口结构为基础重新实现：点击 Monitor 中 DeepSeek 账号行后，弹窗展示本月花费、今日花费、余额，以及当月每日 token 用量图表；数据来自 DeepSeek 开放平台私有用量接口，需要平台 session token；Desktop/Android 提供内嵌官方登录页自动抓取 token，浏览器端提供官方登录页链接 + 手动粘贴兜底。tokenStats 保持简短，重数据在弹窗打开时按需拉取并缓存。

## 决策

- **整体回退后重做**：revert 初版 13 个 feature 提交（f259b88f..05f133b1），无关提交（f57a2c2c、c20fc00f）不动；旧实现仅作 git 历史参考，android/desktop 登录窗口三轮真机修复的经验（dialog 尺寸、webview 错误透出）直接写进新实现。
- **接口结构以真实抓包为唯一依据**（2026-08-01 实测，开源项目 CodexBar 交叉验证一致；脱敏 fixture 存于 [fixtures/](../plans/2026-08-01-deepseek-platform-usage/fixtures/)）：信封统一为 `{code, msg, data: {biz_code, biz_msg, biz_data}}`（snake_case）；顶层 `code` 或 `data.biz_code` 为 40002/40003 均视为 token 失效。废弃旧的“多 key 猜测”解析，全部按确定结构强类型解析；解析失败返回明确错误而不是静默出空数据。
- **get_user_summary**：`biz_data.normal_wallets[]`（充值）/ `biz_data.bonus_wallets[]`（赠送），wallet 字段为 `currency`、`balance`（十进制字符串，如 `"50.0033733200000000"`）、`token_estimation`（忽略）。按币种聚合：toppedUp = normal 之和，granted = bonus 之和，total = 两者之和；显示保留 2 位小数。平台钱包为空或无会话时，弹窗余额回退显示该账号 API key 余额（tokenStats 口径）。
- **usage/amount**：`biz_data.{total[], days[]}`；`days` 补满整月（无用量天全 0）；每日 `data[]` 按模型分，`usage[]` 的 `type` 有五种：`REQUEST`、`PROMPT_TOKEN`、`PROMPT_CACHE_HIT_TOKEN`、`PROMPT_CACHE_MISS_TOKEN`、`RESPONSE_TOKEN`；`amount` 为整数字符串。`PROMPT_TOKEN` 在现役模型恒为 0，**忽略不计**（避免与 hit+miss 双算）；每日总量 = hit + miss + response；命中率 = hit ÷ (hit + miss)，无输入 token 按 0。
- **usage/cost**：`biz_data[]` 按币种分块 `{currency, total[], days[]}`，嵌套结构与 amount 相同，`amount` 为十进制字符串。每日花费 = 当日全部模型非 REQUEST 类 amount 之和；月花费 = 该币种 `total[]` 非 REQUEST 之和；今日花费 = 当日之和（仅当前月）。
- **多币种按币种分组**：花费按 cost 接口的币种分块展示，余额按钱包币种列出；单币种用户无感知。
- **token 抓取精确化**：`localStorage.userToken` 的存储格式为 `{"value":"<token>","__version":"0"}`，登录抓取一律 `JSON.parse` 后取 `.value`；废弃正则盲扫（设备指纹等 key 会产生干扰候选）。
- **平台会话状态机**：无 token → `notConnected`；token 失效 → `expired`；平台网络失败/5xx → `error`。`expired` 与 `error` 在有缓存时都返回最后一次成功数据 + 状态标识，弹窗保留数据展示并分别给出重登入口 / 重试入口。
- **缓存**：Hub 按 `(year, month)` 缓存，当前月 TTL 5 分钟（与平台数据延迟一致）、历史月 TTL 24 小时；弹窗“刷新”强制重拉；失败不覆盖缓存。弹窗展示数据时点（cachedAt）。
- **呈现**：弹窗外壳复用 `usage-history` 体系，与 Codex usage 弹窗同一视觉语言；摘要三卡（本月花费 / 今日花费 / 余额，花费按币种分组）；图表为每日堆叠柱（output / cache miss / cache hit）+ 命中率折线（副轴），tooltip 显示总量、命中率、花费，颜色全部走 CSS token；月份支持前后翻页（前进不超过当前月）；无用量月份显示空态。
- **登录入口**：Desktop/Android 内嵌官方登录页自动抓取并保存；浏览器端显示“打开官方登录页”链接 + token 粘贴框；弹窗提供断开（清除 token）入口；token 不回显、不落日志、不进入 Session/Registry 广播。
- **协议**：additive 只读 Registry 方法 `deepseek.usage.get`（请求 `{year?, month?, force?}`，走 Hub 路由），不修改 protocol version；hubconfig 新增 `deepSeekPlatform.token` secret，快照仅暴露 configured/updatedAt。
- 一个 Hub 保存一个平台 session token；DeepSeek 配置多个 API key 账号时，平台数据挂在第一个账号。平台数据约有 5 分钟延迟，页面标注。

## 架构

```text
Hub
  hubconfig        secret: deepSeekPlatform.token（set/clear，仅暴露 configured/updatedAt）
  usage            平台客户端（summary/amount/cost，强类型解析）+ (year, month) 缓存
  usage.provider   现有 DeepSeek 余额扫描保持不变（API key）
  reporter         deepseek.usage.get handler：校验参数 → 查缓存 → 请求平台 → 解析/缓存 → 返回（含 stale）
Registry          additive 方法注册与 Hub 转发

Web
  registry*        方法常量、DTO、请求
  DeepSeekUsageDialog  弹窗状态机 + 登录面板 + 摘要 + 懒加载 ECharts 每日图表 + 月份切换
  usage.css        弹窗复用 usage-history 外壳，新增样式走设计 token

Desktop（WebView2）
  登录模态窗口：仅允许 platform.deepseek.com；登录后注入 JS 读 localStorage.userToken 的 value → 调 Hub 配置接口 → 关闭

Android（WebView Dialog）
  登录 Dialog：官方登录页；登录后 evaluateJavascript 读 userToken 的 value → 调 Hub 配置接口 → 关闭
```

## 流程

1. 用户点击 Monitor 中 DeepSeek 账号行 → Web 打开 DeepSeek 用量弹窗。
2. 弹窗读取 HubConfig 快照中的平台会话状态：
   - 未配置：Desktop/Android 显示“登录 DeepSeek”按钮，打开内嵌官方登录页，登录成功后自动保存 token 并继续；浏览器显示“打开官方登录页”链接 + token 粘贴框。
   - 已配置：直接调用 `deepseek.usage.get`。
3. Hub 收到请求：无 token → `notConnected`；有 token → 查 `(year, month)` 缓存，未命中/过期/force 则并行请求 summary/amount/cost，解析后缓存并返回。
4. token 失效（40002/40003）→ 返回 `expired` + 最后一次成功缓存；平台网络失败/5xx → 返回 `error` + 最后一次成功缓存；弹窗保留数据并分别提供重登 / 重试入口。
5. Web 渲染摘要（按币种）与每日图表；月份前后翻页按需请求；刷新强制重拉；展示数据时点。

## 验收标准

- 解析层由脱敏真实 fixture 驱动测试通过：`balance` 十进制字符串、amount 整数字符串、`PROMPT_TOKEN` 忽略、days 整月补齐、每日花费按非 REQUEST 求和、月花费取 `total[]` 求和、双层 code（顶层/biz_code）40002 与 40003 均映射 `expired`；结构不符时返回明确解析错误，不静默出空数据。
- 未登录时弹窗展示登录入口：Desktop/Android 内嵌官方登录页可完成登录并自动保存 token（精确读取 `userToken` 的 JSON `value`）；浏览器可打开官方登录页并粘贴保存；弹窗提供断开入口；token 不回显、不落日志、不进入 Session/Registry 广播。
- `deepseek.usage.get` 行为：无 token → `{status: "notConnected"}`；token 失效 → `{status: "expired"}` + stale；平台失败 → `{status: "error"}` + stale；成功 → `{status: "ok", month, balance[], days[], costs[], cachedAt}`；非法月份 → `INVALID_ARGUMENT`。
- 缓存生效：5 分钟内重复请求当前月不重复请求平台（注入 HTTP client 验证）；刷新强制重拉；历史月 TTL 24 小时；失败与 token 失效不覆盖缓存。
- 弹窗：状态机 notConnected/loading/ready/expired（保留数据 + 重登入口）/error（保留数据 + 重试）；月份前后翻页且前进不超过当前月；无用量月份空态；展示数据时点与“约 5 分钟延迟”标注。
- 呈现：弹窗外壳与 usage-history 弹窗一致；登录面板按钮/输入框走设计 token；图表颜色全部走 CSS token；tooltip 每节点显示总量、命中率、花费；命中率按 `hit ÷ (hit + miss)`。
- tokenStats 不含每日序列；Monitor 简单/Detail 的 DeepSeek 展示保持余额不变；DeepSeek 余额账号行可点击打开弹窗。
- 登录窗口只允许访问 `platform.deepseek.com`，与聊天 WebView 隔离；Desktop/Android 登录流程可取消、可重试，窗口尺寸与 webview 错误按旧真机修复经验落地。

### 测试

- Go：真实 fixture 解析与容错、缓存 TTL/force/stale、40002/40003 映射、hubconfig secret set/clear/redact、Registry 方法注册、Hub handler（参数校验、无 token、缓存命中、平台错误返回 stale）、Registry 转发路由。测试并入现有 `*_test.go` 文件。
- Web：弹窗状态机、月份切换请求参数与边界、命中率计算、多币种分组、手动粘贴保存与断开、空态、cachedAt 展示。
- Desktop：`userToken` JSON 解析、URL 白名单、取消与失败路径。
- Android：`userToken` JSON 解析、Dialog 打开/关闭与 token 回传。
- 不依赖真实平台登录与真实 token 的 CI 测试。

## 范围之外

- 不在 Hub 内实现平台登录/短信接口（依赖浏览器风控环境）。
- 不把每日序列放入 HubState tokenStats，不改变现有 Limits 扫描频率与其他 Provider 行为。
- 不提供多平台账号/多会话管理，不做平台 token 自动续期。
- 不做本地价格估算；花费一律采用平台官方金额。
- 不处理 `PROMPT_TOKEN` 非零的历史兼容（现役模型恒为 0）。
- 不修改 protocol version。
