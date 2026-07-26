import React from 'react';
import {Icon} from '../../../common/Icon';
import {
  FLOATING_NAV_ITEMS,
  type FloatingNavDestination,
  type FloatingNavRelayState,
} from './mobileFloatingNavModel';

export type MobileFloatingNavProps = {
  expanded: boolean;
  current: FloatingNavDestination;
  previewActive: boolean;
  terminalActive: boolean;
  monitorActive: boolean;
  chatUnread: boolean;
  relay: FloatingNavRelayState;
  onSelect: (destination: FloatingNavDestination) => void;
  onCurrentSelect: () => void;
  onButtonPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
};

export function MobileFloatingNav({
  expanded,
  current,
  previewActive,
  terminalActive,
  monitorActive,
  chatUnread,
  relay,
  onSelect,
  onCurrentSelect,
  onButtonPointerDown,
}: MobileFloatingNavProps) {
  if (!expanded) {
    const currentItem = FLOATING_NAV_ITEMS.find(item => item.id === current)
      ?? FLOATING_NAV_ITEMS[FLOATING_NAV_ITEMS.length - 1];
    return (
      <button
        type="button"
        className="floating-nav-button"
        data-current={current}
        onPointerDown={onButtonPointerDown}
        onClick={onCurrentSelect}
        title="Open navigation"
        aria-label="Open navigation"
        aria-haspopup="menu"
        aria-expanded={false}
      >
        <Icon name={currentItem.icon} size={20} />
        {chatUnread ? <span className="floating-nav-unread-dot" aria-hidden="true" /> : null}
      </button>
    );
  }
  return (
    <div
      className="floating-nav-card"
      role="menu"
      aria-label="Navigate"
      onPointerDown={onButtonPointerDown}
    >
      {FLOATING_NAV_ITEMS.map(item => {
        if (item.id === 'relay' && !relay.visible) {
          return null;
        }
        const isCurrent = item.id === current;
        const active = item.id === 'preview'
          ? previewActive
          : item.id === 'terminal'
            ? terminalActive
            : item.id === 'monitor'
              ? monitorActive
              : item.id === 'relay'
                ? relay.active
                : isCurrent;
        const disabled = item.id === 'relay' && !relay.enabled;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="floating-nav-card-item"
            data-active={active}
            disabled={disabled}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => {
              if (isCurrent) {
                onCurrentSelect();
                return;
              }
              onSelect(item.id);
            }}
            title={isCurrent ? 'Close navigation' : item.label}
            aria-label={isCurrent ? 'Close navigation' : item.label}
            aria-pressed={active}
          >
            <Icon name={item.icon} size={20} />
            {item.id === 'chat' && chatUnread ? (
              <span className="floating-nav-unread-dot" aria-hidden="true" />
            ) : null}
            {item.id === 'relay' ? (
              <span className="floating-nav-relay-dot" data-on={relay.active} aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
