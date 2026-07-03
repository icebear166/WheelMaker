import React, { type ReactNode } from 'react';
import type { LayoutMode } from './state/responsiveLayout';

type ShellThemeMode = 'dark' | 'light';

type ShellContentProps = {
  themeMode: ShellThemeMode;
  setiFontCss?: string;
  sidebar: ReactNode;
  main: ReactNode;
};

export type DesktopShellProps = ShellContentProps & {
  desktopWindowControls: ReactNode;
  desktopSettingsScreen: ReactNode;
  desktopPeek: ReactNode;
  desktopChatFixedPreview: boolean;
  desktopChatPreviewOpen: boolean;
  sidebarCollapsed: boolean;
  desktopSidebarWidth: number;
};

export type MobileShellProps = ShellContentProps & {
  floatingControlStack: ReactNode;
  floatingControlSide: 'left' | 'right';
  mobileSettingsScreen: ReactNode;
  mobileOverlay: ReactNode;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
};

export type ResponsiveShellProps = DesktopShellProps &
  MobileShellProps & {
    mode: LayoutMode;
  };

export function DesktopShell({
  themeMode,
  setiFontCss,
  desktopWindowControls,
  desktopSettingsScreen,
  desktopPeek,
  desktopChatFixedPreview,
  desktopChatPreviewOpen,
  sidebar,
  main,
  sidebarCollapsed,
  desktopSidebarWidth,
}: DesktopShellProps) {
  return (
    <div className={`workspace theme-${themeMode}`}>
      {setiFontCss ? <style>{setiFontCss}</style> : null}
      {desktopWindowControls}
      <div
        className="desktop-shell"
        data-chat-fixed-preview={desktopChatFixedPreview ? 'true' : undefined}
        data-chat-preview-open={desktopChatPreviewOpen ? 'true' : undefined}
        style={{ '--desktop-sidebar-width': `${desktopSidebarWidth}px` } as React.CSSProperties}
      >
        <div className="body">
          {!sidebarCollapsed ? (
            <aside className="workspace-left">{sidebar}</aside>
          ) : null}
          <main className="workspace-right">{main}</main>
          {desktopPeek}
        </div>
      </div>
      {desktopSettingsScreen}
    </div>
  );
}

export function MobileShell({
  themeMode,
  setiFontCss,
  floatingControlStack,
  floatingControlSide,
  mobileSettingsScreen,
  mobileOverlay,
  sidebar,
  main,
  drawerOpen,
  onCloseDrawer,
}: MobileShellProps) {
  return (
    <div
      className={`workspace theme-${themeMode} narrow-shell`}
      data-floating-control-side={floatingControlSide}
      data-chat-preview-open={mobileOverlay ? 'true' : undefined}
    >
      {setiFontCss ? <style>{setiFontCss}</style> : null}
      {floatingControlStack}
      {mobileSettingsScreen}
      {mobileOverlay}

      <div className="body">
        <main className="workspace-right">{main}</main>
      </div>

      <div
        className={`drawer-overlay ${drawerOpen ? 'show' : ''}`}
        onClick={onCloseDrawer}
      />
      <aside
        className={`drawer ${drawerOpen ? 'show' : ''}`}
        onClick={event => event.stopPropagation()}
      >
        {sidebar}
      </aside>
    </div>
  );
}

export function ResponsiveShell({ mode, ...props }: ResponsiveShellProps) {
  return mode === 'desktop' ? (
    <DesktopShell {...props} />
  ) : (
    <MobileShell {...props} />
  );
}
