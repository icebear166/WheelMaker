# Settings Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every existing settings surface into a cohesive, responsive workbench without changing its content, navigation, state, or behavior.

**Architecture:** Add stable semantic class hooks to the existing settings shell and root sections, then consolidate the settings visual system around the workbench frame, grouped controls, and a shared detail-content track. Keep page-specific data layouts intact while aligning their surfaces, actions, errors, and focus feedback through shared CSS rules.

**Tech Stack:** React, TypeScript, vanilla CSS, Jest, webpack.

---

## Files and responsibilities

- `app/web/src/settings/SettingsSurface.tsx`: expose stable workbench class hooks on the existing screen, panel, navigation, and detail shell.
- `app/web/src/settings/SettingsRootContent.tsx`: identify the five existing root groups without changing their labels, order, or rows.
- `app/web/src/styles/settings.css`: own the workbench frame, desktop grid, root controls, mobile shell, shared detail surfaces, Skills, Update, Token Stats, Connection, and Database refinements.
- `app/web/src/styles/portRelay.css`: align the Port Relay settings panel, form fields, targets, and actions with the shared detail language.
- `app/web/src/styles/debug.css`: align the Logs detail list, footer, empty state, and upload status with the shared detail language.
- `app/__tests__/web-settings-navigation.test.ts`: lock down semantic hooks, preserved navigation order, responsive layout rules, mobile touch targets, and visual state contracts.
- Existing feature-specific settings tests: preserve the structural and behavioral seams for Update, Skills, Port Relay, Token Stats, Database, Connection Status, and Logs.

### Task 1: Add stable settings workbench hooks

**Files:**

- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/web/src/settings/SettingsSurface.tsx`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`

- [ ] **Step 1: Write the failing source-structure test for the workbench hooks.**

  Add this test to `app/__tests__/web-settings-navigation.test.ts`:

  ```ts
  test('keeps settings content stable while exposing workbench layout hooks', () => {
    const projectRoot = path.join(__dirname, '..');
    const surface = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const root = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    expect(surface).toContain('settings-workbench-screen');
    expect(surface).toContain('settings-workbench-panel');
    expect(surface).toContain('settings-workbench-nav');
    expect(surface).toContain('settings-workbench-detail-page');
    expect(root).toContain("type SettingsSectionId = 'appearance' | 'chat' | 'connection' | 'code-display' | 'debug';");
    expect(root).toContain('settings-section-${id}');
    for (const id of ['appearance', 'chat', 'connection', 'code-display', 'debug']) {
      expect(root).toContain(`id: '${id}'`);
    }
    expect(root.indexOf("id: 'appearance'")).toBeLessThan(root.indexOf("id: 'chat'"));
    expect(root.indexOf("id: 'chat'")).toBeLessThan(root.indexOf("id: 'connection'"));
    expect(root.indexOf("id: 'connection'")).toBeLessThan(root.indexOf("id: 'code-display'"));
    expect(root.indexOf("id: 'code-display'")).toBeLessThan(root.indexOf("id: 'debug'"));
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails for missing hooks.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-settings-navigation.test.ts
  ```

  Expected: FAIL because the new workbench class names and `SettingsSectionId` do not exist yet.

