# Settings Navigation Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop and mobile Settings use the same root/peer/child navigation rules.

**Architecture:** Extract Settings page classification into a small helper. Make mobile history and `main.tsx` consume that helper, then update desktop/mobile entry points to use peer/child-specific open functions.

**Tech Stack:** React, TypeScript, Jest source/unit tests.

---

### Task 1: Navigation Model

**Files:**
- Create: `app/web/src/settings/settingsNavigation.ts`
- Test: `app/__tests__/web-settings-navigation.test.ts`

- [x] Write failing tests for peer/child classification, page kind, and shortcut index.
- [x] Implement the navigation helper.
- [x] Run `npm test -- --runInBand web-settings-navigation.test.ts`.

### Task 2: Mobile History Rules

**Files:**
- Modify: `app/web/src/services/mobileSettingsHistory.ts`
- Modify: `app/__tests__/web-mobile-settings-system-back.test.ts`

- [x] Write failing tests for peer system-back close and child system-back return-to-root.
- [x] Update mobile history to call `settingsPageKind`.
- [x] Run `npm test -- --runInBand web-mobile-settings-system-back.test.ts web-settings-navigation.test.ts`.

### Task 3: Desktop/Mobile Wiring

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: existing UI source tests.

- [x] Write failing source tests for PC `CC Switch`, desktop peer order, peer header hiding, and unified child openers.
- [x] Add `openSettingsRoot`, `openSettingsPeer`, `openSettingsChild`, and `closeSettingsPanel`.
- [x] Reorder desktop activity entries and add `CC Switch`.
- [x] Route mobile shortcuts through `openMobileSettingsShortcutDetail` no-op for active peer.
- [x] Hide desktop detail header for peer pages and keep it for child pages.

### Task 4: Verification

**Files:**
- Existing tests and typecheck.

- [x] Run focused settings tests.
- [x] Run `npm run tsc:web`.
- [x] Run full `npm test -- --runInBand`.
- [x] Run `git diff --check`.
