# 今日提交问题修复计划

> 日期：2026-08-04
> 范围：撤回 Kimi API Key 迭代，并按风险优先级修复今日提交审查发现的问题。
> 约束：保留并排除当前工作区中的 Caddy 迁移改动；所有行为修复先写失败测试。

## Task 1：撤回 Kimi 标准提供商的 API Key 注入

**Files**
- Modify: `server/internal/hub/agent/acp_provider.go`
- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/agent_test.go`

**Steps**
1. 将测试改为调用无参数 `NewKimiProvider()`，并断言标准 Kimi preset 不包含 API Key 环境变量。
2. 运行 `go test ./internal/hub/agent -run Kimi -count=1`，确认测试先失败。
3. 恢复 `NewKimiProvider()` 的 OAuth-only 行为；factory 不再向标准 Kimi 注入 key，同时保留 `cc-kimi` 的 key 配置。
4. 重跑目标测试。

## Task 2：修复发布存储查询/清理的竞态与阻塞

**Files**
- Modify: `app/web/src/settings/ReleasePublishSettings.tsx`
- Modify: `app/web/src/settings/ReleasePublishSettings.test.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `scripts/release/release-server-api.mjs`
- Modify: `scripts/release/release-server-api.test.mjs`
- Modify: `server/internal/hub/tools/release.go`
- Modify: `server/internal/hub/tools/tools_test.go`

**Steps**
1. 增加 UI 测试：旧 storage 请求晚返回时不能覆盖新配置；确认清理必须使用弹窗打开时锁定的 hub/source；storage 成功不能清除发布错误。
2. 运行目标 Jest 测试，确认失败。
3. 为 storage 请求增加请求代次和独立错误状态；在确认目标中保存 hub/source 快照。
4. 增加 Node 测试，要求 storage/prune 控制请求设置有限超时，而上传仍无全局超时；确认失败后实现可选 `timeoutMs`。
5. 增加 Go 并发测试，要求阻塞的只读 storage 查询不占用发布构建锁；确认失败后仅让有副作用的操作持有 `buildMu`。
6. 重跑 Jest、Node、Go 目标测试。

## Task 3：修复晚创建用户技能目录不触发刷新

**Files**
- Modify: `server/internal/hub/skills_watcher.go`
- Modify: `server/internal/hub/hub_test.go`

**Steps**
1. 增加可控 reconcile tick 测试：track 后创建完整 `~/.agents/skills/<skill>`，首次轮询必须触发对应 hub 的 `OnChange`。
2. 运行 watcher 目标测试，确认失败。
3. 让 reconcile 返回新发现 watch 所属的 target，并在轮询中合并去重后触发刷新；初次 TrackHub 仍只建立 watches。
4. 重跑 watcher 测试。

## Task 4：降低 session.read 超大页面的序列化复杂度

**Files**
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/client_test.go`

**Steps**
1. 增加编码器调用次数测试：1024 turns 的裁剪不应逐条重复 marshal，调用次数应为对数级。
2. 运行目标测试，确认当前逐条回退实现失败。
3. 用二分查找选择满足字节上限的最大 turn 前缀，保留当前 1024 turns / 14 MiB 协议边界和 cursor 语义。
4. 重跑 session 目标测试。

## Task 5：修复 Windows guardian 重启残留进程竞态

**Files**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`

**Steps**
1. 增加脚本文本测试，要求停止任务后循环清理精确 hub 可执行文件进程，并在超时后拒绝继续启动。
2. 运行目标 Node 测试，确认失败。
3. 实现有界重复枚举/终止和最终残留校验。
4. 重跑 deploy 测试。

## Task 6：修复权限弹窗标题与 Markdown 回复误触

**Files**
- Modify: `app/web/src/chat/permission/ChatPermissionDialog.tsx`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/__tests__/web-request-permission-dialog.test.tsx`
- Modify: `app/web/__tests__/web-chat-turn-markdown.test.tsx`

**Steps**
1. 更新权限测试：有 details/question 时它是主标题，tool title 作为上下文。
2. 增加回复点击测试：已 preventDefault、点击交互子元素或存在文本选择时不得发送回复。
3. 运行 Jest 目标测试，确认失败。
4. 恢复弹窗信息层级，并为 paragraph/list 回复入口增加统一激活守卫。
5. 重跑目标测试。

## Task 7：修复 npm 最新完成操作被旧状态遮蔽

**Files**
- Modify: `server/internal/hub/tools/npm.go`
- Modify: `server/internal/hub/tools/tools_test.go`

**Steps**
1. 增加测试：写操作和扫描都完成时返回完成时间更新的快照。
2. 运行 npm 目标测试，确认失败。
3. 保留运行中操作优先级；两者完成后按 `FinishedAt`（回退 `StartedAt`）选择较新结果。
4. 重跑 npm 测试。

## Task 8：全量验证与提交

**Steps**
1. 运行受影响 Go/Node/Jest 测试和 TypeScript 检查。
2. 运行完整 `go test ./...` 与前端完整测试（若耗时允许）；记录任何与本次无关的失败。
3. 检查 diff，确保不包含 `scripts/release-server/deploy.mjs`、`scripts/release-server/deploy.test.mjs`、`scripts/release-server/Caddyfile`。
4. fetch 并确认远端没有新提交；仅暂存本计划和本次修复文件，提交并推送当前分支。
