import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat recent sessions', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const hubMenuTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubMenu.tsx'));
  const chatCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));
  const sessionlistCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'sessionlist.css'));
  const sessionMenuTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionMenu.tsx'));
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
    expect(recentSectionTsx).toContain('name="clock"');
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
    expect(listViewTsx).toContain('gestureHandlers={searchMode ? undefined : bindSessionContextMenu({projectId, sessionId: session.sessionId})}');
    expect(listViewTsx).toContain('props.onOpenSessionContextMenu(target.projectId, target.sessionId, position);');
    expect(sessionRowTsx).toContain('<AgentTag agentType={agentType} />');
    expect(sessionlistCss).toContain('.recent-project-divider');
    expect(sessionlistCss).toContain('.recent-project-divider-create');
    const dividerBlock = sessionlistCss.match(/\.recent-project-divider \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(dividerBlock).toContain('display: flex;');
  });

  test('recent rows reuse live session pin state without changing recent selection', () => {
    expect(mainTsx).toContain('?? snapshot');
    expect(listViewTsx).toContain('pinned={session.pinned === true}');
    expect(sessionRowTsx).toContain("${pinned && onUnpin ? ' has-pin-action' : ''}");
    expect(sessionRowTsx).toContain('className="wide-session-pin-btn"');
    expect(sessionRowTsx).toContain('{!pinned ? (');
    expect(mainTsx).toContain('handlePinProjectSession(targetProjectId, sessionId, false)');
    expect(mainTsx).toContain('buildRecentChatSessionProjectSections({');
    expect(mainTsx).not.toContain('pinned: liveSession.pinned');
  });

  test('recent rows reuse live session mark state without reserving row width', () => {
    expect(listViewTsx).toContain('markColor={session.markColor}');
    expect(sessionRowTsx).toContain('wide-session-mark');

    const markBlock = sessionlistCss.match(/\.wide-session-mark \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(markBlock).toContain('position: absolute;');
    expect(markBlock).toContain('pointer-events: none;');
    expect(markBlock).not.toContain('margin:');
    expect(markBlock).not.toContain('padding:');
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
    expect(mainTsx).toContain('dataSessionListDensity={DESKTOP_SESSION_LIST_DENSITY}');
    expect(surfaceTsx).toContain('DESKTOP_SESSION_LIST_DENSITY');
    expect(surfaceTsx).toContain('sessionListDensity={DESKTOP_SESSION_LIST_DENSITY}');
    expect(surfaceTsx).not.toContain('sessionListDensity: SessionListDensity;');
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
    expect(mainTsx).not.toContain('sessionListDensity={sessionListDensity}');
    expect(mainTsx).toContain('const floatingViewProps = buildSessionListViewProps(false, false);');
    expect(mainTsx).toContain('buildSessionListViewProps(false,');
    expect(mainTsx).toContain('buildSessionListViewProps(true,');
    expect(floatingSource).not.toContain('showSlideOutShortcut');
    expect(mainTsx).not.toContain('showSlideOutShortcut');
    expect(chatCss).not.toContain('.chat-session-global-bar-shortcut');
    expect(surfaceTsx).toContain('title="Recent Sessions"');
    expect(mainTsx).toContain('</ChatRecentSessionsSurface>');
  });

  test('renders the wide project action menu once outside transformed session panels', () => {
    expect(mainTsx).toContain('const renderWideProjectActionMenu = (');
    expect(mainTsx.match(/wide-project-action-popover sl-session-list-popover\$\{wideProjectActionMenuExiting/g)).toHaveLength(1);
    expect(mainTsx).toContain('isWide ? renderWideProjectActionMenu() : null');
  });

  test('recent surface shares the rail collapse state', () => {
    expect(mainTsx).toContain('collapsed={collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}');
    expect(mainTsx).toContain('onToggleCollapsed={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}');
    expect(surfaceTsx).toContain('collapsed: boolean;');
    expect(surfaceTsx).toContain('onToggleCollapsed: () => void;');
    expect(surfaceTsx).not.toContain('useState');
  });

  test('shares context gestures across layouts while nested actions stay isolated', () => {
    expect(listViewTsx).toContain('const bindSessionContextMenu = useContextMenuTargetGesture<');
    expect(listViewTsx).toContain('const bindProjectContextMenu = useContextMenuTargetGesture<string>');
    expect(listViewTsx).toContain('gestureHandlers={searchMode ? undefined : bindSessionContextMenu({projectId, sessionId: session.sessionId})}');
    expect(listViewTsx).toContain('projectGestureHandlers={searchMode ? undefined : bindProjectContextMenu(projectId)}');
    expect(sessionRowTsx).toContain('const unpinGesture = useContextMenuActionGesture();');
    expect(projectSectionTsx).toContain('const projectActionGesture = useContextMenuActionGesture();');
    expect(mainTsx).toContain('const openProjectSessionContextMenu = useCallback((');
    expect(mainTsx).toContain('const openProjectContextMenu = useCallback((');
    expect(mainTsx).toContain('popover: isWide');
    expect(mainTsx).toContain('if (!isWide) {');
    expect(mainTsx).toContain("sheetMenu.kind === 'actions'");
    expect(mainTsx).toContain("pinnedProjectIds.includes(sheetMenu.projectId) ? 'Unpin Project' : 'Pin Project'");

    expect(projectSectionTsx).toContain('wide-project-pin-btn');
    expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, kind)");
    expect(mainTsx).toContain("openWideProjectActionMenu(targetProjectId, kind, anchor)");
    expect(projectSectionTsx).toContain('mobile-project-session-error');
  });

  test('keeps transient menus open while their own scroll containers move', () => {
    expect(mainTsx).toContain("const closeSidebarTransientMenus = useCallback((keepOpen: 'hub' | 'project' | 'prompt' | null = null) => {");
    expect(mainTsx).toContain('const closeSidebarTransientMenusOnScroll = useCallback((event: Event) => {');
    expect(mainTsx).toContain("target.closest(SIDEBAR_TRANSIENT_MENU_SELECTOR)");
    expect(mainTsx).toContain("window.addEventListener('scroll', closeSidebarTransientMenusOnScroll, true);");
    expect(mainTsx).toContain("window.removeEventListener('scroll', closeSidebarTransientMenusOnScroll, true);");
    expect(mainTsx).toContain("window.addEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);");
    expect(mainTsx).toContain("window.removeEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);");
    expect(mainTsx).toContain("target?.closest('button, [role=\"button\"]')");
    expect(mainTsx).toContain('if (target === chatScrollRef.current) {');
    expect(mainTsx).toContain('closeSidebarTransientMenus();\n    resetProjectResumeState();');
    expect(mainTsx).toContain('setProjectSessionActionMenu(null);');
    expect(mainTsx).toContain('setWideProjectActionMenu(null);');
    expect(mainTsx).toContain('setMobileProjectActionMenu(null);');
  });

  test('renders clipped hub and session action menus in the root overlay layer', () => {
    expect(mainTsx).toContain("import {createPortal} from 'react-dom';");
    expect(hubMenuTsx).toContain("import {createPortal} from 'react-dom';");
    expect(hubMenuTsx).toContain("open && typeof document !== 'undefined' ? createPortal(");
    expect(hubMenuTsx).toContain('document.body,');
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

  test('styles the session context menu with the shared glass tokens', () => {
    const menuBlock = sessionlistCss.match(/\.sl-session-list-popover \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(menuBlock).toContain('border: 1px solid var(--border-faint);');
    expect(menuBlock).toContain('box-shadow: var(--shadow-overlay);');
    expect(menuBlock).toContain('backdrop-filter: blur(12px) saturate(1.1);');
    expect(sessionlistCss).toContain('prefers-reduced-transparency');
  });

  test('uses the Project add-session popover as the session-list menu visual baseline', () => {
    const surfaceBlock = sessionlistCss.match(/\.sl-session-list-popover \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(surfaceBlock).toContain('border: 1px solid var(--border-faint);');
    expect(surfaceBlock).toContain('border-radius: var(--radius-panel);');
    expect(surfaceBlock).toContain('background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);');
    expect(surfaceBlock).toContain('box-shadow: var(--shadow-overlay);');
    expect(surfaceBlock).toContain('padding: 4px;');
    expect(surfaceBlock).toContain('backdrop-filter: blur(12px) saturate(1.1);');

    expect(sessionMenuTsx).toContain('project-session-action-menu sl-session-list-popover');
    expect(mainTsx).toContain('wide-project-action-popover sl-session-list-popover');
    expect(mainTsx).toContain('session-archive-menu sl-session-list-popover');
    expect(mainTsx).toContain('archived-session-restore-popover sl-session-list-popover');

    const archiveItemBlock = chatCss.match(/\.session-archive-menu-item \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(archiveItemBlock).toContain('border-radius: var(--radius-control);');
    expect(archiveItemBlock).toContain('transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);');
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
