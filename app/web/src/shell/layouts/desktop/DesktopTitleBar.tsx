import React, { type ReactNode, useRef } from 'react';
import {Icon} from '../../../common/Icon';
import { getDesktopWindowBridge } from '../../../platform/desktop/desktopRuntime';

type DesktopDragRegionProps = {
  className: string;
  children: ReactNode;
};

function invokeDesktopAction(action: (() => Promise<void> | void) | undefined) {
  void action?.();
}

function isDesktopDragInteractiveTarget(target: EventTarget | null) {
  const targetElement = target as { closest?: (selector: string) => Element | null } | null;
  return typeof targetElement?.closest === 'function'
    && Boolean(targetElement.closest('button, select, input, textarea, [contenteditable="true"], [role="dialog"], [data-desktop-window-interactive]'));
}

export function DesktopDragRegion({ className, children }: DesktopDragRegionProps) {
  const bridge = getDesktopWindowBridge();
  const suppressNextDoubleClickRef = useRef(false);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!bridge || event.button !== 0) {
      return;
    }
    if (isDesktopDragInteractiveTarget(event.target)) {
      return;
    }
    event.preventDefault();
    if (event.detail >= 2) {
      suppressNextDoubleClickRef.current = true;
      invokeDesktopAction(bridge.toggleMaximize);
      return;
    }
    invokeDesktopAction(bridge.startDrag);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!bridge || isDesktopDragInteractiveTarget(event.target)) {
      suppressNextDoubleClickRef.current = false;
      return;
    }
    if (suppressNextDoubleClickRef.current) {
      suppressNextDoubleClickRef.current = false;
      return;
    }
    invokeDesktopAction(bridge.toggleMaximize);
  };

  return (
    <div
      className={`${className} desktop-drag-region`}
      data-desktop-drag-region={true}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </div>
  );
}

export function DesktopWindowControls() {
  const bridge = getDesktopWindowBridge();

  if (!bridge) {
    return null;
  }

  return (
    <div className="desktop-window-controls" data-desktop-window-controls={true}>
      <button
        type="button"
        className="desktop-titlebar-button"
        aria-label="Minimize"
        onClick={() => invokeDesktopAction(bridge.minimize)}
      >
        <Icon name="minus" />
      </button>
      <button
        type="button"
        className="desktop-titlebar-button"
        aria-label="Maximize or restore"
        onClick={() => invokeDesktopAction(bridge.toggleMaximize)}
      >
        <Icon name="square" />
      </button>
      <button
        type="button"
        className="desktop-titlebar-button desktop-titlebar-close"
        aria-label="Close"
        onClick={() => invokeDesktopAction(bridge.close)}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
