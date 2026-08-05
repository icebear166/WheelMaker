> 摘要：本目录维护 WheelMaker 系统架构、组件职责、运行时边界以及 Session 生命周期与同步机制。

# Architecture

## 页面

- [`hub-state.md`](hub-state.md)：Hub 运行态 Section 的所有权、原子更新、同步触发和前端消费边界。
- [`gateway.md`](gateway.md)：Gateway 的宿主机级入口、站点配置、TLS 和运行时边界。
- [`server-runtime.md`](server-runtime.md)：App-only Session 运行时架构、组件职责和生命周期边界。
- [`session-management-and-sync.md`](session-management-and-sync.md)：Session 数据模型、Turn 语义、持久化、同步和归档机制。

本目录记录已经实施并仍然有效的架构事实，以及已批准进入实施的稳定架构决策；尚在评审的设计保留在来源或 scope 文档中。
