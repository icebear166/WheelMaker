# Mobile Limits Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add always-available Terminal and Limits actions to the expanded mobile shortcut menu, with Limits rendered as a safe-area full-screen modal that reuses the desktop account detail presentation and existing refresh path.

**Architecture:** Keep usage data ownership and refresh behavior in `WorkspaceApp`; extract the account-detail renderer from `UsageFeatureSurface` and compose it inside a focused `MobileUsageDialog`. `WorkspaceApp` owns modal visibility, shortcut ordering, overlay mutual exclusion, and Android back handling, while `ResponsiveShell` continues to receive exactly one active mobile overlay.

**Tech Stack:** React 19, TypeScript, Jest with react-test-renderer, CSS, webpack

---

## Task 1: Extract a reusable Limits detail body

**Files:**

- Modify: `app/__tests__/web-usage-feature-surface.test.tsx`
- Modify: `app/web/src/usage/UsageFeatureSurface.tsx`

- [x] Add a component test that imports `UsageDetailContent`, renders the existing fixture directly, and asserts that it shows the Codex account, Hub pills, quota resets, and DeepSeek balance while omitting an unavailable account.
- [x] Run `npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx` from `app` and confirm the test fails because `UsageDetailContent` is not exported.
- [x] Export `UsageDetailContent({snapshot})` from `UsageFeatureSurface.tsx`; keep account filtering and the existing `Waiting for Hub limits` / `No limit details` states inside it.
- [x] Replace the desktop detail branch with `<UsageDetailContent snapshot={snapshot} />` without changing compact mode, title actions, footer, or desktop state behavior.
- [x] Rerun `npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx` and confirm it passes.

## Task 2: Build the mobile Limits modal

**Files:**

- Modify: `app/__tests__/web-usage-feature-surface.test.tsx`
- Create: `app/web/src/usage/MobileUsageDialog.tsx`
- Modify: `app/web/src/styles/usage.css`

- [x] Add renderer tests for `MobileUsageDialog` covering its `Limits` dialog name, shared account detail content, one refresh callback, disabled/spinning refresh state, close button, backdrop close, and stopped card pointer events.
- [x] Add a CSS contract assertion for a fixed full-viewport scrim, safe-area-aware card inset, bounded card height, scrollable body, and no desktop hide/detail controls.
- [x] Run the focused usage test and confirm it fails because the mobile dialog and styles do not exist.
- [x] Implement `MobileUsageDialog` with `snapshot`, `onRefresh`, and `onClose` props. Use `role="dialog"`, `aria-modal="true"`, an accessible `Limits` label, a backdrop pointer handler, a card handler that stops propagation, and header refresh/close buttons.
- [x] Render `UsageDetailContent` in the scrollable card body and retain the existing cache age / refresh status and 10-minute cadence footer semantics.
- [x] Add `.usage-mobile-overlay`, `.usage-mobile-dialog`, header/body/footer, and responsive safe-area styles to `usage.css`, reusing the current surface colors, borders, typography, and refresh animation.
- [x] Rerun the focused usage test and confirm it passes.

## Task 3: Integrate the five-button mobile shortcut and overlay lifecycle

**Files:**

- Modify: `app/__tests__/web-usage-workspace-integration.test.tsx`
- Modify: `app/__tests__/web-terminal-workspace.test.tsx`
- Modify: `app/__tests__/web-gesture-navigation.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/shell.css`

- [x] Add source-contract tests asserting the expanded shortcut order is `preview`, `terminal`, `chat`, `limits`, `settings`, and that the Limits button is outside any `showLimitsMonitor` condition.
- [x] Add integration assertions for a `mobileUsageOpen` state, a mobile overlay composed before Terminal/Preview, cached snapshot rendering without refresh-on-open, mutual-exclusion close calls, and Limits-first Android back handling.
- [x] Update the terminal overlay expectation to include the new Limits overlay priority.
- [x] Update the expanded shortcut geometry contract from three to five rows while keeping Chat centered on the original floating-control anchor.
- [x] Run `npm test -- --runInBand __tests__/web-usage-workspace-integration.test.tsx __tests__/web-terminal-workspace.test.tsx` and confirm the new assertions fail.
- [x] Import `MobileUsageDialog` and add `mobileUsageOpen` state next to the other mobile full-screen states.
- [x] Add Terminal and Limits buttons around the current Chat button. Terminal opens the existing `terminalOpen` surface without creating a terminal; Limits opens the new dialog with the current `usageSnapshot` and existing `refreshUsageAcrossHubs` callback.
- [x] On every full-screen shortcut action, collapse gesture navigation and close incompatible mobile surfaces so only one overlay is rendered.
- [x] Handle native Android back by closing Limits before Terminal, Preview, or Settings, and include `mobileUsageOpen` in the callback dependencies.
- [x] Pass `mobileUsageOverlay ?? terminalMobileOverlay ?? chatPreviewMobileOverlay` to `ResponsiveShell`; do not call refresh while opening Limits.
- [x] Rerun the two focused integration tests and confirm they pass.

## Task 4: Verify behavior and documentation

**Files:**

- Modify: `docs/scope/2026-07-18-mobile-limits-monitor/plan-mobile-limits-monitor.md`
- Verify: `docs/scope/2026-07-18-mobile-limits-monitor/spec-mobile-limits-monitor.md`
- Verify: `docs/wiki/features/limits-monitoring.md`
- Verify: `docs/wiki/features/features.md`

- [x] Run `npm run tsc:web` from `app`.
- [x] Run `npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-terminal-workspace.test.tsx __tests__/web-chat-ui.test.ts` from `app`.
- [x] Run the full Web suite with `npm test -- --runInBand` from `app`.
- [x] Run `npm run build:web` from `app`.
- [x] Run `git diff --check` and inspect `git diff --stat` plus the final source diff for accidental Hub, Registry, protocol, or desktop Limits changes.
- [x] Mark all completed checklist items, commit the implementation and docs, then push `feat/mobile-limits-monitor` to `origin`.
