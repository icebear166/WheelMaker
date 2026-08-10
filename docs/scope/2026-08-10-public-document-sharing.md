> 由 scope skill 于 2026-08-10 生成
> 状态：已批准 2026-08-10

# 公共文档分享

## 目标

为项目内的 Markdown 与 HTML 文件提供无需登录即可访问的公开分享链接。分享内容是创建时的不可变单文件 HTML 快照：Markdown 保留 WheelMaker 当前预览的主要呈现效果，HTML 保留原始源码并在访问者浏览器中重新执行脚本。公开内容由独立 Share 域名上的 Gateway 直接静态提供，Registry 只负责创建、列出、删除和到期清理；第一版不引入数据库、访问统计、总容量配额或部署生成的 Share Site 文件。

## 决策

- **快照语义**：每次分享都创建新的不可变链接，不覆盖旧链接，也不随源文件后续修改而变化。
- **支持来源**：第一版只支持项目内的 `.md`、`.markdown`、`.html`、`.htm` 文件；入口位于文件预览工具栏和文件右键菜单。不支持项目外文件、Session 附件或聊天回复。
- **Markdown 生成**：复用现有 Markdown HTML 导出渲染链路，等待公式、Mermaid 和代码高亮完成后生成独立 HTML。项目内相对图片读取后内嵌；远程图片沿用现有尽力内嵌和失败回退 URL 的行为。输出保留当前预览设置和现有独立页面的响应式明暗主题能力。
- **HTML 生成**：分享点击时读取并保存当时的原始 HTML 源码，不采集 sandbox iframe 中脚本执行后的 DOM、表单内容或交互状态。访问者打开链接时重新执行源码中的 JavaScript。
- **单文件边界**：只发布一个最终 HTML 文件。HTML 中的项目相对脚本、样式、图片等依赖不随分享上传；创建前检测常见相对资源引用并警告，用户仍可继续。HTTPS 外部脚本、资源、API、WebSocket、iframe 和表单保持为运行时外部依赖，其可用性、CORS 和内容变化由对应服务决定。
- **执行能力**：Share 页面作为普通顶层网页运行，不添加限制脚本、网络、iframe 或表单的 CSP。所有 Share 页面共享一个 Share origin，因此它们也共享该 origin 的 cookie 和 Web Storage；Share origin 必须与 Workspace/Registry origin 分离。
- **公开访问**：公开链接是随机 bearer link，无登录、密码、访问码、索引页或链接枚举接口。Token 使用 32 字节密码学安全随机数并编码为 43 字符 base64url。
- **有效期**：创建时可选 `1h`、`1d`、`7d`、`30d`、永久，默认 `1d`；创建后不可修改。到期后删除公开文件和元数据，不保留 expired/revoked 历史。
- **手动停止**：管理页只有“停止分享”动作；执行后先删除公开文件，再删除元数据，列表中直接消失，不保留软删除记录。
- **管理页**：App Menu 增加顶层 Shares 页面，只展示当前有效分享，按创建时间倒序，游标分页默认 50 条、最大 100 条。展示文件标题/项目路径、创建时间、到期时间或永久、当前域名下的链接，并支持复制和停止分享。
- **无访问统计**：不记录访问次数、最近访问时间、IP、User-Agent 或访问日志派生数据；数据模型不为统计预留字段。
- **容量限制**：解压后的最终 UTF-8 HTML 最大 16 MiB；不设置分享总容量或永久分享数量配额。永久分享可以持续占用磁盘，直到用户手动停止。
- **传输**：App 通过单个已认证 Registry WebSocket `share.create` 请求上传 gzip 后再 base64 编码的完整 HTML，不增加 HTTP 上传、分块上传或断点续传。原始 HTML 必须不超过 16 MiB，完整压缩编码后的 WebSocket envelope 也必须落在 Registry 现有 16 MiB 完整消息上限内；不可压缩内容即使原文未超限，也可能因 base64 膨胀而失败。客户端使用平台 `CompressionStream('gzip')`，不支持时提示升级浏览器/WebView，不增加 gzip JavaScript 依赖。
- **协议兼容**：新增 `share.create`、`share.list`、`share.delete` 三个客户端 Registry 方法和 `RegistryRouteShare`，不修改 Registry protocol version，也不改变现有 Hub/Registry 方法。
- **存储**：不进入 `db`；固定存放在 WheelMaker 状态目录下的独立 `shares` 目录，正文以解压后的原始 HTML 保存。
- **Gateway 配置来源**：主配置使用可选的 `config.json.share.publicUrl`。Gateway 不增加启动参数，而是从既有 `--home` 的父目录推导 WheelMaker 状态目录：默认 `--home ~/.wheelmaker/gateway` 对应 `~/.wheelmaker/config.json` 与 `~/.wheelmaker/shares/public`。
- **Gateway 启动与热加载**：Gateway 在内存中从 `share.publicUrl` 派生 Share Site，并把它编译进生成的 Caddy JSON；不创建 `gateway/sites/share.json`。Gateway 监听主配置变化并热加载，修改 Share 域名不需要重新运行 WheelMaker 部署流程。首次获得该能力仍需按现有独立 Gateway 流程安装或升级支持此功能的 Gateway 二进制。
- **Registry 配置刷新**：Registry 在 `share.create` 与 `share.list` 请求边界重新读取并校验当前 Share 配置及已声明 Gateway hostname，不缓存启动时域名，因此启停、换域名或发生站点冲突时也不要求重启 Registry；删除、到期和启动清理不依赖 Share 是否已配置。
- **配置关闭**：`share` 或 `share.publicUrl` 缺失/为空时禁止新建分享并立即移除 Share Site，但保留现有记录和文件，Registry 仍继续到期清理，管理页仍可列出和停止现有分享。重新配置后，尚未到期的分享恢复访问。
- **配置错误隔离**：`share.publicUrl` 非法或与 Workspace/Release hostname 冲突时，Share Site 失效并 fail closed，Workspace/Release 继续使用各自有效站点运行；Gateway 记录错误并在配置修复后自动恢复，不保留旧 Share 路由。
- **域名变化**：元数据只保存 token，不固化创建时的域名。修改 `share.publicUrl` 后，所有有效分享都使用新域名生成链接，旧域名停止路由。
- **公网可达性**：创建时只校验本地配置与存储，不主动探测 Share 域名、DNS、TLS 或 Gateway 健康状态；这些入口条件继续由部署者负责。
- **直接静态服务的到期边界**：Gateway 不在每次公开请求时查询 Registry 或元数据。Registry 离线时，已经到期的文件可能继续被 Gateway 提供，直到 Registry 再次启动并完成清理；这是已接受的一致性边界。

