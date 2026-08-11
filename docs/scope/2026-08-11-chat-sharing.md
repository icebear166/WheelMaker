> 由 scope skill 于 2026-08-11 生成
> 状态：已批准 2026-08-11

# 回答与会话统一分享

## 目标

把完成回答底部零散的图片与 HTML 导出入口收敛为一个跨平台 Share 菜单，并在保留现有回答分享能力的同时增加完整会话分享。当前回答与完整会话都支持图片、HTML 文件和 Public Share URL，三种输出使用同一份不可变内容快照，确保范围、排版和失败行为一致。

## 决策基线

### 需求边界

- 每条可分享的完成回答继续保留独立的“复制回答”按钮；现有图片与 HTML 两个独立按钮移除，替换为一个 Share 按钮。朗读、Fork、重试等非分享动作不进入 Share 菜单。
- Share 菜单直接分为“当前回答”和“全部会话”两组，每组依次提供“图片”“HTML 文件”“公开 URL”，不增加范围选择弹窗或二级菜单。
- Desktop 使用锚定 Share 按钮的浮动菜单；Android 和其他窄屏使用 bottom sheet。两种宿主共享动作模型、禁用状态和键盘/焦点语义。
- “当前回答”只包含所点击完成节点按现有 `buildPromptDoneCopyRange` 规则得到的助手回答正文，不包含用户提问、思考、工具调用、计划、系统事件或完成状态，保持现有复制、图片和 HTML 导出的内容语义。
- “全部会话”在用户点击具体菜单项时冻结当前选中 Session 的最新内容与展示设置。它包含当时已经终止的用户提问与助手回答，不包含仍在流式生成的半成品，也不会因 Public Share 确认弹窗打开期间又完成新回答而变化。
- 完整会话使用干净对话稿：排除思考、工具调用、计划、权限、系统事件、Session 操作和其他控制面内容。成功回答正常展示；失败、取消或中断的轮次保留已有助手输出，并明确标注 `Failed`、`Cancelled` 或 `Interrupted`。没有助手输出时仍保留用户提问与终止状态。
- 完整会话遇到 `session/gap`、缺失 turn、无法配对的孤立消息或无法解析的非语义内容时静默跳过可疑部分，继续输出其余可恢复问答；不显示缺口占位，也不把缺口扩展为整个分享失败。
- 用户消息中的图片和其他附件都只输出可得的文件名；缺少名称时使用通用的 `Image attachment` 或 `File attachment` 标签。不得嵌入附件数据、缩略图、本地 URI、公开下载地址或文件正文。助手回答正文自身引用的 Markdown 图片继续沿用现有 HTML 导出的解析、嵌入与警告规则。
- 完整会话采用独立对话文档版式：顶部显示 Session 标题和快照时间，正文按 User / Assistant 分段；不包含 Workspace 导航、输入框、回答操作按钮或其他应用 chrome。当前回答继续使用现有单篇 Markdown 文档版式。
- 图片输出为单个 PNG，不拆页、不打包且不截断。渲染器可以在 `1..2` 范围内降低 pixel ratio 以适配长图，但最终位图任一边不得超过 16,384 px、总像素不得超过 16,000,000；即使在 `1x` 下仍超限时，在生成或调用平台交付前失败，并提示改用 HTML 文件或公开 URL。
- HTML 文件输出继续使用可编辑文件名确认流程并生成单个自包含 HTML；当前回答使用回答默认名，完整会话使用经过文件名清理的 Session 标题与快照时间作为默认名。
- 图片和 HTML 文件延续现有平台交付语义：普通浏览器下载；Windows Desktop 把图片或 HTML 文件放入系统剪贴板；Android 调起系统分享面板。现有原生 bridge 的单图片和单 HTML 文件契约不扩展为多文件协议。
- 点击“公开 URL”后复用现有 Public Share 创建弹窗。菜单动作已经确定并冻结来源范围；弹窗只负责显示 Share 服务状态、编辑标题、选择有效期并确认创建。有效期继续默认 1 天，并支持现有 1 小时、1 天、7 天、30 天和永久选项；成功后自动复制链接并保留显式复制按钮。
- 新建的回答与会话 Public Share 和现有项目文档分享统一出现在 Public Shares 管理页。记录需显示可辨识的来源类型、标题和 Session 上下文，并继续支持复制链接、分页与停止分享；不新增访问统计、编辑或重新生成动作。
- 回答/会话 URL 仍是创建时内容的不可变单 HTML 快照。后续 Session 继续对话、重命名、归档或删除不会修改或撤销既有链接；链接只受现有到期、手动停止和 Share 服务配置控制。
- Share 服务未配置或暂时失效时，公开 URL 菜单项仍可进入现有创建弹窗查看状态，但创建保持禁用；图片和 HTML 文件不受 Share 服务状态影响。
- 当前回答没有可分享的助手正文时，其三种分享动作不可执行。完整会话没有任何可恢复用户轮次、助手正文或终止状态时，其三种分享动作不可执行。生成、压缩、剪贴板、下载、原生分享或 `share.create` 失败时显示明确错误，不发布、交付或声称生成了残缺结果。

