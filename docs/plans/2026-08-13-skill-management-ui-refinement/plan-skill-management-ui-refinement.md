# Skills Management UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hub Skills management compact, source-first, collapsible, and action-led while making WheelMaker's full upgrade icon unambiguous.

**Scope Source:** `docs/scope/2026-08-13-skill-management-ui-refinement.md`

**Architecture:** Keep the existing HubStore snapshot, Skills callbacks, preview/apply confirmations, and one-operation ownership. Add only a session-scoped client preference for Source disclosure state, then reshape the existing React components and CSS around a one-line Source ledger and two action slots per Skill.

**Tech Stack:** React, TypeScript, Jest/react-test-renderer, existing Lucide-style `Icon`, CSS custom properties, Go/Registry APIs unchanged.

**Verification:** `npm test -- --runInBand` focused Web tests, `npm run typecheck` or the repository's configured TypeScript check, `npm run build:web` if available, `git diff --check`, and final relevant test suites.

---

### Task 1: Add verified upgrade glyph and session Source disclosure preference

**Files:**
- Modify: `app/web/src/common/Icon.tsx`
- Modify: `app/web/src/settings/skillManagementView.ts`
- Test: `app/web/src/common/Icon.test.tsx` if present, otherwise `app/__tests__/web-skill-management-settings.test.ts`
- Test: existing skill management view test file or create `app/web/src/settings/skillManagementView.test.ts`

**Acceptance:** `circleArrowUp` is an available icon in the existing glyph registry, and Source disclosure state can be read/written through `sessionStorage` using an identity-safe key with corrupt/unavailable storage falling back to expanded.

- [x] **Step 1: Write failing tests**
  - Assert `ICON_NAMES` includes `circleArrowUp` and the glyph renders through `Icon`.
  - Assert a new `skillSourceExpandedPreferenceKey` differs for Hub/Project/Source identities.
  - Assert missing storage returns `true`, explicit `false` reads as collapsed, explicit `true` reads as expanded, and malformed JSON/storage exceptions return expanded.

- [x] **Step 2: Run RED**
  - Run: `npm test -- --runInBand app/web/src/settings/skillManagementView.test.ts app/web/src/common/Icon.test.tsx`
  - Expected: FAIL because the glyph and preference helpers do not exist.

- [x] **Step 3: Implement minimally**
  - Add the Lucide `circle-arrow-up` geometry to `Icon.tsx`.
  - Add session-storage helpers in `skillManagementView.ts`; store only collapsed Source keys and treat absent keys as expanded.

- [x] **Step 4: Run GREEN**
  - Run the same focused Jest command; expected PASS.

- [x] **Step 5: Refactor and regression check**
  - Run the existing skill management source-structure tests and ensure no localStorage/show-uninstalled behavior changes.

- [ ] **Step 6: Git checkpoint**
  - Verify only the Task 1 files are changed, then use `git-workflow checkpoint` and record the commit.

### Task 2: Reshape Source ledger and Skill action slots

**Files:**
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: `app/web/src/settings/skillManagementView.ts` if component-facing helpers need a small adjustment
- Test: `app/web/src/app/ChatHubSkillManagement.test.tsx` if present, otherwise `app/__tests__/web-skill-management-settings.test.ts` and a focused renderer test file

**Acceptance:** Each Source renders a single-line, default-expanded header with disclosure, status dot, source name, refresh, update-all, and delete actions; its list can collapse without hiding the error strip. Each Skill uses a fixed two-slot action column: install/download or update in slot one, uninstall in slot two; ordinary status text is omitted while exceptional status text remains.

- [ ] **Step 1: Write failing component tests**
  - Render a ready Source with one uninstalled Skill, one update-available Skill, one up-to-date Skill, and one removed Skill.
  - Assert the Source header exposes disclosure, Refresh, Update all, and Delete labels; clicking the non-action header toggles the list while clicking Refresh does not.
  - Assert the first Skill action slot uses `cloudDownload`, the update slot uses `circleArrowUp`, and the second slot uses `trash` where allowed.
  - Assert `Up to date`, `Not installed`, and `Update available` are not visible as row text, while `Removed upstream` remains visible and the Source error remains visible when collapsed.
  - Assert a Source with no update count still renders a disabled Update all button.

- [ ] **Step 2: Run RED**
  - Run: `npm test -- --runInBand app/web/src/app/ChatHubSkillManagement.test.tsx app/__tests__/web-skill-management-settings.test.ts`
  - Expected: FAIL against the current multi-line Source metadata and three-icon/label behavior.

