# Chat Quick Switch Unread and Create Design

## Context

The Workspace Web UI already keeps per-project session summaries in `projectSessionsByProjectId`.
Each `RegistryChatSession` can include `running`, `lastDoneTurnIndex`, `lastDoneSuccess`,
`lastReadTurnIndex`, `unreadCount`, `agentType`, and update timestamps. The chat sidebar and
mobile project sheet already use these summaries to show session state and create new sessions.

The mobile 3tap control has a Chat/File/Git button group. The Chat button already opens the
quick switch menu when the current tab is chat. The quick switch menu groups recent sessions by
project and shows a project name, Hub label, session rows, state markers, and per-session unread
counts.

## Goals

- Show a green indicator on the mobile 3tap Chat button when any visible project has a completed
  unread session.
- Remove that indicator once all completed sessions are read.
- Make the quick switch menu's Hub capsule use the configured Hub color.
- Add a project-level plus button in the quick switch menu for fast new session creation.
- Keep the quick switch menu focused on fast switching and fast creation, not resume/import flows.

## Non-Goals

- No server or registry protocol change.
- No desktop activity bar unread indicator in this iteration.
- No numeric badge on the 3tap Chat button.
- No Resume entry inside the quick switch menu.
- No change to how `session.read`, `session.updated`, or `session.create` work.

## Unread Indicator

`WorkspaceApp.tsx` will derive `hasCompletedUnreadChatSession` from `projectSessionsByProjectId`.
A session counts when:

- `session.running !== true`
- `lastDoneTurnIndex` is a positive finite integer
- `lastDoneTurnIndex > lastReadTurnIndex`

Both successful and failed completed turns count. Running sessions do not count. This matches the
existing visual states `completed-unviewed` and `failed-unviewed`, and avoids mixing "in progress"
with "done and needs attention".

The mobile non-gesture 3tap Chat button renders a small green dot in its top-right corner when
`hasCompletedUnreadChatSession` is true. The dot has no number because the source state means
"there is completed unread work", while per-session `unreadCount` is still shown inside the quick
switch menu. When a user opens the selected session, existing `markChatSessionRead` and
`session.updated` merging update the summaries; once all completed unread sessions are read, the
derived boolean becomes false and the dot disappears.

## Quick Switch Hub Capsule

`buildMobileChatQuickSwitchSections` will include a stable `projectHubId` in each section, not only
the display label. `WorkspaceApp.tsx` will provide Hub accent styling to `ChatQuickSwitchMenu`
using the existing `resolveHubColor` / `hubAccentStyle` path.

The quick switch Hub capsule will use lightweight Hub coloring:

- `--hub-accent` drives the capsule border, text, and dot.
- The background is a low-opacity mix of the Hub color.
- The capsule remains compact and secondary to the project name and session rows.

This keeps it consistent with the existing project list Hub tags while avoiding a solid color block
that would compete with the green unread indicator.

## Quick Create Entry

Each quick switch project header gains a plus icon button after the Hub capsule. The button opens a
compact agent dropdown directly below that project header. The existing session rows remain visible
while the dropdown is open, so users can still switch sessions without losing context.

The dropdown lists agents using the same project agent resolution as the project sidebar:

- configured project agent list / profiles
- session-derived agent types where applicable
- normalized names through the existing agent helpers

Even projects with a single agent still show the dropdown for a consistent create flow. Projects
with no available agents show `No agents available.`

Clicking an agent calls the existing project session creation flow:

```ts
handleProjectCreateSession(projectId, agentType, { closeMobileDrawer: true })
```

On success, the quick switch menu closes and the app switches to the newly created session. While a
create request is in flight, the dropdown disables repeated agent clicks and shows a loading state
for the selected agent. Errors continue to use the existing `setError` path.

## Component Boundaries

- `mobileChatQuickSwitch.ts`
  - Continue building quick switch sections.
  - Add `projectHubId` to each section.
  - Keep session prioritization unchanged: unread/running sessions first, then newest.

- `ChatQuickSwitchMenu.tsx`
  - Render the project header as project name, Hub capsule, and plus button.
  - Accept callbacks and state for create dropdown behavior.
  - Render an inline agent dropdown for the active project.
  - Keep session row rendering delegated through existing props.

- `WorkspaceApp.tsx`
  - Derive `hasCompletedUnreadChatSession`.
  - Pass Hub accent styles, agent lists, create state, and create handlers into the quick switch menu.
  - Reuse `handleProjectCreateSession` for actual creation.
  - Close the quick switch menu after successful creation.

- CSS
  - Add green 3tap Chat badge styling.
  - Update quick switch Hub capsule coloring.
  - Add compact dropdown styles that do not resize session rows or overflow the mobile viewport.

## Error Handling

- If no agents are available, the dropdown shows an inert empty row.
- If session creation fails, the existing `handleProjectCreateSession` catch path sets the app error.
- The quick switch menu remains open on create failure so the user can retry or choose another
  session.
- Repeated clicks are prevented while a create request is pending for the same project/agent.

## Testing

Add focused tests around existing frontend test files:

- `web-mobile-chat-quick-switch.test.ts`
  - Section data includes `projectHubId`.
  - Existing priority ordering remains unchanged.

- `web-mobile-chat-quick-switch-ui.test.ts`
  - Chat button renders a green unread indicator from completed unread state.
  - The indicator is a dot, not a numeric badge.
  - Quick switch project headers include a plus button.
  - Hub capsule receives Hub accent styling.
  - Agent dropdown is rendered by the quick switch menu.
  - Create handler closes the quick switch menu on success.

- Existing `web-chat-session-state.test.ts` already covers the completed/failed unviewed state
  calculation. Add a small pure helper test only if the unread indicator derivation is extracted.

## Open Decisions

All user-facing choices are resolved:

- Green dot, no number.
- Completed unread includes failed completed sessions and excludes running sessions.
- Only mobile 3tap Chat gets the badge in this iteration.
- Hub capsule uses lightweight Hub color styling.
- Quick switch `+` only creates new sessions.
- `+` opens an agent dropdown even with one agent.
- Session rows remain visible while the dropdown is open.
- Successful creation closes the menu and switches to the new session.
