import fs from 'fs';
import path from 'path';

const main = fs.readFileSync(path.join(__dirname, '../web/src/app/WorkspaceApp.tsx'), 'utf8');
const listView = fs.readFileSync(path.join(__dirname, '../web/src/chat/sessionlist/SessionListView.tsx'), 'utf8');

describe('session archive UI source integration', () => {
  test('renders archive controls before search controls in desktop and mobile headers', () => {
    expect(main).toContain('const renderChatArchiveControls = () =>');
    expect(main).toContain('const renderChatSessionHeader = (mobile: boolean) =>');
    expect(main).toContain('{renderChatSessionHeader(true)}');
    expect(main).toContain('renderChatSessionHeader(false)');
    expect(main).not.toContain('renderChatArchiveControls(false)');
    expect(main).not.toContain('renderChatArchiveControls(true)');

    const headerStart = main.indexOf('const renderChatSessionHeader = (mobile: boolean) =>');
    const headerEnd = main.indexOf('const renderMobileChatSessionSheet = (', headerStart);
    const header = main.slice(headerStart, headerEnd);
    expect(header.indexOf('renderChatArchiveControls()')).toBeLessThan(header.indexOf('renderChatHeaderSearchControls()'));
  });

  test('contains archive batch, older folding, and restore flow markers', () => {
    expect(main).toContain('sessionArchiveMenuOpen');
    expect(main).toContain('archiveBatchProgress');
    expect(main).toContain('archivedMode');
    expect(main).toContain('renderArchivedSessionRows');
    expect(main).toContain('readProjectArchivedSession');
    expect(main).toContain('restoreProjectArchivedSession');
    expect(main).toContain('splitOlderProjectSessions');
    expect(listView).toContain('Show ${split.hiddenOlderCount} old sessions...');
    expect(main).toContain('for (const candidate of candidates)');
    expect(main).not.toContain('Promise.all(candidates.map');
  });

  test('renders older toggle as a muted session row with old sessions copy', () => {
    expect(listView).toContain('session-older-toggle');
    expect(listView).not.toContain('session-older-spacer');
    expect(listView).toContain('Show ${split.hiddenOlderCount} old sessions...');
    expect(listView).not.toContain('session-older-leading');
    expect(listView).not.toContain('codicon-chevron-up');
    expect(listView).not.toContain('codicon-chevron-down');
  });

  test('renders archive batch status with a close action after completion', () => {
    const helperStart = main.indexOf('const renderArchiveBatchStatus = () =>');
    const helperEnd = main.indexOf('const renderArchivedSessionRows = (', helperStart);
    const helperSource = main.slice(helperStart, helperEnd);

    expect(main).toContain('const clearArchiveBatchStatus = () =>');
    expect(helperSource).toContain('archiveBatchRunning');
    expect(helperSource).toContain('session-archive-progress-dismiss');
    expect(helperSource).toContain('aria-label="Close archive status"');
    expect(helperSource).toContain('disabled={archiveBatchRunning}');
    expect(helperSource).toContain('onClick={clearArchiveBatchStatus}');
    expect(main).toContain('setArchiveBatchProgress(null);');
    expect(main).toContain("setArchiveBatchSummary('');");
  });

  test('renders a rich two-line archive menu with icon badges and descriptions', () => {
    const menuStart = main.indexOf('const renderChatArchiveControls = () =>');
    const menuEnd = main.indexOf('const toggleOlderSessionsExpanded = (', menuStart);
    const menuSource = main.slice(menuStart, menuEnd);

    expect(menuSource).toContain('className="session-archive-menu-title"');
    expect(menuSource.match(/className="session-archive-menu-item"/g)?.length).toBe(3);
    expect(menuSource.match(/className="session-archive-menu-item-icon"/g)?.length).toBe(3);
    expect(menuSource.match(/className="session-archive-menu-item-description"/g)?.length).toBe(3);
    expect(menuSource).toContain('Sessions idle for a week or more');
    expect(menuSource).toContain('Sessions idle for two weeks or more');
    expect(menuSource).toContain('Browse and restore archived sessions');
    expect(menuSource).toContain('className="session-archive-menu-separator"');
    expect(menuSource).not.toContain('className="wide-project-action-menu-item"');

    const styles = fs.readFileSync(path.join(__dirname, '../web/src/styles/chat.css'), 'utf8');
    expect(styles).toContain('.session-archive-menu-item-icon');
    expect(styles).toContain('.session-archive-menu-item-description');
    expect(styles).toContain('.session-archive-menu-separator');
    expect(styles).toContain('transform-origin: top left;');
  });
});
