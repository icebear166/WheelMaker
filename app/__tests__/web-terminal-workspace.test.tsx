import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');

describe('terminal workspace integration', () => {
  test('places Terminal before Preview and renders a desktop bottom panel', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    const terminalButton = source.indexOf('className={`chat-terminal-toggle${terminalOpen ? \' active\' : \'\'}`}');
    const previewButton = source.indexOf('className={`chat-preview-toggle${chatPreviewOpen ? \' active\' : \'\'}`}');
    expect(terminalButton).toBeGreaterThan(0);
    expect(previewButton).toBeGreaterThan(terminalButton);
    expect(source).toContain('className="terminal-splitter"');
    expect(source).toContain('className="terminal-desktop-panel"');
    expect(source).toContain('<TerminalWorkbench mode="desktop"');
  });

  test('uses the full-screen mobile overlay slot and keeps Preview exclusive', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('const terminalMobileOverlay = !isWide && terminalOpen ? (');
    expect(source).toContain('className="terminal-mobile-overlay"');
    expect(source).toContain('mobileOverlay={terminalMobileOverlay ?? chatPreviewMobileOverlay}');
    expect(source).toContain("if (!isWide) setTerminalOpen(false);");
    expect(source).toContain('onCloseSurface={() => setTerminalOpen(false)}');
    expect(source).toContain('if (!isWide && terminalOpen) {');
  });

  test('handles terminal events, reconnect lists, and page-memory ownership', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('event.method === RegistryMethods.TerminalOutput');
    expect(source).toContain('event.method === RegistryMethods.TerminalChanged');
    expect(source).toContain('Promise.allSettled(hubIds.map(hubId => service.listTerminals(hubId)))');
    expect(source).toContain('const terminalResizeTokensRef = useRef(new Map<string, string>());');
    expect(source).not.toContain('workspaceStore.rememberTerminal');
  });

  test('confirms closing a running terminal', () => {
    const dialogs = read('web/src/shell/AppDialogs.tsx');
    expect(dialogs).toContain("kind: 'terminalClose'");
    expect(dialogs).toContain("if (target.kind === 'terminalClose') return 'Close running terminal?';");
    expect(dialogs).toContain('This terminates the terminal process tree');
  });

  test('imports focused Terminal styles with desktop and mobile geometry', () => {
    const indexCss = read('web/src/styles/index.css');
    const terminalCss = read('web/src/styles/terminal.css');
    expect(indexCss.trimEnd().endsWith("@import './terminal.css';")).toBe(true);
    expect(terminalCss).toContain('.terminal-desktop-panel');
    expect(terminalCss).toContain('min-height: 160px;');
    expect(terminalCss).toContain('.terminal-mobile-overlay');
    expect(terminalCss).toContain('position: fixed;');
    expect(terminalCss).toContain('z-index: 70;');
    expect(terminalCss).toContain([
      '.terminal-xterm-host {',
      '  width: 100%;',
      '  height: 100%;',
      '  touch-action: none;',
      '  overscroll-behavior: contain;',
      '}',
    ].join('\n'));
    expect(terminalCss).toContain('.terminal-actions .terminal-fit {');
    expect(terminalCss).toContain('display: inline-flex;');
    expect(terminalCss).toContain('width: 32px;');
    expect(terminalCss).toContain('height: 32px;');
  });

  test('automatically claims changed focused dimensions and recovers a stale resize token', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('onAutoResize={handleAutoClaimTerminalResize}');
    expect(source).toContain('terminalResizeClaimsRef');
    expect(source).toContain('terminalResizeTokensRef.current.delete(key);');
    expect(source).toContain('claimTerminalResize(key, cols, rows)');
    expect(source).toContain('shell={activeTerminal.shell}');
    expect(source).toContain('initialCwd={activeTerminal.initialCwd}');
  });
});
