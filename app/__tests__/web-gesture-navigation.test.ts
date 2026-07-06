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
    expect(main).toContain('className="gesture-nav-button gesture-nav-current-button"');
    expect(main).toContain('onClick={handleGestureNavigationCurrentSelect}');
    expect(main).not.toContain('className="gesture-nav-badge"');
    expect(main).toContain('className="floating-nav-group"');
    expect(main).toContain('aria-label="Chat"');
    expect(main).toContain("codicon-comment-discussion");
    expect(main).toContain('handleGestureNavigationCurrentSelect');
    expect(main).toContain('GESTURE_MOVE_LONG_PRESS_MS');
    expect(main).toContain('className="gesture-nav-button gesture-nav-capsule gesture-nav-capsule-preview"');
    expect(main).toContain('className="gesture-nav-button gesture-nav-capsule gesture-nav-capsule-drawer"');
    expect(main).toContain('className="gesture-nav-button gesture-nav-capsule gesture-nav-capsule-settings"');
    expect(main).toContain('codicon-layout-sidebar-right');
    expect(main).toContain('codicon-settings-gear');
    expect(main).not.toContain('gesture-nav-drawer-button');
    expect(main).not.toContain('data-gesture-nav-tab');
  });

  test('styles gesture navigation as a collapsed pill and expanded vertical capsules', () => {
    const styles = readStyles();

    expect(styles).toContain('.gesture-nav-control');
    expect(styles).toContain('.gesture-nav-pill');
    expect(styles).toMatch(
      /\.gesture-nav-control \{[\s\S]*width: 50px;[\s\S]*height: 88px;[\s\S]*\}/,
    );
    expect(styles).toMatch(
      /\.gesture-nav-pill \{[\s\S]*width: 50px;[\s\S]*grid-template-rows: repeat\(2, 40px\);[\s\S]*padding: 4px;[\s\S]*\}/,
    );
    expect(styles).toContain('.gesture-nav-button');
    expect(styles).toContain('.gesture-nav-current-button');
    expect(styles).not.toContain('.gesture-nav-badge');
    expect(styles).toContain('.gesture-nav-capsule');
    expect(styles).toContain('.gesture-nav-capsule-preview');
    expect(styles).toContain('.gesture-nav-capsule-drawer');
    expect(styles).toContain('.gesture-nav-capsule-settings');
    expect(styles).toContain('gesture-pill-grow-up');
    expect(styles).toContain('gesture-pill-grow-down');
    expect(styles).not.toContain('.gesture-nav-option');
    expect(styles).not.toContain('.gesture-nav-option-chat');
    expect(styles).not.toContain('.gesture-nav-option-file');
    expect(styles).not.toContain('.gesture-nav-option-git');
    expect(styles).not.toContain('.gesture-nav-drawer-button');
  });
});
