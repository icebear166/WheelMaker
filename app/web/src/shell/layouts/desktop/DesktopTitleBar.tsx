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
  const [localDevDialogOpen, setLocalDevDialogOpen] = useState(false);
  const [localDevSource, setLocalDevSource] = useState('');
  const [localDevError, setLocalDevError] = useState('');
  const [localDevBusy, setLocalDevBusy] = useState(false);

  if (!bridge) {
    return null;
  }

  const hasWindowsExtensions = Boolean(bridge.requestLocalDevMode || bridge.localDev);
  const selectLocalDev = () => {
    setExtensionsOpen(false);
    if (bridge.localDev) {
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(openLocalDevPanelEvent));
      }
      return;
    }
    setLocalDevError('');
    setLocalDevDialogOpen(true);
  };
  const enterLocalDev = async () => {
    const sourcePath = localDevSource.trim();
    if (!sourcePath || localDevBusy) {
      if (!sourcePath) setLocalDevError('Enter the WheelMaker source directory.');
      return;
    }
    setLocalDevError('');
    setLocalDevBusy(true);
    try {
      await bridge.requestLocalDevMode?.(sourcePath);
    } catch (error) {
      setLocalDevError(error instanceof Error ? error.message : String(error));
    } finally {
      setLocalDevBusy(false);
    }
  };

  return (
    <>
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
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={Boolean(bridge.localDev)}
                  onClick={selectLocalDev}
                >
                  <span
                    className={`codicon ${bridge.localDev ? 'codicon-check' : 'codicon-blank'}`}
                    data-local-dev-check={Boolean(bridge.localDev) || undefined}
                    aria-hidden="true"
                  />
                  <span>Dev Mode</span>
                </button>
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
      {localDevDialogOpen ? (
        <div className="local-dev-entry-backdrop" data-desktop-window-interactive={true}>
          <section className="local-dev-entry-dialog" role="dialog" aria-modal="true" aria-label="Configure Local Dev">
            <header>
              <span className="local-dev-entry-eyebrow">Windows extension</span>
              <h2>Enter Dev Mode</h2>
              <p>Build and run WheelMaker from a local source checkout.</p>
            </header>
            <label>
              <span>Source directory</span>
              <input
                aria-label="WheelMaker source directory"
                value={localDevSource}
                placeholder="E:\\_Code\\WheelMaker"
                spellCheck={false}
                autoFocus
                onChange={event => setLocalDevSource(event.target.value)}
              />
            </label>
            {localDevError ? <p className="local-dev-entry-error" role="status">{localDevError}</p> : null}
            <footer>
              <button type="button" className="secondary" disabled={localDevBusy} onClick={() => setLocalDevDialogOpen(false)}>Cancel</button>
              <button type="button" className="primary" data-local-dev-enter={true} disabled={localDevBusy} onClick={() => void enterLocalDev()}>
                {localDevBusy ? 'Entering…' : 'Enter Dev Mode'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
