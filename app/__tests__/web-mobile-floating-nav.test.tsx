import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {MobileFloatingNav} from '../web/src/shell/layouts/mobile/MobileFloatingNav';
import {
  FLOATING_NAV_CARD_HEIGHT_PX,
  FLOATING_NAV_EXPANDED_OVERFLOW_PX,
  FLOATING_NAV_ITEMS,
  resolveFloatingNavCurrent,
  resolveFloatingNavRelayState,
} from '../web/src/shell/layouts/mobile/mobileFloatingNavModel';

const relayOff = {visible: false, frameOpen: false, enabled: false, active: false};
const relayOn = {visible: true, frameOpen: false, enabled: true, active: false};

function renderNav(extra?: Partial<React.ComponentProps<typeof MobileFloatingNav>>) {
  const props: React.ComponentProps<typeof MobileFloatingNav> = {
    expanded: false,
    current: 'chat',
    previewActive: false,
    terminalActive: false,
    monitorActive: false,
    chatUnread: false,
    relay: relayOff,
    onSelect: jest.fn(),
    onCurrentSelect: jest.fn(),
    onButtonPointerDown: jest.fn(),
    ...extra,
  };
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<MobileFloatingNav {...props} />);
  });
  return {tree: tree!, props};
}

describe('MobileFloatingNav', () => {
  test('collapsed shows the current surface icon and optional unread dot', () => {
    const {tree} = renderNav({current: 'terminal', chatUnread: true});
    const button = tree.root.findByProps({className: 'floating-nav-button'});
    expect(button.findByType('svg').props['data-icon-name']).toBe('terminal');
    expect(button.findAllByProps({className: 'floating-nav-unread-dot'})).toHaveLength(1);
  });

  test('expanded renders one card item per destination, hiding relay when not visible', () => {
    const {tree} = renderNav({expanded: true});
    const items = tree.root.findAllByProps({className: 'floating-nav-card-item'});
    expect(items).toHaveLength(5);
    const withRelay = renderNav({expanded: true, relay: relayOn});
    expect(withRelay.tree.root.findAllByProps({className: 'floating-nav-card-item'})).toHaveLength(6);
  });

  test('relay item is disabled without a target and shows a status dot', () => {
    const {tree} = renderNav({expanded: true, relay: {visible: true, frameOpen: false, enabled: false, active: false}});
    const relayItem = tree.root.findByProps({title: 'Relay'});
    expect(relayItem.props.disabled).toBe(true);
    expect(relayItem.findAllByProps({className: 'floating-nav-relay-dot'})).toHaveLength(1);
  });

  test('selecting a destination forwards the callback; current item closes', () => {
    const onSelect = jest.fn();
    const onCurrentSelect = jest.fn();
    const {tree} = renderNav({expanded: true, current: 'chat', onSelect, onCurrentSelect});
    act(() => {
      tree.root.findByProps({title: 'Terminal'}).props.onClick();
    });
    expect(onSelect).toHaveBeenCalledWith('terminal');
    act(() => {
      tree.root.findByProps({title: 'Close navigation'}).props.onClick();
    });
    expect(onCurrentSelect).toHaveBeenCalledTimes(1);
  });
});


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
