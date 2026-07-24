import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  ChatFileLinkContextMenu,
  type ChatFileLinkContextMenuProps,
} from '../web/src/chat/ChatFileLinkContextMenu';

function labels(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(node => node.props.role === 'menuitem')
    .map(button => button.findAllByType('span')[1].props.children as string);
}

const internalProps: ChatFileLinkContextMenuProps = {
  x: 24,
  y: 36,
  link: {
    path: 'src/main.ts',
    absolutePath: 'D:/repo/src/main.ts',
    relativePath: 'src/main.ts',
    line: 4,
  },
  canOpenInVSCode: true,
  canShowInFolder: true,
  canExportHtml: false,
  onAction: jest.fn(),
  onClose: jest.fn(),
};

describe('chat file link context menu', () => {
  test('shows Desktop and copy actions for an internal file in order', () => {
    const onAction = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu {...internalProps} onAction={onAction} />,
      );
    });

    expect(labels(renderer)).toEqual([
      'Open with VS Code',
      'Show in File Explorer',
      'Copy relative path',
      'Copy absolute path',
    ]);
    for (const button of renderer.root.findAll(node => node.props.role === 'menuitem')) {
      act(() => button.props.onClick());
    }
    expect(onAction.mock.calls.map(call => call[0])).toEqual([
      'vscode',
      'folder',
      'copy-relative',
      'copy-absolute',
    ]);

    act(() => renderer.unmount());
  });

  test('shows only the absolute copy action for an external file in a browser', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          link={{
            path: 'D:/outside/report.txt',
            absolutePath: 'D:/outside/report.txt',
            relativePath: null,
            line: null,
          }}
          canOpenInVSCode={false}
          canShowInFolder={false}
        />,
      );
    });

    expect(labels(renderer)).toEqual(['Copy absolute path']);
    act(() => renderer.unmount());
  });

  test('shows HTML export only when the caller marks a Markdown project link exportable', () => {
    const onAction = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          canExportHtml
          onAction={onAction}
        />,
      );
    });

    expect(labels(renderer)).toContain('Export as HTML');
    const button = renderer.root.findAll(node => node.props.role === 'menuitem')
      .find(item => item.findAllByType('span')[1].props.children === 'Export as HTML');
    act(() => button?.props.onClick());
    expect(onAction).toHaveBeenCalledWith('export-html');

    act(() => renderer.unmount());
  });

  test('dismisses outside, on Escape, scroll, and resize but not inside', () => {
    const listeners = new Map<string, EventListener>();
    const addListener = jest.spyOn(window, 'addEventListener').mockImplementation(
      ((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.set(type, listener as EventListener);
      }) as typeof window.addEventListener,
    );
    const removeListener = jest.spyOn(window, 'removeEventListener').mockImplementation(
      ((type: string, listener: EventListenerOrEventListenerObject) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      }) as typeof window.removeEventListener,
    );
    const onClose = jest.fn();
    const insideTarget = {};
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu {...internalProps} onClose={onClose} />,
        {
          createNodeMock: element => element.props.role === 'menu'
            ? {contains: (target: unknown) => target === insideTarget}
            : {},
        },
      );
    });

    expect([...listeners.keys()].sort()).toEqual([
      'keydown',
      'pointerdown',
      'resize',
      'scroll',
    ]);
    act(() => listeners.get('pointerdown')?.({target: insideTarget} as unknown as Event));
    expect(onClose).not.toHaveBeenCalled();
    act(() => listeners.get('pointerdown')?.({target: {}} as unknown as Event));
    act(() => listeners.get('keydown')?.({key: 'Escape'} as unknown as Event));
    act(() => listeners.get('scroll')?.(new Event('scroll')));
    act(() => listeners.get('resize')?.(new Event('resize')));
    expect(onClose).toHaveBeenCalledTimes(4);

    act(() => renderer.unmount());
    expect(listeners.size).toBe(0);
    addListener.mockRestore();
    removeListener.mockRestore();
  });
});