### 技术决策

- App 增加纯函数式聊天分享投影层，从选中 Session 的完整 raw turn store 构建不可变 `response` 或 `session` 快照。它负责 turn 排序与配对、最终回答提取、终止状态归一化、缺口跳过和附件降级；菜单、渲染器和输出适配器不得各自重新解释 raw turns。
- 分享快照同时冻结 Session 标题、快照时间、主题、代码主题、字体与 Markdown 渲染设置。图片、HTML 文件和 Public Share 都消费该快照；Public Share 弹窗持有冻结快照而不是在确认时重新读取当前 Session。
- 当前回答投影复用并扩展现有 `buildPromptDoneCopyRange` 的回答正文语义。完整会话投影以 `prompt_request` / `user_message_chunk` 与后续 `prompt_done` 终止边界组成角色条目，并以同一正文规则拼合范围内的 `agent_message_chunk` 构建 Assistant 内容，不包含 thought/tool/plan 内容。
- 新增共享的聊天分享文档渲染面。它接受规范化快照并生成相同语义的隐藏 DOM：图片路径从该 DOM 输出 PNG，HTML 路径把该 DOM 序列化为 standalone document，Public Share 路径上传同一份 standalone HTML。不得用三套独立字符串拼接实现三个格式。
- Markdown 内容继续使用现有 React Markdown、sanitization、代码高亮、公式、Mermaid 和图片解析能力。会话角色、标题、时间、附件标签和失败状态由文档外壳渲染，不通过拼接未转义 HTML 注入。
- 图片渲染在调用 `html-to-image` 前根据布局后的 CSS 尺寸与候选 pixel ratio 做确定性预检；优先保留最高不超过 `2x` 的比例，最低为 `1x`。超过边长或总像素限制时直接返回专用的 `too_large` 结果，所有平台显示相同的替代方式提示。
- 现有图片与 HTML 平台输出适配器保持交付所有权；它们只接收新渲染器产出的单个 Blob/HTML 和文件名。Android user-action reservation 仍必须发生在用户点击具体图片/HTML 菜单项的调用链内。
- Public Share 元数据增加来源判别 `project_document | chat_response | chat_session`，聊天来源保存 Project ID、Session ID，并在回答来源中保存终止 turn index；项目文档来源继续保存 path 和 Markdown/HTML kind。公开正文只包含生成后的 HTML，不包含可用于访问 Registry 或附件的认证信息。
- `share.create` 的现有平面 payload 增加可选 `sourceType`、`sessionId` 和 `turnIndex`：省略 `sourceType` 时按旧版 `project_document` 处理并继续要求有效的 `path`/`kind`；`chat_response` 与 `chat_session` 要求 `projectId` 和 `sessionId`、不要求文件路径，其中回答来源还要求正整数 `turnIndex`。`share.list` 的记录返回相同的来源判别与可选上下文。方法名、路由和 Registry protocol version 均不改变；新 Registry 必须继续接受现有项目文档 create payload，旧客户端可以忽略 list response 的新增字段。
- 新 Share record 明确写为 schema 2；读取、修复、列出、到期和删除必须继续识别现有 schema 1 项目文档记录，并在内存中投影为 `project_document`，不要求批量迁移或重写旧记录。字段缺失、互斥字段同时出现或来源组合无效时继续 fail closed。
- Registry 保持现有 16 MiB 解压后 UTF-8 HTML 上限、完整 WebSocket envelope 上限、gzip+base64、随机 bearer token、原子发布、到期清理和 Gateway 静态匿名服务边界。Session 分享不增加附件目录、公开 API、认证例外、访问日志或容量配额。
- Public Shares 管理页按来源判别生成显示描述；项目文档继续显示项目路径，回答与会话显示 Session 标题、来源范围和必要的 turn 上下文。管理动作仍只基于 token，源 Session 是否存在不影响复制或停止分享。

