import fs from 'fs';
import path from 'path';

import {
  SHORTCUT_COMMANDS,
  assignShortcutBinding,
  bindingsEqual,
  clearShortcutBinding,
  findShortcutConflict,
  formatShortcutBinding,
  formatShortcutTooltip,
  matchWorkspaceShortcut,
  normalizeShortcutEvent,
  replaceShortcutConflict,
  resetShortcutOverrides,
  resolveEffectiveShortcutBindings,
  resolveShortcutPlatform,
  resolveWorkspaceShortcutDispatch,
  restoreShortcutDefault,
  sanitizeShortcutOverrides,
  validateShortcutCandidate,
  type ShortcutBinding,
  type ShortcutEvent,
  type ShortcutOverrides,
  type ShortcutPlatform,
} from '../web/src/shortcuts/keyboardShortcuts';

const keyboardEvent = (overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: '1',
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...overrides,
});

describe('keyboard shortcut registry', () => {
  test('defines the approved eight commands in stable group order', () => {
    expect(SHORTCUT_COMMANDS.map(command => [command.id, command.group, command.defaultBinding])).toEqual([
      ['toggleSessions', 'Navigation', {primary: true, key: '1'}],
      ['togglePreview', 'Workbench', {primary: true, key: '2'}],
      ['toggleTerminal', 'Workbench', {primary: true, key: '`'}],
      ['quickOpen', 'Workbench', {primary: true, key: 'p'}],
      ['nextPreviewTab', 'Workbench', {primary: true, key: 'Tab'}],
      ['previousPreviewTab', 'Workbench', {primary: true, shift: true, key: 'Tab'}],
      ['searchCurrentContext', 'Search', {primary: true, key: 'f'}],
      ['searchSessions', 'Search', {primary: true, shift: true, key: 'f'}],
    ]);
  });

  test.each<[ShortcutPlatform, string]>([
    ['windows', 'Ctrl'],
    ['linux', 'Ctrl'],
    ['mac', 'Cmd'],
  ])('formats Primary for %s', (platform, primaryLabel) => {
    expect(formatShortcutBinding({primary: true, shift: true, key: 'f'}, platform)).toEqual([
      primaryLabel,
      'Shift',
      'F',
    ]);
  });

  test('detects the three supported desktop platform families', () => {
    expect(resolveShortcutPlatform({platform: 'Win32', userAgent: 'Windows NT 10.0'})).toBe('windows');
    expect(resolveShortcutPlatform({platform: 'Linux x86_64', userAgent: 'X11'})).toBe('linux');
    expect(resolveShortcutPlatform({platform: 'MacIntel', userAgent: 'Macintosh'})).toBe('mac');
  });

  test('formats live tooltips without a binding remnant when unassigned', () => {
    expect(formatShortcutTooltip('Search current session', {primary: true, key: 'k'}, 'windows'))
      .toBe('Search current session (Ctrl+K)');
    expect(formatShortcutTooltip('Search current session', null, 'windows'))
      .toBe('Search current session');
  });

  test('normalizes character values rather than physical key codes', () => {
    expect(normalizeShortcutEvent(keyboardEvent({key: 'É', ctrlKey: true}), 'windows')).toEqual({
      primary: true,
      key: 'é',
    });
    expect(normalizeShortcutEvent(keyboardEvent({key: 'F', ctrlKey: false, metaKey: true, shiftKey: true}), 'mac')).toEqual({
      primary: true,
      shift: true,
      key: 'f',
    });
    expect(normalizeShortcutEvent(keyboardEvent({key: 'Control'}), 'windows')).toBeNull();
  });

  test('matches exact modifiers on Windows and macOS', () => {
    const effective = resolveEffectiveShortcutBindings({});
    expect(matchWorkspaceShortcut(keyboardEvent({key: 'p'}), effective, {
      platform: 'windows',
      isWide: true,
      paused: false,
    })).toBe('quickOpen');
    expect(matchWorkspaceShortcut(keyboardEvent({key: 'p', ctrlKey: false, metaKey: true}), effective, {
      platform: 'mac',
      isWide: true,
      paused: false,
    })).toBe('quickOpen');
    expect(matchWorkspaceShortcut(keyboardEvent({key: 'p', shiftKey: true}), effective, {
      platform: 'windows',
      isWide: true,
      paused: false,
    })).toBeNull();
    expect(matchWorkspaceShortcut(keyboardEvent({key: 'p'}), effective, {
      platform: 'linux',
      isWide: true,
      paused: false,
    })).toBe('quickOpen');
  });

  test('ignores shortcuts outside the active Workspace routing boundary', () => {
    const effective = resolveEffectiveShortcutBindings({});
    const context = {platform: 'windows' as const, isWide: true, paused: false};
    expect(matchWorkspaceShortcut(keyboardEvent({isComposing: true}), effective, context)).toBeNull();
    expect(matchWorkspaceShortcut(keyboardEvent({defaultPrevented: true}), effective, context)).toBeNull();
    expect(matchWorkspaceShortcut(keyboardEvent(), effective, {...context, isWide: false})).toBeNull();
    expect(matchWorkspaceShortcut(keyboardEvent(), effective, {...context, paused: true})).toBeNull();
  });
});

