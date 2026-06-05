import {
  buildMobileChatQuickSwitchSections,
  hasCompletedUnreadChatSession,
} from '../web/src/chat/mobileChatQuickSwitch';
import type {RegistryChatSession, RegistryProject} from '../web/src/registry/registryTypes';

function project(projectId: string, name = projectId, hubId = 'local'): RegistryProject {
  return {
    projectId,
    name,
    online: true,
    path: `/${projectId}`,
    hubId,
  };
}

function session(
  sessionId: string,
  updatedAt: string,
  flags: Partial<Pick<
    RegistryChatSession,
    'running' | 'unreadCount' | 'lastDoneTurnIndex' | 'lastReadTurnIndex'
  >> = {},
): RegistryChatSession {
  return {
    sessionId,
    title: sessionId,
    preview: '',
    updatedAt,
    messageCount: 1,
    ...flags,
  };
}

describe('mobile chat quick switch', () => {
  test('selects six sessions with unread and running first, then newest updates', () => {
    const sections = buildMobileChatQuickSwitchSections({
      projects: [project('p1', 'Alpha', 'hub-a'), project('p2', 'Beta', 'hub-b'), project('p3', 'Gamma', '')],
      sessionsByProjectId: {
        p1: [
          session('p1-old-a', '2026-01-01T00:00:00.000Z'),
          session('p1-old-b', '2026-01-02T00:00:00.000Z'),
          session('p1-mid', '2026-05-04T00:00:00.000Z'),
        ],
        p2: [
          session('p2-newest', '2026-05-08T00:00:00.000Z'),
          session('p2-running-old', '2026-01-03T00:00:00.000Z', {running: true}),
          session('p2-new', '2026-05-07T00:00:00.000Z'),
        ],
        p3: [
          session('p3-unread-old', '2026-01-04T00:00:00.000Z', {unreadCount: 1}),
          session('p3-recent', '2026-05-06T00:00:00.000Z'),
          session('p3-newer', '2026-05-09T00:00:00.000Z'),
          session('p3-old', '2026-01-05T00:00:00.000Z'),
        ],
      },
    });

    expect(sections.flatMap(section =>
      section.sessions.map(item => `${section.projectId}:${item.sessionId}`),
    )).toEqual([
      'p3:p3-unread-old',
      'p3:p3-newer',
      'p3:p3-recent',
      'p2:p2-running-old',
      'p2:p2-newest',
      'p2:p2-new',
    ]);
    expect(sections.flatMap(section => section.sessions)).toHaveLength(6);
    expect(sections.map(section => ({
      projectId: section.projectId,
      projectName: section.projectName,
      projectHubId: section.projectHubId,
      projectHubLabel: section.projectHubLabel,
    }))).toEqual([
      {projectId: 'p3', projectName: 'Gamma', projectHubId: 'local', projectHubLabel: 'local'},
      {projectId: 'p2', projectName: 'Beta', projectHubId: 'hub-b', projectHubLabel: 'hub-b'},
    ]);
  });

  test('returns an empty section list when no known sessions exist', () => {
    expect(buildMobileChatQuickSwitchSections({
      projects: [project('p1')],
      sessionsByProjectId: {p1: []},
    })).toEqual([]);
  });

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
});
