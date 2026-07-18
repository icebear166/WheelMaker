import React, { type ReactNode, useState, useRef } from 'react';
import { getDesktopWindowBridge, openLocalDevPanelEvent } from '../../../platform/desktop/desktopRuntime';

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
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [localDevSource, setLocalDevSource] = useState('');
  const [localDevError, setLocalDevError] = useState('');

  if (!bridge) {
    return null;
  }

  const hasWindowsExtensions = Boolean(bridge.requestLocalDevMode || bridge.localDev);
  const openLocalDev = async () => {
    if (bridge.localDev) {
	  setExtensionsOpen(false);
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(openLocalDevPanelEvent));
      }
      return;
    }
    setLocalDevError('');
    try {
      await bridge.requestLocalDevMode?.(localDevSource.trim());
    } catch (error) {
      setLocalDevError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="desktop-window-controls" data-desktop-window-controls={true}>
      {hasWindowsExtensions ? (
        <div className="desktop-windows-extension-root" data-desktop-window-interactive={true}>
          <button
            type="button"
            className="desktop-titlebar-button desktop-windows-extension-button"
            aria-label="Windows extensions"
            aria-expanded={extensionsOpen}
            title="Windows extensions"
            onClick={() => setExtensionsOpen(open => !open)}
          >
            <span className="codicon codicon-extensions" aria-hidden="true" />
          </button>
          {extensionsOpen ? (
            <div className="desktop-windows-extension-menu" role="menu" aria-label="Windows extensions">
              {!bridge.localDev ? (
                <label className="desktop-windows-extension-source">
                  <span>Source directory</span>
                  <input
                    value={localDevSource}
                    placeholder="D:\\Code\\WheelMaker"
                    spellCheck={false}
                    onChange={event => setLocalDevSource(event.target.value)}
                  />
                </label>
              ) : null}
              <button type="button" role="menuitem" onClick={() => void openLocalDev()}>
                <span className="codicon codicon-tools" aria-hidden="true" />
                <span>Dev Mode</span>
              </button>
              {localDevError ? <p className="desktop-windows-extension-error" role="status">{localDevError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="desktop-titlebar-button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => invokeDesktopAction(bridge.minimize)}
      >
        <span className="codicon codicon-chrome-minimize" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="desktop-titlebar-button"
        aria-label="Maximize or restore"
        title="Maximize or restore"
        onClick={() => invokeDesktopAction(bridge.toggleMaximize)}
      >
        <span className="codicon codicon-chrome-maximize" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="desktop-titlebar-button desktop-titlebar-close"
        aria-label="Close"
        title="Close"
        onClick={() => invokeDesktopAction(bridge.close)}
      >
        <span className="codicon codicon-chrome-close" aria-hidden="true" />
      </button>
    </div>
  );
}
