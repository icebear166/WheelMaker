# Hub Flickr Bridge 完整代理修复计划

> 执行约束：仅 Windows x64；代理生产实现保持在
> `server/internal/flickerbridge/flicker_bridge.go` 单文件；仅本地构建和测试，
> 不提交、不暂存、不推送。

## 目标

把当前 WheelMaker 内的 Flickr Bridge 从“基础链路可用”修到与
`MyFlickerBridge/myflicker_bridge.py` 当前代理运行时逻辑一致，并补齐 Hub
子进程生命周期、前端启停状态同步和可维护性验证。配置写入功能不迁移。

## 实施步骤

### 1. 固化代理行为差异

- 新增独立 Go 测试，覆盖未知模型拒绝、图片历史裁剪、路由别名和 CORS。
- 新增测试覆盖上游 busy 重试、额度错误分类、客户端断开和超时边界。
- 新增测试覆盖 Responses compaction、官方 Codex Responses 路由与回退。
- 逐项运行测试，确认修复前为预期失败。

### 2. 补齐 Python 代理运行时能力

- 增加模型别名解析、严格模型校验及动态模型目录合并。
- 对图片历史做当前轮裁剪和大 base64 清理。
- 迁移上游 busy 重试、quota/credit 预检与错误分类。
- 补齐 `/responses`、`/chat/completions` 等别名、OPTIONS/CORS 和断开处理。
- 迁移 Responses compaction、官方 Codex OAuth/Responses 转发及 websocket 回退。
- 补齐使用量、额度和受限尺寸日志。
- 保持所有生产代理代码仍在单个 Go 文件中。

### 3. 修正 Hub 子进程生命周期

- 先增加失败恢复、健康超时、退出、重启、关闭和并发启停测试。
- 将启动过程串行化，消除并发 Start/Stop 竞态。
- 健康失败时终止并回收子进程，允许随后重新启动。
- 校验健康响应内容，向前端发布完整状态变化事件。
- 明确限制为 Windows amd64。

### 4. 修正 Hub 菜单状态同步

- 用 Hub 状态事件驱动 Flickr Bridge 状态更新。
- 保留必要的单次刷新，移除 1.5 秒重叠轮询。
- 失败但进程仍存在时提供可恢复的停止/重启操作。
- 将只扫描源码字符串的测试替换为状态归一化与事件处理行为测试。

### 5. 清理与验证

- 删除确认未使用的代理辅助路径和重复模型目录实现，不删本地验收所需 selftest。
- 更新端口、密钥和生命周期文档。
- 运行 Go 单元/集成测试、代理 selftest、前端测试和 TypeScript 检查。
- 构建 Windows amd64 `wheelmaker.exe`，本机启动 Hub 子进程并验证 17999 健康与代理连通性。
- 检查 git 状态，确保没有 commit、stage 或 push。