- [ ] **Step 3: Implement minimally**
  - Add Source disclosure state keyed by target/source identity and use a button/heading structure that isolates action click propagation.
  - Replace Source metadata rows with one header line and status dot/tooltips.
  - Replace row action rendering with the fixed primary/secondary slots and exception-only status copy, preserving capability checks and existing callbacks.
  - Keep unmanaged, loading, empty, operation-result, retry, detail, and show-uninstalled paths intact.

- [ ] **Step 4: Run GREEN**
  - Run the focused component/source-structure tests; expected PASS.

- [ ] **Step 5: Refactor and regression check**
  - Verify action target construction remains source-aware, pending/busy disables all writes, and Source status still blocks updates when stale.

- [ ] **Step 6: Git checkpoint**
  - Stage only the Task 2 component/helper/test files and use `git-workflow checkpoint`.

### Task 3: Apply the new layout, status styling, and Hub update icon

**Files:**
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Test: `app/__tests__/web-chat-ui.test.ts`
- Test: `app/web/src/app/ChatHubMenu.test.tsx`

**Acceptance:** The Source header and Skill rows remain aligned in a narrow Hub surface, ordinary controls are icon-only with accessible labels, Source status dots and exceptional rows are visible, and both the Hub update button and its confirmation use `cloudDownload` while restart remains `power`.

- [ ] **Step 1: Write failing layout/icon tests**
  - Assert the Source header is a non-wrapping single-line layout with a fixed action group, the Skill action group has two 24px columns, and the list uses the collapsed/expanded class contract.
  - Assert the Hub update action and `resolveConfirmIcon` return `cloudDownload`, while restart remains `power`.
  - Assert Source and Skill icon buttons have existing accessible-name/tooltip attributes and focus-visible rules remain present.

- [ ] **Step 2: Run RED**
  - Run: `npm test -- --runInBand app/__tests__/web-chat-ui.test.ts app/web/src/app/ChatHubMenu.test.tsx`
  - Expected: FAIL on the old refresh glyph, Source metadata layout, and three-slot action CSS.

- [ ] **Step 3: Implement minimally**
  - Update CSS selectors and responsive rules without changing unrelated Hub sections.
  - Change only the WheelMaker update glyph and matching confirmation icon; keep callback names and operation behavior unchanged.

- [ ] **Step 4: Run GREEN**
  - Run the same focused tests; expected PASS.

- [ ] **Step 5: Refactor and regression check**
  - Run all Hub menu and skill-management Web tests; inspect `git diff --check`.

- [ ] **Step 6: Git checkpoint**
  - Stage only Task 3 files and use `git-workflow checkpoint`.

### Task 4: Synchronize stable UI documentation and complete verification

**Files:**
- Modify: `docs/wiki/frontend-interaction/hub-menu.md`
- Modify: `docs/wiki/features/skills-management.md`
- Modify: any Task 1–3 files only if verification exposes a directly related regression

**Acceptance:** Wiki pages describe the stable icon semantics, Source ledger, session-only disclosure state, and two-slot Skill actions; the full relevant Web checks pass with no server/protocol/source-lock changes.

- [ ] **Step 1: Update approved wiki targets**
  - Add the Hub update-vs-restart icon rule to `hub-menu.md`.
  - Add Source header, disclosure, status-dot, action-slot, and session preference rules to `skills-management.md`.

- [ ] **Step 2: Run focused verification**
  - Run: `npm test -- --runInBand app/web/src/app/ChatHubSkillManagement.test.tsx app/web/src/app/ChatHubMenu.test.tsx app/__tests__/web-skill-management-settings.test.ts app/__tests__/web-chat-ui.test.ts`
  - Expected: PASS.

- [ ] **Step 3: Run repository Web checks**
  - Run the configured typecheck and Web build command discovered from `package.json`.
  - Expected: PASS; if an existing unrelated environment failure appears, record the exact command/output and continue only with equivalent local checks.

- [ ] **Step 4: Review acceptance and boundaries**
  - Confirm all spec acceptance items have evidence, `git diff --check` passes, and `git diff --name-only` contains only approved UI/wiki/spec/plan files.

- [ ] **Step 5: Git checkpoint/finalize**
  - Use `git-workflow checkpoint` if the wiki unit is independent, then use `git-workflow finalize` with the true result. Push the feature branch, merge to clean `main` per preferences, push `main`, verify remote SHA, and clean the merged worktree/branch.
