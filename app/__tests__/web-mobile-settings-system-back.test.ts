import fs from 'fs';
import path from 'path';
import {
  createMobileSettingsHistoryState,
  isMobileSettingsHistoryState,
  mobileSettingsHistoryKey,
  resolveMobileSettingsPopAction,
  resolveMobileSettingsHistoryWriteAction,
} from '../web/src/shell/layouts/mobile/mobileSettingsHistory';

import {readWebStyles} from '../testHelpers/webStyles';
function readMain(): string {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

function readStyles(): string {
  return readWebStyles(path.join(__dirname, '..'));
}

describe('mobile settings system back', () => {
  test('marks and keys mobile settings history states', () => {
    const root = createMobileSettingsHistoryState(null);
    const skills = createMobileSettingsHistoryState('skills');

    expect(isMobileSettingsHistoryState(root)).toBe(true);
    expect(isMobileSettingsHistoryState(skills)).toBe(true);
    expect(isMobileSettingsHistoryState({})).toBe(false);
    expect(mobileSettingsHistoryKey(null)).toBe('mobile-settings:root');
    expect(mobileSettingsHistoryKey('skills')).toBe('mobile-settings:skills');
    expect(mobileSettingsHistoryKey('skillDetail')).toBe('mobile-settings:skillDetail');
  });

  test('resolves native back actions for settings layers', () => {
    expect(resolveMobileSettingsPopAction({
      nextState: createMobileSettingsHistoryState(null),
      settingsOpen: true,
      settingsDetailView: 'skills',
    })).toBe('close-settings');

    expect(resolveMobileSettingsPopAction({
      nextState: createMobileSettingsHistoryState(null),
      settingsOpen: true,
      settingsDetailView: 'connectionStatus',
    })).toBe('back-to-root');

    expect(resolveMobileSettingsPopAction({
      nextState: createMobileSettingsHistoryState(null),
      settingsOpen: true,
      settingsDetailView: 'database',
    })).toBe('back-to-root');

    expect(resolveMobileSettingsPopAction({
      nextState: null,
      settingsOpen: true,
      settingsDetailView: null,
    })).toBe('close-settings');

    expect(resolveMobileSettingsPopAction({
      nextState: createMobileSettingsHistoryState(null),
      settingsOpen: true,
      settingsDetailView: null,
    })).toBe('none');

    expect(resolveMobileSettingsPopAction({
      nextState: null,
      settingsOpen: false,
      settingsDetailView: null,
    })).toBe('none');
  });

  test('replaces history when switching between mobile settings details', () => {
    expect(resolveMobileSettingsHistoryWriteAction({
      currentKey: null,
      nextDetail: null,
    })).toBe('push');

    expect(resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKey(null),
      nextDetail: 'skills',
    })).toBe('push');

    expect(resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKey(null),
      nextDetail: 'skills',
      replaceRootWithDetail: true,
    })).toBe('replace');

    expect(resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKey('skills'),
      nextDetail: 'portRelay',
    })).toBe('replace');

    expect(resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKey('skills'),
      nextDetail: null,
    })).toBe('replace');

    expect(resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKey('skills'),
      nextDetail: 'skills',
    })).toBe('none');

    expect(resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKey('skills'),
      nextDetail: 'skillDetail',
    })).toBe('push');
  });

  test('wires mobile settings to history and mobile title actions', () => {
    const main = readMain();

    expect(main).toContain("} from '../shell/layouts/mobile/mobileSettingsHistory';");
    expect(main).toContain('window.history.pushState(createMobileSettingsHistoryState(settingsDetailView');
    expect(main).toContain('window.history.replaceState(createMobileSettingsHistoryState(settingsDetailView');
    expect(main).toContain('resolveMobileSettingsHistoryWriteAction({');
    expect(main).toContain('replaceRootWithDetail: mobileSettingsReplaceRootHistoryRef.current');
    expect(main).toContain("window.addEventListener('popstate', handleMobileSettingsPopState)");
    expect(main).toContain('resolveMobileSettingsPopAction({');
    expect(main).toContain('const mobileSettingsTitle = settingsDetailView');
    expect(main).toContain('const mobileSettingsActions = settingsDetailView');
    expect(main).toContain('renderSettingsContent(false, { hideDetailHeader: true })');
    expect(main).toContain('handleMobileSettingsBackButton');
    expect(main).toContain('handleMobileSettingsRootShortcut');
    expect(main).toContain('openMobileSettingsShortcutDetail');
    expect(main).toContain('const handleAndroidNativeBack = useCallback(() => {');
    expect(main).toContain('window.WheelMakerAndroidBack = {');
    expect(main).toContain('handleBack: handleAndroidNativeBack');
    expect(main).toContain('settingsPageKind(settingsDetailViewRef.current)');
    expect(main).toContain('setSettingsDetailView(nextIsMobileSettingsHistory ? nextState.detail : null);');
    expect(main).toContain('if (!isWide && sidebarSettingsOpenRef.current && mobileSettingsHistoryKeyRef.current !== null) {');
    expect(main).toContain('window.history.back();');
    expect(main).toContain('renderSettingsDetailActions(settingsDetailView)');
    expect(main).not.toContain('mobileSettingsSwipe');
  });

  test('centers the mobile settings title independently from title bar actions', () => {
    const styles = readStyles();

    const navBlock = styles.match(/\.mobile-settings-nav \{[\s\S]*?\n\}/)?.[0] ?? '';
    const titleBlock = styles.match(/\.mobile-settings-title \{[\s\S]*?\n\}/)?.[0] ?? '';
    const actionsBlock = styles.match(/\.mobile-settings-actions \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(navBlock).toContain('position: relative;');
    expect(navBlock).toContain('height: calc(var(--wm-safe-area-top) + 52px);');
    expect(navBlock).toContain('align-items: center;');
    expect(navBlock).toContain('padding: var(--wm-safe-area-top) 12px 0;');
    expect(titleBlock).toContain('position: absolute;');
    expect(titleBlock).toContain('left: 50%;');
    expect(titleBlock).toContain('top: calc(var(--wm-safe-area-top) + 26px);');
    expect(titleBlock).toContain('transform: translate(-50%, -50%);');
    expect(actionsBlock).toContain('position: relative;');
    expect(actionsBlock).toContain('z-index: 1;');
  });
});
