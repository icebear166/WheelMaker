# WheelMaker - Server

Go daemon bridging local AI CLIs (Codex, Claude) to Workspace App sessions through the Registry.

## 约定

- `acp.Conn` 只负责传输；Session/Client 负责会话和 agent 生命周期。
- Agent 子进程按需创建，不在启动时创建；会话输出经 Registry 的 `session.*` 事件同步。
- `state.json` 保存运行时状态，SQLite 保存会话持久化数据；Registry 是 App 对话的唯一同步通道。
- 运行配置位于 `~/.wheelmaker/config.json`、`~/.wheelmaker/state.json` 和 `~/.wheelmaker/db/hub-config.json`。
- 代码注释和标识符用英文；测试规则遵循根目录 `CLAUDE.md`。

## 文档

- 架构：[../docs/wiki/architecture/server-runtime.md](../docs/wiki/architecture/server-runtime.md)
- ACP：[../docs/wiki/protocols/acp.md](../docs/wiki/protocols/acp.md)
- Registry：[../docs/wiki/protocols/registry.md](../docs/wiki/protocols/registry.md)
