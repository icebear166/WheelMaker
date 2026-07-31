import fs from 'fs';
import path from 'path';
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

const relayOff = {frameOpen: false, enabled: false, active: false};
const relayOn = {frameOpen: false, enabled: true, active: false};

function renderNav(extra?: Partial<React.ComponentProps<typeof MobileFloatingNav>>) {
  const props: React.ComponentProps<typeof MobileFloatingNav> = {
    expanded: false,
    current: 'chat',
    previewActive: false,
    previewTabCount: 0,
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

  test('expanded renders one card item per destination, relay always present', () => {
    const {tree} = renderNav({expanded: true});
    // The anchor keeps the stack at button height so the card cannot shift.
    expect(tree.root.findAllByProps({className: 'floating-nav-expanded-anchor'})).toHaveLength(1);
    const items = tree.root.findAllByProps({className: 'floating-nav-card-item'});
    expect(items).toHaveLength(6);
    const withRelay = renderNav({expanded: true, relay: relayOn});
    expect(withRelay.tree.root.findAllByProps({className: 'floating-nav-card-item'})).toHaveLength(6);
  });

  test('expanded shows the preview tab count on the Preview shortcut', () => {
    const {tree} = renderNav({expanded: true, previewTabCount: 3});
    const previewItem = tree.root.findByProps({title: 'Preview'});
    const badge = previewItem.findByProps({className: 'chat-preview-badge'});

    expect(badge.props['aria-label']).toBe('3 preview tabs');
    expect(badge.children).toEqual(['3']);
  });

  test('does not show a Preview badge when there are no preview tabs', () => {
    const {tree} = renderNav({expanded: true, previewTabCount: 0});
    const previewItem = tree.root.findByProps({title: 'Preview'});

    expect(previewItem.findAllByProps({className: 'chat-preview-badge'})).toHaveLength(0);
  });

  test('relay item dims when the frame cannot open and shows a status dot', () => {
    const {tree} = renderNav({expanded: true, relay: {frameOpen: false, enabled: false, active: false}});
    const relayItem = tree.root.findByProps({title: 'Relay'});
    expect(relayItem.props['data-enabled']).toBe(false);
    expect(relayItem.props.disabled).toBeUndefined();
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
      'appWindow', 'terminal', 'radioTower', 'activity', 'settings', 'messageCircle',
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

  test('relay item is always present; enabled only when the frame can open', () => {
    expect(resolveFloatingNavRelayState({ready: false, frameUrl: 'http://x', hasTarget: true, frameOpen: false}))
      .toEqual({frameOpen: false, enabled: false, active: false});
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: '', hasTarget: true, frameOpen: false}).enabled).toBe(false);
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: 'http://x', hasTarget: false, frameOpen: false}))
      .toEqual({frameOpen: false, enabled: false, active: false});
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: 'http://x', hasTarget: true, frameOpen: false}))
      .toEqual({frameOpen: false, enabled: true, active: false});
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: 'http://x', hasTarget: true, frameOpen: true}))
      .toEqual({frameOpen: true, enabled: true, active: true});
  });
});

function readMain(): string {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

describe('floating nav wiring', () => {
  test('resolves current surface and relay state through the model', () => {
    const main = readMain();

    expect(main).toContain('resolveFloatingNavCurrent({');
    expect(main).toContain('relayFrameOpen: mobilePortRelayFrameOpen');
    expect(main).toContain('resolveFloatingNavRelayState({');
    expect(main).toContain('ready: portRelayReady');
    expect(main).toContain('frameUrl: portRelayFrameUrl');
    expect(main).toContain('expandedOverflowPx: floatingKeyboardOffset > 0 ? 0 : FLOATING_NAV_EXPANDED_OVERFLOW_PX');
  });

  test('merges relay into the nav and drops the standalone bubble', () => {
    const main = readMain();

    expect(main).not.toContain('PortRelayFloatingButton');
    expect(main).not.toContain('handlePortRelayFloatingPointerDown');
    expect(main).not.toContain('finishPortRelayFloatingPress');
    expect(main).not.toContain('PORT_RELAY_TARGET_MENU_LONG_PRESS_MS');
    expect(main).not.toContain('portRelayTargetMenuOpen');
    expect(main).not.toContain("mobilePortRelayFrameOpen ? null : (");
    expect(main).toContain('handleFloatingNavSelect');
    expect(main).toContain('mobileRelayTargetSheet');
    expect(main).toContain('useMenuExitState');
  });

  test('moves the preview tab count into the mobile Preview shortcut', () => {
    const main = readMain();

    expect(main).toContain('previewTabCount={previewTabCount}');
  });

  test('relay frame chrome uses lucide icons', () => {
    const surface = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'portRelay', 'PortRelayFrameSurface.tsx'),
      'utf8',
    );

    expect(surface).not.toContain('codicon');
    expect(surface).not.toContain('PortRelayFloatingButton');
    expect(surface).toContain("from '../common/Icon'");
  });
});
