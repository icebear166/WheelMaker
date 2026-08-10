> 由 scope skill 于 2026-08-10 生成
> 状态：已批准 2026-08-10

# Hub、Registry 与 Gateway 配置统一

## 目标

当前本机业务配置分散在 `~/.wheelmaker/config.json` 与
`~/.wheelmaker/gateway/config.json`：Hub/Registry 已经使用前者的
`publicUrl`、Relay 和 Share 配置，而 Gateway 又维护重复的 Registry/Share 公网地址与
Relay 端口，导致同一宿主机存在多份可能不一致的事实源。本项目统一本机业务配置的
共享部分到 Hub 主配置，让 Hub、Registry 和 Gateway 使用一致的 Registry/Workspace
origin、Share origin、Relay 端口和日志级别，同时保留 Gateway/Release-only 所需的
专属配置。

## 决策

1. `~/.wheelmaker/config.json` 是本机业务共享配置的唯一事实源；不新增 Hub Config API
   来编辑这些字段，仍由部署器或运维者维护。
2. 顶层 `publicUrl` 同时作为 Hub 连接 Registry 的 origin，以及本机 Registry owner
   场景下 Gateway 的 Registry 路由 origin。只有 `registry.listen: true` 时，Gateway
   才从该地址生成本机 Registry 路由；远程 Worker 的 `publicUrl` 仅用于连接远程
   Registry，不生成本地 Registry 路由。
3. Share 配置归入 `registry.share.publicUrl`。Registry 用它生成 Share 链接，Gateway
   用它生成 Share 静态路由。
4. `registry.relayPort` 是本机 Registry 与 Gateway 共享的固定 Relay 端口；为 `0` 时
   使用 client-managed standalone 模式。
5. `log.level` 归入 Hub 主配置，Hub、Registry 和本机 Gateway 读取同一值。Gateway
   的独立配置不再保存自己的日志级别；没有 Hub 主配置的 Release-only Gateway 使用
   Gateway runtime 默认日志级别，不新增第二份 `log.level`。
6. Gateway 配置删除重复的 `registry.publicUrl`、`share.publicUrl` 和
   `relay.listenPort`；保留 ACME、各路由 TLS、Release Server 运行参数和 Gateway
   schema 这些 Gateway 专属字段。
7. `release.publicUrl`、`release.listen`、`release.dataRoot`、`release.tokenSha256`
   及 Release TLS 继续归 Gateway 配置；Release Server 部署仍只更新 Gateway 的
   `release` section，以支持无 Hub 的 Release-only 主机。
8. 只有 Gateway 增加双配置热加载：同时监听 Hub 主配置与 Gateway 专属配置，合法变化
   重新编译并热加载 Caddy。Hub 和 Registry 不新增配置文件 watcher，主配置变化按
   现有启动/重启边界生效。
9. Registry 保留现有 Share 的请求边界读取行为：`share.create` 与 `share.list` 每次
   读取并校验 `registry.share.publicUrl`；这不是通用的 Registry 配置热加载。其他
   Hub/Registry 运行配置修改后需要按现有 runtime 流程重启。
10. 旧的顶层 `share` 以及 Gateway 配置中的重复 Registry/Share/Relay 字段只作为迁移
    输入，不再作为运行时第二事实源；迁移不得丢失有效的 canonical 值。
11. 不修改 Registry protocol version，不新增配置 wire 方法，不改变现有 secret、
    `hub-config.json` 或 `server-data.json` 的所有权。

## 架构

Hub 主配置的 canonical 形状为：

```json
{
  "publicUrl": "https://wheelmaker.example.com",
  "token": "<shared-registry-token>",
  "hubId": "hub-a",
  "projects": [],
  "log": {"level": "warn"},
  "registry": {
    "listen": true,
    "port": 9630,
    "relayPort": 28810,
    "share": {
      "publicUrl": "https://share.example.com"
    }
  }
}
```

Gateway 专属配置保留在 `~/.wheelmaker/gateway/config.json`，其 Registry 与 Share
section 只承载 TLS 边缘参数，不再承载公网 URL；Release section 继续完整承载
Release Server 的地址、loopback 运行参数、数据根、发布 Token 摘要和 TLS。Gateway
通过自己的 `--home` 推导父目录下的 Hub 主配置与共享静态目录。

其他配置边界保持不变：`db/hub-config.json` 继续保存 Hub API Key、Flicker Bridge
和 DeepSeek 平台 token；`db/server-data.json` 继续保存 Registry 入口机的语音、TTS
和 DeepSeek 服务配置；发布器本地 Token 文件不成为运行时配置。

## 流程

### Gateway 启动与热加载

1. Gateway 启动时读取 Hub 主配置和 Gateway 专属配置。
2. 当 Hub `registry.listen` 为 `true` 且顶层 `publicUrl` 非空时，Gateway 派生
   Registry Web/`/ws` 路由；当其为 `false` 时不派生本机 Registry 路由。
3. Gateway 从 `registry.share.publicUrl` 派生 Share 路由，从 `registry.relayPort`
   派生固定 Relay edge listener。