## 设计视图

### 系统结构

```text
selected Session raw turns
        │
        ▼
chat share projector ── freeze scope/content/title/time/theme
        │
        ▼
shared chat document renderer
        ├─ size preflight + html-to-image ── PNG ── browser/Desktop/Android output
        ├─ standalone serializer ────────── HTML ── browser/Desktop/Android output
        └─ standalone serializer ────────── HTML ── existing Public Share dialog
                                                     │ gzip+base64 / share.create
                                                     ▼
                                              Registry share store
                                                     │
                                                     ▼
                                              anonymous bearer URL
```

### 关键结构

- **分享动作模型**：由 `scope × format` 唯一标识，`scope` 为 `response | session`，`format` 为 `image | html | public_url`。菜单宿主只负责呈现、焦点和选择，业务层负责冻结快照与执行动作。
- **聊天分享快照**：包含来源标识、标题、快照时间、渲染设置和有序角色条目。角色条目只允许 User/Assistant；可选附件标签只含显示名，可选终止状态只允许失败、取消和中断三种公开状态。
- **Public Share 来源**：项目文档、聊天回答和完整会话是并列来源；来源元数据用于认证管理页识别，匿名路由仍只按随机 token 返回不可变 HTML。

### 关键流程

1. 用户点击某个回答的 Share 按钮；菜单根据该回答是否有正文、当前 Session 是否有可恢复条目以及正在进行的输出任务计算六个动作的可用状态。
2. 用户选择具体动作；App 在同一用户手势链内构建并冻结对应快照，关闭菜单。Session 分享读取当前完整 raw turn store，但忽略尚未终止的尾部。
3. 图片或 HTML 动作立即进入共享渲染面；图片先执行尺寸预检，HTML 先进入文件名确认。生成成功后交给现有平台适配器。
4. 公开 URL 动作把冻结快照交给现有 Public Share 弹窗；用户确认后才渲染 standalone HTML、压缩并调用 `share.create`。创建失败不留下公开文件；成功后显示并复制链接。
5. Registry 将来源元数据和公开 HTML 原子持久化。管理页通过 `share.list` 同时呈现项目文档、回答和会话记录；停止分享继续通过 token 幂等删除。

### 预估改动面

- `app/web/src/chat/`：增加聊天分享投影、共享文档模型与自适应菜单；扩展回答完成节点的动作接口，并补充投影、菜单、尺寸限制和渲染测试。
- `app/web/src/chat/export/` 与 `app/web/src/shares/`：把现有回答 Markdown 图片/HTML 能力推广到规范化聊天文档，复用平台输出与 Public Share 创建弹窗，并验证三种输出内容一致。
- `app/web/src/app/WorkspaceApp.tsx`、相关样式与 App 测试：接入冻结快照、busy/error 状态、Desktop popover、移动 bottom sheet 和 Public Shares 管理页来源展示。
- `app/web/src/registry/`：扩展 Share wire types、repository 解析和 workspace service 契约，同时保留项目文档 payload/response 兼容。
- `server/internal/registry/` 与 `server/internal/protocol/`：扩展 create/list 来源元数据、Share record schema、校验和旧记录读取，保持现有 route、method 与 protocol version。
- Desktop 与 Android 原生层预计不改协议；回归现有单 PNG、单 HTML user-action reservation、分块传输和系统交付测试，只有发现共享输出无法复用既有 bridge 时才重新进入 scope。
- 已确认 wiki 目标：新建 `docs/wiki/features/chat-sharing.md`，并更新 `docs/wiki/features/public-sharing.md`。

