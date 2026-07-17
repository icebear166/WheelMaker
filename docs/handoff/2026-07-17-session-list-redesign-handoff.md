# Session list redesign — handoff

> Created 2026-07-17. This is a scope/design handoff only; no product code has been changed for this work.

## User goal

Iterate the right-side chat session list for clearer, more consistent UI/UX. A supplied mobile reference image is inspiration for hierarchy and guidance, not a visual specification to copy.

## Current scope status

`scope` is in progress. Do not start implementation, TDD, or planning skills until the remaining decision below is answered and the user has confirmed the scope summary / selected the next scope exit.

The user wants desktop and mobile to share the same information hierarchy and core interaction rules. Platform-specific mechanics may still differ: PC session actions remain right-click driven and mobile retains long-press as the counterpart.

## Confirmed decisions

- Preserve the existing Recent ordering and project grouping; do not replace it with a flat global chronological list.
- Keep session contextual actions hidden behind right-click on desktop and long-press on mobile.
- Keep / restore the selected-session vertical indicator in Recent as well as ordinary project lists. The current Recent CSS explicitly removes it, so this is a planned change.
- The Recent section must read as a virtual Folder at the same visual hierarchy as ordinary project folders. It must not become a separate large, low-priority card or a colorful block.
- Remove Recent’s pin control and separate pin state. Recent is always at the top of the session rail.
  - With the sidebar open, Recent is sticky at the top and normal projects scroll beneath it.
  - With the desktop sidebar collapsed, Recent always appears in the existing split/chat-edge surface; this is not gated by pinning.
  - Recent remains collapsible. The sidebar and split-surface presentations must share one collapse state.
- Ordinary project headers keep their complete controls: direct New (`+`), direct Resume, explicit pin, and expand/collapse affordance.
- Add an explicit pin control for every project in the same action position used by the Recent/header pattern, replacing the current mobile-only long-press discovery path.
- A project pin only reorders the project to the top of the normal project list; pinned projects continue to scroll normally. Do not make each pinned project sticky or create additional floating surfaces.
- Recent content remains grouped by project. Groups do not gain their own collapse state.
- Each Recent project group needs a minimal project annotation (project icon/name, concise hub context, and `+` for a new session in that project). It must make the session’s project clear without materially increasing session row height or resembling the Recent header.
- Remove the current colored project-card backgrounds and oversized project-name watermarks from Recent.

## Remaining scope decision

The assistant proposed a "micro divider" for each Recent project group: a quiet 14–16px divider line carrying the project icon/name, concise hub label, and `+`, shown only when the project changes. It avoids adding project tags to every session row and visually distinguishes project context from the main Recent folder header.

The user had selected the group-level annotation approach, then emphasized two constraints: add as little height as possible and avoid visual overlap with the Recent Sessions title. The last question was whether the independent 14–16px micro-divider is acceptable, versus placing context inside the first session row’s left gutter (zero extra height but much denser). The user requested `/handoff` before answering.

Recommended next prompt (one question only):

> For the project-level Recent annotation, is an independent 14–16px quiet divider acceptable? It appears only between project groups, leaves session rows unchanged, and is visually separated from the Recent folder header.

## Suggested design direction after that decision

- Reuse the ordinary `wide-project-section` / `wide-project-row` visual language for Recent itself: history icon, `Recent Sessions` label, collapse affordance, and the appropriate non-project-specific controls. Do not add a card frame or a large legend treatment to the outer Recent section.
- Render project context inside Recent as a subordinate, low-contrast list annotation—not as another folder row. The annotation should not use a full row-height folder header, colored card surface, or watermark.
- Keep the existing one-line session row model: state marker, title, agent tag, relative time. Ensure selected styling is identical whether the session is selected from Recent or its normal project list.
- Preserve ordinary project headers as the primary place for New and Resume. The `+` in a Recent project annotation is project-scoped and opens the same new-session agent flow.
- Keep search, archive, session protocol/data semantics, and Recent ordering outside this UI iteration unless a later user decision explicitly expands scope.

## Relevant implementation locations

- Main rendering and interaction state: `app/web/src/app/WorkspaceApp.tsx`
  - Recent state/render: around `3209`, `5088`, `15370`, `15399`, `17470`, and `19241`.
  - Project rows and direct New/Resume actions: around `17103` and `17476`.
  - Session rows/right-click/long-press: around `15025`, `15088`, and `16032`.
  - Existing mobile-only project pin long press: around `7671`.
- Recent data grouping/order: `app/web/src/chat/mobileChatQuickSwitch.ts` (`buildRecentChatSessionProjectSections`).
- Current pinned desktop edge component: `app/web/src/chat/ChatRecentSessionsSurface.tsx`.
- Styling: `app/web/src/styles/chat.css`
  - Project rows: around `992`.
  - Current Recent colored groups/watermark/create rail: around `1146`–`1349`.
  - Session selection and density: around `1470`–`1730`.
  - Desktop Recent edge surface: around `2760`–`2912`.
- Tests most likely affected:
  - `app/__tests__/web-chat-recent-sessions-ui.test.ts`
  - `app/__tests__/web-chat-plan-surface.test.tsx`
  - `app/__tests__/web-chat-ui.test.ts`
  - `app/__tests__/web-chat-session-nav-expansion.test.ts`

## Important code observations

- Current Recent is rendered as a virtual project section in the main session rail, but its content uses `recent-project-session-group` colored surfaces and a large watermark. This is the primary visual target for replacement.
- Current Recent pin state is local (`recentSessionsPinned`) and controls both sticky rail behavior and whether `ChatRecentSessionsSurface` appears when the desktop sidebar is collapsed. The requested redesign removes that state gate but preserves the collapsed-sidebar surface as always available.
- `ChatRecentSessionsSurface` currently owns a separate local `collapsed` state. The requested design needs collapse state lifted/shared with the ordinary Recent section.
- Current tests assert many literal source strings and CSS declarations. Refactor those assertions alongside the UI so they check the new structure/behavior rather than stale styling details.

## Workspace safety

The worktree already contains unrelated user changes. Do not discard or overwrite them:

- `app/__tests__/web-terminal-components.test.tsx`
- `app/__tests__/web-terminal-workspace.test.tsx`
- `app/web/src/app/WorkspaceApp.tsx`
- `app/web/src/terminal/TerminalView.tsx`

The visible `WorkspaceApp.tsx` diff concerns terminal copy feedback, not the session-list redesign. Preserve it.

