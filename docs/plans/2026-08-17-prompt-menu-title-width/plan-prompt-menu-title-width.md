# Prompt Menu Title-Bar Width Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat title prompt-history dropdown span the title bar's width on all form factors and tighten its row density on desktop pointer devices.

**Scope Source:** `docs/scope/2026-08-17-prompt-menu-title-width.md`（已批准 2026-08-17）

**Architecture:** Position source changes from the trigger button rect to the `.chat-title-bar` element rect (JS remains the single source of menu width); desktop density isolated behind a `@media (hover: hover) and (pointer: fine)` block so touch devices keep the current 40px rows.

**Tech Stack:** React 19 (WorkspaceApp.tsx), plain CSS (chat.css), Jest source-contract tests (web-chat-ui.test.ts), headless Edge screenshots for visual evidence.

**Verification:** `npx jest __tests__/web-chat-ui.test.ts`（目标断言）→ 受影响套件回归 → `npm run tsc:web` → `npm run build:web` → Edge headless 双视口双主题截图。

---

### Task 1: Contract tests for title-bar anchoring and desktop density (RED)

**Files:**
- Modify: `app/__tests__/web-chat-ui.test.ts`

**Acceptance:** New assertions describing the title-bar-anchored positioning and the desktop density media query exist and fail against current code.

- [ ] **Step 1: Write the failing assertions**

In the existing `chat title bar uses breadcrumb context and exposes preview toggle` test, after the current `chatTitlePromptMenuStyle` assertion add:

```ts
    expect(mainTsx).toContain("closest('.chat-title-bar')");
    expect(mainTsx).toContain('left: anchor.left + 8');
    expect(mainTsx).toContain('width: Math.max(280, anchor.width - 16)');
    expect(stylesCss).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.chat-title-prompt-menu-item[\s\S]*?min-height: 36px/,
    );
    const promptMenuItemBlock = cssRuleBlock(stylesCss, '.chat-title-prompt-menu-item');
    expect(promptMenuItemBlock).toContain('min-height: 40px');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx jest __tests__/web-chat-ui.test.ts -t "chat title bar"`
Expected: FAIL on the new `closest('.chat-title-bar')` / media-query assertions (RED).

### Task 2: Anchor the menu to the title bar rect

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（`chatTitlePromptMenuStyle`，约 4338 行）

**Acceptance:** Menu left/width derive from the `.chat-title-bar` element rect with button-rect fallback; Task 1's TS assertions pass.

- [ ] **Step 1: Replace the positioning computation**

```ts
  const chatTitlePromptMenuStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!chatTitlePromptMenuOpen || !chatTitlePromptMenuAvailable || typeof window === 'undefined') {
      return undefined;
    }
    const anchor =
      chatTitlePromptButtonRef.current?.closest('.chat-title-bar')?.getBoundingClientRect() ??
      chatTitlePromptButtonRef.current?.getBoundingClientRect();
    if (!anchor) {
      return undefined;
    }
    return {
      left: anchor.left + 8,
      width: Math.max(280, anchor.width - 16),
    };
  }, [chatTitlePromptMenuAvailable, chatTitlePromptMenuOpen, isWide]);
```

- [ ] **Step 2: Run the contract test**

Run: `cd app && npx jest __tests__/web-chat-ui.test.ts -t "chat title bar"`
Expected: TS assertions pass; the CSS media-query assertion still fails (Task 3 turns it green).

### Task 3: Desktop pointer density rules

**Files:**
- Modify: `app/web/src/styles/chat.css`（`.chat-title-prompt-menu-item` 规则之后追加）

**Acceptance:** Desktop pointers get 36px rows with tighter vertical padding; base (touch) rules unchanged at 40px; rail geometry untouched (horizontal padding stays).

- [ ] **Step 1: Append the media query block**

```css
@media (hover: hover) and (pointer: fine) {
  .chat-title-prompt-menu-item {
    min-height: 36px;
    padding: 4px 10px 4px 8px;
  }
}
```

- [ ] **Step 2: Run the contract test**

Run: `cd app && npx jest __tests__/web-chat-ui.test.ts -t "chat title bar"`
Expected: PASS.

### Task 4: Regression, typecheck, build, and visual evidence

**Files:**
- 无源码改动；证据产物放 `%TEMP%`（截图随报告给用户）。

**Acceptance:** 受影响套件无新增失败；tsc/构建通过；桌面 1440px 与移动 700px 视口截图确认宽度=标题区宽-16 与行密度差异。

- [ ] **Step 1: Focused regression**

Run: `cd app && npx jest __tests__/web-chat-ui.test.ts __tests__/web-chat-prompt-history.test.ts __tests__/web-chat-virtuoso-mount.test.tsx __tests__/web-menu-keyboard-nav.test.ts`
Expected: 与 worktree 基线相同的失败集（仓库现存失败），无新增。

- [ ] **Step 2: Typecheck and build**

Run: `cd app && npm run tsc:web && npm run build:web`
Expected: 无 tsc 错误；webpack compiled successfully。

- [ ] **Step 3: Edge headless screenshots**

用真实 CSS 生成 harness（沿用上次 `%TEMP%/wm-prompt-menu-preview.html` 生成方式，菜单 `style` 改为标题区等宽场景），分别以 `--window-size=1440,400`（桌面密度生效）与 `--window-size=700,760`（触屏密度、近全宽）截图，暗/亮双主题。
Expected: 桌面图行高约 36px、菜单宽约标题区-16；移动图行高 40px、宽度近全屏。

- [ ] **Step 4: Git checkpoint**

验证通过后调用 `git-workflow` checkpoint，提交本任务全部文件（spec/plan 文档、WorkspaceApp.tsx、chat.css、web-chat-ui.test.ts）。记录 commit hash + subject。
