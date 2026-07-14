> 由 scope skill 于 2026-07-14 生成

# Unified Registry WebSocket Message Limit

## 目标

Registry 当前同时维护普通 JSON payload、envelope、speech chunk、session read 和最大 wire message 等多组传输层限制。这些限制会因 Base64 膨胀或新方法未被列入例外而意外拒绝正常消息。本次将 Registry WebSocket 传输层收敛为单一的 16 MiB 整条消息上限，降低新功能接入和维护成本，同时保留防止异常输入无界占用内存的硬性边界。

## 决策

- Registry WebSocket 的 request、response 和 event 统一使用 `16 * 1024 * 1024` 字节的完整 wire message 上限。
- 传输层不再单独检查 JSON payload 大小、envelope 大小，也不再按 method 为 speech chunk 或 session read 分配不同上限。
- WebSocket 读限制和 JSON 解码前的长度校验共享同一个常量，避免两层边界漂移。
- 超过上限的消息仍按现有 `payload_too_large` / WebSocket close 路径拒绝；不改变认证、路由、错误响应或日志脱敏行为。
- 业务层大小校验保持不变，包括附件总大小、附件单分片解码后大小、语音数据和 terminal event 等语义级限制。
- HTTP 登录等非 WebSocket 入口继续使用自身的 body 限制，不纳入本次统一。
- 附件上传仍使用 Hub 声明的 1 MiB 原始分片；Base64 和 JSON 封装后的约 1.4 MiB 消息可在统一上限内通过。

## 流程

Registry 接收 WebSocket frame 时先由 WebSocket reader 以 16 MiB 限制完整消息，然后在 JSON 解码前对实际字节数执行同一边界校验。消息通过传输层后，各 Hub 或 Registry service 继续执行现有的业务语义校验。

## 验收标准

- 任意 Registry WebSocket method 的完整消息在 16 MiB 及以下时通过传输层大小校验。
- 完整消息超过 16 MiB 时在 JSON 路由和业务处理前被拒绝。
- 不再存在基于 method 的 Registry WebSocket 传输层大小例外。
- 1 MiB 原始附件分片经 Base64 和 JSON 封装后可通过 Registry 并到达 Hub。
- 现有 HTTP body 限制和 Hub 业务级大小校验不受影响。

### 测试

- 用 Registry 单元测试覆盖 16 MiB 下一字节、精确 16 MiB 和超出一字节的边界。
- 用 WebSocket 集成测试验证普通 method 可接收大于旧 1 MiB 上限的合法消息。
- 用附件分片回归测试覆盖 1 MiB 原始数据完整编码后的 Registry 转发路径。
- 重跑 Registry 包测试和服务端完整 Go 测试。

## 范围之外

- 不调整附件 50 MiB 总大小或 1 MiB 分片大小。
- 不将 Registry WebSocket 改为 binary frame 或 HTTP 文件流。
- 不解决超过约 12 MiB 原始内容时 `session.attachment.read` 一次性 Base64 响应会超过 16 MiB 的问题；该路径需要后续独立改为分片读取或文件流。
