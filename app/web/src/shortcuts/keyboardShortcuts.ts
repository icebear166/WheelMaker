export type ShortcutActionId =
  | 'toggleSessions'
  | 'togglePreview'
  | 'toggleTerminal'
  | 'quickOpen'
  | 'nextPreviewTab'
  | 'previousPreviewTab'
  | 'searchCurrentContext'
  | 'searchSessions';

export type ShortcutGroup = 'Navigation' | 'Workbench' | 'Search';
export type ShortcutPlatform = 'windows' | 'linux' | 'mac';

export type ShortcutBinding = {
  primary?: true;
  ctrl?: true;
  alt?: true;
  shift?: true;
  meta?: true;
  key: string;
};

export type ShortcutOverrides = Partial<Record<ShortcutActionId, ShortcutBinding | null>>;
export type EffectiveShortcutBindings = Record<ShortcutActionId, ShortcutBinding | null>;

export type ShortcutCommand = {
  id: ShortcutActionId;
  group: ShortcutGroup;
  name: string;
  description: string;
  condition: string;
  defaultBinding: ShortcutBinding;
};

export type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'isComposing' | 'defaultPrevented'
>;

export type ShortcutValidation = {
  kind: 'valid' | 'warning' | 'blocked';
  message: string;
};

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  {
    id: 'toggleSessions',
    group: 'Navigation',
    name: 'Toggle Sessions',
    description: 'Show or hide the Sessions panel.',
    condition: 'Available throughout the Workspace.',
    defaultBinding: {primary: true, key: '1'},
  },
  {
    id: 'togglePreview',
    group: 'Workbench',
    name: 'Toggle Preview',
    description: 'Show or hide the Preview workbench.',
    condition: 'Available throughout the Workspace.',
    defaultBinding: {primary: true, key: '2'},
  },
  {
    id: 'toggleTerminal',
    group: 'Workbench',
    name: 'Toggle Terminal',
    description: 'Show or hide the Terminal workbench.',
    condition: 'Available throughout the Workspace.',
    defaultBinding: {primary: true, key: '`'},
  },
  {
    id: 'quickOpen',
    group: 'Workbench',
    name: 'Quick Open',
    description: 'Find and open a project file.',
    condition: 'Requires an active project.',
    defaultBinding: {primary: true, key: 'p'},
  },
  {
    id: 'nextPreviewTab',
    group: 'Workbench',
    name: 'Next Preview Tab',
    description: 'Select the next open Preview tab.',
    condition: 'Requires an open Preview tab.',
    defaultBinding: {primary: true, key: 'Tab'},
  },
  {
    id: 'previousPreviewTab',
    group: 'Workbench',
    name: 'Previous Preview Tab',
    description: 'Select the previous open Preview tab.',
    condition: 'Requires an open Preview tab.',
    defaultBinding: {primary: true, shift: true, key: 'Tab'},
  },
  {
    id: 'searchCurrentContext',
    group: 'Search',
    name: 'Search Current Context',
    description: 'Search the current chat or focused Preview.',
    condition: 'Searches Preview only when its content is searchable.',
    defaultBinding: {primary: true, key: 'f'},
  },
  {
    id: 'searchSessions',
    group: 'Search',
    name: 'Search Sessions',
    description: 'Search across visible project sessions.',
    condition: 'Available throughout the Workspace.',
    defaultBinding: {primary: true, shift: true, key: 'f'},
  },
] as const;

export const SHORTCUT_ACTION_IDS = SHORTCUT_COMMANDS.map(command => command.id) as readonly ShortcutActionId[];

const SHORTCUT_ACTION_ID_SET = new Set<string>(SHORTCUT_ACTION_IDS);
const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

function normalizeKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key === 'Esc') return 'Escape';
  if (key.length === 1) return key.toLocaleLowerCase();
  if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  return key;
}

function canonicalBinding(binding: ShortcutBinding): ShortcutBinding {
  const next: ShortcutBinding = {key: normalizeKey(binding.key)};
  if (binding.primary) next.primary = true;
  if (binding.ctrl) next.ctrl = true;
  if (binding.alt) next.alt = true;
  if (binding.shift) next.shift = true;
  if (binding.meta) next.meta = true;
  return next;
}

function persistedBinding(value: unknown): ShortcutBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.key !== 'string' || !record.key) return undefined;
  for (const modifier of ['primary', 'ctrl', 'alt', 'shift', 'meta'] as const) {
    if (record[modifier] !== undefined && record[modifier] !== true) return undefined;
  }
  const binding = canonicalBinding({
    key: record.key,
    ...(record.primary === true ? {primary: true as const} : {}),
    ...(record.ctrl === true ? {ctrl: true as const} : {}),
    ...(record.alt === true ? {alt: true as const} : {}),
    ...(record.shift === true ? {shift: true as const} : {}),
    ...(record.meta === true ? {meta: true as const} : {}),
  });
  return MODIFIER_KEYS.has(binding.key) ? undefined : binding;
}

