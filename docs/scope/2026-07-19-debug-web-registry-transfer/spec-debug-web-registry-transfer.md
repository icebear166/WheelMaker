> 由 scope skill 于 2026-07-19 生成

# Debug Web Registry 直传

## 目标

临时 Debug Web 不再依赖 Release Server 的公开文件和下载链路。发布页面选择构建源码的 Target Hub 与最终承载页面的 Web Hub 后，Target Hub 在后台构建 ZIP，并经 Registry 将其直接传给 Web Hub；页面关闭不应中断已发起的任务。

## 决策

- Target Hub 是构建源码和产出 Web ZIP 的 Hub；Web Hub 是接收并应用该 ZIP 的独立 Hub。
- 临时 Debug Web 只经 Registry 在线传输，不上传或读取 Release Server，也不修改稳定版本、发布状态或公开发布物。
- Registry 不持久化 ZIP：它仅对在线的两个 Hub 做受控分块转发与确认。
- Web Hub 必须在线。它离线或传输中断时，任务失败；Target Hub 保留本次构建产物，供之后显式重试。
- Web Hub 在本地临时文件接收完毕后，校验声明的文件大小和 SHA-256，校验成功才原子替换其 `~/.wheelmaker/web` 目录。
- 正式版本发布、Release Server 和既有 Hub 发布通知流程不改变。

## 架构

```text
Web UI
  │ 发起后台任务、读取状态和日志
  ▼
Target Hub ──构建 ZIP、分块发送──► Registry ──在线转发──► Web Hub
                                                          │ 校验并原子应用
                                                          ▼
                                                ~/.wheelmaker/web
```

Target Hub 持久化发布任务、构建产物和日志；Registry 只维护本次在线传输的会话与分块确认，不保存归档；Web Hub 只在校验完成后替换当前 Web 目录。

## 流程

1. 用户在发布页面选择 Target Hub、Web Hub，发起“发布临时 Web”。
2. Target Hub 创建并持久化后台任务，构建 Web ZIP，计算大小和 SHA-256。
3. Target Hub 通过 Registry 创建以 Web Hub 为目标的传输会话，Registry 验证两个 Hub 都在线。
4. Target Hub 按受限大小分块发送；Registry 依序转发，Web Hub 写入临时文件并确认每个分块。
5. Target Hub 发送完成；Web Hub 校验大小与 SHA-256，解压/原子替换 Web 目录，并返回成功或明确失败码。
6. Target Hub 将传输和应用结果写入任务状态与日志；前端可在之后继续查询。

## 验收标准

- 临时 Debug Web 全流程不访问 Release Server，也不要求 Release Server 可用。
- Target Hub 和 Web Hub 在线时，构建结果能通过 Registry 到达 Web Hub，并仅在校验成功后应用。
- Registry 不在磁盘上保存传输 ZIP；协议分块始终小于现有 Registry 单消息限制。
- 任务在页面关闭后继续；前端重新打开时可读取最终状态和 Target Hub 日志。
- Web Hub 离线、断线、分块顺序错误、大小不符或 SHA-256 不符时，不替换现有 Web 目录，并返回可诊断失败状态。
- 正式版本发布和 Release Server Debug Web 以外的功能保持不变。

### 测试

- Go 协议/Registry 测试覆盖 Hub 身份、目标 Hub 路由、离线拒绝、分块大小、顺序和确认。
- Hub 测试覆盖 Target Hub 的任务持久化、传输失败保留构建产物，以及 Web Hub 的大小/摘要校验和原子应用。
- Web 单元测试覆盖传输目标选择、任务状态与日志展示。
- 现有正式版本发布与 Release Server 测试继续通过。

## 范围之外

- Registry 对离线 Web Hub 的 ZIP 排队、磁盘缓存或恢复传输。
- Debug Web 的历史版本、回滚和多版本托管。
- 改动正式版本发布的构建、上传、部署或 Release Server 运行方式。
