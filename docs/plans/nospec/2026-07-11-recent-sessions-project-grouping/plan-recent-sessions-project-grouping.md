# Recent Sessions Project Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render shared Recent Sessions as lightweight, project-grouped sections while preserving the current recent-session selection limit and project-session actions.

**Architecture:** Keep the existing global recent-candidate selection in `mobileChatQuickSwitch.ts`, then transform the selected rows into ordered project sections. `WorkspaceApp.tsx` will store those sections and render one reusable lightweight project row plus its sessions in every Recent surface. Session rows will reuse the normal project-session agent badge, context-menu, long-press, and selection handlers rather than introduce parallel action logic.

**Tech Stack:** React 19, TypeScript, CSS custom properties, Jest, webpack.

---

### Task 1: Add a tested recent-session grouping builder

**Files:**
- Modify: `app/web/src/chat/mobileChatQuickSwitch.ts:138-163`
- Modify: `app/__tests__/web-mobile-chat-quick-switch.test.ts:1-110`

- [ ] **Step 1: Write the failing grouping test**

  Add the new builder to the test import and add this test after the existing quick-switch ordering test:

  ```ts
  test('groups selected recent sessions by project while retaining recent order', () => {
    const sections = buildRecentChatSessionProjectSections({
      projects: [project('p1', 'Alpha'), project('p2', 'Beta'), project('p3', 'Gamma')],
      sessionsByProjectId: {
        p1: [session('p1-old', '2026-05-01T00:00:00.000Z')],
        p2: [
          session('p2-newest', '2026-05-05T00:00:00.000Z'),
          session('p2-next', '2026-05-03T00:00:00.000Z'),
        ],
        p3: [session('p3-middle', '2026-05-04T00:00:00.000Z')],
      },
      limit: 8,
    });

    expect(sections.map(section => ({
      projectId: section.projectId,
      projectName: section.projectName,
      sessionIds: section.sessions.map(item => item.sessionId),
    }))).toEqual([
      {projectId: 'p2', projectName: 'Beta', sessionIds: ['p2-newest', 'p2-next']},
      {projectId: 'p3', projectName: 'Gamma', sessionIds: ['p3-middle']},
      {projectId: 'p1', projectName: 'Alpha', sessionIds: ['p1-old']},
    ]);
  });
  ```

- [ ] **Step 2: Run the focused test to verify RED**

  Run: `npm test -- web-mobile-chat-quick-switch.test.ts -t "groups selected recent sessions"`

  Expected: FAIL because `buildRecentChatSessionProjectSections` does not exist yet.

- [ ] **Step 3: Implement the minimal grouping builder**

  In `mobileChatQuickSwitch.ts`, add a `RecentChatSessionProjectSection` type next to `RecentChatSessionRow` and a builder immediately after `buildRecentChatSessionRows`:

  ```ts
  export type RecentChatSessionProjectSection = {
    projectId: string;
    projectName: string;
    sessions: RegistryChatSession[];
  };

  export function buildRecentChatSessionProjectSections(
    input: BuildMobileChatQuickSwitchSectionsInput,
  ): RecentChatSessionProjectSection[] {
    const sections: RecentChatSessionProjectSection[] = [];
    const sectionsByProjectId = new Map<string, RecentChatSessionProjectSection>();

    for (const row of buildRecentChatSessionRows(input)) {
      let section = sectionsByProjectId.get(row.projectId);
      if (!section) {
        section = {
          projectId: row.projectId,
          projectName: row.projectName,
          sessions: [],
        };
        sectionsByProjectId.set(row.projectId, section);
        sections.push(section);
      }
      section.sessions.push(row.session);
    }

    return sections;
  }
  ```

  Do not alter `buildRecentChatSessionRows`, its `limit` handling, or the 6-item mobile quick-switch builder.

- [ ] **Step 4: Run the focused test to verify GREEN**

  Run: `npm test -- web-mobile-chat-quick-switch.test.ts -t "groups selected recent sessions"`

  Expected: PASS with one passing test.

### Task 2: Render lightweight Recent project rows and reuse session actions

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx:89-94,3156,4987-4998,14697-14852,18383-18388`
- Modify: `app/web/src/styles/chat.css:1146-1237`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts:10-72`

- [ ] **Step 1: Write failing UI-structure assertions**

  Replace the old project-tag assertion with a test that verifies the grouped renderer and action reuse:

  ```ts
  test('renders recent sessions in lightweight project groups with shared session actions', () => {
    expect(mainTsx).toContain('buildRecentChatSessionProjectSections({');
    expect(mainTsx).toContain('renderRecentProjectSessionSection(section, mobile)');
    expect(mainTsx).toContain('recent-project-session-group');
    expect(mainTsx).toContain('recent-project-session-heading');
    expect(mainTsx).toContain('recent-project-session-create');
    expect(mainTsx).toContain('codicon codicon-add');
    expect(mainTsx).toContain('openWideProjectActionMenu(targetProjectId, \'new\', event.currentTarget);');
    expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, 'new');");
    expect(mainTsx).toContain('onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('wide-session-agent-tag');
    expect(mainTsx).not.toContain('recent-session-project-tag');
    expect(chatCss).toContain('.recent-project-session-heading');
    expect(chatCss).toContain('.recent-project-session-create');
  });
  ```

  Update the pinned-surface assertion to expect the same grouped renderer rather than a flat `recentSessions.map(...)` list.

