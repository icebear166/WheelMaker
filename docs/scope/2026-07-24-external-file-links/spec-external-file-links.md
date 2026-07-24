> 由 scope skill 于 2026-07-24 生成

# External File Links

## 目标

聊天消息中的本地文件链接目前只能预览项目根目录内的文件：前端虽然能识别部分项目外绝对路径，但仍通过受项目根目录约束的 `project.fs.info` / `project.fs.read` 请求读取，Hub 因而返回 `path escapes project root`。本次改动让已认证的 WheelMaker 客户端可以预览所选项目所在 Hub 主机上的任意本地文件，同时保留现有项目文件接口、缓存、同步、索引和目录树的边界；文件链接还要提供就地右键菜单，统一多端的路径复制能力，并在 WheelMaker Desktop 中提供 VS Code 和文件管理器动作。

## 决策

- **项目外文件的读取范围是什么？** 允许读取所选项目所在 Hub 主机上的任意本地文件。这是经确认的信任边界扩展，使用独立的只读 Registry 方法承载，不放宽现有 `project.fs.info` / `project.fs.read` 方法。
- **哪些链接算本地文件链接？** 支持项目内相对路径、逃出项目根目录的相对路径、Windows 盘符或 UNC 绝对路径、POSIX 绝对路径、`file://` URI 和 `vscode://file` URI，并保留现有行号后缀与锚点解析。其他 URI scheme 继续按普通链接处理。
- **项目外文件是否进入现有文件数据链路？** 不进入。外部文件不参与持久化 cache、条件缓存、文件同步、目录树、文件索引或搜索；已经打开的 preview tab 可以在当前页面状态中暂存本次读取结果。
- **右键菜单提供什么？** 项目内文件显示 `Copy relative path` 和 `Copy absolute path`；项目外文件只显示 `Copy absolute path`，不显示相对路径动作。复制结果只包含路径，不附带链接中的行号。链接菜单复用 preview 已有文件动作的语义，现有 preview 菜单及其动作继续保留。
- **哪些能力是 Desktop 专属？** 只有 `Open with VS Code` 和 `Show in File Explorer`。它们在 Desktop 的项目内、项目外文件菜单中都可用；浏览器端不显示。点击预览和路径复制在各端保持一致。
- **如何处理协议兼容？** 新增 Registry 方法但不修改 protocol version。新 App 连接旧 Hub 时，项目内文件维持现状；项目外文件显示明确的“不支持外部文件预览”错误，不回退到受限项目文件方法。
- **是否沉淀长期文档？** 新建 `docs/wiki/features/file-links.md` 记录稳定的文件链接行为，并更新 `docs/wiki/protocols/registry.md` 记录新增方法及信任边界；在本 spec 获批后同步。

## 架构

前端把聊天链接解析成带有路径范围的本地文件引用：`project` 表示规范化后仍在聊天所属项目根目录内，`external` 表示绝对路径或规范化后逃出项目根目录。项目引用继续使用现有 `project.fs.info` / `project.fs.read`；外部引用使用新增的增量式 Registry 方法 `project.fs.external.info` / `project.fs.external.read`。两类请求都携带聊天所属 `projectId`，以便 Registry 将请求路由到拥有该项目的 Hub；外部方法只接受宿主机绝对路径。

Hub 对外部路径进行宿主机语义下的绝对路径清理和文件检查，然后返回可用于显示与复制的绝对路径及现有 preview 所需的文件元数据或内容。外部读取不接受 `knownHash`，App 不向 `workspaceStore` 或目录缓存写入结果。

文件链接右键菜单基于同一个本地文件引用渲染。绝对路径复制在前端由聊天项目根目录和链接目标确定；仅当目标位于项目根目录内时才生成并展示项目相对路径。Desktop 通过受现有可信页面授权策略保护的绝对文件动作 bridge 启动固定的 VS Code 或 Windows File Explorer 进程；浏览器端没有这些 bridge。

