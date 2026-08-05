> 由 scope skill 于 2026-08-06 生成

# 发布、部署与 Gateway 简化

## 目标

让 WheelMaker Workspace 和 Release Server 的部署流程只描述业务服务自身，不再通过 `--gateway=none|caddy` 选择入口实现。业务部署始终保存服务器公开地址并生成可供内置 Gateway 消费的站点声明；是否安装内置 Caddy 由独立、幂等的 `gateway` 命令决定。未安装 Gateway 时，运维者可以用 Nginx 或其他反向代理接入同一业务服务。

同时修复本轮发布与部署迭代中已经确认的可靠性问题：Release Server 静态文件权限耦合、稳定指针提前提交、缺少公网发布冒烟检查、Gateway 首装失败残留服务、重复 hostname 静默遮蔽和非标准外部端口重定向错误。

## 核心决策

- **入口实现是否属于业务部署参数？** 不属于。删除 Workspace 和 Release Server 的 `--gateway=none|caddy`。
- **公开地址存在哪里？** 存在对应业务服务自己的 `config.json`，字段统一为 `publicUrl`。Gateway Home 的 `config.json` 仍只存宿主机级 ACME 和日志设置，不存站点域名。
- **Workspace 如何获得公开地址？** 已有 `~/.wheelmaker/config.json.publicUrl` 时复用；首次交互部署缺失时询问“WheelMaker server public URL”；首次非交互部署缺失时要求 `--public-url`。公开地址必须是仅含协议、host 和可选端口的 HTTP(S) origin。
- **站点配置何时写？** Workspace 完整部署和 `update` 均从业务配置重新生成 `~/.wheelmaker/gateway/sites/workspace.json`；Release Server 每次远程部署均生成 `release-server.json`。写站点文件不检查、不安装、不升级、不启停 Gateway。
- **旧 Workspace 如何升级？** `update` 遇到缺少 `publicUrl` 的旧配置时警告并跳过站点文件生成，但不阻断 Hub/Web 升级。下一次完整交互部署补齐地址。
- **Caddy 如何单独部署？** 只保留 `node deploy.mjs gateway`。它幂等地安装或升级 stable 指向的 Gateway、注册开机服务并确保运行。删除 `gateway-update`。
- **旧参数如何处理？** `--gateway` 和 `--gateway-public-url` 本次直接删除，不提供兼容别名；`--public-url` 是新的业务服务器参数。
- **Release Server 如何兼容 Nginx？** Release Server 自己匿名提供首页、部署脚本、元数据和发布产物。Caddy/Nginx 都把整个 origin 反向代理到 `127.0.0.1:9680`，不再直接读取 SSH 用户 Home 下的静态目录。
- **同一源提交能否重复发布？** 保持当前策略：同一 source SHA 不创建或补写第二个正式发布。

## 配置所有权

### Workspace

```text
~/.wheelmaker/
├─ config.json                         # Hub/Workspace 配置源，含 publicUrl
├─ web/                                # Workspace Web 根目录
└─ gateway/sites/workspace.json        # 从 config.json 派生
```

业务配置示例：

```json
{
  "publicUrl": "https://wheelmaker.top",
  "projects": [],
  "registry": {
    "listen": true,
    "port": 9630,
    "server": "127.0.0.1"
  }
}
```

`publicUrl` 是 WheelMaker 服务器公开 origin，不叫 Gateway URL，也不表示用户选择了 Caddy。Go Hub 配置解析器接受该字段；缺失值仅表示尚未完成入口配置，保持旧配置可读取。

### Release Server

```text
~/.wheelmaker/release-server/
├─ config.json                         # 含 publicUrl、listen、dataRoot、tokenSha256
├─ current/
├─ versions/
└─ data/public/                        # 只由 Release Server 进程读取

~/.wheelmaker/gateway/sites/
└─ release-server.json                 # 从 Release Server config.json 派生
```

Release Server 的 `publicUrl` 来自 `scripts/release/channel.json`。部署已有旧配置时保留 token hash 和数据路径，只更新公开地址。服务启动配置必须包含合法的 `publicUrl`。

### Gateway

