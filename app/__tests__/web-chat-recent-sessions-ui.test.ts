import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat recent sessions', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const chatCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));
  const sessionlistCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'sessionlist.css'));
  const surfaceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatRecentSessionsSurface.tsx'));
  const recentSectionTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'RecentSessionsSection.tsx'));
  const sessionRowTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionRow.tsx'));
  const listViewTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionListView.tsx'));
  const projectSectionTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'ProjectSection.tsx'));

  test('recent sessions section renders at top of the session list', () => {
    expect(mainTsx).toContain('Recent Sessions');
    expect(mainTsx).toContain('buildSessionListViewProps(false,');
    expect(mainTsx).toContain('buildSessionListViewProps(true,');
    expect(recentSectionTsx).toContain('recent-sessions-section');
    expect(recentSectionTsx).toContain('recent-sessions-list');
  });

  test('recent sessions section behaves like a collapsible block', () => {
    expect(mainTsx).toContain('RECENT_SESSIONS_VIRTUAL_PROJECT_ID');
    expect(mainTsx).toContain('toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)');
    expect(recentSectionTsx).toContain('name="history"');
    expect(recentSectionTsx).toContain('recent-sessions-icon');
  });

  test('recent sessions header shows a chevron collapse affordance on the right', () => {
    expect(recentSectionTsx).toContain('recent-sessions-collapse-btn');
    expect(recentSectionTsx).toContain("collapsed ? 'chevronDown' : 'chevronUp'");
    expect(recentSectionTsx).toContain('aria-expanded={!collapsed}');
  });

  test('recent sessions reuse the grouped shared builder with an 8-item cap', () => {
    expect(mainTsx).toContain('buildRecentChatSessionProjectSections({');
    expect(mainTsx).toContain('limit: 8,');
  });

  test('renders recent project context as a quiet micro divider between groups', () => {
    expect(recentSectionTsx).toContain('recent-project-session-group');
    expect(recentSectionTsx).toContain('role="group"');
    expect(recentSectionTsx).toContain('recent-project-divider');
    expect(recentSectionTsx).toContain('recent-project-divider-name');
    expect(recentSectionTsx).toContain('recent-project-divider-hub');
    expect(recentSectionTsx).toContain('recent-project-divider-create');
    expect(mainTsx).toContain("openWideProjectActionMenu(targetProjectId, kind, anchor)");
    expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, kind)");
    expect(listViewTsx).toContain('onContextMenu: event => props.onOpenSessionContextMenu(projectId, session.sessionId, event)');
    expect(mainTsx).toContain('onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => startProjectSessionLongPress(targetProjectId, sessionId, event)');
    expect(sessionRowTsx).toContain('wide-session-agent-tag');
    expect(sessionlistCss).toContain('.recent-project-divider');
    expect(sessionlistCss).toContain('.recent-project-divider-create');
    const dividerBlock = sessionlistCss.match(/\.recent-project-divider \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(dividerBlock).toContain('display: flex;');
  });

  test('recent rows reuse live session pin state without changing recent selection', () => {
    expect(mainTsx).toContain('?? snapshot');
    expect(listViewTsx).toContain('pinned={session.pinned === true}');
    expect(sessionRowTsx).toContain("${pinned ? ' has-pin-action' : ''}");
    expect(sessionRowTsx).toContain('className="wide-session-pin-btn"');
    expect(sessionRowTsx).toContain('{!pinned ? (');
    expect(mainTsx).toContain('handlePinProjectSession(targetProjectId, sessionId, false)');
    expect(mainTsx).toContain('buildRecentChatSessionProjectSections({');
    expect(mainTsx).not.toContain('pinned: liveSession.pinned');
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

  test('insets the selected session surface without moving row content', () => {
    expect(sessionlistCss).toContain('.wide-session-row.selected');
    const selectedSessionRule = sessionlistCss.match(/\.wide-session-row\.selected \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(selectedSessionRule).toContain('background: var(--accent-soft-bg);');
    expect(selectedSessionRule).not.toContain('margin-left:');
    expect(sessionlistCss).not.toContain('.wide-session-row.selected::before');
  });

  test('shares row density tokens with the pinned surface', () => {
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(surfaceTsx).toContain('sessionListDensity: SessionListDensity;');
    expect(surfaceTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(sessionlistCss).toContain('[data-session-list-density="compact"]');
    expect(sessionlistCss).toContain('--sl-row-py: 3px;');
    expect(sessionlistCss).toContain('--sl-row-py: 5px;');
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

  test('renders the floating recent surface only above desktop chat with a collapsed session rail', () => {
    expect(mainTsx).toContain("import {ChatRecentSessionsSurface} from '../chat/ChatRecentSessionsSurface';");
    expect(mainTsx).toContain('const showFloatingSessionPanel = isWide && chatSidebarCollapsed && !archivedMode && !sessionSearchActive;');
    expect(mainTsx).toContain('showFloatingSessionPanel ? (');
    const floatingStart = mainTsx.indexOf('{showFloatingSessionPanel ? (');
    const floatingSource = mainTsx.slice(floatingStart, floatingStart + 2200);
    expect(floatingSource).not.toContain('onUnpin');
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(mainTsx).toContain('const floatingViewProps = buildSessionListViewProps(false, false);');
    expect(mainTsx).toContain('buildSessionListViewProps(false,');
    expect(mainTsx).toContain('buildSessionListViewProps(true,');
    expect(floatingSource).toContain('showSlideOutShortcut');
    expect(mainTsx.match(/showSlideOutShortcut/g)).toHaveLength(1);
    expect(surfaceTsx).toContain('title="Recent Sessions"');
    expect(mainTsx).toContain('</ChatRecentSessionsSurface>');
  });

  test('renders the wide project action menu once outside transformed session panels', () => {
    expect(mainTsx).toContain('const renderWideProjectActionMenu = (');
    expect(mainTsx.match(/wide-project-action-popover\$\{wideProjectActionMenuExiting/g)).toHaveLength(1);
    expect(mainTsx).toContain('isWide ? renderWideProjectActionMenu() : null');
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
    expect(pinLongPressStart).toContain("openMobileProjectActionMenu(targetProjectId, 'actions');");
    expect(pinLongPressStart).not.toContain('togglePinnedProject(targetProjectId);');
    expect(sessionLongPressStart).toContain('if (isWide) {');
    expect(listViewTsx).toContain('onContextMenu: event => props.onOpenSessionContextMenu(projectId, session.sessionId, event)');
    expect(mainTsx).toContain("sheetMenu.kind === 'actions'");
    expect(mainTsx).toContain("pinnedProjectIds.includes(sheetMenu.projectId) ? 'Unpin Project' : 'Pin Project'");

    expect(projectSectionTsx).toContain('wide-project-pin-btn');
    expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, kind)");
    expect(mainTsx).toContain("openWideProjectActionMenu(targetProjectId, kind, anchor)");
    expect(projectSectionTsx).toContain('mobile-project-session-error');
  });

  test('keeps transient menus open while their own scroll containers move', () => {
    expect(mainTsx).toContain('const closeSidebarTransientMenus = useCallback(() => {');
    expect(mainTsx).toContain('const closeSidebarTransientMenusOnScroll = useCallback((event: Event) => {');
    expect(mainTsx).toContain("target.closest(SIDEBAR_TRANSIENT_MENU_SELECTOR)");
    expect(mainTsx).toContain("window.addEventListener('scroll', closeSidebarTransientMenusOnScroll, true);");
    expect(mainTsx).toContain("window.removeEventListener('scroll', closeSidebarTransientMenusOnScroll, true);");
    expect(mainTsx).toContain("window.addEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);");
    expect(mainTsx).toContain("window.removeEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);");
    expect(mainTsx).toContain("target?.closest('button, [role=\"button\"]')");
    expect(mainTsx).toContain('closeSidebarTransientMenus();\n    resetProjectResumeState();');
    expect(mainTsx).toContain('setProjectSessionActionMenu(null);');
    expect(mainTsx).toContain('setWideProjectActionMenu(null);');
    expect(mainTsx).toContain('setMobileProjectActionMenu(null);');
  });

  test('renders clipped hub and session action menus in the root overlay layer', () => {
    expect(mainTsx).toContain("import {createPortal} from 'react-dom';");
    expect(mainTsx).toContain("chatHubMenuOpen && typeof document !== 'undefined' ? createPortal(");
    expect(mainTsx).toContain('document.body,');
    expect(mainTsx).toContain('const projectSessionActionMenuOverlay = renderProjectSessionActionMenu();');
    expect(mainTsx).toContain('{projectSessionActionMenuOverlay}');
    expect(mainTsx).not.toContain('{renderProjectSessionActionMenu(targetProjectId, session)}');
    expect(mainTsx).not.toContain('{renderProjectSessionActionMenu(targetProjectId, liveSession)}');
  });

  test('reserves the edge surfaces before centering the fixed 800px chat content with a continuous margin', () => {
    expect(mainTsx).toContain('const chatMainClassName = isWide');
    expect(mainTsx).toContain("`chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}`");

    const stackRule = chatCss.match(/\.chat-edge-surface-stack \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedMainRule = chatCss.match(/\.chat-view-width-fixed-800-edge-surfaces \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedFixedRule = chatCss.match(/\.chat-view-width-fixed-800-edge-surfaces \.chat-view-content,[\s\S]*?\n\}/)?.[0] ?? '';

    expect(stackRule).toContain('--chat-edge-surface-stack-edge-gap: 0px;');
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

    expect(chatCss).toContain('--chat-edge-surface-width: var(--chat-session-panel-width);');
    expect(surfaceBlock).toContain('--chat-recent-sessions-width: var(--chat-edge-surface-width);');
    expect(surfaceBlock).not.toContain('max-height:');
    expect(listBlock).not.toContain('max-height:');
    expect(listBlock).not.toContain('overflow-y: auto;');
    expect(listBlock).not.toContain('scrollbar-width: thin;');
    expect(chatCss).not.toContain('.chat-recent-sessions-surface-list .wide-session-row');
    expect(chatCss).not.toContain('.chat-recent-sessions-surface-list .wide-session-title');
  });
});
