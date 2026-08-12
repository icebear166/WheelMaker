import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {SessionListView} from './SessionListView';

async function renderSearchList() {
  const onToggleProjectCollapsed = jest.fn();
  const onSelectSession = jest.fn();
  const props = {
    mobile: false,
    mode: 'search',
    hasProjects: true,
    recentGroups: [],
    recentCollapsed: false,
    showRecentHeading: true,
    onToggleRecent: jest.fn(),
    projectItems: [{projectId: 'p1', name: 'One', hubId: 'local'}],
    activeProjectId: 'p1',
    collapsedProjectIds: [],
    pinnedProjectIds: ['p1'],
    sessionsByProjectId: {
      p1: [{sessionId: 's1', title: 'Matched', pinned: true, updatedAt: '2026-08-12T00:00:00Z'}],
    },
    draftSessionsByProjectId: {
      p1: [{draftId: 'draft-1', title: 'Draft', status: 'creating'}],
    },
    olderExpandedByProjectId: {},
    selectedChatEncodedKey: 'p1:s1',
    pinningSessionKey: '',
    mobileSessionErrors: {},
    onRetryMobileSessions: jest.fn(),
    resolveTitle: (session: {title?: string}) => session.title ?? '',
    projectHubClass: () => 'variant-0',
    hubAccentStyle: () => ({}),
    formatAge: () => 'now',
    runtimeKey: (projectId: string, sessionId: string) => `${projectId}:${sessionId}`,
    sessionActionKey: (projectId: string, sessionId: string) => `${projectId}:${sessionId}`,
    renderLeadingState: () => null,
    splitOlder: (_projectId: string, sessions: Array<{sessionId: string}>) => ({
      visibleSessions: sessions,
      showToggle: true,
      hiddenOlderCount: 4,
    }),
    onSelectSession,
    onSelectDraft: jest.fn(),
    onDismissDraft: jest.fn(),
    onUnpinSession: jest.fn(),
    onToggleProjectCollapsed,
    onTogglePinnedProject: jest.fn(),
    onToggleOlder: jest.fn(),
    onOpenProjectMenu: jest.fn(),
    onOpenSessionContextMenu: jest.fn(),
    onOpenProjectContextMenu: jest.fn(),
    emptyProjectsHint: <div className="empty-projects" />,
    hiddenProjectRows: <div className="hidden-projects" />,
    archivedRows: <div className="archived-projects" />,
    searchStatus: <div className="search-status" />,
  };
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<SessionListView {...props as React.ComponentProps<typeof SessionListView>} />);
  });
  return {tree: tree!, props};
}

describe('SessionListView search mode', () => {
  it('reuses project and session rows while hiding every management surface', async () => {
    const {tree} = await renderSearchList();

    expect(tree.root.findByProps({className: 'wide-project-name'}).children).toEqual(['One']);
    const sessionRow = tree.root.find(node =>
      node.type === 'button' && typeof node.props.className === 'string' && node.props.className.includes('wide-session-row'),
    );
    expect(sessionRow.findByProps({className: 'wide-session-title'}).children).toEqual(['Matched']);
    expect(sessionRow.props['data-context-menu-target']).toBeUndefined();
    expect(tree.root.findAllByProps({'data-tooltip': 'New session'})).toHaveLength(0);
    expect(tree.root.findAllByProps({'data-tooltip': 'Resume session'})).toHaveLength(0);
    expect(tree.root.findAllByProps({'data-tooltip': 'Unpin session'})).toHaveLength(0);
    expect(tree.root.findAllByProps({className: 'draft-session-row-wrap'})).toHaveLength(0);
    expect(tree.root.findAllByProps({className: 'wide-session-row session-older-toggle'})).toHaveLength(0);
    expect(tree.root.findAllByProps({className: 'hidden-projects'})).toHaveLength(0);
    expect(tree.root.findAllByProps({className: 'search-status'})).toHaveLength(1);
  });

  it('keeps project collapse and session selection available', async () => {
    const {tree, props} = await renderSearchList();
    const projectToggle = tree.root.findByProps({className: 'wide-project-toggle'});
    const sessionRow = tree.root.find(node =>
      node.type === 'button' && typeof node.props.className === 'string' && node.props.className.includes('wide-session-row'),
    );

    await act(async () => projectToggle.props.onClick({}));
    await act(async () => sessionRow.props.onClick({}));

    expect(props.onToggleProjectCollapsed).toHaveBeenCalledWith('p1');
    expect(props.onSelectSession).toHaveBeenCalledWith('p1', 's1', {});
  });
});
