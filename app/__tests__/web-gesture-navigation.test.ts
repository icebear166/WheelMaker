import fs from 'fs';
import path from 'path';
import {
  GESTURE_CLICK_CANCEL_PX,
  GESTURE_MOVE_LONG_PRESS_MS,
  shouldCancelGestureClick,
  shouldStartGestureMove,
} from '../web/src/shell/layouts/mobile/gestureNavigation';

import {readWebStyles} from '../testHelpers/webStyles';
function projectRoot(): string {
  return path.join(__dirname, '..');
}

function readMain(): string {
  return fs.readFileSync(path.join(projectRoot(), 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

function readSettingsRoot(): string {
  return fs.readFileSync(path.join(projectRoot(), 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
}

function readStyles(): string {
  return readWebStyles(projectRoot());
}

function readWorkspacePersistence(): string {
  return fs.readFileSync(
    path.join(projectRoot(), 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
    'utf8',
  );
}

describe('gesture navigation', () => {
  test('does not persist gesture navigation as an appearance preference', () => {
    const persistence = readWorkspacePersistence();

    expect(persistence).not.toContain('gestureNavigation: boolean;');
    expect(persistence).not.toContain("gestureNavigation: 'gestureNavigation',");
    expect(persistence).not.toContain('gestureNavigation: false,');
    expect(persistence).not.toContain('input.gestureNavigation');
    expect(persistence).not.toContain('GLOBAL_KEYS.gestureNavigation');
    expect(persistence).not.toContain('next.gestureNavigation');
  });

  test('uses click movement cancellation and 450ms drag threshold', () => {
    expect(GESTURE_CLICK_CANCEL_PX).toBe(12);
    expect(GESTURE_MOVE_LONG_PRESS_MS).toBe(450);
  });

  test('cancels click expansion after pointer movement crosses the threshold', () => {
    expect(shouldCancelGestureClick({
      distancePx: GESTURE_CLICK_CANCEL_PX - 1,
    })).toBe(false);
    expect(shouldCancelGestureClick({
      distancePx: GESTURE_CLICK_CANCEL_PX,
    })).toBe(true);
  });

  test('enters gesture movement after a 450ms hold', () => {
    expect(shouldStartGestureMove({
      elapsedMs: GESTURE_MOVE_LONG_PRESS_MS - 1,
    })).toBe(false);
    expect(shouldStartGestureMove({
      elapsedMs: GESTURE_MOVE_LONG_PRESS_MS,
    })).toBe(true);
  });

  test('commits taps on pointerup and suppresses duplicate click expansion', () => {
    const main = readMain();
    const currentSelectStart = main.indexOf('const handleGestureNavigationCurrentSelect = useCallback(');
    const currentSelectEnd = main.indexOf('const beginGestureNavigationPress = useCallback', currentSelectStart);
    const currentSelectBody = main.slice(currentSelectStart, currentSelectEnd);
    const pointerMoveStart = main.indexOf('const handleGestureNavigationPointerMove = useCallback(');
    const pointerMoveEnd = main.indexOf('const finishGestureNavigation = useCallback', pointerMoveStart);
    const pointerMoveBody = main.slice(pointerMoveStart, pointerMoveEnd);
    const pointerUpStart = main.indexOf('const finishGestureNavigation = useCallback(');
    const pointerUpEnd = main.indexOf('const cancelGestureNavigation = useCallback', pointerUpStart);
    const pointerUpBody = main.slice(pointerUpStart, pointerUpEnd);

    expect(main).toContain('const gestureNavigationSuppressClickUntilRef = useRef(0);');
    expect(main).not.toContain('gestureNavigationSuppressClickRef');
    expect(currentSelectBody).toContain('Date.now() <= gestureNavigationSuppressClickUntilRef.current');
    expect(currentSelectBody).toContain('floatingClickCooldownUntilRef.current > Date.now()');
    expect(currentSelectBody).toContain("gestureNavStateRef.current?.phase === 'expanded'");
    expect(currentSelectBody).toContain('setDrawerOpen(false);');
    expect(currentSelectBody).toContain('openGestureNavigationActions(shouldOpenDrawerWithFloatingNav(floatingNavCurrent));');
    expect(main).toContain('gestureNavigationExpanded && shouldOpenDrawerWithFloatingNav(floatingNavCurrent) && !drawerOpen');
    expect(pointerMoveBody).toContain('shouldCancelGestureClick({');
    expect(pointerMoveBody).toContain('clearGestureMoveLongPressTimer();');
    expect(pointerMoveBody).toContain('gestureNavigationSuppressClickUntilRef.current');
    expect(pointerMoveBody).not.toContain("intent === 'expand'");
    expect(pointerUpBody).toContain("current.phase === 'pressing'");
    expect(pointerUpBody).toContain('gestureNavigationSuppressClickUntilRef.current');
    expect(pointerUpBody).toContain(
      'openGestureNavigationActions(shouldOpenDrawerWithFloatingNav(floatingNavCurrent));',
    );
    expect(main).not.toContain('GESTURE_NAV_SYNTHETIC_CLICK_SUPPRESS_MS');
  });

  test('keeps floating drag state local and out of the workspace store', () => {
    const main = readMain();
    const uiState = fs.readFileSync(
      path.join(projectRoot(), 'web', 'src', 'shell', 'state', 'workspaceUiState.ts'),
      'utf8',
    );

    expect(main).toContain('useState<FloatingDragState | null>(null)');
    expect(main).not.toContain('transient.setFloatingDragState');
    expect(main).not.toContain('transient.floatingDragState');
    expect(uiState).not.toContain('floatingDragState');
    expect(uiState).not.toContain('WorkspaceFloatingDragState');
  });

  test('does not restart the gesture press from expanded card items', () => {
    const component = fs.readFileSync(
      path.join(projectRoot(), 'web', 'src', 'shell', 'layouts', 'mobile', 'MobileFloatingNav.tsx'),
      'utf8',
    );

    // Card items stop pointerdown propagation so a press on an item never
    // re-arms the drag long-press; only the card background starts a press.
    expect(component).toContain('onPointerDown={event => event.stopPropagation()}');
    expect(component).toContain('onPointerDown={onButtonPointerDown}');
  });

  test('renders the floating nav through the MobileFloatingNav component', () => {
    const main = readMain();

    expect(main).toContain("from '../shell/layouts/mobile/MobileFloatingNav';");
    expect(main).toContain('<MobileFloatingNav');
    expect(main).not.toContain('className="gesture-nav-control"');
    expect(main).not.toContain('className="gesture-nav-pill"');
    expect(main).not.toContain('gesture-nav-capsule');
    expect(main).not.toContain('<PortRelayFloatingButton');
    expect(main).not.toContain('codicon-comment-discussion');
    expect(main).not.toContain('codicon-settings-gear');
    expect(main).not.toContain('codicon-radio-tower');
    expect(main).not.toContain('data-idle=');
    expect(main).not.toContain('floatingControlsIdle');
  });

  test('styles the floating nav button and card on motion tokens', () => {
    const styles = readStyles();

    expect(styles).toContain('.floating-nav-button');
    expect(styles).toContain('.floating-nav-expanded-anchor');
    expect(styles).toContain('.floating-nav-card');
    expect(styles).toContain('.floating-nav-card-item');
    expect(styles).toContain('.floating-nav-unread-dot');
    expect(styles).toContain('.floating-nav-relay-dot');
    expect(styles).not.toContain('.gesture-nav-pill');
    expect(styles).not.toContain('.gesture-nav-capsule');
    expect(styles).not.toContain('.port-relay-floating-bubble');
    expect(styles).not.toContain('.port-relay-target-switch-menu');
    expect(styles).not.toContain("data-idle='true'");
    // No stray hardcoded durations inside the floating nav rules.
    const navSection = styles.match(/\.floating-nav-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(navSection).toContain('var(--motion-');
    expect(navSection).not.toMatch(/\d+ms/);
    // Expanded card uses the frosted overlay material; collapsed stays light.
    const cardBlock = styles.match(/\.floating-nav-card \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(cardBlock).toContain('blur(20px) saturate(1.6)');
    expect(cardBlock).toContain('var(--shadow-floating)');
    // Reduced motion covers the card entrance.
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.floating-nav-card[\s\S]*animation: none;[\s\S]*\}/,
    );
  });
});
