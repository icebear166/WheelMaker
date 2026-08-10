import React, {useEffect, useRef} from 'react';
import {focusFirstMenuItem, handleMenuKeyDown} from './menuKeyboardNavigation';
import {ChatIcon} from '../chat/ChatIcon';
import type {ContextMenuModel, FileMenuAction} from '../file/fileMenuModel';

type ContextMenuProps<Action extends string = FileMenuAction> = {
  x: number;
  y: number;
  model: ContextMenuModel<Action>;
  onAction: (action: Action) => void;
  onClose: () => void;
  className: string;
  itemClassName?: string;
  separatorClassName?: string;
  ariaLabel?: string;
  exiting?: boolean;
};

export function ContextMenu<Action extends string = FileMenuAction>({
  x,
  y,
  model,
  onAction,
  onClose,
  className,
  itemClassName,
  separatorClassName,
  ariaLabel,
  exiting = false,
}: ContextMenuProps<Action>) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = typeof document !== 'undefined' &&
      typeof HTMLElement !== 'undefined' &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    focusFirstMenuItem(menuRef.current);
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        previouslyFocusedRef.current?.focus();
        onClose();
      }
    };
    const handleClose = () => onClose();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={`${className}${exiting ? ' sl-menu-exit' : ''}`}
      style={{left: x, top: y}}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={event => handleMenuKeyDown(event, menuRef.current)}
    >
      {model.groups.map((group, groupIndex) => (
        <React.Fragment key={group.id}>
          {groupIndex > 0 ? (
            <div
              className={separatorClassName || `${className}-separator`}
              role="separator"
            />
          ) : null}
          {group.items.map(item => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              className={itemClassName}
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) onAction(item.action);
              }}
            >
              <ChatIcon name={item.icon} spin={item.busy} />
              <span>{item.label}</span>
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