```text
~/.wheelmaker/gateway/
├─ config.json                         # 宿主机级 ACME、日志设置
├─ sites/workspace.json
├─ sites/release-server.json
└─ generated/caddy.json
```

`workspace.json` 继续包含 `webRoot`，由 Gateway 直接提供 Workspace Web，并把 `/ws` 代理到 Registry。`release-server.json` 不再包含 `publicRoot`，整个站点都代理到 Release Server upstream。

## 部署流程

### Workspace 完整部署

1. 启动器只接受无命令的完整部署和可选 `--public-url=<origin>`。
2. 部署核心读取或创建 `~/.wheelmaker/config.json`；显式参数更新 `publicUrl`。
3. 没有显式参数且配置缺失时，交互终端询问公开地址；非交互终端失败且不留下无效配置。
4. 使用配置中的 `publicUrl`、固定 Web 根和 `http://127.0.0.1:9630` 原子写入 `workspace.json`。
5. 应用 Hub/Web，安装自身运行时并启动 Hub。全过程不管理 Gateway 生命周期。

### Workspace update

1. 执行原有 Hub/Web 更新事务。
2. 从现有 `config.json.publicUrl` 重新生成 `workspace.json`，使路由合同随版本演进。
3. 旧配置缺少公开地址时输出一次明确警告并跳过生成；应用更新仍成功。
4. 如果 Gateway 正在运行，它的文件监听器自行热加载；部署器不调用 Gateway reload。

### Release Server 部署

1. 本地从干净源提交构建并上传 Release Server、自包含部署脚本和首页资源。
2. 远端在 SSH 用户 Home 内安装版本，写入或升级 Release Server `config.json.publicUrl`。
3. 启动服务并验证 loopback `/healthz`。
4. 无条件原子写入 `gateway/sites/release-server.json`，但不检查或操作 Gateway。
5. 不探测、安装、停止或配置 Nginx，不修改 DNS、防火墙、安全组或证书。

### Gateway 部署

`node deploy.mjs gateway`：

1. 读取 stable 中的 Gateway 指针和清单。
2. 校验清单、平台产物、大小和 SHA-256。
3. 已安装同版本且健康时保持幂等；同版本未运行时启动并验证；版本变化或服务损坏时重新安装。
4. 升级失败时恢复上一版二进制和服务。
5. 首次安装失败时停止并卸载本次注册的 service/task/LaunchAgent，删除本次产生的包装器、二进制和 release state，不留下开机自启的坏服务。

## Release Server HTTP 合同

- `/healthz`：匿名健康检查，继续返回 publisher 配置状态。
- `/api/*`：保持 Bearer token 鉴权和现有发布协议。
- `/`：匿名提供 `index.html`。
- 其他非 API 路径：只从配置的 `dataRoot/public` 安全提供普通文件。
- 支持 `GET` 和 `HEAD`、HTTP Range、`Last-Modified`，公开文件统一返回 `Access-Control-Allow-Origin: *`。
- 控制文件（`stable.json`、`releases.json`、顶层部署脚本和首页）禁止缓存或要求重新验证；版本目录和按摘要寻址的产物允许 immutable 缓存。
- 不开放目录列表，不允许路径穿越，不把 API 的 404 回落到静态文件。

Nginx 最小接入合同变为：整个公开 host 代理到 `http://127.0.0.1:9680`。Nginx worker 不需要读取 `~/.wheelmaker`。

## 发布事务

正式发布按照以下可见性顺序提交：

1. 完成所有上传文件、清单、摘要和容量验证。
2. 把版本目录和可选 Gateway current 候选切换到最终位置。
3. 生成顶层 `deploy.mjs`、`deploy-core.mjs`、`releases.json` 和成功状态。
4. 最后原子写入 `stable.json`，使新版本一次性对客户端可见。
5. 通过 `config.json.publicUrl` 从匿名公网路径读取并验证：stable 身份、两份部署脚本摘要、release manifest 摘要、Gateway manifest 摘要（若更新），以及本次发布产物的可访问性/Range。
6. 公网验证失败时恢复上一份 stable、顶层别名、历史、状态和 Gateway current，并撤销新版本可见目录；commit 返回失败。
7. 只有公网验证通过才删除 staging/backup 并向 publisher 返回成功。

