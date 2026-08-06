> 由 scope skill 于 2026-08-06 生成

# Hub 配置字段迁移与 Registry 地址标准化

## 目标

当前 Workspace 配置把 Hub 身份、Registry 认证凭据和 Registry 网络参数混在
`registry` 下：`token`、`hubId` 不是本机监听参数，`server` 又同时表示入口机的
本地 bind host 和 Worker 要连接的远程 Registry。目标是在不改变 Registry wire
protocol 的前提下，建立清晰的新配置契约，并让已有安装在 Hub 启动前自动、幂等地
迁移；同时把远程 Registry 地址统一保存为 HTTPS origin，避免旧的 `ws/wss`、
`http/https` 和 `/ws` 写法继续扩散。

## 决策

- 顶层身份与凭据字段统一为 `token`、`hubId`。
- `registry` 只保留 Registry 运行/连接参数：`listen`、`port`，以及 Worker
  连接远程 Registry 时使用的 `server`。
- 入口机的本地 `registry.server` 不再持久化；`listen: true` 时默认绑定
  `127.0.0.1`。Worker 的远程 `registry.server` 继续保留。
- 远程 `server` 的持久化格式统一为 HTTPS origin：
  `ws://`、`wss://`、`http://`、`https://` 均转换为 `https://`，去除末尾 `/ws`
  和 `/`。运行时再根据传输位置生成 `/ws` WebSocket endpoint。
- 本机回环 Registry 是例外：继续使用明文 HTTP/WS，避免把当前明文 loopback
  listener 错当成 TLS 服务。
- 旧配置与新配置同时存在时，顶层 `token`/`hubId` 优先；迁移无论旧值是否不同
  都直接删除 `registry.token`/`registry.hubId`，不阻塞启动、不回写旧字段。
- 迁移只移动已有值，不因为迁移自动生成新的 token 或 hub ID。缺少 token 继续由
  现有部署器生成或由运行时校验失败；缺少 hub ID 继续沿用现有 hostname fallback。
- `publicUrl`、项目配置、Hub Config、Registry wire payload 中的 `hubId` 语义不变。
- 不修改 Registry protocol version，不迁移 Release Server 配置，不在本次工作中
  安装、配置或控制 Gateway/Caddy。

## 架构

新的 Workspace 配置形状为：

```json
{
  "publicUrl": "https://wheelmaker.example.com",
  "token": "<shared-registry-token>",
  "hubId": "hub-a",
  "projects": [],
  "registry": {
    "listen": true,
    "port": 9630
  },
  "log": {
    "level": "warn"
  }
}
```

入口机不会保存 `registry.server`。Worker 配置可以包含：

```json
{
  "token": "<shared-registry-token>",
  "hubId": "hub-b",
  "registry": {
    "listen": false,
    "server": "https://machine-a.example.com:28800"
  }
}
```

配置迁移由共享配置层提供显式的启动前入口，不让纯读取的 `LoadConfig` 隐式产生
副作用。所有可能启动 Hub、Registry worker 或 guardian 的入口都必须先经过同一
迁移步骤；迁移使用同一用户可见的配置文件锁、临时文件和原子替换，确保并发启动
最多只有一个写入者，失败时保留原文件。

### 字段职责

- `token`：Registry 连接认证 token，由 Hub worker 和 Registry listener 读取。
- `hubId`：本机 Hub 稳定身份，由 Hub reporter、Terminal 和 HubState 使用。
- `registry.listen`：是否启动本机 Registry listener。
- `registry.port`：本机 listener 端口；保留现有默认 9630。
- `registry.server`：仅对 Worker 表示远程 Registry 地址；它是 HTTP(S) origin，
  不是 WebSocket URL，不包含 `/ws`。

### 地址标准化

迁移和新配置写入共享同一个标准化函数：

| 输入 | 远程规范化结果 | 回环规范化结果 |
| --- | --- | --- |
| `wss://host:28800/ws` | `https://host:28800` | 不适用 |
| `ws://host:28800/ws` | `https://host:28800` | `http://host:28800` |
| `http://host:28800/` | `https://host:28800` | `http://host:28800` |
| `https://host:28800/ws` | `https://host:28800` | `http://host:28800` |
| `host:28800` | `https://host:28800` | `http://host:28800` |

回环判定覆盖 `localhost`、`127.0.0.0/8` 和 `::1`。远程地址必须是干净的
origin；凭据、query、fragment、非 `/ws` 的路径和非法端口不自动猜测，迁移失败
并保留原配置。运行时把远程 `https` 转为 `wss`，把回环 `http` 转为 `ws`，并
追加单一 `/ws` 路径。

## 流程

```text
进程入口
  → 获得 config.json 单写锁
  → 读取原始 JSON
  → 识别旧 registry.token / registry.hubId
  → 顶层缺失时复制旧值
  → 删除旧 token/hubId
  → 按 listen/回环语义删除或标准化 registry.server
  → 原子写回并收紧权限
  → 释放锁
  → 通过纯 LoadConfig 解析新结构
  → 启动 Hub / Registry / guardian
```

迁移必须可重复执行：已是新结构时不改变字节语义，不重复生成凭据，不重写无关
配置。迁移失败必须阻止本次进程启动并给出字段、原因和恢复建议；不得留下半个
配置文件。部署器的 `ensureRuntimeConfig` 同步使用新字段布局，使新安装不再
生成旧的嵌套字段。

## 验收标准

- 新安装生成顶层 `token`、`hubId`，`registry` 中不出现旧身份字段。
- 旧安装启动一次后，`registry.token`/`registry.hubId` 被迁移并删除；再次启动
  不重复写入。
- 顶层与旧字段同时存在时保留顶层值，旧字段始终删除。
- 入口机本地 `registry.server` 被删除后仍监听 loopback；Worker 远程 server
  仍能连接 Registry。
- 远程旧 `ws/wss/http/https` 地址和 `/ws` 后缀都保存为 HTTPS origin；Hub
  运行时仍连接正确的 `wss://.../ws`。
- 本地 loopback 连接仍使用 `ws://127.0.0.1:9630/ws`，不要求本地 TLS。
- 非法 URL、非 `/ws` 路径、冲突端口或写入失败时原配置保持不变，进程不启动。
- guardian、Hub worker、Registry worker 并发启动时配置不会损坏，最终只有一份
  新结构配置。
- 配置文件权限继续使用现有私有权限策略；token 不进入普通日志或错误详情。
- Registry wire envelope 仍使用原有 `hubId`，客户端和 protocol version 无需升级。

### 测试

- Go shared config：新旧 schema 解析、迁移、字段删除、原子失败保留、权限和并发
  锁测试。
- Go command/Hub：三类启动入口都先迁移；入口机和 Worker 的 Registry 地址及
  token/hubId 传递测试。
- Go reporter：所有旧地址变体、回环例外、`/ws` 规范化和非法输入测试。
- Node deploy：新配置生成、旧配置兼容、token/hubId 顶层字段和 server 写入
  规则测试。
- 不测试协议字段改名，不测试 Gateway/Caddy 行为或 Release Server 配置。

## 范围之外

- 不改变浏览器登录 token、Provider API key 或 `hub-config.json` 的所有权。
- 不删除 wire message 中的 `hubId`，不把 Registry 认证 token 暴露给前端。
- 不让 `publicUrl` 替代 Worker 的远程 `registry.server`；两者继续表示不同地址。
- 不为本地 Registry listener 增加 TLS，也不修改 Nginx/Caddy 部署流程。
