import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionListView, type SessionListViewProps} from './SessionListView';

function pointerEvent(values: Record<string, unknown>) {
  return {
    pointerType: 'touch',
    button: 0,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    ...values,
  } as never;
}

function contextMenuEvent(values: Record<string, unknown>) {
  return {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    ...values,
  } as never;
}

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
    onOpenProjectContextMenu: jest.fn(),
    emptyProjectsHint: null,
    hiddenProjectRows: null,
    archivedRows: null,
    searchResults: null,
    ...overrides,
  };
}

describe('SessionListView', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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

  it('passes the same mark metadata through project and Recent rows', async () => {
    const marked = {
      sessionId: 's1',
      title: 'Fix bug',
      agentType: 'kimi',
      updatedAt: '2026-07-24T00:00:00Z',
      markColor: 'green' as const,
    };
    let tree: ReactTestRenderer | undefined;

    await act(async () => {
      tree = create(
        <SessionListView
          {...makeProps({
            sessionsByProjectId: {p1: [marked], p2: []},
            recentGroups: [
              {
                projectId: 'p1',
                projectName: 'WheelMaker',
                hubLabel: 'local',
                hubVariantClass: 'wide-project-hub variant-0',
                hubAccentStyle: {'--hub-accent': '#58a6ff'} as React.CSSProperties,
                sessions: [marked],
              },
            ],
          })}
        />,
      );
    });

    expect(
      tree!.root.findAllByProps({className: 'wide-session-mark session-mark-green'}),
    ).toHaveLength(2);
  });

  it('opens normal and Recent Session menus through the shared position gesture', async () => {
    const onOpenSessionContextMenu = jest.fn();
    const session = {sessionId: 's1', title: 'Fix bug', updatedAt: '2026-07-24T00:00:00Z'};
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(
        <SessionListView
          {...makeProps({
            onOpenSessionContextMenu,
            recentGroups: [{
              projectId: 'p1',
              projectName: 'WheelMaker',
              hubLabel: 'local',
              hubVariantClass: 'wide-project-hub variant-0',
              hubAccentStyle: {'--hub-accent': '#58a6ff'} as React.CSSProperties,
              sessions: [session],
            }],
          })}
        />,
      );
    });
    const rows = tree!.root.findAllByType('button').filter(button =>
      typeof button.props.className === 'string'
      && button.props.className.includes('wide-session-row')
      && !button.props.className.includes('draft-session-row'),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.props['data-context-menu-target'] === 'true')).toBe(true);

    await act(async () => {
      rows[0].props.onContextMenu(contextMenuEvent({clientX: 11, clientY: 12}));
    });
    expect(onOpenSessionContextMenu).toHaveBeenCalledWith('p1', 's1', {x: 11, y: 12});

    await act(async () => {
      rows[1].props.onPointerDown(pointerEvent({pointerId: 7, clientX: 21, clientY: 22}));
      jest.advanceTimersByTime(450);
    });
    expect(onOpenSessionContextMenu).toHaveBeenLastCalledWith('p1', 's1', {x: 21, y: 22});
  });

  it('opens Project title menus through the shared gesture and excludes Draft rows', async () => {
    const onOpenProjectContextMenu = jest.fn();
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(
        <SessionListView
          {...makeProps({
            onOpenProjectContextMenu,
            draftSessionsByProjectId: {
              p1: [{draftId: 'd1', title: 'Sending', status: 'sendingFirstPrompt'}],
            },
          })}
        />,
      );
    });
    const project = tree!.root.findAllByType('button').find(button =>
      button.props.className === 'wide-project-toggle',
    )!;
    expect(project.props['data-context-menu-target']).toBe('true');
    await act(async () => {
      project.props.onContextMenu(contextMenuEvent({clientX: 31, clientY: 32}));
    });
    expect(onOpenProjectContextMenu).toHaveBeenCalledWith('p1', {x: 31, y: 32});

    await act(async () => {
      project.props.onPointerDown(pointerEvent({pointerId: 8, clientX: 41, clientY: 42}));
      jest.advanceTimersByTime(450);
    });
    expect(onOpenProjectContextMenu).toHaveBeenLastCalledWith('p1', {x: 41, y: 42});

    const draft = tree!.root.findAllByType('button').find(button =>
      typeof button.props.className === 'string'
      && button.props.className.includes('draft-session-row'),
    )!;
    expect(draft.props['data-context-menu-target']).toBeUndefined();
  });
});
