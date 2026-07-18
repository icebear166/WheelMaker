import React, { type ReactNode } from 'react';

import type { SettingsDetailId, SettingsPeerDetail } from './settingsNavigation';

export type SettingsDetailShellOptions = {
  hideDetailHeader?: boolean;
};

export type SettingsDetailShellProps = SettingsDetailShellOptions & {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  onBack: () => void;
};

export type SettingsSurfaceProps = {
  detailView: SettingsDetailId | null;
  options?: SettingsDetailShellOptions;
  renderRoot: () => ReactNode;
  renderDetail: (detail: SettingsDetailId, options: SettingsDetailShellOptions) => ReactNode;
};

export type MobileSettingsShortcutBarProps = {
  activeDetail: SettingsDetailId | null;
  activeIndex: number;
  rootActive: boolean;
  onRootSelect: () => void;
  onDetailSelect: (detail: SettingsPeerDetail) => void;
};

export type MobileSettingsScreenProps = {
  title: string;
  actions: ReactNode;
  backAriaLabel: string;
  children: ReactNode;
  shortcutBar: ReactNode;
  onBack: () => void;
  sidePanel?: ReactNode;
};

export type SettingsScreenProps = MobileSettingsScreenProps & {
  className?: string;
  onBackdropClick?: () => void;
};

type MobileSettingsShortcut = {
  detail: SettingsPeerDetail;
  title: string;
  label: string;
  iconClass: string;
};

export const MOBILE_SETTINGS_SHORTCUTS: readonly MobileSettingsShortcut[] = [
  {
    detail: 'update',
    title: 'Update',
    label: 'Update',
    iconClass: 'codicon-cloud-download',
  },
  {
    detail: 'skills',
    title: 'Skills',
    label: 'Skills',
    iconClass: 'codicon-extensions',
  },
  {
    detail: 'portRelay',
    title: 'Port Relay',
    label: 'Port Relay',
    iconClass: 'codicon-radio-tower',
  },
];

export function settingsDetailTitle(detail: SettingsDetailId): string {
  switch (detail) {
    case 'update':
      return 'Update';
    case 'skills':
      return 'Skills';
    case 'database':
      return 'Database';
    case 'portRelay':
      return 'Port Relay';
    case 'connectionStatus':
      return 'Connection Status';
    case 'deviceSessions':
      return 'Devices';
    case 'debugLogs':
      return 'Logs';
    case 'releasePublish':
      return 'Release publishing';
    case 'skillDetail':
      return 'Skill Detail';
  }
}

export function SettingsSurface({
  detailView,
  options = {},
  renderRoot,
  renderDetail,
}: SettingsSurfaceProps) {
  return detailView ? renderDetail(detailView, options) : renderRoot();
}

export function SettingsDetailShell({
  title,
  actions,
  children,
  onBack,
  hideDetailHeader = false,
}: SettingsDetailShellProps) {
  return (
    <div className={`settings-detail-page settings-workbench-detail-page${hideDetailHeader ? ' settings-detail-page-body-only' : ''}`}>
      {hideDetailHeader ? null : (
        <div className="settings-detail-header">
          <button
            type="button"
            className="mobile-settings-back settings-detail-back"
            onClick={onBack}
            aria-label="Back to settings"
            title="Back"
          >
            <span className="codicon codicon-arrow-left" />
          </button>
          <div className="settings-detail-title">{title}</div>
          {actions ?? <span className="settings-detail-header-spacer" aria-hidden="true" />}
        </div>
      )}
      <div className="settings-detail-body">{children}</div>
    </div>
  );
}

export function MobileSettingsShortcutBar({
  activeDetail,
  activeIndex,
  rootActive,
  onRootSelect,
  onDetailSelect,
}: MobileSettingsShortcutBarProps) {
  const shortcutCount = MOBILE_SETTINGS_SHORTCUTS.length + 1;
  const shortcutStyle = {'--settings-shortcut-count': shortcutCount} as React.CSSProperties;
  return (
    <nav
      className="mobile-settings-shortcut-bar"
      data-active-index={activeIndex}
      aria-label="Settings shortcuts"
    >
      <div className="mobile-settings-shortcut-track" style={shortcutStyle}>
        <button
          type="button"
          className={`mobile-settings-shortcut-button${rootActive ? ' active' : ''}`}
          onClick={onRootSelect}
          title="Settings"
          aria-label="Settings"
        >
          <span className="codicon codicon-settings-gear" />
          <span className="mobile-settings-shortcut-label">Settings</span>
        </button>
        {MOBILE_SETTINGS_SHORTCUTS.map(shortcut => (
          <button
            key={shortcut.detail}
            type="button"
            className={`mobile-settings-shortcut-button${activeDetail === shortcut.detail ? ' active' : ''}`}
            onClick={() => onDetailSelect(shortcut.detail)}
            title={shortcut.title}
            aria-label={shortcut.title}
          >
            <span className={`codicon ${shortcut.iconClass}`} />
            <span className="mobile-settings-shortcut-label">{shortcut.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function SettingsScreen({
  title,
  actions,
  backAriaLabel,
  children,
  shortcutBar,
  onBack,
  sidePanel,
  className,
  onBackdropClick,
}: SettingsScreenProps) {
  const screenClassName = className
    ? `settings-workbench-screen mobile-settings-screen ${className}`
    : 'settings-workbench-screen mobile-settings-screen';
  const effectiveScreenClassName = sidePanel ? `${screenClassName} has-settings-side-panel` : screenClassName;
  const handleBackdropClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !onBackdropClick) {
      return;
    }
    onBackdropClick();
  }, [onBackdropClick]);

  return (
    <div
      className={effectiveScreenClassName}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={handleBackdropClick}
    >
      <div className="settings-screen-panel-row">
        <div className="mobile-settings-panel settings-workbench-panel">
          <div className="mobile-settings-nav settings-workbench-nav">
            <button
              type="button"
              className="mobile-settings-back"
              onClick={onBack}
              aria-label={backAriaLabel}
              title="Back"
            >
              <span className="codicon codicon-arrow-left" />
            </button>
            <div className="mobile-settings-title">{title}</div>
            <div className="mobile-settings-actions">{actions}</div>
          </div>
          <div className="mobile-settings-scroll">
            <div className="mobile-settings-group">{children}</div>
          </div>
          {shortcutBar}
        </div>
        {sidePanel}
      </div>
    </div>
  );
}

export function MobileSettingsScreen(props: MobileSettingsScreenProps) {
  return <SettingsScreen {...props} />;
}
