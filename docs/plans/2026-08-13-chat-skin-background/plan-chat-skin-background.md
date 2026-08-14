# Global Chat Skin Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a locally persisted, global chat background skin that can be selected from Settings and rendered as a subtle, non-interactive layer on desktop and mobile.

**Scope Source:** `docs/scope/2026-08-13-chat-skin-background.md`

**Architecture:** Store the single skin Blob and metadata in a dedicated IndexedDB asset store, separate from JSON global preferences. `WorkspaceApp` owns asynchronous asset loading, candidate validation, Object URL lifetime, and error preservation; Settings owns the upload/remove controls; a presentational chat layer renders one contained image beneath chat content.

**Tech Stack:** React 19, TypeScript, IndexedDB, Jest/jsdom, existing Workspace persistence and CSS token systems.

**Verification:** Focused Jest tests after each task; final `npm test`, `npm run tsc:web`, `npm run build:web`, `git diff --check`, and manual desktop/mobile review of Settings, chat layering, replacement, removal, refresh, and storage failure behavior.

---

### Task 1: Synchronize the confirmed visual-language wiki

**Files:**
- Modify: `docs/wiki/frontend-interaction/visual-language.md`

**Acceptance:** The existing visual-language page records only the confirmed long-term rules for chat skin layering, low-opacity fusion, content readability, non-interaction, responsive behavior, and reduced-transparency fallback; its first-line summary and existing scope remain intact.

- [x] **Step 1: Read the full target page and locate the material-language and settings sections.**

- [x] **Step 2: Append a concise confirmed rule block with a source link to `docs/scope/2026-08-13-chat-skin-background.md`.**

- [x] **Step 3: Check the page has a summary first line, a title, no temporary checklist/spec content, and a source path.**

- [x] **Step 4: Git checkpoint.**

Run: `git diff --check -- docs/wiki/frontend-interaction/visual-language.md`

Expected: no whitespace errors; checkpoint only this wiki file.

### Task 2: Add the IndexedDB Blob asset boundary with failure-preserving persistence

**Files:**
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/web/src/workspace/WorkspaceStore.ts`
- Create: `app/__tests__/web-workspace-chat-skin.test.ts`

**Acceptance:** A single `chatSkin` asset can be saved, loaded, replaced, and deleted as a Blob without entering `PersistedGlobalState`; existing global settings and rebuildable caches survive asset errors; database reset removes the asset; storage stats and JSON diagnostics expose metadata rather than binary contents.

- [x] **Step 1: Write the failing persistence tests.**

Create an asset-aware in-memory `WorkspaceDatabaseAdapter` test double and assert:

```ts
test('stores and restores the chat skin Blob separately from global settings', async () => {
  const repository = new WorkspacePersistenceRepository(db);
  await repository.ready();
  const blob = new Blob(['skin'], {type: 'image/png'});

  await repository.saveChatSkinAsset({blob, name: 'skin.png', mimeType: 'image/png'});

  await expect(repository.getChatSkinAsset()).resolves.toMatchObject({name: 'skin.png', mimeType: 'image/png'});
  expect(repository.getGlobalState()).not.toHaveProperty('chatSkin');
  expect(db.rows('wm_global_assets')).toHaveLength(1);
});

test('deletes only the chat skin asset and preserves global settings', async () => {
  const repository = new WorkspacePersistenceRepository(dbWithTheme('light'));
  await repository.ready();
  await repository.saveChatSkinAsset({blob: new Blob(['skin']), name: 'skin', mimeType: ''});

  await repository.deleteChatSkinAsset();

  await expect(repository.getChatSkinAsset()).resolves.toBeNull();
  expect(repository.getGlobalState().themeMode).toBe('light');
});