describe('workspace shortcut dispatch', () => {
  const effective = resolveEffectiveShortcutBindings({});
  const context = {
    platform: 'windows' as const,
    isWide: true,
    paused: false,
    availability: {},
  };

  test('distinguishes executable, unavailable, and ignored events', () => {
    expect(resolveWorkspaceShortcutDispatch(keyboardEvent(), effective, context)).toEqual({
      kind: 'execute',
      actionId: 'toggleSessions',
      preventDefault: true,
    });
    expect(resolveWorkspaceShortcutDispatch(
      keyboardEvent({key: 'p'}),
      effective,
      {...context, availability: {quickOpen: 'Open a project to use Quick Open.'}},
    )).toEqual({
      kind: 'unavailable',
      actionId: 'quickOpen',
      reason: 'Open a project to use Quick Open.',
      preventDefault: true,
    });
    expect(resolveWorkspaceShortcutDispatch(
      keyboardEvent({key: 'x'}),
      effective,
      context,
    )).toEqual({kind: 'ignore', preventDefault: false});
  });

  test('leaves narrow, modal, composing, and locally consumed events untouched', () => {
    expect(resolveWorkspaceShortcutDispatch(keyboardEvent(), effective, {...context, isWide: false}))
      .toEqual({kind: 'ignore', preventDefault: false});
    expect(resolveWorkspaceShortcutDispatch(keyboardEvent(), effective, {...context, paused: true}))
      .toEqual({kind: 'ignore', preventDefault: false});
    expect(resolveWorkspaceShortcutDispatch(keyboardEvent({isComposing: true}), effective, context))
      .toEqual({kind: 'ignore', preventDefault: false});
    expect(resolveWorkspaceShortcutDispatch(keyboardEvent({defaultPrevented: true}), effective, context))
      .toEqual({kind: 'ignore', preventDefault: false});
  });

  test('uses one managed Workspace listener and removes distributed key matching', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../web/src/app/WorkspaceApp.tsx'),
      'utf8',
    );

    expect(source).toContain("window.addEventListener('keydown', handleWorkspaceShortcutKeyDown);");
    expect(source).toContain('resolveWorkspaceShortcutDispatch(event, effectiveShortcutBindings');
    for (const actionId of SHORTCUT_COMMANDS.map(command => command.id)) {
      expect(source).toContain(`case '${actionId}':`);
    }
    expect(source).not.toContain('resolveWindowsWorkspaceShortcut');
    expect(source).not.toContain('handleGlobalPreviewKeyDown');
    expect(source).not.toContain('handleGlobalSearchKeyDown');
    expect(source).not.toContain('resolveWorkspaceSearchShortcutTarget');
  });

  test('shares persisted bindings with Settings, routing, and dynamic hints', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../web/src/app/WorkspaceApp.tsx'),
      'utf8',
    );

    expect(source).toContain('() => persistedGlobal.keyboardShortcutOverrides');
    expect(source).toContain('keyboardShortcutOverrides,');
    expect(source).toContain('<KeyboardShortcutsSettingsDetail');
    expect(source).toContain('onChange={setKeyboardShortcutOverrides}');
    expect(source).toContain("data-tooltip={shortcutTooltip('Search current session', 'searchCurrentContext')}");
    expect(source).toContain("data-tooltip={shortcutTooltip('Search sessions', 'searchSessions')}");
    expect(source).toContain('return formatShortcutTooltip(label, effectiveShortcutBindings[actionId], shortcutPlatform);');
    expect(source).not.toContain('Search current session (Ctrl+F)');
    expect(source).toContain("if (!isWide && settingsDetailView === 'keyboardShortcuts') {");
    expect(source).toContain("paused: document.querySelector('[aria-modal=\"true\"]') !== null");
  });
});

