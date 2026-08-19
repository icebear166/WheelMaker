import {
  FLOATING_CONTROL_COMPOSER_GAP_PX,
  FLOATING_CONTROL_DEFAULT_Y_RATIO,
  FLOATING_CONTROL_SIDE_HYSTERESIS_PX,
  floatingControlTopFromYRatio,
  floatingControlYRatioFromLegacySlot,
  floatingControlYRatioFromTop,
  resolveFloatingControlAvoidanceBounds,
  resolveFloatingControlDefaultBounds,
  resolveFloatingControlYRatioForBoundsChange,
  resolveFloatingControlYRatioForStableTop,
  resolveFloatingControlDragSide,
  sanitizeFloatingControlYRatio,
} from '../web/src/shell/layouts/mobile/floatingControls';
import {MOBILE_HAPTIC_LIGHT_MS, triggerMobileHaptic} from '../web/src/shell/layouts/mobile/mobileHaptics';
import {LAYOUT_MODE_BREAKPOINT_PX, resolveLayoutMode} from '../web/src/shell/state/responsiveLayout';
import {
  DESKTOP_SIDEBAR_WIDTH_DEFAULT,
  DESKTOP_SIDEBAR_WIDTH_MAX,
  DESKTOP_SIDEBAR_WIDTH_MIN,
  createWorkspaceUiState,
  workspaceUiReducer,
} from '../web/src/shell/state/workspaceUiState';
import {sortProjectsByPin, togglePinnedProjectId} from '../web/src/workspace/projectNavigation';