test('reports a skin quota failure without clearing caches or changing the active asset', async () => {
  const oldAsset = {blob: new Blob(['old']), name: 'old.png', mimeType: 'image/png'};
  const repository = new WorkspacePersistenceRepository(dbWithAsset(oldAsset));
  await repository.ready();
  db.failNextMutation(new DOMException('quota', 'QuotaExceededError'));

  await expect(repository.saveChatSkinAsset({blob: new Blob(['new']), name: 'new.png', mimeType: 'image/png'})).rejects.toThrow();
  await expect(repository.getChatSkinAsset()).resolves.toMatchObject({name: 'old.png'});
  expect(db.clearedStores()).not.toContain('wm_chat_session_content');
});
```

- [x] **Step 2: Run the focused test to verify RED.**

Run: `npm test -- --runInBand web-workspace-chat-skin.test.ts`

Expected: FAIL because the asset APIs/store do not exist; no production persistence code is written before this failure is observed.

- [x] **Step 3: Implement the minimum persistence boundary.**

Add `wm_global_assets`, bump the IndexedDB schema version additively, define a typed asset row with `k`, `blob`, `mimeType`, `name`, and `updatedAt`, and expose `getChatSkinAsset()`, `saveChatSkinAsset()`, and `deleteChatSkinAsset()` on the repository and `WorkspaceStore`. Keep global JSON state unchanged. Make asset writes explicit async operations that report quota/storage errors without invoking rebuildable-cache cleanup. Include the asset store in reset, storage statistics, and metadata-only database dump output.

- [x] **Step 4: Run the focused test to verify GREEN.**

Run: `npm test -- --runInBand web-workspace-chat-skin.test.ts`

Expected: PASS with no unhandled storage errors.

- [x] **Step 5: Run persistence regressions.**

Run: `npm test -- --runInBand web-workspace-persistence-safety.test.ts web-workspace-persistence-reset-policy.test.ts web-workspace-database-storage-stats.test.ts`

Expected: PASS; existing global settings, cache repair, reset policy, and storage-stat contracts remain intact.

- [x] **Step 6: Git checkpoint.**

After verification passes, invoke `git-workflow` checkpoint for `app/web/src/workspace/WorkspacePersistence.ts`, `app/web/src/workspace/WorkspaceStore.ts`, and `app/__tests__/web-workspace-chat-skin.test.ts` only.

### Task 3: Add candidate image validation and the chat background layer

**Files:**
- Create: `app/web/src/chat/chatSkin.ts`
- Create: `app/web/src/chat/chatSkin.test.ts`
- Create: `app/web/src/chat/ChatSkinLayer.tsx`
- Create: `app/web/src/chat/ChatSkinLayer.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`

**Acceptance:** `WorkspaceApp` loads the persisted Blob without blocking the workspace, validates new browser-decodable images before commit, releases candidate/old Object URLs, and renders exactly one responsive, non-interactive layer below chat content on desktop and mobile without adding layout height or entering share capture.

- [x] **Step 1: Write failing helper and layer tests.**

In `chatSkin.test.ts`, test that `decodeChatSkinBlob` resolves after an image load and rejects after an image error, and that `revokeChatSkinObjectUrl` calls `URL.revokeObjectURL` exactly once for a non-empty URL and never for an empty URL. In `ChatSkinLayer.test.tsx`, assert:

```ts
test('renders the skin below content as a hidden decorative layer', () => {
  const tree = renderer.create(<ChatSkinLayer src="blob:skin" bottomOffset={96} />).root;
  expect(tree.findByProps({'aria-hidden': 'true'}).props.className).toBe('chat-skin-layer');
  expect(tree.findByType('img').props.src).toBe('blob:skin');
  expect(tree.findByType('img').props.alt).toBe('');
});
```

In `web-chat-ui.test.ts`, add source-contract assertions that `WorkspaceApp` renders `ChatSkinLayer` inside `.chat-main`, passes the loaded URL and composer-safe offset, and does not pass the skin into `ChatShareCaptureSurface` or `ChatShareDocument`.

- [x] **Step 2: Run the focused tests to verify RED.**

Run: `npm test -- --runInBand chatSkin.test.ts ChatSkinLayer.test.tsx web-chat-ui.test.ts`

Expected: FAIL because the helper, component, and WorkspaceApp wiring do not exist.

- [x] **Step 3: Implement the minimum runtime and layer.**

Add browser image decode validation using a temporary Object URL and an `HTMLImageElement` load/error promise. Add `ChatSkinLayer` with `aria-hidden`, empty alt text, `pointer-events: none`, contained image sizing, and a custom bottom offset. In `WorkspaceApp`, load the asset after persistence readiness, keep the active URL in a ref/state pair, validate a candidate before calling `saveChatSkinAsset`, switch URLs only after save success, preserve old state on failures, and release URLs on replacement/removal/unmount. Reuse the existing composer measurement and keyboard/safe-area state to compute the reserved bottom offset. Render the layer as a direct child of `.chat-main` and leave share/export trees unchanged.

- [x] **Step 4: Add the visual CSS and reduced-transparency fallback.**

Use a single absolutely positioned layer with a lower content z-index, responsive max dimensions, `object-fit: contain`, approximately `opacity: .17`, bottom/edge mask gradient, and light image blur. Keep it out of layout flow, avoid `backdrop-filter`, and add `prefers-reduced-transparency: reduce` rules that remove blur and use a stable low-contrast treatment. Add mobile rules that shrink the layer and preserve the measured composer/safe-area gap.

- [x] **Step 5: Run the focused tests to verify GREEN.**

Run: `npm test -- --runInBand chatSkin.test.ts ChatSkinLayer.test.tsx web-chat-ui.test.ts -t "keeps the local chat skin"`

Expected: PASS with no URL lifecycle or skin source-contract failures. The full `web-chat-ui.test.ts` file currently retains an unrelated pre-existing Settings CSS contract failure.

- [ ] **Step 6: Git checkpoint.**

After verification passes, invoke `git-workflow` checkpoint for the new chat skin helper/component/tests, `WorkspaceApp.tsx`, `chat.css`, and the focused UI test.

### Task 4: Add Settings controls and connect replace/remove UX

**Files:**
- Create: `app/web/src/settings/ChatSkinSettings.tsx`
- Create: `app/web/src/settings/ChatSkinSettings.test.tsx`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/settings.css`

