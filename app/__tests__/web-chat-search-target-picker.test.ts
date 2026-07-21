import {
  CHAT_SEARCH_TARGET_ORDER,
  cycleChatSearchTarget,
  firstEnabledChatSearchTarget,
  resolveChatSearchTargetAvailability,
  resolveChatSearchTargetPickerKey,
  resolveSessionSearchExpansion,
} from '../web/src/chat/search/searchTargetPicker';

describe('chat search target picker', () => {
  test('lists current, sessions, preview in order', () => {
    expect(CHAT_SEARCH_TARGET_ORDER).toEqual(['current', 'sessions', 'preview']);
  });

  test('preview availability follows preview content', () => {
    expect(resolveChatSearchTargetAvailability({previewAvailable: true})).toEqual({
      current: true,
      sessions: true,
      preview: true,
    });
    expect(resolveChatSearchTargetAvailability({previewAvailable: false})).toEqual({
      current: true,
      sessions: true,
      preview: false,
    });
  });

  test('first enabled target skips disabled entries', () => {
    expect(firstEnabledChatSearchTarget(resolveChatSearchTargetAvailability({previewAvailable: true}))).toBe('current');
    expect(firstEnabledChatSearchTarget({current: false, sessions: true, preview: false})).toBe('sessions');
    expect(firstEnabledChatSearchTarget({current: false, sessions: false, preview: false})).toBe('current');
  });

  test('cycling wraps around and skips disabled targets', () => {
    const all = resolveChatSearchTargetAvailability({previewAvailable: true});
    expect(cycleChatSearchTarget('current', 1, all)).toBe('sessions');
    expect(cycleChatSearchTarget('sessions', 1, all)).toBe('preview');
    expect(cycleChatSearchTarget('preview', 1, all)).toBe('current');
    expect(cycleChatSearchTarget('current', -1, all)).toBe('preview');
    const noPreview = resolveChatSearchTargetAvailability({previewAvailable: false});
    expect(cycleChatSearchTarget('current', 1, noPreview)).toBe('sessions');
    expect(cycleChatSearchTarget('sessions', 1, noPreview)).toBe('current');
    expect(cycleChatSearchTarget('sessions', -1, noPreview)).toBe('current');
  });

  test('cycling away from a disabled current target lands on an enabled one', () => {
    const availability = {current: false, sessions: true, preview: true};
    expect(cycleChatSearchTarget('current', 1, availability)).toBe('sessions');
    expect(cycleChatSearchTarget('current', -1, availability)).toBe('preview');
  });

  test('session search opens the slideout only when no panel is visible', () => {
    expect(resolveSessionSearchExpansion({sessionPanelPinned: true, slideOutOpen: false})).toBe('focus-only');
    expect(resolveSessionSearchExpansion({sessionPanelPinned: false, slideOutOpen: true})).toBe('focus-only');
    expect(resolveSessionSearchExpansion({sessionPanelPinned: false, slideOutOpen: false})).toBe('open-slideout');
  });

  test('resolves picker keys into actions', () => {
    expect(resolveChatSearchTargetPickerKey({key: 'Escape'})).toEqual({type: 'close'});
    expect(resolveChatSearchTargetPickerKey({key: 'Enter'})).toEqual({type: 'confirm'});
    expect(resolveChatSearchTargetPickerKey({key: 'ArrowDown'})).toEqual({type: 'cycle', delta: 1});
    expect(resolveChatSearchTargetPickerKey({key: 'Tab'})).toEqual({type: 'cycle', delta: 1});
    expect(resolveChatSearchTargetPickerKey({key: 'ArrowUp'})).toEqual({type: 'cycle', delta: -1});
    expect(resolveChatSearchTargetPickerKey({key: 'Tab', shiftKey: true})).toEqual({type: 'cycle', delta: -1});
  });

  test('printable keys seed the target search input, modified keys are ignored', () => {
    expect(resolveChatSearchTargetPickerKey({key: 'k'})).toEqual({type: 'type-text', text: 'k'});
    expect(resolveChatSearchTargetPickerKey({key: ' '})).toEqual({type: 'type-text', text: ' '});
    expect(resolveChatSearchTargetPickerKey({key: '3'})).toEqual({type: 'type-text', text: '3'});
    expect(resolveChatSearchTargetPickerKey({key: 'f', ctrlKey: true})).toBeNull();
    expect(resolveChatSearchTargetPickerKey({key: 'f', metaKey: true})).toBeNull();
    expect(resolveChatSearchTargetPickerKey({key: 'a', altKey: true})).toBeNull();
    expect(resolveChatSearchTargetPickerKey({key: 'F2'})).toBeNull();
    expect(resolveChatSearchTargetPickerKey({key: 'Delete'})).toBeNull();
  });
});
