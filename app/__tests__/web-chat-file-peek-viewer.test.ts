import fs from 'fs';
import path from 'path';

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
  const stylesPath = path.join(projectRoot, 'web', 'src', 'styles.css');

  test('chat file links open the peek viewer without switching to the File tab', () => {
    const mainTsx = readSourceText(mainPath);
    const clickStart = mainTsx.indexOf('openChatFilePeek(targetFile.path, jumpLine ?? null)');
    expect(clickStart).toBeGreaterThanOrEqual(0);
    const clickEnd = mainTsx.indexOf('</a>', clickStart);
    const clickBody = mainTsx.slice(clickStart, clickEnd);

    expect(clickBody).not.toContain("setTab('file')");
    expect(clickBody).not.toContain('setSelectedFile(targetFile.path)');
    expect(mainTsx).toContain('const openChatFilePeek = useCallback(');
    expect(mainTsx).toContain('setChatFilePeek({');
  });

  test('desktop shell renders an optional third chat preview column', () => {
    const shellTsx = readSourceText(shellPath);
    const mainTsx = readSourceText(mainPath);

    expect(shellTsx).toContain('desktopPeek: ReactNode;');
    expect(shellTsx).toContain('{desktopPeek}');
    expect(mainTsx).toContain('desktopPeek={chatPreviewDesktopPane}');
    expect(mainTsx).toContain('mobileOverlay={chatPreviewMobileOverlay}');
  });

  test('peek viewer CSS defines desktop width limits and mobile full-screen overlay', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readSourceText(stylesPath);

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

  test('peek viewer uses direct jumps and has an explicit File tab handoff', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const jumpToFileLineNow = (');
    expect(mainTsx).toContain('container.scrollTop =');
    expect(mainTsx).toContain('const openPeekFileInFullFileTab = useCallback(');
    expect(mainTsx).toContain("setTab('file');");
    expect(mainTsx).toContain('setPendingFileJump({ path: chatFilePeek.path, line: chatFilePeek.targetLine });');

    const jumpStart = mainTsx.indexOf('const jumpToFileLineNow = (');
    const jumpEnd = mainTsx.indexOf('const scrollToFileLine =', jumpStart);
    const jumpBody = mainTsx.slice(jumpStart, jumpEnd);
    expect(jumpBody).not.toContain("behavior: 'smooth'");
  });

  test('peek viewer renders preview modes, load errors, and mobile back state', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const chatFilePeekIsMarkdown = isMarkdownPath(chatFilePeek.path);');
    expect(mainTsx).toContain('const chatFilePeekIsHtml = isHtmlPath(chatFilePeek.path);');
    expect(mainTsx).toContain('const chatFilePeekIsImage = isImageFile(');
    expect(mainTsx).toContain('Failed to load file');
    expect(mainTsx).toContain('createChatFilePeekHistoryState()');
    expect(mainTsx).toContain('closeChatFilePeek();');
  });

  test('preview chrome uses the chat-height single-line title bar', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readSourceText(stylesPath);

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
