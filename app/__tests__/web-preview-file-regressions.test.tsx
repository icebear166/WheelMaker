import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

import {FileExplorerTree} from '../web/src/file/FileExplorerTree';

type PreviewDirectoryLoaderModule = {
  fetchPreviewDirectoryEntries?: (options: {
    cachedEntries?: Array<{name: string; path: string; kind: 'file' | 'dir'}>;
    knownHash?: string;
    request: (knownHash?: string) => Promise<{
      entries: Array<{name: string; path: string; kind: 'file' | 'dir'}>;
      hash?: string;
      notModified: boolean;
    }>;
  }) => Promise<{
    entries: Array<{name: string; path: string; kind: 'file' | 'dir'}>;
    hash: string;
  }>;
  togglePreviewDirectoryExpansion?: (
    expandedByProject: Record<string, string[]>,
    projectId: string,
    path: string,
  ) => Record<string, string[]>;
};

type PreviewLineNavigationModule = {
  markdownSourceTargetProps?: (
    node: unknown,
    targetLine?: number | null,
  ) => Record<string, string | undefined>;
  findPreviewLineTarget?: (
    container: {
      querySelector: (selector: string) => unknown;
      querySelectorAll: (selector: string) => unknown[];
    },
    line: number,
    mode: 'code' | 'markdown',
  ) => unknown;
  schedulePreviewLineJump?: (options: {
    getContainer: () => unknown;
    isCurrent: () => boolean;
    line: number;
    content: string;
    mode: 'code' | 'markdown';
    lineHeight: number;
    maxAttempts: number;
    requestFrame: (callback: () => void) => number;
    cancelFrame: (handle: number) => void;
    resolveTarget?: (container: unknown) => unknown;
    onMiss?: (container: unknown, attempt: number) => void;
    approximate?: boolean;
    onFinish?: (exact: boolean) => void;
  }) => () => void;
};

type PreviewFileLinkModule = {
  resolvePreviewFileLink?: (
    href: string,
    projectRoot: string,
  ) => {
    path: string;
    absolutePath: string;
    relativePath: string | null;
    line: number | null;
  } | null;
  isAbsolutePreviewFilePath?: (value: string) => boolean;
};

type MarkdownFileLinksModule = {
  remarkWindowsFileLinks?: () => (
    tree: unknown,
    file: {value: unknown},
  ) => void;
};

type PreviewWorkbenchStateModule = {
  previewSearchDocumentKey?: (tab: unknown) => string;
};

function optionalRequire<T>(path: string): T {
  try {
    return require(path) as T;
  } catch {
    return {} as T;
  }
}

