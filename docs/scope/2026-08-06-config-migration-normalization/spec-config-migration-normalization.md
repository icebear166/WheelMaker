> 由 scope skill 于 2026-08-06 生成

# Hub 配置字段迁移与 Registry 地址标准化

## 目标

当前 Workspace 配置把 Hub 身份、Registry 认证凭据和 Registry 网络参数混在
`registry` 下：`token`、`hubId` 不是本机监听参数，`server` 又同时表示入口机的
本地 bind host 和 Worker 要连接的远程 Registry。目标是在不改变 Registry wire
protocol 的前提下，建立清晰的新配置契约：配置了 `publicUrl` 时它是 Hub 连接
Registry 的唯一公网 origin；未配置时 Hub 使用本机 loopback Registry。`registry`
只描述本机 listener；已有安装在 Hub 启动前自动、幂等地迁移。迁移由 Go 运行时负责，
部署用 MJS 只提供新安装所需的 canonical 配置，并对已有配置保持向后兼容，避免旧
二进制回退时读到它不认识的新字段。

## 决策

- 顶层身份与凭据字段统一为 `token`、`hubId`。
- `registry` 只保留本机 Registry listener 参数：`listen`、`port`；不再持久化
  `registry.server`。
- `publicUrl` 是 Hub 连接 Registry 的唯一可配置公网地址。`listen: true` 时它同时
  是 Workspace 对外地址；`listen: false` 时它表示 Worker 要连接的 Registry 入口
  地址，不表示 Worker 自己对外提供站点。缺省时使用本机 loopback。
- Hub 运行时从 `publicUrl` 生成 Registry WebSocket endpoint；`publicUrl` 为空时
  使用 `ws://127.0.0.1:<registry.port>/ws`（端口缺省 9630），不再读取
  `registry.server`。入口 Registry listener 固定绑定 loopback，公网访问由
  Gateway/Nginx 代理到 `registry.port`。
- `publicUrl` 的持久化格式统一为 HTTPS origin：
  `ws://`、`wss://`、`http://`、`https://` 均转换为 `https://`，去除末尾 `/ws`
  和 `/`。运行时再根据传输位置生成 `/ws` WebSocket endpoint。
- 本机回环 Registry 是例外：继续使用明文 HTTP/WS，避免把当前明文 loopback
  listener 错当成 TLS 服务。
- Go 是既有配置迁移的唯一 owner。所有 Hub、Registry worker 和 guardian 入口在
  解析配置前调用显式迁移；迁移禁止交互、提示或等待用户输入；纯读取的 `LoadConfig`
  不产生副作用。
- MJS 不负责既有配置的迁移、删除旧字段或解释旧 `registry.server`：
  - 全新配置直接写顶层 `publicUrl`、`token`、`hubId` 和 canonical registry 形状。
  - 检测到既有配置时保持身份字段所在的旧/混合布局和旧 server 原文；只有用户
    明确提供新的 public URL 时才更新顶层 `publicUrl`，不在部署阶段从旧 server
    推导或删除字段。
  - 只有所有布局都缺少某个身份值时，才按已检测到的布局生成一个值，不复制已有
    值，也不生成第二套凭据。
  - Go 成功启动并完成迁移后，旧字段才会被删除。
- 旧配置与新配置同时存在时，迁移对每个字段按“非空顶层优先”处理：顶层值和旧值
  都是非空时保留顶层值；顶层为空而旧值非空时使用旧值；两者都为空时不生成新
  token，交给现有校验/hostname fallback 处理。迁移完成后删除旧字段。publicUrl
  与旧 server 同时存在且不一致时，自动保留 publicUrl 并删除旧 server，不等待
  用户选择。
- Go 迁移只移动已有值，不自动生成新的 token 或 hub ID。完全缺值时，MJS 可在
  部署阶段按既有布局补齐 token；hub ID 继续沿用现有 hostname fallback。
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

入口机不会保存 `registry.server`；Hub Reporter 使用 `publicUrl` 连接入口机的
`/ws`，未配置时使用本机 loopback。Worker 配置也使用入口机 `publicUrl`；若
Registry 与 Worker 同机且只走 loopback，可以省略 `publicUrl`：

```json
{
  "publicUrl": "https://machine-a.example.com:28800",
  "token": "<shared-registry-token>",
  "hubId": "hub-b",
  "registry": {
    "listen": false
  }
}
```

