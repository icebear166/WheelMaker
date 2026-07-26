import {
  FLOATING_NAV_CARD_HEIGHT_PX,
  FLOATING_NAV_EXPANDED_OVERFLOW_PX,
  FLOATING_NAV_ITEMS,
  resolveFloatingNavCurrent,
  resolveFloatingNavRelayState,
} from '../web/src/shell/layouts/mobile/mobileFloatingNavModel';

describe('mobile floating nav model', () => {
  test('lists destinations in fixed order with lucide icons', () => {
    expect(FLOATING_NAV_ITEMS.map(item => item.id)).toEqual([
      'preview', 'terminal', 'relay', 'monitor', 'settings', 'chat',
    ]);
    expect(FLOATING_NAV_ITEMS.map(item => item.icon)).toEqual([
      'eye', 'terminal', 'radioTower', 'activity', 'settings', 'messageCircle',
    ]);
  });

  test('card geometry reserves overflow above the collapsed button', () => {
    expect(FLOATING_NAV_CARD_HEIGHT_PX).toBe(272);
    expect(FLOATING_NAV_EXPANDED_OVERFLOW_PX).toBe(224);
  });

  test('resolves the current surface by priority', () => {
    const all = {relayFrameOpen: false, settingsOpen: false, usageOpen: false, terminalOpen: false, previewOpen: false};
    expect(resolveFloatingNavCurrent(all)).toBe('chat');
    expect(resolveFloatingNavCurrent({...all, previewOpen: true})).toBe('preview');
    expect(resolveFloatingNavCurrent({...all, previewOpen: true, terminalOpen: true})).toBe('terminal');
    expect(resolveFloatingNavCurrent({...all, terminalOpen: true, usageOpen: true})).toBe('monitor');
    expect(resolveFloatingNavCurrent({...all, usageOpen: true, settingsOpen: true})).toBe('settings');
    expect(resolveFloatingNavCurrent({...all, settingsOpen: true, relayFrameOpen: true})).toBe('relay');
  });

  test('relay item mirrors bubble visibility and target availability', () => {
    expect(resolveFloatingNavRelayState({ready: false, frameUrl: 'http://x', hasTarget: true, frameOpen: false}))
      .toEqual({visible: false, frameOpen: false, enabled: true, active: false});
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: '', hasTarget: true, frameOpen: false}).visible).toBe(false);
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: 'http://x', hasTarget: false, frameOpen: false}))
      .toEqual({visible: true, frameOpen: false, enabled: false, active: false});
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: 'http://x', hasTarget: true, frameOpen: true}))
      .toEqual({visible: true, frameOpen: true, enabled: true, active: true});
  });
});
