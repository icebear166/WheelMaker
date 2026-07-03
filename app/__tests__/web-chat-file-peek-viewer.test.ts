import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

describe('web chat file peek viewer', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainPath = path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx');
  const shellPath = path.join(projectRoot, 'web', 'src', 'shell', 'ResponsiveShell.tsx');

  test('chat file links open the peek viewer without switching to the File tab', () => {
    const mainTsx = readSourceText(mainPath);
    const clickStart = mainTsx.indexOf('openChatFilePeek(targetFile.path, jumpLine ?? null, resolveChatFilePreviewProjectId())');
    expect(clickStart).toBeGreaterThanOrEqual(0);
    const clickEnd = mainTsx.indexOf('</a>', clickStart);
    const clickBody = mainTsx.slice(clickStart, clickEnd);

    expect(clickBody).not.toContain("setTab('file')");
    expect(clickBody).not.toContain('setSelectedFile(targetFile.path)');
    expect(mainTsx).toContain('const openChatFilePeek = useCallback(');
    expect(mainTsx).toContain('beginPreviewTabLoad(');
  });

  test('file mention preview reuses chat peek without inserting or closing the menu', () => {
    const mainTsx = readSourceText(mainPath);
    const previewStart = mainTsx.indexOf('const openChatFileMentionPreview = useCallback(');
    expect(previewStart).toBeGreaterThanOrEqual(0);
    const previewEnd = mainTsx.indexOf('const closeChatFilePeekFromChrome = useCallback', previewStart);
    expect(previewEnd).toBeGreaterThan(previewStart);
    const previewBody = mainTsx.slice(previewStart, previewEnd);

    expect(previewBody).toContain('openChatFilePeek(path, null, resolveChatFilePreviewProjectId())');
    expect(previewBody).not.toContain('applyChatFileMentionResult');
    expect(previewBody).not.toContain('setChatFileMentionMenuOpen(false)');
    expect(previewBody).toContain('chatRichComposerRef.current?.focus();');
  });

  test('prompt diff artifacts open unified prompt-diff tabs without switching to Git', () => {
    const mainTsx = readSourceText(mainPath);
    const openStart = mainTsx.indexOf('const openPromptArtifactDiff = useCallback(');
    expect(openStart).toBeGreaterThanOrEqual(0);
    const openEnd = mainTsx.indexOf('const selectedChatHasOpenPromptTurn', openStart);
    const openBody = mainTsx.slice(openStart, openEnd);

    expect(openBody).toContain("type: 'prompt-diff'");
    expect(openBody).toContain('artifactId');
    expect(openBody).toContain('updatePreviewTabAfterLoad(');
    expect(openBody).not.toContain("setTab('git')");
    expect(openBody).not.toContain('setPromptArtifactDiff({');
    expect(openBody).not.toContain('setChatPromptArtifactPreview({');
    expect(mainTsx).toContain('isPromptDiffPreviewTab(activeWorkbenchTab)');
    expect(mainTsx).toContain('<ChatPromptArtifactPreviewViewer');
    expect(mainTsx).toContain('togglePromptArtifactPreviewFile');
  });

  test('prompt attachments open unified attachment tabs', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);
    const openStart = mainTsx.indexOf('const openChatAttachmentPreview = useCallback');
    const openEnd = mainTsx.indexOf('const buildLineRange', openStart);
    const openBody = mainTsx.slice(openStart, openEnd);

    expect(openBody).toContain("type: 'attachment'");
    expect(openBody).toContain('attachmentKey');
    expect(openBody).toContain('chatAttachmentBlockCacheKey(');
    expect(openBody).toContain('updatePreviewTabAfterLoad(');
    expect(openBody).toContain('service.readProjectSessionAttachment(');
    expect(mainTsx).not.toContain('const [chatAttachmentPreview, setChatAttachmentPreview]');
    expect(mainTsx).not.toContain('const [chatPromptArtifactPreview, setChatPromptArtifactPreview]');
    expect(mainTsx).toContain('<ChatAttachmentPreviewViewer');
    expect(mainTsx).toContain('Preview is being implemented.');
    expect(stylesCss).toContain('.chat-attachment-preview-surface');
    expect(stylesCss).toContain('.chat-attachment-original-image');
  });

  test('chat preview can open without active content and keeps chrome close controls', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const [chatPreviewManualOpen, setChatPreviewManualOpen] = useState(false);');
    expect(mainTsx).toContain('const [chatPreviewManualCollapsed, setChatPreviewManualCollapsed] = useState(false);');
    expect(mainTsx).toContain('const chatPreviewHasContent =');
    expect(mainTsx).toContain('const chatPreviewHasContent = previewWorkbenchHasTabs;');
    expect(mainTsx).toContain('const chatPreviewOpen = chatPreviewManualOpen || (chatPreviewHasContent && !chatPreviewManualCollapsed);');
    expect(mainTsx).toContain('const renderPreviewWorkbenchBody = (mode:');
    expect(mainTsx).toContain('No preview selected');
    expect(mainTsx).toContain('<PreviewWorkbenchChrome');
    expect(mainTsx).toContain('title={mode === \'mobile\' ? \'Back\' : \'Close preview\'}');

    expect(stylesCss).toContain('.chat-empty-preview-body {');
    expect(stylesCss).toContain('.chat-empty-preview-copy {');
  });

  test('mobile native back closes manually opened empty chat preview', () => {
    const mainTsx = readSourceText(mainPath);
    const backStart = mainTsx.indexOf('const handleAndroidNativeBack = useCallback(() => {');
    expect(backStart).toBeGreaterThanOrEqual(0);
    const backEnd = mainTsx.indexOf('useEffect(() => {\n    window.WheelMakerAndroidBack = {', backStart);
    expect(backEnd).toBeGreaterThan(backStart);
    const backBody = mainTsx.slice(backStart, backEnd);

    expect(backBody).toContain('if (!isWide && chatPreviewOpen) {');
    expect(backBody).toContain('closeChatPreview();');
    expect(backBody).toContain('return true;');
    expect(backBody).not.toContain('chatFilePeekRef.current || chatAttachmentPreviewRef.current || chatPromptArtifactPreviewRef.current || chatPortRelayPreviewOpen');
  });

  test('chat preview code and diff panes force line numbers and no wrapping', () => {
    const mainTsx = readSourceText(mainPath);

    const fileViewerStart = mainTsx.indexOf('const ChatFilePeekViewer = React.memo(function ChatFilePeekViewer');
    const fileViewerEnd = mainTsx.indexOf('}, (prev, next) => {', fileViewerStart);
    expect(fileViewerStart).toBeGreaterThanOrEqual(0);
    expect(fileViewerEnd).toBeGreaterThan(fileViewerStart);
    const fileViewerBody = mainTsx.slice(fileViewerStart, fileViewerEnd);
    const fileCodeStart = fileViewerBody.indexOf('<ShikiCodeBlock');
    const fileCodeEnd = fileViewerBody.indexOf('/>', fileCodeStart);
    const fileCodeBlock = fileViewerBody.slice(fileCodeStart, fileCodeEnd);
    expect(fileCodeBlock).toContain('wrap={false}');
    expect(fileCodeBlock).toContain('lineNumbers={true}');

    const artifactViewerStart = mainTsx.indexOf('const ChatPromptArtifactPreviewViewer = React.memo(function ChatPromptArtifactPreviewViewer');
    const artifactViewerEnd = mainTsx.indexOf('}, (prev, next) => (', artifactViewerStart);
    expect(artifactViewerStart).toBeGreaterThanOrEqual(0);
    expect(artifactViewerEnd).toBeGreaterThan(artifactViewerStart);
    const artifactViewerBody = mainTsx.slice(artifactViewerStart, artifactViewerEnd);
    const diffPaneStart = artifactViewerBody.indexOf('<ShikiDiffPane');
    const diffPaneEnd = artifactViewerBody.indexOf('/>', diffPaneStart);
    const diffPaneBlock = artifactViewerBody.slice(diffPaneStart, diffPaneEnd);
    expect(diffPaneBlock).toContain('wrap={false}');
    expect(diffPaneBlock).toContain('lineNumbers={true}');
  });

  test('prompt diff preview CSS supports collapsible file rows', () => {
    const stylesCss = readWebStyles(projectRoot);
    const preview = cssRuleBlock(stylesCss, '.chat-prompt-diff-preview');
    const scroll = cssRuleBlock(stylesCss, '.chat-prompt-diff-surface .chat-file-peek-scroll');
    const overview = cssRuleBlock(stylesCss, '.chat-prompt-diff-overview');

    expect(stylesCss).toContain('.chat-prompt-diff-preview {');
    expect(preview).toContain('padding: 8px 0;');
    expect(scroll).toContain('scrollbar-gutter: auto;');
    expect(overview).toContain('padding: 0 8px;');
    expect(stylesCss).toContain('.chat-prompt-diff-file-header {');
    expect(stylesCss).toContain('.chat-prompt-diff-file-body {');
    expect(stylesCss).toContain('.chat-prompt-diff-file-counts .additions');
    expect(stylesCss).toContain('.chat-prompt-diff-file-counts .deletions');
  });

  test('desktop shell renders an optional third chat preview column', () => {
    const shellTsx = readSourceText(shellPath);
    const mainTsx = readSourceText(mainPath);

    expect(shellTsx).toContain('desktopPeek: ReactNode;');
    expect(shellTsx).toContain('{desktopPeek}');
    expect(mainTsx).toContain('desktopPeek={chatPreviewDesktopPane}');
    expect(mainTsx).toContain('mobileOverlay={chatPreviewMobileOverlay}');
  });

  test('right preview workbench uses project-scoped directory listing without switching workspace project', () => {
    const serviceTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'));
    const mainTsx = readSourceText(mainPath);

    expect(serviceTs).toContain('async listProjectDirectory(');
    expect(serviceTs).toContain("this.readRepositoryForProject(projectId).listFiles(projectId, path || '.', knownHash)");
    expect(mainTsx).toContain('const result = await service.listProjectDirectory(');
    expect(mainTsx).toContain('targetProjectId,');
    expect(mainTsx).not.toContain('syncWorkspaceProject(previewWorkbench.activeProjectId');
  });

  test('chat file preview keeps project-partitioned tabs and does not clear them for non-file previews', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const [previewWorkbench, setPreviewWorkbench] = useState');
    expect(mainTsx).toContain('openPreviewTab(current, {');
    expect(mainTsx).toContain("type: 'file'");
    expect(mainTsx).toContain('updatePreviewTabAfterLoad(');
    expect(mainTsx).toContain('const activeWorkbenchTab = activePreviewTab(previewWorkbench);');
    expect(mainTsx).toContain('const chatFilePeek = isFilePreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;');
    expect(mainTsx).toContain('const previewWorkbenchHasTabs = Object.values(previewWorkbench.tabsByProjectId)');
    expect(mainTsx).not.toContain('filePreviewWorkbenchState');

    const attachmentStart = mainTsx.indexOf('const openChatAttachmentPreview = useCallback');
    const attachmentEnd = mainTsx.indexOf('const buildLineRange', attachmentStart);
    const attachmentBody = mainTsx.slice(attachmentStart, attachmentEnd);
    expect(attachmentBody).not.toContain('setChatFilePeek(null)');
  });

  test('chat file links and mention previews open files in the selected chat project', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const resolveChatFilePreviewProjectId = useCallback(');
    expect(mainTsx).toContain('openChatFilePeek(targetFile.path, jumpLine ?? null, resolveChatFilePreviewProjectId())');
    expect(mainTsx).toContain('openChatFilePeek(path, null, resolveChatFilePreviewProjectId())');
  });

  test('chat file workbench renders unified tab strip, tab close controls, and a desktop tree panel', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('<PreviewWorkbenchChrome');
    expect(mainTsx).not.toContain('projectMenuOpen={previewProjectMenuOpen}');
    expect(mainTsx).not.toContain('onProjectSelect={selectPreviewProjectFromMenu}');
    expect(mainTsx).toContain('onTabClose={closeWorkbenchTab}');
    expect(mainTsx).toContain('onFileTreeToggle={toggleChatFilePreviewTree}');
    expect(mainTsx).toContain('closePreviewTab(');

    expect(stylesCss).toContain('.chat-file-workbench-tabs');
    expect(stylesCss).not.toContain('.preview-workbench-project-pill');
    expect(stylesCss).toContain('.preview-workbench-tree-panel');
    expect(stylesCss).toContain('.chat-file-workbench-empty');
  });

  test('chat file preview keeps memoized empty props stable across chat typing rerenders', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const EMPTY_PREVIEW_WORKBENCH_TABS: FilePreviewTab[] = [];');
    expect(mainTsx).toContain('tabs={EMPTY_PREVIEW_WORKBENCH_TABS}');
    expect(mainTsx).not.toContain('tabs={[]}');
  });

  test('hidden preview file tabs do not receive active line highlights', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const EMPTY_HIGHLIGHTED_LINES = new Set<number>();');
    expect(mainTsx).toContain('const active = tab.id === activeTab.id;');
    expect(mainTsx).toContain('highlightedLines={active ? chatPeekSelectedLines : EMPTY_HIGHLIGHTED_LINES}');
    expect(mainTsx).toContain('onLineClick={active ? handlePeekLineClick : undefined}');
  });

  test('chat file workbench project is bound to the selected chat session', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const chatPreviewProjectId = selectedChatKey?.projectId || projectId || projectIdRef.current;');
    expect(mainTsx).toContain('selectPreviewProject(current, chatPreviewProjectId)');
    expect(mainTsx).not.toContain('const [previewProjectMenuOpen, setPreviewProjectMenuOpen]');
    expect(mainTsx).not.toContain('const selectPreviewProjectFromMenu =');
    expect(mainTsx).not.toContain('ensurePreviewProjectVisible(');
  });

  test('preview workbench chrome renders active title and typed tabs without a project selector', () => {
    const mainTsx = readSourceText(mainPath);
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('<PreviewWorkbenchChrome');
    expect(chromeTsx).not.toContain('preview-workbench-project-pill');
    expect(chromeTsx).not.toContain('preview-workbench-project-menu');
    expect(chromeTsx).not.toContain('projectMenuOpen');
    expect(chromeTsx).not.toContain('onProjectSelect');
    expect(chromeTsx).toContain('previewWorkbenchHeaderTitle(activeTab)');
    expect(chromeTsx).toContain('className="preview-workbench-title"');
    expect(chromeTsx).toContain('className="preview-workbench-actions"');
    expect(chromeTsx).toContain('previewWorkbenchTabIcon(');
    expect(chromeTsx).toContain('preview-workbench-tab-icon');
    expect(chromeTsx).not.toContain('<select');
    expect(stylesCss).not.toContain('.preview-workbench-project-pill');
    expect(stylesCss).not.toContain('.preview-workbench-project-menu');
    expect(stylesCss).toContain('.preview-workbench-tab-icon');
  });

  test('preview workbench toolbar gives the title the remaining row width', () => {
    const stylesCss = readWebStyles(projectRoot);

    const toolbar = cssRuleBlock(stylesCss, '.preview-workbench-toolbar');
    expect(toolbar).toContain('display: grid;');
    expect(toolbar).toContain('grid-template-columns: 24px minmax(80px, 1fr) auto;');

    const title = cssRuleBlock(stylesCss, '.preview-workbench-title');
    expect(title).toContain('min-width: 0;');
    expect(title).toContain('overflow: hidden;');
    expect(title).toContain('text-overflow: ellipsis;');

    const mobileToolbar = cssRuleBlock(stylesCss, '.preview-workbench-surface.mobile .preview-workbench-toolbar');
    expect(mobileToolbar).toContain('grid-template-columns: 24px minmax(72px, 1fr) auto;');
  });

  test('file tree toggle is a floating body button on desktop and mobile', () => {
    const mainTsx = readSourceText(mainPath);
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(chromeTsx).toContain('preview-workbench-tree-fab');
    expect(chromeTsx).toContain('fileTree ? (');
    expect(chromeTsx).toContain('fileTreeOpen && fileTree ? (');
    expect(mainTsx).toContain("fileTree={previewWorkbenchFileTreeContent}");
    expect(chromeTsx).not.toContain('chat-file-workbench-tree-toggle');
    expect(stylesCss).toContain('.preview-workbench-body-tools');
    expect(stylesCss).toContain('.preview-workbench-tree-panel');
    expect(stylesCss).toContain('.preview-workbench-surface.mobile .preview-workbench-tree-panel');
  });

  test('preview file tree opens with inline search and renders search results as a tree', () => {
    const mainTsx = readSourceText(mainPath);
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(chromeTsx).toContain('fileTreeSearch');
    expect(chromeTsx).toContain('const fileTreeSearchRef = React.useRef<HTMLDivElement | null>(null);');
    expect(chromeTsx).toContain('!containsTarget(fileTreeSearchRef.current, target)');
    expect(chromeTsx).toContain('className="preview-workbench-tree-search-shell"');
    expect(chromeTsx).toContain("mode === 'mobile'");

    expect(mainTsx).toContain('const previewFileTreeSearchInputRef = useRef<HTMLInputElement | null>(null);');
    expect(mainTsx).toContain('const [previewFileTreeSearchQuery, setPreviewFileTreeSearchQuery] = useState(\'\');');
    expect(mainTsx).toContain('const [previewFileTreeSearchCollapsedDirs, setPreviewFileTreeSearchCollapsedDirs] = useState<string[]>([]);');
    expect(mainTsx).toContain('className="preview-workbench-tree-search-input"');
    expect(mainTsx).toContain('className="preview-workbench-tree-tool-button"');
    expect(mainTsx).toContain('onClick={locateActivePreviewFileInTree}');
    expect(mainTsx).toContain('codicon codicon-location');
    expect(mainTsx).toContain('const previewFileTreeDepthIndent = 8;');
    expect(mainTsx).toContain('const paddingLeft = 10 + depth * previewFileTreeDepthIndent;');
    expect(mainTsx).toContain('depthIndent={previewFileTreeDepthIndent}');
    expect(mainTsx).toContain('const locateActivePreviewFileInTree = () => {');
    expect(mainTsx).toContain('const ancestors = previewFileAncestorDirs(targetPath);');
    expect(mainTsx).toContain("document.querySelector('.preview-workbench-tree-panel .preview-workbench-file-tree-content .item.selected')");
    expect(mainTsx).toContain('const previewFileTreeSearchTree = useMemo(');
    expect(mainTsx).toContain('buildFileSearchResultTree(previewFileTreeSearchResults, {');
    expect(mainTsx).toContain('dirEntries: chatFilePreviewDirEntries');
    expect(mainTsx).toContain('const previewFileTreeSearchVisibleResults = useMemo(');
    expect(mainTsx).toContain('flattenFileSearchResultTree(previewFileTreeSearchTree, {');
    expect(mainTsx).toContain('collapsedDirPaths: previewFileTreeSearchCollapsedDirs');
    expect(mainTsx).toContain('const handlePreviewFileTreeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {');
    expect(mainTsx).toContain('isArrowNavigationKey(event.key)');
    expect(mainTsx).toContain('startPreviewFileTreeSearchFromKey(event.key)');
    expect(mainTsx).toContain('(current + 1) % previewFileTreeSearchVisibleResults.length');
    expect(mainTsx).toContain('(current - 1 + previewFileTreeSearchVisibleResults.length) % previewFileTreeSearchVisibleResults.length');
    expect(mainTsx).toContain('const result = previewFileTreeSearchVisibleResults[previewFileTreeSearchActiveIndex];');
    expect(mainTsx).toContain('service.searchFileIndex(targetProjectId, {');
    expect(mainTsx).toContain('renderPreviewFileTreeSearchResults(');
    expect(mainTsx).toContain('const togglePreviewFileTreeSearchDirectory = (path: string) => {');
    expect(mainTsx).toContain('const collapsed = previewFileTreeSearchCollapsedDirs.includes(node.path);');
    expect(mainTsx).toContain('onClick={() => togglePreviewFileTreeSearchDirectory(node.path)}');
    expect(mainTsx).toContain("collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'");
    expect(mainTsx).toContain('{collapsed ? null : renderPreviewFileTreeSearchResults(node.children, depth + 1)}');
    expect(mainTsx).not.toContain('className="path"');

    expect(stylesCss).toContain('.preview-workbench-tree-search-shell');
    expect(stylesCss).toContain('.preview-workbench-tree-search-shell[data-open=\'true\']');
    expect(stylesCss).toContain('.preview-workbench-tree-tool-button');
    expect(stylesCss).toContain('.preview-workbench-file-search-tree');
    expect(stylesCss).toContain('.preview-workbench-file-search-node');
    expect(stylesCss).not.toContain('.preview-workbench-file-search-node .path');
  });

  test('empty preview workbench can open the file tree to select a file', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const previewWorkbenchFileTreeContent = !activeWorkbenchTab || activeWorkbenchTab.type === \'file\' ? chatFilePreviewTreeContent : null;');
    expect(mainTsx).toContain('className="chat-file-workbench-empty-action"');
    expect(mainTsx).toContain('onClick={toggleChatFilePreviewTree}');
    expect(mainTsx).toContain('fileTree={previewWorkbenchFileTreeContent}');
    expect(stylesCss).toContain('.chat-file-workbench-empty-action');
  });

  test('mobile preview workbench can hide and restore its top chrome', () => {
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(chromeTsx).toContain('const [mobileHeaderHidden, setMobileHeaderHidden] = React.useState(false);');
    expect(chromeTsx).toContain("preview-workbench-surface chat-file-peek-surface ${mode}${mobileHeaderHidden ? ' mobile-header-hidden' : ''}");
    expect(chromeTsx).toContain("mode === 'mobile' ? (");
    expect(chromeTsx).toContain('preview-workbench-mobile-header-toggle');
    expect(chromeTsx).toContain("setMobileHeaderHidden(hidden => !hidden)");
    expect(chromeTsx).toContain("mobileHeaderHidden ? 'Show preview header' : 'Hide preview header'");
    expect(chromeTsx).toContain("mobileHeaderHidden ? 'codicon-screen-normal' : 'codicon-screen-full'");

    expect(stylesCss).toContain('.preview-workbench-surface.mobile.mobile-header-hidden .preview-workbench-toolbar');
    expect(stylesCss).toContain('.preview-workbench-mobile-header-toggle');
    const mobileToggle = cssRuleBlock(stylesCss, '.preview-workbench-mobile-header-toggle');
    expect(mobileToggle).toContain('right: max(14px, var(--wm-safe-area-right));');
    expect(mobileToggle).toContain('bottom: max(14px, var(--wm-safe-area-bottom));');
    expect(mobileToggle).toContain('z-index: 11;');
  });

  test('preview workbench closes open file-tree popovers on outside interactions', () => {
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const mainTsx = readSourceText(mainPath);

    expect(chromeTsx).toContain('onFileTreeClose: () => void;');
    expect(chromeTsx).toContain('const surfaceRef = React.useRef<HTMLElement | null>(null);');
    expect(chromeTsx).not.toContain('projectMenuRef');
    expect(chromeTsx).toContain('const fileTreePanelRef = React.useRef<HTMLDivElement | null>(null);');
    expect(chromeTsx).toContain("window.addEventListener('pointerdown', handlePointerDown, true);");
    expect(chromeTsx).toContain("if (event.key === 'Escape') {");
    expect(mainTsx).not.toContain('onProjectMenuClose');
    expect(mainTsx).toContain('onFileTreeClose={() => setPreviewWorkbench(current => ({...current, treeOpen: false}))}');
  });

  test('preview workbench wires tab tooltips, keyboard navigation, search, quick open, and selection copy', () => {
    const mainTsx = readSourceText(mainPath);
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(chromeTsx).toContain('previewWorkbenchTabTooltip(tab)');
    expect(chromeTsx).toContain('onKeyDown={onWorkbenchKeyDown}');

    expect(mainTsx).toContain('const [previewSearchOpen, setPreviewSearchOpen] = useState(false);');
    expect(mainTsx).toContain('const previewSearchMatches = useMemo(');
    expect(mainTsx).toContain('buildPreviewSearchMatches(activeWorkbenchTab, previewSearchQuery)');
    expect(mainTsx).toContain('const handlePreviewWorkbenchKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {');
    expect(mainTsx).toContain("event.key === 'Tab' && (event.ctrlKey || event.metaKey)");
    expect(mainTsx).toContain('cyclePreviewTabId(previewWorkbenchTabs, activeWorkbenchTab?.id ?? \'\', event.shiftKey ? -1 : 1)');
    expect(mainTsx).toContain("event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)");
    expect(mainTsx).toContain('className="preview-workbench-search-bar"');
    expect(mainTsx).toContain('previewSearchUnavailableMessage');

    expect(mainTsx).toContain('const [quickFileOpen, setQuickFileOpen] = useState(false);');
    expect(mainTsx).toContain('const openQuickFileSearch = useCallback(() => {');
    expect(mainTsx).toContain('const resolveQuickFileProjectId = useCallback(');
    expect(mainTsx).toContain('selectedChatKeyRef.current?.projectId ||\n      previewWorkbenchRef.current.activeProjectId ||\n      projectIdRef.current');
    expect(mainTsx).toContain('service.searchFileIndex(targetProjectId, {');
    expect(mainTsx).toContain('openChatFilePeek(result.path, null, quickFileProjectId);');
    expect(mainTsx).toContain("event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)");
    expect(mainTsx).toContain('className="quick-file-search-overlay"');

    expect(mainTsx).toContain('const [previewSelectionMenu, setPreviewSelectionMenu] = useState<PreviewSelectionMenuState | null>(null);');
    expect(mainTsx).toContain('const handlePreviewSelectionContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {');
    expect(mainTsx).toContain("activeWorkbenchTab.type !== 'file' && activeWorkbenchTab.type !== 'prompt-diff'");
    expect(mainTsx).toContain('navigator.clipboard.writeText(previewSelectionMenu.text)');
    expect(mainTsx).toContain('className="preview-selection-context-menu"');

    expect(stylesCss).toContain('.preview-workbench-search-bar');
    expect(stylesCss).toContain('.quick-file-search-overlay');
    expect(stylesCss).toContain('.preview-selection-context-menu');
  });

  test('preview workbench hooks stay before disconnected connect screen return', () => {
    const mainTsx = readSourceText(mainPath);
    const disconnectedReturnIndex = mainTsx.indexOf('if (!connected && !keepWorkspaceVisible) {');
    expect(disconnectedReturnIndex).toBeGreaterThanOrEqual(0);

    [
      'setPreviewSearchActiveIndex(current =>',
      'if (!previewSearchOpen || previewSearchMatches.length === 0) {',
      'if (!quickFileOpen) {',
      'const handleGlobalPreviewKeyDown = (event: KeyboardEvent) => {',
      'if (!previewSelectionMenu) {',
    ].forEach(pattern => {
      const hookIndex = mainTsx.indexOf(pattern);
      expect(hookIndex).toBeGreaterThanOrEqual(0);
      expect(hookIndex).toBeLessThan(disconnectedReturnIndex);
    });
  });

  test('preview workbench shortcuts are captured globally while preview is open', () => {
    const mainTsx = readSourceText(mainPath);
    const handlerStart = mainTsx.indexOf('const handleGlobalPreviewKeyDown = (event: KeyboardEvent) => {');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handlerEnd = mainTsx.indexOf("window.addEventListener('keydown', handleGlobalPreviewKeyDown, true);", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = mainTsx.slice(handlerStart, handlerEnd);
    const pShortcutIndex = handlerBody.indexOf("if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {");
    const previewOpenGateIndex = handlerBody.indexOf('if (!chatPreviewOpen) {');

    expect(handlerBody).toContain('if (!chatPreviewOpen) {');
    expect(pShortcutIndex).toBeGreaterThanOrEqual(0);
    expect(previewOpenGateIndex).toBeGreaterThan(pShortcutIndex);
    expect(handlerBody).toContain("if (event.key === 'Tab' && (event.ctrlKey || event.metaKey)) {");
    expect(handlerBody).toContain("cyclePreviewTabId(previewWorkbenchTabs, activeWorkbenchTab?.id ?? '', event.shiftKey ? -1 : 1)");
    expect(handlerBody).toContain('activeTabIdByProjectId: {');
    expect(handlerBody).toContain("if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {");
    expect(handlerBody).toContain('setPreviewSearchOpen(true);');
    expect(handlerBody).toContain("if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {");
    expect(mainTsx).toContain("window.addEventListener('keydown', handleGlobalPreviewKeyDown, true);");
    expect(mainTsx).toContain("window.removeEventListener('keydown', handleGlobalPreviewKeyDown, true);");
  });

  test('preview selection context menu preserves text selection through right click', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const previewContextSelectionRef = useRef<PreviewSelectionSnapshot | null>(null);');
    expect(mainTsx).toContain('type PreviewSelectionSnapshot = PreviewSelectionMenuState & {');
    expect(mainTsx).toContain('range: Range | null;');
    expect(mainTsx).toContain('const capturePreviewSelectionContext = (event: React.PointerEvent<HTMLDivElement>) => {');
    expect(mainTsx).toContain('if (event.button !== 2) {');
    expect(mainTsx).toContain('selection.getRangeAt(0).cloneRange()');
    expect(mainTsx).toContain('previewContextSelectionRef.current = {');
    expect(mainTsx).toContain('const preservedSelection = previewContextSelectionRef.current;');
    expect(mainTsx).toContain('selection?.removeAllRanges();');
    expect(mainTsx).toContain('selection?.addRange(preservedSelection.range);');
    expect(mainTsx).toContain('onPointerDownCapture={capturePreviewSelectionContext}');
  });

  test('preview pane renders one active typed workbench body instead of preview priority branches', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const previewWorkbenchHasTabs = Object.values(previewWorkbench.tabsByProjectId)');
    expect(mainTsx).toContain('const renderPreviewWorkbenchBody = (mode:');
    expect(mainTsx).not.toContain('chatPreviewHasContent = chatFilePreviewHasTabs || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen');
    expect(mainTsx).not.toContain('chatPromptArtifactPreview ? (');
    expect(mainTsx).not.toContain('chatAttachmentPreview ? (');
    expect(mainTsx).not.toContain('chatPortRelayPreviewOpen ?');
  });

  test('closing the last workbench tab leaves the preview open on the empty state', () => {
    const mainTsx = readSourceText(mainPath);
    const closeStart = mainTsx.indexOf('const closeWorkbenchTab = (tabId: string) => {');
    expect(closeStart).toBeGreaterThanOrEqual(0);
    const closeEnd = mainTsx.indexOf('const toggleChatFilePreviewTree = () => {', closeStart);
    const closeBody = mainTsx.slice(closeStart, closeEnd);

    expect(closeBody).toContain('const closingLastTab = previewWorkbenchTabs.length === 1');
    expect(closeBody).toContain('setChatPreviewManualOpen(true);');
    expect(closeBody).toContain('setChatPreviewManualCollapsed(false);');
  });

  test('closing transient non-file previews reveals retained file tabs instead of clearing the workbench', () => {
    const mainTsx = readSourceText(mainPath);
    const closeStart = mainTsx.indexOf('const closeChatFilePeekFromChrome = useCallback(() => {');
    expect(closeStart).toBeGreaterThanOrEqual(0);
    const closeEnd = mainTsx.indexOf('const openPeekFileInFullFileTab = useCallback', closeStart);
    const closeBody = mainTsx.slice(closeStart, closeEnd);

    expect(closeBody).toContain('const activeTab = activePreviewTab(previewWorkbenchRef.current);');
    expect(closeBody).toContain("if (activeTab?.type === 'prompt-diff') {");
    expect(closeBody).toContain('closeChatPromptArtifactPreview();');
    expect(closeBody).toContain("if (activeTab?.type === 'attachment') {");
    expect(closeBody).toContain('closeChatAttachmentPreview();');
    expect(closeBody).toContain("if (activeTab?.type === 'port-relay') {");
    expect(closeBody).toContain('closeChatPortRelayPreview();');
    expect(closeBody).toContain('setChatPreviewManualCollapsed(false);');
  });

  test('workbench file reads are independent per tab instead of globally cancelling older tabs', () => {
    const mainTsx = readSourceText(mainPath);
    const readStart = mainTsx.indexOf('const readChatFilePeek = useCallback(async');
    expect(readStart).toBeGreaterThanOrEqual(0);
    const readEnd = mainTsx.indexOf('const resolvePromptAttachmentThumbnail = useCallback', readStart);
    const readBody = mainTsx.slice(readStart, readEnd);

    expect(readBody).toContain('updatePreviewTabAfterLoad(');
    expect(readBody).toContain('failPreviewTabLoad(');
    expect(readBody).not.toContain('requestSeq !== chatFilePeekReadSeqRef.current');
  });

  test('peek viewer CSS defines desktop width limits and mobile full-screen overlay', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    const desktopPane = cssRuleBlock(stylesCss, '.chat-preview-pane');
    expect(desktopPane).toContain('width: var(--chat-file-peek-width, 520px);');
    expect(desktopPane).toContain('min-width: 360px;');
    expect(desktopPane).toContain('max-width: min(1520px, 80vw);');
    expect(mainTsx).toContain('const CHAT_FILE_PEEK_WIDTH_MAX = 1520;');
    expect(mainTsx).toContain('const CHAT_FILE_PEEK_VIEWPORT_MAX_RATIO = 0.8;');

    const workspaceRight = cssRuleBlock(stylesCss, '.workspace-right');
    expect(workspaceRight).toContain('min-width: 420px;');

    const mobileOverlay = cssRuleBlock(stylesCss, '.chat-preview-mobile-overlay');
    expect(mobileOverlay).toContain('position: fixed;');
    expect(mobileOverlay).toContain('inset: 0;');
    expect(mobileOverlay).toContain('z-index: 70;');

    expect(stylesCss).toContain(".narrow-shell[data-chat-preview-open='true'] .floating-control-stack-layer");
  });

  test('peek viewer code scroll exposes desktop horizontal overflow', () => {
    const stylesCss = readWebStyles(projectRoot);

    const scroll = cssRuleBlock(stylesCss, '.chat-file-peek-scroll');
    expect(scroll).toContain('min-width: 0;');
    expect(scroll).toContain('overflow-x: auto;');
    expect(scroll).toContain('overflow-y: auto;');
    expect(scroll).toContain('scrollbar-gutter: stable both-edges;');

    const nowrapCode = cssRuleBlock(stylesCss, '.chat-file-peek-scroll .code-wrap.nowrap');
    expect(nowrapCode).toContain('width: max-content;');
    expect(nowrapCode).toContain('min-width: 100%;');

    const nowrapDiff = cssRuleBlock(stylesCss, '.chat-file-peek-scroll .diff-wrap.nowrap');
    expect(nowrapDiff).toContain('width: max-content;');
    expect(nowrapDiff).toContain('min-width: 100%;');
  });

  test('peek viewer uses direct jumps and has an explicit File tab handoff', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const jumpToFileLineNow = (');
    expect(mainTsx).toContain('container.scrollTop =');
    expect(mainTsx).toContain('const openPeekFileInFullFileTab = useCallback(');
    expect(mainTsx).toContain("setTab('file');");
    expect(mainTsx).toContain('setPendingFileJump({ path: transferPath, line: transferLine });');

    const jumpStart = mainTsx.indexOf('const jumpToFileLineNow = (');
    const jumpEnd = mainTsx.indexOf('const scrollToFileLine =', jumpStart);
    const jumpBody = mainTsx.slice(jumpStart, jumpEnd);
    expect(jumpBody).not.toContain("behavior: 'smooth'");
  });

  test('peek viewer renders preview modes, load errors, and mobile back state', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('isMarkdownPath(peek.path)');
    expect(mainTsx).toContain('isHtmlPath(peek.path)');
    expect(mainTsx).toContain('isImageFile(peek.path');
    expect(mainTsx).toContain('Failed to load file');
    expect(mainTsx).toContain('createChatFilePeekHistoryState()');
    expect(mainTsx).toContain('closeChatFilePeek();');
  });

  test('preview chrome uses the chat-height single-line title bar', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    const toolbar = cssRuleBlock(stylesCss, '.chat-preview-toolbar');
    expect(toolbar).toContain('height: 30px;');
    expect(toolbar).toContain('min-height: 30px;');
    expect(toolbar).toContain('max-height: 30px;');

    const title = cssRuleBlock(stylesCss, '.chat-preview-title');
    expect(title).toContain('white-space: nowrap;');
    expect(title).toContain('text-overflow: ellipsis;');

    expect(mainTsx).toContain('className="chat-preview-title"');
    expect(mainTsx).not.toContain('className="chat-file-peek-name"');
    expect(mainTsx).not.toContain('className="chat-file-peek-path"');
  });
});
