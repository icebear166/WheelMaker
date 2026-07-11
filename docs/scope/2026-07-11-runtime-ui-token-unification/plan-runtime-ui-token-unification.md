# Runtime UI Semantic Token Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all in-scope runtime UI surfaces use the existing semantic token system consistently across desktop and mobile, while preserving File/Git content pages and content-specific rendering colors.

**Architecture:** Keep `tokens.css` as the sole source of visual values. Migrate in-scope CSS from compatibility aliases to direct semantic roles, then normalize custom selection and status colors to `accent-*` and `state-*`. Use source-level CSS contract tests to prevent regressions without changing React structure, persistence, routes, or behavior.

**Tech Stack:** React, TypeScript, vanilla CSS, Jest, webpack.

---

## Files and responsibilities

- `app/web/src/styles/tokens.css`: retain the authoritative token vocabulary and compatibility aliases for File/Git-only styles.
- `app/web/src/styles/base.css`: use semantic tokens for global controls, feedback and selected rows.
- `app/web/src/styles/shell.css`: use semantic tokens for the application canvas, desktop shell, sidebar, drawer, dialog, menu and selected navigation surfaces.
- `app/web/src/styles/surfaces.css`: use semantic tokens for shared titles and tool controls.
- `app/web/src/styles/chat.css`: use semantic tokens for chat chrome, composer, menus, session selection, plan surfaces, voice controls and feedback states.
- `app/web/src/styles/code.css`: use semantic tokens for Markdown/Mermaid chrome while preserving Shiki, diff and HTML preview colors.
- `app/web/src/styles/file.css`: change only Chat Preview, Preview Workbench and chat file-mention chrome; do not modify File page selectors.
- `app/web/src/styles/settings.css`, `app/web/src/styles/debug.css`, `app/web/src/styles/portRelay.css`: complete the settings-family migration and normalize state colors.
- `app/__tests__/web-ui-design-system.test.ts`: lock down the token vocabulary and the no-legacy-alias contract for in-scope styles.
- `app/__tests__/web-responsive-shell.test.ts`, `app/__tests__/web-chat-ui.test.ts`, `app/__tests__/web-chat-file-peek-viewer.test.ts`: preserve shell, chat and preview visual seams.
- `app/__tests__/web-settings-navigation.test.ts`, `app/__tests__/web-registry-debug-settings.test.ts`, `app/__tests__/web-port-relay-settings.test.ts`: preserve settings, logs and Port Relay seams.

### Task 1: Lock down semantic migration boundaries with failing contract tests

**Files:**

- Modify: `app/__tests__/web-ui-design-system.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-settings-navigation.test.ts`

- [x] **Step 1: Write the failing runtime token migration test.**

  In `web-ui-design-system.test.ts`, add a test that reads the eight in-scope style files and requires the semantic vocabulary directly:

  ```ts
  test('uses semantic tokens directly throughout the runtime chrome', () => {
    const runtimeStyles = [
      'web/src/styles/base.css',
      'web/src/styles/shell.css',
      'web/src/styles/surfaces.css',
      'web/src/styles/chat.css',
      'web/src/styles/code.css',
      'web/src/styles/settings.css',
      'web/src/styles/debug.css',
      'web/src/styles/portRelay.css',
    ].map(read).join('\n');
    const tokens = read('web/src/styles/tokens.css');

    expect(tokens.match(/--surface-workspace-content:/g)).toHaveLength(2);
    expect(tokens.match(/--state-info:/g)).toHaveLength(2);
    expect(runtimeStyles).not.toMatch(/var\(--(?:bg|panel|panel-2|panel-3|text|muted|border|accent|danger)\)/);
  });
  ```

  Add a second test that reads only `shell.css`, `chat.css`, `debug.css` and `portRelay.css`, then requires that it does not contain the old non-content chrome colors:

  ```ts
  expect(runtimeChrome).not.toMatch(/#094771|#4fbf6b|#f46d6d|#d29922|#3fb950|#ff7b72|#18a999|#5eead4|#ff8a82/);
  expect(runtimeChrome).toContain('var(--accent-primary)');
  expect(runtimeChrome).toContain('var(--state-success)');
  expect(runtimeChrome).toContain('var(--state-warning)');
  expect(runtimeChrome).toContain('var(--state-danger)');
  expect(runtimeChrome).toContain('var(--state-info)');
  ```

  Do not include `file.css`, `git.css`, syntax-highlight output, diff colors, QR canvas colors, HTML preview colors, or the Windows close-button color in either assertion.

