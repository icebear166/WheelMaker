> 由 scope skill 于 2026-07-20 生成

# Session 排序稳定性

## 目标

Chat session 列表在收到消息时经常跳动。根因在服务端:agent 流式过程中每个带 usage 变化的 `session/update` 都会触发运行时快照持久化(`session.go:1090` → `persistSessionBestEffort`),把内存中按 turn 推进的 `lastActiveAt` 写回 store(`SaveSession` 取 `maxTime`,`sqlite_store.go:444`);随后 recorder 在 usage update 时发布携带该时间的 `session.updated`(`session_recorder.go:482`),前端 merge 后重排,导致流式期间列表持续跳动。目标:让 `updatedAt` 恢复"最后一次 prompt start/done"语义,中间 turn 不再触发重排;同时修正 Recent Sessions 同 project 内的排序,并整体删除右键/长按 quick-switch 弹出菜单。

## 决策

- **Q:修复层选哪个?** A:服务端修 `LastActiveAt` 语义,前端只加排序稳定化小补丁。一处修复、所有客户端受益。
- **Q:compact 操作算不算"活跃"?** 不算。只有 session 创建、prompt start、prompt done 推进 `updatedAt`;`RecordSessionOperation` 不再 bump(`session_recorder.go:301` 去掉)。
- **Q:`updatedAt` 语义传导到折叠/归档/age 展示,接受吗?** 接受。"更早会话"折叠(>5 天)、批量归档候选、列表 "x 分钟前" 展示全部变为"最后一次 prompt"口径。
- **Q:Suspended 驱逐会受长 prompt 影响吗?** 不会。驱逐只针对 `SessionSuspended` 状态(`client.go:1421`),运行中的 session 是 Active;且内存版 `sess.lastActiveAt` 保持每 turn 推进不变,只断开它回写 store 的路径。
- **Q:Recent Sessions 同 project 内排序、unread/running 优先级怎么处理?** 优先级只影响"能不能进 top 8"的选取;进了之后同 project 内纯按 `updatedAt` 降序。section 顺序仍按 project 列表顺序。
- **Q:右键/长按 quick-switch 菜单?** PC 和移动端整体删除,只保留常驻 Recent Sessions 列表。菜单内的"新建 session"入口随之消失(主 session 列表已有新建能力)。

## 架构

改动横跨 server 和 app 两层,协议不变(不新增/修改字段,只修正既有字段的服务端语义):

**Server(`server/internal/hub/client/`)**
- `session.go`:`toRecord()` 生成的运行时快照不再携带推进后的 `LastActiveAt`(置零,交给 `SaveSession` 的 `maxTime` 保留 store 现值)。内存 `sess.lastActiveAt` 行为不变。
- `session_recorder.go`:`RecordSessionOperation` 移除对 `rec.LastActiveAt` 的更新;prompt start/done、session/new 路径不变。

**App(`app/web/src/`)**
- `WorkspaceApp.tsx` / `chat/session/chatIndexState.ts`:`mergeChatSession` / `mergeChatSessionList` 在 `updatedAt` 未变化时保持 session 原位,只有排序键真正变化才重排。
- `chat/mobileChatQuickSwitch.ts`:Recent Sessions 分组后同 project 内按 `updatedAt` 降序重排;删除 `buildMobileChatQuickSwitchSections` 及相关类型。
- 删除 quick-switch 菜单:`chat/ChatQuickSwitchMenu.tsx`、`shell/layouts/desktop/chatQuickSwitchContextMenu.ts`、`WorkspaceApp.tsx` 中的触发(`chat-block` 的 `onContextMenu`)、state/handlers/render 站点、相关 CSS。

## 流程

修复后的排序数据流:

1. prompt start → recorder `upsertSessionProjection` 推进 `LastActiveAt` → 发布 `session.updated` → 前端重排(session 上移)。
2. 流式中间 turn(agent message / tool call / usage update)→ 快照持久化不再推进 store `LastActiveAt` → 后续 `session.updated` 的 `updatedAt` 不变 → 前端保持原位不重排。
3. prompt done → recorder 推进 `LastActiveAt` 为完成时间 → 发布 `session.updated` → 前端重排。
4. 初始加载 / 刷新:`session.list` 返回的 `updatedAt` 同样是"最后一次 prompt start/done"口径,与 live 行为一致。

## 验收标准

- 一个 session 流式输出期间,其 `updatedAt` 保持不变;session 列表不因中间 turn/usage 事件重排。
- prompt start 时 session 按开始时间上移;prompt done 时按完成时间定格。
- compact 操作(start/complete)不改变 session 排序位置。
- 重启/刷新后列表顺序与流式期间一致(同一口径)。
- Recent Sessions:同 project 内 sessions 严格按 `updatedAt` 降序;unread/running 仅影响 top 8 选取。
- chat 区域右键(PC)/长按(移动)不再弹出 quick-switch 菜单;Recent Sessions 列表功能完整保留。
- "更早会话"折叠、批量归档、age 展示按新语义工作,无回归。

### 测试

- Server:更新 `client_test.go` 中与 `LastActiveAt`/`UpdatedAt` 相关的断言(usage 更新不再推进、compact 不再推进、prompt start/done 仍推进);新增覆盖"usage update 后 summary `UpdatedAt` 不变"的用例,合并进现有测试文件。
- App:更新/删除 quick-switch 相关测试(`web-desktop-chat-quick-switch-context-menu.test.ts`、`web-mobile-chat-quick-switch.test.ts`、`web-mobile-chat-quick-switch-ui.test.ts`);为"同 project 内按时间排"和"updatedAt 未变保持原位"补用例,优先合并进现有测试文件。
- 不测:纯 CSS 删除、组件内部渲染细节。

## 范围之外

- 协议版本变更(本次不改协议字段,不动 protocol version)。
- IM 适配器侧的排序行为(消费同一 `updatedAt`,自然受益,无需改动)。
- archive manifest 的 `UpdatedAt` 字段语义单独调整(跟随 `LastActiveAt` 自然变化,不额外处理)。
- `mobileChatQuickSwitch.ts` 文件改名(保留现名,避免无关 churn)。
