/**
 * @jest-environment jsdom
 */
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {PreviewTabContextMenu} from './PreviewTabContextMenu';
import {buildContextMenuModel} from '../file/fileMenuModel';

describe('PreviewTabContextMenu', () => {
  test('renders the grouped file model and dispatches actions', () => {
    const onAction = jest.fn();
    const model = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'browser',
      target: {
        kind: 'preview-file',
        path: 'README.md',
        available: true,
        downloadAvailable: true,
        refreshAvailable: true,
        refreshDisabled: false,
      },
    });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PreviewTabContextMenu
          x={20}
          y={30}
          model={model}
          onAction={onAction}
          onClose={jest.fn()}
        />,
      );
    });

    expect(renderer.root.findAll(node => node.props.role === 'separator')).toHaveLength(2);
    const items = renderer.root.findAll(node => node.props.role === 'menuitem');
    expect(items.map(item => item.findAllByType('span')[0].props.children)).toEqual([
      'Download',
      'Share MD/HTML',
      'Export as HTML',
      'Copy relative path',
      'Copy absolute path',
      'Refresh',
    ]);
    act(() => items[0].props.onClick());
    expect(onAction).toHaveBeenCalledWith('download');

    act(() => renderer.unmount());
  });

  test('renders share and export actions for an external Markdown tab', () => {
    const onAction = jest.fn();
    const model = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'browser',
      target: {
        kind: 'preview-external-file',
        path: '/home/user/notes.md',
        available: true,
        downloadAvailable: true,
      },
    });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PreviewTabContextMenu
          x={20}
          y={30}
          model={model}
          onAction={onAction}
          onClose={jest.fn()}
        />,
      );
    });

    const items = renderer.root.findAll(node => node.props.role === 'menuitem');
    expect(items.map(item => item.findAllByType('span')[0].props.children)).toEqual([
      'Download',
      'Share MD/HTML',
      'Export as HTML',
      'Copy absolute path',
    ]);
    act(() => items[1].props.onClick());
    expect(onAction).toHaveBeenCalledWith('share');

    act(() => renderer.unmount());
  });
});
