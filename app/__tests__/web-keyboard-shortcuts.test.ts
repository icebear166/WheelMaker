import {
  SHORTCUT_COMMANDS,
  assignShortcutBinding,
  bindingsEqual,
  clearShortcutBinding,
  findShortcutConflict,
  formatShortcutBinding,
  matchWorkspaceShortcut,
  normalizeShortcutEvent,
  replaceShortcutConflict,
  resetShortcutOverrides,
  resolveEffectiveShortcutBindings,
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