## 架构

```text
Authenticated Workspace
  ├─ Markdown renderer/export ─┐
  └─ raw HTML file read ───────┴─ gzip + base64
                                      │ share.create
                                      ▼
Registry ───────────────────── ~/.wheelmaker/shares/
  authenticated management      ├─ records/<token>.json
  expiry timer / startup repair  └─ public/s/<token>
                                           │ direct file read
                                           ▼
config.json.share.publicUrl ── Gateway / embedded Caddy
                                           │ GET/HEAD only
                                           ▼
                                  Anonymous recipient
```

### 主配置

`~/.wheelmaker/config.json` 增加可选对象：

```json
{
  "publicUrl": "https://wheelmaker.example.com",
  "share": {
    "publicUrl": "https://share.example.com"
  }
}
```

`publicUrl` 仍是 Workspace/Registry origin；`share.publicUrl` 是 Share origin。Share 地址必须是只含 scheme、hostname 和可选端口的规范 `http`/`https` origin，不允许 userinfo、路径、query 或 fragment；hostname 与现有 Gateway 站点大小写不敏感地保持唯一。`https` 使用 Gateway 既有 TLS/自动证书行为，显式 `http` 则保持明文站点。

Gateway 只从主配置解析 Share 所需字段。主配置缺失、JSON 损坏或 Share 字段无效时只禁用 Share 派生站点，不让该错误使 `gateway/sites/workspace.json` 或 `gateway/sites/release-server.json` 下线。现有部署脚本在更新 `config.json` 其他字段时保留 `share` 对象；不新增 Share 部署参数。

### 存储模型

```text
~/.wheelmaker/shares/
├─ records/
│  └─ <token>.json
└─ public/
   └─ s/
      └─ <token>
```

每个 token 对应一个独立、不可变的 JSON 记录，至少包含 schema、token、标题、项目 ID、源路径、源类型、创建时间、可空到期时间和正文大小。记录不包含当前 public URL、状态、删除时间或访问统计。永久分享的到期时间为空；列表只返回记录与公开正文同时存在且尚未到期的条目，避免中断创建留下短暂的不可访问条目。

