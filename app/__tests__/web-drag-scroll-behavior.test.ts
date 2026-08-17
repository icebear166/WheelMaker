import fs from 'fs';
import path from 'path';
import {
  CHAT_USER_SCROLL_LOCK_MS,
  isChatUserScrollLocked,
  nextChatUserScrollLockUntil,
  resolveChatKeyboardInset,
  resolveChatKeyboardLayoutViewportHeight,
  resolveChatKeyboardInsetScrollAction,
  resolveChatSessionReadWindowUpdate,
  resolveChatScrollBottomTop,
  resolveChatScrollNavVisibility,
  shouldAutoScrollChatToBottom,
} from '../web/src/chat/layout/chatScrollIntent';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web drag scroll behavior', () => {
  test('prevents horizontal overscroll bounce while dragging code in file and git views', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = readWebStyles(projectRoot);

    expect(styles).toContain('.workspace-right {');
    expect(styles).toContain('overscroll-behavior-x: none;');
    expect(styles).toContain('.scroll-panel {');
    expect(styles).toContain('overscroll-behavior-x: contain;');
  });

  test('pauses chat auto-follow while the user is wheel scrolling', () => {
    const now = 1000;
    const lockUntil = nextChatUserScrollLockUntil(now);

    expect(lockUntil).toBe(now + CHAT_USER_SCROLL_LOCK_MS);
    expect(isChatUserScrollLocked(lockUntil, now + CHAT_USER_SCROLL_LOCK_MS - 1)).toBe(true);
    expect(isChatUserScrollLocked(lockUntil, now + CHAT_USER_SCROLL_LOCK_MS)).toBe(false);
    expect(
      shouldAutoScrollChatToBottom({
        force: false,
        followsLatest: true,
        pointerScrolling: false,
        userScrollLocked: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoScrollChatToBottom({
        force: true,
        followsLatest: false,
        pointerScrolling: false,
        userScrollLocked: true,
      }),
    ).toBe(true);
  });

  test('delegates virtual row measurement and bottom scrolling to Virtuoso', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const virtualList = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'turns', 'ChatVirtuosoTurnList.tsx'),
      'utf8',
    );

    expect(virtualList).toContain("from 'react-virtuoso';");
    expect(virtualList).toContain('type VirtuosoHandle');
    expect(virtualList).toContain('totalListHeightChanged={handleTotalListHeightChanged}');
    expect(virtualList).toContain('virtuosoRef.current?.autoscrollToBottom();');
    expect(mainTsx).toContain("chatVirtuosoListRef.current?.scrollToBottom('auto');");
    expect(mainTsx).not.toContain('chatVirtuosoListRef.current?.autoscrollToBottom();');
    expect(mainTsx).not.toContain('container.scrollTop = nextScrollTop;');
    expect(mainTsx).not.toContain("container.querySelector<HTMLElement>('.chat-virtuoso-list') ?? container");
    expect(mainTsx).not.toContain('scrollChatToBottom(false);');
    expect(mainTsx).not.toContain('run(CHAT_BOTTOM_SCROLL_RETRY_FRAMES);');
    expect(mainTsx).not.toContain('keepSettling:');
  });

  test('keeps virtualizer item-count follow logic inside the Virtuoso wrapper', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const scrollIntent = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'chat', 'layout', 'chatScrollIntent.ts'), 'utf8');
    const virtualList = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'turns', 'ChatVirtuosoTurnList.tsx'),
      'utf8',
    );

    expect(virtualList).toContain("followOutput={() => (shouldAutoscrollNow() ? 'auto' : false)}");
    expect(virtualList).toContain('totalListHeightChanged={handleTotalListHeightChanged}');
    expect(virtualList).toContain('requestScrollToLastDisplayItem(');
    expect(scrollIntent).not.toContain('resolveChatBottomFollowAction');
    expect(mainTsx).not.toContain('chatDisplayItemCountRef');
    expect(mainTsx).not.toContain('resolveChatBottomFollowAction');
    expect(mainTsx).not.toContain('chatBottomFollowAction');
    expect(mainTsx).not.toContain('autoscrollChatToBottom');
  });

  test('uses the app follow intent instead of stale Virtuoso bottom state for chat output following', () => {
    const projectRoot = path.join(__dirname, '..');
    const virtualList = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'turns', 'ChatVirtuosoTurnList.tsx'),
      'utf8',
    );

    expect(virtualList).toContain("followOutput={() => (shouldAutoscrollNow() ? 'auto' : false)}");
    expect(virtualList).toContain('if (shouldAutoscrollNow()) {');
    expect(virtualList).not.toContain('if (atBottomRef.current && shouldAutoscrollNow())');
  });

  test('keeps the Virtuoso at-bottom event as the follow source during list remeasurement', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const handlerStart = mainTsx.indexOf('const handleChatAtBottomChange');
    const handlerEnd = mainTsx.indexOf('const handleChatScroll', handlerStart);
    const handler = mainTsx.slice(handlerStart, handlerEnd);

    expect(handler).toContain('chatAutoScrollFollowRef.current = atBottom;');
    expect(handler).toContain('setChatShowScrollToBottom(!atBottom);');
    expect(handler).not.toContain('applyChatScrollNavVisibility(scroller);');
  });

  test('shows the scroll-to-bottom button from the actual chat scroll container position', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(
      resolveChatScrollNavVisibility({
        scrollTop: 300,
        scrollHeight: 1200,
        clientHeight: 500,
        threshold: 80,
      }),
    ).toEqual({atBottom: false, showScrollToBottom: true, showScrollToTop: false});
    expect(
      resolveChatScrollNavVisibility({
        scrollTop: 620,
        scrollHeight: 1200,
        clientHeight: 500,
        threshold: 80,
      }),
    ).toEqual({atBottom: true, showScrollToBottom: false, showScrollToTop: false});
    // More than a viewport away from the top offers jump-to-top on top of the group.
    expect(
      resolveChatScrollNavVisibility({
        scrollTop: 560,
        scrollHeight: 2000,
        clientHeight: 500,
        threshold: 80,
      }),
    ).toEqual({atBottom: false, showScrollToBottom: true, showScrollToTop: true});
    // Jump-to-top never appears while following the bottom.
    expect(
      resolveChatScrollNavVisibility({
        scrollTop: 1500,
        scrollHeight: 2000,
        clientHeight: 500,
        threshold: 80,
      }),
    ).toEqual({atBottom: true, showScrollToBottom: false, showScrollToTop: false});
    expect(mainTsx).toContain('const handleChatScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {');
    expect(mainTsx).toContain('resolveChatScrollNavVisibility({');
    expect(mainTsx).toContain('onScroll={handleChatScroll}');
  });

  test('defers chat bottom settling while the mobile keyboard inset is shrinking', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(resolveChatKeyboardInsetScrollAction({previousInset: 0, nextInset: 180})).toBe('immediate');
    expect(resolveChatKeyboardInsetScrollAction({previousInset: 180, nextInset: 120})).toBe('deferred');
    expect(resolveChatKeyboardInsetScrollAction({previousInset: 120, nextInset: 0})).toBe('deferred');
    expect(resolveChatKeyboardInsetScrollAction({previousInset: 80, nextInset: 80})).toBe('none');
    expect(mainTsx).toContain('const CHAT_KEYBOARD_INSET_SETTLE_DELAY_MS = 120;');
    expect(mainTsx).toContain('const chatKeyboardInsetRef = useRef(chatKeyboardInset);');
    expect(mainTsx).toContain('const chatKeyboardInsetSettleTimerRef = useRef<number | null>(null);');
    expect(mainTsx).toContain('resolveChatKeyboardInsetScrollAction({');
    expect(mainTsx).toContain("if (keyboardInsetScrollAction === 'immediate') {");
    expect(mainTsx).toContain("if (keyboardInsetScrollAction === 'deferred') {");
    expect(mainTsx).toContain('CHAT_KEYBOARD_INSET_SETTLE_DELAY_MS');
  });

  test('keeps the mobile composer visually anchored while iOS pans or shrinks the viewport', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(resolveChatKeyboardInset({
      windowInnerHeight: 844,
      visualViewportHeight: 520,
      visualViewportOffsetTop: 0,
    })).toBe(324);
    expect(resolveChatKeyboardInset({
      windowInnerHeight: 844,
      visualViewportHeight: 520,
      visualViewportOffsetTop: 120,
    })).toBe(204);
    expect(resolveChatKeyboardInset({
      windowInnerHeight: 520,
      layoutViewportHeight: 844,
      visualViewportHeight: 520,
      visualViewportOffsetTop: 120,
    })).toBe(204);
    expect(resolveChatKeyboardInset({
      windowInnerHeight: 520,
      layoutViewportHeight: 844,
      visualViewportHeight: 520,
      visualViewportOffsetTop: 324,
    })).toBe(0);
    expect(resolveChatKeyboardLayoutViewportHeight({
      currentLayoutViewportHeight: 844,
      previousLayoutViewportHeight: 0,
      visualViewportHeight: 844,
      visualViewportOffsetTop: 0,
    })).toBe(844);
    expect(resolveChatKeyboardLayoutViewportHeight({
      currentLayoutViewportHeight: 520,
      previousLayoutViewportHeight: 844,
      visualViewportHeight: 520,
      visualViewportOffsetTop: 120,
    })).toBe(844);
    expect(resolveChatKeyboardInset({
      windowInnerHeight: 844,
      visualViewportHeight: 808,
      visualViewportOffsetTop: 0,
    })).toBe(0);
    expect(mainTsx).toContain('resolveChatKeyboardInset({');
    expect(mainTsx).toContain('resolveChatKeyboardLayoutViewportHeight({');
    expect(mainTsx).toContain('const mobileKeyboardLayoutViewportHeightRef = useRef(0);');
    expect(mainTsx).toContain('layoutViewportHeight,');
    expect(mainTsx).toContain('mobileKeyboardLayoutViewportHeightRef.current = layoutViewportHeight;');
    expect(mainTsx).toContain("window.addEventListener('resize', handleWindowResize);");
    expect(mainTsx).not.toContain('window.innerHeight - (viewport.height + viewport.offsetTop)');
  });

  test('does not double-apply keyboard inset when Android resizes the layout viewport', () => {
    const layoutViewportHeight = resolveChatKeyboardLayoutViewportHeight({
      currentLayoutViewportHeight: 520,
      previousLayoutViewportHeight: 844,
      visualViewportHeight: 520,
      visualViewportOffsetTop: 0,
    });

    expect(layoutViewportHeight).toBe(520);
    expect(resolveChatKeyboardInset({
      windowInnerHeight: 520,
      layoutViewportHeight,
      visualViewportHeight: 520,
      visualViewportOffsetTop: 0,
    })).toBe(0);
  });

  test('settles programmatic chat bottom scrolling against the actual scroll parent', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const virtualList = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'turns', 'ChatVirtuosoTurnList.tsx'),
      'utf8',
    );

    expect(resolveChatScrollBottomTop({scrollHeight: 1200, clientHeight: 500})).toBe(700);
    expect(resolveChatScrollBottomTop({scrollHeight: 300, clientHeight: 500})).toBe(0);
    expect(mainTsx).not.toContain('CHAT_HISTORY_BOTTOM_BUFFER');
    expect(mainTsx).not.toContain('bottomBuffer={CHAT_HISTORY_BOTTOM_BUFFER}');
    expect(virtualList).toContain('const scrollToLastDisplayItem = React.useCallback(');
    expect(virtualList).not.toContain('offset: virtuosoContext.bottomBuffer,');
    expect(virtualList).toContain('const requestScrollToLastDisplayItem = React.useCallback(');
    expect(virtualList).toContain('function scrollElementToBottom(');
    expect(virtualList).toContain('resolveChatScrollBottomTop({');
    expect(virtualList).toContain('const settleScrollParentToBottom = React.useCallback(');
    expect(virtualList).toContain('settleScrollParentToBottom(behavior);');
    expect(virtualList).toContain("settleScrollParentToBottom('auto');");
    expect(virtualList).toContain('onAtBottomChange?.(true);');
  });

  test('documents Virtuoso as the chat dynamic turn virtualizer', () => {
    const repositoryRoot = path.join(__dirname, '..', '..');
    const context = fs.readFileSync(path.join(repositoryRoot, 'CONTEXT.md'), 'utf8');

    expect(context).toContain('implemented with `react-virtuoso`');
    expect(context).toContain('Virtuoso Measurement Cache');
    expect(context).not.toContain('implemented with `@tanstack/react-virtual`');
    expect(context).not.toContain('Measured Height Cache');
  });

  test('keeps incremental session reads from resetting a history scroll window', () => {
    expect(
      resolveChatSessionReadWindowUpdate({
        useIncremental: true,
        followsLatest: false,
      }),
    ).toEqual({followLatest: false});
    expect(
      resolveChatSessionReadWindowUpdate({
        useIncremental: true,
        followsLatest: true,
      }),
    ).toEqual({followLatest: true});
    expect(
      resolveChatSessionReadWindowUpdate({
        useIncremental: false,
        followsLatest: false,
      }),
    ).toEqual({resetToLatest: true});
    expect(
      resolveChatSessionReadWindowUpdate({
        useIncremental: true,
        followsLatest: true,
        revealTurnIndex: 42,
      }),
    ).toEqual({revealTurnIndex: 42});
  });

  test('keeps responding prompt animation from changing chat scroll overflow', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = readWebStyles(projectRoot);
    const animationStart = styles.indexOf('@keyframes chat-prompt-dots-wave');
    const animationEnd = styles.indexOf('.chat-prompt-status-done', animationStart);
    const promptDotsAnimation = styles.slice(animationStart, animationEnd);

    expect(animationStart).toBeGreaterThanOrEqual(0);
    expect(animationEnd).toBeGreaterThan(animationStart);
    expect(promptDotsAnimation).not.toContain('transform:');
    expect(styles).toMatch(
      /\.chat-prompt-status-dots \{[\s\S]*contain: paint;[\s\S]*\}/,
    );
  });
});
