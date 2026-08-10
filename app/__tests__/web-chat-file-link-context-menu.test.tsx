import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  ChatFileLinkContextMenu,
  type ChatFileLinkContextMenuProps,
} from '../web/src/chat/ChatFileLinkContextMenu';

function labels(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(node => node.props.role === 'menuitem')
    .map(button => button.findAllByType('span')[0].props.children as string);
}

function icons(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(node => node.props.role === 'menuitem')
    .map(button => button.findByType('svg').props['data-icon-name'] as string);
}

function separatorCount(renderer: TestRenderer.ReactTestRenderer): number {
  return renderer.root.findAll(node => node.props.role === 'separator').length;
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
  canCopyFile: true,
  canDownload: true,
  htmlActionLabel: null,
  onAction: jest.fn(),
  onClose: jest.fn(),
};

describe('chat file link context menu', () => {
  test('shows Desktop and copy actions for an internal file in order', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu {...internalProps} />,
      );
    });

    expect(labels(renderer)).toEqual([
      'Preview file',
      'Download',
      'Open with VS Code',
      'Show in File Explorer',
      'Copy file',
      'Copy relative path',
      'Copy absolute path',
    ]);
    expect(icons(renderer)).toEqual([
      'eye',
      'arrowDown',
      'code',
      'folderOpen',
      'copy',
      'fileSymlink',
      'clipboard',
    ]);
    expect(separatorCount(renderer)).toBe(2);

    act(() => renderer.unmount());
  });

  test('uses the Desktop HTML label and file icon for project Markdown', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          link={{...internalProps.link, path: 'README.md', relativePath: 'README.md'}}
          htmlActionLabel="Copy file as HTML"
        />,
      );
    });

    expect(labels(renderer)).toEqual([
      'Preview file',
      'Download',
      'Open with VS Code',
      'Show in File Explorer',
      'Copy file',
      'Copy file as HTML',
      'Copy relative path',
      'Copy absolute path',
    ]);
    expect(icons(renderer)[5]).toBe('fileCode');
    expect(separatorCount(renderer)).toBe(2);

    act(() => renderer.unmount());
  });

  test('uses the browser HTML label without native file actions', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          link={{...internalProps.link, path: 'README.md', relativePath: 'README.md'}}
          canOpenInVSCode={false}
          canShowInFolder={false}
          canCopyFile={false}
          htmlActionLabel="Export as HTML"
        />,
      );
    });

    expect(labels(renderer)).toEqual([
      'Preview file',
      'Download',
      'Export as HTML',
      'Copy relative path',
      'Copy absolute path',
    ]);
    expect(icons(renderer)).toEqual(['eye', 'arrowDown', 'fileCode', 'fileSymlink', 'clipboard']);
    expect(separatorCount(renderer)).toBe(2);
    act(() => renderer.unmount());
  });

  test('shows preview and absolute path only for an external browser file', () => {
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
          canCopyFile={false}
        />,
      );
    });

    expect(labels(renderer)).toEqual(['Preview file', 'Download', 'Copy absolute path']);
    expect(separatorCount(renderer)).toBe(1);
    act(() => renderer.unmount());
  });

  test('emits every visible action for a fully capable Markdown menu', () => {
    const onAction = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          link={{...internalProps.link, path: 'README.md', relativePath: 'README.md'}}
          htmlActionLabel="Copy file as HTML"
          canShare
          onAction={onAction}
        />,
      );
    });

    for (const button of renderer.root.findAll(node => node.props.role === 'menuitem')) {
      act(() => button.props.onClick());
    }
    expect(onAction.mock.calls.map(call => call[0])).toEqual([
      'preview',
      'download',
      'vscode',
      'folder',
      'copy-file',
      'export-html',
      'share',
      'copy-relative',
      'copy-absolute',
    ]);

    act(() => renderer.unmount());
  });

  test('shows only preview and download for a persisted attachment', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          link={null}
          canOpenInVSCode={false}
          canShowInFolder={false}
          canCopyFile={false}
          htmlActionLabel={null}
        />,
      );
    });

    expect(labels(renderer)).toEqual(['Preview file', 'Download']);
    expect(separatorCount(renderer)).toBe(0);
    act(() => renderer.unmount());
  });

  test('offers public sharing for supported project HTML files', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          link={{...internalProps.link, path: 'docs/page.html', relativePath: 'docs/page.html'}}
          canShare
        />,
      );
    });
    expect(labels(renderer)).toContain('Create public share');
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
