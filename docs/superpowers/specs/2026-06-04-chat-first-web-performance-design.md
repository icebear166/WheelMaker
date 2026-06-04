# Chat-First Web Performance Design

Date: 2026-06-04
Status: Draft

## Goal

Optimize the Workspace Web UI for the fastest perceived startup into Chat and for low steady-state CPU and memory use while Chat is open.

The target is not the smallest possible entry bundle. The target is a short, predictable Chat startup path with fewer initial request dependencies, no delayed critical icons, no configuration loss after updates, and no non-Chat work running while the user is only using Chat.

## Success Criteria

- Startup enters Chat as the preferred hot path.
- Chat first paint does not show missing or delayed icons.
- Updating the web bundle does not clear or mask saved address, token, or global settings.
- Initial Chat startup avoids extra runtime/vendor initial chunks introduced only for general browser caching.
- Hashed JavaScript, CSS, and font assets are cached for fast second startup.
- Opening Settings, File, Git, Port Relay, preview iframe, or debug panels loads the relevant feature chunk only when used.
- Chat idle state does not run File, Git, Settings, Port Relay, update, debug, or skill polling.
- Tests cover loading policy, cache policy, persistence protection, and coarse feature boundaries.

## Context

Recent optimization work reduced some main bundle content by adding detail-level lazy loading for Settings panels and by enabling webpack `runtimeChunk` plus `splitChunks: all`. This improved some bundle-size numbers, but it also changed Chat startup into a multi-request initial chain. That is the wrong optimization target for this product because the user normally wants to get into Chat immediately.

Current findings:

- `app/web/src/main.tsx` is a large all-in-one entry point that still owns Chat, File, Git, Settings, Port Relay, debug, polling, menus, and many global event listeners.
- `app/web/src/styles.css` is also large and contains styles for all surfaces.
- `@vscode/codicons/dist/codicon.css` is imported in the entry path. Codicons use `font-display: block` and a roughly 125 KiB `.ttf` font, so Chat icons can appear late.
- Seti file icons are imported from the entry path even though they are only needed by the File surface.
- Markdown base rendering is a core Chat capability and should stay in the hot path. Heavy Markdown extensions such as Mermaid, KaTeX, and Shiki should remain content-triggered.
- The service worker currently caches the app icon only. It does not cache hashed JS, CSS, or font assets.
- `workspacePersistence` overlays localStorage identity values onto IndexedDB global state. Missing or unreadable localStorage can currently overwrite saved address and token with empty values.

## Non-Goals

- Do not split every Settings detail page into its own chunk.
- Do not optimize for the smallest possible `bundle.js` if that makes Chat startup visibly worse.
- Do not rewrite the whole UI routing system in this phase.
- Do not replace every Codicon usage with SVG in one large change.
- Do not move Markdown base rendering out of the Chat hot path.
- Do not add a separate app shell framework or server-side rendering.

## Loading Strategy

Use a Chat-first coarse split model.

The startup path includes:

- app shell
- Chat surface
- Markdown base rendering
- shared workspace persistence
- critical Chat styles
- critical Chat icons
- shared registry connection code required for Chat

The startup path excludes:

- Settings content and detail panels
- File tree, file preview, Seti file icons, and file search
- Git status, commit list, and diff rendering
- Port Relay settings and overlay details
- preview iframe implementation
- debug panels and diagnostics details
- update, skill, database, and token-stat detail surfaces

Feature chunks:

- `settings`: one coarse Settings chunk that includes the Settings root and all Settings detail panels.
- `file`: one coarse File chunk that includes File tree, file content view, file search, Seti icon theme, and file-specific state.
- `git`: one coarse Git chunk that includes Git status, commits, changed files, and diff view.
- `port-relay`: one coarse chunk for Port Relay panels and overlays that are not needed for ordinary Chat.
- `preview`: one coarse chunk for iframe or rich preview surfaces.
- `debug`: one coarse chunk for Registry debug and diagnostic panels.

Content-triggered chunks:

- Shiki renderer and Shiki language/theme modules load when code highlighting is needed.
- Mermaid loads only when a Mermaid block is rendered.
- KaTeX and math plugins load only when math syntax is present.
- `html-to-image` loads only when exporting Markdown as an image.

## Webpack Policy

The production webpack config should favor Chat startup predictability:

- Remove `runtimeChunk: { name: 'runtime' }` for now.
- Do not use `splitChunks: { chunks: 'all' }` for initial automatic vendor splitting.
- Keep explicit dynamic imports for coarse feature chunks and content-triggered heavy modules.
- Keep CSS extraction for production so CSS can be cached independently.
- Use hashed filenames for JS, CSS, and emitted assets.

This policy can be revisited only after there is a measured startup baseline showing that a specific shared initial chunk improves Chat startup on target devices.

## Icon Strategy

There are two stages.

Stage 1: stop visible delay with low risk.

- Treat Codicons as a critical Chat resource.
- Preload the emitted Codicon font in the document or otherwise ensure it is fetched before icon-dependent Chat UI renders.
- Cache the Codicon font through the service worker asset policy.
- Keep current Codicon class names in this stage to avoid a large visual regression.

Stage 2: reduce dependence on icon fonts.

- Introduce a small Chat icon component layer for the most visible Chat controls.
- Migrate Chat-critical controls to SVG icons gradually: send, stop, attach, camera, search, close, check, settings, chat, files, git, menu, chevrons, refresh, copy, and loading state where appropriate.
- Keep Codicons available for cold surfaces until there is a clear reason to replace them.
- Keep Seti file icons scoped to the File chunk.

## Cache Strategy

The service worker should distinguish app shell documents from immutable build assets.

Rules:

