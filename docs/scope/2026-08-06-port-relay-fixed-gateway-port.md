> 由 scope skill 于 2026-08-06 生成

# 固定 Gateway 端口的 Port Relay

## 目标

当前 Port Relay 由 Registry 在用户指定的 `listenPort` 上自行创建 HTTP listener，再通过 Hub 主动建立 WebSocket tunnel。新的 Gateway 已由 Caddy 统一占用公网入口，因此 Relay 的公网端口优先改由 Gateway 配置中的固定端口和 Caddy 常驻监听负责；没有 Gateway 配置时，也支持手工 Nginx 作为 edge proxy，由客户端提供 `listenPort`。Registry 继续拥有 Relay 控制、访问码、HTTP/WebSocket 数据面和 Hub tunnel，不再为每次 Relay 启用创建公网 listener。

## 决策

- **固定端口来源**：`~/.wheelmaker/gateway/config.json` 增加可选 `relay.listenPort`。字段缺失或为 `0` 时不启用公网 Relay listener；配置值是宿主机唯一的 Relay 公网端口。只有存在有效 Workspace site（含 `publicUrl`）时才生成 Relay listener。
- **Gateway 所有权**：Gateway 在启动和配置热加载时读取固定端口，生成 Caddy listener；Relay enable/disable 不触发 Caddy reload，也不重启 Hub 或 Gateway。
- **公网转发**：Caddy 在固定端口按 Workspace `publicUrl` 的 scheme 接收 HTTP 或 HTTPS 与 WebSocket，请求全部反向代理到 Registry 的 `127.0.0.1:9630`，先删除客户端传入的同名 header，再覆盖写入 `X-WheelMaker-Relay: 1`。该 header 是内部路由标记，不替代 Relay access code 认证。固定端口保持第三方页面的根路径、绝对资源路径和 WebSocket 路径不变。
- **Registry 数据面**：Registry 主 HTTP handler 根据 Caddy 的 Relay 标记将请求交给 `portrelay.Controller.ServeHTTP`。Controller 继续处理登录、访问码、Cookie、HTTP stream、WebSocket stream 和内部 Hub tunnel；不再调用 `net.Listen`。
- **协议兼容**：保留现有 `registry.relay.*`、`hub.relay.*` 方法和 Relay frame 协议，不修改 Registry protocol version。`registry.relay.enable` 的 `listenPort` 字段在 Gateway 模式下必须等于固定端口；无 Gateway 时由客户端提供。status 增加可选的 `listenPortManaged` 字段标识端口所有权。
- **单例模型**：Relay 仍是 Registry 级全局单 slot。切换 Hub/目标时关闭旧 tunnel，再建立新 tunnel；Caddy listener 始终不变。
- **TLS**：固定端口沿用 Workspace `publicUrl` 的 host 和 scheme。HTTPS Workspace 在固定端口生成对应的 TLS listener，并复用现有 Caddy 自动证书或显式证书配置；HTTP Workspace 不自动升级为 HTTPS。
- **端口约束**：固定端口必须是有效端口，不能与 Gateway 的 `80/443`、Registry 的 `9630`、Release Server 的 `9680` 或 Caddy admin 的 `2019` 冲突。公网防火墙、NAT 和安全组由部署者负责，不由 Gateway 自动修改。
- **关闭语义**：固定端口即使 Relay 未启用也可以由 Caddy 保持监听；Registry 在 disabled 状态返回不可用，不转发到任何 Hub target，关闭后已有请求和 tunnel 立即终止。未配置时仍使用既有 `Disabled` status，并在 snapshot 的 `error` 中说明 `relay port is not configured`，不新增协议 status 值。
- **配置错误**：Gateway 初次启动时固定端口、已声明的 Workspace site 或 Caddy 配置无效则启动失败；没有 Workspace site 时只是不生成 Relay listener，不影响其他 Gateway site。运行中热加载遇到无效配置或端口绑定失败时保留上一份有效 Caddy 配置。Registry 通过同一 Gateway 配置文件的只读 provider 在 status/enable 时重新校验；配置无效时返回可诊断的 unavailable/error，不创建 Hub tunnel，Caddy 的热加载失败由 Gateway 日志和状态暴露。

## 架构