describe('preview file regressions', () => {
  test('does not validate a directory hash unless matching entries exist', async () => {
    const {fetchPreviewDirectoryEntries} = optionalRequire<PreviewDirectoryLoaderModule>(
      '../web/src/preview/previewDirectoryLoader',
    );
    expect(fetchPreviewDirectoryEntries).toBeDefined();

    const requestedHashes: Array<string | undefined> = [];
    const result = await fetchPreviewDirectoryEntries!({
      knownHash: 'stale-memory-hash',
      request: async knownHash => {
        requestedHashes.push(knownHash);
        return {
          entries: [{name: 'src', path: 'src', kind: 'dir'}],
          hash: 'fresh-hash',
          notModified: false,
        };
      },
    });

    expect(requestedHashes).toEqual([undefined]);
    expect(result).toEqual({
      entries: [{name: 'src', path: 'src', kind: 'dir'}],
      hash: 'fresh-hash',
    });
  });

  test('retries an unexpected not-modified directory response without a hash', async () => {
    const {fetchPreviewDirectoryEntries} = optionalRequire<PreviewDirectoryLoaderModule>(
      '../web/src/preview/previewDirectoryLoader',
    );
    expect(fetchPreviewDirectoryEntries).toBeDefined();

    const requestedHashes: Array<string | undefined> = [];
    const result = await fetchPreviewDirectoryEntries!({
      request: async knownHash => {
        requestedHashes.push(knownHash);
        if (requestedHashes.length === 1) {
          return {entries: [], hash: 'server-hash', notModified: true};
        }
        return {
          entries: [{name: 'README.md', path: 'README.md', kind: 'file'}],
          hash: 'server-hash',
          notModified: false,
        };
      },
    });

    expect(requestedHashes).toEqual([undefined, undefined]);
    expect(result.entries).toEqual([
      {name: 'README.md', path: 'README.md', kind: 'file'},
    ]);
  });

  test('keeps preview directory expansion isolated by project', () => {
    const {togglePreviewDirectoryExpansion} = optionalRequire<PreviewDirectoryLoaderModule>(
      '../web/src/preview/previewDirectoryLoader',
    );
    expect(togglePreviewDirectoryExpansion).toBeDefined();

    const initial = {projectA: ['.', 'src'], projectB: ['.']};
    const next = togglePreviewDirectoryExpansion!(initial, 'projectB', 'docs');

    expect(next).toEqual({
      projectA: ['.', 'src'],
      projectB: ['.', 'docs'],
    });
    expect(initial).toEqual({projectA: ['.', 'src'], projectB: ['.']});
  });

  test('renders explicit loading, error, and empty root directory states', async () => {
    const baseProps = {
      isWide: false,
      showSectionTitle: false,
      projects: [],
      projectId: 'project-1',
      currentProjectName: 'Project',
      sortedProjectItems: [],
      workspaceProjectMenuOpen: false,
      setWorkspaceProjectMenuOpen: () => undefined,
      syncWorkspaceProject: async () => undefined,
      dirEntries: {'.': []},
      loadingDirs: {},
      selectedFile: '',
      setSelectedFile: () => undefined,
      setDrawerOpen: () => undefined,
      isExpanded: () => false,
      toggleDirectory: () => undefined,
      resolveFileIcon: () => ({glyph: '', color: ''}),
      onRetryRoot: () => undefined,
    };

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        React.createElement(FileExplorerTree as React.ComponentType<any>, {
          ...baseProps,
          rootState: 'loading',
        }),
      );
    });
    expect(renderer.root.findByProps({role: 'status'}).children.join('')).toContain('Loading');

    await ReactTestRenderer.act(() => {
      renderer.update(
        React.createElement(FileExplorerTree as React.ComponentType<any>, {
          ...baseProps,
          rootState: 'error',
          rootError: 'connection reset',
        }),
      );
    });
    const errorState = renderer.root.findByProps({role: 'alert'});
    expect(errorState.findByType('span').children.join('')).toContain('connection reset');
    expect(renderer.root.findByType('button').children.join('')).toContain('Retry');

    await ReactTestRenderer.act(() => {
      renderer.update(
        React.createElement(FileExplorerTree as React.ComponentType<any>, {
          ...baseProps,
          rootState: 'empty',
        }),
      );
    });
    expect(renderer.root.findByProps({role: 'status'}).children.join('')).toContain('No files');
  });

  test('finds a Markdown block whose source range contains the requested line', () => {
    const {findPreviewLineTarget} = optionalRequire<PreviewLineNavigationModule>(
      '../web/src/preview/previewLineNavigation',
    );
    expect(findPreviewLineTarget).toBeDefined();

    const first = {dataset: {sourceLineStart: '2', sourceLineEnd: '4'}};
    const second = {dataset: {sourceLineStart: '8', sourceLineEnd: '12'}};
    const container = {
      querySelector: () => null,
      querySelectorAll: () => [first, second],
    };

    expect(findPreviewLineTarget!(container, 10, 'markdown')).toBe(second);
  });

  test('prefers the narrowest Markdown source range for nested content', () => {
    const {findPreviewLineTarget} = optionalRequire<PreviewLineNavigationModule>(
      '../web/src/preview/previewLineNavigation',
    );
    expect(findPreviewLineTarget).toBeDefined();

    const listItem = {dataset: {sourceLineStart: '4', sourceLineEnd: '14'}};
    const paragraph = {dataset: {sourceLineStart: '9', sourceLineEnd: '10'}};
    const container = {
      querySelector: () => null,
      querySelectorAll: () => [listItem, paragraph],
    };

    expect(findPreviewLineTarget!(container, 10, 'markdown')).toBe(paragraph);
  });

  test('roughly scrolls a virtualized file before correcting to its rendered line', () => {
    const {schedulePreviewLineJump} = optionalRequire<PreviewLineNavigationModule>(
      '../web/src/preview/previewLineNavigation',
    );
    expect(schedulePreviewLineJump).toBeDefined();

    const frames: Array<() => void> = [];
    let targetAvailable = false;
    const target = {
      getBoundingClientRect: () => ({top: 20, height: 10}),
    };
    const container = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 100,
      getBoundingClientRect: () => ({top: 0}),
      querySelector: () => (targetAvailable ? target : null),
      querySelectorAll: () => [],
    };
    const content = Array.from({length: 200}, (_, index) => `line ${index + 1}`).join('\n');

    schedulePreviewLineJump!({
      getContainer: () => container,
      isCurrent: () => true,
      line: 120,
      content,
      mode: 'code',
      lineHeight: 10,
      maxAttempts: 4,
      requestFrame: callback => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: () => undefined,
    });

    frames.shift()!();
    const approximateScrollTop = container.scrollTop;
    expect(approximateScrollTop).toBeGreaterThan(0);

    targetAvailable = true;
    frames.shift()!();
    expect(container.scrollTop).not.toBe(approximateScrollTop);
  });

  test('lets diff search scope an exact jump to the matching file', () => {
    const {schedulePreviewLineJump} = optionalRequire<PreviewLineNavigationModule>(
      '../web/src/preview/previewLineNavigation',
    );
    expect(schedulePreviewLineJump).toBeDefined();

    const frames: Array<() => void> = [];
    const globalLine = {getBoundingClientRect: () => ({top: 20, height: 10})};
    const scopedLine = {getBoundingClientRect: () => ({top: 80, height: 10})};
    const container = {
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 100,
      getBoundingClientRect: () => ({top: 0}),
      querySelector: () => globalLine,
      querySelectorAll: () => [],
    };
    const finished: boolean[] = [];

    schedulePreviewLineJump!({
      getContainer: () => container,
      isCurrent: () => true,
      line: 7,
      content: 'line',
      mode: 'code',
      lineHeight: 10,
      maxAttempts: 2,
      requestFrame: callback => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: () => undefined,
      resolveTarget: () => scopedLine,
      approximate: false,
      onFinish: exact => finished.push(exact),
    });

    frames.shift()!();
    expect(container.scrollTop).toBe(35);
    expect(finished).toEqual([true]);
  });

  test('lets a scoped diff jump reveal a virtualized target before retrying', () => {
    const {schedulePreviewLineJump} = optionalRequire<PreviewLineNavigationModule>(
      '../web/src/preview/previewLineNavigation',
    );
    expect(schedulePreviewLineJump).toBeDefined();

    const frames: Array<() => void> = [];
    const container = {
      scrollTop: 0,
      scrollHeight: 5000,
      clientHeight: 100,
      getBoundingClientRect: () => ({top: 0}),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const misses: number[] = [];

    schedulePreviewLineJump!({
      getContainer: () => container,
      isCurrent: () => true,
      line: 3000,
      content: '',
      mode: 'code',
      lineHeight: 10,
      maxAttempts: 2,
      requestFrame: callback => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: () => undefined,
      resolveTarget: () => null,
      onMiss: (_current, attempt) => {
        misses.push(attempt);
        container.scrollTop = 3000;
      },
      approximate: false,
    });

    frames.shift()!();
    expect(misses).toEqual([0]);
    expect(container.scrollTop).toBe(3000);
    expect(frames).toHaveLength(1);
  });

  test('resolves internal and external chat file paths', () => {
    const {
      isAbsolutePreviewFilePath,
      resolvePreviewFileLink,
    } = optionalRequire<PreviewFileLinkModule>(
      '../web/src/preview/previewFileLink',
    );
    expect(resolvePreviewFileLink).toBeDefined();
    expect(isAbsolutePreviewFilePath).toBeDefined();

    expect(
      resolvePreviewFileLink!(
        'D:/Code/WheelMaker/src/main.ts:42:7',
        'D:/Code/WheelMaker',
      ),
    ).toEqual({
      path: 'src/main.ts',
      absolutePath: 'D:/Code/WheelMaker/src/main.ts',
      relativePath: 'src/main.ts',
      line: 42,
    });
    expect(
      resolvePreviewFileLink!(
        '../OtherProject/src/worker.ts#L9',
        'D:/Code/WheelMaker',
      ),
    ).toEqual({
      path: 'D:/Code/OtherProject/src/worker.ts',
      absolutePath: 'D:/Code/OtherProject/src/worker.ts',
      relativePath: null,
      line: 9,
    });
    expect(
      resolvePreviewFileLink!('/var/log/system.log', '/srv/wheelmaker'),
    ).toEqual({
      path: '/var/log/system.log',
      absolutePath: '/var/log/system.log',
      relativePath: null,
      line: null,
    });
    expect(
      resolvePreviewFileLink!(
        'file://fileserver/share/report.txt',
        'D:/Code/WheelMaker',
      ),
    ).toEqual({
      path: '//fileserver/share/report.txt',
      absolutePath: '//fileserver/share/report.txt',
      relativePath: null,
      line: null,
    });
    expect(
      resolvePreviewFileLink!(
        'vscode://file/D:/Code/WheelMaker/app/main.ts:12:3',
        'D:/Code/WheelMaker',
      ),
    ).toEqual({
      path: 'app/main.ts',
      absolutePath: 'D:/Code/WheelMaker/app/main.ts',
      relativePath: 'app/main.ts',
      line: 12,
    });
    expect(
      resolvePreviewFileLink!(
        'file:///D:/Code/WheelMaker/app/main.ts',
        'D:/Code/WheelMaker',
      ),
    ).toEqual({
      path: 'app/main.ts',
      absolutePath: 'D:/Code/WheelMaker/app/main.ts',
      relativePath: 'app/main.ts',
      line: null,
    });
    expect(resolvePreviewFileLink!('https://example.com/file.ts', '')).toBeNull();
    expect(
      resolvePreviewFileLink!('D:/Code/WheelMaker', 'D:/Code/WheelMaker'),
    ).toBeNull();
    expect(resolvePreviewFileLink!('D:/top.txt', 'D:/')).toEqual({
      path: 'top.txt',
      absolutePath: 'D:/top.txt',
      relativePath: 'top.txt',
      line: null,
    });
    expect(resolvePreviewFileLink!('/etc/hosts', '/')).toEqual({
      path: 'etc/hosts',
      absolutePath: '/etc/hosts',
      relativePath: 'etc/hosts',
      line: null,
    });

    expect(isAbsolutePreviewFilePath!('D:/Code/WheelMaker/app/main.ts')).toBe(true);
    expect(isAbsolutePreviewFilePath!('\\\\fileserver\\share\\report.txt')).toBe(true);
    expect(isAbsolutePreviewFilePath!('/var/log/system.log')).toBe(true);
    expect(isAbsolutePreviewFilePath!('../OtherProject/src/worker.ts')).toBe(false);
  });

  test('preserves a hidden directory segment in a Windows Markdown file link', () => {
    const {remarkWindowsFileLinks} = optionalRequire<MarkdownFileLinksModule>(
      '../web/src/code/markdownFileLinks',
    );
    expect(remarkWindowsFileLinks).toBeDefined();

    const source = String.raw`[spec](D:\Code\WheelMaker\.worktree\feat\topbar-menu-unification\spec.md)`;
    const link = {
      type: 'link',
      url: String.raw`D:\Code\WheelMaker.worktree\feat\topbar-menu-unification\spec.md`,
      position: {
        start: {offset: 0},
        end: {offset: source.length},
      },
      children: [{type: 'text', value: 'spec'}],
    };
    const tree = {
      type: 'root',
      children: [{type: 'paragraph', children: [link]}],
    };

    remarkWindowsFileLinks!()(tree, {value: source});

    expect(link.url).toBe(
      'D:/Code/WheelMaker/.worktree/feat/topbar-menu-unification/spec.md',
    );
  });

  test('keeps Markdown source ranges available when search changes the target line', () => {
    const {markdownSourceTargetProps} = optionalRequire<PreviewLineNavigationModule>(
      '../web/src/preview/previewLineNavigation',
    );
    expect(markdownSourceTargetProps).toBeDefined();

    expect(markdownSourceTargetProps!(
      {position: {start: {line: 8}, end: {line: 12}}},
      null,
    )).toEqual({
      'data-source-line-start': '8',
      'data-source-line-end': '12',
      'data-source-line-target': undefined,
    });
  });

  test('marks fenced Markdown code blocks with their source line range', () => {
    const appRoot = path.join(__dirname, '..');
    const markdownPreview = fs.readFileSync(
      path.join(appRoot, 'web', 'src', 'code', 'markdownPreview.tsx'),
      'utf8',
    );

    expect(markdownPreview).toContain('className="markdown-source-code-block"');
    expect(markdownPreview).toContain('{...markdownSourceTargetProps(node, targetLine)}');
  });

  test('wires resilient directory and line navigation into the preview workbench', () => {
    const appRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(
      path.join(appRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(main).toContain("from '../preview/previewDirectoryLoader';");
    expect(main).toContain('fetchPreviewDirectoryEntries({');
    expect(main).toContain('togglePreviewDirectoryExpansion(');
    expect(main).toContain('if (!previewWorkbench.treeOpen) return;');
    expect(main).toContain('rootState={chatFilePreviewRootState}');
    expect(main).toContain('onRetryRoot={retryPreviewRootDirectory}');
    expect(main).toContain("from '../preview/previewLineNavigation';");
    expect(main).toContain('schedulePreviewLineJump({');
    expect(main).toContain("mode: isMarkdownPath(targetPath) ? 'markdown' : 'code'");
    expect(main).not.toContain('const maxAttempts = 16;');
  });

  test('normalizes chat links with the selected chat project path', () => {
    const appRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(
      path.join(appRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(main).toContain("from '../preview/previewFileLink';");
    expect(main).toContain('const linkProjectId = resolveChatFilePreviewProjectId();');
    expect(main).toContain('const linkProjectRoot = projects.find(');
    expect(main).toContain('resolveChatFileLink(linkHref, linkProjectRoot)');
    expect(main).toContain('openChatFilePeek(targetFile.path, jumpLine ?? null, linkProjectId);');
  });

  test('keeps HTML previews out of source-line search navigation', () => {
    const appRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(
      path.join(appRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const markdownPreview = fs.readFileSync(
      path.join(appRoot, 'web', 'src', 'code', 'markdownPreview.tsx'),
      'utf8',
    );

    const searchStart = main.indexOf('const scrollToPreviewSearchMatch =');
    const searchEnd = main.indexOf('useEffect(() => {', searchStart);
    const searchBody = main.slice(searchStart, searchEnd);
    expect(searchBody).not.toContain('if (isHtmlPreviewPath(tab.path)) {');
    expect(searchBody).not.toContain(
      "item.type === 'file' ? {...item, targetLine: match.line} : item",
    );
    expect(main).toContain("'Search is not available for this preview.'");
    expect(markdownPreview).not.toContain('srcDoc');
    expect(markdownPreview).not.toContain('scrollHtmlPreviewFrameToLine');
  });

  test('keeps the preview search document stable across navigation-only tab changes', () => {
    const {previewSearchDocumentKey} = optionalRequire<PreviewWorkbenchStateModule>(
      '../web/src/preview/previewWorkbenchState',
    );
    expect(previewSearchDocumentKey).toBeDefined();

    const baseTab = {
      id: 'prompt-diff:session:artifact',
      type: 'prompt-diff',
      projectId: 'project-1',
      title: 'Diff',
      loading: false,
      error: '',
      requestId: 1,
      sessionId: 'session',
      artifactId: 'artifact',
      promptText: '',
      promptSummary: '',
      files: [{
        path: 'src/app.ts',
        status: 'M',
        additions: 1,
        deletions: 0,
        diff: '+const ready = true;',
        expanded: false,
      }],
    };
    const expandedTab = {
      ...baseTab,
      files: baseTab.files.map(file => ({...file, expanded: true})),
    };

    expect(previewSearchDocumentKey!(baseTab)).toBe(
      previewSearchDocumentKey!(expandedTab),
    );
  });

  test('does not reset preview search navigation for target-only tab updates', () => {
    const appRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(
      path.join(appRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(main).toContain('const previewSearchDocument = previewSearchDocumentKey(activeWorkbenchTab);');
    expect(main).toContain('previewSearchDocument,');
    expect(main).toContain('activeWorkbenchTab?.id,');
  });
});