- [x] **Step 2: Extend existing feature contracts with semantic expectations.**

  Add these exact assertions without changing existing behavioral assertions:

  ```ts
  // web-chat-ui.test.ts
  expect(stylesCss).toMatch(/\.wide-session-row\.selected \{[\s\S]*background: color-mix\(in srgb, var\(--accent-primary\) [\d]+%, var\(--surface-sidebar\)\);[\s\S]*\}/);
  expect(stylesCss).toMatch(/\.voice-input-button \{[\s\S]*var\(--state-info\)[\s\S]*\}/);

  // web-settings-navigation.test.ts
  expect(settingsCss).not.toMatch(/var\(--(?:bg|panel|panel-2|panel-3|text|muted|border|accent|danger)\)/);
  expect(portRelayCss).toContain('var(--state-warning)');
  expect(portRelayCss).toContain('var(--state-success)');
  expect(debugCss).toContain('var(--state-warning)');
  ```

- [x] **Step 3: Run the focused contracts and verify they fail.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-ui-design-system.test.ts web-chat-ui.test.ts web-settings-navigation.test.ts
  ```

  Expected: FAIL because the in-scope styles still reference compatibility aliases and hard-coded chrome/status colors.

### Task 2: Migrate base, shell and shared control chrome to semantic roles

**Files:**

- Modify: `app/web/src/styles/base.css`
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/web/src/styles/surfaces.css`
- Modify: `app/__tests__/web-responsive-shell.test.ts`
- Modify: `app/__tests__/web-ui-design-system.test.ts`

- [x] **Step 1: Replace compatibility aliases according to component role.**

  In the three target stylesheets, replace each in-scope compatibility alias with the following direct role mapping. Do not apply a global string replacement to the excluded File/Git stylesheets.

  ```text
  Application and modal backdrops:       --surface-canvas
  Desktop and mobile side navigation:    --surface-sidebar
  Workspace/page panels and dialogs:     --surface-panel
  Inputs and local raised controls:      --surface-raised
  Menus, popovers and temporary layers:  --surface-overlay
  Primary text / secondary text:         --text-primary / --text-secondary
  Default / strong borders:              --border-subtle / --border-strong
  Selection and primary action:          --accent-primary / --accent-hover
  Destructive feedback:                  --state-danger
  ```

  Keep the existing `--desktop-top-surface` custom property, but make its formula semantic:

  ```css
  --desktop-top-surface: color-mix(
    in srgb,
    var(--surface-sidebar) 62%,
    var(--surface-panel)
  );
  ```

  Keep `.workspace-right` on `var(--surface-workspace-content)`. Keep `.workspace-left`, `.sidebar-title-row`, `.sidebar-scroll` and `.drawer` on `var(--surface-sidebar)`.

- [x] **Step 2: Replace old selection blue and generic overlay colors.**

  Replace the session selection and selected-item literals with the shared selection surface:

  ```css
  .wide-session-row.selected,
  .item.selected {
    border-color: color-mix(in srgb, var(--accent-primary) 32%, var(--border-subtle));
    background: color-mix(in srgb, var(--accent-primary) 11%, var(--surface-sidebar));
    color: var(--text-primary);
  }
  ```

  Keep the Windows close-button red and the translucent drawer/modal backdrops unchanged because they are native-window or modality-specific treatments, not application chrome colors.

- [x] **Step 3: Update shell expectations and run the focused tests.**

  In `web-responsive-shell.test.ts`, replace legacy `--panel`/`--panel-3` formula expectations with the semantic `--surface-sidebar`/`--surface-panel` formula. The global no-legacy-alias contract added in Task 1 remains intentionally red until Tasks 3-4 complete, so run only the Shell suite here:

  ```powershell
  npm --prefix app test -- --runInBand web-responsive-shell.test.ts
  ```

  Expected: PASS.

- [x] **Step 4: Commit the core chrome migration.**

  ```powershell
  git add app/__tests__/web-ui-design-system.test.ts
  git add app/__tests__/web-responsive-shell.test.ts
  git add app/web/src/styles/base.css
  git add app/web/src/styles/shell.css
  git add app/web/src/styles/surfaces.css
  git commit -m "style(web): unify shell surface tokens"
  ```

### Task 3: Unify Chat, Preview chrome and neutral code surfaces

**Files:**

- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/code.css`
- Modify: `app/web/src/styles/file.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-shiki-incremental-tokenization.test.ts`

- [x] **Step 1: Migrate Chat chrome to explicit surface/text/border tokens.**

  Replace aliases in chat menus, title controls, quick switcher, composer frame, plan surface, session rows, feedback cards, inline actions and popovers using the Task 2 mapping. Preserve the content plane and the existing composer layout.

  Use these state formulas for the Chat-specific controls:

  ```css
  .voice-input-button {
    border-color: color-mix(in srgb, var(--state-info) 60%, var(--border-subtle));
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--state-info) 22%, var(--surface-panel)) 0%,
      color-mix(in srgb, var(--accent-primary) 10%, var(--surface-panel)) 100%
    );
    color: color-mix(in srgb, var(--state-info) 72%, var(--text-primary));
  }

  .voice-input-button.cancel-intent,
  .voice-recording-bar.cancel-intent {
    border-color: color-mix(in srgb, var(--state-danger) 55%, var(--border-subtle));
    background: color-mix(in srgb, var(--state-danger) 12%, var(--surface-panel));
    color: var(--state-danger);
  }
  ```

  Map completed badges to `--state-success`, plan/attention markers to `--state-warning`, voice-recording information to `--state-info`, and cancellation/error feedback to `--state-danger`. Keep pulse keyframes and reduced-motion behavior unchanged.

- [x] **Step 2: Migrate only Preview-related selectors in `file.css`.**

  Change aliases to semantic roles only in these selector families:

  ```text
  .chat-preview-pane
  .chat-file-peek-surface
  .chat-attachment-preview-surface
  .chat-file-peek-scroll
  .preview-workbench-*
  .chat-file-workbench-*
  .chat-file-mention-*
  .chat-prompt-diff-*
  ```

  Keep top-level File pane, image preview, HTML preview, file-code content and all Git selectors unchanged. Preview content remains `--surface-workspace-content`; Preview Workbench toolbars, tabs, search bars, trees and menus use the surface role defined in Task 2.

- [x] **Step 3: Migrate only neutral Markdown/Mermaid chrome in `code.css`.**

  Replace aliases in `.markdown-preview`, `.markdown-image-export-surface`, `.mermaid-block`, table borders and normal inline-code framing with semantic text/border/panel tokens. Preserve `#fff` HTML preview, Shiki inline styles, diff added/removed colors, diff separators and line-number behavior.

- [x] **Step 4: Run Chat, Preview and code-theme tests.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-chat-ui.test.ts web-chat-file-peek-viewer.test.ts web-shiki-incremental-tokenization.test.ts web-shiki-theme-settings.test.ts web-code-layout.test.ts
  ```

  Expected: PASS. Auto code background remains `var(--surface-workspace-content)` while explicit code themes retain their generated backgrounds.

- [x] **Step 5: Commit the Chat and Preview migration.**

  ```powershell
  git add app/__tests__/web-chat-ui.test.ts
  git add app/__tests__/web-chat-file-peek-viewer.test.ts
  git add app/__tests__/web-shiki-incremental-tokenization.test.ts
  git add app/web/src/styles/chat.css
  git add app/web/src/styles/code.css
  git add app/web/src/styles/file.css
  git commit -m "style(web): unify chat and preview tokens"
  ```

### Task 4: Complete the Settings, Debug and Port Relay semantic migration

**Files:**

- Modify: `app/web/src/styles/settings.css`
- Modify: `app/web/src/styles/debug.css`
- Modify: `app/web/src/styles/portRelay.css`
- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-registry-debug-settings.test.ts`
- Modify: `app/__tests__/web-port-relay-settings.test.ts`

- [x] **Step 1: Migrate all Settings neutral surfaces and controls.**

  Replace legacy aliases in `settings.css` with direct roles. Apply these formulas to retained settings primitives and existing page-specific detail blocks:

  ```css
  .settings-detail-header,
  .settings-detail-page,
  .settings-workbench-panel {
    border-color: var(--border-subtle);
    color: var(--text-primary);
  }

  .settings-workbench-panel,
  .settings-detail-page {
    background: var(--surface-panel);
  }

  .settings-detail-action-btn,
  .sidebar-setting-select,
  .sidebar-setting-input {
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  ```

  Preserve the existing workbench grid, mobile row heights, shortcut order, danger actions, detail routing and state-specific modifier classes.

- [x] **Step 2: Normalize Debug and Port Relay state colors.**

  Replace hard-coded operational status colors with these roles:

  ```css
  .debug-log-line.info { border-left-color: var(--state-info); }
  .debug-log-line.warn { border-left-color: var(--state-warning); }
  .debug-log-line.error { border-left-color: var(--state-danger); }

  .port-relay-status-pill.opening,
  .port-relay-pending-note { color: var(--state-warning); }

  .port-relay-status-pill.up { color: var(--state-success); }
  .port-relay-status-pill.error { color: var(--state-danger); }
  ```

  Use `--surface-panel`, `--surface-raised`, `--surface-overlay`, `--text-primary`, `--text-secondary`, `--border-subtle` and `--border-strong` directly for all non-content Port Relay and Debug surfaces. Keep QR canvas `#ffffff`, iframe content and native diagnostic behavior unchanged.

