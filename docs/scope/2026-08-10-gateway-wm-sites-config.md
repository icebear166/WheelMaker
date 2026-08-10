> 由 scope skill 于 2026-08-10 生成
> 状态：已批准 2026-08-10

# Gateway `wm_sites` 配置聚合

## 目标

当前 `~/.wheelmaker/gateway/config.json` 把 Registry、Release 和 Share 分成三个顶层
section，并为三个站点分别保存 TLS。Registry 与 Share section 除 TLS 外不承载 Gateway
专属参数，结构重复且没有体现三者都是同一 Gateway 入口集合。本项目把三个入口聚合到
`wm_sites`，统一 TLS，并把配置 schema 升级为 2；Hub 业务地址、Release 运行参数和现有
热加载边界保持不变。

## 决策

1. Gateway 配置只接受 `schema: 2`。不实现 schema 1 迁移、兼容解析或自动覆盖；读取到
   schema 1 时返回明确错误并保持原文件不变。
2. `wm_sites` 是对象，固定包含共享 `tls` 以及 `registry`、`release`、`share` 三个站点
   字段，不使用站点数组。
3. `wm_sites.registry` 与 `wm_sites.share` 的 canonical 形状分别为
   `{"urlMode":"sync_hub"}`。`urlMode` 缺失时按 `sync_hub` 默认化；当前只接受
   `sync_hub`，其他值拒绝。
4. Registry 的 `sync_hub` 从 Hub 顶层 `publicUrl` 读取地址，并继续受
   `registry.listen: true` 门控；Share 的 `sync_hub` 从 Hub
   `registry.share.publicUrl` 读取地址。两个站点不在 Gateway 配置中保存独立
   `publicUrl`。
5. `wm_sites.release` 保存现有 `publicUrl`、`listen`、`dataRoot` 和 `tokenSha256`。
   Release Server 部署和运行时改为读写该嵌套位置。
6. `wm_sites.tls` 是 Registry、Release 和 Share 共用的唯一 TLS 文件配置，不提供
   per-site override。证书和私钥均为空时，HTTPS 站点继续使用顶层 `acme.email` 与
   Caddy 自动证书；显式证书必须覆盖所有使用它的站点 hostname。
7. Gateway 继续同时读取 Hub 主配置与 Gateway 专属配置，并由 Gateway 单独热加载。
   Hub 和 Registry 不新增配置 watcher，Registry Share 请求边界读取行为不变。
8. 不修改 Hub 配置、Registry protocol version、Share 链接语义、Gateway 服务生命周期
   或 secret 所有权。

## 架构

`~/.wheelmaker/gateway/config.json` 的 canonical 形状为：

```json
{
  "schema": 2,
  "acme": {
    "email": ""
  },
  "wm_sites": {
    "tls": {
      "certificateFile": "",
      "keyFile": ""
    },
    "registry": {
      "urlMode": "sync_hub"
    },
    "release": {
      "publicUrl": "",
      "listen": "127.0.0.1:9680",
      "dataRoot": "/absolute/path/.wheelmaker/release-server/data",
      "tokenSha256": ""
    },
    "share": {
      "urlMode": "sync_hub"
    }
  }
}
```

Gateway 解析该文件后，把三个 `wm_sites` 字段与 Hub 主配置聚合为现有运行时
`[]SiteConfig`。Registry 和 Share 的地址来自 Hub，Release 的地址及运行参数来自
`wm_sites.release`，三个运行时站点都获得同一份 `wm_sites.tls`。Caddy 编译层继续按
站点类型生成 Registry 反代与静态资源、Release 反代、Share 静态路由。

## 流程

1. 新安装生成 schema 2 配置，并写入三个站点字段、默认 `sync_hub` 和共享空 TLS。
2. Gateway 启动或轮询到配置变化时，严格解析 schema 2；schema 1、未知字段、未知
   `urlMode` 或无效共享 TLS 会使新配置被拒绝，上一份有效运行配置继续服务。
3. Gateway 根据两个 `sync_hub` 字段读取 Hub 地址，根据 `wm_sites.release.publicUrl`
   读取 Release 地址；非空合法地址生成相应站点。
4. 每个 HTTPS 站点统一使用 `wm_sites.tls`。共享 TLS 为空时按站点 hostname 交给 ACME；
   非空时把同一证书和私钥加载给三个 HTTPS 站点。
5. Release Server 部署只更新 `wm_sites.release` 中由发布流程管理的字段，保留共享 TLS、
   ACME、Registry/Share 模式和其余 Release 参数。

## 验收标准

- 新生成与规范化后的 Gateway 配置使用 `schema: 2`，只包含顶层 `schema`、`acme` 和
  `wm_sites`；不再生成顶层 `registry`、`release` 或 `share`。
- `wm_sites` 始终输出共享 `tls`、`registry`、`release`、`share`；Registry 和 Share
  始终输出 `urlMode: "sync_hub"`。
- schema 2 输入省略 Registry 或 Share 的 `urlMode` 时按 `sync_hub` 运行并规范化输出；
  非 `sync_hub` 值严格拒绝。
- schema 1 配置严格拒绝且文件内容不变；代码库不提供 schema 1 到 schema 2 的迁移或
  自动覆盖路径。
- Registry 仍只在 Hub `registry.listen: true` 且顶层 `publicUrl` 合法非空时生成路由；
  Share 仍根据 Hub `registry.share.publicUrl` 生成路由。
- Release Server 和 Release 部署使用 `wm_sites.release`，保留现有 loopback 地址、绝对
  数据目录和 Token SHA-256 校验。
- 三类 HTTPS 站点使用同一份 `wm_sites.tls`；配置中不存在 per-site TLS。空 TLS 继续
  使用 ACME，证书/私钥只配置一项或路径无效时拒绝新配置。
- Gateway 继续监听 Hub 与自身配置并热加载；Hub、Registry、Relay、Share 存储和
  Registry wire protocol 的生命周期与行为不变。
- 四个已确认 Wiki 页面与 schema 2 配置所有权和路径保持一致。

### 测试

- Gateway Go 测试覆盖 schema 2 严格解析、`wm_sites` 默认值、未知 `urlMode`、共享 TLS
  应用、Hub URL 聚合、Release-only 主机及双配置 fingerprint/hot-load。
- Gateway Go 负向测试覆盖 schema 1、旧顶层站点 section、per-site TLS、无效共享 TLS
  和重复 hostname，确认无效更新保留上一份有效 Caddy 配置。
- Release Server 与命令入口测试覆盖从 `wm_sites.release` 读取完整运行参数。
- Node deploy 测试覆盖 schema 2 默认文件、严格校验、Release 嵌套更新、schema 1
  原样拒绝以及部署失败时不改写配置。
- 不新增 Hub Config API、前端设置或 Registry wire 测试。

## 范围之外

- 不迁移、修复、备份或覆盖 schema 1 Gateway 配置。
- 不支持 `urlMode: "manual"` 或 Registry/Share 独立 `publicUrl`。
- 不支持站点数组、动态站点类型、per-site TLS 或单站点 TLS override。
- 不改变 Hub `config.json` 的字段、Registry/Share 地址事实源或 Release channel。
- 不修改 Hub/Registry 热加载、Registry protocol version、认证模型、Share token 与存储
  语义、DNS、证书签发策略、防火墙、NAT 或 Nginx 边界。
