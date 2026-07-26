import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web responsive ui state', () => {
  test('resolves mobile floating control side with a center hysteresis band', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'shell', 'layouts', 'mobile', 'floatingControls.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      FLOATING_CONTROL_SIDE_HYSTERESIS_PX,
      resolveFloatingControlDragSide,
    } = require(modulePath);

    expect(FLOATING_CONTROL_SIDE_HYSTERESIS_PX).toBe(24);
    expect(resolveFloatingControlDragSide('right', 377, 800)).toBe('right');
    expect(resolveFloatingControlDragSide('right', 375, 800)).toBe('left');
    expect(resolveFloatingControlDragSide('left', 423, 800)).toBe('left');
    expect(resolveFloatingControlDragSide('left', 425, 800)).toBe('right');
  });

  test('stores mobile floating control height as a continuous clamped ratio', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'shell', 'layouts', 'mobile', 'floatingControls.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      FLOATING_CONTROL_DEFAULT_Y_RATIO,
      FLOATING_CONTROL_COMPOSER_GAP_PX,
      floatingControlTopFromYRatio,
      floatingControlYRatioFromLegacySlot,
      floatingControlYRatioFromTop,
      resolveFloatingControlAvoidanceBounds,
      resolveFloatingControlDefaultBounds,
      resolveFloatingControlYRatioForBoundsChange,
      resolveFloatingControlYRatioForStableTop,
      sanitizeFloatingControlYRatio,
    } = require(modulePath);

    expect(FLOATING_CONTROL_DEFAULT_Y_RATIO).toBe(0.25);
    expect(FLOATING_CONTROL_COMPOSER_GAP_PX).toBe(12);
    expect(sanitizeFloatingControlYRatio(-0.4)).toBe(0);
    expect(sanitizeFloatingControlYRatio(1.4)).toBe(1);
    expect(sanitizeFloatingControlYRatio(Number.NaN)).toBe(0.25);
    expect(floatingControlTopFromYRatio(0.4, 10, 210)).toBe(90);
    expect(floatingControlYRatioFromTop(90, 10, 210)).toBe(0.4);
    expect(floatingControlYRatioFromTop(999, 10, 210)).toBe(1);
    const stableExpandedRatio = resolveFloatingControlYRatioForStableTop({
      previousTop: 90,
      minTop: 10,
      maxTop: 310,
      fallbackRatio: 0.4,
    });
    expect(floatingControlTopFromYRatio(stableExpandedRatio, 10, 310)).toBe(90);
    expect(resolveFloatingControlYRatioForStableTop({
      previousTop: 999,
      minTop: 10,
      maxTop: 310,
      fallbackRatio: 0.4,
    })).toBe(1);
    expect(resolveFloatingControlYRatioForBoundsChange({
      previousTop: 260,
      minTop: 10,
      maxTop: 310,
      fallbackRatio: 0.4,
    })).toBeCloseTo(0.8333, 4);
    expect(resolveFloatingControlYRatioForBoundsChange({
      previousTop: 90,
      minTop: 10,
      maxTop: 310,
      fallbackRatio: 0.4,
    })).toBeCloseTo(0.2667, 4);
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
      defaultBounds,
      viewportHeight: 800,
      keyboardOffset: 0,
      stackHeight: 184,
      safeAreaBottomInset: 0,
      composerTop: null,
    })).toEqual(defaultBounds);
    expect(floatingControlYRatioFromLegacySlot('upper')).toBe(0);
    expect(floatingControlYRatioFromLegacySlot('upper-middle')).toBe(0.25);
    expect(floatingControlYRatioFromLegacySlot('center')).toBe(0.5);
    expect(floatingControlYRatioFromLegacySlot('lower-middle')).toBe(0.75);
    expect(floatingControlYRatioFromLegacySlot('lower')).toBe(1);
    expect(floatingControlYRatioFromLegacySlot('invalid')).toBeNull();
  });

  test('reserves expanded overflow above the docked control', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'shell', 'layouts', 'mobile', 'floatingControls.ts');
    const {resolveFloatingControlDefaultBounds} = require(modulePath);

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
  });

  test('never lets a negative overflow shrink the minimum top', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'shell', 'layouts', 'mobile', 'floatingControls.ts');
    const {resolveFloatingControlDefaultBounds} = require(modulePath);

    const bounds = resolveFloatingControlDefaultBounds({
      viewportHeight: 800,
      stackHeight: 48,
      safeAreaTopInset: 20,
      safeAreaBottomInset: 0,
      defaultComposerTop: null,
      expandedOverflowPx: -10,
    });
    expect(bounds.minTop).toBe(26);
  });


  test('uses a best-effort mobile haptic helper around navigator vibration', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'shell', 'layouts', 'mobile', 'mobileHaptics.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      MOBILE_HAPTIC_LIGHT_MS,
      triggerMobileHaptic,
    } = require(modulePath);
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    try {
      const vibrate = jest.fn();
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { vibrate },
      });
      triggerMobileHaptic();
      triggerMobileHaptic(8);
      expect(vibrate).toHaveBeenNthCalledWith(1, MOBILE_HAPTIC_LIGHT_MS);
      expect(vibrate).toHaveBeenNthCalledWith(2, 8);

      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { vibrate: () => { throw new Error('unsupported'); } },
      });
      expect(() => triggerMobileHaptic()).not.toThrow();

      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {},
      });
      expect(() => triggerMobileHaptic()).not.toThrow();
    } finally {
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      } else {
        delete (globalThis as { navigator?: unknown }).navigator;
      }
    }
  });

  test('centralizes viewport layout mode resolution at the 900px shell breakpoint', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'shell', 'state', 'responsiveLayout.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      LAYOUT_MODE_BREAKPOINT_PX,
      resolveLayoutMode,
    } = require(modulePath);

    expect(LAYOUT_MODE_BREAKPOINT_PX).toBe(900);
    expect(resolveLayoutMode(899)).toBe('mobile');
    expect(resolveLayoutMode(900)).toBe('desktop');
    expect(resolveLayoutMode(1200)).toBe('desktop');
  });

  test('keeps shared, desktop, mobile, and transient ui state under one reducer', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'shell', 'state', 'workspaceUiState.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      DESKTOP_SIDEBAR_WIDTH_DEFAULT,
      DESKTOP_SIDEBAR_WIDTH_MAX,
      DESKTOP_SIDEBAR_WIDTH_MIN,
      createWorkspaceUiState,
      workspaceUiReducer,
    } = require(modulePath);

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
      hubColors: {
        'hub-a': '#00A6A6',
        'hub-b': 'red',
      },
      floatingControlYRatio: 0.42,
      floatingControlSide: 'left',
      chatKeyboardInset: 120,
      floatingKeyboardOffset: 120,
      floatingDragState: {
        active: true,
        pressing: false,
        pointerId: 1,
        originY: 10,
        startTop: 40,
        currentTop: 80,
        cooldownUntil: 0,
      },
    });

    expect(state.shared).toMatchObject({
      settingsOpen: true,
      collapsedProjectIds: ['project-a', 'project-b'],
      pinnedProjectIds: ['project-c', 'project-a'],
      hiddenProjectIds: ['project-b', 'project-a'],
      expandedHubIds: ['hub-a', 'hub-b'],
      hubColors: {'hub-a': '#00a6a6'},
    });
    expect(state.desktop).toMatchObject({
      sidebarCollapsed: true,
      sidebarWidth: 420,
    });
    expect(createWorkspaceUiState({ desktopSidebarWidth: 200 }).desktop.sidebarWidth).toBe(320);
    expect(createWorkspaceUiState({ desktopSidebarWidth: 700 }).desktop.sidebarWidth).toBe(560);
    expect(state.mobile).toMatchObject({
      drawerOpen: true,
      floatingControlYRatio: 0.42,
      floatingControlSide: 'left',
    });
    expect(createWorkspaceUiState({ floatingControlSide: 'invalid' }).mobile.floatingControlSide).toBe('right');
    expect(createWorkspaceUiState({ floatingControlYRatio: 3 }).mobile.floatingControlYRatio).toBe(1);
    expect(createWorkspaceUiState({ floatingControlIdleOpacity: 0.02 }).mobile).not.toHaveProperty('floatingControlIdleOpacity');

    state = workspaceUiReducer(state, {
      type: 'layout/modeChanged',
      from: 'mobile',
      to: 'desktop',
    });

    expect(state.shared.settingsOpen).toBe(true);
    expect(state.shared.collapsedProjectIds).toEqual(['project-a', 'project-b']);
    expect(state.shared.pinnedProjectIds).toEqual(['project-c', 'project-a']);
    expect(state.shared.hiddenProjectIds).toEqual(['project-b', 'project-a']);
    expect(state.shared.expandedHubIds).toEqual(['hub-a', 'hub-b']);
    expect(state.shared.hubColors).toEqual({'hub-a': '#00a6a6'});
    expect(state.desktop.sidebarCollapsed).toBe(true);
    expect(state.desktop.sidebarWidth).toBe(420);
    expect(state.mobile.floatingControlYRatio).toBe(0.42);
    expect(state.mobile.floatingControlSide).toBe('left');
    expect(state.mobile.drawerOpen).toBe(false);
    expect(state.transient.chatKeyboardInset).toBe(0);
    expect(state.transient.floatingKeyboardOffset).toBe(0);
    expect(state.transient).not.toHaveProperty('floatingDragState');

    state = workspaceUiReducer(state, {
      type: 'shared/setPinnedProjectIds',
      next: ['project-b', 'project-b', 'project-c'],
    });

    expect(state.shared.pinnedProjectIds).toEqual(['project-b', 'project-c']);

    state = workspaceUiReducer(state, {
      type: 'shared/setHiddenProjectIds',
      next: ['project-d', 'project-d', 'project-a'],
    });

    expect(state.shared.hiddenProjectIds).toEqual(['project-d', 'project-a']);

    state = workspaceUiReducer(state, {
      type: 'shared/setExpandedHubIds',
      next: ['hub-c', 'hub-c', 'hub-a'],
    });

    expect(state.shared.expandedHubIds).toEqual(['hub-c', 'hub-a']);

    state = workspaceUiReducer(state, {
      type: 'shared/setHubColors',
      next: {'hub-c': '#ABCDEF', 'hub-d': 'red'},
    });

    expect(state.shared.hubColors).toEqual({'hub-c': '#abcdef'});

    state = workspaceUiReducer(state, {
      type: 'mobile/setFloatingControlSide',
      next: 'right',
    });

    expect(state.mobile.floatingControlSide).toBe('right');

    state = workspaceUiReducer(state, {
      type: 'mobile/setFloatingControlYRatio',
      next: 0.83,
    });

    expect(state.mobile.floatingControlYRatio).toBe(0.83);

    expect(String(workspaceUiReducer)).not.toContain('mobile/setFloatingControlIdleOpacity');

    state = workspaceUiReducer(state, {
      type: 'desktop/setSidebarWidth',
      next: 999,
    });

    expect(state.desktop.sidebarWidth).toBe(560);
  });

  test('sorts pinned projects above unpinned projects while preserving registry order', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'workspace', 'projectNavigation.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      sortProjectsByPin,
      togglePinnedProjectId,
    } = require(modulePath);

    const projects = [
      { projectId: 'project-a', name: 'A' },
      { projectId: 'project-b', name: 'B' },
      { projectId: 'project-c', name: 'C' },
      { projectId: 'project-d', name: 'D' },
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

  test('main web app uses the responsive layout and workspace ui state modules', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    expect(mainTsx).toContain("from '../shell/state/responsiveLayout'");
    expect(mainTsx).toContain("from '../shell/state/workspaceUiState'");
    expect(mainTsx).toContain('const layoutMode = resolveLayoutMode(windowWidth);');
    expect(mainTsx).toContain("const isWide = layoutMode === 'desktop';");
    expect(mainTsx).toContain('const [workspaceUiState, dispatchWorkspaceUi] = useReducer(');
    expect(mainTsx).toContain('collapsedProjectIds: globalState.collapsedProjectIds ?? globalState.desktopCollapsedProjectIds ?? []');
    expect(mainTsx).toContain('desktopSidebarWidth: globalState.desktopSidebarWidth');
    expect(mainTsx).toContain('pinnedProjectIds: globalState.pinnedProjectIds ?? []');
    expect(mainTsx).toContain('hiddenProjectIds: globalState.hiddenProjectIds ?? []');
    expect(mainTsx).toContain('expandedHubIds: globalState.expandedHubIds ?? []');
    expect(mainTsx).toContain('hubColors: globalState.hubColors ?? {}');
    expect(mainTsx).toContain('floatingControlSide: globalState.floatingControlSide ?? readPortRelayFloatingSide() ?? \'right\'');
    expect(mainTsx).not.toContain('floatingControlIdleOpacity: globalState.floatingControlIdleOpacity,');
    expect(mainTsx).toContain('floatingControlYRatio,\n      floatingControlSide,\n      desktopSidebarWidth,');
    expect(mainTsx).toContain('const desktopSidebarWidth = workspaceUiState.desktop.sidebarWidth;');
    expect(mainTsx).not.toContain('const floatingControlIdleOpacity = workspaceUiState.mobile.floatingControlIdleOpacity;');
    expect(mainTsx).toContain('const collapsedProjectIds = workspaceUiState.shared.collapsedProjectIds;');
    expect(mainTsx).toContain('const pinnedProjectIds = workspaceUiState.shared.pinnedProjectIds;');
    expect(mainTsx).toContain('const hiddenProjectIds = workspaceUiState.shared.hiddenProjectIds;');
    expect(mainTsx).toContain('const expandedHubIds = workspaceUiState.shared.expandedHubIds;');
    expect(mainTsx).toContain('const hubColors = workspaceUiState.shared.hubColors;');
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'desktop/setSidebarWidth', next });");
    expect(mainTsx).not.toContain("dispatchWorkspaceUi({ type: 'mobile/setFloatingControlIdleOpacity', next });");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'shared/setCollapsedProjectIds', next });");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'shared/setPinnedProjectIds', next });");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'shared/setHiddenProjectIds', next });");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'shared/setExpandedHubIds', next });");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'shared/setHubColors', next });");
    expect(mainTsx).toContain('const visibleProjectItems = visibility.visibleProjects;');
    expect(mainTsx).toContain('const hiddenProjectItems = visibility.hiddenProjects;');
    expect(mainTsx).toContain('className="chat-hidden-project-row"');
    expect(mainTsx).toContain('className={`chat-hub-tree${expanded ? \' expanded\' : \'\'}${colorMenuOpen ? \' color-open\' : \'\'}`}');
  });

  test('keeps mobile drawer open while toggling hub project visibility', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    expect(mainTsx).toContain('options?: {keepMobileDrawerOpen?: boolean}');
    expect(mainTsx).toContain("if (!isWide && options?.keepMobileDrawerOpen !== true) setDrawerOpen(false);");
    expect(mainTsx).toContain("options?: {reason?: 'chat' | 'manual'; keepMobileDrawerOpen?: boolean}");
    expect(mainTsx).toContain('keepMobileDrawerOpen: options?.keepMobileDrawerOpen,');
    expect(mainTsx).toContain("syncWorkspaceProject(nextProject.projectId, {reason: 'chat', keepMobileDrawerOpen: chatHubMenuOpen}).catch(() => undefined);");
    expect(mainTsx).toContain('onClick={event => {');
    expect(mainTsx).toContain('event.stopPropagation();');
    expect(mainTsx).toContain('toggleProjectVisibility(current, projectItem.projectId, !visible)');
    expect(mainTsx).not.toContain("syncWorkspaceProject(nextProject.projectId, {reason: 'chat'}).catch(() => undefined);");
  });

  test('renders hub display preferences with compact dot color controls', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');
    const stylesCss = readWebStyles(projectRoot);

    const colorButtonIndex = mainTsx.indexOf('className="chat-hub-color-button"');
    const hubNameIndex = mainTsx.indexOf('<span className="chat-hub-row-name">{hub.hubId}</span>', colorButtonIndex);
    expect(colorButtonIndex).toBeGreaterThanOrEqual(0);
    expect(hubNameIndex).toBeGreaterThanOrEqual(0);
    expect(hubNameIndex).toBeGreaterThan(colorButtonIndex);
    expect(mainTsx).toContain('className="chat-hub-color-dot"');
    expect(mainTsx).toContain('className="chat-hub-expand-button"');
    expect(mainTsx).not.toContain('chat-hub-read-tag');
    expect(mainTsx).not.toContain('className="chat-hub-color-trigger"');
    expect(mainTsx).not.toContain('className={`chat-hub-visibility-check ${visibilityState}`}');
    expect(mainTsx).not.toContain("const hubEnabled = visibilityState !== 'unchecked';");
    expect(mainTsx).not.toContain('const visibilityState = resolveHubVisibilityState(treeItem.projects, hiddenProjectIds);');
    expect(mainTsx).not.toContain('const hubToggleLabel = hubEnabled');
    expect(mainTsx).toContain('className={`chat-hub-tree${expanded ? \' expanded\' : \'\'}${colorMenuOpen ? \' color-open\' : \'\'}`}');
    expect(mainTsx).toContain("className={`chat-hub-project-row${visible ? '' : ' hidden'}`}");
    expect(mainTsx).toContain('className="chat-hub-project-check"');
    expect(mainTsx).toContain('style={hubAccentStyle(hub.hubId)}');
    expect(mainTsx).not.toContain('className="chat-hub-disclosure"');
    expect(mainTsx).not.toContain('className={`chat-hub-visibility-cube');
    expect(mainTsx).not.toContain('aria-pressed={hubEnabled}');
    expect(mainTsx).not.toContain('toggleHubVisibility(current, treeItem.projects');
    expect(mainTsx).toContain('resolveHubColor,');
    expect(mainTsx).toContain('resolveHubColorVariantIndex,');
    expect(mainTsx).toContain("if (prefix === 'wide-project-hub') {");
    expect(mainTsx).not.toContain('token-stats-pill-hub');
    expect(mainTsx).toContain('return `${prefix}-${resolveHubColorVariantIndex(normalized)}`;');
    expect(mainTsx).toContain('const color = resolveHubColor(hubColors, hubId);');
    expect(mainTsx).toContain('const currentHubColor = resolveHubColor(hubColors, hub.hubId);');
    expect(mainTsx).toContain("style={{'--swatch-color': color} as React.CSSProperties}");
    expect(mainTsx).not.toContain('className="chat-hub-color-toolbar"');
    expect(mainTsx).not.toContain('className="chat-hub-color-title"');
    expect(mainTsx).not.toContain('>Hub color</span>');
    expect(mainTsx).toContain('const defaultHubColor = resolveDefaultHubColor(hub.hubId);');
    expect(mainTsx).toContain('const defaultSwatch = color === defaultHubColor;');
    expect(mainTsx).toContain("className={`chat-hub-color-swatch${currentHubColor === color ? ' selected' : ''}${defaultSwatch ? ' default' : ''}`}");
    expect(mainTsx).toContain("setHubColorPreference(current, hub.hubId, defaultSwatch ? '' : color)");
    expect(mainTsx).toContain('{defaultSwatch ? <span className="chat-hub-color-default-badge" aria-hidden="true">D</span> : null}');
    expect(mainTsx).not.toContain('className="chat-hub-color-actions"');
    expect(mainTsx).not.toContain('className={`chat-hub-color-default');
    expect(mainTsx).not.toContain('className="chat-hub-color-default-swatch"');
    expect(mainTsx).not.toContain('style={hubDefaultAccentStyle(hub.hubId)}');
    expect(mainTsx).toContain('className="chat-hub-color-custom"');
    expect(mainTsx).toContain('className="chat-hub-color-custom-header"');
    expect(mainTsx).toContain('className="chat-hub-color-custom-preview"');
    expect(mainTsx).toContain('className="chat-hub-color-sv"');
    expect(mainTsx).toContain('className="chat-hub-color-sv-thumb"');
    expect(mainTsx).toContain('className="chat-hub-color-hue"');
    expect(mainTsx).toContain('className="chat-hub-color-hue-thumb"');
    expect(mainTsx).toContain('applyHubColorSvPointer(hub.hubId, currentHubHsv, event)');
    expect(mainTsx).toContain('applyHubColorHuePointer(hub.hubId, currentHubHsv, event)');
    expect(mainTsx).not.toContain('type="color"');
    expect(mainTsx).not.toContain('className={`chat-hub-color-mode chat-hub-color-custom');
    expect(mainTsx).toContain('!chatHubMenuRef.current?.contains(target) &&');
    expect(mainTsx).toContain('!chatHubPopoverRef.current?.contains(target)');
    expect(mainTsx).toContain('const [chatHubColorMenu, setChatHubColorMenu, chatHubColorMenuExiting] = useMenuExitState<{hubId: string}>();');
    expect(mainTsx).toContain('setChatHubColorMenu(null);');
    expect(mainTsx).not.toContain('chat-hub-color-square');

    const popoverBlock = Array.from(stylesCss.matchAll(/\.chat-hub-popover \{[\s\S]*?\n\}/g))
      .map(match => match[0])
      .find(block => block.includes('position: fixed;')) ?? '';
    expect(popoverBlock).toContain('width: min(340px, calc(100vw - 24px));');
    expect(popoverBlock).toContain('min-width: 0;');
    expect(popoverBlock).toContain('--chat-hub-popover-viewport-offset: 96px;');
    expect(popoverBlock).toContain('max-height: calc(100vh - var(--chat-hub-popover-viewport-offset));');
    expect(popoverBlock).toContain('max-height: calc(100dvh - var(--chat-hub-popover-viewport-offset));');
    expect(popoverBlock).toContain('overflow: auto;');
    expect(popoverBlock).not.toContain('min(420px');

    const treeBlock = stylesCss.match(/(?:^|\n)\.chat-hub-tree \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(treeBlock).toContain('position: relative;');
    expect(treeBlock).not.toContain('border-left:');
    expect(treeBlock).not.toContain('--chat-hub-color-chip-width');
    expect(stylesCss).not.toContain('.chat-hub-tree.expanded .chat-hub-disclosure {');
    const colorOpenBlock = stylesCss.match(/\.chat-hub-tree\.color-open \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorOpenBlock).toContain('z-index: 3;');
    expect(stylesCss).not.toContain('.chat-hub-color-palette::before {');

    const rowBlock = stylesCss.match(/\.chat-hub-row \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(rowBlock).toContain('display: flex;');
    const expandButtonBlock = stylesCss.match(/\.chat-hub-expand-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(expandButtonBlock).toContain('flex: 1 1 auto;');
    const colorButtonBlock = stylesCss.match(/\.chat-hub-color-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorButtonBlock).toContain('width: 24px;');
    expect(colorButtonBlock).toContain('height: 24px;');
    const colorDotBlock = stylesCss.match(/\.chat-hub-color-dot \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorDotBlock).toContain('width: 8px;');
    expect(colorDotBlock).toContain('height: 8px;');

    const swatchBlock = stylesCss.match(/\.chat-hub-color-swatch \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(swatchBlock).toContain('var(--swatch-color)');
    expect(swatchBlock).toContain('background: var(--swatch-color);');
    expect(swatchBlock).toContain('width: var(--chat-hub-color-chip-width);');
    expect(swatchBlock).toContain('height: var(--chat-hub-color-chip-height);');
    expect(swatchBlock).toContain('border-radius: var(--chat-hub-color-chip-radius);');
    expect(swatchBlock).toContain('justify-self: center;');
    expect(swatchBlock).not.toContain('--hub-accent');

    expect(stylesCss).not.toContain('.chat-hub-visibility-cube');

    const paletteBlock = stylesCss.match(/\.chat-hub-color-palette \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(paletteBlock).toContain('position: absolute;');
    expect(paletteBlock).toContain('right: 0;');
    expect(paletteBlock).toContain('width: min(248px, calc(100% - 4px));');
    expect(paletteBlock).not.toContain('backdrop-filter:');

    const colorGridBlock = stylesCss.match(/\.chat-hub-color-grid \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorGridBlock).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));');

    const selectedSwatchBlock = stylesCss.match(/\.chat-hub-color-swatch\.selected \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(selectedSwatchBlock).toContain('inset 0 0 0 1px rgba(255, 255, 255, 0.24)');
    expect(selectedSwatchBlock).toContain('0 0 0 2px color-mix(in srgb, var(--surface-panel) 80%, transparent)');
    expect(selectedSwatchBlock).not.toContain('0 0 16px');
    expect(stylesCss).toContain('.chat-hub-color-swatch.selected::after {');
    const defaultBadgeBlock = stylesCss.match(/\.chat-hub-color-default-badge \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(defaultBadgeBlock).toContain('position: absolute;');
    expect(defaultBadgeBlock).toContain('left: 3px;');
    expect(defaultBadgeBlock).toContain('bottom: 2px;');

    const nativeColorInputBlock = mainTsx.match(/<input[\s\S]*?type="color"[\s\S]*?>/)?.[0] ?? '';
    expect(nativeColorInputBlock).toBe('');

    const customPickerBlock = stylesCss.match(/\.chat-hub-color-custom \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(customPickerBlock).toContain('display: grid;');
    expect(customPickerBlock).toContain('gap: 7px;');

    expect(stylesCss).not.toContain('.chat-hub-color-default {');
    expect(stylesCss).not.toContain('.chat-hub-color-default-label');
    expect(stylesCss).not.toContain('.chat-hub-color-default-swatch');
    const colorLabelBlock = stylesCss.match(/\.chat-hub-color-custom-label \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorLabelBlock).toContain('font-size: 11px;');
    expect(colorLabelBlock).toContain('font-weight: 700;');
    expect(colorLabelBlock).toContain('color: color-mix(in srgb, var(--text-primary) 86%, var(--text-secondary));');
    const customHeaderBlock = stylesCss.match(/\.chat-hub-color-custom-header \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(customHeaderBlock).toContain('grid-template-columns: minmax(0, 1fr) var(--chat-hub-color-chip-width);');
    const customPreviewBlock = stylesCss.match(/\.chat-hub-color-custom-preview \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(customPreviewBlock).toContain('width: var(--chat-hub-color-chip-width);');
    expect(customPreviewBlock).toContain('height: var(--chat-hub-color-chip-height);');
    expect(customPreviewBlock).toContain('border-radius: var(--chat-hub-color-chip-radius);');

    const svBlock = stylesCss.match(/\.chat-hub-color-sv \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(svBlock).toContain('touch-action: none;');
    expect(svBlock).toContain('aspect-ratio: 2 / 1;');
    expect(svBlock).toContain('var(--hub-custom-hue)');

    const hueBlock = stylesCss.match(/\.chat-hub-color-hue \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(hueBlock).toContain('touch-action: none;');
    expect(hueBlock).toContain('linear-gradient(to right');

    const projectListBlock = Array.from(stylesCss.matchAll(/\.chat-hub-project-list \{[\s\S]*?\n\}/g))
      .map(match => match[0])
      .find(block => block.includes('margin: 1px 0 3px 26px;')) ?? '';
    expect(projectListBlock).toContain('margin: 1px 0 3px 26px;');
    expect(projectListBlock).not.toContain('border-radius:');
    expect(projectListBlock).not.toContain('background:');
    expect(projectListBlock).not.toContain('box-shadow:');
    expect(projectListBlock).not.toContain('margin: 2px 6px 6px 30px;');
    expect(projectListBlock).not.toContain('margin: 3px 6px 6px 54px;');
    expect(projectListBlock).not.toContain('border-left:');
  });

  test('captures custom hub color before dispatching a deferred updater', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    const customColorHandlerStart = mainTsx.indexOf('const nextColor = hubHsvToColor(', mainTsx.indexOf('const applyHubColorSvPointer = useCallback('));
    expect(customColorHandlerStart).toBeGreaterThanOrEqual(0);
    const customColorHandlerEnd = mainTsx.indexOf('setHubColors(current =>', customColorHandlerStart);
    expect(customColorHandlerEnd).toBeGreaterThan(customColorHandlerStart);
    const customColorHandler = mainTsx.slice(customColorHandlerStart, customColorHandlerEnd);
    expect(customColorHandler).toContain('const nextColor = hubHsvToColor(');
    expect(customColorHandler).not.toContain('event.currentTarget.value');
  });

  test('persists desktop sidebar width as global app state', () => {
    const projectRoot = path.join(__dirname, '..');
    const persistenceTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(persistenceTs).toContain('desktopSidebarWidth: number;');
    expect(persistenceTs).toContain('hubColors: Record<string, string>;');
    expect(persistenceTs).toContain('hiddenProjectIds: string[];');
    expect(persistenceTs).toContain('expandedHubIds: string[];');
    expect(persistenceTs).toContain("export type PersistedFloatingControlSide = 'left' | 'right';");
    expect(persistenceTs).toContain('floatingControlYRatio: number;');
    expect(persistenceTs).toContain('floatingControlSide: PersistedFloatingControlSide;');
    expect(persistenceTs).not.toContain('floatingControlIdleOpacity: number;');
    expect(persistenceTs).not.toContain('useLatestPromptTitle: boolean;');
    expect(persistenceTs).toContain("desktopSidebarWidth: 'desktopSidebarWidth',");
    expect(persistenceTs).toContain("hubColors: 'hubColors',");
    expect(persistenceTs).toContain("hiddenProjectIds: 'hiddenProjectIds',");
    expect(persistenceTs).toContain("expandedHubIds: 'expandedHubIds',");
    expect(persistenceTs).toContain("floatingControlYRatio: 'floatingControlYRatio',");
    expect(persistenceTs).toContain("floatingControlSlot: 'floatingControlSlot',");
    expect(persistenceTs).toContain("floatingControlSide: 'floatingControlSide',");
    expect(persistenceTs).not.toContain("floatingControlIdleOpacity: 'floatingControlIdleOpacity',");
    expect(persistenceTs).not.toContain("useLatestPromptTitle: 'useLatestPromptTitle',");
    expect(persistenceTs).toContain('desktopSidebarWidth: 380,');
    expect(persistenceTs).toContain('hubColors: {},');
    expect(persistenceTs).toContain('hiddenProjectIds: [],');
    expect(persistenceTs).toContain('expandedHubIds: [],');
    expect(persistenceTs).toContain('floatingControlYRatio: FLOATING_CONTROL_DEFAULT_Y_RATIO,');
    expect(persistenceTs).toContain("floatingControlSide: 'right',");
    expect(persistenceTs).not.toContain('FLOATING_CONTROL_DEFAULT_IDLE_OPACITY');
    expect(persistenceTs).not.toContain('useLatestPromptTitle: false,');
    expect(persistenceTs).not.toContain('useLatestPromptTitle: typeof input.useLatestPromptTitle');
    expect(persistenceTs).toContain('desktopSidebarWidth: sanitizeDesktopSidebarWidth(input.desktopSidebarWidth, base.desktopSidebarWidth),');
    expect(persistenceTs).toContain('hubColors: sanitizeHubColorMap(input.hubColors),');
    expect(persistenceTs).toContain('hiddenProjectIds,');
    expect(persistenceTs).toContain('expandedHubIds,');
    expect(persistenceTs).toContain('floatingControlYRatio,');
    expect(persistenceTs).toContain('floatingControlSide: sanitizeFloatingControlSide(input.floatingControlSide, base.floatingControlSide),');
    expect(persistenceTs).not.toContain('sanitizeFloatingControlIdleOpacity');
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.desktopSidebarWidth, v: serialize(this.state.global.desktopSidebarWidth), updatedAt}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.hubColors, v: serialize(this.state.global.hubColors), updatedAt}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.hiddenProjectIds, v: serialize(this.state.global.hiddenProjectIds), updatedAt}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.expandedHubIds, v: serialize(this.state.global.expandedHubIds), updatedAt}',
    );
    expect(persistenceTs).not.toContain('GLOBAL_KEYS.useLatestPromptTitle');
    expect(persistenceTs).toContain('const rows = globalRowsForPatch(patch, next, now);');
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.floatingControlYRatio, v: serialize(this.state.global.floatingControlYRatio), updatedAt}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.floatingControlSide, v: serialize(this.state.global.floatingControlSide), updatedAt}',
    );
    expect(persistenceTs).not.toContain('next.floatingControlIdleOpacity');
    expect(persistenceTs).not.toContain('next.useLatestPromptTitle');
  });
});
