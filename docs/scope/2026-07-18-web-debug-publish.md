> 由 scope skill 于 2026-07-18 生成

# Hub 驱动的版本发布与临时 Web 发布

## 目标

在 Settings 中提供由 Hub 执行的发布控制面。操作者选择一个拥有 WheelMaker 源码的发布 Hub 与该机器上的源码目录，可选择另一个 Server Hub 作为应用目标，并决定是否在发布成功后自动拉取。页面提供“发布版本”和“发布临时 Web”两个独立动作：前者沿用当前完整版本发布到 Release Server 的流程，后者只构建 Web 并发布一个不影响正式版本的最新临时快照。页面关闭后，已被发布 Hub 接受的任务必须继续执行；重新打开页面可以恢复发布 Hub 的任务状态和日志。

## 决策

- 发布 Hub 与 Server Hub 是独立角色，可以是不同机器。发布 Hub 上的源码目录是绝对路径，由操作者在 Settings 中填写；Server Hub 不需要源码目录。
- Settings 的发布 Hub、源码目录、Server Hub 和 auto pull 开关仅保存在当前浏览器本地，不同步到 Hub 配置，也不含任何凭据。
- auto pull 只有在已绑定 Server Hub 时才能开启；未绑定时开关禁用且两个发布动作不会发出应用通知。
- 发布版本始终是正式 Release Server 发布，保留“包含 Desktop”和“包含 Android”两个选项；不在此页面提供只构建不上传模式。
- 发布临时 Web 只构建 Web、上传独立 Debug Web 快照，不递增 `v1.x`，不写 `stable.json`、`publish-status.json` 或正式发布历史。
- 临时 Web 只保留最新一份。成功上传完整包并完成校验后才原子切换当前 Debug Web 指针；旧快照在新快照成为当前后清理。
- Web 的 Release Server base URL 继续只来自构建时导入的 `scripts/release/channel.json`。页面不显示或保存 URL；它在每个任务请求中传给 Hub，Hub 不将其写入持久配置。
- 发布 Hub 自行维护发布 Token。前端不读取、保存或传输 Token；Hub 缺少凭据或鉴权失败时，以脱敏任务错误结束。
- auto pull 开启时，发布 Hub 在成功发布后通过现有 Registry 控制路由通知绑定的 Server Hub。通知只含发布类型和 HTTPS base URL：正式版本触发既有 stable 更新，临时 Web 触发专用 Debug Web 拉取。关闭时不发送通知，也不提供手动拉取按钮；临时 Web 不会自动生效，正式版本仍可由既有定时更新获得。
- 前端只流式或轮询读取发布 Hub 的构建和上传日志。Server Hub 只返回拉取/应用的最终状态，不返回过程日志。
- 不修改 Registry protocol version。

## 架构

### Settings 发布控制面

Settings 新增发布区，包含：发布 Hub 选择、发布 Hub 源码目录、可选的 Server Hub 选择、auto pull 开关，以及两个发布动作。浏览器本地状态还记录最近一次已接受的发布任务标识，以便页面重新打开后向发布 Hub 查询状态和日志。

前端从已构建的 release channel 得到 HTTPS base URL，并在创建任务时发送给发布 Hub。任务 payload 不包含 Token、任意下载文件路径、Server Hub 的 Web 目录或用户提供的下载 URL。

### 发布 Hub

发布 Hub 是唯一执行构建和上传的参与者。它先验证自己可访问所填源码目录，再启动持久后台任务，因而浏览器断开不会取消任务。发布版本在该目录执行现有正式发布流程，使用 Desktop、Android 选项和发布 Hub 本地受保护的 Token 配置。临时 Web 在该目录执行 Web release 构建，复用正式构建的 release channel、Webpack 缓存和发布锁，但不读取或分配正式版本号，也不调用正式发布 API。

发布 Hub 将临时 Web ZIP、准确大小和 SHA-256 上传到 Release Server 的独立 Debug Web API。正式发布和临时 Web 发布共享同一发布 Hub 构建锁，避免同时修改同一源码目录下的 Webpack、Go 或发布工作目录。

### Release Server Debug Web 通道

Release Server 增加与正式 `/api/publish/*` 隔离的、同样使用 Bearer Token 鉴权的 Debug Web 上传和提交通道。它只接受一个声明大小和 SHA-256 的 Web ZIP，限制体积、保存到自身 staging，且仅在完整上传和 digest 校验成功后更新公开的当前指针。

公开读取面固定在当前 Release Server origin 下：当前元数据文档包含 schema、ZIP 的同源路径、大小、SHA-256 和发布时间；ZIP 与元数据均禁止长期缓存。新的成功提交先使新 ZIP 可用，再原子替换元数据指针。上传、校验或提交失败时，当前指针和 Server Hub 正在服务的 Web 保持不变。

