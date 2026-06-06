# Chat Quick Switch Unread Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile 3tap Chat completed-unread dot and a Hub-colored quick switch project create dropdown.

**Architecture:** Keep the behavior in the existing React Web UI. Add pure helpers to `mobileChatQuickSwitch.ts` for section Hub ids and completed-unread aggregation, extend `ChatQuickSwitchMenu.tsx` with controlled create dropdown props, and wire state/handlers from `WorkspaceApp.tsx` using the existing project-session creation flow.

**Tech Stack:** React 19, TypeScript, Jest source-structure tests, existing CSS modules under `app/web/src/styles`.

---

### Task 1: Quick Switch State Helpers

**Files:**
- Modify: `app/web/src/chat/mobileChatQuickSwitch.ts`
- Modify: `app/__tests__/web-mobile-chat-quick-switch.test.ts`

- [x] **Step 1: Write failing tests**

Extend `web-mobile-chat-quick-switch.test.ts` to assert each section has `projectHubId`, and add tests for a new pure helper:

```ts
import {
  buildMobileChatQuickSwitchSections,
  hasCompletedUnreadChatSession,
} from '../web/src/chat/mobileChatQuickSwitch';
```

Add expectations:

```ts
expect(sections.map(section => ({
  projectId: section.projectId,
  projectName: section.projectName,
  projectHubId: section.projectHubId,
  projectHubLabel: section.projectHubLabel,
}))).toEqual([
  {projectId: 'p3', projectName: 'Gamma', projectHubId: 'local', projectHubLabel: 'local'},
  {projectId: 'p2', projectName: 'Beta', projectHubId: 'hub-b', projectHubLabel: 'hub-b'},
]);
```

Add helper tests:

```ts
test('detects completed unread sessions and ignores running sessions', () => {
  expect(hasCompletedUnreadChatSession({
    p1: [
      session('running', '2026-01-01T00:00:00.000Z', {
        running: true,
        lastDoneTurnIndex: 5,
        lastReadTurnIndex: 0,
      }),
    ],
    p2: [
      session('done', '2026-01-02T00:00:00.000Z', {
        lastDoneTurnIndex: 6,
        lastReadTurnIndex: 4,
      }),
    ],
  })).toBe(true);

  expect(hasCompletedUnreadChatSession({
    p1: [
      session('read', '2026-01-03T00:00:00.000Z', {
        lastDoneTurnIndex: 6,
        lastReadTurnIndex: 6,
      }),
      session('idle', '2026-01-04T00:00:00.000Z'),
    ],
  })).toBe(false);
});
```

- [x] **Step 2: Run red test**

Run:

```powershell
cd app; npm test -- --runTestsByPath __tests__/web-mobile-chat-quick-switch.test.ts
```

Expected: FAIL because `hasCompletedUnreadChatSession` and `projectHubId` do not exist.

- [x] **Step 3: Implement helper and section field**

In `mobileChatQuickSwitch.ts`, add `projectHubId` to `MobileChatQuickSwitchSection` and candidate data. Export:

```ts
function nonNegativeTurnIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

export function hasCompletedUnreadChatSession(
  sessionsByProjectId: Record<string, RegistryChatSession[]>,
): boolean {
  return Object.values(sessionsByProjectId).some(sessions =>
    sessions.some(session => {
      if (session.running === true) {
        return false;
      }
      const lastDoneTurnIndex = nonNegativeTurnIndex(session.lastDoneTurnIndex);
      const lastReadTurnIndex = nonNegativeTurnIndex(session.lastReadTurnIndex);
      return lastDoneTurnIndex > 0 && lastDoneTurnIndex > lastReadTurnIndex;
    }),
  );
}
```

- [x] **Step 4: Run green test**

Run the same Jest command. Expected: PASS.

### Task 2: Quick Switch Menu Create UI

**Files:**
- Modify: `app/web/src/chat/ChatQuickSwitchMenu.tsx`
- Modify: `app/__tests__/web-mobile-chat-quick-switch-ui.test.ts`

- [x] **Step 1: Write failing source-structure tests**

Extend `web-mobile-chat-quick-switch-ui.test.ts` to assert:

```ts
expect(quickSwitchMenuTsx).toContain('onCreateSession');
expect(quickSwitchMenuTsx).toContain('className="chat-quick-switch-project-create"');
expect(quickSwitchMenuTsx).toContain('className="chat-quick-switch-create-menu"');
expect(quickSwitchMenuTsx).toContain('No agents available.');
expect(quickSwitchMenuTsx).toContain('className="chat-quick-switch-project-hub-dot"');
expect(quickSwitchMenuTsx).toContain('style={resolveProjectHubStyle(section.projectHubId)}');
expect(stylesCss).toContain('.chat-quick-switch-project-create');
expect(stylesCss).toContain('.chat-quick-switch-create-menu');
expect(stylesCss).toContain('.chat-quick-switch-project-hub-dot');
```

- [x] **Step 2: Run red test**

Run:

```powershell
cd app; npm test -- --runTestsByPath __tests__/web-mobile-chat-quick-switch-ui.test.ts
```