Release Server 启动恢复继续以 `stable.json` 为事实源，修复中断事务产生的顶层派生文件。

## Gateway 路由约束

- 聚合配置前按 hostname（大小写不敏感）检查唯一性；Workspace 与 Release Server 或两个站点文件不能声明同一 hostname。
- HTTPS 重定向的目标 authority 来自站点 `publicUrl`，保留配置的外部非标准端口；host matcher 和 TLS SNI 仍只使用 hostname。
- `http://` 站点不产生 HTTPS 重定向。
- Release Server host 的所有路径统一 reverse proxy；Workspace 保持 Web/static、SPA fallback 和 Registry `/ws` 合同。

## 发布首页

首页提供两个独立复制入口：

1. **Deploy WheelMaker**：下载启动器并执行完整部署；交互时由部署器询问服务器公开地址。
2. **Deploy built-in Gateway**：下载同一个启动器并执行 `node deploy.mjs gateway`。

使用 Nginx 的用户只执行第一条，再按文档反向代理整个 Workspace/Release Server origin。首页不再拼接 `migrate-uninstall`、旧 Gateway selector 或多次完整 deploy。

## 验收标准

- Workspace launcher/core 和 Release Server deploy 均拒绝 `--gateway=*` 与 `--gateway-public-url`。
- `--public-url` 只对 Workspace 完整部署有效，重复、空值和非法 origin 均失败。
- Workspace `config.json` 文件名、现有 projects/registry/log 字段和 `db/hub-config.json` 均不改名；新增 `publicUrl` 不破坏 Hub 严格解析。
- 首次交互部署能保存公开地址；已有地址无重复询问；首次非交互缺失地址明确失败。
- Workspace 完整部署和 update 均生成有效 `workspace.json`；旧配置 update 缺地址时只警告。
- Release Server 每次部署保存公开地址并生成无 `publicRoot` 的 `release-server.json`。
- 不运行 Gateway 命令时，两类部署都不下载、不安装、不启停 Caddy，也不影响 Nginx。
- `gateway` 同时覆盖首次安装、同版本启动、升级和损坏重装；`gateway-update` 不再被接受。
- Gateway 首装健康失败后不存在已启用服务、安装二进制或伪造的安装状态。
- Release Server 直接提供首页、stable、顶层部署脚本、版本产物、CORS、HEAD 和 Range；API 鉴权不变且目录遍历失败。
- 普通 Nginx worker 无需读取 Home 文件，只需代理 loopback Release Server。
- 任一 stable 之前的派生文件写入失败都不会改变旧 stable；公网冒烟失败恢复旧公开版本。
- 发布成功后匿名公网可下载自包含 `deploy.mjs` 和 `deploy-core.mjs`，摘要与 stable 完全一致。
- 重复 hostname 被拒绝；配置外部端口的 HTTPS 跳转使用该端口。
- 同一 source SHA 仍被发布器判定为 unchanged，不补发可选产物。
- 相关 Node 和 Go 测试全部通过，部署脚本继续保持自包含，发布产物中不出现本地模块 import。

## 文档

- 更新 `docs/wiki/architecture/gateway.md` 为“配置始终生成、Gateway 独立安装”的当前事实。
- 更新 `docs/wiki/release-and-build/release.md`，记录 Release Server 静态服务、稳定指针最后提交和公网冒烟/回滚。
- 更新 README 与 Release Server 中英文部署文档，删除 `/srv`、Nginx 文件权限、Gateway selector 和 `gateway-update` 的陈述，增加 Nginx 全站反代示例。
- 给冲突的 2026-08-05 Gateway/迁移规格加醒目的 superseded 说明和新规格链接；保留历史正文，不删除决策记录。

## 范围之外

- 不安装、卸载、升级、停止或配置 Nginx/Certbot。
- 不修改 DNS、防火墙、云安全组或用户证书。
- 不把 Workspace Web 改为由 Hub 二进制提供；Workspace Web 仍由所选入口读取 `webRoot`。
- 不合并 Gateway 与 Hub/Release Server 进程，不改变每机一个 Gateway 的边界。
- 不允许同一 source SHA 增量补发 Desktop、Android 或 Gateway。
- 不修改 Release Server 发布 API 版本、Registry 协议或 ACP 协议。
