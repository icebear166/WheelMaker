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
    const clickStart = mainTsx.indexOf('openChatFilePeek(targetFile.path, jumpLine ?? null, linkProjectId)');
    expect(clickStart).toBeGreaterThanOrEqual(0);
    const clickEnd = mainTsx.indexOf('</a>', clickStart);
    const clickBody = mainTsx.slice(clickStart, clickEnd);

    expect(clickBody).not.toContain("setTab('file')");
    expect(clickBody).not.toContain('setSelectedFile(targetFile.path)');
    expect(mainTsx).toContain('const openChatFilePeek = useCallback(');
    expect(mainTsx).toContain('beginPreviewTabLoad(');
  });

  test('recognized chat file links render the centered file glyph', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain("isFileLink ? 'chat-file-link' : ''");
    expect(mainTsx).toContain(
      '<ChatIcon name="file" className="chat-file-link-icon" />',
    );
    expect(mainTsx).not.toContain('<svg viewBox="0 0 16 16" focusable="false">');
  });

  test('preview and file workbench use the shared SVG icon system instead of Codicon', () => {
    const mainTsx = readSourceText(mainPath);
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const fileTreeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'file', 'FileExplorerTree.tsx'));

    expect(mainTsx).not.toContain('codicon');
    expect(chromeTsx).not.toContain('codicon');
    expect(fileTreeTsx).not.toContain('codicon');
    expect(mainTsx).toContain("import {Icon} from '../common/Icon';");
    expect(chromeTsx).toContain("import {Icon, type IconName} from '../common/Icon';");
    expect(fileTreeTsx).toContain("import {Icon} from '../common/Icon';");
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

  test('prompt diff active file selection survives open, load, restore, and header toggles', () => {
    const mainTsx = readSourceText(mainPath);
    const restoreStart = mainTsx.indexOf('const loadRestoredPreviewTab = useCallback(');
    const restoreEnd = mainTsx.indexOf('const resolvePromptAttachmentThumbnail', restoreStart);
    const restoreBody = mainTsx.slice(restoreStart, restoreEnd);
    const openStart = mainTsx.indexOf('const openPromptArtifactDiff = useCallback(');
    const openEnd = mainTsx.indexOf('const togglePromptArtifactPreviewFile', openStart);
    const openBody = mainTsx.slice(openStart, openEnd);
    const toggleStart = openEnd;
    const toggleEnd = mainTsx.indexOf('const selectedChatHasOpenPromptTurn', toggleStart);
    const toggleBody = mainTsx.slice(toggleStart, toggleEnd);
    const viewerStart = mainTsx.indexOf('const ChatPromptArtifactPreviewViewer = React.memo(function ChatPromptArtifactPreviewViewer');
    const viewerEnd = mainTsx.indexOf('}, (prev, next) => (', viewerStart);
    const viewerBody = mainTsx.slice(viewerStart, viewerEnd);
    const viewerComparatorEnd = mainTsx.indexOf('));', viewerEnd);
    const viewerComparatorBody = mainTsx.slice(viewerEnd, viewerComparatorEnd);

    expect(restoreStart).toBeGreaterThanOrEqual(0);
    expect(restoreEnd).toBeGreaterThan(restoreStart);
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    expect(toggleEnd).toBeGreaterThan(toggleStart);
    expect(viewerStart).toBeGreaterThanOrEqual(0);
    expect(viewerEnd).toBeGreaterThan(viewerStart);
    expect(viewerComparatorEnd).toBeGreaterThan(viewerEnd);
    expect(mainTsx).toContain('resolvePromptDiffActiveFilePath,');
    expect(openBody).toContain("activeFilePath: initialPath || initialFiles[0]?.path || '',");
    expect(openBody).toContain('files.some(file => file.path === tab.activeFilePath)');
    expect(openBody).toContain('resolvePromptDiffActiveFilePath(');
    expect(restoreBody).toContain('activeFilePath: resolvePromptDiffActiveFilePath(files, currentTab.activeFilePath),');
    expect(toggleBody).toContain('activeFilePath: path,');
    expect(toggleBody).toContain("file.path === path ? {...file, expanded: !file.expanded} : file");
    expect(viewerBody).toContain('const activeFilePath = resolvePromptDiffActiveFilePath(preview.files, preview.activeFilePath);');
    expect(viewerBody).toContain('const active = file.path === activeFilePath;');
    expect(viewerBody).toContain("className={`chat-prompt-diff-file${file.expanded ? ' expanded' : ''}${active ? ' active' : ''}`}");
    expect(viewerBody).toContain('aria-current={active || undefined}');
    expect(viewerComparatorBody).toContain('prev.preview === next.preview');
  });

  test('project file actions use canonical ordinary paths and active prompt diff paths', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);
    const actionsStart = mainTsx.indexOf('const renderPreviewWorkbenchActions = () => {');
    const actionsEnd = mainTsx.indexOf('const renderPreviewWorkbenchTabBody =', actionsStart);
    const actionsBody = mainTsx.slice(actionsStart, actionsEnd);
    const runnerStart = actionsBody.indexOf('const runProjectFileDesktopAction = (');
    const runnerEnd = actionsBody.indexOf('const indexPending =', runnerStart);
    const runnerBody = actionsBody.slice(runnerStart, runnerEnd);
    const disconnectedReturnStart = mainTsx.indexOf('if (!connected && !keepWorkspaceVisible) {');
    const connectedReturnStart = mainTsx.indexOf('return (\n    <>\n      <ResponsiveShell', disconnectedReturnStart);
    const connectedToastStart = mainTsx.indexOf('{toastMessage ? (', connectedReturnStart);
    const connectedToastEnd = mainTsx.indexOf('{appRenameDialog}', connectedToastStart);
    const connectedToastBody = mainTsx.slice(connectedToastStart, connectedToastEnd);

    expect(actionsStart).toBeGreaterThanOrEqual(0);
    expect(actionsEnd).toBeGreaterThan(actionsStart);
    expect(runnerStart).toBeGreaterThanOrEqual(0);
    expect(runnerEnd).toBeGreaterThan(runnerStart);
    expect(mainTsx).toContain('type DesktopProjectFileAction,');
    expect(mainTsx).toContain('resolvePreviewDesktopFilePath,');
    expect(actionsBody).toContain("const projectRoot = projects.find(project => project.projectId === tab.projectId)?.path ?? '';");
    expect(actionsBody).toContain('const confirmedPath = resolvePreviewDesktopFilePath(tab);');
    expect(actionsBody).toContain('const fileTarget = confirmedPath');
    expect(actionsBody).toContain('resolvePreviewFileLink(confirmedPath, projectRoot)');
    expect(actionsBody).not.toContain("const relativePath = tab.type === 'file'");
    expect(actionsBody).toContain('const desktopBridge = getDesktopWindowBridge();');
    expect(actionsBody).toContain('canInvokeDesktopFileAction(');
    expect(actionsBody).toContain('{canOpenProjectFileInVSCode ? (');
    expect(actionsBody).toContain('{canShowProjectFileInFolder ? (');
    expect(actionsBody).toContain("runProjectFileDesktopAction('vscode', 'Failed to open file in VS Code')");
    expect(actionsBody).toContain("runProjectFileDesktopAction('folder', 'Failed to show file in File Explorer')");
    expect(actionsBody).not.toContain('canOpenPromptDiffInVSCode');
    expect(actionsBody).not.toContain('canShowPromptDiffInFolder');
    expect(actionsBody).not.toContain('runPromptDiffDesktopFileAction');
    expect(actionsBody).toContain('<span>Open with VS Code</span>');
    expect(actionsBody).toContain('<span>Show in File Explorer</span>');
    expect(actionsBody).toContain('<span>Copy absolute path</span>');
    expect(actionsBody).not.toContain('<span>Open in File tab</span>');
    expect(actionsBody).toContain("'Rebuild file index'");
    expect(runnerBody).toContain('closeActionsMenu();');
    expect(runnerBody).toContain("setToastMessage('');");
    expect(runnerBody).toContain('if (!desktopBridge || !desktopTarget) {');
    expect(runnerBody).toContain('Promise.resolve()');
    expect(runnerBody).toContain('.then(() => invokeDesktopFileAction(desktopBridge, action, desktopTarget))');
    expect(runnerBody).toContain('.catch(err => {');
    expect(runnerBody).toContain('const reason = err instanceof Error ? err.message : String(err);');
    expect(runnerBody).toContain('setToastMessage(`${failurePrefix}: ${reason}`);');
    expect(runnerBody.indexOf('closeActionsMenu();')).toBeLessThan(runnerBody.indexOf("setToastMessage('');"));
    expect(runnerBody.indexOf("setToastMessage('');")).toBeLessThan(runnerBody.indexOf('Promise.resolve()'));
    expect(runnerBody.indexOf('.catch(err => {')).toBeLessThan(runnerBody.indexOf('setToastMessage(`${failurePrefix}: ${reason}`);'));

    const vscodeLabelIndex = actionsBody.indexOf('<span>Open with VS Code</span>');
    const folderLabelIndex = actionsBody.indexOf('<span>Show in File Explorer</span>');
    const copyPathLabelIndex = actionsBody.indexOf('<span>Copy absolute path</span>');
    const rebuildLabelIndex = actionsBody.indexOf("'Rebuild file index'");
    expect(vscodeLabelIndex).toBeLessThan(folderLabelIndex);
    expect(folderLabelIndex).toBeLessThan(copyPathLabelIndex);
    expect(copyPathLabelIndex).toBeLessThan(rebuildLabelIndex);
    expect(disconnectedReturnStart).toBeGreaterThanOrEqual(0);
    expect(connectedReturnStart).toBeGreaterThan(disconnectedReturnStart);
    expect(connectedToastStart).toBeGreaterThan(connectedReturnStart);
    expect(connectedToastEnd).toBeGreaterThan(connectedToastStart);
    expect(connectedToastBody).toContain('{toastMessage ? (');
    expect(connectedToastBody).toContain('className="app-toast"');

    const copyStart = mainTsx.indexOf('const copyChatFilePreviewPath = () => {');
    const copyEnd = mainTsx.indexOf('const refreshActivePortRelayPreview =', copyStart);
    const copyBody = mainTsx.slice(copyStart, copyEnd);
    expect(copyBody).toContain('const fileTarget = resolvePreviewFileLink(confirmedPath, projectRoot);');
    expect(copyBody).toContain('writeTextToClipboard(fileTarget.absolutePath)');
    expect(copyBody).not.toContain('`${projectRoot}/${relativePath}`');

    const activeHeader = cssRuleBlock(stylesCss, '.chat-prompt-diff-file.active > .chat-prompt-diff-file-header');
    const activeHeaderHover = cssRuleBlock(stylesCss, '.chat-prompt-diff-file.active > .chat-prompt-diff-file-header:hover');
    expect(stylesCss).toContain('.chat-prompt-diff-file.active > .chat-prompt-diff-file-header {');
    expect(activeHeader).toContain('background: color-mix(in srgb, var(--accent-primary) 12%, transparent);');
    expect(activeHeader).toContain('box-shadow: inset 2px 0 0 var(--accent-primary);');
    expect(stylesCss).toContain('.chat-prompt-diff-file.active > .chat-prompt-diff-file-header:hover {');
    expect(activeHeaderHover).toContain('background: color-mix(in srgb, var(--accent-primary) 18%, var(--hover));');
  });

  test('exports loaded project Markdown, chat file links, and completed replies as HTML', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);
    const actionsStart = mainTsx.indexOf('const renderPreviewWorkbenchActions = () => {');
    const actionsEnd = mainTsx.indexOf('const renderPreviewWorkbenchTabBody =', actionsStart);
    const actionsBody = mainTsx.slice(actionsStart, actionsEnd);

    expect(mainTsx).toContain('buildMarkdownHtmlFileName,');
    expect(mainTsx).toContain('buildPromptMarkdownHtmlFileName,');
    expect(mainTsx).toContain('resolveProjectMarkdownImagePath,');
    expect(mainTsx).toContain('outputMarkdownHtml,');
    expect(mainTsx).toContain('reserveMarkdownHtmlShare,');
    expect(mainTsx).toContain('const [markdownHtmlExportRequest, setMarkdownHtmlExportRequest]');
    expect(mainTsx).toContain("if (action === 'export-html')");
    expect(mainTsx).toContain('service.readProjectFile(relativePath, menuProjectId)');
    expect(mainTsx).toContain('const startMarkdownHtmlExport = async');
    expect(mainTsx).toContain('image.encoding !== \'base64\'');
    expect(mainTsx).toContain('data:${mimeType};base64,${image.content}');
    expect(mainTsx).toContain('exportPromptDoneMarkdownHtmlEvent(doneTurnIndex)');
    expect(mainTsx).toContain('<MarkdownHtmlExportSurface');
    expect(mainTsx).toContain("'HTML file copied to clipboard.'");
    expect(mainTsx).toContain("'HTML file shared.'");
    expect(mainTsx).toContain("'HTML file downloaded.'");
    expect(actionsBody).toContain('const canExportPreviewHtml =');
    expect(actionsBody).toContain('<span>Export as HTML</span>');
    expect(mainTsx).toContain('canExportHtml={');
    expect(mainTsx).toContain('isMarkdownPath(chatFileLinkMenu.link.path)');
    expect(stylesCss).toContain('.markdown-html-export-host {');
    expect(stylesCss).toContain('.markdown-html-export-surface {');
    const hostRule = cssRuleBlock(stylesCss, '.markdown-html-export-host');
    expect(hostRule).toContain('left: -10000px;');
    expect(hostRule).toContain('pointer-events: none;');
    expect(hostRule).toContain('width: 960px;');
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
    expect(mainTsx).toContain('mobileOverlay={mobileUsageOverlay ?? terminalMobileOverlay ?? chatPreviewMobileOverlay}');
  });

  test('right preview workbench uses project-scoped directory listing without switching workspace project', () => {
    const serviceTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'));
    const mainTsx = readSourceText(mainPath);

    expect(serviceTs).toContain('async listProjectDirectory(');
    expect(serviceTs).toContain("this.repository.listFiles(projectId, path || '.', knownHash)");
    expect(mainTsx).toContain('request: requestHash => service.listProjectDirectory(');
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
    expect(mainTsx).toContain('const linkProjectId = resolveChatFilePreviewProjectId();');
    expect(mainTsx).toContain('resolveChatFileLink(linkHref, linkProjectRoot)');
    expect(mainTsx).toContain('openChatFilePeek(targetFile.path, jumpLine ?? null, linkProjectId)');
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
    expect(mainTsx).toContain('<Icon name="locateFixed"');
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
    expect(mainTsx).toContain("<Icon name={collapsed ? 'chevronRight' : 'chevronDown'}");
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
    expect(chromeTsx).toContain("mobileHeaderHidden ? 'panelTopOpen' : 'panelTop'");

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

  test('preview title actions are consolidated into an accessible menu with current-project indexing', () => {
    const chromeTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'PreviewWorkbenchChrome.tsx'));
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);
    const pollStart = mainTsx.indexOf('const scheduleProjectIndexPoll = useCallback');
    const pollEnd = mainTsx.indexOf('const scheduleWheelMakerUpdatePoll', pollStart);
    const pollBody = mainTsx.slice(pollStart, pollEnd);

    expect(chromeTsx).toContain('actionsMenuOpen: boolean;');
    expect(chromeTsx).toContain('onActionsMenuToggle: () => void;');
    expect(chromeTsx).toContain('onActionsMenuClose: () => void;');
    expect(chromeTsx).toContain('className="preview-workbench-actions-menu"');
    expect(chromeTsx).toContain('title="Preview actions"');
    expect(chromeTsx).toContain('aria-haspopup="menu"');

    expect(mainTsx).toContain('const [previewWorkbenchActionsMenuOpen, setPreviewWorkbenchActionsMenuOpen] = useState(false);');
    expect(mainTsx).toContain('const handlePreviewProjectIndexRebuild = useCallback(async (projectId: string) => {');
    expect(mainTsx).toContain("projectIndexScanPendingByProjectId[tab.projectId] ? 'Indexing...' : 'Rebuild file index'");
    expect(mainTsx).toContain('actionsMenuOpen={previewWorkbenchActionsMenuOpen}');
    expect(mainTsx).toContain('onActionsMenuToggle={() => setPreviewWorkbenchActionsMenuOpen(open => !open)}');
    expect(mainTsx).toContain('onActionsMenuClose={() => setPreviewWorkbenchActionsMenuOpen(false)}');
    expect(pollBody).not.toContain("settingsDetailViewRef.current !== 'update'");

    expect(stylesCss).toContain('.preview-workbench-actions-menu');
    expect(stylesCss).toContain('.preview-workbench-action-menu-item');
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

  test('global shortcuts keep preview keys gated and leave Ctrl+F to the Windows search picker', () => {
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
    expect(handlerBody).not.toContain("event.key.toLowerCase() === 'f'");
    expect(handlerBody).not.toContain('openChatSearch();');
    expect(handlerBody).not.toContain('setPreviewSearchOpen(true);');
    expect(mainTsx).toContain("window.addEventListener('keydown', handleGlobalPreviewKeyDown, true);");
    expect(mainTsx).toContain("window.removeEventListener('keydown', handleGlobalPreviewKeyDown, true);");
    expect(
      (mainTsx.match(/event\.key\.toLowerCase\(\) === 'f' && \(event\.ctrlKey \|\| event\.metaKey\)/g) ?? []).length,
    ).toBe(1);
  });

  test('windows Ctrl+F opens a modal search target picker', () => {
    const mainTsx = readSourceText(mainPath);
    expect(mainTsx).toContain('if (!isWindowsPlatform) {');
    expect(mainTsx).toContain('const handleGlobalSearchTargetKeyDown = (event: KeyboardEvent) => {');
    expect(mainTsx).toContain("event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)");
    expect(mainTsx).toContain('firstEnabledChatSearchTarget(searchTargetAvailability)');
    expect(mainTsx).toContain('setSearchTargetPickerOpen(true);');
    expect(mainTsx).toContain('resolveChatSearchTargetPickerKey(event)');
    expect(mainTsx).toContain('confirmSearchTarget(searchTargetPickerTarget);');
    expect(mainTsx).toContain('cycleChatSearchTarget(current, action.delta, searchTargetAvailability)');
    expect(mainTsx).toContain('seedSearchQuery(searchTargetPickerTarget, action.text);');
    expect(mainTsx).toContain('CHAT_SEARCH_TARGET_ORDER.map(target => {');
    expect(mainTsx).toContain('className="chat-search-target-backdrop"');
    expect(mainTsx).toContain('className="chat-search-target-dialog"');
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
    expect(mainTsx).toContain('const previewFileLoadControllersRef = useRef<Map<string, AbortController>>(new Map());');
    expect(readBody).toContain('previewFileLoadControllersRef.current.get(loadKey)?.abort();');
    expect(readBody).toContain('signal: controller.signal');
    expect(readBody).not.toContain('requestSeq !== chatFilePeekReadSeqRef.current');
    expect(mainTsx).not.toContain('const chatFilePeekAbortControllerRef = useRef<AbortController | null>(null);');
  });

  test('routes external file previews outside project cache and tree lookup', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('isAbsolutePreviewFilePath(path)');
    expect(mainTsx).toContain('service.getExternalFileInfo(targetProjectId, path');
    expect(mainTsx).toContain('service.readExternalFile(targetProjectId, path');
    expect(mainTsx).toContain('service.getProjectFileInfo(targetProjectId, path');
    expect(mainTsx).toContain('service.readProjectFile(path, targetProjectId');
    expect(mainTsx).not.toContain('workspaceStore.cacheFile(');
    expect(mainTsx).toContain('if (isAbsolutePreviewFilePath(chatFilePeek.path)) return;');
    expect(mainTsx).toContain(
      'disabled={!chatFilePeek?.path || isAbsolutePreviewFilePath(chatFilePeek.path)}',
    );
  });

  test('routes HTML sources through Registry preview without prefetching their bodies', () => {
    const mainTsx = readSourceText(mainPath);
    const readStart = mainTsx.indexOf('const readChatFilePeek = useCallback(async');
    const restoreStart = mainTsx.indexOf('const loadRestoredPreviewTab = useCallback', readStart);
    const attachmentStart = mainTsx.indexOf('const openChatAttachmentPreview = useCallback');
    const attachmentEnd = mainTsx.indexOf('const buildLineRange', attachmentStart);
    const readBody = mainTsx.slice(readStart, restoreStart);
    const restoreBody = mainTsx.slice(restoreStart, attachmentStart);
    const attachmentBody = mainTsx.slice(attachmentStart, attachmentEnd);

    expect(mainTsx).toContain("import {HtmlPreview} from '../preview/HtmlPreview';");
    expect(mainTsx).toContain(
      "source: isAbsolutePreviewFilePath(peek.path) ? 'external-file' : 'project-file'",
    );
    expect(mainTsx).toContain("source: 'session-attachment'");
    expect(mainTsx).toContain('htmlPreviewEndpoint={registryEndpoints.previewURL.toString()}');
    expect(mainTsx).toContain("htmlPreviewCSRFToken={registryAuth.status?.csrfToken || ''}");
    expect(mainTsx).toContain('p?.projectId === n?.projectId');

    expect(readBody.indexOf('if (isHtmlPreviewPath(path)) {')).toBeGreaterThanOrEqual(0);
    expect(readBody.indexOf('if (isHtmlPreviewPath(path)) {')).toBeLessThan(
      readBody.indexOf('service.readExternalFile(targetProjectId, path'),
    );
    expect(restoreBody).toContain('if (isHtmlPreviewPath(tab.path)) {');
    expect(attachmentBody).toContain(
      "const htmlAttachment = isHtmlPreviewAttachment(title, block.mimeType || '');",
    );
    expect(attachmentBody.indexOf('if (htmlAttachment) {')).toBeLessThan(
      attachmentBody.indexOf('service.readProjectSessionAttachment('),
    );
  });

  test('opens a file-only context menu with copy and Desktop actions', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);
    const menuTsx = readSourceText(
      path.join(projectRoot, 'web', 'src', 'chat', 'ChatFileLinkContextMenu.tsx'),
    );

    expect(mainTsx).toContain("import {ChatFileLinkContextMenu");
    expect(mainTsx).toContain(
      'const [chatFileLinkMenu, setChatFileLinkMenu] = useState<ChatFileLinkMenuState | null>(null);',
    );
    expect(mainTsx).toContain('onContextMenu={event => {');
    expect(mainTsx).toContain('if (!targetFile) return;');
    expect(mainTsx).toContain('setChatFileLinkMenu({');
    expect(mainTsx).toContain('<ChatFileLinkContextMenu');
    expect(mainTsx).toContain('canInvokeDesktopFileAction(');
    expect(mainTsx).toContain('invokeDesktopFileAction(');
    expect(mainTsx).toContain('absolutePath: chatFileLinkMenu.link.absolutePath');
    expect(mainTsx).toContain('relativePath: chatFileLinkMenu.link.relativePath');
    expect(mainTsx).toContain("setToastMessage('Copied relative path.')");
    expect(mainTsx).toContain("setToastMessage('Copied absolute path.')");
    expect(stylesCss).toContain('.chat-file-link-context-menu');
    expect(menuTsx).not.toContain('onLongPress');
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

  test('keeps chat and preview content on one workspace canvas at every viewport', () => {
    const stylesCss = readWebStyles(projectRoot);
    const tokens = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'tokens.css'));

    expect(tokens.match(/--surface-workspace-content:/g) ?? []).toHaveLength(2);
    expect(cssRuleBlock(stylesCss, '.workspace-right')).toContain('background: var(--surface-workspace-content);');
    expect(cssRuleBlock(stylesCss, '.chat-preview-pane')).toContain('background: var(--surface-workspace-content);');
    expect(cssRuleBlock(stylesCss, '.chat-file-peek-surface')).toContain('background: var(--surface-workspace-content);');
    expect(cssRuleBlock(stylesCss, '.chat-file-peek-scroll')).toContain('background: var(--surface-workspace-content);');
    expect(cssRuleBlock(stylesCss, '.chat-preview-mobile-overlay')).toContain('background: var(--surface-workspace-content);');

    const chatCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));
    expect(chatCss).not.toContain('--surface-1');
    expect(chatCss).not.toContain('--surface-2');
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

  test('peek viewer uses direct jumps without a removed File tab handoff', () => {
    const mainTsx = readSourceText(mainPath);
    const navigationTs = readSourceText(path.join(projectRoot, 'web', 'src', 'preview', 'previewLineNavigation.ts'));

    expect(mainTsx).toContain('jumpToPreviewLineNow,');
    expect(navigationTs).toContain('export function jumpToPreviewLineNow(');
    expect(navigationTs).toContain('container.scrollTop =');
    expect(mainTsx).not.toContain('const openPeekFileInFullFileTab = useCallback(');
    expect(mainTsx).not.toContain("setTab('file');");

    expect(navigationTs).not.toContain("behavior: 'smooth'");
  });

  test('peek viewer renders preview modes, load errors, and mobile back state', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('isMarkdownPath(peek.path)');
    expect(mainTsx).toContain('isHtmlPreviewPath(peek.path)');
    expect(mainTsx).toContain('isImageFile(peek.path');
    expect(mainTsx).toContain('Failed to load file');
    expect(mainTsx).toContain('createChatFilePeekHistoryState()');
    expect(mainTsx).toContain('closeChatFilePeek();');
  });

  test('preview chrome uses the desktop chat titlebar surface and height', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    const toolbar = cssRuleBlock(stylesCss, '.chat-preview-toolbar');
    const desktopToolbar = cssRuleBlock(stylesCss, '.desktop-shell .preview-workbench-surface.desktop .preview-workbench-toolbar');
    expect(toolbar).toContain('height: 32px;');
    expect(toolbar).toContain('min-height: 32px;');
    expect(toolbar).toContain('max-height: 32px;');
    expect(desktopToolbar).toContain('background: var(--desktop-top-surface);');

    const title = cssRuleBlock(stylesCss, '.chat-preview-title');
    expect(title).toContain('white-space: nowrap;');
    expect(title).toContain('text-overflow: ellipsis;');

    expect(mainTsx).toContain('className="chat-preview-title"');
    expect(mainTsx).not.toContain('className="chat-file-peek-name"');
    expect(mainTsx).not.toContain('className="chat-file-peek-path"');
  });
});
