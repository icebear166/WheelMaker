> 由 scope skill 于 2026-07-11 生成

# Chat Body Anchored Runtime Palette

## 目标

修正运行时工作区中“聊天正文是中性黑灰、侧栏与输入框是偏蓝灰”的色相割裂。以聊天正文当前的 `#1e1e1e` 内容平面为唯一中性色基准，让 Chat、Session 列表、标题栏、Settings、Debug、Port Relay 和 Preview chrome 形成一条克制的石墨灰阶；保留蓝色仅作为交互语义，而不是大面积表面底色。

## 决策

- 深色主题的 `--surface-workspace-content: #1e1e1e` 保持不变，作为运行时 UI 的主色和内容基面。
- 深色主题的中性表面改为无明显蓝色偏移的石墨灰阶：画布略暗于正文，侧栏略亮于画布，普通面板和标题栏略亮于正文，局部控件再抬升一档，覆盖层最高。
- 蓝色 `--accent-primary` 只用于主要操作、当前上下文、细窄选中标识和可见焦点；不得作为聊天框、标题栏、列表或弹层的整块底色。
- 聊天框获得焦点时使用低饱和蓝灰的 1px 边框和轻微外晕；取消大面积、高亮蓝色轮廓。
- 会话选中态使用接近正文的石墨灰背景和细窄蓝色标识；不使用明显蓝色整行填充。
- 浅色主题保持同样的“正文内容面为主、层级只靠轻微明度差、蓝色仅表达交互”的关系，不引入新的品牌色或状态色。
- 不改变布局、控件尺寸、图标、字体、动效、路由、功能与内容结构。

## 架构

`tokens.css` 继续是所有运行时色值的唯一来源。仅调整现有 `surface-*` token 的实际深浅和色相关系；组件样式继续使用现有语义 token，不为个别页面重新写入硬编码背景。

```text
chat body / preview content
  └─ surface-workspace-content (anchor)
      ├─ surface-canvas / surface-sidebar (subtle separation)
      ├─ surface-panel (headers, composer, cards)
      ├─ surface-raised (inputs, local controls)
      └─ surface-overlay (menus and temporary layers)

accent-primary
  └─ selected marker, focus border, primary action only
```

## 验收标准

- 深色主题下，聊天正文、代码 Auto 背景和 Chat Preview 内容面的主色仍为 `#1e1e1e`。
- Session 列表、标题栏、聊天框、Settings、Debug、Port Relay 和 Preview chrome 不再呈现独立的蓝灰底色；与正文共用同一石墨灰色相。
- 聊天框的默认与焦点表面均保持克制：焦点仅呈现低强度 1px 蓝灰提示及轻微外晕。
- 会话选中态的主体背景接近石墨灰，蓝色只出现在窄标识和必要的交互反馈中。
- 浅色主题的对应层级仍清晰、可读，并维持同一语义关系。
- File/Git 独立内容页、显式代码主题、diff 语义色、HTML 预览白底、二维码画布和状态色均不改变。

### 测试

- 扩展现有样式契约，锁定深色 token 值和聊天框焦点/会话选中态的 token 公式。
- 运行相关 Chat、Shell、Preview、Settings 和 token 设计测试。
- 运行 TypeScript 检查、完整 Jest 套件与生产 Web 构建。
- 在真实已连接工作区中，检查深浅主题下的宽桌面、窄桌面和竖屏移动端；重点检查聊天正文、列表、标题栏、聊天框和 Preview 之间的色相一致性。

## 范围之外

- 不重做页面布局、移动端交互、会话功能、输入框结构或图标。
- 不引入渐变、背景纹理、图片、GSAP 动效、营销页式 AIDA 结构或新依赖。
- 不调整范围外内容页及其专用颜色。
