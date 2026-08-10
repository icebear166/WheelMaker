import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  ChatFileLinkContextMenu,
  type ChatFileLinkContextMenuProps,
} from '../web/src/chat/ChatFileLinkContextMenu';
import {
  buildContextMenuModel,
  type ContextMenuOptions,
} from '../web/src/file/fileMenuModel';

type FileMenuOptions = Extract<ContextMenuOptions, {surface: 'file'}>;

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

function fileModel(
  target: Partial<FileMenuOptions['target']> = {},
  platform: FileMenuOptions['platform'] = 'desktop',
  capabilities: FileMenuOptions['capabilities'] = {
    canOpenInVSCode: true,
    canShowInExplorer: true,
    canCopyFile: true,
  },
) {
  return buildContextMenuModel({
    surface: 'file',
    platform,
    target: {
      kind: 'project-file',
      path: 'src/main.ts',
      available: true,
      downloadAvailable: true,
      ...target,
    },
    capabilities,
  });
}

const internalProps: ChatFileLinkContextMenuProps = {
  x: 24,
  y: 36,
  model: fileModel(),
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
      'Preview',
      'Open in VS Code',
      'Show in Explorer',
      'Download',
      'Copy file',
      'Copy relative path',
      'Copy absolute path',
    ]);
    expect(icons(renderer)).toEqual([
      'eye',
      'code',
      'folderOpen',
      'arrowDown',
      'copy',
      'fileSymlink',
      'clipboard',
    ]);
    expect(separatorCount(renderer)).toBe(2);

    act(() => renderer.unmount());
  });

  test('uses the unified labels for a project Markdown file', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          model={fileModel({path: 'README.md'})}
        />,
      );
    });

    expect(labels(renderer)).toEqual([
      'Preview',
      'Open in VS Code',
      'Show in Explorer',
      'Download',
      'Copy file',
      'Share MD/HTML',
      'Export as HTML',
      'Copy relative path',
      'Copy absolute path',
    ]);
    expect(icons(renderer)[5]).toBe('share');
    expect(separatorCount(renderer)).toBe(2);

    act(() => renderer.unmount());
  });

  test('uses browser actions without native file capabilities', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          model={fileModel({path: 'README.md'}, 'browser', {
            canOpenInVSCode: false,
            canShowInExplorer: false,
            canCopyFile: false,
          })}
        />,
      );
    });

    expect(labels(renderer)).toEqual([
      'Preview',
      'Download',
      'Share MD/HTML',
      'Export as HTML',
      'Copy relative path',
      'Copy absolute path',
    ]);
    expect(icons(renderer)).toEqual(['eye', 'arrowDown', 'share', 'fileCode', 'fileSymlink', 'clipboard']);
    expect(separatorCount(renderer)).toBe(2);
    act(() => renderer.unmount());
  });

  test('shows preview and absolute path only for an external browser file', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          model={fileModel({
            kind: 'external-file',
            path: 'D:/outside/report.txt',
          }, 'browser', {
            canOpenInVSCode: false,
            canShowInExplorer: false,
            canCopyFile: false,
          })}
        />,
      );
    });

    expect(labels(renderer)).toEqual(['Preview', 'Download', 'Copy absolute path']);
    expect(separatorCount(renderer)).toBe(2);
    act(() => renderer.unmount());
  });

  test('emits every visible action for a fully capable Markdown menu', () => {
    const onAction = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          model={fileModel({path: 'README.md'})}
          onAction={onAction}
        />,
      );
    });

    for (const button of renderer.root.findAll(node => node.props.role === 'menuitem')) {
      act(() => button.props.onClick());
    }
    expect(onAction.mock.calls.map(call => call[0])).toEqual([
      'preview',
      'vscode',
      'folder',
      'download',
      'copy-file',
      'share',
      'export-html',
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
          model={fileModel({
            kind: 'attachment',
            path: undefined,
          }, 'browser', {
            canOpenInVSCode: false,
            canShowInExplorer: false,
            canCopyFile: false,
          })}
        />,
      );
    });

    expect(labels(renderer)).toEqual(['Preview', 'Download']);
    expect(separatorCount(renderer)).toBe(1);
    act(() => renderer.unmount());
  });

  test('offers public sharing for supported project HTML files', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChatFileLinkContextMenu
          {...internalProps}
          model={fileModel({path: 'docs/page.html'})}
        />,
      );
    });
    expect(labels(renderer)).toContain('Share MD/HTML');
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
