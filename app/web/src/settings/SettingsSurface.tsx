import React, { type ReactNode } from 'react';

import {Icon} from '../common/Icon';
import type { SettingsDetail } from './settingsNavigation';

export type SettingsDetailShellProps = {
  children: ReactNode;
};

export type SettingsSurfaceProps = {
  detailView: SettingsDetail | null;
  renderRoot: () => ReactNode;
  renderDetail: (detail: SettingsDetail) => ReactNode;
};

export type MobileSettingsScreenProps = {
  title: string;
  actions: ReactNode;
  backAriaLabel: string;
  children: ReactNode;
  onBack: () => void;
};

export type SettingsScreenProps = MobileSettingsScreenProps & {
  className?: string;
  onBackdropClick?: () => void;
};

export function settingsDetailTitle(detail: SettingsDetail): string {
  switch (detail) {
    case 'database':
      return 'Database';
    case 'connectionStatus':
      return 'Status';
    case 'deviceSessions':
      return 'Devices';
    case 'debugLogs':
      return 'Logs';
  }
}

export function SettingsSurface({
  detailView,
  renderRoot,
  renderDetail,
}: SettingsSurfaceProps) {
  return detailView ? renderDetail(detailView) : renderRoot();
}

export function SettingsDetailShell({
  children,
}: SettingsDetailShellProps) {
  return (
    <div className="settings-detail-page settings-workbench-detail-page settings-detail-page-body-only">
      <div className="settings-detail-body">{children}</div>
    </div>
  );
}

export function SettingsScreen({
  title,
  actions,
  backAriaLabel,
  children,
  onBack,
  className,
  onBackdropClick,
}: SettingsScreenProps) {
  const screenClassName = className
    ? `settings-workbench-screen mobile-settings-screen ${className}`
    : 'settings-workbench-screen mobile-settings-screen';
  const handleBackdropClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !onBackdropClick) {
      return;
    }
    onBackdropClick();
  }, [onBackdropClick]);

  return (
    <div
      className={screenClassName}
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
              <Icon name="arrowLeft" size={18} />
            </button>
            <div className="mobile-settings-title">{title}</div>
            <div className="mobile-settings-actions">{actions}</div>
          </div>
          <div className="mobile-settings-scroll">
            <div className="mobile-settings-group">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileSettingsScreen(props: MobileSettingsScreenProps) {
  return <SettingsScreen {...props} />;
}
