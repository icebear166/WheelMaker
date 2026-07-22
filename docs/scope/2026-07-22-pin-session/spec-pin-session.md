> 由 scope skill 于 2026-07-22 生成

# Pin Session

## 目标

为活跃 Session 列表增加由 Hub 持久化的 pin 能力。同一 Hub 的桌面端、移动端和其他浏览器共享 pin 状态；pinned session 在所属 project 的活跃 Session 列表内置顶，刷新或重新进入 project 时从 Hub 重新同步。桌面端通过右键菜单操作，移动端统一通过长按打开菜单后操作；pinned session 的时间位置显示可点击的 pin icon，用于直接取消 pin。

## 决策

- Pin 状态以 Hub 为唯一持久化来源，按 project 和 session 归属，不写入浏览器本地 Workspace 偏好。
- 同一 Hub 的客户端共享状态，但不做实时广播；发起操作的客户端使用请求响应更新，其他客户端在下次刷新或重新进入 project 时同步。
- 一个 project 可以同时 pin 多个 session。列表先按 pinned / unpinned 分组，每组内部继续按 `updatedAt` 倒序；不引入手动排序或 pin 时间排序。
- 桌面端 Session 右键菜单和更多操作菜单显示 `Pin` / `Unpin`。
- 移动端 Project 与 Session 统一为“长按打开操作菜单，再选择 Pin/Unpin”。现有 Project 长按直接切换 pin 的行为改为打开菜单。
- Pinned session 的相对时间位置改为 pin icon；该 icon 是独立按钮，点击只取消 pin，不选择或打开 session。未 pin session 继续显示相对时间。
- Recent 中复用的活跃 Session 行显示相同 pin 状态和菜单动作，但 pin 不改变 Recent 候选选择或 Recent 分组顺序；置顶排序只作用于各 project 的完整活跃 Session 列表。
- 草稿 Session 还没有 Hub session identity，不提供 pin 操作。
- 归档或删除 Session 时 pin 状态随活跃 Session 记录清理；恢复归档 Session 后默认未 pin。归档列表不显示 pin 操作。
- Pin 是列表元数据，运行中的 Session 仍可 pin/unpin；只在该 Session 的 pin 请求进行中禁用重复提交。
- Pin 请求失败时不保留错误的本地状态，使用现有错误展示路径反馈失败。

## 架构

Pin 是 Session summary 的共享元数据。App 通过新增的 project-scoped Registry 方法写入，Hub 在现有 Session SQLite 记录的 `session_sync_json` 中保存 `pinned`，避免增加 SQLite column 或 table 导致现有严格 schema 校验拒绝旧数据库。`session.list`、写入响应及其他返回 Session summary 的路径统一携带 `pinned`。

Web 在 Session 列表状态中保留 `pinned`，使用独立的稳定排序 helper 将 pinned session 提到当前 project 顶部。Hub 保持现有按更新时间返回 Session 的职责，Web 只增加 pinned 分组，不改变组内更新时间顺序。

### Registry 协议

协议保持 Registry `2.6`，不修改 protocol version。新增内容是兼容性扩展：

```text
method: session.pin
envelope.projectId: required
payload: { sessionId: string, pinned: boolean }
response: { ok: true, session: RegistrySessionSummary }
```

`RegistrySessionSummary` 新增：

```ts
pinned?: boolean
```

Hub 新版本始终返回明确的布尔值；Web 对缺失字段按 `false` 处理。`session.pin` 注册为现有 `session_forward` 路由，不新增事件方法。Pin/unpin 成功时不发布 `session.updated`，因此不会实时改变其他已连接客户端。

### Hub 持久化

Hub 的 session sync projection 增加 `pinned` 布尔字段。更新 turn cursor、mark-read、prompt 持久化和 session reload/reset 时必须保留现有 pin 值；只有显式 unpin、归档或删除清除。归档恢复创建新的活跃 Session 记录时使用默认 `pinned=false`。

## 流程

1. 客户端通过右键、更多菜单或移动端长按菜单选择 Pin/Unpin，或点击 pinned 行尾部的 pin icon 取消 pin。
2. Web 调用 `session.pin`，携带目标 `projectId`、`sessionId` 和目标布尔值；请求期间禁用该 session 的重复 pin 操作。
3. Hub 校验 session 属于 envelope 指定的 project，将 `pinned` 写入该 Session 的 sync projection，并返回更新后的 Session summary。
4. Web 用响应 summary 合并当前 project Session 状态并重新排序；不等待额外事件。
5. 其他客户端下一次执行 `session.list` 刷新时读取同一 Hub 持久化状态并得到相同排序。

## 验收标准

- 桌面端活跃 Session 的右键菜单和更多菜单包含与当前状态匹配的 Pin/Unpin 动作。
- 移动端 Project 和 Session 长按均打开操作菜单，Pin/Unpin 在菜单内执行；Project 不再由长按直接切换 pin。
- Pin 成功后目标 session 立即移动到所属 project 活跃列表的 pinned 分组；unpin 后回到按更新时间决定的位置。
- 多个 pinned session 和多个 unpinned session 各自保持 `updatedAt` 倒序。
- Pinned session 的时间位置显示可聚焦、带可访问名称的 pin 按钮；点击只取消 pin，不触发行选择。
- Recent 行显示 pin icon 和 Pin/Unpin 菜单状态，但 pin 不强制 session 进入 Recent，也不改变 Recent 的选择与排序。
- 刷新页面或重新进入 project 后，pin 状态从 Hub 恢复；同一 Hub 的另一客户端刷新后得到相同状态。
- Pin/unpin 不广播实时 Registry 事件，未刷新的其他客户端允许暂时显示旧状态。
- Session reload/reset 不丢失 pin；归档或删除会清除 pin，恢复归档 Session 后保持未 pin。
- 对不存在或不属于目标 project 的 session 执行 `session.pin` 返回错误且不创建状态。
- 运行中的 session 可以正常 pin/unpin，不复用 Archive、Reload 或 Delete 的运行中禁用条件。
- Pin 请求失败时列表维持请求前状态并显示错误；请求期间不会对同一 session 重复提交。
- Registry protocol version 仍为 `2.6`。

### 测试

- Go 协议测试覆盖 `session.pin` 的 method descriptor、client 权限、projectId 要求和 session-forward 路由，并断言 protocol version 未变化。
- Hub store/recorder 测试覆盖 pin true/false 的持久化、列表 summary、进程重建后的读取、cursor 更新与 reload 保留、归档/删除清理及恢复后未 pin。
- Hub request 测试覆盖有效更新、session 不存在、project 隔离、响应 summary，以及不发布 `session.updated`。
- Web repository 测试覆盖请求 envelope、payload、响应规范化和缺失 `pinned` 时的 false 默认值。
- Web 状态 helper 测试覆盖 pinned 分组、组内更新时间排序、稳定排序和 unpin 复位。
- Web UI contract/component 测试覆盖桌面菜单、移动端 Project/Session 长按菜单、pin icon 独立点击、Recent 行复用、草稿/归档排除和失败状态。
- 完成前运行相关 Jest、Web TypeScript 检查、Web production build、相关 Go package 测试和完整 `go test ./...`。

## 范围之外

- Pin 状态的实时跨客户端推送。
- Pin 时间、手动拖拽排序或 pinned 分组内自定义顺序。
- 将 pinned session 强制加入 Recent、搜索结果或归档列表。
- 为旧 Hub 提供浏览器本地 pin fallback。
- 修改 Registry protocol version。
- 修改 Project pin 的持久化位置；本次只统一其移动端长按入口为菜单操作。