## 验收

- **回答动作收敛** → 每个有可分享正文的完成回答只显示一个 Copy 和一个 Share 入口，不再显示独立图片/HTML 按钮；朗读、Fork、重试保持原语义；以 ChatTurnView 组件测试和 Desktop/移动布局测试为证据。
- **自适应菜单** → Desktop 菜单锚定触发按钮，窄屏为 bottom sheet；两者直接显示两个范围组和六个动作，支持键盘导航、Escape/外部点击关闭、焦点恢复与禁用态；以组件交互和可访问性测试为证据。
- **当前回答范围** → 对含用户提问、thought、tool、plan、多段 agent message 和 prompt_done 的 turn 范围，三种输出都只包含拼合后的助手最终 Markdown；以投影单元测试及 PNG/HTML/Public Share 共用快照断言为证据。
- **完整会话范围** → 输出包含点击时所有已终止的用户/助手条目，忽略流式尾部和控制面 turn；失败、取消、中断条目保留内容并显示对应状态；以混合 Session fixture 的投影与渲染测试为证据。
- **缺口与附件降级** → `session/gap`、孤立消息和不可解析内容被静默跳过，其余问答仍保持顺序；图片与文件附件只出现名称或通用附件标签，生成的 HTML 不含其 base64、URI、缩略图或正文；以恶意/缺失数据 fixture 和序列化 HTML 断言为证据。
- **不可变点击快照** → 打开 Public Share 弹窗后再向 Session 加入完成回答或修改标题/主题，最终 URL 内容仍等于点击菜单项时的内容与展示设置；以状态编排测试为证据。
- **共享文档版式** → 完整会话图片、HTML 和 URL 均显示相同标题、快照时间、User/Assistant 顺序、Markdown 富文本与终止状态，且不包含 Workspace chrome；以 renderer 组件测试和 standalone HTML 快照测试为证据。
- **图片安全上限** → 限制内选择不高于 `2x` 的最大可用 pixel ratio 并生成单 PNG；任一边超过 16,384 px 或总像素超过 16,000,000 且无法降至 `1x` 适配时，不调用 `html-to-image` 或平台交付，显示使用 HTML/URL 的错误；以边界尺寸单元测试为证据。
- **HTML 与平台交付** → 当前回答和完整会话均经过文件名确认并生成单 HTML；浏览器下载、Desktop 剪贴板、Android 系统分享分别继续走现有适配器，Android reservation 位于直接点击动作链内；以现有 output 测试扩展和 bridge contract 测试为证据。
- **Public Share 创建** → 两个 URL 动作打开现有弹窗并显示已冻结的范围、可编辑标题、服务状态和有效期；创建成功得到不可变链接并自动复制，服务关闭、内容超限、压缩或 Registry 失败时不发布残缺结果；以前端 ShareManager 测试和 Registry create/store 测试为证据。
- **统一管理与生命周期** → 管理页正确区分项目文档、聊天回答和完整会话，且所有类型都能分页、复制和停止；Session 后续更新、归档或删除不改变既有链接；以 repository/UI 测试和 Registry list/delete/expiry 测试为证据。
- **向后兼容** → schema 1 项目文档记录在升级后仍能读取、列出、公开访问、到期和删除；旧项目文档 create payload 继续成功，现有文件分享入口与快照语义不变，Registry protocol version 未修改；以 Go 兼容 fixture、现有 Public Share 前端/服务端测试和协议常量测试为证据。
- **完成门禁** → 相关前端单元/组件测试、`app` 类型检查与 Web build、`server` Share/Registry 测试及完整 `go test ./...` 均通过，且任务 diff 不包含主工作树开始前的无关文件修改。
