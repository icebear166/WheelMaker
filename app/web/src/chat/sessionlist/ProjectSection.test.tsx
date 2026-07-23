import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ProjectSection} from './ProjectSection';

const gesture = {
  onPointerDown: () => undefined,
  onPointerUp: () => undefined,
  onPointerCancel: () => undefined,
  onPointerLeave: () => undefined,
  onContextMenu: () => undefined,
};

async function renderSection(extra?: Partial<React.ComponentProps<typeof ProjectSection>>) {
  let tree: ReactTestRenderer | undefined;
  const props = {
    name: 'WheelMaker',
    hubLabel: 'LOCAL-HUB',
    hubVariantClass: 'wide-project-hub variant-0',
    hubAccentStyle: {'--hub-accent': '#58a6ff'} as React.CSSProperties,
    collapsed: false,
    pinned: false,
    active: false,
    mobile: false,
    projectGestureHandlers: gesture,
    onToggleCollapsed: jest.fn(),
    onNew: jest.fn(),
    onResume: jest.fn(),
    onTogglePin: jest.fn(),
    children: <div className="child-row" />,
    ...extra,
  };
  await act(async () => {
    tree = create(<ProjectSection {...props} />);
  });
  return {tree: tree!, props};
}

describe('ProjectSection', () => {
  it('renders project name, hub tag and three action buttons with visibility hooks', async () => {
    const {tree} = await renderSection();
    expect(tree.root.findByProps({className: 'wide-project-name'}).children).toEqual(['WheelMaker']);
    expect(tree.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('wide-project-hub-tag'))).toHaveLength(1);
    const addBtn = tree.root.findByProps({title: 'New session'});
    expect(addBtn.props.className).toContain('sl-action-primary');
    expect(tree.root.findByProps({title: 'Resume session'}).props.className).toContain('sl-action-secondary');
    expect(tree.root.findByProps({title: 'Pin project to top'}).props.className).toContain('sl-action-secondary');
  });

  it('hides children when collapsed and shows pin badge when pinned', async () => {
    const collapsed = await renderSection({collapsed: true});
    expect(collapsed.tree.root.findAllByProps({className: 'child-row'})).toHaveLength(0);

    const pinned = await renderSection({pinned: true});
    expect(pinned.tree.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('wide-project-pin-badge'))).toHaveLength(1);
    expect(pinned.tree.root.findByProps({title: 'Unpin project'}).props.className).toContain('active');
  });
});