describe('keyboard shortcut validation and updates', () => {
  const valid = (binding: ShortcutBinding, platform: ShortcutPlatform = 'windows') =>
    validateShortcutCandidate(binding, platform).kind;

  test('rejects bare text and modifier-only input while allowing function keys', () => {
    expect(valid({key: 'a'})).toBe('blocked');
    expect(valid({key: '7'})).toBe('blocked');
    expect(valid({key: 'Space'})).toBe('blocked');
    expect(valid({key: 'Control'})).toBe('blocked');
    expect(valid({key: 'F8'})).toBe('valid');
    expect(valid({alt: true, key: 'p'})).toBe('valid');
  });

  test('blocks high-risk combinations and warns for ordinary browser reservations', () => {
    expect(valid({primary: true, key: 'r'})).toBe('blocked');
    expect(valid({key: 'F5'})).toBe('blocked');
    expect(valid({primary: true, key: 'w'})).toBe('blocked');
    expect(valid({alt: true, key: 'F4'})).toBe('blocked');
    expect(valid({primary: true, shift: true, key: 'i'})).toBe('blocked');
    expect(valid({alt: true, key: 'Tab'})).toBe('blocked');
    expect(valid({primary: true, key: 'l'})).toBe('warning');
    expect(valid({primary: true, key: 'p'})).toBe('warning');
  });

  test('keeps a blocked default as a compatibility binding with a warning', () => {
    const binding = {primary: true, key: 'Tab'} as const;
    expect(validateShortcutCandidate(binding, 'mac').kind).toBe('blocked');
    expect(validateShortcutCandidate(binding, 'mac', {defaultActionId: 'nextPreviewTab'}).kind).toBe('warning');
  });

  test('finds conflicts and replaces them atomically', () => {
    const effective = resolveEffectiveShortcutBindings({});
    const candidate = {primary: true, key: '1'} as const;
    expect(findShortcutConflict(effective, 'togglePreview', candidate)).toBe('toggleSessions');

    const replaced = replaceShortcutConflict({}, 'togglePreview', candidate, 'toggleSessions');
    expect(replaced).toEqual({toggleSessions: null, togglePreview: candidate});
    const nextEffective = resolveEffectiveShortcutBindings(replaced);
    expect(nextEffective.toggleSessions).toBeNull();
    expect(nextEffective.togglePreview).toEqual(candidate);
  });

  test('assigns, clears, restores, and resets immutable overrides', () => {
    const original: ShortcutOverrides = {};
    const custom = {alt: true, key: 'F8'};
    const assigned = assignShortcutBinding(original, 'toggleTerminal', custom);
    expect(original).toEqual({});
    expect(assigned).toEqual({toggleTerminal: custom});
    expect(clearShortcutBinding(assigned, 'toggleTerminal')).toEqual({toggleTerminal: null});
    expect(restoreShortcutDefault(assigned, 'toggleTerminal')).toEqual({});
    expect(resetShortcutOverrides(assigned)).toEqual({});
  });

  test('sanitizes unknown, malformed, and duplicate persisted overrides deterministically', () => {
    const sanitized = sanitizeShortcutOverrides({
      unknown: {primary: true, key: 'x'},
      toggleSessions: {primary: true, key: '9'},
      togglePreview: {primary: true, key: '9'},
      toggleTerminal: null,
      quickOpen: {primary: 'yes', key: 'q'},
    });
    expect(sanitized).toEqual({
      toggleSessions: {primary: true, key: '9'},
      togglePreview: null,
      toggleTerminal: null,
    });
    const effective = resolveEffectiveShortcutBindings(sanitized);
    expect(effective.toggleSessions).toEqual({primary: true, key: '9'});
    expect(effective.togglePreview).toBeNull();
    expect(effective.toggleTerminal).toBeNull();
  });

  test('compares normalized bindings without modifier-order ambiguity', () => {
    expect(bindingsEqual(
      {key: 'F', shift: true, primary: true},
      {primary: true, key: 'f', shift: true},
    )).toBe(true);
  });
});
