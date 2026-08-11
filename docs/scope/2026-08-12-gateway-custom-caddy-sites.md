> 由 scope skill 于 2026-08-12 生成
> 状态：已批准 2026-08-12

# Gateway 自定义 Caddy 站点

## 目标

将内置 Gateway 扩展为宿主机唯一的公网 Caddy 入口：在继续自动维护 WheelMaker Registry、Release、Share 和 Relay 路由的同时，允许本机受信任运维者用站点级 Caddyfile 配置其他二级域名，从而在不保留 Nginx 公网入口的前提下承载同机其他 Web 服务。

## 决策基线

### 需求边界

- Gateway 是目标宿主机唯一监听公网 `80/443` 的入口进程；不同域名由同一个内嵌 Caddy 实例按 Host/SNI 聚合，不支持 Gateway 与 Nginx 在同一 IP 上共同占用这些端口。
- 用户在 `~/.wheelmaker/gateway/sites/*.caddy` 维护自定义站点。自定义配置支持内嵌 Caddy 标准模块提供的完整站点级 Caddyfile 能力，包括站点地址、matcher、`handle`/`route`、反向代理与 WebSocket、静态文件、rewrite、redirect、header、站点 TLS、命名 snippet 和 `import`。
- Gateway 继续独占进程级全局配置和 WheelMaker 托管路由。用户不能提供全局 options block、原始 Caddy JSON，也不能使用未编译进 `wheelmaker-gateway` 的第三方 Caddy 模块。
- 自定义站点可以正常按域名共享 Gateway 的 `80/443` listener；与任一 WheelMaker 托管站点使用相同 hostname（大小写不敏感且不因 scheme/显式端口不同而区分）、在托管 `80/443` 或 Relay listener 上声明无 hostname 的 catch-all，以及把 Caddy admin `2019`、Registry `9630`、Release Server `9680` 或当前 Relay 端口声明为自定义站点 listener 的配置必须被拒绝。反向代理到这些 loopback 业务端口不属于监听冲突。
- WheelMaker 路由与全部自定义站点作为一个配置单元原子生效。运行中任何语法、模块、地址、端口或 Caddy 校验错误都不得改变当前服务或磁盘上的上一份有效生成配置；首次启动存在错误时 Gateway 启动失败，并给出可定位到来源文件和行号的诊断。
- 没有自定义站点文件的安装保持现有 Registry、Release、Share、Relay、TLS、响应头、缓存、压缩、SPA fallback 和热加载行为。Gateway 专属 `config.json` 继续使用 schema 2，不通过本功能增加新的配置字段或迁移旧 schema。
- Gateway 安装与升级创建所需站点目录但不创建示例业务站点，不覆盖、删除或改写已有用户文件。Hub/Web 更新和 Release Server 部署继续不拥有自定义站点。
- 现有 Nginx 站点由运维者人工改写和切换。Gateway 部署器不读取或转换 Nginx 配置，不自动停止、禁用或修改 Nginx；运维者先离线校验完整 Gateway 配置，再显式停止 Nginx并启动 Gateway。
- 本功能不增加 App/API/UI 配置入口。自定义 Caddyfile 是拥有 Gateway 服务账号文件权限的本机运维配置，能够以该账号权限读取文件和连接上游，其安全审查和备份责任属于运维者。

### 技术决策

- `~/.wheelmaker/gateway/config.json` 与父目录 Hub 配置继续分别提供 Gateway 专属全局状态和 WheelMaker 业务状态；`sites/` 是独立、用户拥有的 Caddyfile 配置源，`generated/caddy.json` 仍是完全可重建且禁止人工编辑的运行时产物。
- Gateway 构造一份受控的合成 Caddyfile：由 Gateway 生成唯一全局 options 和 Registry/Release/Share/Relay 站点，并按确定性顺序装配用户站点输入，再使用当前内嵌 Caddy 的官方 Caddyfile adapter 转成 JSON。适配后的 JSON 仍必须通过现有 Caddy 配置校验，且 Gateway 必须在加载前重新断言 admin、storage、日志和保留 listener 等托管边界未被用户输入改变。
- 用户输入按稳定路径顺序装配，Caddy 原生 snippet/import 语义保留。Gateway 的输入指纹必须覆盖所有直接站点文件、它们选中的导入依赖以及 import glob 的成员变化，使新增、修改、重命名和删除均能触发同一套原子重编译；同一磁盘状态必须产生确定性的有效 JSON。
- 用户文件中的全局 options block 在组合边界被拒绝；未知 directive/module 由当前内嵌模块集合和 Caddy adapter 拒绝。配置冲突在热加载前完成语义检查，错误信息保留 Caddy 的来源位置并补充冲突地址、端口或托管对象。
- 冷启动、`validate`、`render` 和运行期 reload 使用同一个装配、适配、边界校验与 Caddy 校验入口，避免命令与服务实际接受的配置分叉。Caddyfile adapter warnings 在命令输出或日志中可见，但只有错误阻止生效。
- 运行期先在内存和临时文件中完成候选配置的全部校验，成功 hot-load 后才原子提升为 `generated/caddy.json`。适配失败、语义检查失败、Caddy 校验失败、端口绑定失败或 hot-load 失败均保留上一份活动配置及其生成文件；候选修复后由 watcher 自动重试并生效。
- 路径解析增加用户站点根目录并由 Gateway `paths` 输出。运行时 fingerprint、部署器初始化、CLI 测试和跨平台服务包装器均使用同一个解析结果，不引入平台专属配置位置。
- 不改变 Registry protocol version、Hub 配置 schema、Release channel、认证、Gateway 独立部署生命周期或现有显式 Nginx 禁用脚本的职责。

