import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import { getDesktopWindowBridge, type DesktopWebSourceState } from '../../../platform/desktop/desktopRuntime';
import {
  readDesktopWebSourceState,
  setDesktopWebSourcePreference,
} from '../../../platform/desktop/webSource';

type DesktopDragRegionProps = {
  className: string;
  children: ReactNode;
};

type DesktopSourcePreference = 'auto' | 'embedded';

function invokeDesktopAction(action: (() => Promise<void> | void) | undefined) {
  void action?.();
}

function isDesktopWindowSourceTarget(target: EventTarget | null) {
  const targetElement = target as { closest?: (selector: string) => Element | null } | null;
  return typeof targetElement?.closest === 'function'
    && Boolean(targetElement.closest('[data-desktop-window-source-root]'));
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

export function DesktopWindowSourceButton() {
  const bridge = getDesktopWindowBridge();
  const [webSourceState, setWebSourceState] = useState<DesktopWebSourceState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readDesktopWebSourceState().then(state => {
      if (!cancelled) {
        setWebSourceState(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!panelOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const closePanel = (event: PointerEvent) => {
      if (isDesktopWindowSourceTarget(event.target)) {
        return;
      }
      setPanelOpen(false);
    };
    window.addEventListener('pointerdown', closePanel);
    return () => window.removeEventListener('pointerdown', closePanel);
  }, [panelOpen]);

  if (!bridge) {
    return null;
  }

  const actualSourceLabel = webSourceState?.displaySource || '';
  const hasRemoteWebSource = Boolean(webSourceState?.remoteUrl && webSourceState.remoteHost && bridge.setWebSourcePreference);
  const remoteSourceLabel = webSourceState?.remoteHost || webSourceState?.displaySource || 'Auto';
  const sourceTitle = webSourceState?.remoteUrl || actualSourceLabel;

  const handleWebSourcePreferenceSelect = async (preference: DesktopSourcePreference) => {
    setPanelOpen(false);
    const nextState = await setDesktopWebSourcePreference(preference);
    if (nextState) {
      setWebSourceState(nextState);
    }
    window.location.reload();
  };

  const handleWebSourceRefresh = () => {
    setPanelOpen(false);
    window.location.reload();
  };

  return (
    <div className="desktop-window-source-root" data-desktop-window-source-root={true}>
      <button
        type="button"
        className="desktop-window-source-button"
        aria-label="Show source"
        title="Source"
        aria-haspopup="menu"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(open => !open)}
      >
        <span className="codicon codicon-info" aria-hidden="true" />
      </button>
      {panelOpen ? (
        <div className="desktop-window-source-popover" role="menu">
          {webSourceState ? (
            <div className="desktop-window-source-panel">
              <div className="desktop-window-source-current" title={sourceTitle}>
                {actualSourceLabel}
              </div>
              {hasRemoteWebSource ? (
                <>
                  <button
                    type="button"
                    className="desktop-window-source-refresh"
                    aria-label="Refresh web source"
                    title="Refresh web source"
                    onClick={handleWebSourceRefresh}
                  >
                    <span className="codicon codicon-refresh" aria-hidden="true" />
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    className="desktop-window-source-choice"
                    role="menuitemradio"
                    aria-checked={webSourceState.preference === 'auto'}
                    title={webSourceState.remoteUrl}
                    onClick={() => void handleWebSourcePreferenceSelect('auto')}
                  >
                    {remoteSourceLabel}
                  </button>
                  <button
                    type="button"
                    className="desktop-window-source-choice"
                    role="menuitemradio"
                    aria-checked={webSourceState.preference === 'embedded'}
                    onClick={() => void handleWebSourcePreferenceSelect('embedded')}
                  >
                    Embedded
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <div className="desktop-window-source-panel">
              <div className="desktop-window-source-current">Source unavailable</div>
            </div>
          )}
        </div>
      ) : null}
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
      <DesktopWindowSourceButton />
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
