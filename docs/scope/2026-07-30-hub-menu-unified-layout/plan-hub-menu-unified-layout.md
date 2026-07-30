# Hub Menu Unified Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop popover and mobile full-screen Hub menu share one compact, aligned internal layout with three-column Global/Projects controls, an inline MCP placeholder, single-line detail rows, and a normal-flow footer.

**Architecture:** Keep `ChatHubMenu` as the shared content renderer and preserve all existing data/action callbacks. Extend its local detail state with an MCP-only view, normalize disclosure controls around icon/count cells, and express desktop/mobile parity through shared CSS dimensions rather than duplicated component branches. Add only local icon glyphs and presentation state; do not change backend or protocol contracts.

**Tech Stack:** React 19, TypeScript, CSS, Jest, react-test-renderer, webpack

---

### Task 1: Lock the unified interaction contract in component tests

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [x] Add failing tests that assert:
  - `mcp` belongs to the Global mutual-exclusion group.
  - Global controls are ordered NPM, MCP, Skills and Projects controls are ordered Visibility, Scan, Skills.
  - all six controls render an icon plus an always-present count, including zero.
  - MCP opens an inline `MCP servers` empty panel without calling an external action.
  - the mobile page header has one back button and no close button.
- [x] Add failing source/CSS contract assertions for a three-column action group, no colored section guide, no disclosure chevrons, and a non-sticky footer.
- [x] Run the focused tests and confirm they fail for the intended missing behavior:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx __tests__/web-chat-ui.test.ts
```

- [x] Commit the red tests:

```powershell
git add app/web/src/app/ChatHubMenu.test.tsx app/__tests__/web-chat-ui.test.ts
git commit -m "test(web): define unified hub menu layout"
```

### Task 2: Add MCP and scan icons to the shared icon system

**Files:**
- Modify: `app/web/src/common/Icon.tsx`
- Test: `app/web/src/app/ChatHubMenu.test.tsx`

- [x] Add `mcp` using the selected official `octicon:mcp-24` geometry, normalized to the existing 24px `currentColor` icon renderer.
- [x] Add `scanLine` using the Lucide `scan-line` geometry and retain the existing project icon conventions.
- [x] Update the Hub menu tests to assert the new icon names are used by their respective controls.
- [x] Run the focused component test:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx
```

- [x] Commit the icon support:

```powershell
git add app/web/src/common/Icon.tsx app/web/src/app/ChatHubMenu.test.tsx
git commit -m "feat(web): add hub menu mcp and scan icons"
```

### Task 3: Implement the unified Global and Projects control rows

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`

- [x] Extend `ChatHubDetailId` and `chatHubDetailGroup` with `mcp`.
- [x] Refactor `ChatHubDisclosureButton` so each compact control always renders:
  - one semantic icon,
  - one fixed count element,
  - an accessible name/title,
  - pending and expanded state without a disclosure chevron.
- [x] Render Global in the order Package/NPM, MCP, Skills with counts `outdatedCount`, `0`, and Hub Skill count.
- [x] Render Projects in the order eye/Visibility, scan-line/Scan, sparkles/Skills with the existing count semantics.
- [x] Add an inline local-only MCP detail panel:

```tsx
<div className="chat-hub-detail chat-hub-mcp-detail">
  <div className="chat-hub-detail-toolbar">
    <span className="chat-hub-detail-title">MCP servers</span>
  </div>
  <div className="chat-hub-detail-empty">No MCP servers configured.</div>
</div>
```

- [x] Remove the mobile header close button while preserving the existing back callback and Skill-child back flow.
- [x] Run the focused component tests:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx
```

- [x] Commit the interaction implementation:

```powershell
git add app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubMenu.test.tsx
git commit -m "feat(web): unify hub menu control rows"
```

### Task 4: Make NPM and Skill details compact single-line rows

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`

- [x] Replace the NPM status pill/two-line metadata with one version string:
  - installed/current: `current`,
  - update available: `current → target`,
  - uninstalled: `Not installed · target`.
- [x] Render only available NPM action buttons while preserving two fixed action slots with inert placeholders.
- [x] Add `title` to truncated Skill names and keep Detail/Update/Uninstall in fixed slots; unavailable managed actions should leave empty slots rather than disabled visible icons.
- [x] Preserve all existing callbacks, pending states, Hub-only update-all behavior, and Project Skill scoping.
- [x] Run the component and Skill management tests:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx web/src/app/ChatHubSkillManagement.test.tsx __tests__/web-skill-management-settings.test.ts
```

- [x] Commit the compact detail behavior:

```powershell
git add app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubSkillManagement.tsx app/web/src/app/ChatHubMenu.test.tsx
git commit -m "feat(web): compact hub detail rows"
```

### Task 5: Apply one visual system to desktop and mobile

**Files:**
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-responsive-ui-state.test.ts`

- [x] Style each Hub as one restrained visual group and remove `.chat-hub-sections::before`.
- [x] Set shared dimensions without mobile overrides:
  - main Hub/Settings/Global/Projects rows: `40px`,
  - detail toolbar: `36px`,
  - NPM/Skills/Visibility/Scan rows: `32px`.
- [x] Lay out both action groups as three equal columns with light internal separators, consistent icon/count alignment, and an expanded background.
- [x] Keep the version action transparent at rest and visibly interactive on hover/focus/active.
- [x] Make details one full-width inset surface with compact padding, single-line truncation, tabular counts, and fixed action slots.
- [x] Move the footer into normal document flow and remove sticky positioning.
- [x] Keep mobile differences limited to the full-screen host, safe-area spacing, and header navigation.
- [x] Run the CSS/source contract tests:

```powershell
npm test -- --runInBand __tests__/web-chat-ui.test.ts __tests__/web-responsive-ui-state.test.ts __tests__/web-mobile-settings-system-back.test.ts
```

- [x] Commit the visual system:

```powershell
git add app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts app/__tests__/web-responsive-ui-state.test.ts
git commit -m "style(web): align hub menu across screen sizes"
```

### Task 6: Validate behavior, types, build, and documentation

**Files:**
- Verify: `app/web/src/app/ChatHubMenu.tsx`
- Verify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Verify: `app/web/src/styles/chat.css`
- Verify: `docs/wiki/frontend-interaction/hub-menu.md`

- [x] Run the complete focused Hub/Skill regression set:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx web/src/app/ChatHubSkillManagement.test.tsx __tests__/web-chat-ui.test.ts __tests__/web-responsive-ui-state.test.ts __tests__/web-mobile-settings-system-back.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-agent-package-update-settings.test.ts
```

- [x] Run TypeScript and production build:

```powershell
npm run tsc:web
npm run build:web
```

- [x] Review the desktop and mobile implementation against the provided screenshots and CSS contracts for:
  - identical 40/36/32px internal heights,
  - one-line NPM and Skill details,
  - stable action columns with no row-height changes,
  - correct Global/Projects ordering,
  - MCP zero-count empty state,
  - normal-flow footer,
  - mobile back/gesture behavior.
- [x] Sync with `origin/main`, re-run affected tests if the rebase changes relevant files, then perform the repository completion gate and push.
