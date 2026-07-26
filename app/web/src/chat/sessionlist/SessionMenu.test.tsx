import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionMenu} from './SessionMenu';

async function renderMenu(extra?: Partial<React.ComponentProps<typeof SessionMenu>>) {
  let tree: ReactTestRenderer | undefined;
  const props = {
    pinned: false,
    pinning: false,
    markColor: undefined,
    marking: false,
    renaming: false,
    actionDisabled: false,
    archiving: false,
    reloading: false,
    deleting: false,
    onTogglePin: jest.fn(),
    onSetMark: jest.fn(),
    onRename: jest.fn(),
    onArchive: jest.fn(),
    onReload: jest.fn(),
    onDelete: jest.fn(),
    onClose: jest.fn(),
    ...extra,
  };
  await act(async () => {
    tree = create(<SessionMenu {...props} />);
  });
  return {tree: tree!, props};
}

describe('SessionMenu', () => {
  it('renders the mark palette above Pin with separators between menu groups', async () => {
    const {tree} = await renderMenu();
    const menu = tree.root.findByProps({role: 'menu'});
    expect(typeof menu.props.onKeyDown).toBe('function');
    const labels = tree.root
      .findAll(node => node.type === 'span' && typeof node.props.className === 'string' && node.props.className.includes('project-session-menu-label'))
      .map(node => node.children.join(''));
    expect(labels).toEqual(['Pin', 'Rename', 'Archive', 'Reload', 'Delete']);
    expect(
      menu.children
        .filter(child => typeof child !== 'string')
        .map(child => child.props.className),
    ).toEqual([
      'project-session-mark-picker',
      'project-session-menu-separator',
      'project-session-menu-btn pin',
      'project-session-menu-btn rename',
      'project-session-menu-btn archive',
      'project-session-menu-separator',
      'project-session-menu-btn reload',
      'project-session-menu-btn delete',
    ]);
    // every item has an svg icon
    expect(tree.root.findAllByType('svg').length).toBeGreaterThanOrEqual(5);
  });

  it('shows Unpin when pinned and routes callbacks', async () => {
    const {tree, props} = await renderMenu({pinned: true});
    const labels = tree.root
      .findAll(node => node.type === 'span' && typeof node.props.className === 'string' && node.props.className.includes('project-session-menu-label'))
      .map(node => node.children.join(''));
    expect(labels[0]).toBe('Unpin');
    const archiveBtn = tree.root.findByProps({className: 'project-session-menu-btn archive'});
    await act(async () => {
      archiveBtn.props.onClick({stopPropagation: jest.fn()});
    });
    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it('renders four circular mark colors and a matching clear control', async () => {
    const {tree} = await renderMenu({markColor: 'yellow'});

    const picker = tree.root.findByProps({className: 'project-session-mark-picker'});
    const options = picker.findAllByProps({role: 'menuitemradio'});

    expect(options.map(option => option.props['aria-label'])).toEqual([
      'Mark red',
      'Mark yellow',
      'Mark green',
      'Mark blue',
      'Clear mark',
    ]);
    expect(options.map(option => option.props.className)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('session-mark-red'),
        expect.stringContaining('session-mark-yellow'),
        expect.stringContaining('session-mark-green'),
        expect.stringContaining('session-mark-blue'),
        expect.stringContaining('project-session-mark-clear'),
      ]),
    );
    expect(options[1].props['aria-checked']).toBe(true);
    expect(options[4].findByProps({'data-icon-name': 'ban'})).toBeTruthy();
  });

  it('routes a mark color and disables the whole palette while marking', async () => {
    const {tree, props} = await renderMenu();
    const stopPropagation = jest.fn();

    act(() => {
      tree.root.findByProps({'aria-label': 'Mark blue'}).props.onClick({stopPropagation});
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(props.onSetMark).toHaveBeenCalledWith('blue');

    const busy = await renderMenu({marking: true});
    expect(
      busy.tree.root.findAllByProps({role: 'menuitemradio'}).every(option => option.props.disabled === true),
    ).toBe(true);
  });

  it('disables destructive/busy actions and shows spinner', async () => {
    const {tree} = await renderMenu({actionDisabled: true, archiving: true});
    const archiveBtn = tree.root.findByProps({className: 'project-session-menu-btn archive'});
    expect(archiveBtn.props.disabled).toBe(true);
    expect(archiveBtn.findByType('svg').props.className).toContain('sl-icon-spin');
    expect(tree.root.findByProps({className: 'project-session-menu-btn delete'}).props.disabled).toBe(true);
    expect(tree.root.findByProps({className: 'project-session-menu-btn rename'}).props.disabled).toBe(false);
  });
});
