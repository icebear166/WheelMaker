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
  previewTabCount: number;
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
  previewTabCount,
  terminalActive,
  monitorActive,
  chatUnread,
  relay,
  onSelect,
  onCurrentSelect,
  onButtonPointerDown,
}: MobileFloatingNavProps) {
  const previewBadge = previewTabCount > 0 ? (
    <span className="chat-preview-badge" aria-label={`${previewTabCount} preview tabs`}>
      {previewTabCount}
    </span>
  ) : null;
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
        {current === 'preview' ? previewBadge : null}
        {chatUnread ? <span className="floating-nav-unread-dot" aria-hidden="true" /> : null}
      </button>
    );
  }
  return (
    <div className="floating-nav-expanded-anchor">
      <div
        className="floating-nav-card"
        role="menu"
        aria-label="Navigate"
        onPointerDown={onButtonPointerDown}
      >
      {FLOATING_NAV_ITEMS.map(item => {
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
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="floating-nav-card-item"
            data-active={active}
            data-enabled={item.id === 'relay' ? relay.enabled : true}
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
            {item.id === 'preview' ? previewBadge : null}
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
    </div>
  );
}