describe('responsive UI state', () => {
  test('keeps mobile floating controls on the intended side of the hysteresis band', () => {
    expect(FLOATING_CONTROL_SIDE_HYSTERESIS_PX).toBe(24);
    expect(resolveFloatingControlDragSide('right', 377, 800)).toBe('right');
    expect(resolveFloatingControlDragSide('right', 375, 800)).toBe('left');
    expect(resolveFloatingControlDragSide('left', 423, 800)).toBe('left');
    expect(resolveFloatingControlDragSide('left', 425, 800)).toBe('right');
  });

  test('stores floating control position as a continuous clamped ratio', () => {
    expect(FLOATING_CONTROL_DEFAULT_Y_RATIO).toBe(0.25);
    expect(FLOATING_CONTROL_COMPOSER_GAP_PX).toBe(12);
    expect(sanitizeFloatingControlYRatio(-0.4)).toBe(0);
    expect(sanitizeFloatingControlYRatio(1.4)).toBe(1);
    expect(sanitizeFloatingControlYRatio(Number.NaN)).toBe(0.25);
    expect(floatingControlTopFromYRatio(0.4, 10, 210)).toBe(90);
    expect(floatingControlYRatioFromTop(90, 10, 210)).toBe(0.4);
    expect(floatingControlYRatioFromTop(999, 10, 210)).toBe(1);
    expect(
      resolveFloatingControlYRatioForStableTop({previousTop: 90, minTop: 10, maxTop: 310, fallbackRatio: 0.4}),
    ).toBeCloseTo(0.2667, 4);
    expect(
      resolveFloatingControlYRatioForBoundsChange({previousTop: 260, minTop: 10, maxTop: 310, fallbackRatio: 0.4}),
    ).toBeCloseTo(0.8333, 4);
    expect(floatingControlYRatioFromLegacySlot('upper')).toBe(0);
    expect(floatingControlYRatioFromLegacySlot('upper-middle')).toBe(0.25);
    expect(floatingControlYRatioFromLegacySlot('center')).toBe(0.5);
    expect(floatingControlYRatioFromLegacySlot('lower-middle')).toBe(0.75);
    expect(floatingControlYRatioFromLegacySlot('lower')).toBe(1);
    expect(floatingControlYRatioFromLegacySlot('invalid')).toBeNull();
  });

  test('reserves composer, keyboard, and expanded-card bounds without negative overflow', () => {
    const defaultBounds = resolveFloatingControlDefaultBounds({
      viewportHeight: 800,
      stackHeight: 184,
      safeAreaTopInset: 0,
      safeAreaBottomInset: 0,
      defaultComposerTop: 620,
    });
    expect(defaultBounds).toEqual({minTop: 6, maxTop: 424});
    expect(resolveFloatingControlAvoidanceBounds({
      defaultBounds,
      viewportHeight: 800,
      keyboardOffset: 240,
      stackHeight: 184,
      safeAreaBottomInset: 0,
      composerTop: null,
    })).toEqual({minTop: 6, maxTop: 370});
    expect(resolveFloatingControlAvoidanceBounds({
      defaultBounds,
      viewportHeight: 800,
      keyboardOffset: 0,
      stackHeight: 184,
      safeAreaBottomInset: 0,
      composerTop: 560,
    })).toEqual({minTop: 6, maxTop: 364});
    expect(resolveFloatingControlAvoidanceBounds({
      defaultBounds: {minTop: 6, maxTop: 746},
      viewportHeight: 800,
      keyboardOffset: 0,
      stackHeight: 48,
      safeAreaBottomInset: 0,
      composerTop: null,
      reservedBottomInset: 64,
    })).toEqual({minTop: 6, maxTop: 688});

    const withoutOverflow = resolveFloatingControlDefaultBounds({
      viewportHeight: 800,
      stackHeight: 48,
      safeAreaTopInset: 20,
      safeAreaBottomInset: 0,
      defaultComposerTop: null,
    });
    const withOverflow = resolveFloatingControlDefaultBounds({
      viewportHeight: 800,
      stackHeight: 48,
      safeAreaTopInset: 20,
      safeAreaBottomInset: 0,
      defaultComposerTop: null,
      expandedOverflowPx: 224,
    });
    expect(withOverflow.minTop).toBe(withoutOverflow.minTop + 224);
    expect(withOverflow.maxTop).toBe(withoutOverflow.maxTop);
    expect(resolveFloatingControlDefaultBounds({
      viewportHeight: 800,
      stackHeight: 48,
      safeAreaTopInset: 20,
      safeAreaBottomInset: 0,
      defaultComposerTop: null,
      expandedOverflowPx: -10,
    }).minTop).toBe(26);
  });

  test('uses a best-effort mobile haptic helper around navigator vibration', () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      const vibrate = jest.fn();
      Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {vibrate}});
      triggerMobileHaptic();
      triggerMobileHaptic(8);
      expect(vibrate).toHaveBeenNthCalledWith(1, MOBILE_HAPTIC_LIGHT_MS);
      expect(vibrate).toHaveBeenNthCalledWith(2, 8);

      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {vibrate: () => { throw new Error('unsupported'); }},
      });
      expect(() => triggerMobileHaptic()).not.toThrow();
      Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {}});
      expect(() => triggerMobileHaptic()).not.toThrow();
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else delete (globalThis as {navigator?: unknown}).navigator;
    }
  });

  test('switches layout mode at the shell breakpoint', () => {
    expect(LAYOUT_MODE_BREAKPOINT_PX).toBe(900);
    expect(resolveLayoutMode(899)).toBe('mobile');
    expect(resolveLayoutMode(900)).toBe('desktop');
    expect(resolveLayoutMode(1200)).toBe('desktop');
  });

  test('normalizes shared, desktop, mobile, and transient reducer state', () => {
    expect(DESKTOP_SIDEBAR_WIDTH_DEFAULT).toBe(380);
    expect(DESKTOP_SIDEBAR_WIDTH_MIN).toBe(320);
    expect(DESKTOP_SIDEBAR_WIDTH_MAX).toBe(560);
    let state = createWorkspaceUiState({
      settingsOpen: true,
      sidebarCollapsed: true,
      desktopSidebarWidth: 420,
      drawerOpen: true,
      collapsedProjectIds: ['project-a', 'project-b', 'project-a'],
      pinnedProjectIds: ['project-c', 'project-a', 'project-c'],
      hiddenProjectIds: ['project-b', 'project-a', 'project-b'],
      expandedHubIds: ['hub-a', 'hub-b', 'hub-a'],
      hubColors: {'hub-a': '#00A6A6', 'hub-b': 'red'},
      floatingControlYRatio: 0.42,
      floatingControlSide: 'left',
      chatKeyboardInset: 120,
      floatingKeyboardOffset: 120,
    });

    expect(state.shared).toMatchObject({
      settingsOpen: true,
      collapsedProjectIds: ['project-a', 'project-b'],
      pinnedProjectIds: ['project-c', 'project-a'],
      hiddenProjectIds: ['project-b', 'project-a'],
      expandedHubIds: ['hub-a', 'hub-b'],
      hubColors: {'hub-a': '#00a6a6'},
    });
    expect(state.desktop).toMatchObject({sidebarCollapsed: true, sidebarWidth: 420});
    expect(state.mobile).toMatchObject({drawerOpen: true, floatingControlYRatio: 0.42, floatingControlSide: 'left'});
    expect(state.transient).toEqual({chatKeyboardInset: 120, floatingKeyboardOffset: 120});
    expect(createWorkspaceUiState({desktopSidebarWidth: 200}).desktop.sidebarWidth).toBe(320);
    expect(createWorkspaceUiState({desktopSidebarWidth: 700}).desktop.sidebarWidth).toBe(560);
    expect(createWorkspaceUiState({floatingControlSide: 'invalid'}).mobile.floatingControlSide).toBe('right');
    expect(createWorkspaceUiState({floatingControlYRatio: 3}).mobile.floatingControlYRatio).toBe(1);

    state = workspaceUiReducer(state, {type: 'layout/modeChanged', from: 'mobile', to: 'desktop'});
    expect(state.mobile.drawerOpen).toBe(false);
    expect(state.transient).toEqual({chatKeyboardInset: 0, floatingKeyboardOffset: 0});
    state = workspaceUiReducer(state, {type: 'shared/setPinnedProjectIds', next: ['project-b', 'project-b', 'project-c']});
    expect(state.shared.pinnedProjectIds).toEqual(['project-b', 'project-c']);
    state = workspaceUiReducer(state, {type: 'shared/setHiddenProjectIds', next: ['project-d', 'project-d', 'project-a']});
    expect(state.shared.hiddenProjectIds).toEqual(['project-d', 'project-a']);
    state = workspaceUiReducer(state, {type: 'shared/setExpandedHubIds', next: ['hub-c', 'hub-c', 'hub-a']});
    expect(state.shared.expandedHubIds).toEqual(['hub-c', 'hub-a']);
    state = workspaceUiReducer(state, {type: 'shared/setHubColors', next: {'hub-c': '#ABCDEF', 'hub-d': 'red'}});
    expect(state.shared.hubColors).toEqual({'hub-c': '#abcdef'});
    state = workspaceUiReducer(state, {type: 'desktop/setSidebarWidth', next: 999});
    expect(state.desktop.sidebarWidth).toBe(560);
  });

  test('sorts pinned projects before unpinned projects while preserving order', () => {
    const projects = [
      {projectId: 'project-a', name: 'A'},
      {projectId: 'project-b', name: 'B'},
      {projectId: 'project-c', name: 'C'},
      {projectId: 'project-d', name: 'D'},
    ];
    expect(sortProjectsByPin(projects, ['project-c', 'missing', 'project-a']).map(item => item.projectId)).toEqual([
      'project-a',
      'project-c',
      'project-b',
      'project-d',
    ]);
    expect(togglePinnedProjectId(['project-a'], 'project-c')).toEqual(['project-a', 'project-c']);
    expect(togglePinnedProjectId(['project-a', 'project-c'], 'project-a')).toEqual(['project-c']);
  });
});
