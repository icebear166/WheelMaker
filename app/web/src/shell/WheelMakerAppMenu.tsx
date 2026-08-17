import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';
import {Icon, type IconName} from '../common/Icon';
import {useMenuExitFlag} from '../chat/sessionlist/menuExit';
import {
  focusFirstMenuItem,
  handleMenuKeyDown,
} from '../common/menuKeyboardNavigation';
import {
  clientUpdateView,
  type ClientUpdateState,
} from '../platform/clientUpdate';
import {
  getDesktopWindowBridge,
  openLocalDevPanelEvent,
} from '../platform/desktop/desktopRuntime';

export type ClientUpdateController = {
  check: () => Promise<ClientUpdateState>;
  start: () => Promise<void>;
  subscribe?: (listener: (state: ClientUpdateState) => void) => () => void;
};

export type WheelMakerAppMenuProps = {
  themeMode: 'dark' | 'light';
  setThemeMode: (mode: 'dark' | 'light') => void;
  onMenuOpen?: () => void;
  onOpenSettings: () => void;
  onOpenPortRelay: () => void;
  onOpenShares?: () => void;
  onOpenReleasePublishing: () => void;
  updateController?: ClientUpdateController | null;
  triggerClassName?: string;
};

type MenuRowProps = {
  action: string;
  icon: IconName;
  label: string;
  meta?: string;
  disabled?: boolean;
  checked?: boolean;
  attention?: boolean;
  onClick: () => void;
};

function MenuRow({
  action,
  icon,
  label,
  meta,
  disabled = false,
  checked,
  attention = false,
  onClick,
}: MenuRowProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      data-app-menu-action={action}
      data-app-menu-meta={meta}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="app-menu-icon-slot" aria-hidden="true">
        <Icon name={checked ? 'check' : icon} />
        {attention ? (
          <span
            className="desktop-update-dot app-menu-row-update-dot"
            data-client-update-dot="menu"
          />
        ) : null}
      </span>
      <span className="app-menu-label">{label}</span>
      {meta ? <span className="app-menu-meta">{meta}</span> : null}
    </button>
  );
}

