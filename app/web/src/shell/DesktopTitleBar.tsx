import React, { useEffect, useRef, useState } from 'react';
import { getDesktopWindowBridge, type DesktopWebSourceState } from './desktopRuntime';
import {
  readDesktopWebSourceState,
  setDesktopWebSourcePreference,
} from './desktop/webSource';

type DesktopTitleBarProps = {
  title: string;
};

function invokeDesktopAction(action: (() => Promise<void> | void) | undefined) {
  void action?.();
}

function isDesktopTitleBarInteractiveTarget(target: EventTarget | null) {
  const targetElement = target as { closest?: (selector: string) => Element | null } | null;
  return typeof targetElement?.closest === 'function'
    && Boolean(targetElement.closest('button, select, [data-desktop-titlebar-interactive]'));
}

function DesktopTitleBarIcon() {
  return (
    <svg
      className="desktop-titlebar-icon"
      viewBox="0 0 1536 1536"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="desktopTitlebarIconClip">
          <rect x="38" y="38" width="1460" height="1460" rx="292" />
        </clipPath>
        <radialGradient
          id="desktopTitlebarIconBgRadial"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(768 636) rotate(90) scale(910 910)"
        >
          <stop offset="0" stopColor="#061A3F" />
          <stop offset="0.58" stopColor="#021331" />
          <stop offset="1" stopColor="#000918" />
        </radialGradient>
        <linearGradient
          id="desktopTitlebarIconBgEdge"
          x1="768"
          y1="38"
          x2="768"
          y2="1498"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#173E78" stopOpacity="0.55" />
          <stop offset="0.22" stopColor="#0A2C5E" stopOpacity="0.18" />
          <stop offset="0.72" stopColor="#020B1F" stopOpacity="0" />
          <stop offset="1" stopColor="#0A2D61" stopOpacity="0.32" />
        </linearGradient>
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
          y="405"
          width="1010"
          height="735"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000814" floodOpacity="0.45" />
        </filter>
      </defs>
      <rect width="1536" height="1536" fill="transparent" />
      <g filter="url(#desktopTitlebarIconSoftOuter)">
        <rect x="38" y="38" width="1460" height="1460" rx="292" fill="url(#desktopTitlebarIconBgRadial)" />
      </g>
      <g clipPath="url(#desktopTitlebarIconClip)">
        <rect x="38" y="38" width="1460" height="1460" rx="292" fill="url(#desktopTitlebarIconBgEdge)" />
        <ellipse cx="770" cy="190" rx="520" ry="155" fill="#0C3471" opacity="0.10" />
        <ellipse cx="768" cy="1260" rx="600" ry="210" fill="#00184A" opacity="0.15" />
      </g>
      <rect x="44" y="44" width="1448" height="1448" rx="286" stroke="#1A4D91" strokeWidth="5" opacity="0.45" />
      <rect x="51" y="51" width="1434" height="1434" rx="280" stroke="#102A59" strokeWidth="3" opacity="0.42" />
      <g filter="url(#desktopTitlebarIconLogoShadow)">
        <path d="M325 462 L456 607 L457 847 L644 650 L1026 1073 L853 1073 L637 843 L424 1073 L326 1073 Z" fill="url(#desktopTitlebarIconBlueMark)" />
        <path d="M674 628 H871 L768 746 Z" fill="url(#desktopTitlebarIconBlueMark)" />
        <path d="M1209 462 L974 729 L895 648 L787 768 L948 943 L1079 798 L1079 1071 L1209 1071 Z" fill="url(#desktopTitlebarIconWhiteMark)" />
      </g>
    </svg>
  );
}