4. Hub 主配置或 Gateway 配置发生变化后，Gateway 重新校验并编译完整 Caddy 配置。
   合法变化热加载；无效的 Registry/Share 派生配置只禁用受影响路由，Release 路由
   继续使用上一份有效的 Gateway 专属配置。

### Hub 与 Registry 运行

Hub 启动时从顶层 `publicUrl` 建立 Reporter 连接，从 `registry.listen/port` 决定
本机 Registry worker 与 loopback endpoint，并从 `token`、`hubId` 和 `log.level` 初始化
运行时。Hub 不监听主配置变化。

Registry worker 启动时从同一份主配置读取认证 token、监听端口、Relay 端口和日志级别。
Registry 不读取 Gateway 配置。Share 请求在 `share.create` 与 `share.list` 边界重新读取
`registry.share.publicUrl`，因此 Share 链接域名和启停继续沿用当前请求边界语义；其他
运行配置变化需要重启对应 runtime。

### 配置迁移

启动/部署迁移把旧顶层 `share` 移到 `registry.share`，并停止使用 Gateway 配置中的
Registry/Share 公网地址和 Relay 端口。若新旧 Share 字段同时存在，以
`registry.share.publicUrl` 为准；Gateway 重复字段不得覆盖 Hub canonical 值。迁移后的
运行时只读取新的 Hub 位置。Gateway 配置中的 TLS 和 Release 字段必须在迁移中保留，
Release Server 的 `release.publicUrl` 不迁移到 Hub。Release-only Gateway 没有 Hub 主
配置时，只提供 Gateway 配置中定义的 Release 路由。

## 验收标准

- 新生成的 Hub `config.json` 只在 `registry.share.publicUrl` 保存 Share origin，且
  `registry.relayPort` 是固定 Relay 端口唯一业务配置来源。
- Gateway 不再把 `registry.publicUrl`、`share.publicUrl` 或 `relay.listenPort` 作为
  独立公网/Relay事实源；本机 Hub 场景使用 Hub 主配置派生这些值。
- 本机 `registry.listen: true` 时，顶层 `publicUrl` 同时能驱动 Hub Reporter 和
  Gateway Registry route；`listen: false` 的远程 Worker 不会在本机生成该 route。
- Registry `share.create/list` 使用 `registry.share.publicUrl` 返回启用状态和链接；
  清空、替换或恢复该字段时，下一次请求得到对应结果，且不读取 Gateway 配置。
- Gateway 同时监听两份配置：Hub 共享字段、Share route、Relay route、日志级别或
  Gateway TLS/Release 字段变化可热加载；无效共享字段不会下线有效 Release route。
- Hub 与 Registry 不创建配置 watcher；修改 `publicUrl`、Registry listener/port、
  Relay 端口或其日志级别后，按现有 runtime 重启流程生效。
- Release Server 仍从 Gateway `release` section 读取运行配置，Release-only 主机不
  需要 Hub 配置；Release 部署仍只更新该 section。
- 旧顶层 `share` 与 Gateway 重复字段迁移后不丢失有效配置；运行时不存在两份并行
  的 Registry/Share/Relay 公网事实源。
- `hub-config.json`、`server-data.json`、发布 Token、浏览器认证和 Registry wire
  payload 的所有权与结构保持不变，Registry protocol version 不变。

### 测试

- Go shared config 测试覆盖 canonical `registry.share`、旧顶层 `share` 迁移、重复
  字段优先级、严格解析和原子失败保护。
- Gateway Go 测试覆盖父目录 Hub 配置读取、`registry.listen` 路由门控、Share/Relay
  派生、双文件 fingerprint/hot-load、无效共享配置的路由隔离和 Gateway 专属 TLS/
  Release 保留。
- Registry Go 测试覆盖嵌套 Share 配置、每次 `share.create/list` 读取、Gateway 配置
  不参与 Share 判定，以及配置缺失/非法时的现有 fail-closed 行为。
- Relay/Registry 测试覆盖 `registry.relayPort` 的固定端口语义、`0` 的 standalone
  fallback 和 Gateway/Registry 配置不再分叉。
- Node deploy 测试覆盖新配置形状、既有 Hub/Gateway 配置保留与迁移、Release section
  独立更新，以及 Gateway 配置不再生成重复 Registry/Share/Relay 字段。
- 不新增 protocol version、Hub Config API 或前端配置编辑测试。

## 范围之外

- 不为主配置新增 `hub.config.get/update` 或 Settings 编辑入口。
- 不让 Hub 或 Registry 监听配置文件，不实现 Hub Reporter 动态迁移 Registry 连接、
  Registry 动态重绑定监听端口或全局日志热切换。
- 不把 Release Server 的公网地址、TLS、ACME、数据根、发布 Token 摘要迁移到 Hub
  配置。
- 不迁移 `db/hub-config.json`、`db/server-data.json`、发布器 Token 或第三方 secret。
- 不改变 Gateway 安装、升级、服务生命周期、DNS、证书申请、防火墙、NAT 或 Nginx
  边界。
- 不修改 Registry protocol version、认证模型、Share token/存储/到期语义或公开路由
  的响应头合同。