function defaultBindings(): EffectiveShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_COMMANDS.map(command => [command.id, canonicalBinding(command.defaultBinding)]),
  ) as EffectiveShortcutBindings;
}

export function bindingsEqual(
  left: ShortcutBinding | null | undefined,
  right: ShortcutBinding | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  const a = canonicalBinding(left);
  const b = canonicalBinding(right);
  return a.key === b.key
    && !!a.primary === !!b.primary
    && !!a.ctrl === !!b.ctrl
    && !!a.alt === !!b.alt
    && !!a.shift === !!b.shift
    && !!a.meta === !!b.meta;
}

export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const candidates: ShortcutOverrides = {};
  const effective = defaultBindings();

  for (const actionId of SHORTCUT_ACTION_IDS) {
    if (!Object.prototype.hasOwnProperty.call(input, actionId)) continue;
    const raw = input[actionId];
    if (raw === null) {
      candidates[actionId] = null;
      effective[actionId] = null;
      continue;
    }
    const binding = persistedBinding(raw);
    if (!binding) continue;
    candidates[actionId] = binding;
    effective[actionId] = null;
  }

  const sanitized: ShortcutOverrides = {};
  for (const actionId of SHORTCUT_ACTION_IDS) {
    const candidate = candidates[actionId];
    if (candidate === undefined) continue;
    if (candidate === null) {
      sanitized[actionId] = null;
      continue;
    }
    const conflict = SHORTCUT_ACTION_IDS.some(otherId =>
      otherId !== actionId && bindingsEqual(effective[otherId], candidate));
    if (conflict) {
      sanitized[actionId] = null;
      continue;
    }
    effective[actionId] = candidate;
    sanitized[actionId] = candidate;
  }
  return sanitized;
}

export function resolveEffectiveShortcutBindings(overrides: unknown): EffectiveShortcutBindings {
  const sanitized = sanitizeShortcutOverrides(overrides);
  const effective = defaultBindings();
  for (const actionId of SHORTCUT_ACTION_IDS) {
    if (!Object.prototype.hasOwnProperty.call(sanitized, actionId)) continue;
    effective[actionId] = sanitized[actionId] ?? null;
  }
  return effective;
}

export function normalizeShortcutEvent(
  event: ShortcutEvent,
  platform: ShortcutPlatform,
): ShortcutBinding | null {
  const key = normalizeKey(event.key);
  if (!key || MODIFIER_KEYS.has(key)) return null;
  const binding: ShortcutBinding = {key};
  if (platform === 'mac') {
    if (event.metaKey) binding.primary = true;
    if (event.ctrlKey) binding.ctrl = true;
  } else {
    if (event.ctrlKey) binding.primary = true;
    if (event.metaKey) binding.meta = true;
  }
  if (event.altKey) binding.alt = true;
  if (event.shiftKey) binding.shift = true;
  return binding;
}

function displayKey(key: string): string {
  if (key === 'Space') return 'Space';
  if (key.length === 1 && /\p{L}/u.test(key)) return key.toLocaleUpperCase();
  return key;
}

export function formatShortcutBinding(
  binding: ShortcutBinding | null | undefined,
  platform: ShortcutPlatform,
): string[] {
  if (!binding) return [];
  const normalized = canonicalBinding(binding);
  const keys: string[] = [];
  if (normalized.primary) keys.push(platform === 'mac' ? 'Cmd' : 'Ctrl');
  if (normalized.ctrl) keys.push('Ctrl');
  if (normalized.alt) keys.push(platform === 'mac' ? 'Option' : 'Alt');
  if (normalized.shift) keys.push('Shift');
  if (normalized.meta) keys.push(platform === 'mac' ? 'Cmd' : 'Win');
  keys.push(displayKey(normalized.key));
  return keys;
}

export function matchWorkspaceShortcut(
  event: ShortcutEvent,
  effective: EffectiveShortcutBindings,
  context: {platform: ShortcutPlatform; isWide: boolean; paused: boolean},
): ShortcutActionId | null {
  if (!context.isWide || context.paused || event.isComposing || event.defaultPrevented) return null;
  const candidate = normalizeShortcutEvent(event, context.platform);
  if (!candidate) return null;
  return SHORTCUT_ACTION_IDS.find(actionId => bindingsEqual(effective[actionId], candidate)) ?? null;
}

function hasModifier(binding: ShortcutBinding): boolean {
  return !!(binding.primary || binding.ctrl || binding.alt || binding.shift || binding.meta);
}

