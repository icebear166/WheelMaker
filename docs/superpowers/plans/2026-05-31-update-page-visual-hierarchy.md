# Update Page Visual Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Settings > Update into an Android APK card, a compact update summary bar, and clearer hub cards.

**Architecture:** Keep the update data model and service calls unchanged. Add derived counts in `renderUpdateSettingsDetail`, adjust JSX hierarchy, and add CSS classes that reuse the existing settings metadata visual system.

**Tech Stack:** React/TypeScript, CSS, Jest source-structure tests.

---

### Task 1: Lock the New Hierarchy With Tests

**Files:**
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-android-apk-update-settings.test.ts`

- [x] Add assertions for `update-summary-bar`, summary metrics, and summary placement before the hub list.
- [x] Add assertions for APK heading/meta hierarchy classes.
- [x] Run `npm test -- --runInBand web-agent-package-update-settings.test.ts web-android-apk-update-settings.test.ts` and confirm the new assertions fail before implementation.

### Task 2: Implement Update Page Hierarchy

**Files:**
- Modify: `app/web/src/main.tsx`

- [x] Add derived counts for hub count, release update count, npm update count, and scan state.
- [x] Replace the standalone `Update All Hubs` button with a summary bar that contains the same button and uses the existing confirmation flow.
- [x] Restructure the Android APK card into heading, metadata grid, errors, install state, and actions.
- [x] Keep each hub card's release and NPM behavior unchanged.

### Task 3: Refine Styling

**Files:**
- Modify: `app/web/src/styles.css`

- [x] Add `update-summary-*` styles with compact metric cells and mobile-safe wrapping.
- [x] Add APK card heading and meta-grid styles.
- [x] Adjust existing `wheelmaker-update-all-btn` sizing so it works inside the summary bar.
- [x] Preserve one-line mobile SHA rows.

### Task 4: Verify

**Files:**
- Existing tests and typecheck.

- [x] Run focused Jest tests for update settings.
- [x] Run `npm run tsc:web`.
- [x] Run full `npm test -- --runInBand`.
- [x] Run `git diff --check`.
