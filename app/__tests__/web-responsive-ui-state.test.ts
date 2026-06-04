import fs from 'fs';
import path from 'path';

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
      FLOATING_CONTROL_DEFAULT_IDLE_OPACITY,
      FLOATING_CONTROL_IDLE_OPACITY_MAX,
      FLOATING_CONTROL_IDLE_OPACITY_MIN,
      FLOATING_CONTROL_COMPOSER_GAP_PX,
      floatingControlTopFromYRatio,
      floatingControlYRatioFromLegacySlot,
      floatingControlYRatioFromTop,
      resolveFloatingControlAvoidanceBounds,
      resolveFloatingControlDefaultBounds,
      resolveFloatingControlYRatioForBoundsChange,
      resolveFloatingControlYRatioForStableTop,
      sanitizeFloatingControlIdleOpacity,
      sanitizeFloatingControlYRatio,
    } = require(modulePath);

    expect(FLOATING_CONTROL_DEFAULT_Y_RATIO).toBe(0.25);
    expect(FLOATING_CONTROL_DEFAULT_IDLE_OPACITY).toBe(0.34);
    expect(FLOATING_CONTROL_IDLE_OPACITY_MIN).toBe(0.1);
    expect(FLOATING_CONTROL_IDLE_OPACITY_MAX).toBe(0.8);
    expect(FLOATING_CONTROL_COMPOSER_GAP_PX).toBe(12);
    expect(sanitizeFloatingControlYRatio(-0.4)).toBe(0);
    expect(sanitizeFloatingControlYRatio(1.4)).toBe(1);
    expect(sanitizeFloatingControlYRatio(Number.NaN)).toBe(0.25);
    expect(sanitizeFloatingControlIdleOpacity(-0.4)).toBe(0.1);
    expect(sanitizeFloatingControlIdleOpacity(1.4)).toBe(0.8);
    expect(sanitizeFloatingControlIdleOpacity(Number.NaN)).toBe(0.34);
    expect(sanitizeFloatingControlIdleOpacity(0.555)).toBe(0.56);
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
      previousHadDefaultComposerTop: false,
      nextHasDefaultComposerTop: true,
      minTop: 10,
      maxTop: 310,
      fallbackRatio: 0.4,
    })).toBe(0.4);
    expect(resolveFloatingControlYRatioForBoundsChange({
      previousTop: 90,
      previousHadDefaultComposerTop: true,
      nextHasDefaultComposerTop: true,
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

  test('keeps the chat scroll-to-bottom button above the composer and keyboard inset', () => {
    const projectRoot = path.join(__dirname, '..');
    const modulePath = path.join(projectRoot, 'web', 'src', 'services', 'chatScrollBottomButton.ts');

    expect(fs.existsSync(modulePath)).toBe(true);

    const {
      CHAT_SCROLL_BOTTOM_COMPOSER_GAP_PX,
      CHAT_SCROLL_BOTTOM_FALLBACK_OFFSET_PX,
      resolveChatScrollBottomButtonOffset,
    } = require(modulePath);

    expect(CHAT_SCROLL_BOTTOM_COMPOSER_GAP_PX).toBe(10);
    expect(CHAT_SCROLL_BOTTOM_FALLBACK_OFFSET_PX).toBe(92);
    expect(resolveChatScrollBottomButtonOffset({
      composerHeight: 84,
      keyboardInset: 0,
    })).toBe(94);
    expect(resolveChatScrollBottomButtonOffset({
      composerHeight: 128,
      keyboardInset: 240,
    })).toBe(378);
    expect(resolveChatScrollBottomButtonOffset({
      composerHeight: 0,
      keyboardInset: 240,
    })).toBe(332);
    expect(resolveChatScrollBottomButtonOffset({
      composerHeight: Number.NaN,
      keyboardInset: -20,
    })).toBe(92);
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
    expect(createWorkspaceUiState().shared.tab).toBe('chat');
    expect(createWorkspaceUiState({ tab: 'invalid' }).shared.tab).toBe('chat');
    expect(createWorkspaceUiState({ tab: 'file' }).shared.tab).toBe('file');
    expect(createWorkspaceUiState({ tab: 'git' }).shared.tab).toBe('git');

    let state = createWorkspaceUiState({
      tab: 'git',
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
      floatingControlIdleOpacity: 0.55,
      chatConfigOverflowOpen: true,
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
      tab: 'git',
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
      floatingControlIdleOpacity: 0.55,
      chatConfigOverflowOpen: true,
    });
    expect(createWorkspaceUiState({ floatingControlSide: 'invalid' }).mobile.floatingControlSide).toBe('right');
    expect(createWorkspaceUiState({ floatingControlYRatio: 3 }).mobile.floatingControlYRatio).toBe(1);
    expect(createWorkspaceUiState({ floatingControlIdleOpacity: 0.02 }).mobile.floatingControlIdleOpacity).toBe(0.1);
    expect(createWorkspaceUiState({ floatingControlIdleOpacity: 0.93 }).mobile.floatingControlIdleOpacity).toBe(0.8);

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
    expect(state.mobile.floatingControlIdleOpacity).toBe(0.55);
    expect(state.mobile.drawerOpen).toBe(false);
    expect(state.mobile.chatConfigOverflowOpen).toBe(false);
    expect(state.transient.chatKeyboardInset).toBe(0);
    expect(state.transient.floatingKeyboardOffset).toBe(0);
    expect(state.transient.floatingDragState).toBeNull();

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

    state = workspaceUiReducer(state, {
      type: 'mobile/setFloatingControlIdleOpacity',
      next: 0.74,
    });

    expect(state.mobile.floatingControlIdleOpacity).toBe(0.74);

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
    expect(mainTsx).toContain('floatingControlIdleOpacity: globalState.floatingControlIdleOpacity,');
    expect(mainTsx).toContain('floatingControlYRatio,\n      floatingControlSide,\n      floatingControlIdleOpacity,\n      desktopSidebarWidth,');
    expect(mainTsx).toContain('const desktopSidebarWidth = workspaceUiState.desktop.sidebarWidth;');
    expect(mainTsx).toContain('const floatingControlIdleOpacity = workspaceUiState.mobile.floatingControlIdleOpacity;');
    expect(mainTsx).toContain('const collapsedProjectIds = workspaceUiState.shared.collapsedProjectIds;');
    expect(mainTsx).toContain('const pinnedProjectIds = workspaceUiState.shared.pinnedProjectIds;');
    expect(mainTsx).toContain('const hiddenProjectIds = workspaceUiState.shared.hiddenProjectIds;');
    expect(mainTsx).toContain('const expandedHubIds = workspaceUiState.shared.expandedHubIds;');
    expect(mainTsx).toContain('const hubColors = workspaceUiState.shared.hubColors;');
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'desktop/setSidebarWidth', next });");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'mobile/setFloatingControlIdleOpacity', next });");
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

    expect(mainTsx).toContain('options?: {preserveFileView?: boolean; keepMobileDrawerOpen?: boolean}');
    expect(mainTsx).toContain("if (!isWide && options?.keepMobileDrawerOpen !== true) setDrawerOpen(false);");
    expect(mainTsx).toContain("options?: {reason?: 'chat' | 'manual'; keepMobileDrawerOpen?: boolean}");
    expect(mainTsx).toContain('keepMobileDrawerOpen: options?.keepMobileDrawerOpen,');
    expect(mainTsx).toContain("syncWorkspaceProject(nextProject.projectId, {reason: 'chat', keepMobileDrawerOpen: chatHubMenuOpen}).catch(() => undefined);");
    expect(mainTsx).toContain('onClick={event => {');
    expect(mainTsx).toContain('event.stopPropagation();');
    expect(mainTsx).toContain('toggleProjectVisibility(current, projectItem.projectId, !visible)');
    expect(mainTsx).not.toContain("syncWorkspaceProject(nextProject.projectId, {reason: 'chat'}).catch(() => undefined);");
  });

  test('renders hub display preferences with isolated square color controls', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');
    const stylesCss = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'styles.css'), 'utf8')
      .replace(/\r\n/g, '\n');

    const hubNameIndex = mainTsx.indexOf('<span className="chat-hub-row-name">{hub.hubId}</span>');
    const colorSquareIndex = mainTsx.indexOf('className="chat-hub-color-square"', hubNameIndex);
    const readTagIndex = mainTsx.indexOf('className={`chat-hub-read-tag ${readStatus.toLowerCase()}`}', hubNameIndex);
    expect(hubNameIndex).toBeGreaterThanOrEqual(0);
    expect(colorSquareIndex).toBeGreaterThan(hubNameIndex);
    expect(readTagIndex).toBeGreaterThan(colorSquareIndex);
    expect(mainTsx).not.toContain('className="chat-hub-color-trigger"');
    expect(mainTsx).not.toContain('className={`chat-hub-visibility-check ${visibilityState}`}');
    expect(mainTsx).not.toContain("const hubEnabled = visibilityState !== 'unchecked';");
    expect(mainTsx).not.toContain('const visibilityState = resolveHubVisibilityState(treeItem.projects, hiddenProjectIds);');
    expect(mainTsx).not.toContain('const hubToggleLabel = hubEnabled');
    expect(mainTsx).toContain('className={`chat-hub-tree${expanded ? \' expanded\' : \'\'}${colorMenuOpen ? \' color-open\' : \'\'}`}');
    expect(mainTsx).toContain('className="chat-hub-project-toggle"');
    expect(mainTsx).toContain("className={`codicon ${expanded ? 'codicon-folder-opened' : 'codicon-folder'} chat-hub-project-toggle-icon`}");
    expect(mainTsx).toContain('style={hubAccentStyle(hub.hubId)}');
    expect(mainTsx).not.toContain('className="chat-hub-disclosure"');
    expect(mainTsx).not.toContain('className={`chat-hub-visibility-cube');
    expect(mainTsx).not.toContain('aria-pressed={hubEnabled}');
    expect(mainTsx).not.toContain('toggleHubVisibility(current, treeItem.projects');
    expect(mainTsx).toContain('resolveHubColor,');
    expect(mainTsx).toContain('resolveHubColorVariantIndex,');
    expect(mainTsx).toContain("if (prefix === 'wide-project-hub' || prefix === 'token-stats-pill-hub') {");
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
    expect(mainTsx).toContain('if (!chatHubMenuRef.current.contains(event.target as Node)) {');
    expect(mainTsx).toContain("setChatHubColorMenuHubId('');");

    const popoverBlock = Array.from(stylesCss.matchAll(/\.chat-hub-popover \{[\s\S]*?\n\}/g))
      .map(match => match[0])
      .find(block => block.includes('position: absolute;')) ?? '';
    expect(popoverBlock).toContain('width: min(340px, calc(100vw - 24px));');
    expect(popoverBlock).toContain('min-width: 0;');
    expect(popoverBlock).toContain('--chat-hub-popover-viewport-offset: 96px;');
    expect(popoverBlock).toContain('max-height: calc(100vh - var(--chat-hub-popover-viewport-offset));');
    expect(popoverBlock).toContain('max-height: calc(100dvh - var(--chat-hub-popover-viewport-offset));');
    expect(popoverBlock).toContain('overflow: auto;');
    expect(popoverBlock).not.toContain('min(420px');

    const treeBlock = stylesCss.match(/(?:^|\n)\.chat-hub-tree \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(treeBlock).toContain('position: relative;');
    expect(treeBlock).toContain('--chat-hub-color-chip-width: 36px;');
    expect(treeBlock).toContain('--chat-hub-color-chip-height: 20px;');
    expect(treeBlock).toContain('--chat-hub-color-chip-radius: 6px;');
    expect(stylesCss).not.toContain('.chat-hub-tree.expanded .chat-hub-disclosure {');
    const colorOpenBlock = stylesCss.match(/\.chat-hub-tree\.color-open \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorOpenBlock).toContain('min-height: calc(36px + var(--chat-hub-color-palette-clearance));');
    expect(colorOpenBlock).toContain('--chat-hub-color-palette-clearance: 286px;');
    const colorOpenProjectListBlock = stylesCss.match(/\.chat-hub-tree\.color-open \.chat-hub-project-list \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorOpenProjectListBlock).toContain('margin-top: var(--chat-hub-color-palette-clearance);');
    expect(stylesCss).toContain('.chat-hub-color-palette::before {');

    const rowBlock = stylesCss.match(/\.chat-hub-row,\n\.chat-hub-empty \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(rowBlock).toContain('grid-template-columns: 24px minmax(0, 1fr) 40px auto;');

    const hubProjectToggleBlock = stylesCss.match(/\.chat-hub-project-toggle \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(hubProjectToggleBlock).toContain('width: 24px;');
    expect(hubProjectToggleBlock).toContain('height: 24px;');
    const hubProjectToggleIconBlock = stylesCss.match(/\.chat-hub-project-toggle-icon \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(hubProjectToggleIconBlock).toContain('color: var(--hub-accent);');

    const swatchBlock = stylesCss.match(/\.chat-hub-color-swatch \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(swatchBlock).toContain('var(--swatch-color)');
    expect(swatchBlock).toContain('background: var(--swatch-color);');
    expect(swatchBlock).toContain('width: var(--chat-hub-color-chip-width);');
    expect(swatchBlock).toContain('height: var(--chat-hub-color-chip-height);');
    expect(swatchBlock).toContain('border-radius: var(--chat-hub-color-chip-radius);');
    expect(swatchBlock).toContain('justify-self: center;');
    expect(swatchBlock).not.toContain('--hub-accent');

    const colorSquareBlock = Array.from(stylesCss.matchAll(/\.chat-hub-color-square \{[\s\S]*?\n\}/g))
      .map(match => match[0])
      .find(block => block.includes('--hub-accent')) ?? '';
    expect(colorSquareBlock).toContain('width: 40px;');
    expect(colorSquareBlock).toContain('height: 24px;');
    expect(colorSquareBlock).toContain('border: 1px solid transparent;');
    expect(colorSquareBlock).toContain('background: transparent;');
    expect(colorSquareBlock).not.toContain('linear-gradient');
    expect(colorSquareBlock).not.toContain('0 5px 14px');

    const colorSquareFillBlock = stylesCss.match(/\.chat-hub-color-square-fill \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorSquareFillBlock).toContain('width: var(--chat-hub-color-chip-width);');
    expect(colorSquareFillBlock).toContain('height: var(--chat-hub-color-chip-height);');
    expect(colorSquareFillBlock).toContain('border-radius: var(--chat-hub-color-chip-radius);');
    expect(colorSquareFillBlock).toContain('background: var(--hub-accent);');
    expect(colorSquareFillBlock).not.toContain('linear-gradient');

    const colorSquareOpenBlock = stylesCss.match(/\.chat-hub-color-square\[aria-expanded="true"\] \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorSquareOpenBlock).toContain('border-color: transparent;');
    expect(colorSquareOpenBlock).toContain('background: color-mix(in srgb, var(--hub-accent) 5%, transparent);');

    expect(stylesCss).not.toContain('.chat-hub-visibility-cube');

    const paletteBlock = stylesCss.match(/\.chat-hub-color-palette \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(paletteBlock).toContain('position: absolute;');
    expect(paletteBlock).toContain('right: 8px;');
    expect(paletteBlock).toContain('width: min(248px, calc(100% - 16px));');
    const paletteArrowBlock = stylesCss.match(/\.chat-hub-color-palette::before \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(paletteArrowBlock).toContain('right: 66px;');

    const colorGridBlock = stylesCss.match(/\.chat-hub-color-grid \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(colorGridBlock).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));');

    const selectedSwatchBlock = stylesCss.match(/\.chat-hub-color-swatch\.selected \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(selectedSwatchBlock).toContain('inset 0 0 0 1px rgba(255, 255, 255, 0.24)');
    expect(selectedSwatchBlock).toContain('0 0 0 2px color-mix(in srgb, var(--panel) 80%, transparent)');
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
    expect(colorLabelBlock).toContain('color: color-mix(in srgb, var(--text) 86%, var(--muted));');
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
      .find(block => block.includes('margin: 2px 6px 6px 30px;')) ?? '';
    expect(projectListBlock).toContain('margin: 2px 6px 6px 30px;');
    expect(projectListBlock).not.toContain('border-radius:');
    expect(projectListBlock).not.toContain('background:');
    expect(projectListBlock).not.toContain('box-shadow:');
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
    expect(persistenceTs).toContain('floatingControlIdleOpacity: number;');
    expect(persistenceTs).not.toContain('useLatestPromptTitle: boolean;');
    expect(persistenceTs).toContain("desktopSidebarWidth: 'desktopSidebarWidth',");
    expect(persistenceTs).toContain("hubColors: 'hubColors',");
    expect(persistenceTs).toContain("hiddenProjectIds: 'hiddenProjectIds',");
    expect(persistenceTs).toContain("expandedHubIds: 'expandedHubIds',");
    expect(persistenceTs).toContain("floatingControlYRatio: 'floatingControlYRatio',");
    expect(persistenceTs).toContain("floatingControlSlot: 'floatingControlSlot',");
    expect(persistenceTs).toContain("floatingControlSide: 'floatingControlSide',");
    expect(persistenceTs).toContain("floatingControlIdleOpacity: 'floatingControlIdleOpacity',");
    expect(persistenceTs).not.toContain("useLatestPromptTitle: 'useLatestPromptTitle',");
    expect(persistenceTs).toContain('desktopSidebarWidth: 380,');
    expect(persistenceTs).toContain('hubColors: {},');
    expect(persistenceTs).toContain('hiddenProjectIds: [],');
    expect(persistenceTs).toContain('expandedHubIds: [],');
    expect(persistenceTs).toContain('floatingControlYRatio: FLOATING_CONTROL_DEFAULT_Y_RATIO,');
    expect(persistenceTs).toContain("floatingControlSide: 'right',");
    expect(persistenceTs).toContain('floatingControlIdleOpacity: FLOATING_CONTROL_DEFAULT_IDLE_OPACITY,');
    expect(persistenceTs).not.toContain('useLatestPromptTitle: false,');
    expect(persistenceTs).not.toContain('useLatestPromptTitle: typeof input.useLatestPromptTitle');
    expect(persistenceTs).toContain('desktopSidebarWidth: sanitizeDesktopSidebarWidth(input.desktopSidebarWidth, base.desktopSidebarWidth),');
    expect(persistenceTs).toContain('hubColors: sanitizeHubColorMap(input.hubColors),');
    expect(persistenceTs).toContain('hiddenProjectIds,');
    expect(persistenceTs).toContain('expandedHubIds,');
    expect(persistenceTs).toContain('floatingControlYRatio,');
    expect(persistenceTs).toContain('floatingControlSide: sanitizeFloatingControlSide(input.floatingControlSide, base.floatingControlSide),');
    expect(persistenceTs).toContain('floatingControlIdleOpacity: sanitizeFloatingControlIdleOpacity(input.floatingControlIdleOpacity, base.floatingControlIdleOpacity),');
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.desktopSidebarWidth, v: serialize(this.state.global.desktopSidebarWidth), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.hubColors, v: serialize(this.state.global.hubColors), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.hiddenProjectIds, v: serialize(this.state.global.hiddenProjectIds), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.expandedHubIds, v: serialize(this.state.global.expandedHubIds), updatedAt: now}',
    );
    expect(persistenceTs).not.toContain('GLOBAL_KEYS.useLatestPromptTitle');
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.desktopSidebarWidth, v: serialize(next.desktopSidebarWidth), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.floatingControlYRatio, v: serialize(next.floatingControlYRatio), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.floatingControlSide, v: serialize(next.floatingControlSide), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.floatingControlIdleOpacity, v: serialize(next.floatingControlIdleOpacity), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.hubColors, v: serialize(next.hubColors), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.hiddenProjectIds, v: serialize(next.hiddenProjectIds), updatedAt: now}',
    );
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.expandedHubIds, v: serialize(next.expandedHubIds), updatedAt: now}',
    );
    expect(persistenceTs).not.toContain('next.useLatestPromptTitle');
  });
});