- [ ] **Step 2: Run the focused UI test to verify RED**

  Run: `npm test -- web-chat-recent-sessions-ui.test.ts -t "lightweight project groups"`

  Expected: FAIL because the grouped rendering symbols do not exist yet.

- [ ] **Step 3: Replace the flat Recent state and renderer**

  In `WorkspaceApp.tsx`:

  1. Replace the `RecentChatSessionRow` import and state with `buildRecentChatSessionProjectSections`, `RecentChatSessionProjectSection`, and `recentSessionSections`.
  2. Change `recomputeRecentSessions` to call the grouping builder with the existing `limit: 8`.
  3. Change the Recent empty checks to use `recentSessionSections.length`.
  4. Implement `renderRecentProjectSessionSection(section, mobile)`. Its heading is a non-collapsible `<div>` containing the project name and a `codicon-add` button. The button opens the existing agent picker with `openWideProjectActionMenu(projectId, 'new', currentTarget)` on desktop and `openMobileProjectActionMenu(projectId, 'new')` on mobile.
  5. Change `renderRecentSessionRow` to accept `(targetProjectId, session, mobile)`, resolve the live session exactly as today, and use the same pointer-down, pointer-up, pointer-cancel, pointer-leave, context-menu, and click handlers as `renderProjectSessionRow`. Render `wide-session-agent-tag` plus the existing relative-time text; remove the redundant project-name pill.
  6. Use `recentSessionSections.map(section => renderRecentProjectSessionSection(section, mobile))` in both the normal Recent section and the pinned floating Recent surface.

  The key session-row structure is:

  ```tsx
  <button
    type="button"
    className={`wide-session-row recent-session-row${mobile ? ' mobile-session-row' : ''}${selected ? ' selected' : ''}`}
    onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}
    onPointerUp={finishProjectSessionLongPress}
    onPointerCancel={finishProjectSessionLongPress}
    onPointerLeave={finishProjectSessionLongPress}
    onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}
  >
    {renderSessionStateMarker(liveSession, targetProjectId)}
    <span className="wide-session-title">{resolveSessionDisplayTitle(liveSession) || liveSession.sessionId}</span>
    {displaySessionAgent ? (
      <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', sessionAgent)}`}>
        {displaySessionAgent}
      </span>
    ) : null}
    <span className="wide-session-time" title={liveSession.updatedAt || ''}>
      {formatCompactRelativeAge(liveSession.updatedAt)}
    </span>
  </button>
  ```

- [ ] **Step 4: Add the lightweight visual hierarchy in CSS**

  Remove the `.recent-session-project-tag` styles. Add dedicated Recent group styles that keep the heading compact, unboxed, and separate from the formal project header treatment:

  ```css
  .recent-project-session-group {
    margin: 5px 0 7px;
  }

  .recent-project-session-heading {
    min-height: 26px;
    padding: 0 5px 0 2px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .recent-project-session-name {
    min-width: 0;
    overflow: hidden;
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-project-session-create {
    width: 22px;
    height: 22px;
    margin-left: auto;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
  }

  .recent-project-session-list {
    padding-left: 18px;
  }
  ```

  Add hover, focus-visible, and active styles matching existing icon-action controls. Keep the outer Recent collapse/pin behavior and its pinned container untouched.

- [ ] **Step 5: Run focused UI tests to verify GREEN**

  Run: `npm test -- web-chat-recent-sessions-ui.test.ts web-mobile-chat-quick-switch.test.ts`

  Expected: PASS with the existing Recent and quick-switch tests plus the new grouping assertions.

### Task 3: Verify the integrated Web UI and publish the change

**Files:**
- Modify: `docs/plans/nospec/2026-07-11-recent-sessions-project-grouping/plan-recent-sessions-project-grouping.md` only to check completed tasks if desired.

- [ ] **Step 1: Run targeted test verification**

  Run: `npm test -- web-chat-recent-sessions-ui.test.ts web-mobile-chat-quick-switch.test.ts`

  Expected: PASS with zero failed tests.

- [ ] **Step 2: Run static type verification**

  Run: `npm run tsc:web`

  Expected: exit code 0.

- [ ] **Step 3: Build the Web bundle**

  Run: `npm run build:web`

  Expected: webpack completes successfully and writes the configured Web output.

- [ ] **Step 4: Inspect the final diff**

  Run: `git diff --check; git diff -- app/web/src/chat/mobileChatQuickSwitch.ts app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-mobile-chat-quick-switch.test.ts app/__tests__/web-chat-recent-sessions-ui.test.ts`

  Expected: no whitespace errors; only the planned grouping, interaction reuse, styling, and test changes are present.

- [ ] **Step 5: Commit and push**

  Run:

  ```powershell
  git add -A
  git commit -m "feat: group recent sessions by project"
  git push origin main
  ```

  Expected: commit succeeds and `origin/main` accepts the push.
