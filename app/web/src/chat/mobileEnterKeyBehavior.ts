export type MobileEnterKeyBehavior = 'send' | 'newline';

export const DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR: MobileEnterKeyBehavior = 'send';

export const MOBILE_ENTER_KEY_BEHAVIOR_OPTIONS: {id: MobileEnterKeyBehavior; label: string}[] = [
  {id: 'send', label: 'Send'},
  {id: 'newline', label: 'New Line'},
];

export function isMobileEnterKeyBehavior(value: unknown): value is MobileEnterKeyBehavior {
  return value === 'send' || value === 'newline';
}

export function normalizeMobileEnterKeyBehavior(
  value: unknown,
  fallback: MobileEnterKeyBehavior = DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR,
): MobileEnterKeyBehavior {
  return isMobileEnterKeyBehavior(value) ? value : fallback;
}