## 设计视图

### 功能设计

Gateway 部署后拥有一个空的用户站点目录。运维者可以在其中增加一个或多个 `.caddy` 文件，以标准 Caddyfile 站点语法声明原 Nginx 承载的域名、上游和处理规则；公共 TLS 默认沿用 Caddy 自动 HTTPS，也可在站点中显式声明标准 TLS 行为。`wheelmaker-gateway validate --home ...` 在不绑定公网端口的情况下校验 WheelMaker 与用户配置的完整组合，`render` 只为合法组合生成运行时 JSON。

服务运行时同时观察 Gateway 配置、Hub 配置和用户站点输入。任一输入变化都会生成完整候选；候选只有在适配、托管边界检查和 Caddy 校验全部成功后才整体替换现有配置。错误配置不会造成任一当前站点下线，日志和命令诊断指出用户可修复的来源。删除站点文件也通过相同流程原子移除对应路由和证书策略。

从 Nginx 迁移时，运维者先逐站点写入 Caddyfile 并运行离线校验；确认组合完整后自行停止 Nginx，再启动或重启 Gateway。部署和更新流程不替用户执行该切换，也不承诺自动翻译 Nginx 专属语义。

### 技术设计

#### 整体方案

```text
Hub config --------------------------+
Gateway schema-2 config -------------+--> managed Caddyfile source --+
                                                                  |
gateway/sites/*.caddy + imports ---------> user Caddyfile source --+--> Caddyfile adapter
                                                                        |
                                                                        v
                                                           managed-boundary validation
                                                                        |
                                                                        v
                                                                 Caddy Validate
                                                                        |
                                                +-----------------------+------------------+
                                                |                                          |
                                             error                                      success
                                                |                                          |
                                     keep last active config                 hot-load candidate, then
                                     and generated JSON                      atomically promote JSON
```

Gateway 的语义配置层继续负责把 Hub/Gateway 状态转换为 WheelMaker 托管站点；新增的 Caddyfile 组合层负责把这些托管站点与用户输入放进同一个 Caddy 配置空间。Caddy adapter负责标准指令与模块解析，Gateway 自己只实施必须保持的所有权约束，不复制一套通用 Caddy 指令模型。

用户站点与托管站点共享同一个 HTTP/TLS app、证书存储和 listener。Gateway 保持 admin loopback、ACME/storage 根、日志级别、托管站点路由合同和 Relay 标记注入的控制权；用户配置只能贡献合法站点级结构。最终 JSON 仍由嵌入式 Caddy 直接运行，运行时状态不存在第二个代理进程或第二份独立路由表。

#### 关键结构

- **用户源目录**：`gateway/sites/`，保存用户拥有的 `.caddy` 入口及其导入依赖；部署器只确保目录存在和权限正确。
- **托管源**：由当前 `GlobalConfig`、Hub 派生配置和 `SiteConfig` 生成，不成为用户可编辑的事实源。
- **候选 bundle**：包含合成源、输入依赖/指纹、适配 warnings、最终 JSON 和来源诊断映射，供 `validate`、`render`、冷启动和 reload 共用。
- **已接受生成物**：`gateway/generated/caddy.json`，只在显式 `render` 候选通过全部校验、冷启动候选成功运行或运行期候选成功 hot-load 后原子写入，不记录未通过完整接受边界的候选。

#### 实现流程

