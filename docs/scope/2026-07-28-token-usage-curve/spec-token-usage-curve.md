> 由 scope skill 于 2026-07-28 生成

# Token 剩余额度曲线

## 目标

Monitor 的 Limits 当前只展示各 Agent 账号最新的剩余额度百分比和下次重置时间，无法判断额度正在以多快的速度下降、是否会在重置前耗尽。新增按账号打开的曲线模态框：Hub 持久化轻量原始采样，Web 在用户打开模态框时按需读取最近一周数据，选择质量最好的单 Hub 数据，在浏览器中计算平滑消耗趋势，并对比预计耗尽时间与真实重置时间。

## 决策

- 曲线纵轴显示剩余额度百分比，向下代表额度消耗；不展示实际 Token 数。
- 点击 Limits 中整条 Agent 账号行打开一个模态框；关闭按钮、遮罩点击和 `Escape` 均可关闭。
- 一个账号只展示周期最长的百分比 Limit，不提供短周期切换。最长项依据窗口类型和时长选择，例如 `month > week > 5h`。
- 图表横轴从所选历史的首个有效采样开始，到当前 `resetAt` 结束。
- Hub 每 10 分钟自动扫描时记录采样；现有手动刷新成功后也记录采样。刷新只追加采样点，不代表开启新额度周期。
- Hub 只保存和返回原始数据，不计算趋势或预计耗尽时间。
- Web 同时查询该账号关联的所有在线 Hub，但不跨 Hub 合并采样；由 Web 选择一条质量最好的候选序列。
- 每个 Hub 最多返回当前额度周期内最近 7 天的数据。
- 预测采用时间加权平均消耗速度：平稳区间计入，越新的区间权重越高，额度回升区间排除。周额度使用近 24 小时，月额度使用近 72 小时。
- 至少有 3 个有效采样点才输出趋势预测；不足时仍显示真实曲线和重置时间，并提示正在积累数据。
- 若预计在重置前耗尽，显示预测曲线和耗尽时间；若不会提前耗尽，图表不延伸到重置以后，显示重置时预计剩余百分比。
- Provider 返回的 `resetsAt` 是真实重置参考时间。MyFlicker 月额度是明确例外：按 `Asia/Shanghai` 的下月 1 日 00:00 生成重置时间。
- 历史落在 Hub 状态目录的独立 JSON 文件 `<stateDir>/db/usage-history.json`，默认是 `~/.wheelmaker/db/usage-history.json`。
- 文件损坏、版本不支持或结构校验失败时直接删除并重建空历史，记录错误日志但不阻断 Hub 和最新 Limits。
- 图表使用 ECharts 6，按需引入且通过动态 `import()` 在首次打开模态框时加载，不进入普通页面首屏 chunk。
- 本功能通过新增只读 `usage.history.get` 请求按需读取；这是向后兼容的增量方法，不修改现有 protocol version。

## 架构

```text
Provider scans
    |
    v
Hub usage service ---- latest snapshot ----> hub.state.updated ----> Limits
    |
    +---- successful raw samples ----> usage history JSON
                                          |
App opens account modal                    |
    +---- usage.history.get per online Hub-+
    |
    +---- choose one Hub/longest Limit
    +---- calculate weighted forecast
    +---- lazy-load ECharts and render modal
```

### Hub 历史存储

Usage 包新增独立历史存储，由 Reporter 使用 `StateDir` 构造。存储不复用 Session `state.db`，也不归属于 Project 或 Session。

文件采用版本化平铺结构：

```json
{
  "version": 1,
  "series": [
    {
      "providerId": "codex",
      "accountLocalId": "current",
      "limitId": "week",
      "limitLabel": "Week",
      "windowKind": "fixed",
      "windowDurationMins": 10080,
      "resetAt": "2026-08-03T00:00:00Z",
      "samples": [
        [1785196800000, 82.4],
        [1785197400000, 81.9]
      ]
    }
  ]
}
```