- [x] **Step 3: Update settings-family contracts.**

  In the existing settings, debug and Port Relay tests, add semantic assertions for the selectors above and remove any legacy-alias appearance expectations. Do not change source-structure expectations for persisted settings, navigation, callbacks, service calls, iframe controls or destructive actions.

- [x] **Step 4: Run the Settings family test group.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-settings-navigation.test.ts web-registry-debug-settings.test.ts web-port-relay-settings.test.ts web-agent-package-update-settings.test.ts web-skill-management-settings.test.ts web-token-stats-settings-ui.test.ts web-database-settings-ui.test.ts web-connection-settings-ui.test.ts
  ```

  Expected: PASS.

- [x] **Step 5: Commit the settings-family migration.**

  ```powershell
  git add app/__tests__/web-settings-navigation.test.ts
  git add app/__tests__/web-registry-debug-settings.test.ts
  git add app/__tests__/web-port-relay-settings.test.ts
  git add app/web/src/styles/settings.css
  git add app/web/src/styles/debug.css
  git add app/web/src/styles/portRelay.css
  git commit -m "style(web): unify settings runtime tokens"
  ```

### Task 5: Verify the full runtime token system and record completion

**Files:**

- Modify: `docs/scope/2026-07-11-runtime-ui-token-unification/plan-runtime-ui-token-unification.md`

- [x] **Step 1: Re-run the token migration contracts.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-ui-design-system.test.ts web-responsive-shell.test.ts web-chat-ui.test.ts web-chat-file-peek-viewer.test.ts web-settings-navigation.test.ts web-registry-debug-settings.test.ts web-port-relay-settings.test.ts
  ```

  Expected: PASS with no in-scope compatibility aliases or retired hard-coded chrome/status colors in the source contracts.

- [x] **Step 2: Type-check and run the complete test suite.**

  Run:

  ```powershell
  npm --prefix app run tsc:web
  npm --prefix app test -- --runInBand
  ```

  Expected: TypeScript exits with code 0 and all Jest suites pass.

- [x] **Step 3: Build the production Web UI.**

  Run:

  ```powershell
  npm --prefix app run build:web
  ```

  Expected: webpack compiles successfully. The existing large-bundle warning may be recorded but must not be treated as a build failure.

- [ ] **Step 4: Inspect the token hierarchy in both themes and all required viewports.**

  In a connected workspace, inspect dark and light themes at a wide desktop viewport, a narrow desktop viewport and a portrait mobile viewport:

  ```text
  1. Open Chat, session navigation, composer menus, plan surface, recording state and Chat Preview.
  2. Open Settings root, Update, Skills, Port Relay, Token Stats, Connection Status, Database and Logs.
  3. Confirm canvas, workspace content, panel, raised control and overlay form a consistent hierarchy.
  4. Confirm keyboard focus, selected rows, success, warning, danger and info feedback retain readable contrast.
  5. Confirm File/Git content tabs, explicit code themes, diff colors, HTML preview and QR canvas remain unchanged.
  ```

- [x] **Step 5: Mark the completed plan, then commit and push through the repository completion gate.**

  Mark every completed checkbox in this plan, then run:

  ```powershell
  git diff --check
  git status --short
  git add -A
  git commit -m "style(web): unify runtime semantic tokens"
  git push origin main
  ```

  Expected: no whitespace errors, a clean worktree after the commit, and all token-unification commits present on `origin/main`.

## Plan self-review

- Spec coverage: Tasks 1-2 cover token authority, shell, shared chrome, selection and compatibility boundaries. Task 3 covers Chat, Preview and code-adjacent chrome. Task 4 covers Settings, Debug and Port Relay. Task 5 covers type safety, regression, production build, visual review and repository completion.
- Scope: File/Git independent content pages, Shiki explicit themes, diff semantics, HTML preview, QR canvas and native window colors are explicitly excluded from every migration task.
- Type consistency: every task uses the existing `surface-*`, `text-*`, `border-*`, `accent-*` and `state-*` names defined in `tokens.css`; no new runtime token name is introduced.
- Completeness scan: all code-changing tasks include a failing contract, a focused command, implementation rules and a commit boundary.

## Execution record

- Completed the source-level token migration and focused contract run, then verified TypeScript, the production Web build, and all 160 Jest suites (789 tests).
- Manual theme and viewport review remains open: this environment has no connected workspace to inspect beyond the connection screen. It must be checked against a live workspace in dark/light, wide/narrow desktop, and portrait mobile viewports.

Implementation complete; the remaining live-workspace visual review is recorded above.
