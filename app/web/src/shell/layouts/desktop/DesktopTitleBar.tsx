import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import { getDesktopWindowBridge, type DesktopWebSourceState } from '../../../platform/desktop/desktopRuntime';
import {
  readDesktopWebSourceState,
  setDesktopWebSourcePreference,
} from '../../../platform/desktop/webSource';

type DesktopWindowControlsProps = {
  onSettingsSelect?: () => void;
};

type DesktopDragRegionProps = {
  className: string;
  children: ReactNode;
};

type DesktopSourcePreference = 'auto' | 'embedded';

function invokeDesktopAction(action: (() => Promise<void> | void) | undefined) {
  void action?.();
}

function isDesktopWindowControlsTarget(target: EventTarget | null) {
  const targetElement = target as { closest?: (selector: string) => Element | null } | null;
  return typeof targetElement?.closest === 'function'
    && Boolean(targetElement.closest('[data-desktop-window-menu-root]'));
}

function isDesktopDragInteractiveTarget(target: EventTarget | null) {
  const targetElement = target as { closest?: (selector: string) => Element | null } | null;
  return typeof targetElement?.closest === 'function'
    && Boolean(targetElement.closest('button, select, input, textarea, [contenteditable="true"], [role="dialog"], [data-desktop-window-interactive]'));
}

function DesktopTitleBarIcon() {
  return (
    <svg
      className="desktop-titlebar-icon"
      viewBox="300 420 930 690"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id="desktopTitlebarIconBlueMark"
          x1="339"
          y1="448"
          x2="940"
          y2="1098"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#48C1FF" />
          <stop offset="0.48" stopColor="#29A8FF" />
          <stop offset="1" stopColor="#168FF0" />
        </linearGradient>
        <linearGradient
          id="desktopTitlebarIconWhiteMark"
          x1="848"
          y1="508"
          x2="1208"
          y2="1072"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.64" stopColor="#FAFAFA" />
          <stop offset="1" stopColor="#F1F2F6" />
        </linearGradient>
        <filter
          id="desktopTitlebarIconSoftOuter"
          x="-80"
          y="-80"
          width="1696"
          height="1696"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx="0" dy="18" stdDeviation="26" floodColor="#000000" floodOpacity="0.55" />
          <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#1D5AA5" floodOpacity="0.35" />
        </filter>
        <filter
          id="desktopTitlebarIconLogoShadow"
          x="260"
          y="390"
          width="1010"
          height="760"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#000814" floodOpacity="0.48" />
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#1D5AA5" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#desktopTitlebarIconLogoShadow)" data-desktop-titlebar-icon-mark={true}>
        <path d="M325 462 L456 607 L457 847 L644 650 L1026 1073 L853 1073 L637 843 L424 1073 L326 1073 Z" fill="url(#desktopTitlebarIconBlueMark)" />
        <path d="M674 628 H871 L768 746 Z" fill="url(#desktopTitlebarIconBlueMark)" />
        <path d="M1209 462 L974 729 L895 648 L787 768 L948 943 L1079 798 L1079 1071 L1209 1071 Z" fill="url(#desktopTitlebarIconWhiteMark)" />
      </g>
    </svg>
  );
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

export function DesktopWindowMenu() {
  const bridge = getDesktopWindowBridge();
  const [webSourceState, setWebSourceState] = useState<DesktopWebSourceState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);

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
    if (!menuOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const closeMenu = (event: PointerEvent) => {
      if (isDesktopWindowControlsTarget(event.target)) {
        return;
      }
      setMenuOpen(false);
      setSourcePanelOpen(false);
    };
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [menuOpen]);

  if (!bridge) {
    return null;
  }

  const actualSourceLabel = webSourceState?.displaySource || '';
  const hasRemoteWebSource = Boolean(webSourceState?.remoteUrl && webSourceState.remoteHost && bridge.setWebSourcePreference);
  const remoteSourceLabel = webSourceState?.remoteHost || webSourceState?.displaySource || 'Auto';
  const sourceTitle = webSourceState?.remoteUrl || actualSourceLabel;

  const handleWebSourcePreferenceSelect = async (preference: DesktopSourcePreference) => {
    setMenuOpen(false);
    setSourcePanelOpen(false);
    const nextState = await setDesktopWebSourcePreference(preference);
    if (nextState) {
      setWebSourceState(nextState);
    }
    window.location.reload();
  };

  const handleWebSourceRefresh = () => {
    setMenuOpen(false);
    setSourcePanelOpen(false);
    window.location.reload();
  };

  return (
    <div className="desktop-window-menu-root" data-desktop-window-menu-root={true}>
      <button
        type="button"
        className="desktop-window-menu-button"
        aria-label="WheelMaker menu"
        title="WheelMaker"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen(open => {
            if (open) {
              setSourcePanelOpen(false);
            }
            return !open;
          });
        }}
      >
        <DesktopTitleBarIcon />
      </button>
      {menuOpen ? (
        <div className="desktop-window-menu" role="menu">
          <button
            type="button"
            className="desktop-window-menu-item"
            role="menuitem"
            aria-label="Show source"
            aria-expanded={sourcePanelOpen}
            onClick={() => setSourcePanelOpen(open => !open)}
          >
            <span className="codicon codicon-server-process" aria-hidden="true" />
            显示来源
            <span className={`codicon ${sourcePanelOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}`} aria-hidden="true" />
          </button>
          {sourcePanelOpen && webSourceState ? (
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DesktopWindowControls({ onSettingsSelect }: DesktopWindowControlsProps) {
  const bridge = getDesktopWindowBridge();

  if (!bridge) {
    return null;
  }

  return (
    <div className="desktop-window-controls" data-desktop-window-controls={true}>
      {onSettingsSelect ? (
        <button
          type="button"
          className="desktop-titlebar-button desktop-window-settings-button"
          aria-label="Open settings"
          title="Settings"
          onClick={onSettingsSelect}
        >
          <span className="codicon codicon-settings-gear" aria-hidden="true" />
        </button>
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
