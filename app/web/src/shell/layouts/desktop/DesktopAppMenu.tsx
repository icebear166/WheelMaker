import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {SessionIcon} from '../../../chat/sessionlist/SessionIcon';
import {useMenuExitFlag} from '../../../chat/sessionlist/menuExit';
import {checkDesktopUpdate, type DesktopUpdateCheck} from '../../../platform/desktop/desktopUpdate';
import {getDesktopWindowBridge, openLocalDevPanelEvent} from '../../../platform/desktop/desktopRuntime';

type DesktopAppMenuProps = {
  onOpenSettings: () => void;
};

export function DesktopAppMenu({onOpenSettings}: DesktopAppMenuProps) {
  const bridge = getDesktopWindowBridge();
  const [menuOpen, setMenuOpen, menuExiting] = useMenuExitFlag();
  const [localDevDialogOpen, setLocalDevDialogOpen] = useState(false);
  const [localDevSource, setLocalDevSource] = useState('');
  const [localDevError, setLocalDevError] = useState('');
  const [localDevBusy, setLocalDevBusy] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateCheck>({status: 'checking'});
  const [desktopUpdateBusy, setDesktopUpdateBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{left: number; top: number} | null>(null);
  const canUseLocalDev = Boolean(bridge?.requestLocalDevMode || bridge?.localDev);
  const canUpdateDesktop = Boolean(
    bridge?.getDesktopUpdateInfo && bridge.requestDesktopUpdate && !bridge.localDev,
  );

  const refreshDesktopUpdate = useCallback(async () => {
    if (!bridge || !canUpdateDesktop) {
      return;
    }
    setDesktopUpdate({status: 'checking'});
    setDesktopUpdate(await checkDesktopUpdate(bridge));
  }, [bridge, canUpdateDesktop]);

  useEffect(() => {
    void refreshDesktopUpdate();
  }, [refreshDesktopUpdate]);

  const updateMenuPosition = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (!triggerRect) {
      return;
    }
    setMenuPosition({
      left: triggerRect.left,
      top: triggerRect.bottom + 6,
    });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen || typeof window.addEventListener !== 'function') {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || menuRef.current?.contains(target))) {
        return;
      }
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, setMenuOpen]);

  const selectLocalDev = () => {
    setMenuOpen(false);
    if (!bridge) {
      return;
    }
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
      if (!sourcePath) {
        setLocalDevError('Enter the WheelMaker source directory.');
      }
      return;
    }
    setLocalDevError('');
    setLocalDevBusy(true);
    try {
      await bridge?.requestLocalDevMode?.(sourcePath);
    } catch (error) {
      setLocalDevError(error instanceof Error ? error.message : String(error));
    } finally {
      setLocalDevBusy(false);
    }
  };

  const selectDesktopUpdate = async () => {
    if (desktopUpdateBusy) {
      return;
    }
    if (desktopUpdate.status === 'failed') {
      await refreshDesktopUpdate();
      return;
    }
    if (desktopUpdate.status !== 'available' || !bridge?.requestDesktopUpdate) {
      return;
    }
    setDesktopUpdateBusy(true);
    try {
      await bridge.requestDesktopUpdate();
    } catch {
      setDesktopUpdate({status: 'failed'});
      setDesktopUpdateBusy(false);
    }
  };

  const desktopUpdateLabel = desktopUpdateBusy
    ? 'Starting Desktop update…'
    : desktopUpdate.status === 'checking'
      ? 'Checking Desktop update…'
      : desktopUpdate.status === 'current'
        ? 'Desktop is up to date'
        : desktopUpdate.status === 'available'
          ? `Update Desktop to ${desktopUpdate.version}`
          : 'Check failed · Retry';

  const appMenu = menuOpen ? (
    <div
      ref={menuRef}
      className={`desktop-app-menu topbar-menu-surface${menuExiting ? ' sl-menu-exit' : ''}`}
      role="menu"
      aria-label="WheelMaker menu"
      style={menuPosition ?? undefined}
      data-desktop-window-interactive={true}
    >
      <button
        type="button"
        role="menuitem"
        data-desktop-app-action="settings"
        onClick={() => {
          setMenuOpen(false);
          onOpenSettings();
        }}
      >
        <SessionIcon name="settings" />
        <span>Settings</span>
      </button>
      {canUseLocalDev ? (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={Boolean(bridge?.localDev)}
          data-desktop-app-action="local-dev"
          onClick={selectLocalDev}
        >
          {bridge?.localDev ? (
            <SessionIcon name="check" />
          ) : (
            <span className="desktop-app-menu-leading-slot" aria-hidden="true" />
          )}
          <span>Dev Mode</span>
        </button>
      ) : null}
      {canUpdateDesktop ? (
        <button
          type="button"
          role="menuitem"
          data-desktop-app-action="desktop-update"
          disabled={desktopUpdateBusy || desktopUpdate.status === 'checking' || desktopUpdate.status === 'current'}
          onClick={() => void selectDesktopUpdate()}
        >
          {desktopUpdate.status === 'available' ? (
            <span className="desktop-update-dot desktop-update-dot-menu" data-desktop-update-dot="menu" aria-hidden="true" />
          ) : (
            <span className="desktop-app-menu-leading-slot" aria-hidden="true" />
          )}
          <span data-desktop-update-label={true}>{desktopUpdateLabel}</span>
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <div className="desktop-app-menu-root" ref={rootRef} data-desktop-window-interactive={true}>
        <button
          ref={triggerRef}
          type="button"
          className="desktop-app-menu-trigger"
          aria-label="Open WheelMaker menu"
          aria-expanded={menuOpen}
          title="WheelMaker menu"
          onClick={() => setMenuOpen(open => !open)}
        >
          <span className="app-product-mark" aria-hidden="true" />
          {canUpdateDesktop && desktopUpdate.status === 'available' ? (
            <span className="desktop-update-dot desktop-update-dot-app-menu" data-desktop-update-dot="app-menu" aria-hidden="true" />
          ) : null}
        </button>
      </div>
      {appMenu && typeof document !== 'undefined' ? createPortal(appMenu, document.body) : appMenu}
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
