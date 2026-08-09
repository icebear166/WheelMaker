# Animation improvement plans

由 `improve-animations` 审计产出（audit commit `5d9dd66e`，已于 d5994d7a 之后全部实施）。每个计划自包含：精确的 file:line、当前代码、目标值、边界与验证方式，可交给任何 agent（或无上下文模型）执行。执行方式：`improve-animations execute plans/NNN-*.md`，或直接把文件内容交给执行 agent。

## Plans

| # | 标题 | 级别 | 类别 | 状态 |
| --- | --- | --- | --- | --- |
| 001 | Sheet 甩动关闭时退出动画从手势位置继续 | MEDIUM | Interruptibility | DONE |
| 002 | 修正三组浮层的 transform-origin 与锚点错位 | MEDIUM | Physicality & origin | DONE |
| 003 | 悬浮控件拖拽手感：精确跟手、边界阻尼、松手无跳变 | MEDIUM | Gesture | DONE |
| 004 | 高频按钮补齐 :active 按压反馈 | MEDIUM | Physicality | DONE |
| 005 | 动效无障碍三处缺口 | MEDIUM | Accessibility | DONE |
| 006 | 动效时长/曲线字面量归拢到 tokens | MEDIUM | Cohesion & tokens | DONE |
| 007 | 微抛光批量：stagger、tooltip origin、死代码 | LOW | Mixed | DONE |
| 008 | 右键上下文菜单补齐进退场动画 | LOW | Missed opportunity | DONE |
| 009 | Preview workbench 抽屉面板：mobile 补入场、全平台补退场 | MEDIUM | Missed opportunity | DONE |

## 推荐执行顺序

1. **001 → 002 → 003 → 004 → 005**（相互独立，均为高精度小改动；001 是手感收益最大的一条）。
2. **006 在 002、004 之后**（002 会拆分 `chat.css:5191-5196` 的规则、004 会把两条 transition token 化；006 已内置对应的跳过/兼容指令）。
3. **007、008、009 任意时间**（007 的死代码删除与 006 有分工约定：drawer 两条死 transition 归 007 删除，006 不得 token 化它们；009 独立于其他计划）。

依赖冲突点均已写进各计划的 Boundaries；总体原则：发现计划引用与代码不符时停止报告，不即兴。

## 审计确认但决定不做的项（附理由）

- **floating-nav-card 补退出动画**（原 findings #7）：其开关状态是 `gestureNavState` 相位状态机（`WorkspaceApp.tsx:6265` 派生），多个读取方（7136/7268/7422/7448），延迟卸载需要改状态机关闭路径，回归风险大于 LOW 收益。若未来重构 gesture nav，再带上。
- **`sl-list-in` 在折叠/展开重播**（#11）：正确修法是改挂载结构（keepChildrenMounted），为低频感知问题冒结构风险不值。
- **全屏 overlay 的 backdrop-filter 过渡**（#15）：blur 0→2px 在性能预算内，去掉是设计取舍而非错误。
- **侧栏折叠/展开、终端面板开关的"瞬移"**（遗漏机会 M1/M2）：真正顺滑的修法需要布局级动画，`visual-language.md:46` 明确"不做布局级 FLIP 动效"。放弃。
- **文件树节点展开/折叠加动画**（M3 的"树"部分）：文件树是每天几十次的高频面，按频率原则只减不加。注意区分：抽屉**面板**的进出场已提升为计划 009。
- **骨架屏→内容 crossfade**（M4）：四个组件各自的渲染分支都要动手术，收益轻微。后续若做对应组件重构再顺带。
- **次级按钮 `:active` 分组**（`.project-session-menu-btn` 等 8 处）：LOW，等 004 落地后按同一模式随手补。

## 审计确认做对了、不要再动的

- tokens 体系（`--motion-fast/standard/emphasized`、`--ease-standard/--ease-out`）与 `motionContracts.test.ts` 契约测试。
- 键盘触发的 composer 菜单无动画（契约 pin）；tooltip 连续切换即时显示（`Tooltip.tsx:80-84`）。
- sheet 拖拽速度感知回弹（`sheetDragDismiss.ts` + `resolveSheetReleaseDuration`）。
- `chat-turn-entry` 只作用于单个新追加 turn 且 240ms 后清除、reduced-motion 已覆盖。
- 无 `scale(0)`、无 `ease-in` 入场、无 `transition: all`、无布局属性过渡。