```text
chat file link
    |
    +-- project path  --> project.fs.info/read --------+
    |                                                  |
    +-- external path --> project.fs.external.info/read+--> preview
    |
    +-- context menu --> copy path
                       Desktop only: VS Code / Explorer
```

## 流程

1. Markdown renderer 使用聊天所属项目的 `projectId` 和项目根目录解析链接，得到规范化路径、可选行号和 `project` / `external` 范围。
2. 普通点击沿现有 preview workbench 打开文件 tab。项目文件走原请求；外部文件走独立请求。大文件确认、二进制判断、错误 tab 和行号跳转沿用现有 preview 行为。
3. 右键点击已识别的文件链接时阻止浏览器原生菜单，并在指针位置打开文件菜单；点击空白处、按 Escape、选择动作、滚动或调整窗口尺寸时关闭菜单。
4. 项目内菜单可复制相对于聊天项目根目录的路径或绝对路径；项目外菜单只能复制绝对路径。
5. Desktop 菜单额外调用绝对文件 bridge。Bridge 验证参数是绝对路径并检查目标是现存普通文件，然后启动 VS Code，或让 File Explorer 选中该文件。失败通过现有 toast/error 呈现。

## 验收标准

- 项目内文件链接继续正常预览，且不改变现有项目文件 cache、目录树、索引和恢复行为。
- 项目外的 Windows/POSIX 绝对路径、UNC 路径、`file://` URI、`vscode://file` URI 和 `../` 相对路径可以在各端打开 preview。
- 外部文件 preview 使用所选聊天项目对应的 Hub；不存在、不可读、目录和不支持的旧 Hub 都产生明确错误，不误读其他项目或静默回退。
- 外部文件读取不会发送 `knownHash`，不会写入文件或目录持久化 cache，也不会加入目录树、索引或搜索。
- 所有已识别的文件链接都可通过右键菜单复制绝对路径，且结果不包含行号。
- 只有项目内文件显示 `Copy relative path`；项目外文件不渲染该动作。
- WheelMaker Desktop 的项目内和项目外文件菜单都显示并可执行 `Open with VS Code` 与 `Show in File Explorer`。
- preview 现有的复制绝对路径、VS Code 和 File Explorer 动作继续可用；外部文件 preview 使用绝对文件动作。
- 非 Desktop 环境不显示 VS Code 和 File Explorer 动作，其余点击、preview 和复制行为一致。
- 普通网页链接、Relay 链接和无法识别的 URI 保持原行为，不被文件右键菜单接管。
- Registry protocol version 保持不变，新增方法不会改变现有 `project.fs.info` / `project.fs.read` 的路径校验。

### 测试

- 前端路径解析单元测试覆盖项目内路径、`../`、Windows/POSIX 绝对路径、UNC 路径、两种文件 URI、行号、跨盘符路径和非文件 URI。
- 前端交互测试覆盖普通点击、项目内/外右键菜单差异、剪贴板内容、菜单关闭行为、Desktop bridge 可见性和旧 Hub 错误。
- Repository/Service 测试验证项目路径与外部路径选择正确的 Registry 方法，外部请求没有 `knownHash`，且不触发持久化 cache。
- Hub 测试覆盖外部普通文件 info/read、缺失文件、目录、不可读文件、二进制文件、绝对路径校验和 project-to-Hub 路由；现有项目根目录逃逸测试继续通过。
- Windows Desktop 测试覆盖绝对路径校验、现存普通文件、VS Code 启动参数、Explorer 选中文件、缺失文件以及可信页面授权策略。
- 运行相关 Jest、Go 测试、Web TypeScript 检查和构建级验证。

## 范围之外

- 不支持从外部路径浏览目录、构建目录树、搜索、索引或同步。
- 不增加外部文件写入、编辑、删除、上传或附件转换能力。
- 不为普通浏览器增加启动本机 VS Code 或文件管理器的能力。
- 不新增移动端长按手势；本次只处理浏览器 `contextmenu` 事件。
- 不修改 Registry protocol version，不要求新 App 对旧 Hub 模拟外部文件读取。
