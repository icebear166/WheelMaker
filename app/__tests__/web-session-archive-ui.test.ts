import fs from 'fs';
import path from 'path';

const main = fs.readFileSync(path.join(__dirname, '../web/src/main.tsx'), 'utf8');

describe('session archive UI source integration', () => {
  test('renders archive controls before search controls in desktop and mobile headers', () => {
    expect(main).toContain('const renderChatArchiveControls = (mobile: boolean) =>');
    expect(main).toContain('renderChatArchiveControls(false)');
    expect(main).toContain('renderChatArchiveControls(true)');

    const wideHeaderStart = main.indexOf('className="chat-sidebar-title-actions"');
    const wideHeaderEnd = main.indexOf('</div>', wideHeaderStart);
    const wideHeader = main.slice(wideHeaderStart, wideHeaderEnd);
    expect(wideHeader.indexOf('renderChatArchiveControls(false)')).toBeLessThan(wideHeader.indexOf('renderChatHeaderSearchControls(false)'));

    const mobileHeaderStart = main.indexOf('className={`mobile-chat-drawer-header');
    const mobileHeaderEnd = main.indexOf('{archivedMode ? renderArchivedSessionRows(true)', mobileHeaderStart);
    const mobileHeader = main.slice(mobileHeaderStart, mobileHeaderEnd);
    expect(mobileHeader.indexOf('renderChatArchiveControls(true)')).toBeLessThan(mobileHeader.indexOf('renderChatHeaderSearchControls(true)'));
  });

  test('contains archive batch, older folding, and restore flow markers', () => {
    expect(main).toContain('sessionArchiveMenuOpen');
    expect(main).toContain('archiveBatchProgress');
    expect(main).toContain('archivedMode');
    expect(main).toContain('renderArchivedSessionRows');
    expect(main).toContain('readProjectArchivedSession');
    expect(main).toContain('restoreProjectArchivedSession');
    expect(main).toContain('splitOlderProjectSessions');
    expect(main).toContain('Show ${hiddenOlderCount} old sessions...');
    expect(main).toContain('for (const candidate of candidates)');
    expect(main).not.toContain('Promise.all(candidates.map');
  });

  test('renders older toggle as a muted session row with old sessions copy', () => {
    const helperStart = main.indexOf('const renderProjectSessionRowsWithOlderFolding = (');
    const helperEnd = main.indexOf('const renderSessionSearchRow = (', helperStart);
    const helperSource = main.slice(helperStart, helperEnd);

    expect(helperSource).toContain('session-older-toggle');
    expect(helperSource).toContain('session-older-spacer');
    expect(helperSource).toContain('Show ${hiddenOlderCount} old sessions...');
    expect(helperSource).not.toContain('session-older-leading');
    expect(helperSource).not.toContain('codicon-chevron-up');
    expect(helperSource).not.toContain('codicon-chevron-down');
  });
});
