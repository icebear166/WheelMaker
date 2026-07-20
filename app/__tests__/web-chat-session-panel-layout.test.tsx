import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(__dirname, '..');
const workspaceAppSource = readFileSync(resolve(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8').replace(/\r\n/g, '\n');
const responsiveShellSource = readFileSync(resolve(root, 'web/src/shell/ResponsiveShell.tsx'), 'utf8');
const sessionGlobalBarSource = readFileSync(resolve(root, 'web/src/chat/ChatSessionGlobalBar.tsx'), 'utf8');
const chatStyles = readFileSync(resolve(root, 'web/src/styles/chat.css'), 'utf8').replace(/\r\n/g, '\n');
const shellStyles = readFileSync(resolve(root, 'web/src/styles/shell.css'), 'utf8').replace(/\r\n/g, '\n');

function cssRuleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('\n}', start);
  return end < 0 ? '' : source.slice(start, end + 2);
}

describe('PC chat session-panel layout', () => {
  it('renders one permanent desktop chat title bar above both the sidebar and chat body', () => {
    expect(responsiveShellSource).toContain('desktopTopBar: ReactNode;');
    expect(responsiveShellSource).toContain('<div className="desktop-primary-workspace">');
    expect(responsiveShellSource).toContain('{desktopTopBar}');
    expect(workspaceAppSource).toContain("const desktopTopBar = isWide && tab === 'chat' ? renderChatTitleBar(false) : null;");
    expect(workspaceAppSource).toContain('desktopTopBar={desktopTopBar}');
    expect(workspaceAppSource).not.toContain('chat-pinned-title-bar');
    expect(workspaceAppSource).not.toContain('!desktopChatSessionPinned ? renderChatSessionHeader(false)');
  });

  it('keeps settings, project, and Hub controls inside the shared 360px desktop segment', () => {
    expect(shellStyles).toMatch(/\.page,\r?\n\.workspace \{[\s\S]*?--chat-session-panel-width: 360px;/);
    const addressRule = cssRuleBlock(chatStyles, '.chat-title-bar > .chat-session-header');
    expect(addressRule).toContain('flex: 0 0 var(--chat-session-panel-width);');
    expect(addressRule).toContain('width: var(--chat-session-panel-width);');
    expect(addressRule).toContain('padding: 0 8px;');
    expect(addressRule).toContain('gap: 8px;');
    const projectRule = cssRuleBlock(
      chatStyles,
      '.chat-title-bar > .chat-session-header .chat-title-project-button',
    );
    expect(projectRule).toContain('max-width: 116px;');
    expect(cssRuleBlock(chatStyles, '.chat-sidebar-title-actions')).toContain('margin-left: auto;');
    expect(cssRuleBlock(chatStyles, '.chat-main')).toContain('--chat-edge-surface-width: var(--chat-session-panel-width);');
  });

  it('orders desktop settings, project, and Hubs before the prompt without changing mobile project navigation', () => {
    const headerStart = workspaceAppSource.indexOf('const renderChatSessionHeader = (mobile: boolean) => {');
    const headerEnd = workspaceAppSource.indexOf('const renderMobileChatSessionSheet = () => {', headerStart);
    const headerSource = workspaceAppSource.slice(headerStart, headerEnd);
    const settingsIndex = headerSource.indexOf('{renderChatMenuSettingsButton()}');
    const projectIndex = headerSource.indexOf('{!mobile ? renderDesktopChatProjectSelector() : null}');
    const hubsIndex = headerSource.indexOf('{renderChatHubSummary()}');

    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(projectIndex).toBeGreaterThan(settingsIndex);
    expect(hubsIndex).toBeGreaterThan(projectIndex);

    const desktopProjectStart = workspaceAppSource.indexOf('const renderDesktopChatProjectSelector = () => (');
    const desktopProjectEnd = workspaceAppSource.indexOf('const renderDesktopChatBreadcrumbTitle = () => (', desktopProjectStart);
    const desktopProjectSource = workspaceAppSource.slice(desktopProjectStart, desktopProjectEnd);
    expect(desktopProjectSource).toContain('className={`chat-title-project-button');
    expect(desktopProjectSource).toContain('{activeChatBreadcrumbProjectName}');

    const desktopBreadcrumbStart = desktopProjectEnd;
    const mobileBreadcrumbStart = workspaceAppSource.indexOf('const renderMobileChatBreadcrumbTitle = () => (', desktopBreadcrumbStart);
    const desktopBreadcrumbSource = workspaceAppSource.slice(desktopBreadcrumbStart, mobileBreadcrumbStart);
    expect(desktopBreadcrumbSource).not.toContain('chat-title-project-button');
    expect(desktopBreadcrumbSource).toContain('chat-title-prompt-icon-button');

    const mobileBreadcrumbEnd = workspaceAppSource.indexOf('const renderChatTitleBar = (mobile: boolean) => (', mobileBreadcrumbStart);
    const mobileBreadcrumbSource = workspaceAppSource.slice(mobileBreadcrumbStart, mobileBreadcrumbEnd);
    expect(mobileBreadcrumbSource).toContain('chat-title-project-button');
  });

  it('does not let desktop session search change the settings and Hub segment', () => {
    const headerStart = workspaceAppSource.indexOf('const renderChatSessionHeader = (mobile: boolean) => {');
    const headerEnd = workspaceAppSource.indexOf('const renderMobileChatSessionSheet = () => {', headerStart);
    const headerSource = workspaceAppSource.slice(headerStart, headerEnd);

    expect(headerSource).toContain('const searchHeaderExpanded = mobile && sessionSearchHeaderExpanded;');
    expect(headerSource).toContain("${searchHeaderExpanded ? ' search-open' : ''}");
    expect(headerSource).toContain('{!searchHeaderExpanded ? (');
  });

  it('keeps the pinned Sessions panel below the permanent shell title bar', () => {
    const pinnedStart = workspaceAppSource.indexOf('{showPinnedChatSessionPanel ? (');
    const pinnedSource = workspaceAppSource.slice(pinnedStart, pinnedStart + 2200);

    expect(pinnedSource).not.toContain('className="chat-pinned-title-bar"');
    expect(pinnedSource).not.toContain('{renderChatSessionHeader(false)}');
    expect(chatStyles).not.toContain('.chat-session-panel-pinned .chat-session-panel-header');
  });

  it('pins the Chat session sidebar at 360px without changing resizable non-Chat sidebars', () => {
    expect(workspaceAppSource).toContain('const CHAT_SESSION_PANEL_WIDTH = 360;');
    expect(workspaceAppSource).toContain('const desktopLayoutSidebarWidth = desktopChatSessionPinned');
    expect(workspaceAppSource).toContain('desktopSidebarWidth={desktopLayoutSidebarWidth}');
    expect(workspaceAppSource).toContain('{isWide && !showPinnedChatSessionPanel ? (');
  });

  it('uses the shared panel for both fixed and slide-out session navigation', () => {
    expect(workspaceAppSource).toContain("import {ChatSessionPanel} from '../chat/ChatSessionPanel';");
    expect(workspaceAppSource).toMatch(/<ChatSessionPanel\s+mode="pinned"\s+title="Sessions"/);
    expect(workspaceAppSource).toMatch(/<ChatSessionPanel\s+mode="slideout"\s+title="Sessions"/);
  });

  it('keeps a floating session entry point when there are no recent sessions', () => {
    expect(workspaceAppSource).toContain("const showFloatingSessionPanel = isWide && sidebarCollapsed && !archivedMode && !sessionSearchActive;");
    expect(workspaceAppSource).toContain('{showFloatingSessionPanel ? (');
  });

  it('hides the auxiliary surface stack while the full session panel is open', () => {
    expect(workspaceAppSource).toContain("${sessionNavSlideOut.open ? ' covered-by-session-panel' : ''}");
    const coveredRule = cssRuleBlock(chatStyles, '.chat-edge-surface-stack.covered-by-session-panel');
    expect(coveredRule).toContain('visibility: hidden;');
    expect(coveredRule).toContain('pointer-events: none;');
  });

  it('adds an eight pixel desktop gap below the permanent title bar', () => {
    expect(chatStyles).not.toContain('.chat-edge-surface-stack.below-top-bar');
    const stackRule = cssRuleBlock(chatStyles, '.chat-edge-surface-stack');
    expect(stackRule).toContain('--chat-edge-surface-stack-edge-gap: 0px;');
    expect(stackRule).toContain('top: 8px;');
    expect(stackRule).toContain('left: 0;');
    const slideoutRule = cssRuleBlock(chatStyles, '.chat-session-nav-slideout');
    expect(slideoutRule).toContain('top: 0;');
    expect(slideoutRule).toContain('left: 0;');
    expect(slideoutRule).toContain('height: 100%;');
    expect(slideoutRule).toContain('border-radius: 0;');
    const slideoutGlassRule = cssRuleBlock(chatStyles, '.chat-session-nav-slideout .chat-edge-surface-glass');
    expect(slideoutGlassRule).toContain('border: 0;');
    expect(slideoutGlassRule).toContain('box-shadow: none;');
    expect(slideoutGlassRule).toContain('background: var(--desktop-top-surface);');
    const slideoutHeaderRule = cssRuleBlock(chatStyles, '.chat-session-nav-slideout .chat-session-panel-header');
    expect(slideoutHeaderRule).toContain('padding-top: 8px;');
  });

  it('uses the pinned Recent project presentation inside the unpinned surface', () => {
    const floatingStart = workspaceAppSource.indexOf('{showFloatingSessionPanel ? (');
    const floatingSource = workspaceAppSource.slice(floatingStart, floatingStart + 2200);
    expect(floatingSource).toContain('{renderRecentSessionsSection(false)}');
    expect(floatingSource).not.toContain('recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))');
  });

  it('fuses the floating Sessions header and Recent content into one inset card', () => {
    const stackRule = cssRuleBlock(chatStyles, '.chat-edge-surface-stack');
    expect(stackRule).toContain('box-sizing: border-box;');
    expect(stackRule).toContain('padding: 0 8px 8px;');

    expect(cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop.expanded')).toContain('border-radius: 8px;');
    const glassRule = cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop.expanded .chat-edge-surface-glass');
    expect(glassRule).toContain('border: 1px solid');
    expect(glassRule).toContain('box-shadow: none;');
    expect(glassRule).toContain('background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));');
    expect(glassRule).toContain('backdrop-filter: none;');

    expect(cssRuleBlock(chatStyles, '.chat-recent-sessions-surface-list')).toContain('padding: 0 3px 8px;');
    const recentSectionRule = cssRuleBlock(
      chatStyles,
      '.chat-recent-sessions-surface.desktop.expanded .wide-project-section.recent-sessions-section',
    );
    expect(recentSectionRule).toContain('margin-bottom: 0;');
    expect(recentSectionRule).toContain('border: 0;');
    expect(recentSectionRule).toContain('border-radius: 0;');
    expect(recentSectionRule).toContain('background: transparent;');
  });

  it('gives expanded Sessions, Plan, and Limits cards the same width and radius', () => {
    const stackItemRule = cssRuleBlock(
      chatStyles,
      '.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop,\n.chat-edge-surface-stack > .chat-plan-surface.desktop,\n.chat-edge-surface-stack > .chat-function-surface.desktop',
    );
    expect(stackItemRule).toContain('width: 100%;');

    const expandedCardRule = cssRuleBlock(
      chatStyles,
      '.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop.expanded,\n.chat-edge-surface-stack > .chat-plan-surface.desktop.expanded,\n.chat-edge-surface-stack > .chat-function-surface.desktop:not(.collapsed)',
    );
    expect(expandedCardRule).toContain('border-radius: 8px;');
  });

  it('uses one shared title-bar typography and control geometry for all floating cards', () => {
    const headerRule = cssRuleBlock(chatStyles, '.chat-edge-surface-header');
    expect(headerRule).toContain('grid-template-columns: 22px auto minmax(0, 1fr) auto auto;');
    expect(headerRule).toContain('min-height: 36px;');
    const titleRule = cssRuleBlock(chatStyles, '.chat-edge-surface-title');
    expect(titleRule).toContain('font-size: 11px;');
    expect(titleRule).toContain('font-weight: 650;');
    expect(titleRule).toContain('text-transform: uppercase;');
    const actionRule = cssRuleBlock(
      chatStyles,
      '.chat-edge-surface-header .chat-session-global-bar-btn,\n.chat-edge-surface-header .session-search-icon-btn,\n.chat-edge-surface-header .chat-function-action',
    );
    expect(actionRule).toContain('width: 22px;');
    expect(actionRule).toContain('height: 22px;');
    expect(actionRule).toContain('border-radius: 5px;');
  });

  it('wires the slide-out panel to delayed pointer-leave closing', () => {
    expect(workspaceAppSource).toContain('createSessionNavSlideOutAutoClose');
    expect(workspaceAppSource).toContain('sessionNavSlideOutAutoClose.schedule(');
    expect(workspaceAppSource).toContain('onPointerEnter={() => sessionNavSlideOutAutoClose.cancel()}');
    expect(workspaceAppSource).toContain('sessionNavSlideOutAutoClose.closeNow()');
    expect(workspaceAppSource).toContain(
      "if (tab !== 'chat' || sidebarSettingsOpen) {\n      sessionNavSlideOutAutoClose.cancel();\n      dispatchSessionNavSlideOut({ type: 'forceReset' });\n    }\n  }, [sessionNavSlideOutAutoClose, sidebarSettingsOpen, tab]);",
    );
  });

  it('keeps 100px of floating surfaces visible before shrinking the fixed chat column', () => {
    const fixedRule = cssRuleBlock(chatStyles, '.chat-view-width-fixed-800-edge-surfaces');
    expect(fixedRule).toContain('--chat-edge-min-visible: 100px;');
    expect(fixedRule).toContain('max(0px, calc(100% - var(--chat-edge-min-visible)))');
    const contentRule = cssRuleBlock(
      chatStyles,
      '.chat-view-width-fixed-800-edge-surfaces .chat-view-content,\n.chat-view-width-fixed-800-edge-surfaces .chat-composer-content',
    );
    expect(contentRule).toContain('width: var(--chat-fixed-column);');
  });

  it('keeps full-list expansion before Pin in the stable right action group', () => {
    expect(sessionGlobalBarSource.indexOf('{onToggleSlideOut ? (')).toBeLessThan(
      sessionGlobalBarSource.indexOf('{onTogglePin ? ('),
    );
  });

  it('adds three pixels of breathing room to every desktop session row', () => {
    expect(cssRuleBlock(chatStyles, '.wide-project-session-list')).toContain('padding: 1px 0 1px 11px;');
  });

  it('keeps the pinned panel scrollable and positions auxiliary surfaces beside it', () => {
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('display: flex;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('min-height: 0;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-scroll')).toContain('overflow-y: auto;');
    const pinnedStackRule = cssRuleBlock(chatStyles, '.chat-edge-surface-stack.beside-pinned-session-panel');
    expect(pinnedStackRule).toContain('top: 0;');
    expect(pinnedStackRule).toContain('left: 0;');
  });
});