创建使用同一文件系统内的临时文件和原子重命名：Registry 流式、限长地 base64 解码和 gzip 解压，验证 UTF-8 与 16 MiB 原文限制，写入临时正文和记录；随后先原子发布记录，最后把正文原子移动到 `public/s/<token>`，正文发布是公开可见性的提交点。Token 或目标文件冲突时重新生成 token，不覆盖任何现有文件。

删除和到期清理先移除公开正文，再移除记录。Registry 启动时删除遗留临时文件，扫描并清理已到期记录；记录损坏、正文缺失时删除记录和可能存在的同 token 正文，公开目录中的孤儿文件也 fail closed 删除。运行期只为最近到期记录维护一个定时器，处理后重新计算下一个 deadline，不按固定频率全量扫描。

### Registry 接口

三个方法都使用现有已认证客户端 WebSocket，会话外不可调用：

- `share.create` 接收项目/路径/文件类型、显示标题、有效期枚举、`gzip+base64` 编码和正文；响应 token、当前配置生成的 URL、创建时间与到期时间。Share 未配置、内容/编码非法、任一大小上限超出或写盘失败时不发布公开文件。
- `share.list` 接收可选 cursor 和 limit；响应 Share 当前是否可创建、可空的有效 public URL、有效记录页和下一 cursor。即使 Share 配置关闭或错误，仍返回可管理的现有记录，但不生成可复制的公开链接。
- `share.delete` 只接受 token，并以幂等方式停止分享；成功后公开路径不可再读取且记录不再出现在列表。

列表 cursor 是服务端生成的不透明值，以创建时间和 token 提供稳定倒序翻页。Registry 每次分页可以扫描独立元数据文件并过滤/排序；cursor 限制响应数量，不引入全局索引。Registry 不向 Hub 请求或保存源文件的后续更新，分享生命周期独立于项目文件生命周期。

### Gateway 路由

Share Site 只接受与 `GET /s/<43-char-base64url-token>` 或 `HEAD` 精确匹配的请求。正文文件没有扩展名，Gateway 强制响应：