- `index.html` and navigation requests remain network-first with cached fallback.
- `service-worker.js` remains network-first or bypassed to allow updates.
- Hashed `.js`, `.css`, `.woff`, `.woff2`, `.ttf`, `.svg`, and similar build assets use cache-first after the first successful fetch.
- App icons continue to use cache-first.
- WebSocket and registry API requests are not cached.
- Cache version changes should delete old caches safely.

This gives fast second startup without making the app shell stale.

## Persistence Strategy

Configuration loss is a P0 correctness issue and part of this performance iteration because bad persistence makes updates feel unsafe.

Rules:

- IndexedDB remains the source of truth for global workspace state.
- localStorage identity values are a compatibility mirror for address and token, not an unconditional override.
- Missing localStorage keys must not overwrite non-empty IndexedDB address or token.
- localStorage read errors must not overwrite IndexedDB state.
- Explicit user actions that clear address or token still persist the clear.
- Reset or cache-clear flows must preserve identity values according to the existing reset policy.

## Runtime CPU and Memory Strategy

Chat should not pay for inactive feature work.

Rules:

- Feature-specific polling starts only when the owning feature is mounted or explicitly requested.
- Update, skill, project-index, database, token-stat, debug, File, Git, and Port Relay polling must not run during Chat-only idle time.
- Global pointer, keyboard, resize, visualViewport, scroll, and popstate listeners should be centralized or scoped to active overlays and features.
- Menu outside-click handlers should mount only while a menu is open.
- Resize and visualViewport measurement should be requestAnimationFrame-coalesced and use passive listeners where safe.
- Chat streaming updates should batch or coalesce non-urgent state updates.
- Transient values that do not affect render output should stay in refs.
- Derived booleans should be passed to memoized Chat subcomponents instead of broad state objects.
- File and Git state should not be computed or rendered while Chat is selected.

## Component Boundary Strategy

The current `main.tsx` should be reduced by feature boundaries, but not by excessive leaf splitting.

Target boundaries:

- `AppShell`: top-level app frame, selected tab, connection state, persistence bootstrap, and feature loading.
- `ChatFeature`: Chat index, session selection, message list, composer, Markdown base rendering, Chat-only menus, and Chat-only runtime effects.
- `SettingsFeature`: Settings root and all Settings detail pages in one chunk.
- `FileFeature`: File tree, file viewer, file search, Seti icons, and File-only effects.
- `GitFeature`: Git status, branch, commits, diffs, and Git-only effects.
- `PortRelayFeature`: Port Relay settings and overlay behavior.
- `PreviewFeature`: iframe and rich preview surfaces.
- `DebugFeature`: Registry debug panel and diagnostic surfaces.

Shared modules should stay small and stable:

- persistence
- registry client and protocol types
- Markdown base primitives
- icon abstraction for migrated SVG icons
- global overlay/listener utilities
- cache and PWA helpers

## Implementation Order

1. P0 correctness and startup rollback:
   - fix persistence identity overlay
   - remove initial automatic webpack runtime/vendor splitting
   - add Codicon critical-resource handling
   - add service worker cache-first policy for hashed assets

2. Coarse chunk consolidation:
   - combine Settings lazy details into one Settings chunk
   - keep Shiki, Mermaid, KaTeX, and image export content-triggered
   - move Seti icon theme and font into File feature loading

3. Feature boundary extraction:
   - extract Settings, File, Git, Port Relay, Preview, and Debug feature entry modules
   - keep Chat as the startup feature
   - move feature-owned polling and listeners into feature mount lifecycles

4. Chat runtime tuning:
   - audit Chat re-render sources
   - coalesce streaming and resize work
   - centralize active overlay listeners
   - memoize stable Chat subtrees where data boundaries are clear

5. Icon-font reduction:
   - migrate Chat-critical icons to SVG through a small icon component layer
   - keep Codicons for cold surfaces until they are worth migrating

## Testing Plan

Use existing Jest source-structure tests where appropriate and add focused unit tests for behavior.

Tests should verify:

- production webpack does not configure `runtimeChunk` or `splitChunks: all` for initial chunks
- production CSS extraction and hashed filenames remain enabled
- Codicon critical-resource handling is present
- service worker uses cache-first for hashed JS, CSS, and font assets
- navigation and service worker update paths are not asset-cache-first
- localStorage absence does not blank IndexedDB address or token
- explicit identity clearing still works
- Settings detail modules are grouped under one Settings lazy boundary
- File-only Seti icon imports are not in the Chat startup entry
- Chat startup imports Markdown base rendering but not Shiki, Mermaid, KaTeX, File, Git, Settings, Port Relay, Preview, or Debug feature code
- feature polling/listeners are scoped to active feature modules

Manual verification should include:

- cold startup into Chat
- warm startup after service worker cache is installed
- update from the previous bundle with existing address/token/settings
- first open of Settings, File, Git, Port Relay, Preview, and Debug
- Chat idle CPU after startup
- Chat streaming CPU while receiving a long answer
- Chat icon appearance on desktop browser, Android WebView/PWA, and desktop shell

## Risks

- Moving feature code out of `main.tsx` can expose hidden shared-state coupling.
- Service worker cache policy mistakes can make updates stale if HTML and build assets are not separated correctly.
- Preloading Codicons improves perceived startup but does not reduce long-term icon-font dependency.
- Coarse feature chunks can make first open of File or Settings slower than fine-grained detail chunks, which is acceptable for this goal.

## Decisions

- Optimize Chat perceived startup over entry bundle size.
- Use coarse feature chunks, not leaf-level Settings detail chunks.
- Keep Markdown base in the startup path.
- Keep Mermaid, KaTeX, Shiki, and image export content-triggered.
- Treat Codicons as a critical startup resource in the short term.
- Move Seti file icons out of the Chat startup path.
- Fix persistence protection before or together with startup loading changes.