```text
Browser / App iframe
        │  http(s)://<workspace-host>:<fixed-relay-port>/<target-path>
        ▼
Gateway / embedded Caddy
        │  fixed listener, Relay marker, reverse_proxy
        ▼
Registry 127.0.0.1:9630
        │  portrelay.Controller.ServeHTTP
        │  registry.relay.* controls the singleton slot
        ▼
Registry relay tunnel  ⇄  HubClient / hubTunnel
        ▼
Hub 127.0.0.1:<targetPort>
```

### Gateway

`GlobalConfig` 增加 Relay 配置并校验固定端口。编译 Caddy JSON 时，在现有 Workspace `:80/:443` server 之外增加固定端口 server：

- listener 只绑定配置端口；
- host matcher 使用 Workspace `publicUrl` 的 hostname；
- route 保留原始 URI，反代到 Workspace site 的 Registry upstream；
- request header 删除客户端的 `X-WheelMaker-Relay` 后覆盖写入 `X-WheelMaker-Relay: 1`，并写入正确的 forwarded scheme；
- WebSocket upgrade 由 Caddy reverse proxy 原生转发；
- HTTPS 固定端口使用同一 hostname 的 TLS 自动化/显式证书策略。

Gateway 仍只监听语义配置文件并原子写入 generated Caddy JSON；Relay enable/disable 不写 Gateway 配置。配置端口变更属于 Gateway 配置变更，按现有 Gateway hot-load 流程生效。

### Registry

Registry worker 启动时接收 `GatewayConfigPath`（默认与 Gateway service 使用同一用户 Home 下的 `~/.wheelmaker/gateway/config.json`），并将一个可注入测试的只读 provider 注入 Controller；provider 在 status/enable 时读取并校验该文件。配置文件存在时端口由 Gateway 管理，不能由 App LocalStorage 覆盖；文件缺失时切换为 client-managed standalone 模式，客户端端口只作为 Nginx 手工配置的协定值。Registry `handleHTTP` 在现有 `/ws`、HTML preview 路由判断之前处理精确的 `X-WheelMaker-Relay: 1` 标记，将 edge proxy 转发的任意目标路径交给 Controller；未经过 edge proxy 的普通直接访问仍按 Registry 原有路由处理，Registry 主 listener 继续只绑定 loopback。

Controller 保留 relay slot、访问码 generation、登录 cookie、stream/frame 和 Hub control forwarding。`Enable` 只校验固定端口并建立 Hub `hub.relay.open`；`Disable` 关闭 Hub tunnel 和当前 streams。每次 status/enable/data-plane dispatch 都使用 provider 的当前结果；端口被移除、变更或 provider 报错时，Controller 先关闭旧 tunnel、清除 active slot，再返回 `Disabled`/`Error`，避免旧配置继续访问 target。Relay status 在配置存在时返回固定 `listenPort`，即使状态为 `Disabled`。

### Hub

Hub 继续通过现有 Registry 控制请求接收 `hub.relay.open`，主动连接 `ws(s)://<workspace-host>:<fixed-relay-port>/__wheelmaker/relay/hub`。Hub 不需要知道 Caddy 配置，也不直接暴露本机端口；现有二进制 frame 和多 stream 复用保持不变。

### App

App 继续调用现有 `registry.relay.*` 方法。Gateway 模式下 Relay URL 使用 Registry status 返回的服务端固定端口；standalone 模式下设置界面允许编辑客户端 Nginx 端口。目标 Hub、目标端口、访问码和 iframe/浏览器打开行为保持不变。

## 流程

### Gateway 启动

1. Gateway 读取 `gateway/config.json`、Workspace site 和其他 site。
2. 若 `relay.listenPort` 缺失或为 `0`，或 Workspace site 不存在，不生成 Relay server。
3. 若端口有效且 Workspace site 存在，按 Workspace `publicUrl` scheme 生成固定端口的 HTTP 或 HTTPS Caddy server，并反代到 Registry upstream。
4. Caddy 成功启动后，端口可访问；Registry 尚未启用 Relay 时返回 `Disabled`/unavailable。

### Enable