每个采样点只含 Unix 毫秒时间戳和剩余百分比。账号、Limit 和窗口元数据每条序列只保存一次，`resetAt` 只保存扫描所得的最新值；其变化时覆盖旧值，不创建周期对象。文件不保存凭据、实际 Token 数或账号展示身份。

固定窗口的当前周期起点由 `resetAt - windowDurationMins` 得出；MyFlicker 的日历月起点按 `Asia/Shanghai` 推导。存储保留当前及上一个额度窗口内的采样：固定周窗口最多 14 天，日历月保留当前月和上一个自然月。每条序列最多 10,000 个点，超过时删除最旧点。

写入在进程内串行化，采样时间使用本轮扫描完成时间。只有 Provider 本次成功返回的原始账号 Limit 才能追加采样；扫描失败后服务为 Limits 保留的旧成功快照不得生成新点。每条序列以时间戳为唯一键，同一时间戳再次写入时覆盖数值而不增加点数。每次变更后使用现有原子文件替换能力写盘。

### 按需历史接口

新增 Registry 方法 `usage.history.get`：

- App 请求包含目标 `hubId`、`providerId`、该 Hub 的 `accountLocalId`。
- Registry 只验证和转发，不保存或聚合历史。
- Hub 校验 Provider、账号和请求大小后，返回该账号所有百分比 Limit 的窗口元数据，以及当前周期内最近 7 天的原始采样。
- 单条序列通常不超过 1,008 个自动 10 分钟采样；额外手动刷新点受 10,000 点存储上限及最近 7 天响应范围约束。
- 旧 Hub 对未知方法返回现有 unsupported-method 错误；Web 忽略单个旧版或离线 Hub，继续处理其他候选。

Usage 视图模型需保留合并账号对应的 Hub 本地引用 `{hubId, accountLocalId, updatedAt}`，供模态框并发请求使用；这些引用不改变现有账号合并显示。

### Web 预测

Web 先在各 Hub 返回值中选出该账号的最长 Limit，再为同一 Limit 选择单一 Hub：

1. 优先选择最后采样距当前不超过 20 分钟且至少有 3 个点的候选；
2. 候选中覆盖时间跨度最长者优先；
3. 跨度相同依次比较采样点数和最后更新时间；
4. 若没有合格候选，选择最后采样最新的一条，只展示历史并提示正在积累趋势数据。

预测窗口为周额度近 24 小时、月额度近 72 小时。对时间递增的相邻点计算区间速度：

- `speed = (previousRemaining - currentRemaining) / elapsedTime`；
- 剩余值持平时速度为零并参与平均；
- 剩余值回升时该区间不参与平均；
- 区间按其中点距最新采样的时间做指数衰减，半衰期为预测窗口的一半；
- 有效区间的加权平均值作为当前消耗速度。

若平均速度大于零，则从最后真实采样向未来投影；否则视为按当前速度不会耗尽。预计耗尽不晚于 `resetAt` 时显示耗尽点；预计耗尽晚于 `resetAt` 时只投影到重置点并计算届时预计剩余值。

### 模态图表

ECharts 仅注册折线、直角坐标、Tooltip、参考线及 Canvas renderer 所需模块。模态框使用项目主题 token 配置明暗主题，不直接采用默认配色。

- 真实采样使用实线和低透明度面积渐变。
- 预测使用同色虚线，从最后一个真实点开始。
- 重置时间使用独立参考线和标签；提前耗尽时另标记耗尽时间。
- 纵轴固定为 0–100%，横轴使用本地时间标签；视觉平滑不得产生超出真实点范围的过冲。
- Tooltip 显示本地时间和精确剩余百分比。
- Canvas 旁提供可访问的文字摘要，包含当前剩余、观测区间、预测状态、预计耗尽时间或重置时预计剩余，以及真实重置时间；图形不是获取结论的唯一方式。
- 加载 ECharts chunk 和读取 Hub 历史分别显示加载状态。
- 全部 Hub 失败时显示错误和重试；无历史或样本不足时使用独立空状态。
- 没有百分比 Limit、只有余额的账号行不提供曲线入口。