**Acceptance:** Settings → Chat exposes choose/replace/remove for the global skin on both layout modes, shows the current preview/name, disables conflicting actions while saving/deleting, and keeps the previous preview on decode/storage failure with an actionable error.

- [x] **Step 1: Write failing component tests.**

In `ChatSkinSettings.test.tsx`, render the component with no asset and assert a button/input with `accept="image/*"` is available; render it with an asset and assert the thumbnail, filename, Replace, and Remove controls; assert the controls are disabled while busy and the error text has `role="alert"`. Assert a selected file is passed to `onSelect` and Remove calls `onRemove`.

- [x] **Step 2: Run the focused test to verify RED.**

Run: `npm test -- --runInBand ChatSkinSettings.test.tsx`

Expected: FAIL because the component and SettingsRootContent props do not exist.

- [x] **Step 3: Implement the Settings component and root wiring.**

Add a compact Chat skin subsection using the existing Settings icon/row language. Use a broad image picker hint, leave actual support to the browser decoder, and never add a client-side size check. Wire `SettingsRootContent` props from `WorkspaceApp` to the asset controller; on successful save/remove update preview state, and on failure preserve the previous preview and expose the operation error without closing Settings.

- [x] **Step 4: Add settings CSS and mobile layout rules.**

Style the preview as a small contained thumbnail with filename/status text and compact ghost/primary actions. Keep controls keyboard-focusable, readable in dark/light themes, and usable in the existing mobile Settings scroll surface. Do not add a native `title` tooltip or a new icon family.

- [x] **Step 5: Run focused Settings and UI regressions to verify GREEN.**

Run: `npm test -- --runInBand ChatSkinSettings.test.tsx web-chat-ui.test.ts`

Expected: PASS; Settings prop contracts and existing Chat section ordering remain valid.

- [x] **Step 6: Git checkpoint.**

After verification passes, invoke `git-workflow` checkpoint for `ChatSkinSettings.tsx`, its test, `SettingsRootContent.tsx`, `WorkspaceApp.tsx`, and `settings.css` only.

### Task 5: Complete share/export exclusion and full verification

**Files:**
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-share-document.test.tsx`
- Modify: `app/__tests__/web-chat-share-snapshot.test.ts`

**Acceptance:** Existing response/session image sharing, HTML export, public share snapshots, and database diagnostics do not include the local skin Blob or Object URL; the full web app remains type-safe and buildable.

- [ ] **Step 1: Write failing exclusion assertions.**

Assert that `ChatShareCaptureSurface` renders `ChatShareDocument` from the snapshot only, `ChatShareDocument` has no skin prop or background layer, and `formatDatabaseDump` reports asset metadata without serializing a Blob payload. Run the focused test and observe RED if any current wiring violates the contract.

- [ ] **Step 2: Implement only the missing exclusion/diagnostic wiring.**

Keep share and export behavior unchanged when it already satisfies the contract; if database dump/store stats need fields, add metadata-only serialization and leave binary data out. Do not add skin upload to public share or change any protocol/API version.

- [ ] **Step 3: Run the focused regression.**

Run: `npm test -- --runInBand web-chat-ui.test.ts web-chat-share-document.test.tsx web-chat-share-snapshot.test.ts web-markdown-html-export.test.tsx`

Expected: PASS with no skin resource in share/export output.

- [ ] **Step 4: Run final verification.**

Run from `app/`:

```text
npm test
npm run tsc:web
npm run build:web
```

Expected: all Jest suites pass, TypeScript emits no errors, and the production web build completes successfully.

- [ ] **Step 5: Perform manual acceptance review.**

Verify in a desktop and narrow/mobile viewport: choose a transparent PNG and another browser-decodable format, see the layer at the chat lower-left, switch projects/sessions, replace/remove, refresh, force a storage failure, open Settings while the composer is expanded, and run response/session image/HTML/public share. Confirm text/input interaction and share output are unchanged.

- [ ] **Step 6: Git checkpoint.**

After all verification passes, invoke `git-workflow` checkpoint for the final regression-test changes. Then proceed to `finalize` with the real completion result.