export function WheelMakerAppMenu({
  themeMode,
  setThemeMode,
  onMenuOpen,
  onOpenSettings,
  onOpenPortRelay,
  onOpenShares,
  onOpenReleasePublishing,
  updateController = null,
  triggerClassName = '',
}: WheelMakerAppMenuProps) {
  const desktopBridge = getDesktopWindowBridge();
  const [menuOpen, setMenuOpen, menuExiting] = useMenuExitFlag();
  const [localDevDialogOpen, setLocalDevDialogOpen] = useState(false);
  const [localDevSource, setLocalDevSource] = useState('');
  const [localDevError, setLocalDevError] = useState('');
  const [localDevBusy, setLocalDevBusy] = useState(false);
  const [updateState, setUpdateState] = useState<ClientUpdateState>({status: 'checking'});
  const [menuPosition, setMenuPosition] = useState<{left: number; top: number} | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const localDevDialogRef = useRef<HTMLElement | null>(null);
  const localDevBusyRef = useRef(false);
  const updateStartPendingRef = useRef(false);
  const canUseLocalDev = Boolean(
    desktopBridge?.requestLocalDevMode || desktopBridge?.localDev,
  );
  const updateView = clientUpdateView(updateState);
  const currentTheme = themeMode === 'dark' ? 'Dark' : 'Light';

  useEffect(() => {
    localDevBusyRef.current = localDevBusy;
  }, [localDevBusy]);

  useEffect(
    () => updateController?.subscribe?.(setUpdateState),
    [updateController],
  );

  useEffect(() => {
    if (!localDevDialogOpen || typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFirstControl = () => {
      const dialog = localDevDialogRef.current;
      const firstControl = dialog?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled])',
      );
      firstControl?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !localDevBusyRef.current) {
        event.preventDefault();
        setLocalDevDialogOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = localDevDialogRef.current;
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    focusFirstControl();
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [localDevDialogOpen]);

  const checkForUpdate = useCallback(async () => {
    if (!updateController) return;
    updateStartPendingRef.current = false;
    setUpdateState({status: 'checking'});
    try {
      setUpdateState(await updateController.check());
    } catch {
      setUpdateState({status: 'failed'});
    }
  }, [updateController]);

  const toggleMenu = useCallback(() => {
    if (!menuOpen) {
      onMenuOpen?.();
    }
    if ((!menuOpen || menuExiting) && updateController) {
      void checkForUpdate();
    }
    setMenuOpen(open => !open);
  }, [checkForUpdate, menuExiting, menuOpen, onMenuOpen, setMenuOpen, updateController]);

  const updateMenuPosition = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (!triggerRect) return;
    const maximumLeft = typeof window === 'undefined'
      ? triggerRect.left
      : Math.max(8, window.innerWidth - 288);
    setMenuPosition({
      left: Math.max(8, Math.min(triggerRect.left, maximumLeft)),
      top: triggerRect.bottom + 6,
    });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    updateMenuPosition();
    focusFirstMenuItem(menuRef.current);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen || typeof window.addEventListener !== 'function') {
      return undefined;
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
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, setMenuOpen]);

  const closeAndRun = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  const selectUpdate = async () => {
    if (!updateController) return;
    if (updateState.status === 'failed') {
      await checkForUpdate();
      return;
    }
    if (updateState.status !== 'available' || updateStartPendingRef.current) return;
    updateStartPendingRef.current = true;
    setUpdateState({status: 'updating', meta: 'Starting…'});
    try {
      await updateController.start();
    } catch {
      updateStartPendingRef.current = false;
      setUpdateState({status: 'failed'});
    }
  };

  const selectLocalDev = () => {
    setMenuOpen(false);
    if (!desktopBridge) return;
    if (desktopBridge.localDev) {
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
      await desktopBridge?.requestLocalDevMode?.(sourcePath);
    } catch (error) {
      setLocalDevError(error instanceof Error ? error.message : String(error));
    } finally {
      setLocalDevBusy(false);
    }
  };

  const appMenu = menuOpen ? (
    <div
      ref={menuRef}
      className={`app-menu-surface topbar-menu-surface${menuExiting ? ' sl-menu-exit' : ''}`}
      role="menu"
      aria-label="WheelMaker menu"
      style={menuPosition ?? undefined}
      data-desktop-window-interactive={true}
      onKeyDown={event => handleMenuKeyDown(event, menuRef.current)}
    >
      <MenuRow
        action="settings"
        icon="settings"
        label="Settings"
        onClick={() => closeAndRun(onOpenSettings)}
      />
      <MenuRow
        action="theme"
        icon={themeMode === 'dark' ? 'moon' : 'sun'}
        label="Theme"
        meta={currentTheme}
        onClick={() => {
          setThemeMode(themeMode === 'dark' ? 'light' : 'dark');
        }}
      />
      <MenuRow
        action="port-relay"
        icon="radioTower"
        label="Port Relay"
        onClick={() => closeAndRun(onOpenPortRelay)}
      />
      <MenuRow
        action="shares"
        icon="share"
        label="Public shares"
        onClick={() => closeAndRun(() => onOpenShares?.())}
      />
      {updateController ? (
        <MenuRow
          action="update"
          icon="circleArrowUp"
          label="Update"
          meta={updateView.meta}
          disabled={updateView.disabled}
          attention={updateView.showDot}
          onClick={() => void selectUpdate()}
        />
      ) : null}
      <div className="app-menu-divider" role="separator" />
      <MenuRow
        action="release-publish"
        icon="uploadCloud"
        label="Release publishing"
        onClick={() => closeAndRun(onOpenReleasePublishing)}
      />
      {canUseLocalDev ? (
        <MenuRow
          action="local-dev"
          icon="laptop"
          label="Dev Mode"
          meta={desktopBridge?.localDev ? 'On' : undefined}
          checked={Boolean(desktopBridge?.localDev)}
          onClick={selectLocalDev}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <div className="app-menu-root" ref={rootRef} data-desktop-window-interactive={true}>
        <button
          ref={triggerRef}
          type="button"
          className={`app-menu-trigger ${triggerClassName}`.trim()}
          aria-label="Open WheelMaker menu"
          aria-expanded={menuOpen}
          data-tooltip="WheelMaker menu"
          onClick={toggleMenu}
        >
          <img className="app-product-mark" src="/icons/icon-mark.svg?v=20260807" alt="" aria-hidden="true" />
          {updateController && updateView.showDot ? (
            <span
              className="desktop-update-dot app-menu-update-dot"
              data-client-update-dot="app-menu"
              aria-hidden="true"
            />
          ) : null}
        </button>
      </div>
      {appMenu && typeof document !== 'undefined'
        ? createPortal(appMenu, document.body)
        : appMenu}
      {localDevDialogOpen ? (
        <div
          className="local-dev-entry-backdrop"
          data-desktop-window-interactive={true}
          onPointerDown={event => {
            if (event.currentTarget === event.target && !localDevBusy) {
              setLocalDevDialogOpen(false);
            }
          }}
        >
          <section
            ref={localDevDialogRef}
            className="local-dev-entry-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Configure Local Dev"
          >
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
                onChange={event => setLocalDevSource(event.target.value)}
              />
            </label>
            {localDevError ? (
              <p className="local-dev-entry-error" role="status">{localDevError}</p>
            ) : null}
            <footer>
              <button
                type="button"
                className="secondary"
                disabled={localDevBusy}
                onClick={() => setLocalDevDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                data-local-dev-enter={true}
                disabled={localDevBusy}
                onClick={() => void enterLocalDev()}
              >
                {localDevBusy ? 'Entering…' : 'Enter Dev Mode'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
