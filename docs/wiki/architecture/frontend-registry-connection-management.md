> 摘要：本页维护 Web、Desktop、APK 共用的 Registry WebSocket 连接管理、静默重连、消息生命周期和状态恢复约定。

# Frontend Registry Connection Management

## 范围

本页只描述 Registry WebSocket。Android WebMessage bridge 和 Android 原生 Doubao speech WebSocket 使用各自的生命周期，不属于本连接管理层。

Web、Desktop、APK 共用一个前端 RegistryConnectionManager。平台代码只发送 pause、resume 和 keepAlive 生命周期提示，不自行创建 WebSocket、不自行重连。

## 连接状态

物理 WebSocket 状态由管理层隐藏；上层使用逻辑状态：

connecting → recovering → ready；ready 断线后进入 reconnecting，再回到 recovering。

后台或离线进入 paused，认证失效进入 auth_required，主动关闭进入 stopped。只有项目、Hub、当前活跃聊天和终端完成权威恢复后才进入 ready。

预期断线静默处理。上层不需要监听 WebSocket close、实现重试计时器或捕获底层连接异常。

## 消息语义

- 业务 request 不设置业务 timeout。
- 已发送 request 只属于当前连接代次；连接断开时直接中断，不重发、不跨连接保存。
- Repository 在统一边界消费预期的 ConnectionInterruptedError，业务模块不重复处理连接异常。
- 非 ready 时的新 request 返回 not-ready，新 event 不排队。
- 当前连接中无匹配 request 的 response、旧连接 response 和已完成 request 的 response 直接丢弃。
- 合法服务端 event 在 recovering 期间也立即转发；业务 store 使用 snapshot、revision、turnIndex 或 seq 去重和补齐。
- 连接层不缓存业务 event，不伪造副作用 request 成功。

## 心跳与重连

服务端使用原生 WebSocket Ping/Pong 并删除 Registry 业务 idle close。浏览器无法主动发送原生 Ping，因此前端在无入站 frame 时使用连接层专用 connect.ping 做技术探活。心跳异常只触发状态机重连，不暴露为业务错误。

网络异常、半开连接和服务端异常关闭由单一管理层无限重试，使用指数退避和随机抖动。后台暂停重连，回到前台立即检查；认证失败等待认证恢复。

## 恢复

每次新连接都有新的 connection epoch。旧 epoch 的回调和 response 无效。新 epoch 完成握手后进入 recovering：

1. 获取 Registry 项目和 Hub 权威快照。
2. 重建当前活跃聊天和终端运行态。
3. 使用聊天 read-repair、终端 snapshot/seq 和业务 revision 处理恢复期间事件。
4. 上层调用 completeRecovery 后进入 ready。

非活跃会话按需恢复。恢复不会重放旧 request，也不要求重新下载全部历史。

## 诊断

前端使用 app diagnostics 的 connection 类别记录状态变化、重连失败、握手/恢复失败、异常关闭、心跳超时和 request 中断。正常 Ping/Pong、普通消息收发和消息正文不记录。

## 设计来源

- [Registry WebSocket 连接管理重构方案](../../scope/2026-08-15-registry-connection-management.md)
- [Registry 2.7 协议](../protocols/registry.md)
- [Session 管理与同步](session-management-and-sync.md)
