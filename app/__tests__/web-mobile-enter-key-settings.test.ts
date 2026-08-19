import {
  DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR,
  isMobileEnterKeyBehavior,
  MOBILE_ENTER_KEY_BEHAVIOR_OPTIONS,
  normalizeMobileEnterKeyBehavior,
} from '../web/src/chat/mobileEnterKeyBehavior';

describe('mobile enter key behavior', () => {
  test.each([
    ['send', 'send'],
    ['newline', 'newline'],
  ])('accepts %s as a mobile behavior', (value, expected) => {
    expect(isMobileEnterKeyBehavior(value)).toBe(true);
    expect(normalizeMobileEnterKeyBehavior(value)).toBe(expected);
  });

  test('falls back to send for unknown persisted values', () => {
    expect(isMobileEnterKeyBehavior('submit')).toBe(false);
    expect(normalizeMobileEnterKeyBehavior('submit')).toBe(DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR);
    expect(normalizeMobileEnterKeyBehavior(null, 'newline')).toBe('newline');
  });

  test('publishes the default and the two user-facing choices', () => {
    expect(DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR).toBe('send');
    expect(MOBILE_ENTER_KEY_BEHAVIOR_OPTIONS).toEqual([
      {id: 'send', label: 'Send'},
      {id: 'newline', label: 'New Line'},
    ]);
  });
});