1. 路径解析和部署初始化得到 Gateway、Hub、用户站点、生成物与 Caddy data 目录；已有用户站点只读加载，不做规范化回写。
2. 配置加载器验证 schema 2 Gateway 配置与 Hub 派生字段，生成现有 WheelMaker 站点语义，并枚举、排序和解析用户 Caddyfile 输入及导入依赖。
3. 组合层生成唯一受控全局区和托管站点，将用户站点级输入加入合成源；Caddy adapter完成标准 Caddyfile 到 JSON 的转换并返回带来源的错误/warning。
4. Gateway 对适配结果执行托管边界和冲突检查，再调用 Caddy 的完整配置校验。任一步失败都返回同一诊断模型，不触碰活动配置或生成物。
5. 冷启动先用合法候选启动内嵌 Caddy，启动成功后才原子提升生成物；提升失败则停止本次启动并返回错误。`validate` 只报告结果，`render` 为通过全部离线校验的候选原子写入生成物并返回路径。
6. 运行期 watcher 比较 Gateway、Hub 和完整用户输入依赖指纹。合法候选先 hot-load，成功后原子提升生成物并更新活动指纹；失败候选保持待重试状态，修复后自动重新编译。
7. 用户删除或变更站点后走同一原子流程；证书和 Caddy data 保留在既有 Gateway data 根，由 Caddy 按最终活动配置管理。

### 预估改动面

- `server/internal/gateway/`：扩展路径、Caddyfile 输入装配/适配、托管边界校验、依赖指纹、候选提升和运行时错误收敛；更新现有 compiler/runtime 测试和 Caddy 集成测试。
- `server/cmd/wheelmaker-gateway/`：让 `paths`、`validate`、`render`、`serve` 共享新 bundle 行为并暴露来源明确的诊断；更新命令测试。
- `scripts/deploy/`：Gateway 安装/升级确保用户站点目录存在且被保留，继续严格维护 schema 2 config 并保持 Nginx 生命周期不变；扩展 Node 部署测试。
- `README.md`、`INSTALL.md`：增加自定义站点配置、离线校验、人工 Nginx 切换和失败恢复说明。
- 已确认 wiki 目标：更新 `docs/wiki/architecture/gateway.md`，沉淀用户站点所有权、合成/适配链、冲突边界、原子热加载和迁移职责。

## 验收

- 空 `sites/` 或目录缺失的既有安装升级后 → Registry、Release、Share、Relay 与 TLS 行为保持现状，Gateway config 仍为 schema 2；Go/Node 回归测试及生成 JSON 语义断言通过。
- 新增包含反向代理、WebSocket、静态文件、matcher、rewrite/header、snippet/import 和站点 TLS 的标准 `.caddy` 配置 → `validate` 成功且最终 JSON 同时包含 WheelMaker 与用户站点；Caddy adapter/JSON 校验测试覆盖这些代表性能力。
- 自定义站点使用未知第三方 directive/module、全局 options、重复 WheelMaker 地址、危险 catch-all 或保留 listener → 候选被拒绝并返回包含来源文件、行号及冲突对象的诊断；负向单元测试逐类验证。
- 多个用户入口及其导入依赖以相同磁盘状态重复编译 → 顺序和生成 JSON 确定；新增、修改、重命名、删除入口或导入文件都会改变 fingerprint 并触发测试中的 reload。
- 运行中的合法配置后写入任一错误文件 → 已服务的 WheelMaker 和用户站点、活动 Caddy 配置及 `generated/caddy.json` 均不变化；修复文件后无需重启即整体生效，运行时集成测试验证两次状态转换。
- 首次启动存在错误用户配置 → Gateway 不绑定服务端口且命令失败；`validate`/`serve` 测试验证诊断定位，上一生成物不会被伪装成已接受候选。
- hot-load 因端口绑定或 Caddy 加载错误失败 → 上一活动配置与生成物保留；可注入 reload 失败测试验证候选不会被提升。
- Gateway 安装或升级面对已有 `sites/` 内容 → 目录和文件字节保持不变；Node 部署测试验证初始化幂等且不会读取、转换、停止或修改 Nginx。
- 运维者按文档先离线校验、显式停止 Nginx、再启动 Gateway → 多个二级域名由同一 Gateway 的 80/443 按 Host/SNI 服务；文档示例与可执行 `validate`/`paths` 输出一致。
- 完成实现后 → `docs/wiki/architecture/gateway.md`、README 和 INSTALL 与代码事实一致，Registry protocol version、Hub schema、Release channel 和显式 Nginx 禁用脚本边界未改变；相关协议/部署回归测试及仓库既有 Gateway 测试通过。
