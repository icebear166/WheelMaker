import fs from 'fs';
import path from 'path';
import {
  GESTURE_LONG_PRESS_CANCEL_PX,
  GESTURE_LONG_PRESS_MS,
  GESTURE_MOVE_LONG_PRESS_MS,
  resolveGesturePressIntent,
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
  test('persists gesture navigation as a default-off appearance preference', () => {
    const persistence = readWorkspacePersistence();

    expect(persistence).toContain('gestureNavigation: boolean;');
    expect(persistence).toContain("gestureNavigation: 'gestureNavigation',");
    expect(persistence).toContain('gestureNavigation: false,');
    expect(persistence).toContain(
      "gestureNavigation: typeof input.gestureNavigation === 'boolean' ? input.gestureNavigation : base.gestureNavigation",
    );
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.gestureNavigation, v: serialize(this.state.global.gestureNavigation), updatedAt: now}',
    );
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.gestureNavigation, v: serialize(next.gestureNavigation), updatedAt: now}',
    );
  });

  test('uses 200ms expand threshold and 1000ms drag threshold', () => {
    expect(GESTURE_LONG_PRESS_MS).toBe(200);
    expect(GESTURE_MOVE_LONG_PRESS_MS).toBe(1000);
  });

  test('resolves pre-expansion press movement without distance-triggered drag', () => {
    expect(resolveGesturePressIntent({
      elapsedMs: GESTURE_LONG_PRESS_MS - 1,
      distancePx: GESTURE_LONG_PRESS_CANCEL_PX - 1,
    })).toBe('pressing');
    expect(resolveGesturePressIntent({
      elapsedMs: GESTURE_LONG_PRESS_MS,
      distancePx: GESTURE_LONG_PRESS_CANCEL_PX - 1,
    })).toBe('expand');
    expect(resolveGesturePressIntent({
      elapsedMs: GESTURE_LONG_PRESS_MS - 1,
      distancePx: GESTURE_LONG_PRESS_CANCEL_PX + 2,
    })).toBe('neutral');
  });

  test('enters gesture movement after a one second hold', () => {
    expect(shouldStartGestureMove({
      elapsedMs: GESTURE_MOVE_LONG_PRESS_MS - 1,
    })).toBe(false);
    expect(shouldStartGestureMove({
      elapsedMs: GESTURE_MOVE_LONG_PRESS_MS,
    })).toBe(true);
  });

  test('wires gesture navigation through appearance settings and mobile floating controls', () => {
    const main = readMain();
    const settingsRoot = readSettingsRoot();
    const currentSelectStart = main.indexOf('const handleGestureNavigationCurrentSelect = useCallback(');
    const currentSelectEnd = main.indexOf('const beginGestureNavigationPress = useCallback', currentSelectStart);
    const currentSelectBody = main.slice(currentSelectStart, currentSelectEnd);
    const heightMeasureDeps = main.match(
      /useLayoutEffect\(\(\) => \{[\s\S]*?const nextFloatingHeight = floatingControlStackRef\.current\?\.offsetHeight \?\? 184;[\s\S]*?\}, \[([\s\S]*?)\]\);/,
    )?.[1] ?? '';

    expect(main).toContain("import {");
    expect(main).toContain("} from '../shell/layouts/mobile/gestureNavigation';");
    expect(main).toContain('const [gestureNavigation, setGestureNavigation] = useState(');
    expect(main).toContain('typeof persistedGlobal.gestureNavigation === \'boolean\'');
    expect(main).toContain('gestureNavigation,');
    expect(settingsRoot).toContain('Gesture Navigation');
    expect(settingsRoot).toContain('checked={gestureNavigation}');
    expect(settingsRoot).toContain('onChange={e => setGestureNavigation(e.target.checked)}');
    expect(main).toContain("gestureNavigation ? (");
    expect(main).toContain('className="gesture-nav-control"');
    expect(main).toContain('className="gesture-nav-pill"');
    expect(main).toContain('className="gesture-nav-button gesture-nav-capsule"');
    expect(main).toContain('className="gesture-nav-button gesture-nav-current-button"');
    expect(main).toContain('onClick={handleGestureNavigationCurrentSelect}');
    expect(main).not.toContain('className="gesture-nav-badge"');
    expect(main).toContain('className="floating-nav-group"');
    expect(main).toContain('aria-label="Chat"');
    expect(main).toContain("codicon-comment-discussion");
    expect(main).toContain('handleGestureNavigationCurrentSelect');
    expect(currentSelectBody).toContain('handleFloatingChatSelect();');
    expect(currentSelectBody).not.toContain('handleFloatingNavSelect(tab)');
    expect(heightMeasureDeps).toContain('gestureNavigationExpanded,');
    expect(main).toContain('GESTURE_MOVE_LONG_PRESS_MS');
    expect(main).toContain('codicon-layout-sidebar-right');
    expect(main).toContain('codicon-settings-gear');
    expect(main).not.toContain('gesture-nav-drawer-button');
    expect(main).not.toContain('data-gesture-nav-tab');
  });

  test('styles gesture navigation as a collapsed pill and expanded vertical capsules', () => {
    const styles = readStyles();

    expect(styles).toContain('.gesture-nav-control');
    expect(styles).toContain('.gesture-nav-pill');
    expect(styles.match(/^\.gesture-nav-pill \{/gm) ?? []).toHaveLength(1);
    expect(styles).toMatch(
      /\.gesture-nav-control \{[\s\S]*width: 50px;[\s\S]*height: 48px;[\s\S]*\}/,
    );
    expect(styles).toMatch(
      /\.gesture-nav-pill \{[\s\S]*width: 50px;[\s\S]*grid-template-rows: 40px;[\s\S]*padding: 4px;[\s\S]*\}/,
    );
    expect(styles).toMatch(
      /\.gesture-nav-control\[data-expanded='true'\] \.gesture-nav-pill \{[\s\S]*top: -40px;[\s\S]*height: 128px;[\s\S]*grid-template-rows: repeat\(3, 40px\);[\s\S]*\}/,
    );
    expect(styles).not.toContain('height: 168px;');
    expect(styles).not.toContain('grid-template-rows: repeat(4, 40px);');
    expect(styles).not.toContain(".gesture-nav-control[data-expanded='true'] .gesture-nav-current-button");
    expect(styles).toContain('.gesture-nav-button');
    expect(styles).toContain('.gesture-nav-current-button');
    expect(styles).not.toContain('.gesture-nav-badge');
    expect(styles).toContain('.gesture-nav-capsule');
    expect(styles).toContain('gesture-capsule-fade-in');
    expect(styles).not.toContain('.gesture-nav-option');
    expect(styles).not.toContain('.gesture-nav-option-chat');
    expect(styles).not.toContain('.gesture-nav-option-file');
    expect(styles).not.toContain('.gesture-nav-option-git');
    expect(styles).not.toContain('.gesture-nav-drawer-button');
    expect(styles).not.toContain('gesture-nav-capsule-drawer');
  });

  test('shows preview capsule state and respects reduced motion', () => {
    const main = readMain();
    const styles = readStyles();

    expect(main).toContain('data-active={chatPreviewOpen}');
    expect(main).toContain('aria-pressed={chatPreviewOpen}');
    expect(styles).toMatch(
      /\.gesture-nav-capsule\[data-active='true'\] \{[\s\S]*color: color-mix\(in srgb, var\(--accent\) 88%, var\(--text\)\);[\s\S]*\}/,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.gesture-nav-pill,[\s\S]*\.gesture-nav-capsule[\s\S]*animation: none;[\s\S]*transition: none;[\s\S]*\}/,
    );
  });

  test('suppresses synthesized chat clicks after gesture expansion', () => {
    const main = readMain();
    const currentSelectStart = main.indexOf('const handleGestureNavigationCurrentSelect = useCallback(');
    const currentSelectEnd = main.indexOf('const beginGestureNavigationPress = useCallback', currentSelectStart);
    const currentSelectBody = main.slice(currentSelectStart, currentSelectEnd);

    expect(main).toContain('const gestureNavigationSuppressClickRef = useRef(false);');
    expect(main).toContain('const gestureNavigationSuppressClickUntilRef = useRef(0);');
    expect(currentSelectBody).toContain('gestureNavigationSuppressClickRef.current');
    expect(currentSelectBody).toContain('Date.now() <= gestureNavigationSuppressClickUntilRef.current');
    expect(currentSelectBody).toContain("gestureNavStateRef.current?.phase === 'expanded'");
    expect(currentSelectBody).toContain('setDrawerOpen(false);');
    expect(main).toContain('gestureNavigationSuppressClickRef.current = true;');
    expect(main).toContain('gestureNavigationSuppressClickRef.current = false;');
    expect(main).toContain('gestureNavigationSuppressClickUntilRef.current = 0;');
    expect(main).toMatch(
      /gestureNavigationSuppressClickUntilRef\.current =\s*Date\.now\(\) \+ GESTURE_NAV_SYNTHETIC_CLICK_SUPPRESS_MS/,
    );
  });

  test('keeps chat centered between preview and settings when the gesture pill expands', () => {
    const main = readMain();
    const pillStart = main.indexOf('className="gesture-nav-pill"');
    const pillEnd = main.indexOf('className="floating-nav-group"', pillStart);
    const pillBody = main.slice(pillStart, pillEnd);
    const previewIndex = pillBody.indexOf('codicon-layout-sidebar-right');
    const currentButtonIndex = pillBody.indexOf('className="gesture-nav-button gesture-nav-current-button"');
    const settingsIndex = pillBody.indexOf('codicon-settings-gear');

    expect(previewIndex).toBeGreaterThan(-1);
    expect(currentButtonIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(previewIndex).toBeLessThan(currentButtonIndex);
    expect(currentButtonIndex).toBeLessThan(settingsIndex);
    expect(pillBody).not.toContain('gesture-nav-capsule-drawer');
    expect(pillBody).not.toContain('aria-hidden={gestureNavigationExpanded}');
    expect(pillBody).not.toContain('tabIndex={gestureNavigationExpanded ? -1 : undefined}');
  });
});