export function DesktopTitleBar({ title }: DesktopTitleBarProps) {
  const bridge = getDesktopWindowBridge();
  const suppressNextDoubleClickRef = useRef(false);
  const [webSourceState, setWebSourceState] = useState<DesktopWebSourceState | null>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
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
    if (!sourceMenuOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const closeSourceMenu = (event: PointerEvent) => {
      const target = event.target as { closest?: (selector: string) => Element | null } | null;
      if (typeof target?.closest === 'function' && target.closest('[data-desktop-titlebar-source-root]')) {
        return;
      }
      setSourceMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeSourceMenu);
    return () => window.removeEventListener('pointerdown', closeSourceMenu);
  }, [sourceMenuOpen]);
  if (!bridge) {
    return null;
  }

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if (isDesktopTitleBarInteractiveTarget(event.target)) {
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

  const handleDragDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isDesktopTitleBarInteractiveTarget(event.target)) {
      suppressNextDoubleClickRef.current = false;
      return;
    }
    if (suppressNextDoubleClickRef.current) {
      suppressNextDoubleClickRef.current = false;
      return;
    }
    invokeDesktopAction(bridge.toggleMaximize);
  };
  const handleWebSourcePreferenceSelect = async (preference: 'auto' | 'embedded') => {
    setSourceMenuOpen(false);
    const nextState = await setDesktopWebSourcePreference(preference);
    if (nextState) {
      setWebSourceState(nextState);
    }
    window.location.reload();
  };
  const displayTitle = webSourceState?.displayTitle || title;
  const titlePrefix = `${title} - `;
  const actualSourceLabel = webSourceState?.displaySource || '';
  const hasRemoteWebSource = Boolean(webSourceState?.remoteUrl && webSourceState.remoteHost && bridge.setWebSourcePreference);
  const remoteSourceLabel = webSourceState?.remoteHost || webSourceState?.displaySource || 'Auto';

  return (
    <div className="desktop-titlebar" data-desktop-titlebar={true}>
      <div
        className="desktop-titlebar-drag-region"
        data-desktop-titlebar-drag-region={true}
        onDoubleClick={handleDragDoubleClick}
        onMouseDown={handleDragMouseDown}
      >
        <DesktopTitleBarIcon />
        {webSourceState ? (
          <span className="desktop-titlebar-title-group">
            <span className="desktop-titlebar-app-title" title={displayTitle}>{titlePrefix}</span>
            {hasRemoteWebSource ? (
              <span className="desktop-titlebar-source-control" data-desktop-titlebar-source-root={true}>
                <button
                  type="button"
                  className="desktop-titlebar-source-button"
                  aria-expanded={sourceMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Desktop web source"
                  data-desktop-titlebar-interactive={true}
                  title={webSourceState.remoteUrl || actualSourceLabel}
                  onClick={() => setSourceMenuOpen(open => !open)}
                >
                  {actualSourceLabel}
                </button>
                {sourceMenuOpen ? (
                  <div
                    className="desktop-titlebar-source-menu"
                    role="menu"
                    data-desktop-titlebar-interactive={true}
                  >
                    <button
                      type="button"
                      className="desktop-titlebar-source-menu-item"
                      role="menuitemradio"
                      aria-checked={webSourceState.preference === 'auto'}
                      title={webSourceState.remoteUrl}
                      onClick={() => void handleWebSourcePreferenceSelect('auto')}
                    >
                      {remoteSourceLabel}
                    </button>
                    <button
                      type="button"
                      className="desktop-titlebar-source-menu-item"
                      role="menuitemradio"
                      aria-checked={webSourceState.preference === 'embedded'}
                      onClick={() => void handleWebSourcePreferenceSelect('embedded')}
                    >
                      Embedded
                    </button>
                  </div>
                ) : null}
              </span>
            ) : (
              <span className="desktop-titlebar-source-label" title={actualSourceLabel}>{actualSourceLabel}</span>
            )}
          </span>
        ) : (
          <span className="desktop-titlebar-title" title={displayTitle}>{displayTitle}</span>
        )}
      </div>
      <div className="desktop-titlebar-controls">
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
    </div>
  );
}