- `Content-Type: text/html; charset=utf-8`
- `Content-Disposition: inline`
- `Cache-Control: no-store`
- `X-Robots-Tag: noindex, nofollow, noarchive`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`

不配置目录列表、SPA fallback、Workspace 代理、Registry 代理或限制页面执行能力的 CSP。其他 method、路径、非法 token、缺失或已删除文件统一返回不暴露内部路径和记录状态的普通 404。Share 页面可被正常导航或嵌入，但外部资源加载和跨域请求仍服从浏览器标准安全策略。

## 流程

### 创建分享

1. 用户从受支持项目文件的预览工具栏或右键菜单选择分享。
2. App 显示有效期选择器，默认 1 天。Markdown 等待当前导出渲染完成并内嵌资源；HTML 读取原始源码并检测常见相对依赖，存在依赖时先显示可继续的警告。
3. App 验证最终 UTF-8 HTML 原文大小，gzip、base64 编码并验证完整请求大小，然后发送 `share.create`。
4. Registry 验证认证、配置、payload、编码和两层大小边界，生成 token，以记录优先、正文最后的原子顺序发布。
5. App 显示并复制 Registry 返回的完整链接；再次分享同一文件会得到新 token。

### 公开访问

1. 访问者匿名请求 Share origin 下的精确 token 路径。
2. Gateway 直接读取 `shares/public` 中的文件并以 HTML 安全头响应，不调用 Registry。
3. Markdown 快照直接呈现；HTML 快照从初始源码重新运行脚本并访问仍可用的外部依赖。

### 停止与到期

1. 用户在 Shares 页面停止分享，或 Registry 最近到期定时器触发。
2. Registry 先删除公开文件，使 Gateway 的后续请求立即变为 404，再删除 JSON 记录。
3. Registry 重启时修复中断操作、清理过期项与孤儿；不生成 tombstone、历史或统计记录。

### Gateway 配置变化

1. Gateway 的运行期 watcher 检测 `~/.wheelmaker/config.json` 变化。
2. 有效 `share.publicUrl` 被转换为内存 Share Site 并触发 Caddy 热加载；域名变化时旧 Share host 被移除，新 host 服务同一公开目录。
3. 配置为空或无效时只移除 Share Site；Workspace/Release 路由保持运行，分享文件由 Registry 按原生命周期继续管理。

## 验收标准

- 项目 Markdown/HTML 预览工具栏与文件右键菜单提供分享入口，其他扩展名和非项目来源不提供入口。
- 创建弹层提供五种已确认有效期并默认 1 天；每次创建产生新的 43 字符随机 token，过期时间不可修改。
- Markdown 分享能独立显示 GFM、公式、Mermaid、代码高亮和项目内图片；HTML 分享保存源码快照，访问时可执行内联/HTTPS 外部脚本以及浏览器允许的网络、iframe 和表单行为。
- HTML 的常见项目相对依赖会在创建前警告但不自动上传；外部依赖不会被代理、锁版本或保证长期可用。
- 最终原始 HTML 和压缩编码 envelope 分别满足 16 MiB 上限；任一超限、非法 gzip/base64、非 UTF-8 或不完整请求都不留下可访问文件。
- 分享内容和元数据只存在 `~/.wheelmaker/shares`，不写入 `db`；创建、停止、崩溃恢复和到期清理遵循本 Spec 的可见性顺序。
- 公开请求无需鉴权；只有精确 GET/HEAD token 路径返回强制 HTML MIME 与指定响应头，其他请求统一 404，且没有目录列表或分享索引。
- Shares 页面只列有效记录，支持 50 条默认游标分页、复制当前域名链接和立即停止分享；不存在统计、状态历史和软删除条目。
- `share.publicUrl` 由主配置拥有。Gateway 从 `--home` 父目录推导配置和公开目录，在内存生成 Share Site 并热加载，不要求 `sites/share.json` 或域名变更后重新部署。
- 清空 Share 配置会立即停止公网路由但保留记录；恢复后未过期分享恢复。非法或冲突配置只禁用 Share，不能影响 Workspace/Release。
- 修改 Share 域名后所有有效 token 使用新域名，旧域名不再由 Gateway 响应；记录中不存在旧域名副本。
- Registry 正常运行时到期项自动删除；Registry 离线期间 Gateway 可能继续提供已到期文件，Registry 下次启动后清理并返回 404。
- 现有 Registry protocol version、Workspace/Release Site 文件所有权和 Gateway 独立部署生命周期不变。

### 测试

- App 单元/组件测试覆盖入口条件、默认与各有效期、Markdown 导出复用、HTML 源码快照、相对依赖警告、压缩能力缺失、两层大小校验、创建反馈和 Shares 分页/删除交互。
- Registry Go 测试覆盖三个认证方法、配置开关、有效期枚举、token 格式与碰撞重试、gzip/base64/UTF-8/解压上限、元数据分页，以及创建和删除各故障点的原子性。
- 存储测试使用可控时钟覆盖最近 deadline 定时器、永久记录、启动清理、损坏记录、缺失正文、孤儿正文和 Registry 离线后重启清理。
- Gateway Go 测试覆盖状态目录推导、主配置 watcher、Share Site 派生、URL/hostname 冲突隔离、配置删除 fail closed、Caddy JSON 路由、method/path/token matcher、MIME、安全头和通用 404。
- 集成测试覆盖“创建 → Gateway 匿名 GET/HEAD → 手动停止/到期 → 404”，并验证 Registry 不参与公开读取；浏览器测试至少验证 HTML 内联脚本会重新执行且无法访问 Workspace origin 数据。
- 自动化测试不访问真实 DNS、ACME、第三方资源或外部 API，不依赖真实到期等待，不以访问日志验证统计。

## 文档

- 新建 `docs/wiki/features/public-sharing.md`，记录稳定的产品行为、生命周期、来源边界与安全模型。
- 更新 `docs/wiki/architecture/gateway.md`，记录由主配置派生的 Share Site、状态目录推导、直接静态路由和错误隔离边界。

## 范围之外

- 登录鉴权、密码/访问码、审批、分享对象白名单、可枚举索引或搜索引擎收录。
- 活文件同步、覆盖旧链接、编辑有效期、恢复已删除/已过期分享或保留 tombstone。
- 多文件网站、ZIP/目录上传、HTML 相对依赖打包、服务端资源代理或外部依赖版本锁定。
- 项目外文件、Session 附件、聊天回复和非 Markdown/HTML 文件分享。
- HTTP/分块/断点上传、超过 16 MiB 的分享、数据库索引、总存储配额与自动清理永久分享。
- 访问统计、审计记录、IP/User-Agent 收集或基于访问量的清理策略。
- 每个分享独立域名/origin、Share 页面沙箱、限制任意 JavaScript 能力或让 Share 页面继承 Workspace 鉴权。
- Gateway 按请求读取到期元数据、Registry 离线时保证精确到期，或通过 WheelMaker 部署流程生成 `sites/share.json`。
- 自动配置 DNS、防火墙、NAT、安全组、证书或第三方 API 的 CORS。
