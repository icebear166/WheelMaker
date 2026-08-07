> 由 scope skill 于 2026-07-26 生成

# Session Color Mark

## 目标

在现有 Session Pin 之外增加独立的颜色 Mark，帮助用户仅凭颜色区分活跃 Session。Mark 不具备置顶语义，不改变 Pin、列表排序或 Session 生命周期行为；它由 Hub 持久化，并在项目列表与 Recent 中保持一致。颜色标记覆盖绘制在 Session 行最右侧，不挤压现有标题、agent、时间或 pin 控件。

## 决策

- Pin 与 Mark 是两份独立状态。设置、修改或清除 Mark 均不得改变 `pinned`；Pin/Unpin 也不得改变 Mark。
- 一个活跃 Session 最多有一个 Mark，固定提供红、黄、绿、蓝四种颜色，不支持文字、自定义颜色或多个 Mark。
- 任意活跃 Session 均可设置 Mark，包括未 pin 和运行中的 Session；草稿与归档 Session 不提供 Mark 操作。
- 现有 Session 操作菜单在 Pin/Unpin 下方增加 `Mark` 色板。四个颜色选项使用等尺寸圆形色块；清除选项使用同尺寸圆形按钮和禁止图标，不显示额外清除文字。
- 颜色按钮提供可访问名称和选中状态。选择颜色或清除后关闭菜单。
- 有 Mark 时，Session 行最右侧显示一条细的圆角竖向颜色标记。已 pin 行中它位于 pin 图标右侧；未 pin 行中它位于相同的外侧边缘。标记使用绝对定位或等效覆盖方式，不参与 flex 布局，也不减少原有内容宽度。
- 项目 Session 列表与 Recent 列表显示并操作同一 Mark；Mark 不影响任一列表的候选选择、分组或排序。
- Mark 与 Pin 沿用相同同步边界：Hub 是持久化来源，发起请求的客户端通过响应立即更新，其他客户端在下次刷新或重新进入 project 时同步；不增加实时广播。
- 归档或删除 Session 时清除 Mark；恢复归档 Session 后默认没有 Mark。
- Mark 请求失败时不保留错误的本地状态，使用现有错误展示路径反馈失败。

## 架构

Mark 是 Session summary 的共享元数据。App 通过独立的 project-scoped Registry 方法更新 Mark；Hub 将 `markColor` 保存到现有 Session SQLite 记录的 `session_sync_json`，不增加 SQLite column 或 table。`session.list`、写入响应及其他活跃 Session summary 路径统一携带有效的 `markColor`。

Web 在 Session 列表状态中保留 `markColor`。`session.mark` 响应中的 summary 对 Mark 是权威状态：响应省略 `markColor` 时必须清除本地旧颜色，不能按普通 partial summary 合并规则保留旧值。现有排序 helper 仍只根据 Pin 和 `updatedAt` 决定顺序。Session 行通过不占布局空间的尾部装饰展示颜色，现有操作菜单负责选择与清除。

### Registry 协议

协议保持 Registry `2.6`，不修改 protocol version。新增兼容性扩展：

```text
method: session.mark
envelope.projectId: required
payload: {
  sessionId: string,
  markColor: "" | "red" | "yellow" | "green" | "blue"
}
response: {
  ok: true,
  sessionId: string,
  session: RegistrySessionSummary
}
```

空字符串表示清除 Mark。Hub 拒绝其他颜色值；Web 将 summary 中缺失、空值或未知的 `markColor` 视为未设置。

`RegistrySessionSummary` 新增：

```ts
markColor?: "red" | "yellow" | "green" | "blue"
```

`session.mark` 注册到现有 `session_forward` 路由，不新增事件方法。操作成功时不发布 `session.updated`，以保持与 Pin 相同的跨客户端同步行为。旧客户端可忽略新增 summary 字段；不为不支持 `session.mark` 的旧 Hub 提供本地 fallback。

### Hub 持久化

Hub 的 session sync projection 增加可选 `markColor`。Turn cursor、mark-read、prompt 持久化、Session reload/reset 及 recorder 重建必须保留现有 Mark。只有显式清除、归档或删除会清除 Mark；归档 summary 不携带 `markColor`，恢复后的活跃 Session 使用无 Mark 默认值。