## 流程

1. Hub 完成一次自动或手动 Limits 扫描。
2. Usage 服务把本次成功的原始 Limit 值交给历史存储。
3. 历史存储更新该序列最新 `resetAt`，追加 `[observedAt, remainingPercent]`，去重、裁剪并原子写盘。
4. Web 继续通过现有 `hub.state.updated` 接收轻量最新 Limits；事件不携带历史。
5. 用户点击一个 Agent 账号行，Web 打开模态框并懒加载 ECharts。
6. Web 根据账号的 Hub 本地引用，并行向所有在线 Hub 发起 `usage.history.get`。
7. Web 忽略失败候选，选择最长 Limit 和质量最好的单 Hub 序列，计算预测并绘图。
8. 用户关闭模态框后清理图表实例；已下载的代码 chunk 由浏览器缓存。

## 验收标准

- Hub 重启和 App 刷新后，已记录的有效采样仍可读取。
- `usage-history.json` 的采样点只含时间戳和百分比，`resetAt` 每条 Limit 序列只保存一个最新值。
- 自动扫描与手动刷新成功时各追加一个采样；失败扫描不会把旧值伪装成新采样。
- 历史裁剪符合周 14 天、月当前加上月、每序列 10,000 点的上限。
- 损坏或不支持版本的历史文件会被删除重建；Hub、最新 Limits 和其他功能继续运行。
- 打开账号模态框时才请求历史并加载 ECharts；普通 Monitor 首次加载不包含 ECharts chunk。
- App 会查询账号关联的全部在线 Hub，但最终曲线只使用按既定规则选中的一个 Hub。
- Hub 响应只包含当前周期最近 7 天的原始数据，不返回预测结果。
- 最长 Limit 选择、Hub 候选选择和时间加权预测结果在固定输入下是确定的。
- 三个点以下不显示预测；平稳点影响平均速度；回升区间不拉高或反转消耗预测。
- 提前耗尽和重置前不会耗尽两种状态均有明确时间、百分比和图形表达。
- MyFlicker 的月重置点始终按 `Asia/Shanghai` 下月 1 日 00:00 计算。
- 模态框支持鼠标、键盘和窄屏；焦点进入模态框并在关闭后返回触发账号行。
- 不读取 Canvas 也能从模态框文字摘要获得当前剩余、预测结论和重置时间。
- 旧版、离线或读取失败的单个 Hub 不妨碍使用其他 Hub；全部失败时可重试。
- 新增方法不改变 protocol version，现有 Limits 快照和刷新行为保持兼容。

### 测试

- Go 存储测试：首次创建、原子写入、重载、去重、成功/失败采样、重置时间覆盖、周/月裁剪、点数上限、损坏与版本不兼容重建。
- Go Provider/usage 测试：窗口元数据、MyFlicker 日历月、原始成功结果与保留快照的边界。
- Go 协议与路由测试：`usage.history.get` 参数校验、Registry 转发、Hub 响应、未知旧方法兼容行为和响应范围。
- TypeScript 单元测试：最长 Limit、Hub 候选排序、24/72 小时窗口、时间权重、平稳/回升区间、提前耗尽和安全剩余计算。
- React 测试：账号行入口、打开/关闭/焦点恢复、懒加载、加载/空/错误/重试状态，以及仅余额账号不可点击。
- 构建验证：Web TypeScript、Jest、生产构建及产物检查，确认 ECharts 位于独立异步 chunk。
- 不测试 Provider 外部服务的真实时间流逝；使用固定时钟和响应 fixture 验证。

## 范围之外

- 实际 Token 数或请求级 Token 明细。
- 在图表中切换 5 小时、周、月等短周期 Limit。
- 浏览或比较历史额度周期；上一个周期仅为落盘保留数据。
- 跨 Hub 拼接或平均采样。
- 图表缩放、导出、分享和告警通知。
- 修改 Limits 的 10 分钟自动刷新频率。
- 修改 protocol version。