Expected: FAIL because the quick create props and CSS classes do not exist.

- [x] **Step 3: Implement controlled menu props**

Extend `ChatQuickSwitchMenuProps` with:

```ts
  createProjectId: string;
  createPendingKey: string;
  getProjectAgents: (projectId: string) => string[];
  resolveProjectHubStyle: (hubId: string) => React.CSSProperties;
  onToggleCreateProject: (projectId: string) => void;
  onCreateSession: (projectId: string, agentType: string) => Promise<void> | void;
```

Render the project header with Hub dot and plus button. If `createProjectId === section.projectId`, render a compact `chat-quick-switch-create-menu` before session rows. Agent buttons are disabled when `createPendingKey` is non-empty; the matching key is `${section.projectId}:${agentType}` and shows a loading codicon.

- [x] **Step 4: Run green test**

Run the same Jest command. Expected: PASS after CSS is added in Task 4 or this task.

### Task 3: Workspace Wiring

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-mobile-chat-quick-switch-ui.test.ts`

- [x] **Step 1: Write failing source-structure tests**

Extend `web-mobile-chat-quick-switch-ui.test.ts` to assert:

```ts
expect(mainTsx).toContain('hasCompletedUnreadChatSession');
expect(mainTsx).toContain('const hasCompletedUnreadChatSessionIndicator = useMemo(');
expect(mainTsx).toContain('className="floating-nav-unread-dot"');
expect(mainTsx).not.toContain('floating-nav-unread-count');
expect(mainTsx).toContain('const [chatQuickSwitchCreateProjectId, setChatQuickSwitchCreateProjectId] = useState');
expect(mainTsx).toContain('const [chatQuickSwitchCreatePendingKey, setChatQuickSwitchCreatePendingKey] = useState');
expect(mainTsx).toContain('getQuickSwitchProjectAgents');
expect(mainTsx).toContain('handleQuickSwitchCreateSession');
expect(mainTsx).toContain('setChatQuickSwitchMenuOpen(false);');
expect(mainTsx).toContain('resolveProjectHubStyle={hubAccentStyle}');
```

- [x] **Step 2: Run red test**

Run:

```powershell
cd app; npm test -- --runTestsByPath __tests__/web-mobile-chat-quick-switch-ui.test.ts
```

Expected: FAIL because WorkspaceApp has not been wired.

- [x] **Step 3: Implement WorkspaceApp state and handlers**

Update imports from `mobileChatQuickSwitch.ts` to include `hasCompletedUnreadChatSession`. Add:

```ts
const hasCompletedUnreadChatSessionIndicator = useMemo(
  () => hasCompletedUnreadChatSession(projectSessionsByProjectId),
  [projectSessionsByProjectId],
);
```

Add controlled quick-create state:

```ts
const [chatQuickSwitchCreateProjectId, setChatQuickSwitchCreateProjectId] = useState('');
const [chatQuickSwitchCreatePendingKey, setChatQuickSwitchCreatePendingKey] = useState('');
```

Add `getQuickSwitchProjectAgents`, `handleQuickSwitchCreateSession`, and reset create state when the quick switch menu closes. Pass all new props to `ChatQuickSwitchMenu`.

Render the dot inside the non-gesture mobile Chat button:

```tsx
{hasCompletedUnreadChatSessionIndicator ? (
  <span className="floating-nav-unread-dot" aria-hidden="true" />
) : null}
```

- [x] **Step 4: Run green test**

Run the same Jest command. Expected: PASS after CSS exists.

### Task 4: CSS and Final Verification

**Files:**
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/shell.css`

- [x] **Step 1: Add CSS**

Add quick switch create dropdown styles to `chat.css`, using compact dimensions and Hub accent variables. Add `floating-nav-unread-dot` to `shell.css` as an absolute green dot on nav buttons.

- [x] **Step 2: Run focused tests**

Run:

```powershell
cd app; npm test -- --runTestsByPath __tests__/web-mobile-chat-quick-switch.test.ts __tests__/web-mobile-chat-quick-switch-ui.test.ts
```

Expected: PASS.

- [x] **Step 3: Run typecheck**

Run:

```powershell
cd app; npm run tsc:web
```

Expected: PASS.

- [x] **Step 4: Run full relevant web tests**

Run:

```powershell
cd app; npm test -- --runTestsByPath __tests__/web-mobile-chat-quick-switch.test.ts __tests__/web-mobile-chat-quick-switch-ui.test.ts __tests__/web-chat-session-state.test.ts __tests__/web-chat-ui.test.ts
```

Expected: PASS.

- [x] **Step 5: Build web**

Run:

```powershell
cd app; npm run build:web
```

Expected: PASS.

## Self-Review

- Spec coverage: Tasks cover completed-unread dot, Hub-colored capsule, project plus button, agent dropdown, create behavior, no numeric badge, and no backend protocol changes.
- Placeholder scan: No deferred implementation placeholders remain.
- Type consistency: New prop names are consistent across `ChatQuickSwitchMenu.tsx` and `WorkspaceApp.tsx`.