## 流程

1. 用户通过桌面端右键/更多菜单或移动端长按菜单打开 Session 操作菜单。
2. 用户在 Pin/Unpin 下方的 Mark 色板选择红、黄、绿、蓝之一，或点击禁止图标清除。
3. Web 调用 `session.mark`，携带目标 `projectId`、`sessionId` 和目标 `markColor`；请求期间禁用该 Session 的 Mark 色板，避免重复提交。
4. Hub 校验 Session 属于 envelope 指定的 project，校验颜色枚举，将 Mark 写入 sync projection，并返回更新后的 Session summary。
5. Web 用响应 summary 合并项目 Session 状态；项目列表与 Recent 立即显示相同 Mark，原有排序不变。
6. 其他客户端下次执行 `session.list` 刷新时读取同一 Hub 持久化状态。

## 验收标准

- 桌面端和移动端的活跃 Session 操作菜单都在 Pin/Unpin 下方显示 Mark 色板。
- 色板包含红、黄、绿、蓝四个等尺寸圆形色块，以及一个同尺寸、使用禁止图标的清除按钮。
- 色板按钮具有颜色名称、清除含义和当前选中状态的可访问信息；选择后菜单关闭。
- 已 pin Session 的颜色竖标位于 pin 图标右侧；未 pin Session 的竖标位于同一行最右侧。
- 新增竖标不会改变标题、agent、时间、pin 图标或 Session 行的可用布局宽度。
- Mark 可用于未 pin、已 pin 及运行中的活跃 Session；设置或清除 Mark 不改变 Pin 状态和列表位置。
- Pin/Unpin 不改变已有 Mark；Mark 不参与项目列表与 Recent 的候选、分组或排序。
- 同一 Session 在项目列表和 Recent 中显示相同 Mark，并可从任一入口修改。
- 刷新页面、重启 Hub 或从另一设备重新加载后，Mark 从 Hub 恢复。
- Mark 不实时广播；未刷新的其他客户端允许暂时显示旧状态。
- Session reload/reset 和 recorder 重建不丢失 Mark。
- 归档或删除会清除 Mark；恢复归档 Session 后没有 Mark，归档列表不显示 Mark。
- 对不存在或不属于目标 project 的 Session 执行 `session.mark` 返回错误且不创建状态。
- Hub 拒绝红、黄、绿、蓝和空字符串之外的 `markColor`。
- 请求失败时列表保持请求前状态并显示错误；请求期间不会对同一 Session 重复提交。
- Registry protocol version 仍为 `2.6`。

### 测试

- Go 协议测试覆盖 `session.mark` 的 method descriptor、client 权限、projectId 要求、session-forward 路由，并断言 protocol version 未变化。
- Hub recorder/store 测试覆盖四种颜色、清除、无效颜色、列表 summary、重建与 reload/reset 保留，以及归档/删除清理和恢复后无 Mark。
- Hub request 测试覆盖有效更新、Session 不存在、project 隔离、运行中 Session、响应 summary，以及不发布 `session.updated`。
- Web repository 测试覆盖请求 envelope、颜色与清除 payload、响应规范化，以及缺失、空值和未知 `markColor` 的兼容处理。
- Web 状态测试覆盖 summary 合并后的 Mark 更新与权威清除、Pin 保留、排序不变，以及项目列表与 Recent 复用。
- Web 组件与 UI contract 测试覆盖桌面/移动端菜单色板、颜色与清除按钮、可访问状态、行尾覆盖标记、已 pin/未 pin 布局、草稿/归档排除和失败状态。
- 完成前运行相关 Jest、Web TypeScript 检查、Web production build、相关 Go package 测试和完整 `go test ./...`。

## 范围之外

- 让 Mark 具备 Pin、排序、筛选或分组语义。
- 文字标签、自定义颜色、多个 Mark 或 Mark 管理界面。
- 点击行尾颜色标记打开色板；Mark 只从现有 Session 操作菜单修改。
- 在草稿、搜索结果或归档列表中显示或修改 Mark。
- Mark 状态的实时跨客户端推送。
- 为旧 Hub 提供浏览器本地 Mark fallback。
- 修改 Registry protocol version。
