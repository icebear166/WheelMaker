import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web session search UI wiring', () => {
  test('keeps search protocol wiring with prompt turn navigation', () => {
    const projectRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const styles = readWebStyles(projectRoot);

    expect(main).toContain('searchResultsByProjectId');
    expect(main).toContain('startSessionSearch');
    expect(main).toContain('querySessionSearch');
    expect(main).toContain('cancelSessionSearch');
    expect(main).toContain('scrollToTurnIndex');
    expect(main).toContain('sessionSearchTargetTurn');
    expect(styles).toContain('.session-search-control');
    expect(styles).toContain('.chat-turn-search-highlight');
  });

  test('loads the matched prompt turn before applying search-result navigation', () => {
    const projectRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const clickStart = main.indexOf('const handleSessionSearchResultClick = async (');
    const clickEnd = main.indexOf('const renderSessionSearchHighlightedTitle = (', clickStart);
    expect(clickStart).toBeGreaterThanOrEqual(0);
    expect(clickEnd).toBeGreaterThan(clickStart);
    const clickBody = main.slice(clickStart, clickEnd);

    expect(clickBody).toContain("row.result.source === 'prompt'");
    expect(clickBody).toContain('targetTurnIndex: promptTargetTurnIndex');
    expect(main).toContain('const searchTargetTurnIsVisible = chatDisplayIndex.items.some(');
    expect(main).toContain('!searchTargetTurnIsVisible');

    const selectStart = main.indexOf('const selectProjectChatSession = async (');
    const selectEnd = main.indexOf('const selectWideProjectSession = async', selectStart);
    expect(selectStart).toBeGreaterThanOrEqual(0);
    expect(selectEnd).toBeGreaterThan(selectStart);
    const selectBody = main.slice(selectStart, selectEnd);
    expect(selectBody).toContain('targetTurnIndex?: number');
    expect(selectBody).toContain('forceFull: hasTargetTurnIndex');
    expect(selectBody).toContain('incremental: !hasTargetTurnIndex');
    expect(selectBody).toContain('revealTurnIndex: targetTurnIndex');
  });

  test('keeps session search controls in session panels and the mobile chat header', () => {
    const projectRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const styles = readWebStyles(projectRoot);

    expect(main).toContain('const renderChatHeaderSearchControls = () =>');
    expect(main).toContain('const renderSessionSearchStatusLine = () =>');
    expect(main).toContain('const sessionSearchHeaderExpanded = sessionSearchOpen || sessionSearchActive;');
    expect(main).toContain('const renderChatSessionHeader = (mobile: boolean) => {');
    expect(main).toContain('const searchHeaderExpanded = mobile && sessionSearchHeaderExpanded;');
    expect(main).toContain('const chatSessionHeaderClassName = `sidebar-title-row chat-session-header${searchHeaderExpanded ? \' search-open\' : \'\'}${mobile ? \' mobile\' : \'\'}`;');
    expect(main).not.toContain('chatSidebarTitleSearchOpen');

    const sharedHeaderStart = main.indexOf('const renderChatSessionHeader = (mobile: boolean) => {');
    const sharedHeaderEnd = main.indexOf('const renderMobileChatSessionSheet = () => {', sharedHeaderStart);
    expect(sharedHeaderStart).toBeGreaterThanOrEqual(0);
    expect(sharedHeaderEnd).toBeGreaterThan(sharedHeaderStart);
    const sharedHeader = main.slice(sharedHeaderStart, sharedHeaderEnd);
    expect(sharedHeader).toContain('renderChatHeaderSearchControls()');
    expect(sharedHeader).toContain('renderChatHubSummary()');
    expect(sharedHeader).toContain('className="chat-sidebar-title-actions"');
    expect(sharedHeader).toContain('{!searchHeaderExpanded ? (');
    expect(sharedHeader).toContain('{renderChatMenuSettingsButton()}');
    expect(sharedHeader).not.toContain('renderChatMenuUsageButton');
    expect(sharedHeader.indexOf('renderChatHubSummary()')).toBeLessThan(sharedHeader.lastIndexOf('renderChatHeaderSearchControls()'));
    expect(main).toContain('{renderChatSessionHeader(true)}');
    expect(main).toContain('renderChatSessionHeader(false)');

    const wideNavStart = main.indexOf('const renderWideProjectSessionNav = (options?: { includeRecent?: boolean }) =>');
    const wideNavEnd = main.indexOf('const renderCodePane = (', wideNavStart);
    expect(wideNavStart).toBeGreaterThanOrEqual(0);
    expect(wideNavEnd).toBeGreaterThan(wideNavStart);
    const wideNav = main.slice(wideNavStart, wideNavEnd);
    expect(wideNav).not.toContain('renderSessionSearchControls()');

    expect(main).not.toContain('renderChatHeaderSearchControls(true)');
    expect(main).not.toContain('renderChatHeaderSearchControls(false)');
    expect(main).not.toContain('renderChatHubSummary(true)');

    expect(styles).toContain('.chat-header-search-control');
    expect(styles).toContain('.chat-header-search-control.open');
    expect(styles).toContain('.chat-header-search-status');
    expect(styles).toContain('.sidebar-title-row.search-open');
    expect(styles).toContain('.chat-sidebar-title-actions');
    expect(styles).toContain('.sidebar-title-row.search-open .chat-sidebar-title-actions');
    expect(styles).toContain('.chat-session-header.mobile');
    expect(styles).not.toContain('.mobile-chat-drawer-header');
    expect(styles).not.toContain('min-height: calc(var(--wm-safe-area-top) + 66px);');
    const desktopSearchOpenBlock = styles.match(/\.sidebar-title-row\.search-open \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(desktopSearchOpenBlock).toContain('flex: 0 0 var(--chat-menu-header-height);');
    expect(desktopSearchOpenBlock).toContain('min-height: var(--chat-menu-header-height);');
    expect(desktopSearchOpenBlock).not.toContain('min-height: 58px;');
    const mobileHeaderBlock = styles.match(/\.chat-session-header\.mobile \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileHeaderBlock).toContain('height: calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');
  });

  test('renders full Hub labels and aggregate header search status text', () => {
    const projectRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const styles = readWebStyles(projectRoot);

    expect(main).toContain("const chatHubSummaryLabel = `${hubCount} ${hubCount === 1 ? 'Hub' : 'Hubs'}`;");
    expect(main).toContain("const chatHubProjectLabel = `${projectCount} ${projectCount === 1 ? 'Project' : 'Projects'}`;");
    const hubSummaryStart = main.indexOf('const renderChatHubSummary = useCallback(() => {');
    const hubSummaryEnd = main.indexOf('const floatingBaseBounds = useMemo(() => {', hubSummaryStart);
    expect(hubSummaryStart).toBeGreaterThanOrEqual(0);
    expect(hubSummaryEnd).toBeGreaterThan(hubSummaryStart);
    const hubSummary = main.slice(hubSummaryStart, hubSummaryEnd);
    expect(hubSummary).toContain('<span className="chat-hub-summary-copy">');
    expect(hubSummary.indexOf('<span className="chat-hub-summary-label">{chatHubSummaryLabel}</span>')).toBeLessThan(
      hubSummary.indexOf('<span className="chat-hub-summary-project-label">{chatHubProjectLabel}</span>'),
    );
    expect(hubSummary).not.toContain('{mobile ? (');
    expect(main).toContain('const sessionSearchProjectDoneCount = useMemo(');
    expect(main).toContain("`Searching ${sessionSearchProjectDoneCount}/${visibleProjectItems.length} projects`");
    expect(main).toContain('parts.push(`${sessionSearchErrorCount} error${sessionSearchErrorCount === 1 ? \'\' : \'s\'}`);');
    expect(main).toContain('sessionSearchStatusParts.join(\' · \')');
    expect(main).not.toContain('className="chat-hub-summary-count"');
    expect(main).not.toContain('Prompt · turn');
    expect(main).not.toContain('matched prompt text');
    expect(main).not.toContain(') : row.result.source === \'prompt\' ? (');
    expect(main).not.toContain('session-search-result-meta');
    expect(main).not.toContain("row.result.source !== 'title'");
    expect(main).toContain('title={title}');

    const hubButtonBlock = (styles.match(/\.chat-hub-summary-button \{[\s\S]*?\n\}/g) ?? [])
      .find(block => block.includes('height: 24px;')) ?? '';
    expect(hubButtonBlock).toContain('white-space: nowrap;');
    const hubSummaryCopyBlock = (styles.match(/(?:^|\n)\.chat-hub-summary-copy \{[\s\S]*?\n\}/g) ?? [])[0] ?? '';
    expect(hubSummaryCopyBlock).toContain('flex-direction: row;');
    expect(hubSummaryCopyBlock).toContain('gap: 4px;');
    expect(styles).not.toContain('.mobile-chat-drawer-header .chat-hub-summary-copy');
    expect(styles).not.toContain('.chat-hub-summary-label {\n  display: none;');
    expect(styles).not.toContain('.chat-hub-summary-count {');
  });

  test('keeps the Hub popover inside the left sidebar', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = readWebStyles(projectRoot);

    const popoverBlock = styles.match(/(?:^|\n)\.chat-hub-popover \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(popoverBlock).toContain('width: min(340px, calc(100vw - 24px));');
    const sidebarPopoverBlock = styles.match(/\.sidebar-title-row \.chat-hub-popover \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sidebarPopoverBlock).toContain('left: 12px;');
    expect(sidebarPopoverBlock).toContain('right: auto;');
    expect(sidebarPopoverBlock).toContain('max-width: calc(100vw - 24px);');
    expect(sidebarPopoverBlock).not.toContain('max-width: none;');
  });

  test('uses the same Hub popover frame for mobile and desktop chat headers', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = readWebStyles(projectRoot);

    expect(styles).toContain('.chat-session-header.mobile {');
    expect(styles).not.toContain('.mobile-chat-drawer-header .chat-hub-summary');
    expect(styles).not.toContain('.mobile-chat-drawer-header .chat-hub-popover');

    const sidebarPopoverBlock = styles.match(/\.sidebar-title-row \.chat-hub-popover \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sidebarPopoverBlock).toContain('left: 12px;');
    expect(sidebarPopoverBlock).toContain('right: auto;');
    expect(sidebarPopoverBlock).toContain('max-width: calc(100vw - 24px);');
  });

  test('keeps the session search focus highlight on the outer border instead of the inner input', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = readWebStyles(projectRoot);

    const focusWithinBlock = styles.match(/\.session-search-control\.open:focus-within,\s*\.chat-header-search-control\.open:focus-within \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(focusWithinBlock).toContain('border-color: color-mix(in srgb, var(--accent-primary) 45%, var(--border-subtle));');
    expect(focusWithinBlock).toContain('box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-primary) 14%, transparent);');

    const inputFocusVisibleBlock = styles.match(/\.session-search-input:focus-visible \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(inputFocusVisibleBlock).toContain('outline: none;');
    expect(inputFocusVisibleBlock).toContain('box-shadow: none;');
  });
});
