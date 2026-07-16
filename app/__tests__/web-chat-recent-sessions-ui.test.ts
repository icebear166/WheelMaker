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

  test('recent sessions reuse the grouped shared builder with an 8-item cap', () => {
    expect(mainTsx).toContain('buildRecentChatSessionProjectSections({');
    expect(mainTsx).toContain('limit: 8,');
    // Right-click quick switch keeps its own 6-item cap.
    expect(mainTsx).toContain('limit: 6,');
  });

  test('renders recent sessions in colored project groups with background identity', () => {
    expect(mainTsx).toContain('renderRecentProjectSessionSection(section, mobile)');
    expect(mainTsx).toContain('recent-project-session-group');
    expect(mainTsx).toContain("tagVariantClass('recent-project-accent', targetProjectId)");
    expect(mainTsx).toContain('role="group"');
    expect(mainTsx).toContain('recent-project-session-watermark');
    expect(mainTsx).toContain('recent-project-session-watermark-name');
    expect(mainTsx).toContain('{projectName.toUpperCase()}');
    expect(mainTsx).not.toContain('recent-project-session-watermark-icon');
    expect(mainTsx).not.toContain('recent-project-session-watermark-hub');
    expect(mainTsx).toContain('recent-project-session-create');
    expect(mainTsx).not.toContain('recent-session-create-slot');
    expect(mainTsx).toContain('showProjectCreateAction');
    expect(mainTsx).toContain('sessionIndex === 0');
    expect(mainTsx).toContain('codicon codicon-add');
    expect(mainTsx).toContain("openWideProjectActionMenu(targetProjectId, 'new', event.currentTarget);");
    expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, 'new');");
    expect(mainTsx).toContain('onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('wide-session-agent-tag');
    expect(mainTsx).not.toContain('recent-session-project-tag');
    expect(mainTsx).not.toContain('recent-project-session-heading');
    expect(chatCss).toContain('.recent-project-session-watermark');
    expect(chatCss).toContain('.recent-project-accent-0');
    expect(chatCss).toContain('.recent-project-accent-7');
    expect(chatCss).toContain('.recent-project-session-create');
    expect(chatCss).not.toContain('.recent-project-session-heading');
    expect(chatCss).not.toContain('.recent-session-project-tag.wide-project-hub-tag');
  });

  test('keeps project identity behind full-width aligned session rows', () => {
    const recentListBlock = chatCss.match(/\.wide-project-session-list\.recent-sessions-list \{[\s\S]*?\n\}/)?.[0] ?? '';
    const groupBlock = chatCss.match(/\.recent-project-session-group \{[\s\S]*?\n\}/)?.[0] ?? '';
    const watermarkBlock = chatCss.match(/\.recent-project-session-watermark \{[\s\S]*?\n\}/)?.[0] ?? '';
    const sessionListBlock = chatCss.match(/\.recent-project-session-list \{[\s\S]*?\n\}/)?.[0] ?? '';
    const sessionRowBlock = chatCss.match(/\.recent-project-session-group \.recent-session-row \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(recentListBlock).toContain('padding: 1px 0;');
    expect(groupBlock).toContain('position: relative;');
    expect(groupBlock).toContain('overflow: hidden;');
    expect(groupBlock).toContain('background: color-mix(in srgb, var(--recent-project-accent) 7%, transparent);');
    expect(groupBlock).not.toContain('border:');
    expect(watermarkBlock).toContain('position: absolute;');
    expect(watermarkBlock).toContain('left: 11px;');
    expect(watermarkBlock).toContain('bottom: -6px;');
    expect(watermarkBlock).toContain('font-size: 36px;');
    expect(watermarkBlock).toContain('font-weight: 800;');
    expect(watermarkBlock).toContain('color: color-mix(in srgb, var(--recent-project-accent) 12%, transparent);');
    expect(watermarkBlock).toContain('pointer-events: none;');
    expect(sessionListBlock).toContain('position: relative;');
    expect(sessionListBlock).toContain('z-index: 1;');
    expect(sessionListBlock).toContain('padding: 1px 0 1px 21px;');
    expect(sessionRowBlock).toContain('grid-template-columns: 9px minmax(0, 1fr) auto auto;');
  });

  test('places one create action in the first-row leading rail and removes only the recent selection bar', () => {
    const createBlock = chatCss.match(/\.recent-project-session-create \{[\s\S]*?\n\}/)?.[0] ?? '';
    const recentSelectionBlock = chatCss.match(/\.recent-project-session-group \.recent-session-row\.selected::before \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(mainTsx).toContain('sessionIndex === 0');
    expect(createBlock).toContain('left: -20px;');
    expect(createBlock).not.toContain('right:');
    expect(recentSelectionBlock).toContain('content: none;');
    expect(chatCss).toContain('.wide-session-row.selected::before');
  });

  test('shares compact and relaxed row density with the pinned surface', () => {
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(surfaceTsx).toContain('sessionListDensity: SessionListDensity;');
    expect(surfaceTsx).toContain('data-session-list-density={sessionListDensity}');
    expect(chatCss).toContain("[data-session-list-density='compact'] .wide-session-row");
    expect(chatCss).toContain("[data-session-list-density='relaxed'] .wide-session-row");
    expect(chatCss).toContain('min-height: 28px;');
    expect(chatCss).toContain('min-height: 30px;');
  });

  test('recent sessions refresh only on prompt start / done', () => {
    expect(mainTsx).toContain(
      "if (message.method === 'prompt_request' || message.method === 'prompt_done') {",
    );
    expect(mainTsx).toContain('recentSessionsTick');
  });

  test('recent sessions has a pin toggle that sticks the block to the top', () => {
    // Pin button toggles recentSessionsPinned state.
    expect(mainTsx).toContain('recentSessionsPinned');
    expect(mainTsx).toContain('setRecentSessionsPinned(p => !p)');
    expect(mainTsx).toContain('recent-sessions-pin-btn');
    // Pinned state adds the `pinned` class for sticky positioning.
    expect(mainTsx).toContain("recentSessionsPinned ? ' pinned' : ''");
    // Sticky styling lives in chat.css so the block stays at top while scrolling.
    expect(chatCss).toContain('.recent-sessions-section.pinned');
    expect(chatCss).toContain('position: sticky;');
  });

  test('keeps the same frameless geometry before and after pinning', () => {
    const baseBlock = chatCss.match(/\.recent-sessions-section \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedBlock = chatCss.match(/\.recent-sessions-section\.pinned \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(baseBlock).toContain('margin: 0 0 5px;');
    expect(baseBlock).not.toContain('border:');
    expect(baseBlock).not.toContain('box-shadow:');
    expect(baseBlock).not.toContain('padding:');
    expect(baseBlock).not.toContain('position: sticky;');
    expect(pinnedBlock).toContain('position: sticky;');
    expect(pinnedBlock).not.toContain('margin:');
    expect(pinnedBlock).not.toContain('padding:');
    expect(pinnedBlock).not.toContain('border:');
    expect(pinnedBlock).toContain('box-shadow: 0 8px 18px rgb(0 0 0 / 16%);');
    expect(chatCss).not.toContain('.recent-sessions-section.pinned .recent-sessions-list');
  });

  test('uses a vertical pin and gives pinned recent sessions one contained graphite surface', () => {
    expect(mainTsx).toContain('className="codicon codicon-pinned" aria-hidden="true"');
    expect(mainTsx).not.toContain('className="codicon codicon-pin" aria-hidden="true"');

    const pinnedBlock = chatCss.match(/\.recent-sessions-section\.pinned \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(pinnedBlock).toContain('top: 4px;');
    expect(pinnedBlock).toContain('background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-sidebar));');
    expect(pinnedBlock).toContain('box-shadow: 0 8px 18px rgb(0 0 0 / 16%);');
    expect(pinnedBlock).not.toContain('backdrop-filter');

    const activePinBlock = chatCss.match(/\.recent-sessions-pin-btn\.active \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(activePinBlock).toContain('color: var(--accent-primary);');
    expect(activePinBlock).toContain('background: transparent;');
  });

  test('renders the pinned recent surface only above desktop chat with a collapsed session rail', () => {
    expect(mainTsx).toContain("import {ChatRecentSessionsSurface} from '../chat/ChatRecentSessionsSurface';");
    expect(mainTsx).toContain(
      'const showPinnedRecentSessionsSurface = isWide && sidebarCollapsed && recentSessionsPinned && !archivedMode && !sessionSearchActive && recentSessionSections.length > 0;',
    );
    expect(mainTsx).toContain('showPinnedRecentSessionsSurface ? (');
    expect(mainTsx).toContain('onUnpin={() => setRecentSessionsPinned(false)}');
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(mainTsx).toContain('{recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))}');
    expect(mainTsx).toContain('</ChatRecentSessionsSurface>');
  });

  test('keeps pinned Recent session actions available after the desktop sidebar unmounts', () => {
    expect(mainTsx).toContain('const renderWideProjectActionMenu = (');
    expect(mainTsx).toContain('sidebarCollapsed ? renderWideProjectActionMenu() : null');
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

  test('reserves pinned Recent before centering the fixed 800px chat content and shifts edge panels left by 8px', () => {
    expect(mainTsx).toContain("chatViewWidth === 'fixed-800' ? `chat-main chat-view-width-fixed-800${showPinnedRecentSessionsSurface ? ' chat-view-width-fixed-800-pinned-recent' : ''}` : 'chat-main'");

    const stackRule = chatCss.match(/\.chat-edge-surface-stack \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedFixedRule = chatCss.match(/\.chat-view-width-fixed-800-pinned-recent \.chat-view-content,[\s\S]*?\n\}/)?.[0] ?? '';

    expect(stackRule).toContain('--chat-edge-surface-stack-edge-gap: max(10px, calc(18px + var(--chat-scrollbar-gutter-width, 8px) - 8px));');
    expect(pinnedFixedRule).toContain('--chat-pinned-recent-content-left:');
    expect(pinnedFixedRule).toContain('var(--chat-edge-surface-stack-resolved-width)');
    expect(pinnedFixedRule).toContain('var(--chat-edge-surface-stack-column-gap)');
    expect(pinnedFixedRule).toContain('margin-left: min(');
  });

  test('lets the pinned recent surface expand naturally at the standard session density', () => {
    const surfaceBlock = chatCss.match(/\.chat-recent-sessions-surface\.desktop \{[\s\S]*?\n\}/)?.[0] ?? '';
    const listBlock = chatCss.match(/\.chat-recent-sessions-surface-list \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(surfaceBlock).toContain('--chat-recent-sessions-width: 360px;');
    expect(surfaceBlock).not.toContain('max-height:');
    expect(listBlock).not.toContain('max-height:');
    expect(listBlock).not.toContain('overflow-y: auto;');
    expect(listBlock).not.toContain('scrollbar-width: thin;');
    expect(chatCss).not.toContain('.chat-recent-sessions-surface-list .wide-session-row');
    expect(chatCss).not.toContain('.chat-recent-sessions-surface-list .wide-session-title');
  });
});
