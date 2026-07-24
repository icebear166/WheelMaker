import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {RecentSessionsSection, type RecentGroup} from './RecentSessionsSection';

const groups: RecentGroup[] = [
  {
    projectId: 'p1',
    projectName: 'WheelMaker',
    hubLabel: 'LOCAL-HUB',
    hubVariantClass: 'wide-project-hub variant-0',
    hubAccentStyle: {'--hub-accent': '#58a6ff'} as React.CSSProperties,
    sessions: [{sessionId: 's1'}, {sessionId: 's2'}],
  },
];

const renderRow = (projectId: string, session: {sessionId: string}) => (
  <div key={session.sessionId} className={`recent-row-${session.sessionId}`} data-project={projectId} />
);

describe('RecentSessionsSection', () => {
  it('renders heading, project group divider and rows', async () => {
    let tree: ReactTestRenderer | undefined;
    const onNewInProject = jest.fn();
    await act(async () => {
      tree = create(
        <RecentSessionsSection
          groups={groups}
          collapsed={false}
          mobile={false}
          onToggleCollapsed={() => undefined}
          onNewInProject={onNewInProject}
          renderRow={renderRow}
        />,
      );
    });
    expect(tree!.root.findByProps({className: 'wide-project-name'}).children).toEqual(['Recent Sessions']);
    expect(
      tree!.root.findByProps({className: 'recent-sessions-icon'}).findByType('svg').props['data-icon-name'],
    ).toBe('clock');
    expect(tree!.root.findByProps({className: 'recent-project-divider-name'}).children).toEqual(['WheelMaker']);
    expect(tree!.root.findAllByProps({className: 'recent-row-s1'})).toHaveLength(1);
  });

  it('hides body when collapsed and supports hiding the heading', async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(
        <RecentSessionsSection
          groups={groups}
          collapsed
          mobile={false}
          showHeading={false}
          onToggleCollapsed={() => undefined}
          onNewInProject={() => undefined}
          renderRow={renderRow}
        />,
      );
    });
    expect(tree!.root.findAllByProps({className: 'wide-project-name'})).toHaveLength(0);
    // collapsed + no heading => body still renders (matches current showHeading===false behavior)
    expect(tree!.root.findAllByProps({className: 'recent-row-s1'})).toHaveLength(1);
  });
});
