import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionMenu} from './SessionMenu';

async function renderMenu(extra?: Partial<React.ComponentProps<typeof SessionMenu>>) {
  let tree: ReactTestRenderer | undefined;
  const props = {
    pinned: false,
    pinning: false,
    renaming: false,
    actionDisabled: false,
    archiving: false,
    reloading: false,
    deleting: false,
    onTogglePin: jest.fn(),
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
  it('renders five menu items in order with a separator before Reload', async () => {
    const {tree} = await renderMenu();
    expect(typeof tree.root.findByProps({role: 'menu'}).props.onKeyDown).toBe('function');
    const labels = tree.root
      .findAll(node => node.type === 'span' && typeof node.props.className === 'string' && node.props.className.includes('project-session-menu-label'))
      .map(node => node.children.join(''));
    expect(labels).toEqual(['Pin', 'Rename', 'Archive', 'Reload', 'Delete']);
    expect(tree.root.findAllByProps({className: 'project-session-menu-separator'})).toHaveLength(1);
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

  it('disables destructive/busy actions and shows spinner', async () => {
    const {tree} = await renderMenu({actionDisabled: true, archiving: true});
    const archiveBtn = tree.root.findByProps({className: 'project-session-menu-btn archive'});
    expect(archiveBtn.props.disabled).toBe(true);
    expect(archiveBtn.findByType('svg').props.className).toContain('sl-icon-spin');
    expect(tree.root.findByProps({className: 'project-session-menu-btn delete'}).props.disabled).toBe(true);
    expect(tree.root.findByProps({className: 'project-session-menu-btn rename'}).props.disabled).toBe(false);
  });
});
