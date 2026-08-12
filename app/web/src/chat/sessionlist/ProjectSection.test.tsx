import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ProjectSection} from './ProjectSection';

const gesture = {
  'data-context-menu-target': 'true' as const,
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
    const addBtn = tree.root.findByProps({'data-tooltip': 'New session'});
    expect(addBtn.props.className).toContain('sl-action-primary');
    const resumeBtn = tree.root.findByProps({'data-tooltip': 'Resume session'});
    expect(resumeBtn.props.className).toContain('sl-action-secondary');
    expect(resumeBtn.findByType('svg').props['data-icon-name']).toBe('import');
    expect(tree.root.findByProps({'data-tooltip': 'Pin project to top'}).props.className).toContain('sl-action-secondary');
  });

  it('applies the hub accent to the folder icon as well as the hub tag', async () => {
    const {tree, props} = await renderSection();
    const folderIcon = tree.root.findAll(
      node => node.type === 'svg' && typeof node.props.className === 'string' && node.props.className.includes('wide-project-folder-icon'),
    )[0];

    expect(folderIcon.props.style).toEqual(props.hubAccentStyle);
  });

  it('hides children when collapsed and shows pin badge when pinned', async () => {
    const collapsed = await renderSection({collapsed: true});
    expect(collapsed.tree.root.findAllByProps({className: 'child-row'})).toHaveLength(0);

    const pinned = await renderSection({pinned: true});
    expect(pinned.tree.root.findAll(node => node.type === 'svg' && typeof node.props.className === 'string' && node.props.className.includes('wide-project-pin-badge'))).toHaveLength(1);
    expect(pinned.tree.root.findByProps({'data-tooltip': 'Unpin project'}).props.className).toContain('active');
  });

  it('lets project actions short click but suppresses their held click', async () => {
    jest.useFakeTimers();
    const {tree, props} = await renderSection();
    const actionButtons = [
      tree.root.findByProps({'data-tooltip': 'Resume session'}),
      tree.root.findByProps({'data-tooltip': 'Pin project to top'}),
      tree.root.findByProps({'data-tooltip': 'New session'}),
    ];
    expect(actionButtons.every(button => button.props['data-context-menu-action'] === 'true')).toBe(true);

    await act(async () => {
      actionButtons[0].props.onClick({stopPropagation: jest.fn()});
      actionButtons[1].props.onClick({stopPropagation: jest.fn()});
      actionButtons[2].props.onClick({stopPropagation: jest.fn()});
    });
    expect(props.onResume).toHaveBeenCalledTimes(1);
    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    expect(props.onNew).toHaveBeenCalledTimes(1);

    for (const [index, button] of actionButtons.entries()) {
      const pointerDown = {
        pointerType: 'touch', button: 0, pointerId: index + 10,
        clientX: 2, clientY: 3, stopPropagation: jest.fn(),
      };
      await act(async () => {
        button.props.onPointerDown(pointerDown);
        jest.advanceTimersByTime(450);
      });
      const heldClick = {preventDefault: jest.fn(), stopPropagation: jest.fn()};
      await act(async () => button.props.onClickCapture(heldClick));
      expect(heldClick.preventDefault).toHaveBeenCalledTimes(1);
      expect(pointerDown.stopPropagation).toHaveBeenCalledTimes(1);
    }
    expect(props.onResume).toHaveBeenCalledTimes(1);
    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    expect(props.onNew).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('keeps collapse but removes management actions and gestures when read only', async () => {
    const {tree, props} = await renderSection({readOnly: true} as Partial<React.ComponentProps<typeof ProjectSection>>);

    const toggle = tree.root.findByProps({className: 'wide-project-toggle'});
    expect(toggle.props['data-context-menu-target']).toBeUndefined();
    expect(tree.root.findAllByProps({'data-tooltip': 'New session'})).toHaveLength(0);
    expect(tree.root.findAllByProps({'data-tooltip': 'Resume session'})).toHaveLength(0);
    expect(tree.root.findAllByProps({'data-tooltip': 'Pin project to top'})).toHaveLength(0);

    await act(async () => toggle.props.onClick({}));
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});