- [ ] **Step 3: Add the semantic hooks without changing the rendered content.**

  In `SettingsSurface.tsx`, use these exact class compositions:

  ```tsx
  const screenClassName = className
    ? `settings-workbench-screen mobile-settings-screen ${className}`
    : 'settings-workbench-screen mobile-settings-screen';
  ```

  ```tsx
  <div className="settings-screen-panel-row">
    <div className="mobile-settings-panel settings-workbench-panel">
      <div className="mobile-settings-nav settings-workbench-nav">
  ```

  ```tsx
  <div className={`settings-detail-page settings-workbench-detail-page${hideDetailHeader ? ' settings-detail-page-body-only' : ''}>
  ```

  In `SettingsRootContent.tsx`, replace the positional helper arguments with the following complete helper contract:

  ```tsx
  type SettingsSectionId = 'appearance' | 'chat' | 'connection' | 'code-display' | 'debug';

  type SettingsSectionOptions = {
    id: SettingsSectionId;
    title: string;
    rows: React.ReactNode;
    icon?: string;
  };

  function renderSettingsSection({id, title, rows, icon}: SettingsSectionOptions) {
    return (
      <section className={`settings-section settings-section-${id}`} aria-label={title}>
        <div className="settings-section-title">
          {icon ? <span className={`codicon codicon-${icon}`} aria-hidden="true" /> : null}
          <span>{title}</span>
        </div>
        <div className="settings-section-rows">{rows}</div>
      </section>
    );
  }
  ```

  Convert each existing call by replacing only its call wrapper. Use these exact prefixes and suffixes, leaving the React nodes between them unchanged:

  ```tsx
  // Appearance
  {renderSettingsSection({id: 'appearance', title: 'Appearance', icon: 'paintcan', rows: (
  // close with: ), })}

  // Chat
  {renderSettingsSection({id: 'chat', title: 'Chat', icon: 'comment-discussion', rows: (
  // close with: ), })}

  // Connection
  {renderSettingsSection({id: 'connection', title: 'Connection', icon: 'radio-tower', rows: (
  // close with: ), })}

  // Code Display
  {renderSettingsSection({id: 'code-display', title: 'Code Display', icon: 'symbol-color', rows: (
  // close with: ), })}

  // Debug
  {renderSettingsSection({id: 'debug', title: 'Debug', icon: 'bug', rows: (
  // close with: ), })}
  ```

  Do not alter any child label, input, select, callback, conditional, or action between each listed prefix and suffix.

- [ ] **Step 4: Run the focused test to verify the hooks pass.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-settings-navigation.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the semantic-only change.**

  ```powershell
  git add app/__tests__/web-settings-navigation.test.ts
  git add app/web/src/settings/SettingsSurface.tsx
  git add app/web/src/settings/SettingsRootContent.tsx
  git commit -m "refactor(web): add settings workbench hooks"
  ```

### Task 2: Establish the responsive desktop workbench frame

**Files:**

- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/web/src/styles/settings.css`

- [ ] **Step 1: Write failing CSS-contract assertions for the wider desktop canvas and root grid.**

  Add these assertions to the settings navigation test:

  ```ts
  expect(css).toMatch(/\.desktop-settings-screen \.settings-workbench-panel \{[\s\S]*width: min\(920px, calc\(100vw - 56px\)\);[\s\S]*\}/);
  expect(css).toMatch(/\.desktop-settings-screen\.has-settings-side-panel \.settings-screen-panel-row \{[\s\S]*width: min\(1440px, calc\(100vw - 56px\)\);[\s\S]*grid-template-columns: minmax\(0, 920px\) minmax\(360px, 500px\);[\s\S]*\}/);
  expect(css).toMatch(/@media \(min-width: 860px\) \{[\s\S]*\.desktop-settings-screen \.settings-list \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*\}/);
  expect(css).toMatch(/\.desktop-settings-screen \.settings-section-chat \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 1 \/ span 2;[\s\S]*\}/);
  expect(css).toMatch(/\.desktop-settings-screen \.settings-section-debug \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 3;[\s\S]*\}/);
  ```

  In `web-agent-package-update-settings.test.ts`, update the desktop settings panel expectation from `720px` to `920px` and preserve the existing side-panel behavior assertions.

- [ ] **Step 2: Run both tests and verify they fail on the current 720px shell.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-settings-navigation.test.ts web-agent-package-update-settings.test.ts
  ```

  Expected: FAIL because the current desktop panel is `720px`, has no workbench-scoped width selector, and has no 860px root grid.

- [ ] **Step 3: Replace the duplicated settings shell overrides with one workbench frame.**

  In `settings.css`, remove the trailing duplicate `.mobile-settings-screen`, `.settings-list`, `.settings-section-title`, `.settings-section-rows`, `.settings-row`, and `.settings-danger-row` overrides under `/* workspace-ui-targeted-evolution: settings */`. Move their intended token values into the primary rules so every selector has one authoritative definition.

  Add these exact desktop sizing rules beside the existing desktop settings shell:

  ```css
  .desktop-settings-screen .settings-workbench-panel {
    width: min(920px, calc(100vw - 56px));
    height: calc(100vh - 56px);
    min-height: 420px;
  }

  .desktop-settings-screen.has-settings-side-panel .settings-screen-panel-row {
    width: min(1440px, calc(100vw - 56px));
    height: calc(100vh - 56px);
    min-height: 420px;
    display: grid;
    grid-template-columns: minmax(0, 920px) minmax(360px, 500px);
    gap: 12px;
  }

  @media (min-width: 860px) {
    .desktop-settings-screen .settings-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }

    .desktop-settings-screen .settings-section-appearance {
      grid-column: 1;
      grid-row: 1;
    }

    .desktop-settings-screen .settings-section-chat {
      grid-column: 2;
      grid-row: 1 / span 2;
    }

    .desktop-settings-screen .settings-section-connection {
      grid-column: 1;
      grid-row: 2;
    }

    .desktop-settings-screen .settings-section-code-display {
      grid-column: 1;
      grid-row: 3;
    }

    .desktop-settings-screen .settings-section-debug {
      grid-column: 2;
      grid-row: 3;
    }
  }
  ```

  Scope the panel and overlay surfaces through `.settings-workbench-screen` and `.settings-workbench-panel`; use `var(--surface-canvas)`, `var(--surface-panel)`, `var(--border-subtle)`, `var(--shadow-overlay)`, and a near-opaque background mix. Do not add a new color token, brand color, font, image, or gradient.

- [ ] **Step 4: Run the focused layout tests to verify the desktop frame passes.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-settings-navigation.test.ts web-agent-package-update-settings.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the responsive shell and grid.**

  ```powershell
  git add app/__tests__/web-settings-navigation.test.ts
  git add app/__tests__/web-agent-package-update-settings.test.ts
  git add app/web/src/styles/settings.css
  git commit -m "style(web): establish settings workbench frame"
  ```

### Task 3: Redesign root controls and mobile navigation without reducing touch targets

**Files:**

- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/web/src/styles/settings.css`

- [ ] **Step 1: Write failing assertions for the shared root-control visual contract.**

  Add assertions that require all of the following:

  ```ts
  expect(css).toMatch(/\.settings-section-title \{[\s\S]*text-transform: none;[\s\S]*font-weight: 600;[\s\S]*\}/);
  expect(css).toMatch(/\.settings-row \{[\s\S]*transition: background var\(--motion-fast\) var\(--ease-standard\), color var\(--motion-fast\) var\(--ease-standard\), box-shadow var\(--motion-fast\) var\(--ease-standard\);[\s\S]*\}/);
  expect(css).toMatch(/\.settings-workbench-panel \.sidebar-setting-select,[\s\S]*\.settings-workbench-panel \.sidebar-setting-input \{[\s\S]*border-radius: var\(--radius-control\);[\s\S]*\}/);
  expect(css).toMatch(/\.mobile-settings-screen \.settings-row \{[\s\S]*min-height: 56px;[\s\S]*\}/);
  expect(css).toMatch(/\.mobile-settings-shortcut-button\.active \{[\s\S]*color: var\(--accent\);[\s\S]*background: transparent;[\s\S]*\}/);
  ```

  Keep the existing shortcut-order and `height: 58px` assertions unchanged.

- [ ] **Step 2: Run the focused tests and verify the new appearance expectations fail.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-settings-navigation.test.ts web-agent-package-update-settings.test.ts
  ```

  Expected: FAIL because titles are currently forced uppercase, the controls are styled in `shell.css` without a workbench contract, and active shortcuts do not declare their no-fill active state.

- [ ] **Step 3: Apply the root and mobile visual system in `settings.css`.**

  Implement these rules while preserving the current selector names and input behavior:

  ```css
  .settings-section-title {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-transform: none;
  }

  .settings-row {
    min-height: 46px;
    color: var(--text-primary);
    transition:
      background var(--motion-fast) var(--ease-standard),
      color var(--motion-fast) var(--ease-standard),
      box-shadow var(--motion-fast) var(--ease-standard);
  }

  .settings-row:hover {
    background: color-mix(in srgb, var(--surface-raised) 62%, transparent);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent-primary) 54%, transparent);
  }

  .settings-workbench-panel .sidebar-setting-select,
  .settings-workbench-panel .sidebar-setting-input {
    border-color: var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .settings-workbench-panel .sidebar-setting-select:focus-visible,
  .settings-workbench-panel .sidebar-setting-input:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--accent-primary) 58%, var(--border-subtle));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }

  .mobile-settings-shortcut-button.active {
    color: var(--accent);
    background: transparent;
  }
  ```

  Give `.settings-section-rows` a single `var(--radius-panel)` surface, use a low-contrast inner edge instead of a heavy shadow, and preserve the existing 56px mobile row and 58px shortcut button heights. Keep the moving shortcut indicator, but use it as the only active fill; no active button background may be added.

- [ ] **Step 4: Run the root and mobile tests to verify they pass.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-settings-navigation.test.ts web-agent-package-update-settings.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the root and mobile control redesign.**

  ```powershell
  git add app/__tests__/web-settings-navigation.test.ts
  git add app/__tests__/web-agent-package-update-settings.test.ts
  git add app/web/src/styles/settings.css
  git commit -m "style(web): refine settings controls and mobile navigation"
  ```

### Task 4: Unify all settings detail surfaces and page-specific data blocks

**Files:**

- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`
- Modify: `app/__tests__/web-port-relay-settings.test.ts`
- Modify: `app/__tests__/web-token-stats-settings-ui.test.ts`
- Modify: `app/__tests__/web-database-settings-ui.test.ts`
- Modify: `app/__tests__/web-connection-settings-ui.test.ts`
- Modify: `app/web/src/styles/settings.css`
- Modify: `app/web/src/styles/portRelay.css`
- Modify: `app/web/src/styles/debug.css`

- [ ] **Step 1: Write failing style-contract tests for shared detail semantics.**

  Extend the existing feature tests to assert the exact shared rules below rather than changing their component or behavior assertions:

  ```ts
  expect(stylesCss).toMatch(/\.settings-detail-header \{[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 96%, transparent\);[\s\S]*\}/);
  expect(stylesCss).toMatch(/\.settings-metadata-card,[\s\S]*\.settings-database-storage-metric,[\s\S]*\.settings-database-store-list,[\s\S]*\.update-summary-bar \{[\s\S]*border-radius: var\(--radius-panel\);[\s\S]*\}/);
  expect(stylesCss).toMatch(/\.settings-detail-action-btn \{[\s\S]*border-radius: var\(--radius-control\);[\s\S]*\}/);
  expect(portRelayCss).toMatch(/\.port-relay-section \{[\s\S]*border-radius: var\(--radius-panel\);[\s\S]*\}/);
  expect(debugCss).toMatch(/\.debug-log-detail-footer \{[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 96%, transparent\);[\s\S]*\}/);
  ```

  In `web-settings-navigation.test.ts`, read `portRelay.css` and `debug.css` with `fs.readFileSync` so those rules remain independently testable.

- [ ] **Step 2: Run the complete settings test group and verify the new detail assertions fail.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-agent-package-update-settings.test.ts web-skill-management-settings.test.ts web-port-relay-settings.test.ts web-token-stats-settings-ui.test.ts web-database-settings-ui.test.ts web-connection-settings-ui.test.ts web-settings-navigation.test.ts
  ```

  Expected: FAIL because the detail components currently use unrelated 6px, 7px, 8px, and 10px radius rules and different surface formulas.

- [ ] **Step 3: Implement the shared detail contract and align page-specific surfaces.**

  In `settings.css`, make the generic detail primitives authoritative:

  ```css
  .settings-detail-header {
    border-bottom-color: var(--border-subtle);
    background: color-mix(in srgb, var(--surface-panel) 96%, transparent);
    box-shadow: 0 1px 0 color-mix(in srgb, #fff 7%, transparent) inset;
  }

  .settings-metadata-card,
  .settings-database-storage-metric,
  .settings-database-store-list,
  .update-summary-bar {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: color-mix(in srgb, var(--surface-raised) 82%, var(--surface-panel));
    box-shadow: 0 1px 0 color-mix(in srgb, #fff 6%, transparent) inset;
  }

  .settings-detail-action-btn {
    border-radius: var(--radius-control);
    border-color: color-mix(in srgb, var(--accent-primary) 34%, var(--border-subtle));
    background: color-mix(in srgb, var(--accent-primary) 8%, var(--surface-raised));
    color: var(--text-primary);
  }

  .settings-detail-action-btn.danger {
    border-color: color-mix(in srgb, var(--state-danger) 42%, var(--border-subtle));
    background: color-mix(in srgb, var(--state-danger) 8%, var(--surface-raised));
    color: var(--state-danger);
  }
  ```

  Extend the same panel contract to `.settings-skills-scope`, `.settings-skills-install-panel`, `.settings-skills-detail-panel`, `.token-stats-account-item`, and `.settings-database-dump`. Keep monospace presentation for version, path, port, and database values; use `font-variant-numeric: tabular-nums` on numeric summaries.

  In `portRelay.css`, update `.port-relay-section`, `.port-relay-target-list-row`, and the Port Relay input/select group to use `var(--radius-panel)`, `var(--radius-control)`, `var(--surface-raised)`, and `var(--border-subtle)`. Preserve the semantic status colors, selected target behavior, draft row, and button callbacks. Do not add an accent-filled status button.

  In `debug.css`, align `.debug-log-empty`, `.debug-log-line`, and `.debug-log-detail-footer` with the shared near-opaque panel surfaces. Preserve the current `info`, `warn`, and `error` left-edge colors and sticky footer behavior.

- [ ] **Step 4: Run the complete settings test group to verify the visual contract and functionality tests pass.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-agent-package-update-settings.test.ts web-skill-management-settings.test.ts web-port-relay-settings.test.ts web-token-stats-settings-ui.test.ts web-database-settings-ui.test.ts web-connection-settings-ui.test.ts web-settings-navigation.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the shared detail redesign.**

  ```powershell
  git add app/__tests__/web-settings-navigation.test.ts
  git add app/__tests__/web-agent-package-update-settings.test.ts
  git add app/__tests__/web-skill-management-settings.test.ts
  git add app/__tests__/web-port-relay-settings.test.ts
  git add app/__tests__/web-token-stats-settings-ui.test.ts
  git add app/__tests__/web-database-settings-ui.test.ts
  git add app/__tests__/web-connection-settings-ui.test.ts
  git add app/web/src/styles/settings.css
  git add app/web/src/styles/portRelay.css
  git add app/web/src/styles/debug.css
  git commit -m "style(web): unify settings detail surfaces"
  ```

### Task 5: Verify the complete responsive settings workbench

**Files:**

- Modify only when a verification failure identifies a missing requirement in the files listed above.

- [ ] **Step 1: Type-check the Web UI.**

  Run:

  ```powershell
  npm --prefix app run tsc:web
  ```

  Expected: exit code 0.

- [ ] **Step 2: Run the full application test suite.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand
  ```

  Expected: all Jest suites pass.

- [ ] **Step 3: Build the production Web UI.**

  Run:

  ```powershell
  npm --prefix app run build:web
  ```

  Expected: webpack completes successfully; the existing large-bundle warning, if emitted, is recorded but does not fail the build.

- [ ] **Step 4: Manually inspect the preserved interaction paths.**

  Check dark and light themes at a wide desktop viewport, a narrow desktop viewport, and a portrait mobile viewport:

  ```text
  1. Open Settings, then move through Appearance, Chat, Connection, Code Display, and Debug.
  2. Open Update, Skills, Port Relay, Token Stats, Connection Status, Database, and Logs through their existing entry points.
  3. Verify root desktop grouping, mobile single-column layout, 56px touch rows, five-item shortcut order, detail back navigation, Skills side-panel behavior, and visible focus feedback.
  4. Toggle reduced motion and verify page and control transitions do not animate.
  5. Verify all existing labels, inputs, select values, destructive actions, callbacks, and routes match their pre-redesign behavior.
  ```

- [ ] **Step 5: Record the completed verification checklist, then push through the repository completion gate.**

  Mark every completed checkbox in this plan after the preceding commands and viewport checks have passed. This records the verification outcome in the plan and guarantees that the final commit contains the completed execution record.

  Run:

  ```powershell
  git diff --check
  git status --short
  git add -A
  git commit -m "style(web): complete settings workbench redesign"
  git push origin main
  ```

  Expected: no whitespace errors, a clean committed worktree after push, and `origin/main` contains every redesign commit.

## Plan self-review

- Spec coverage: Tasks 1–3 cover the preserved information architecture, desktop two-track root, mobile single column, controls, focus, and motion constraints. Task 4 covers every named detail family and state surface. Task 5 covers type safety, feature regression, production build, and visual viewport checks.
- Scope: no task changes settings data, routes, field order, content strings, callbacks, persistence, or non-settings pages. No task adds a library, font, or asset.
- Type consistency: semantic hook names are introduced in Task 1 and used consistently by the CSS and tests in later tasks.
- Completeness scan: this plan contains no unfinished implementation marker or unspecified test action.

Plan complete and saved to `docs/scope/2026-07-11-settings-workbench-redesign/plan-settings-workbench-redesign.md`. Execute it with `executing-plans` when you're ready.
