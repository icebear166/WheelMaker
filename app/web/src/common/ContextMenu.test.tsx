/**
 * @jest-environment jsdom
 */
import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';
import {ContextMenu} from './ContextMenu';
import type {ContextMenuModel, FileMenuAction} from '../file/fileMenuModel';

const model: ContextMenuModel = {
  groups: [
    {
      id: 'open',
      items: [{action: 'preview', icon: 'eye', label: 'Preview'}],
    },
    {
      id: 'tab',
      items: [{action: 'refresh', icon: 'refreshCw', label: 'Refresh', disabled: true}],
    },
  ],
};

describe('ContextMenu', () => {
  test('owns native context menu behavior on the rendered menu surface', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ContextMenu
          x={10}
          y={20}
          model={model}
          onAction={jest.fn()}
          onClose={jest.fn()}
          className="context-menu"
        />,
      );
    });

    const menu = renderer.root.findByProps({role: 'menu'});
    const preventDefault = jest.fn();
    expect(menu.props['data-context-menu-surface']).toBe('true');
    act(() => menu.props.onContextMenu({preventDefault}));
    expect(preventDefault).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
  });

  test('renders model groups and dispatches enabled actions', () => {
    const onAction = jest.fn();
    const onClose = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ContextMenu
          x={10}
          y={20}
          model={model}
          onAction={onAction}
          onClose={onClose}
          className="context-menu"
        />,
      );
    });

    expect(renderer.root.findAll(node => node.props.role === 'separator')).toHaveLength(1);
    const items = renderer.root.findAll(node => node.props.role === 'menuitem');
    expect(items).toHaveLength(2);
    act(() => items[0].props.onClick());
    act(() => items[1].props.onClick());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('preview');

    act(() => renderer.unmount());
  });
});