### Server Hub 应用器

收到 auto pull 通知的 Server Hub 只使用发布 Hub 传递的 HTTPS base URL 加固定 Debug Web 元数据路径发现快照。它验证元数据 schema、同源 ZIP 路径、大小和 SHA-256，下载 ZIP 到自身 staging，安全解压到同一文件系统内的临时 Web 目录，并原子替换自身配置的 Web 目录。目标目录由该 Hub 自己的安装根推导，例如 root 用户的 Hub 是 `/root/.wheelmaker/web`；不由发布 Hub、前端或 Release Server 指定。

Debug Web 应用与既有 Hub/Web 版本更新使用同一安装更新排他锁，不能并行替换 `web/`。Server Hub 只向发布 Hub 返回接受、成功或失败的最终状态和通用错误码。下载、SHA 校验、ZIP 校验、解压或目录切换失败时，旧 Web 目录继续可用。

## 流程

### 发布版本

```text
Settings 选择发布 Hub、源码目录、Desktop/Android 和 auto pull
  -> 发布 Hub 后台执行正式发布
  -> 现有 Release Server 事务上传版本资产并更新 stable.json
  -> auto pull 开启：发布 Hub 通知绑定 Server Hub 执行既有 stable 更新
  -> 前端读取发布 Hub 日志；仅显示 Server Hub 最终状态
```

### 发布临时 Web

```text
Settings 选择发布 Hub、源码目录和 auto pull
  -> 发布 Hub 后台只构建 Web release
  -> 上传并提交最新 Debug Web ZIP 到 Release Server
  -> auto pull 开启：发布 Hub 通知绑定 Server Hub 拉取 Debug Web 元数据
  -> Server Hub 校验、解压并原子替换自身 web/
  -> 前端读取发布 Hub 日志；仅显示 Server Hub 最终状态
```

auto pull 关闭时，两个流程都在发布成功后结束；不会提供额外的手动应用操作。

## 验收标准

- Settings 可以在浏览器本地保存并恢复发布 Hub、源码目录、Server Hub 和 auto pull，不保存 Token 或可编辑 Release Server URL；没有 Server Hub 时 auto pull 不能开启。
- 发布 Hub 和 Server Hub 可以不同；发布 Hub 无法访问 Server Hub 的 Web 目录，Server Hub 不需要发布源码。
- 发布版本只提供 Desktop、Android 选项，成功时保持现有 `v1.x`、`stable.json`、发布状态和历史语义。
- 临时 Web 发布不修改任何正式发布元数据，只在 Release Server 保留一个最新、经 SHA-256 校验的 ZIP 和当前元数据指针。
- 页面关闭或刷新不会取消已接受的发布任务；重新进入 Settings 能恢复发布 Hub 的任务状态和日志。
- auto pull 开启时，正式版本请求绑定 Server Hub 的 stable 更新，临时 Web 请求其 Debug Web 应用；关闭时不产生这些请求，也没有手动应用按钮。
- Server Hub 的 Debug Web 应用只从固定元数据路径发现同源 HTTPS ZIP，且在成功校验和安全解压后才原子替换自己的 Web 目录。
- Debug Web 失败不会影响正式 stable、正式发布历史或正在服务的旧 Web；Server Hub 返回最终失败状态而不是过程日志。
- 前端只显示发布 Hub 的构建/上传日志，且日志与错误不泄漏发布 Token。

### 测试

- Web 测试覆盖本地设置恢复、两个动作的字段与禁用状态、发布 Hub 日志恢复、Server Hub 终态展示，以及无 Token/URL 输入控件。
- Hub 测试覆盖源码目录验证、任务脱离请求生命周期、正式发布参数映射、Debug Web 构建/上传、单构建锁、auto pull 通知和脱敏失败。
- Release Server 测试覆盖 Debug Web API 鉴权、文件大小/摘要/ZIP 名称限制、原子当前指针切换、并发提交和正式发布元数据不变。
- Server Hub 测试覆盖固定元数据路径、HTTPS/同源限制、ZIP 目录穿越和链接拒绝、SHA/大小校验、与普通更新互斥及失败时保留旧 Web。
- 不在自动测试中访问真实 Release Server、使用真实发布 Token、构建真实生产包或替换用户机器的 Web 目录。

## 范围之外

- Debug Web 的历史快照、版本回退、指定快照选择或手动应用。
- 在 Settings 中编辑 Release Server URL、发布 Token 或 Server Hub Web 目录。
- Server Hub 的过程日志流、浏览器直接上传 ZIP 或浏览器本地执行构建。
- 将临时 Web 写入正式 stable 元数据、发布历史或安装包。
- 修改 Registry protocol version、发布 Desktop/Android 以外的新客户端资产，或改变既有定时 stable 更新策略。