配置迁移由 Go 共享配置层提供显式的启动前入口，不让纯读取的 `LoadConfig` 隐式
产生副作用。所有可能启动 Hub、Registry worker 或 guardian 的入口都必须先经过
同一迁移步骤；迁移使用同一用户可见的配置文件锁、临时文件和原子替换，确保并发
启动最多只有一个写入者，失败时保留原文件。迁移第一次改写前保留一个同目录、
私有权限的 pre-migration 副本；新结构已成功加载后才可清理该副本。已有部署编排若需要启动旧二进制，必须先恢复该
副本，不能让旧二进制读取已迁移的新结构。本次工作不改变编排器既有的回退策略，
也不把自动降级作为新行为。

### 字段职责

- `publicUrl`：可选的 Hub 连接 Registry HTTP(S) origin；`listen: true` 时也是
  Workspace 对外 origin，`listen: false` 时是远程 Registry 入口 origin。省略时
  使用 `127.0.0.1:<registry.port>`。
- `token`：Registry 连接认证 token，由 Hub worker 和 Registry listener 读取。
- `hubId`：本机 Hub 稳定身份，由 Hub reporter、Terminal 和 HubState 使用。
- `registry.listen`：是否启动本机 Registry listener。
- `registry.port`：本机 listener 端口，也是省略 publicUrl 时的 loopback 连接端口；
  保留现有默认 9630。
- `registry.server`：删除，不再是配置契约的一部分。

### publicUrl 地址标准化

Go 迁移与 MJS 新配置写入遵循同一份 publicUrl 规范化契约和测试向量，各自实现，
不跨语言共享代码：

| 输入 | 远程主机结果 | 回环主机结果 |
| --- | --- | --- |
| `wss://host:28800/ws` | `https://host:28800` | `http://host:28800` |
| `ws://host:28800/ws` | `https://host:28800` | `http://host:28800` |
| `http://host:28800/` | `https://host:28800` | `http://host:28800` |
| `https://host:28800/ws` | `https://host:28800` | `http://host:28800` |
| `host:28800` | `https://host:28800` | `http://host:28800` |

回环判定覆盖 `localhost`、`127.0.0.0/8` 和 `::1`。publicUrl 必须是干净的
origin；凭据、query、fragment、非 `/ws` 的路径和非法端口不自动猜测，迁移失败
并保留原配置。运行时把远程 `https` 转为 `wss`，把回环 `http` 转为 `ws`，并
追加单一 `/ws` 路径。生产环境的非回环 publicUrl 必须使用 HTTPS；回环 HTTP 仅
供本地开发和显式测试覆盖使用。

旧配置迁移到 publicUrl 的规则如下：

- `listen: true` 时，旧 `registry.server` 只表示本机 listener bind host，直接
  删除，不从它推导 publicUrl；publicUrl 缺失时保留为空并自动使用 loopback。
  `registry.port` 保留为本机 listener 端口。
- `listen: false` 时，旧 `registry.server` 表示远程 Registry 入口：
  - 旧 server 为回环地址时，直接删除并保留 publicUrl 为空，自动使用本机 loopback；
  - 旧 server 为非回环地址且 publicUrl 缺失时，把旧 server（必要时使用旧
    `registry.port` 补齐无端口地址）自动迁移为 publicUrl；
  - publicUrl 已存在时始终保留 publicUrl，旧 server 无论是否一致都删除；
  - `registry.port` 始终保留为 loopback listener/默认连接端口，不再承担远程 URL
    的持久化语义。
- `listen: false` 且 publicUrl、旧 server 都缺失时，直接使用本机 loopback，不等待
  用户输入。
- 旧 server 非法且无法判断为回环或远程 origin 时，迁移失败并保留原文件；失败是
  非交互的确定性错误，不触发询问。

## 流程

```text
MJS 部署入口
  → 下载/替换运行时（既有 config.json 的身份与 `registry.server` 字段不改写）
  → 启动新 Go 运行时

Go 进程入口
  → 获得 config.json 单写锁
  → 读取原始 JSON
  → 校验并迁移 token/hubId、publicUrl、旧 server 和旧 port
  → 首次改写前保留 pre-migration 副本
  → 原子写回并收紧权限
  → 释放锁
  → 通过纯 LoadConfig 解析新结构
  → 启动 Hub / Registry / guardian

若启动编排在迁移后尝试旧二进制，必须先使用 pre-migration 副本恢复旧结构；否则
不得启动旧二进制。迁移失败、校验失败或写入失败均不替换原文件，进程不启动。
```

