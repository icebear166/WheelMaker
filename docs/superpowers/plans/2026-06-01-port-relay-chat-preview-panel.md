# Port Relay Chat Preview Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat Port Relay links open in the same right-side/mobile preview surface as chat file previews, and normalize affected title bars to the chat title height.

**Architecture:** Reuse the existing desktop peek column and mobile overlay shell. Add a small discriminated preview state so the pane can render either a file preview or a Port Relay iframe. Keep the existing Port Relay settings page and activity entry behavior intact.

**Tech Stack:** React, TypeScript, CSS, Jest source-structure tests.

---

### Task 1: Lock Behavior With Tests

**Files:**
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-port-relay-settings.test.ts`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Test: `app/__tests__/web-port-relay-settings.test.ts`

- [ ] Add tests asserting `desktopPeek={chatPreviewDesktopPane}` and `mobileOverlay={chatPreviewMobileOverlay}`.
- [ ] Add tests asserting the preview toolbar uses one line, not separate name/path rows.
- [ ] Add tests asserting `openChatPortRelayLink` activates the chat preview surface and that `renderMain` no longer replaces the middle pane for desktop chat link opens.
- [ ] Add tests asserting mobile File/Git title bars no longer use `calc(var(--wm-safe-area-top) + 50px)`.
- [ ] Run `npm test -- web-chat-file-peek-viewer.test.ts web-port-relay-settings.test.ts --runInBand` from `app` and confirm the new expectations fail before implementation.

### Task 2: Implement Shared Preview State

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/styles.css`

- [ ] Replace the file-only desktop/mobile preview variables with chat-preview variables that render either `renderChatFilePeekSurface` or `renderPortRelayFrameSurface`.
- [ ] Keep existing file click behavior, preserving direct line jumps and preview-mode rendering.
- [ ] Update `openChatPortRelayLink` so successful link opens set the right/mobile preview state instead of replacing the desktop main pane.
- [ ] Keep the existing Port Relay activity button and settings page path working.

### Task 3: Normalize Toolbars

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/styles.css`

- [ ] Change the file preview toolbar to one line with the full path/line string as the title.
- [ ] Add a Port Relay preview toolbar with close/back and open-in-browser actions.
- [ ] Set preview toolbar height to the chat `block-title` height.
- [ ] Remove the mobile `content > .block-title.with-tools` height override that made File/Git taller than Chat.

### Task 4: Verify and Ship

**Files:**
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Test: `app/__tests__/web-port-relay-settings.test.ts`
- Test: full app test/build suite

- [ ] Run focused Jest tests.
- [ ] Run full `npm test -- --runInBand`.
- [ ] Run `npm run tsc:web`.
- [ ] Check working tree diff.
- [ ] Commit and push using the repository completion gate.
