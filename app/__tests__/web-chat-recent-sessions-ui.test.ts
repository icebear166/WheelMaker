import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat recent sessions', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const chatCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));
  const surfaceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatRecentSessionsSurface.tsx'));

  test('recent sessions section renders at top of the session list', () => {
    expect(mainTsx).toContain('Recent Sessions');
    expect(mainTsx).toContain('renderRecentSessionsSection(false)');
    expect(mainTsx).toContain('renderRecentSessionsSection(true)');
    expect(mainTsx).toContain('recent-sessions-section');
    expect(mainTsx).toContain('recent-sessions-list');
  });

  test('recent sessions section behaves like a collapsible block', () => {
    expect(mainTsx).toContain('RECENT_SESSIONS_VIRTUAL_PROJECT_ID');
    expect(mainTsx).toContain('toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)');
    expect(mainTsx).toContain('codicon-history recent-sessions-icon');
  });

  test('recent sessions header shows a chevron collapse affordance on the right', () => {
    expect(mainTsx).toContain('recent-sessions-collapse-btn');
    expect(mainTsx).toContain("recentCollapsed ? 'codicon-chevron-down' : 'codicon-chevron-up'");
    expect(mainTsx).toContain('aria-expanded={!recentCollapsed}');
  });

  test('recent sessions reuse the grouped shared builder with an 8-item cap', () => {
    expect(mainTsx).toContain('buildRecentChatSessionProjectSections({');
    expect(mainTsx).toContain('limit: 8,');
    // Right-click quick switch keeps its own 6-item cap.
    expect(mainTsx).toContain('limit: 6,');
  });

  test('renders recent project context as a quiet micro divider between groups', () => {
    expect(mainTsx).toContain('recent-project-session-group');
    expect(mainTsx).toContain('role="group"');
    expect(mainTsx).toContain('recent-project-divider');
    expect(mainTsx).toContain('recent-project-divider-name');
    expect(mainTsx).toContain('recent-project-divider-hub');
    expect(mainTsx).toContain('recent-project-divider-create');
    expect(mainTsx).toContain("openWideProjectActionMenu(targetProjectId, 'new', event.currentTarget);");
    expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, 'new');");
    expect(mainTsx).toContain('onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('wide-session-agent-tag');
    expect(chatCss).toContain('.recent-project-divider');
    expect(chatCss).toContain('.recent-project-divider-create');
    const dividerBlock = chatCss.match(/\.recent-project-divider \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(dividerBlock).toContain('margin: 4px 2px 1px 2px;');
  });

  test('removes colored cards, watermarks and floating create rail from recent groups', () => {
    expect(mainTsx).not.toContain('recent-project-session-watermark');
    expect(mainTsx).not.toContain('recent-project-session-create');
    expect(mainTsx).not.toContain("tagVariantClass('recent-project-accent', targetProjectId)");
    expect(mainTsx).not.toContain('showProjectCreateAction');
    expect(chatCss).not.toContain('.recent-project-session-watermark');
    expect(chatCss).not.toContain('.recent-project-accent-0');
    expect(chatCss).not.toContain('.recent-project-session-create');
    expect(chatCss).not.toContain('.recent-project-session-group .recent-session-row.selected::before');
  });

  test('recent session rows share the plain selection surface without a left bar', () => {
    expect(chatCss).toContain('.wide-session-row.selected');
    expect(chatCss).not.toContain('.wide-session-row.selected::before');
    expect(chatCss).not.toContain('content: none;');
  });

  test('shares row density tokens with the pinned surface', () => {
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(surfaceTsx).toContain('sessionListDensity: SessionListDensity;');
    expect(surfaceTsx).toContain('data-session-list-density={sessionListDensity}');
    expect(chatCss).toContain("[data-session-list-density='relaxed'] .wide-session-row");
    expect(chatCss).toContain('min-height: 30px;');
    expect(chatCss).not.toContain("[data-session-list-density='compact'] .wide-session-row");
  });

  test('recent sessions refresh only on prompt start / done', () => {
    expect(mainTsx).toContain(
      "if (message.method === 'prompt_request' || message.method === 'prompt_done') {",
    );
    expect(mainTsx).toContain('recentSessionsTick');
  });

  test('recent sessions scrolls with the list without any pin state', () => {
    expect(mainTsx).not.toContain('recentSessionsPinned');
    expect(mainTsx).not.toContain('recent-sessions-pin-btn');
    const sectionBlock = chatCss.match(/\.recent-sessions-section \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sectionBlock).not.toContain('position: sticky;');
    expect(sectionBlock).not.toContain('top: 0;');
    expect(sectionBlock).not.toContain('z-index');
    expect(sectionBlock).not.toContain('box-shadow');
    expect(chatCss).not.toContain('.recent-sessions-section:not(.collapsed)');
    expect(chatCss).not.toContain('.recent-sessions-section.pinned');
    expect(chatCss).not.toContain('.recent-sessions-pin-btn');
  });

  test('renders the pinned recent surface only above desktop chat with a collapsed session rail', () => {
    expect(mainTsx).toContain("import {ChatRecentSessionsSurface} from '../chat/ChatRecentSessionsSurface';");
    expect(mainTsx).toContain(
      'const showPinnedRecentSessionsSurface = isWide && sidebarCollapsed && !archivedMode && !sessionSearchActive && recentSessionSections.length > 0;',
    );
    expect(mainTsx).toContain('showPinnedRecentSessionsSurface ? (');
    expect(mainTsx).not.toContain('onUnpin');
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(mainTsx).toContain('{recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))}');
    expect(mainTsx).toContain('</ChatRecentSessionsSurface>');
  });

  test('keeps pinned Recent session actions available after the desktop sidebar unmounts', () => {
    expect(mainTsx).toContain('const renderWideProjectActionMenu = (');
    expect(mainTsx).toContain('sidebarCollapsed ? renderWideProjectActionMenu() : null');
  });

  test('recent surface shares the rail collapse state', () => {
    expect(mainTsx).toContain('collapsed={collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}');
    expect(mainTsx).toContain('onToggleCollapsed={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}');
    expect(surfaceTsx).toContain('collapsed: boolean;');
    expect(surfaceTsx).toContain('onToggleCollapsed: () => void;');
    expect(surfaceTsx).not.toContain('useState');
  });

  test('limits long-press session and pin actions to the mobile sidebar', () => {
    const pinLongPressStart = mainTsx.slice(
      mainTsx.indexOf('const startProjectPinLongPress ='),
      mainTsx.indexOf('const finishProjectPinLongPress ='),
    );
    const sessionLongPressStart = mainTsx.slice(
      mainTsx.indexOf('const startProjectSessionLongPress ='),
      mainTsx.indexOf('const finishProjectSessionLongPress ='),
    );

    expect(pinLongPressStart).toContain('if (isWide) {');
    expect(sessionLongPressStart).toContain('if (isWide) {');
    expect(mainTsx).toContain('onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}');
  });

  test('closes transient sidebar menus only after actual scroll events and when opening another sidebar action', () => {
    expect(mainTsx).toContain('const closeSidebarTransientMenus = useCallback(() => {');
    expect(mainTsx).toContain("window.addEventListener('scroll', closeSidebarTransientMenus, true);");
    expect(mainTsx).toContain("window.removeEventListener('scroll', closeSidebarTransientMenus, true);");
    expect(mainTsx).toContain("window.addEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);");
    expect(mainTsx).toContain("window.removeEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);");
    expect(mainTsx).toContain("target?.closest('button, [role=\"button\"]')");
    expect(mainTsx).toContain('closeSidebarTransientMenus();\n    resetProjectResumeState();');
    expect(mainTsx).toContain('setProjectSessionActionMenu(null);');
    expect(mainTsx).toContain('setWideProjectActionMenu(null);');
    expect(mainTsx).toContain('setMobileProjectActionMenu(null);');
  });

  test('reserves the edge surfaces before centering the fixed 800px chat content with a continuous margin', () => {
    expect(mainTsx).toContain("chatViewWidth === 'fixed-800' ? `chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}` : 'chat-main'");

    const stackRule = chatCss.match(/\.chat-edge-surface-stack \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedMainRule = chatCss.match(/\.chat-view-width-fixed-800-edge-surfaces \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedFixedRule = chatCss.match(/\.chat-view-width-fixed-800-edge-surfaces \.chat-view-content,[\s\S]*?\n\}/)?.[0] ?? '';

    expect(stackRule).toContain('--chat-edge-surface-stack-edge-gap: max(10px, calc(18px + var(--chat-scrollbar-gutter-width, 8px) - 8px));');
    expect(pinnedMainRule).toContain('--chat-edge-reserved-left:');
    expect(pinnedMainRule).toContain('--chat-edge-reserve-edge-gap:');
    expect(pinnedMainRule).toContain('--chat-fixed-centered:');
    expect(pinnedMainRule).toContain('--chat-fixed-right-min:');
    expect(pinnedFixedRule).toContain('margin-left: max(');
  });

  test('defines fixed Recent reservation on the chat main so sibling content can inherit it', () => {
    const pinnedMainRule = chatCss.match(/\.chat-view-width-fixed-800-edge-surfaces \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedContentRule = chatCss.match(/\.chat-view-width-fixed-800-edge-surfaces \.chat-view-content,[\s\S]*?\n\}/)?.[0] ?? '';

    expect(pinnedMainRule).toContain('--chat-edge-reserve-edge-gap:');
    expect(pinnedMainRule).toContain('--chat-edge-reserved-left:');
    expect(pinnedContentRule).not.toContain('--chat-edge-surface-stack-edge-gap');
    expect(pinnedContentRule).not.toContain('--chat-edge-surface-stack-resolved-width');
  });

  test('uses an opaque session context menu above the pinned Recent surface', () => {
    const overrideStart = chatCss.lastIndexOf('.project-session-action-menu {');
    const contextMenuOverride = overrideStart >= 0
      ? chatCss.slice(overrideStart, chatCss.indexOf('\n}', overrideStart) + 2)
      : '';

    expect(contextMenuOverride).toContain('background: var(--surface-overlay);');
    expect(contextMenuOverride).toContain('backdrop-filter: none;');
    expect(contextMenuOverride).toContain('-webkit-backdrop-filter: none;');
  });

  test('lets the pinned recent surface expand naturally at the standard session density', () => {
    const surfaceBlock = chatCss.match(/\.chat-recent-sessions-surface\.desktop \{[\s\S]*?\n\}/)?.[0] ?? '';
    const listBlock = chatCss.match(/\.chat-recent-sessions-surface-list \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(chatCss).toContain('--chat-edge-surface-width: 360px;');
    expect(surfaceBlock).toContain('--chat-recent-sessions-width: var(--chat-edge-surface-width);');
    expect(surfaceBlock).not.toContain('max-height:');
    expect(listBlock).not.toContain('max-height:');
    expect(listBlock).not.toContain('overflow-y: auto;');
    expect(listBlock).not.toContain('scrollbar-width: thin;');
    expect(chatCss).not.toContain('.chat-recent-sessions-surface-list .wide-session-row');
    expect(chatCss).not.toContain('.chat-recent-sessions-surface-list .wide-session-title');
  });
});