function restrictionFor(binding: ShortcutBinding, platform: ShortcutPlatform): ShortcutValidation | null {
  const key = binding.key.toLocaleLowerCase();
  if (binding.alt && key === 'f4') {
    return {kind: 'blocked', message: 'This shortcut closes the application window.'};
  }
  if ((binding.alt || binding.meta) && key === 'tab') {
    return {kind: 'blocked', message: 'This shortcut switches applications.'};
  }
  if (platform === 'mac' && binding.primary && key === 'tab') {
    return {kind: 'blocked', message: 'This shortcut switches applications on macOS.'};
  }
  if (key === 'f5' || (binding.primary && key === 'r')) {
    return {kind: 'blocked', message: 'This shortcut refreshes the page.'};
  }
  if (binding.primary && key === 'w') {
    return {kind: 'blocked', message: 'This shortcut closes the current window or tab.'};
  }
  if (binding.primary && key === 'q') {
    return {kind: 'blocked', message: 'This shortcut quits the application.'};
  }
  if (
    key === 'f12'
    || (binding.primary && binding.shift && ['i', 'j', 'c'].includes(key))
  ) {
    return {kind: 'blocked', message: 'This shortcut opens developer tools.'};
  }
  if (
    binding.primary
    && (['f', 'l', 'n', 'p', 's', 't'].includes(key) || key === 'tab')
  ) {
    return {kind: 'warning', message: 'This shortcut may be handled by the browser first.'};
  }
  return null;
}

export function validateShortcutCandidate(
  rawBinding: ShortcutBinding,
  platform: ShortcutPlatform,
  options: {defaultActionId?: ShortcutActionId} = {},
): ShortcutValidation {
  const binding = canonicalBinding(rawBinding);
  if (!binding.key || MODIFIER_KEYS.has(binding.key)) {
    return {kind: 'blocked', message: 'Press a non-modifier key to complete the shortcut.'};
  }
  if (!hasModifier(binding) && (
    binding.key === 'Space'
    || /^\p{L}$/u.test(binding.key)
    || /^\d$/u.test(binding.key)
  )) {
    return {kind: 'blocked', message: 'Letters, numbers, and Space require a modifier.'};
  }
  const restriction = restrictionFor(binding, platform);
  if (!restriction) return {kind: 'valid', message: ''};
  const defaultCommand = options.defaultActionId
    ? SHORTCUT_COMMANDS.find(command => command.id === options.defaultActionId)
    : undefined;
  if (
    restriction.kind === 'blocked'
    && defaultCommand
    && bindingsEqual(binding, defaultCommand.defaultBinding)
  ) {
    return {
      kind: 'warning',
      message: `${restriction.message} This default is retained for compatibility.`,
    };
  }
  return restriction;
}

export function findShortcutConflict(
  effective: EffectiveShortcutBindings,
  actionId: ShortcutActionId,
  binding: ShortcutBinding,
): ShortcutActionId | null {
  return SHORTCUT_ACTION_IDS.find(otherId =>
    otherId !== actionId && bindingsEqual(effective[otherId], binding)) ?? null;
}

export function assignShortcutBinding(
  overrides: ShortcutOverrides,
  actionId: ShortcutActionId,
  rawBinding: ShortcutBinding,
): ShortcutOverrides {
  const binding = canonicalBinding(rawBinding);
  const command = SHORTCUT_COMMANDS.find(item => item.id === actionId);
  if (command && bindingsEqual(command.defaultBinding, binding)) {
    return restoreShortcutDefault(overrides, actionId);
  }
  return {...overrides, [actionId]: binding};
}

export function replaceShortcutConflict(
  overrides: ShortcutOverrides,
  actionId: ShortcutActionId,
  rawBinding: ShortcutBinding,
  conflictActionId: ShortcutActionId,
): ShortcutOverrides {
  const next = assignShortcutBinding(overrides, actionId, rawBinding);
  return {...next, [conflictActionId]: null};
}

export function clearShortcutBinding(
  overrides: ShortcutOverrides,
  actionId: ShortcutActionId,
): ShortcutOverrides {
  return {...overrides, [actionId]: null};
}

export function restoreShortcutDefault(
  overrides: ShortcutOverrides,
  actionId: ShortcutActionId,
): ShortcutOverrides {
  const next = {...overrides};
  delete next[actionId];
  return next;
}

export function resetShortcutOverrides(_overrides: ShortcutOverrides): ShortcutOverrides {
  return {};
}

export function isShortcutActionId(value: unknown): value is ShortcutActionId {
  return typeof value === 'string' && SHORTCUT_ACTION_ID_SET.has(value);
}
