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

  test('prompt diff artifacts open the chat preview without switching to the Git tab', () => {
    const mainTsx = readSourceText(mainPath);
    const openStart = mainTsx.indexOf('const openPromptArtifactDiff = useCallback(');
    expect(openStart).toBeGreaterThanOrEqual(0);
    const openEnd = mainTsx.indexOf('const selectedChatHasOpenPromptTurn', openStart);
    const openBody = mainTsx.slice(openStart, openEnd);

    expect(openBody).toContain('setChatPromptArtifactPreview({');
    expect(openBody).not.toContain("setTab('git')");
    expect(openBody).not.toContain('setPromptArtifactDiff({');
    expect(mainTsx).toContain('const chatPreviewHasContent = chatFilePreviewHasTabs || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen;');
    expect(mainTsx).toContain('<ChatPromptArtifactPreviewViewer');
    expect(mainTsx).toContain('togglePromptArtifactPreviewFile');
  });

  test('prompt attachments open the existing chat preview side panel', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('type ChatAttachmentPreviewState = {');
    expect(mainTsx).toContain('const [chatAttachmentPreview, setChatAttachmentPreview] = useState<ChatAttachmentPreviewState | null>(null);');
    expect(mainTsx).toContain('const chatPreviewHasContent = chatFilePreviewHasTabs || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen;');
    expect(mainTsx).toContain('const openChatAttachmentPreview = useCallback(');
    expect(mainTsx).toContain('service.readProjectSessionAttachment(');
    expect(mainTsx).toContain('<ChatAttachmentPreviewViewer');
    expect(mainTsx).toContain('preview={chatAttachmentPreview}');
    expect(mainTsx).toContain('Preview is being implemented.');
    expect(stylesCss).toContain('.chat-attachment-preview-surface');
    expect(stylesCss).toContain('.chat-attachment-original-image');
  });

  test('chat preview can open without active content and keeps chrome close controls', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const [chatPreviewManualOpen, setChatPreviewManualOpen] = useState(false);');
    expect(mainTsx).toContain('const [chatPreviewManualCollapsed, setChatPreviewManualCollapsed] = useState(false);');
    expect(mainTsx).toContain('const chatPreviewHasContent = chatFilePreviewHasTabs || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen;');
    expect(mainTsx).toContain('const chatPreviewOpen = chatPreviewManualOpen || (chatPreviewHasContent && !chatPreviewManualCollapsed);');
    expect(mainTsx).toContain('const ChatEmptyPreviewViewer = React.memo(function ChatEmptyPreviewViewer');
    expect(mainTsx).toContain('<div className="chat-preview-title" title="Preview">Preview</div>');
    expect(mainTsx).toContain('No preview selected');
    expect(mainTsx).toContain(') : <ChatEmptyPreviewViewer mode="desktop" onClose={closeChatFilePeekFromChrome} />');
    expect(mainTsx).toContain(') : <ChatEmptyPreviewViewer mode="mobile" onClose={closeChatFilePeekFromChrome} />');
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
    expect(mainTsx).toContain('const chatFilePreviewHasTabs = Object.values(previewWorkbench.tabsByProjectId)');
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

  test('chat file workbench renders project selector, tab strip, tab close controls, and a desktop tree popover', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('className="chat-file-workbench-project-select"');
    expect(mainTsx).toContain('className="chat-file-workbench-tabs"');
    expect(mainTsx).toContain('className="chat-file-workbench-tab-close"');
    expect(mainTsx).toContain('className="chat-file-workbench-tree-popover"');
    expect(mainTsx).toContain('aria-label="Toggle file tree"');
    expect(mainTsx).toContain('closePreviewTab(');

    expect(stylesCss).toContain('.chat-file-workbench-tabs');
    expect(stylesCss).toContain('.chat-file-workbench-tree-popover');
    expect(stylesCss).toContain('.chat-file-workbench-empty');
  });

  test('chat file workbench project selector is limited to visible projects', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const chatFilePreviewProjects = visibleProjectItems;');
    expect(mainTsx).toContain('chatFilePreviewProjects.map(projectItem =>');
    expect(mainTsx).toContain('ensurePreviewProjectVisible(');
  });

  test('closing the last workbench tab leaves the preview open on the empty state', () => {
    const mainTsx = readSourceText(mainPath);
    const closeStart = mainTsx.indexOf('const closeChatFilePreviewTab = (path: string) => {');
    expect(closeStart).toBeGreaterThanOrEqual(0);
    const closeEnd = mainTsx.indexOf('const toggleChatFilePreviewTree = () => {', closeStart);
    const closeBody = mainTsx.slice(closeStart, closeEnd);

    expect(closeBody).toContain('const closingLastTab = chatFilePreviewTabs.length === 1');
    expect(closeBody).toContain('setChatPreviewManualOpen(true);');
    expect(closeBody).toContain('setChatPreviewManualCollapsed(false);');
  });

  test('closing transient non-file previews reveals retained file tabs instead of clearing the workbench', () => {
    const mainTsx = readSourceText(mainPath);
    const closeStart = mainTsx.indexOf('const closeChatFilePeekFromChrome = useCallback(() => {');
    expect(closeStart).toBeGreaterThanOrEqual(0);
    const closeEnd = mainTsx.indexOf('const openPeekFileInFullFileTab = useCallback', closeStart);
    const closeBody = mainTsx.slice(closeStart, closeEnd);

    expect(closeBody).toContain('if (chatPromptArtifactPreview) {');
    expect(closeBody).toContain('closeChatPromptArtifactPreview();');
    expect(closeBody).toContain('if (chatAttachmentPreview) {');
    expect(closeBody).toContain('closeChatAttachmentPreview();');
    expect(closeBody).toContain('if (chatPortRelayPreviewOpen) {');
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
