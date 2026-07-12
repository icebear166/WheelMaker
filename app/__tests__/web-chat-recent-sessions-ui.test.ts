import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat recent sessions', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const chatCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));

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

  test('renders recent sessions in lightweight project groups with shared session actions', () => {
    expect(mainTsx).toContain('renderRecentProjectSessionSection(section, mobile)');
    expect(mainTsx).toContain('recent-project-session-group');
    expect(mainTsx).toContain('recent-project-session-heading');
    expect(mainTsx).toContain('recent-project-session-icon');
    expect(mainTsx).toContain('codicon codicon-folder recent-project-session-icon');
    expect(mainTsx).toContain('recent-project-session-title');
    expect(mainTsx).toContain('recent-project-session-hub');
    expect(mainTsx).toContain('style={hubAccentStyle(projectHubId)}');
    expect(mainTsx).toContain('{projectHubId}</span>');
    expect(mainTsx).toContain('recent-project-session-create');
    expect(mainTsx).toContain('codicon codicon-add');
    expect(mainTsx).toContain("openWideProjectActionMenu(targetProjectId, 'new', event.currentTarget);");
    expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, 'new');");
    expect(mainTsx).toContain('onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('wide-session-agent-tag');
    expect(mainTsx).not.toContain('recent-session-project-tag');
    expect(chatCss).toContain('.recent-project-session-heading');
    expect(chatCss).toContain('.recent-project-session-icon');
    expect(chatCss).toContain('.recent-project-session-hub.wide-project-hub-tag');
    expect(chatCss).toContain('.recent-project-session-create');
    expect(chatCss).not.toContain('.recent-session-project-tag.wide-project-hub-tag');
  });

  test('aligns recent project groups with the standard project session rail', () => {
    const recentListBlock = chatCss.match(/\.wide-project-session-list\.recent-sessions-list \{[\s\S]*?\n\}/)?.[0] ?? '';
    const headingBlock = chatCss.match(/\.recent-project-session-heading \{[\s\S]*?\n\}/)?.[0] ?? '';
    const nameBlock = chatCss.match(/\.recent-project-session-name \{[\s\S]*?\n\}/)?.[0] ?? '';
    const sessionListBlock = chatCss.match(/\.recent-project-session-list \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(recentListBlock).toContain('padding: 1px 0;');
    expect(headingBlock).toContain('grid-template-columns: 16px minmax(0, 1fr) 22px;');
    expect(headingBlock).toContain('padding: 0 5px;');
    expect(nameBlock).toContain('font-size: 12.5px;');
    expect(nameBlock).toContain('font-weight: 600;');
    expect(sessionListBlock).toContain('padding-left: 21px;');
  });

  test('compresses recent project rhythm without shrinking session rows', () => {
    const expandedSectionBlock = chatCss.match(/\.recent-sessions-section:not\(\.collapsed\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    const groupBlock = chatCss.match(/\.recent-project-session-group \{[\s\S]*?\n\}/)?.[0] ?? '';
    const headingBlock = chatCss.match(/\.recent-project-session-heading \{[\s\S]*?\n\}/)?.[0] ?? '';
    const compactHeadingBlock = chatCss.match(/\.wide-project-session-nav\[data-session-list-density='compact'\] \.recent-project-session-heading \{[\s\S]*?\n\}/)?.[0] ?? '';
    const relaxedHeadingBlock = chatCss.match(/\.wide-project-session-nav\[data-session-list-density='relaxed'\] \.recent-project-session-heading \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(expandedSectionBlock).toContain('padding-bottom: 4px;');
    expect(expandedSectionBlock).toContain('margin-bottom: 5px;');
    expect(groupBlock).toContain('margin: 2px 0 3px;');
    expect(headingBlock).toContain('min-height: 27px;');
    expect(compactHeadingBlock).toContain('min-height: 24px;');
    expect(relaxedHeadingBlock).toContain('min-height: 27px;');
    expect(compactHeadingBlock).not.toContain('.wide-session-row');
    expect(relaxedHeadingBlock).not.toContain('.wide-session-row');
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

  test('gives unpinned recent sessions a contained surface without floating elevation', () => {
    const baseBlock = chatCss.match(/\.recent-sessions-section \{[\s\S]*?\n\}/)?.[0] ?? '';
    const pinnedBlock = chatCss.match(/\.recent-sessions-section\.pinned \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(baseBlock).toContain('margin: 0 2px 4px;');
    expect(baseBlock).toContain('border-radius: calc(var(--radius-panel) - 2px);');
    expect(baseBlock).toContain('background: color-mix(in srgb, var(--surface-panel) 62%, transparent);');
    expect(baseBlock).toContain('box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-subtle) 72%, transparent);');
    expect(baseBlock).not.toContain('padding:');
    expect(baseBlock).not.toContain('position: sticky;');
    expect(pinnedBlock).toContain('position: sticky;');
    expect(pinnedBlock).toContain('box-shadow: 0 8px 18px rgb(0 0 0 / 16%);');
  });

  test('uses a vertical pin and gives pinned recent sessions one contained graphite surface', () => {
    expect(mainTsx).toContain('className="codicon codicon-pinned" aria-hidden="true"');
    expect(mainTsx).not.toContain('className="codicon codicon-pin" aria-hidden="true"');

    const pinnedBlock = chatCss.match(/\.recent-sessions-section\.pinned \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(pinnedBlock).toContain('top: 4px;');
    expect(pinnedBlock).toContain('border: 1px solid color-mix(in srgb, var(--border-strong) 74%, var(--border-subtle));');
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
    expect(mainTsx).toContain('<ChatRecentSessionsSurface onUnpin={() => setRecentSessionsPinned(false)}>');
    expect(mainTsx).toContain('{recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))}');
    expect(mainTsx).toContain('</ChatRecentSessionsSurface>');
  });
});
