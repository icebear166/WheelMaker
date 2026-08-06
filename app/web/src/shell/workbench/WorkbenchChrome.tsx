import React, {type ReactNode} from 'react';
import {Icon} from '../../common/Icon';
import {DesktopDragRegion} from '../layouts/desktop/DesktopTitleBar';

export type WorkbenchChromeMode = 'desktop' | 'mobile';

type WorkbenchChromeProps = {
  mode: WorkbenchChromeMode;
  surfaceClassName: string;
  ariaLabel: string;
  title: string;
  titleTooltip?: string;
  closeLabel: string;
  onClose: () => void;
  actions?: ReactNode;
  tabsAriaLabel: string;
  tabs: ReactNode;
  tabsClassName?: string;
  tabsAccessory?: ReactNode;
  tabsListRef?: React.Ref<HTMLDivElement>;
  mobileFullscreen?: boolean;
  onMobileFullscreenChange?: (fullscreen: boolean) => void;
  bodyClassName?: string;
  footer?: ReactNode;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  children: ReactNode;
};

export function WorkbenchChrome({
  mode,
  surfaceClassName,
  ariaLabel,
  title,
  titleTooltip,
  closeLabel,
  onClose,
  actions,
  tabsAriaLabel,
  tabs,
  tabsClassName,
  tabsAccessory,
  tabsListRef,
  mobileFullscreen = false,
  onMobileFullscreenChange,
  bodyClassName,
  footer,
  onKeyDown,
  children,
}: WorkbenchChromeProps) {
  const toolbar = (
    <>
      <button
        type="button"
        className="workbench-chrome-icon-button workbench-chrome-close"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <Icon name={mode === 'mobile' ? 'arrowLeft' : 'x'} size={16} />
      </button>
      <div className="workbench-chrome-title" data-tooltip={titleTooltip || title}>
        {title}
      </div>
      {actions ? <div className="workbench-chrome-actions">{actions}</div> : null}
    </>
  );

  const tabsList = (
    <div
      ref={tabsListRef}
      className={`workbench-chrome-tabs${tabsClassName ? ` ${tabsClassName}` : ''}`}
      role="tablist"
      aria-label={tabsAriaLabel}
    >
      {tabs}
    </div>
  );

  return (
    <section
      className={`workbench-chrome ${surfaceClassName} ${mode}`}
      aria-label={ariaLabel}
      data-mobile-fullscreen={mode === 'mobile' && mobileFullscreen}
      onKeyDown={onKeyDown}
    >
      {mode === 'desktop' ? (
        <DesktopDragRegion className="workbench-chrome-toolbar">
          {toolbar}
        </DesktopDragRegion>
      ) : (
        <div className="workbench-chrome-toolbar">{toolbar}</div>
      )}
      {tabsAccessory ? (
        <div className="workbench-chrome-tabs-row">
          {tabsList}
          <div className="workbench-chrome-tabs-accessory">{tabsAccessory}</div>
        </div>
      ) : tabsList}
      <div className={`workbench-chrome-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
        {children}
      </div>
      {footer}
      {mode === 'mobile' && onMobileFullscreenChange ? (
        <button
          type="button"
          className="workbench-chrome-fullscreen-toggle"
          aria-label={mobileFullscreen ? 'Exit workbench fullscreen' : 'Enter workbench fullscreen'}
          aria-pressed={mobileFullscreen}
          data-tooltip={mobileFullscreen ? 'Show toolbar and tabs' : 'Hide toolbar and tabs'}
          onClick={() => onMobileFullscreenChange(!mobileFullscreen)}
        >
          <Icon name={mobileFullscreen ? 'panelTopOpen' : 'panelTop'} size={18} />
        </button>
      ) : null}
    </section>
  );
}