迁移必须可重复执行：已是新结构时不改变字节语义，不重复生成凭据，不重写无关
配置。迁移过程不得询问用户；所有可判定情况按上述规则自动处理。迁移失败必须阻止本次进程启动并给出字段、原因和恢复建议；不得留下半个
配置文件。部署器的 `ensureRuntimeConfig` 对全新安装使用新字段布局；对已存在
配置只做 schema-aware 的非身份维护，保留旧结构供 Go 迁移以及必要时的旧运行时
恢复。Hub runtime 只从 `publicUrl` 读取 Registry 连接地址；为空时使用约定的
loopback 默认值。

## 验收标准

- 新安装生成顶层 `token`、`hubId`，`registry` 中不出现旧身份字段。
- 新安装在配置公网入口时写入 canonical `publicUrl`；未配置时使用本机 loopback，
  不要求人为补填。
- 对既有旧或混合配置运行 MJS 部署不会删除/移动身份字段，也只保留旧 server
  原文；新 Go 运行时启动后才执行一次迁移。
- 旧安装启动一次后，`registry.token`/`registry.hubId` 被迁移并删除；再次启动
  不重复写入。
- 顶层与旧字段同时存在时按非空顶层优先；顶层为空而旧值有效时不丢凭据；迁移
  成功后旧字段始终删除。
- 入口机不再读取 `registry.server`，仍监听 loopback；入口 Hub 和 Worker 有
  `publicUrl` 时使用正确的 `wss://.../ws`，没有时自动使用 loopback。
- Worker 迁移旧 server 时，旧 `registry.port` 只用于补齐非回环无端口地址，迁移后
  仍保留为 loopback listener/默认连接端口。
- publicUrl 的旧 `ws/wss/http/https` 地址和 `/ws` 后缀都保存为 HTTPS origin；Hub
  运行时仍连接正确的 `wss://.../ws`，且不会静默降级到明文远程连接。
- 本地 loopback 连接仍使用 `ws://127.0.0.1:9630/ws`，不要求本地 TLS。
- 远程 TLS 是部署前置条件；旧 `ws/http` 配置迁移后若目标没有 HTTPS，运行时报告
  可定位的连接错误，不回退为明文。
- publicUrl 缺失且旧 server 为回环或不存在时自动使用 loopback；publicUrl 与旧
  server 冲突时自动保留 publicUrl；非法非回环 URL、非 `/ws` 路径或写入失败时原
  配置保持不变，进程不启动。
- 配置迁移后若编排需要恢复旧二进制，能先恢复 pre-migration 副本；不存在“旧
  二进制读取新 schema”的启动路径。
- guardian、Hub worker、Registry worker 并发启动时配置不会损坏，最终只有一份
  新结构配置。
- 配置文件权限继续使用现有私有权限策略；token 不进入普通日志或错误详情。
- Registry wire envelope 仍使用原有 `hubId`，客户端和 protocol version 无需升级。

### 测试

- Go shared config：新旧 schema 解析、迁移、字段删除、非空优先、publicUrl/server
  确定性优先级、旧端口折叠、loopback 默认、原子失败保留、pre-migration 副本、
  权限和并发锁测试；验证迁移路径不产生交互。
- Go command/Hub：三类启动入口都先迁移；入口机和 Worker 都从 publicUrl 生成
  Registry 地址，并验证 token/hubId 传递。
- Go reporter：publicUrl 的所有地址变体、回环例外、`/ws` 规范化和非法输入测试；
  不再覆盖 registry.server 运行时读取。
- Node deploy：新配置生成、既有旧/混合配置不改写、完全缺值时按原布局补值，以及
  与 Go 共享的规范化测试向量。
- 不测试协议字段改名，不测试 Gateway/Caddy 行为或 Release Server 配置。

## 范围之外

- 不改变浏览器登录 token、Provider API key 或 `hub-config.json` 的所有权。
- 不删除 wire message 中的 `hubId`，不把 Registry 认证 token 暴露给前端。
- `publicUrl` 统一表示 Hub 连接 Registry 的公网 origin；为空时统一使用 loopback；
  不再保留独立的 Worker `registry.server` 地址。
- 不为本地 Registry listener 增加 TLS，也不修改 Nginx/Caddy 部署流程。
- 不让 MJS 承担既有配置迁移、旧 server 删除、既有 publicUrl 标准化或自动回退旧二进制；
  这些行为由 Go 迁移层和现有部署编排边界负责。
