# @agentclientprotocol/claude-agent-acp

> WheelMaker 角色：Claude、`cc-*` provider 共用的 ACP adapter；启动入口为 `claude-agent-acp`。
>
> 研究方式：官方 GitHub release、tag 和对应提交；首次记录 0.62.0–0.69.0。

## 0.69.0

### 新增

- 向 AIR 报告会话产生的 changed files。

### WheelMaker integration

- 结论：需回归验证。
- changed-files 属于 ACP 会话结果元数据，需验证 WheelMaker 的文件变更摘要、session/update 事件和正常 prompt 流程仍能同时工作；安装包入口没有变化，不需要调整 npm 安装命令。

## 0.68.0

### 修改

- 将 typed session failures 与 AIR 的失败表示对齐。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 依赖 ACP 错误分类和会话生命周期状态；应覆盖启动失败、prompt 失败、取消和恢复，确认新的失败类型不会被当成普通文本或丢失。

## 0.67.0

### 新增

- 更新 Claude Agent SDK 至 0.3.232。
- 暴露 typed session failures、模型 fallback warning advisory、解析后的模型名称和带 name/kind 的 Skill tool call 元数据。

### 修复

- 跨 prompt 保留 task plan，并在 Claude 准备文件时显示 pending title。

### WheelMaker integration

- 结论：需回归验证。
- SDK 和 ACP 元数据同时变化，重点验证 `configOptions` 的模型/effort 展示、Skill 调用渲染、计划状态跨 prompt 保留，以及 `cc-*` provider 的 endpoint、模型和隔离 `CLAUDE_CONFIG_DIR` 注入。

## 0.66.0

### 新增

- 暴露 provider-neutral ACP goal extension。

### 修复

- 更可靠地发布和替换 Claude goals。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 当前对 Claude goals 有 capability 和生命周期判断；需验证 goal 事件不会改变现有 plan/steer 映射，也不会让不支持的能力被错误发布。

## 0.65.0

### 修改

- 更新 `@hono/node-server`、`fast-uri`、`nanoid`、`tinyexec` 等依赖。
- steering turn 改为在 idle 时结算，而不是在 interrupt 时结算。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 的 native steering、取消和 turn 完成通知依赖结算时序；需验证连续 steer、interrupt 后恢复和 `cc-flicker` 本地 bridge 场景。Node 运行时仍需满足 adapter 的 Node 22 要求。

## 0.64.2

### 修复

- 恢复 `ExitPlanMode` 的 single-tool 表示。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 会把无参数工具调用映射到 ACP 权限和结果事件；需验证计划退出不会被识别为多工具调用或产生重复结果。

## 0.64.1

### 修复

- 修复一次 release 版本发布问题。

### WheelMaker integration

- 结论：无需动作。
- 可见变化只涉及发布修正；仍应保持 `claude-agent-acp` 可执行文件的常规启动检查。

## 0.64.0

### 修改

- 更新依赖组。

### 修复

- steering 增加 opt-in 的 host-owned fallback。

### WheelMaker integration

- 结论：需回归验证。
- 需要验证 WheelMaker 的 owned ACP process 是否仍按 provider 选择正确的 steering 路径，尤其是 interrupt、空闲收尾和 fallback 发生时的 session/update 顺序。

## 0.63.0

### 修改

- 更新 Claude Agent SDK 至 0.3.220。

### 修复

- 只解析客户端已获知的 denied tool call。
- 将 tool_progress heartbeat 归到对应工具调用，并修正 Bash terminal metadata 的 tool_use id 关联。

### WheelMaker integration

- 结论：需回归验证。
- 重点覆盖权限拒绝、工具进度、Bash 终端元数据和并行工具调用；这些字段直接进入 WheelMaker 的 ACP event/UI 状态。

## 0.62.0

### 修改

- 更新 Claude Agent SDK 至 0.3.218，并更新 HTTP/媒体相关依赖。

### WheelMaker integration

- 结论：需回归验证。
- 首次引入本记录范围，需在实际 Node 22 环境执行 `claude-agent-acp` initialize、session/new、prompt、cancel 和退出检查；npm 安装和 binary 名称无需调整。