1. App 发送 `registry.relay.enable`，payload 保留 `listenPort`、`hubId`、`targetHost`、`targetPort` 和 `accessCode`。
2. Registry 读取当前 Gateway 固定端口，拒绝未配置、冲突或不匹配的端口；同时校验 Hub 在线、目标 host 为 `127.0.0.1`、目标端口和访问码。
3. Registry 生成新的 Relay ID、nonce 和 access-code generation，关闭旧 slot/tunnel（如有）。
4. Registry 通过现有 Registry envelope 向目标 Hub 发送 `hub.relay.open`，Hub 主动连接固定 Caddy Relay 端口的 tunnel path。
5. Registry Controller 接收并校验 Hub tunnel，状态变为 `Up`；Caddy 不发生配置变化。
6. 浏览器或 App 访问 `http(s)://<host>:<fixed-port>/<path>`，Caddy 将请求送入 Registry，Controller 认证后通过 tunnel 转发到 Hub target。

### Disable / replace

1. Registry 先关闭对应 Relay ID 的 Hub tunnel、活动 streams 和旧访问 cookie generation。
2. Controller 清除 active slot；固定 Caddy listener 保持存在，但后续 Relay 数据请求返回 disabled。
3. 重新 Enable 时复用同一个固定端口，只替换 Hub/target/tunnel 状态。

## 验收标准

- Gateway 配置缺少 `relay.listenPort` 或缺少 Workspace site 时，生成配置不包含 Relay listener，Registry status 使用既有 `Disabled` status 并明确返回未配置。
- Gateway 配置固定端口后，Caddy JSON 包含该端口的 listener、Workspace hostname matcher、Registry loopback reverse proxy 和 Relay marker header。
- HTTPS Workspace 的固定端口配置能通过 Caddy JSON 校验，并使用对应 hostname 的 TLS 证书策略；HTTP Workspace 不生成错误的 HTTPS 跳转。
- 固定端口为 `80`、`443`、`9630`、`9680` 或 `2019` 时被拒绝；非法端口和 Caddy 绑定冲突不会覆盖上一份有效 Gateway 配置。
- Relay enable 使用正确固定端口时可以建立现有 Hub tunnel；使用其他 `listenPort` 时不触发 Hub 请求并返回 `invalid_argument`。
- Registry 不再创建独立 Relay TCP listener；Relay 的普通 HTTP、POST body、WebSocket text/binary frame、登录、Cookie 和关闭行为保持现有语义。
- 访问固定端口时，根路径、绝对资源路径、普通 WebSocket 路径和 query string 都原样到达 Hub target。
- Relay disabled 或 Hub tunnel 不存在时，固定端口不会访问目标 Hub，且不泄露目标 host/port 映射信息。
- Caddy、Registry、Hub 任一重启或断开后，Relay status 能回到可解释状态；不会残留可用的旧 Hub tunnel。
- 现有 Registry protocol version、方法域和 frame version 不变。

### 测试

- Gateway Go 单元测试：Relay config decode/validation、Workspace site prerequisite、保留端口冲突、固定 HTTP/HTTPS listener、host matcher、reverse proxy header 覆盖、WebSocket-compatible route、无 Relay 配置时不生成 listener，以及 Caddy JSON validation。
- Registry/portrelay Go 测试：固定端口 provider、status/enable 校验、无独立 listener、非 Relay marker 的普通直连路由、Relay marker HTTP dispatch、HTTP/WS 数据面和 tunnel replacement。
- 现有 Hub relay smoke tests 继续覆盖 Hub 主动连接固定 Relay URL 的控制流和数据流。
- Web 测试：status 返回固定端口、enable 使用服务端端口、端口不再由 LocalStorage 覆盖，以及 Relay URL/iframe/browser 打开行为。
- 集成测试至少覆盖 `Caddy fixed port → Registry → Controller → test Hub target` 的 HTTP 和 WebSocket 路径；不要求真实公网 DNS、证书签发或防火墙环境。

## 范围之外

- 不支持每次 Relay enable 动态申请或释放公网端口。
- 不实现 Relay 子域名、路径前缀重写或第三方页面 HTML/JS 改写。
- 不让 Caddy 直接连接 Hub target；Caddy 只反代 Registry loopback HTTP/WebSocket。
- 不改变 Hub 主动连接模型、Relay frame 协议、Registry protocol version 或现有 access-code 认证模型。
- 不自动修改 DNS、防火墙、NAT、安全组、Nginx 或用户证书。
- 不把 Relay 状态迁入 HubState；Relay 仍是 Registry 级全局控制器。
