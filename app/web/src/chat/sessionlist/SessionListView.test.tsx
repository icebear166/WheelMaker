import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionListView, type SessionListViewProps} from './SessionListView';

function makeProps(overrides?: Partial<SessionListViewProps>): SessionListViewProps {
  return {
    mobile: false,
    mode: 'normal',
    hasProjects: true,
    recentGroups: [],
    recentCollapsed: false,
    showRecentHeading: true,
    onToggleRecent: jest.fn(),
    projectItems: [
      {projectId: 'p1', name: 'WheelMaker', hubId: 'local'},
      {projectId: 'p2', name: 'MiscTools', hubId: 'ks'},
    ],
    activeProjectId: 'p1',
    collapsedProjectIds: [],
    pinnedProjectIds: [],
    sessionsByProjectId: {
      p1: [{sessionId: 's1', title: 'Fix bug', agentType: 'kimi', updatedAt: '2026-07-24T00:00:00Z'} as never],
      p2: [],
    },
    draftSessionsByProjectId: {},
    olderExpandedByProjectId: {},
    selectedChatEncodedKey: '',
    pinningSessionKey: '',
    mobileSessionErrors: {},
    onRetryMobileSessions: jest.fn(),
    resolveTitle: s => (s as {title?: string}).title ?? (s as {sessionId: string}).sessionId,
    agentLabel: () => 'cc · kimi',
    sessionAgentClass: () => 'wide-session-agent variant-1',
    projectHubClass: () => 'wide-project-hub variant-0',
    hubAccentStyle: () => ({'--hub-accent': '#58a6ff'} as React.CSSProperties),
    formatAge: () => '3m',
    runtimeKey: (p, s) => `${p}:${s}`,
    sessionActionKey: (p, s) => `${p}:${s}`,
    renderLeadingState: () => null,
    splitOlder: (_p, sessions) => ({visibleSessions: sessions, showToggle: false, hiddenOlderCount: 0}),
    onSelectSession: jest.fn(),
    onSelectDraft: jest.fn(),
    onDismissDraft: jest.fn(),
    onUnpinSession: jest.fn(),
    onToggleProjectCollapsed: jest.fn(),
    onTogglePinnedProject: jest.fn(),
    onToggleOlder: jest.fn(),
    onOpenProjectMenu: jest.fn(),
    onOpenSessionContextMenu: jest.fn(),
    sessionGestureHandlers: () => ({
      onPointerDown: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
      onPointerLeave: () => undefined,
    }),
    consumeSessionLongPressClick: () => false,
    projectGestureHandlers: () => ({
      onPointerDown: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
      onPointerLeave: () => undefined,
      onContextMenu: () => undefined,
    }),
    consumeProjectLongPressClick: () => false,
    emptyProjectsHint: null,
    hiddenProjectRows: null,
    archivedRows: null,
    searchResults: null,
    ...overrides,
  };
}

describe('SessionListView', () => {
  it('renders project sections and empty hint for a project without sessions', async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(<SessionListView {...makeProps()} />);
    });
    const names = tree!.root.findAllByProps({className: 'wide-project-name'}).map(n => n.children.join(''));
    expect(names).toEqual(['WheelMaker', 'MiscTools']);
    expect(tree!.root.findAllByProps({className: 'wide-project-empty'})).toHaveLength(1);
  });

  it('routes session click through onSelectSession with project and session id', async () => {
    const props = makeProps();
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(<SessionListView {...props} />);
    });
    const row = tree!.root.findAllByType('button').find(b => typeof b.props.className === 'string' && b.props.className.includes('wide-session-row'))!;
    await act(async () => {
      row.props.onClick({stopPropagation: jest.fn()});
    });
    expect(props.onSelectSession).toHaveBeenCalledWith('p1', 's1', expect.anything());
  });

  it('renders archivedRows in archived mode and searchResults in search mode', async () => {
    let archived: ReactTestRenderer | undefined;
    await act(async () => {
      archived = create(<SessionListView {...makeProps({mode: 'archived', archivedRows: <div className="archived-marker" />})} />);
    });
    expect(archived!.root.findAllByProps({className: 'archived-marker'})).toHaveLength(1);
    expect(archived!.root.findAllByProps({className: 'wide-project-name'})).toHaveLength(0);

    let search: ReactTestRenderer | undefined;
    await act(async () => {
      search = create(<SessionListView {...makeProps({mode: 'search', searchResults: <div className="search-marker" />})} />);
    });
    expect(search!.root.findAllByProps({className: 'search-marker'})).toHaveLength(1);
  });
});
