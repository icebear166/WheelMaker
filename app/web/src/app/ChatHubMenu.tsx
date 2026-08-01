import React from 'react';
import {createPortal} from 'react-dom';

import {Icon, type IconName} from '../common/Icon';
import {SecretEditor} from '../common/SecretEditor';
import type {
  RegistryFlickerBridgeMode,
  RegistryFlickerBridgeStatus,
  RegistryHubConfig,
  RegistryHubConfigUpdatePayload,
  RegistrySkillProjectSnapshot,
  RegistrySkillSnapshot,
} from '../registry/registryTypes';
import {
  onlineSkillProjects,
  projectSkillTotal,
  type SkillBatchUninstallTarget,
  type SkillDetailTarget,
  type SkillInstallTarget,
  type SkillUninstallTarget,
  type SkillUpdateTarget,
} from '../settings/skillManagementView';
import {
  HUB_COLOR_PRESETS,
  hubColorToHsv,
  hubHsvToColor,
  resolveDefaultHubColor,
  resolveHubColor,
  setHubColorPreference,
  type HubColorHsv,
} from '../workspace/hubProjectPreferences';
import {
  ChatHubSkillScopeDetail,
  type ChatHubSkillActions,
} from './ChatHubSkillManagement';
import type {
  ChatHubSkillCompanionProps,
  ChatHubSkillSurface,
} from './ChatHubSkillCompanion';

const ChatHubSkillCompanion = React.lazy(
  () => import('./ChatHubSkillCompanion').then(module => ({
    default: module.ChatHubSkillCompanion,
  })),
);

export type ChatHubDetailId =
  | 'settings'
  | 'npm'
  | 'mcp'
  | 'skills'
  | 'visibility'
  | 'scan'
  | 'projectSkills';

function chatHubDetailGroup(section: ChatHubDetailId): 'settings' | 'hub' | 'projects' {
  if (section === 'settings') return 'settings';
  if (section === 'npm' || section === 'mcp' || section === 'skills') return 'hub';
  return 'projects';
}

export function toggleChatHubDetailSections(
  current: ChatHubDetailId[],
  section: ChatHubDetailId,
): ChatHubDetailId[] {
  if (current.includes(section)) {
    return current.filter(item => item !== section);
  }
  const group = chatHubDetailGroup(section);
  const groupIndex = current.findIndex(item => chatHubDetailGroup(item) === group);
  if (groupIndex < 0) {
    return [...current, section];
  }
  return current.map((item, index) => index === groupIndex ? section : item);
}

export interface ChatHubProjectItem {
  projectId: string;
  name: string;
  path?: string;
}

export interface ChatHubTreeItem {
  hubId: string;
  projects: ChatHubProjectItem[];
  connectionMode?: 'normal' | 'update_only';
}

export interface ChatHubNpmPackageView {
  packageName: string;
  displayName: string;
  installedVersion: string;
  latestVersion: string;
  action: 'update' | 'install' | null;
  canUninstall: boolean;
  pending: boolean;
}

export interface ChatHubIndexProjectView {
  projectId: string;
  name: string;
  status: string;
  pending: boolean;
}

export interface ChatHubOpsView {
  wheelMaker: {
    loading: boolean;
    pending: boolean;
    currentVersion: string;
    actionLabel: string;
    actionVisible: boolean;
    updateAvailable: boolean;
  };
  npm: {
    loading: boolean;
    pending: boolean;
    outdatedCount: number;
    packages: ChatHubNpmPackageView[];
  };
  skills: {
    loading: boolean;
    operationRunning: boolean;
    error: string;
    pendingKey: string;
    hubItems: RegistrySkillSnapshot[];
    projects: RegistrySkillProjectSnapshot[];
  };
  index: {
    pending: boolean;
    indexedCount: number;
    totalCount: number;
    projects: ChatHubIndexProjectView[];
  };
}

export interface ChatHubConfigView {
  loading: boolean;
  /** Non-empty when the hub config could not be loaded (old hubs included). */
  error: string;
  data: RegistryHubConfig | null;
  /** Field currently being written, e.g. "apiKeys:kimi" or "flickerBridge:enabled". */
  busyField: string;
}

const HUB_API_KEY_FIELDS: {name: string; label: string}[] = [
  {name: 'kimi', label: 'Kimi'},
  {name: 'qwen', label: 'Qwen'},
  {name: 'zai', label: 'Z.AI'},
  {name: 'deepSeek', label: 'DeepSeek'},
];

const EMPTY_OPS_VIEW: ChatHubOpsView = {
  wheelMaker: {
    loading: false,
    pending: false,
    currentVersion: '-',
    actionLabel: 'Update Hub',
    actionVisible: false,
    updateAvailable: false,
  },
  npm: {loading: false, pending: false, outdatedCount: 0, packages: []},
  skills: {
    loading: false,
    operationRunning: false,
    error: '',
    pendingKey: '',
    hubItems: [],
    projects: [],
  },
  index: {pending: false, indexedCount: 0, totalCount: 0, projects: []},
};

export interface ChatHubMenuProps {
  mobile: boolean;
  open: boolean;
  exiting: boolean;
  summaryLabel: string;
  projectLabel: string;
  activeProjectId: string;
  hubIds: string[];
  treeItems: ChatHubTreeItem[];
  popoverStyle: React.CSSProperties | undefined;
  menuRef: React.RefObject<HTMLDivElement | null>;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  expandedHubIds: string[];
  onToggleHub: (hubId: string) => void;
  expandedSections: Record<string, ChatHubDetailId[]>;
  onToggleSection: (hubId: string, section: ChatHubDetailId) => void;
  hubColors: Record<string, string>;
  setHubColors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  hubAccentStyle: (hubId: string) => React.CSSProperties;
  colorMenuHubId: string | null;
  colorMenuExiting: boolean;
  onToggleColorMenu: (hubId: string | null) => void;
  flickerStatuses: Record<string, RegistryFlickerBridgeStatus | undefined>;
  flickerActionHubId: string;
  onFlickerSwitchMode: (hubId: string, mode: RegistryFlickerBridgeMode) => void;
  hubConfigByHubId: Record<string, ChatHubConfigView | undefined>;
  onUpdateHubConfig: (hubId: string, update: RegistryHubConfigUpdatePayload) => Promise<void>;
  opsByHubId: Record<string, ChatHubOpsView | undefined>;
  onRequestWheelMakerUpdate: (hubId: string) => void;
  onRequestNpmUpdate: (hubId: string) => void;
  onPackageAction: (hubId: string, action: 'install' | 'update' | 'uninstall', pkg: ChatHubNpmPackageView) => void;
  onRequestSkillInstall: (target: SkillInstallTarget) => void;
  onRequestSkillDetail: (target: SkillDetailTarget) => void;
  onRequestSkillUpdate: (target: SkillUpdateTarget) => void;
  onRequestSkillUninstall: (target: SkillUninstallTarget) => void;
  onRequestSkillBatchUninstall: (target: SkillBatchUninstallTarget) => void;
  onRetrySkills: (hubId: string) => void;
  skillSurface: ChatHubSkillSurface | null;
  skillInstall: ChatHubSkillCompanionProps['install'];
  skillDetail: ChatHubSkillCompanionProps['detail'];
  onCloseSkillSurface: () => void;
  onScanAllIndexes: (hubId: string) => void;
  onScanProject: (hubId: string, projectId: string) => void;
  hiddenProjectIdSet: Set<string>;
  onToggleProject: (projectId: string, visible: boolean) => void;
  latestVersion: string;
  updateAllAvailableCount: number;
  updateAllPending: boolean;
  onUpdateAllHubs: () => void;
}

function ChatHubSectionHeader({
  icon,
  label,
  summary,
  expanded,
  onToggle,
}: {
  icon: IconName;
  label: string;
  summary: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`chat-hub-section-header${expanded ? ' expanded' : ''}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <Icon name={icon} className="chat-hub-section-icon" />
      <span className="chat-hub-section-label">{label}</span>
      <span className="chat-hub-section-summary">{summary}</span>
      <Icon name="chevronRight" className="chat-hub-section-chevron" />
    </button>
  );
}

function ChatHubColorPalette({
  hubId,
  inline,
  exiting,
  hubColors,
  setHubColors,
  hubAccentStyle,
}: {
  hubId: string;
  inline: boolean;
  exiting: boolean;
  hubColors: Record<string, string>;
  setHubColors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  hubAccentStyle: (hubId: string) => React.CSSProperties;
}): React.JSX.Element {
  const currentHubColor = resolveHubColor(hubColors, hubId);
  const defaultHubColor = resolveDefaultHubColor(hubId);
  const currentHubHsv = hubColorToHsv(currentHubColor);
  const currentHubHueColor = hubHsvToColor({h: currentHubHsv.h, s: 1, v: 1});
  const customHubColorStyle = {
    ...hubAccentStyle(hubId),
    '--hub-custom-hue': currentHubHueColor,
    '--hub-custom-s': `${currentHubHsv.s * 100}%`,
    '--hub-custom-v': `${(1 - currentHubHsv.v) * 100}%`,
    '--hub-custom-h': `${(currentHubHsv.h / 360) * 100}%`,
  } as React.CSSProperties;

  const applySvPointer = (hsv: HubColorHsv, event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail for synthetic or already-ended pointer events.
    }
    const saturation = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const brightness = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const nextColor = hubHsvToColor({h: hsv.h, s: saturation, v: brightness});
    setHubColors(current => setHubColorPreference(current, hubId, nextColor));
  };
  const applyHuePointer = (hsv: HubColorHsv, event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail for synthetic or already-ended pointer events.
    }
    const hueRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const nextColor = hubHsvToColor({h: hueRatio * 360, s: hsv.s || 1, v: hsv.v || 1});
    setHubColors(current => setHubColorPreference(current, hubId, nextColor));
  };

  // Keyboard support for the two role="slider" pickers: arrows nudge, Shift
  // widens the step, Home/End jump to the hue extremes.
  const nudgeSv = (hsv: HubColorHsv, event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    let saturation = hsv.s;
    let brightness = hsv.v;
    if (event.key === 'ArrowLeft') saturation -= step;
    else if (event.key === 'ArrowRight') saturation += step;
    else if (event.key === 'ArrowUp') brightness += step;
    else if (event.key === 'ArrowDown') brightness -= step;
    else return;
    event.preventDefault();
    const nextColor = hubHsvToColor({
      h: hsv.h,
      s: Math.max(0, Math.min(1, saturation)),
      v: Math.max(0, Math.min(1, brightness)),
    });
    setHubColors(current => setHubColorPreference(current, hubId, nextColor));
  };
  const nudgeHue = (hsv: HubColorHsv, event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 15 : 3;
    let hue = hsv.h;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') hue -= step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') hue += step;
    else if (event.key === 'Home') hue = 0;
    else if (event.key === 'End') hue = 360;
    else return;
    event.preventDefault();
    const nextColor = hubHsvToColor({
      h: Math.max(0, Math.min(360, hue)),
      s: hsv.s || 1,
      v: hsv.v || 1,
    });
    setHubColors(current => setHubColorPreference(current, hubId, nextColor));
  };

  // The desktop palette renders below the hub row inside the scrollable
  // popover; make sure it is revealed when it opens.
  const paletteRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (inline) {
      return;
    }
    paletteRef.current?.scrollIntoView?.({block: 'nearest'});
  }, [inline]);

  return (
    <div
      ref={paletteRef}
      className={`chat-hub-color-palette topbar-menu-surface${inline ? ' inline' : ''}${exiting ? ' sl-menu-exit' : ''}`}
      aria-label={`Color options for ${hubId}`}
    >
      <div className="chat-hub-color-grid">
        {HUB_COLOR_PRESETS.map(color => {
          const defaultSwatch = color === defaultHubColor;
          return (
            <button
              key={`${hubId}:${color}`}
              type="button"
              className={`chat-hub-color-swatch${currentHubColor === color ? ' selected' : ''}${defaultSwatch ? ' default' : ''}`}
              style={{'--swatch-color': color} as React.CSSProperties}
              aria-label={defaultSwatch ? `Restore default color for ${hubId}` : `Set ${hubId} color to ${color}`}
              onClick={() => setHubColors(current =>
                setHubColorPreference(current, hubId, defaultSwatch ? '' : color)
              )}
            >
              {defaultSwatch ? <span className="chat-hub-color-default-badge" aria-hidden="true">D</span> : null}
            </button>
          );
        })}
      </div>
      <div className="chat-hub-color-custom" style={customHubColorStyle}>
        <div className="chat-hub-color-custom-header">
          <span className="chat-hub-color-custom-label">Custom</span>
          <span className="chat-hub-color-custom-preview" aria-hidden="true" />
        </div>
        <div
          className="chat-hub-color-sv"
          role="slider"
          tabIndex={0}
          aria-label={`Set saturation and brightness for ${hubId}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(currentHubHsv.s * 100)}
          aria-valuetext={`${Math.round(currentHubHsv.s * 100)}% saturation, ${Math.round(currentHubHsv.v * 100)}% brightness`}
          onKeyDown={event => nudgeSv(currentHubHsv, event)}
          onPointerDown={event => applySvPointer(currentHubHsv, event)}
          onPointerMove={event => {
            if (event.pointerType === 'mouse' && event.buttons === 0) {
              return;
            }
            applySvPointer(currentHubHsv, event);
          }}
        >
          <span className="chat-hub-color-sv-thumb" aria-hidden="true" />
        </div>
        <div
          className="chat-hub-color-hue"
          role="slider"
          tabIndex={0}
          aria-label={`Set hue for ${hubId}`}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(currentHubHsv.h)}
          onKeyDown={event => nudgeHue(currentHubHsv, event)}
          onPointerDown={event => applyHuePointer(currentHubHsv, event)}
          onPointerMove={event => {
            if (event.pointerType === 'mouse' && event.buttons === 0) {
              return;
            }
            applyHuePointer(currentHubHsv, event);
          }}
        >
          <span className="chat-hub-color-hue-thumb" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

const flickerBridgeModes: RegistryFlickerBridgeMode[] = ['v1', 'v2'];

function ChatHubFlickerRow({
  hubId,
  config,
  configBusy,
  onUpdateHubConfig,
  flickerStatus,
  flickerBusy,
  onFlickerSwitchMode,
}: {
  hubId: string;
  config: RegistryHubConfig | null;
  configBusy: boolean;
  onUpdateHubConfig: (hubId: string, update: RegistryHubConfigUpdatePayload) => Promise<void>;
  flickerStatus: RegistryFlickerBridgeStatus | undefined;
  flickerBusy: boolean;
  onFlickerSwitchMode: (mode: RegistryFlickerBridgeMode) => void;
}): React.JSX.Element {
  const enabled = config?.flickerBridge.enabled === true;
  const busy = flickerBusy || configBusy;

  const selectSegment = (segment: 'off' | RegistryFlickerBridgeMode) => {
    if (segment === 'off') {
      void onUpdateHubConfig(hubId, {section: 'flickerBridge', field: 'enabled', action: 'clear'})
        .catch(() => undefined);
      return;
    }
    if (!enabled) {
      void onUpdateHubConfig(hubId, {section: 'flickerBridge', field: 'enabled', action: 'set'})
        .catch(() => undefined);
    }
    if (flickerStatus?.mode !== segment) {
      onFlickerSwitchMode(segment);
    }
  };

  return (
    <div className="chat-hub-flicker-row">
      <span className="chat-hub-settings-label">
        <Icon name="radioTower" className="chat-hub-settings-row-icon" />
        Flicker
      </span>
      <span className="chat-hub-flicker-controls">
        <span className="chat-hub-flicker-modes" role="group" aria-label="Flicker Bridge mode">
          {config ? (
            <button
              type="button"
              className={enabled ? '' : 'selected'}
              aria-label="Disable Flicker Bridge"
              aria-pressed={!enabled}
              disabled={busy || !enabled}
              onClick={() => selectSegment('off')}
            >
              Off
            </button>
          ) : null}
          {flickerBridgeModes.map(mode => {
            const selected = config ? enabled && flickerStatus?.mode === mode : flickerStatus?.mode === mode;
            const available = flickerStatus?.availableModes.includes(mode) === true;
            return (
              <button
                key={mode}
                type="button"
                className={selected ? 'selected' : ''}
                aria-label={`Use Flicker Bridge ${mode.toUpperCase()}`}
                aria-pressed={selected}
                title={flickerStatus?.modeErrors[mode]}
                disabled={busy || selected || !available}
                onClick={() => selectSegment(mode)}
              >
                {mode.toUpperCase()}
              </button>
            );
          })}
        </span>
      </span>
    </div>
  );
}

function ChatHubSettingsSection({
  hubId,
  configView,
  onUpdateHubConfig,
  flickerStatus,
  flickerBusy,
  onFlickerSwitchMode,
}: {
  hubId: string;
  configView: ChatHubConfigView | undefined;
  onUpdateHubConfig: (hubId: string, update: RegistryHubConfigUpdatePayload) => Promise<void>;
  flickerStatus: RegistryFlickerBridgeStatus | undefined;
  flickerBusy: boolean;
  onFlickerSwitchMode: (mode: RegistryFlickerBridgeMode) => void;
}): React.JSX.Element {
  const config = configView?.data ?? null;
  const unavailableMode = flickerBridgeModes.find(mode => flickerStatus?.modeErrors[mode]);
  const modeError = unavailableMode ? flickerStatus?.modeErrors[unavailableMode] : undefined;
  const inlineError = flickerStatus?.error
    ? flickerStatus.error
    : unavailableMode && modeError
      ? `${unavailableMode.toUpperCase()} unavailable · ${modeError}`
      : undefined;

  return (
    <div className="chat-hub-settings">
      <ChatHubFlickerRow
        hubId={hubId}
        config={config}
        configBusy={configView?.busyField === 'flickerBridge:enabled'}
        onUpdateHubConfig={onUpdateHubConfig}
        flickerStatus={flickerStatus}
        flickerBusy={flickerBusy}
        onFlickerSwitchMode={onFlickerSwitchMode}
      />
      {inlineError ? (
        <div className="chat-hub-settings-hint error" title={inlineError}>{inlineError}</div>
      ) : null}
      {configView?.loading && !config ? (
        <div className="chat-hub-settings-hint">Loading hub config…</div>
      ) : null}
      {configView?.error ? (
        <div className="chat-hub-settings-hint error">{configView.error}</div>
      ) : null}
      {config ? (
        <>
          <div className="chat-hub-settings-keys">
            {HUB_API_KEY_FIELDS.map(field => {
              const snapshot = config.apiKeys[field.name];
              return (
                <SecretEditor
                  key={`${hubId}:${field.name}`}
                  compact
                  label={field.label}
                  configured={snapshot?.configured === true}
                  updatedAt={snapshot?.updatedAt}
                  busy={configView?.busyField === `apiKeys:${field.name}`}
                  onSet={value => onUpdateHubConfig(hubId, {
                    section: 'apiKeys',
                    field: field.name,
                    action: 'set',
                    value,
                  })}
                  onClear={() => onUpdateHubConfig(hubId, {
                    section: 'apiKeys',
                    field: field.name,
                    action: 'clear',
                  })}
                />
              );
            })}
          </div>
          <div className="chat-hub-settings-hint">Changes apply automatically.</div>
        </>
      ) : null}
    </div>
  );
}

function ChatHubDisclosureButton({
  label,
  ariaLabel,
  info,
  icon,
  updateAvailable = false,
  pending = false,
  expanded,
  onToggle,
}: {
  label: string;
  ariaLabel?: string;
  info: string;
  icon: IconName;
  updateAvailable?: boolean;
  pending?: boolean;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`chat-hub-action chat-hub-disclosure-action${expanded ? ' expanded' : ''}`}
      aria-expanded={expanded}
      aria-label={ariaLabel ?? `${label} details`}
      title={label}
      onClick={onToggle}
    >
      <Icon name={pending ? 'loader' : icon} spin={pending} />
      <span className="chat-hub-action-info">{info}</span>
      {updateAvailable ? <span className="chat-hub-update-dot" aria-hidden="true" /> : null}
    </button>
  );
}

function ChatHubDetailToolbar({
  label,
  actionLabel,
  pending,
  disabled,
  onAction,
}: {
  label: string;
  actionLabel: string;
  pending: boolean;
  disabled: boolean;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <div className="chat-hub-detail-toolbar">
      <span className="chat-hub-detail-title">{label}</span>
      <button
        type="button"
        className="chat-hub-detail-action"
        aria-label={actionLabel}
        disabled={disabled || pending}
        onClick={onAction}
      >
        <Icon name={pending ? 'loader' : 'refreshCw'} spin={pending} />
        <span>{pending ? 'Running…' : 'Update all'}</span>
      </button>
    </div>
  );
}

function ChatHubNpmDetail({
  hubId,
  ops,
  onUpdateAll,
  onPackageAction,
}: {
  hubId: string;
  ops: ChatHubOpsView;
  onUpdateAll: ChatHubMenuProps['onRequestNpmUpdate'];
  onPackageAction: ChatHubMenuProps['onPackageAction'];
}): React.JSX.Element {
  return (
    <div className="chat-hub-detail">
      <ChatHubDetailToolbar
        label="NPM packages"
        actionLabel="Update all NPM packages"
        pending={ops.npm.pending}
        disabled={ops.npm.outdatedCount === 0}
        onAction={() => onUpdateAll(hubId)}
      />
      {ops.npm.packages.map(pkg => {
        const updateAvailable = pkg.action === 'update' && Boolean(pkg.installedVersion) && Boolean(pkg.latestVersion);
        return (
          <div key={pkg.packageName} className="chat-hub-npm-row">
            <span className="chat-hub-npm-name-cell">
              <span
                className={`chat-hub-npm-name${pkg.installedVersion ? '' : ' missing'}`}
                title={pkg.packageName}
              >
                {pkg.displayName}
              </span>
              <span className="chat-hub-npm-versions">
                <span className="chat-hub-npm-version-copy">
                  {pkg.installedVersion
                    ? updateAvailable
                      ? <>{pkg.installedVersion} → <span className="chat-hub-npm-version-new">{pkg.latestVersion}</span></>
                      : pkg.installedVersion
                    : pkg.latestVersion || '—'}
                </span>
              </span>
            </span>
            <span className="chat-hub-npm-actions">
              {pkg.action ? (
                <button
                  type="button"
                  className={`chat-hub-icon-btn${pkg.action === 'update' ? ' accent' : ''}`}
                  aria-label={`${pkg.action === 'install' ? 'Install' : 'Update'} ${pkg.displayName}`}
                  disabled={pkg.pending}
                  onClick={() => onPackageAction(hubId, pkg.action!, pkg)}
                >
                  <Icon name={pkg.pending ? 'loader' : pkg.action === 'install' ? 'cloudDownload' : 'refreshCw'} spin={pkg.pending} />
                </button>
              ) : null}
              {pkg.canUninstall ? (
                <button
                  type="button"
                  className="chat-hub-icon-btn danger"
                  aria-label={`Uninstall ${pkg.displayName}`}
                  disabled={pkg.pending}
                  onClick={() => onPackageAction(hubId, 'uninstall', pkg)}
                >
                  <Icon name={pkg.pending ? 'loader' : 'trash'} spin={pkg.pending} />
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
      {ops.npm.packages.length === 0 ? <div className="chat-hub-detail-empty">No packages</div> : null}
    </div>
  );
}

function ChatHubSkillsDetail({
  hubId,
  ops,
  actions,
}: {
  hubId: string;
  ops: ChatHubOpsView;
  actions: ChatHubSkillActions;
}): React.JSX.Element {
  return (
    <div className="chat-hub-detail">
      <ChatHubSkillScopeDetail
        target={{hubId, scope: 'hub'}}
        label="Global skills"
        skills={ops.skills.hubItems}
        loading={ops.skills.loading}
        error={ops.skills.error}
        operationRunning={ops.skills.operationRunning}
        pendingKey={ops.skills.pendingKey}
        actions={actions}
      />
    </div>
  );
}

function ChatHubMcpDetail(): React.JSX.Element {
  return (
    <div className="chat-hub-detail chat-hub-mcp-detail">
      <div className="chat-hub-detail-toolbar">
        <span className="chat-hub-detail-title">MCP servers</span>
      </div>
      <div className="chat-hub-detail-empty">No MCP servers configured.</div>
    </div>
  );
}

function ChatHubProjectSkillsDetail({
  hubId,
  activeProjectId,
  ops,
  actions,
}: {
  hubId: string;
  activeProjectId: string;
  ops: ChatHubOpsView;
  actions: ChatHubSkillActions;
}): React.JSX.Element {
  const projects = React.useMemo(
    () => onlineSkillProjects(ops.skills.projects),
    [ops.skills.projects],
  );
  const [selectedProjectName, setSelectedProjectName] = React.useState('');
  const [projectPickerOpen, setProjectPickerOpen] = React.useState(false);
  const projectPickerMenuRef = React.useRef<HTMLDivElement>(null);
  const selectedProject = projects.find(project => project.projectName === selectedProjectName)
    ?? projects.find(project => project.projectId === activeProjectId)
    ?? projects[0]
    ?? null;

  React.useEffect(() => {
    const nextName = selectedProject?.projectName ?? '';
    if (nextName !== selectedProjectName) {
      setSelectedProjectName(nextName);
    }
  }, [selectedProject?.projectName, selectedProjectName]);

  // Move focus into the listbox when it opens so arrow keys work immediately.
  React.useEffect(() => {
    if (!projectPickerOpen) {
      return;
    }
    const menu = projectPickerMenuRef.current;
    const target = menu?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?? menu?.querySelector<HTMLElement>('[role="option"]');
    target?.focus();
  }, [projectPickerOpen]);

  const moveProjectOptionFocus = (delta: number | 'first' | 'last') => {
    const options = projectPickerMenuRef.current
      ? Array.from(projectPickerMenuRef.current.querySelectorAll<HTMLElement>('[role="option"]'))
      : [];
    if (options.length === 0) {
      return;
    }
    const currentIndex = options.indexOf(document.activeElement as HTMLElement);
    const nextIndex = delta === 'first'
      ? 0
      : delta === 'last'
        ? options.length - 1
        : Math.max(0, Math.min(options.length - 1, (currentIndex < 0 ? 0 : currentIndex) + delta));
    options[nextIndex]?.focus();
  };

  if (projects.length === 0 || !selectedProject) {
    return (
      <div className="chat-hub-detail">
        <div className="chat-hub-detail-empty">No online projects</div>
      </div>
    );
  }

  return (
    <div className="chat-hub-detail chat-hub-project-skills-detail">
      <div
        className="chat-hub-project-skill-select"
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setProjectPickerOpen(false);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            setProjectPickerOpen(false);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveProjectOptionFocus(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveProjectOptionFocus(-1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            moveProjectOptionFocus('first');
          } else if (event.key === 'End') {
            event.preventDefault();
            moveProjectOptionFocus('last');
          }
        }}
      >
        <button
          type="button"
          className="chat-hub-project-skill-trigger"
          aria-label={`Select project, ${selectedProject.projectName}`}
          aria-haspopup="listbox"
          aria-expanded={projectPickerOpen}
          data-selected-project={selectedProject.projectName}
          title={selectedProject.projectName}
          onClick={() => setProjectPickerOpen(current => !current)}
        >
          <span className="chat-hub-project-skill-name">{selectedProject.projectName}</span>
          <span className="chat-hub-project-skill-count">{selectedProject.skills.length}</span>
          <Icon name="chevronDown" className="chat-hub-project-skill-chevron" />
        </button>
        {projectPickerOpen ? (
          <div className="chat-hub-project-skill-menu" role="listbox" aria-label="Project" ref={projectPickerMenuRef}>
            {projects.map(project => {
              const selected = project.projectName === selectedProject.projectName;
              return (
                <button
                  key={project.projectName}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`chat-hub-project-skill-option${selected ? ' selected' : ''}`}
                  data-project-name={project.projectName}
                  title={project.projectName}
                  onClick={() => {
                    setSelectedProjectName(project.projectName);
                    setProjectPickerOpen(false);
                  }}
                >
                  <span className="chat-hub-project-skill-name">{project.projectName}</span>
                  <span className="chat-hub-project-skill-count">{project.skills.length}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <ChatHubSkillScopeDetail
        target={{
          hubId,
          scope: 'project',
          projectName: selectedProject.projectName,
        }}
        label="Project skills"
        skills={selectedProject.skills}
        loading={ops.skills.loading}
        error={selectedProject.error || ops.skills.error}
        operationRunning={ops.skills.operationRunning}
        pendingKey={ops.skills.pendingKey}
        actions={actions}
      />
    </div>
  );
}

function ChatHubScanDetail({
  hubId,
  ops,
  onScanAll,
  onScanProject,
}: {
  hubId: string;
  ops: ChatHubOpsView;
  onScanAll: ChatHubMenuProps['onScanAllIndexes'];
  onScanProject: ChatHubMenuProps['onScanProject'];
}): React.JSX.Element {
  return (
    <div className="chat-hub-detail">
      <div className="chat-hub-detail-toolbar">
        <span className="chat-hub-detail-title">Project indexes</span>
        <button
          type="button"
          className="chat-hub-detail-action"
          aria-label="Scan all projects"
          disabled={ops.index.projects.length === 0 || ops.index.pending}
          onClick={() => onScanAll(hubId)}
        >
          <Icon name={ops.index.pending ? 'loader' : 'refreshCw'} spin={ops.index.pending} />
          <span>{ops.index.pending ? 'Scanning…' : 'Scan all'}</span>
        </button>
      </div>
      {ops.index.projects.map(project => (
        <div key={project.projectId} className="chat-hub-scan-row">
          <span className="chat-hub-scan-name" title={project.projectId}>{project.name}</span>
          <span className={`chat-hub-scan-status status-${project.status}`}>{project.status}</span>
          <button
            type="button"
            className="chat-hub-icon-btn"
            aria-label={`Scan ${project.name}`}
            disabled={project.pending || ops.index.pending}
            onClick={() => onScanProject(hubId, project.projectId)}
          >
            <Icon name={project.pending ? 'loader' : 'refreshCw'} spin={project.pending} />
          </button>
        </div>
      ))}
      {ops.index.projects.length === 0 ? <div className="chat-hub-detail-empty">No projects</div> : null}
    </div>
  );
}

function ChatHubBlock(props: ChatHubMenuProps & {hubId: string}): React.JSX.Element {
  const {
    hubId,
    treeItems,
    expandedHubIds,
    onToggleHub,
    expandedSections,
    onToggleSection,
    hubColors,
    setHubColors,
    hubAccentStyle,
    colorMenuHubId,
    colorMenuExiting,
    onToggleColorMenu,
    flickerStatuses,
    flickerActionHubId,
    onFlickerSwitchMode,
    hubConfigByHubId,
    onUpdateHubConfig,
    opsByHubId,
    onRequestWheelMakerUpdate,
    onRequestNpmUpdate,
    onPackageAction,
    onRequestSkillInstall,
    onRequestSkillDetail,
    onRequestSkillUpdate,
    onRequestSkillUninstall,
    onRequestSkillBatchUninstall,
    onRetrySkills,
    onScanAllIndexes,
    onScanProject,
    hiddenProjectIdSet,
    onToggleProject,
    activeProjectId,
    mobile,
  } = props;
  const treeItem = treeItems.find(item => item.hubId === hubId) ?? {hubId, projects: [], connectionMode: undefined};
  const expanded = expandedHubIds.includes(hubId);
  const colorMenuOpen = colorMenuHubId === hubId;
  const flickerStatus = flickerStatuses[hubId];
  const configView = hubConfigByHubId[hubId];
  const ops = opsByHubId[hubId] ?? EMPTY_OPS_VIEW;
  const openSections = expandedSections[hubId] ?? [];
  const sectionOpen = (section: ChatHubDetailId) => openSections.includes(section);
  const visibleProjectCount = treeItem.projects.filter(project => !hiddenProjectIdSet.has(project.projectId)).length;
  const skillActions: ChatHubSkillActions = {
    onAdd: onRequestSkillInstall,
    onDetail: onRequestSkillDetail,
    onUpdate: onRequestSkillUpdate,
    onUninstall: onRequestSkillUninstall,
    onBatchUninstall: onRequestSkillBatchUninstall,
    onRetry: onRetrySkills,
  };

  const flickerConfig = configView?.data?.flickerBridge ?? null;
  const flickerOn = flickerConfig
    ? flickerConfig.enabled
    : flickerStatus?.state === 'running' || flickerStatus?.state === 'starting';
  const flickerMode = (flickerStatus?.mode ?? flickerConfig?.mode ?? '').toUpperCase();
  const settingsSummary = (
    <span className={`chat-hub-settings-state ${flickerOn ? 'on' : 'off'}`}>
      <span className="chat-hub-settings-state-dot" aria-hidden="true" />
      {flickerOn ? flickerMode || 'On' : 'Off'}
    </span>
  );

  const toggleSection = (section: ChatHubDetailId) => onToggleSection(hubId, section);
  return (
    <div
      className={`chat-hub-tree${expanded ? ' expanded' : ''}${colorMenuOpen ? ' color-open' : ''}`}
      style={hubAccentStyle(hubId)}
    >
      <div className="chat-hub-row">
        <button
          type="button"
          className="chat-hub-expand-button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${hubId}`}
          aria-expanded={expanded}
          onClick={() => onToggleHub(hubId)}
        />
        <button
          type="button"
          className="chat-hub-color-button"
          aria-label={`Set color for ${hubId}`}
          aria-expanded={colorMenuOpen}
          onClick={() => onToggleColorMenu(colorMenuOpen ? null : hubId)}
        >
          <span className="chat-hub-color-dot" aria-hidden="true" />
        </button>
        <span className="chat-hub-row-name">{hubId}</span>
        <button
          type="button"
          className="chat-hub-action chat-hub-version-action"
          aria-label={`${ops.wheelMaker.actionLabel} ${ops.wheelMaker.currentVersion}`}
          disabled={!ops.wheelMaker.actionVisible || ops.wheelMaker.pending}
          onClick={() => onRequestWheelMakerUpdate(hubId)}
        >
          <span className="chat-hub-action-label">{ops.wheelMaker.currentVersion}</span>
          <Icon
            name={ops.wheelMaker.pending ? 'loader' : ops.wheelMaker.updateAvailable ? 'cloudDownload' : 'refreshCw'}
            spin={ops.wheelMaker.pending}
          />
          {ops.wheelMaker.updateAvailable ? <span className="chat-hub-update-dot" aria-hidden="true" /> : null}
        </button>
        <Icon
          name="chevronRight"
          className="chat-hub-expand-chevron"
        />
      </div>
      {colorMenuOpen ? (
        <ChatHubColorPalette
          hubId={hubId}
          inline={mobile}
          exiting={colorMenuExiting}
          hubColors={hubColors}
          setHubColors={setHubColors}
          hubAccentStyle={hubAccentStyle}
        />
      ) : null}
      {expanded ? (
        <div className="chat-hub-sections">
          {treeItem.connectionMode === 'update_only' ? (
            <div className="chat-hub-protocol-mismatch">Protocol mismatch · Update only</div>
          ) : null}
          <div className="chat-hub-section">
            <ChatHubSectionHeader
              icon="settings"
              label="Settings"
              summary={settingsSummary}
              expanded={sectionOpen('settings')}
              onToggle={() => toggleSection('settings')}
            />
            {sectionOpen('settings') ? (
              <div className="chat-hub-section-body">
                <ChatHubSettingsSection
                  hubId={hubId}
                  configView={configView}
                  onUpdateHubConfig={onUpdateHubConfig}
                  flickerStatus={flickerStatus}
                  flickerBusy={flickerActionHubId === hubId}
                  onFlickerSwitchMode={mode => onFlickerSwitchMode(hubId, mode)}
                />
              </div>
            ) : null}
          </div>
          <div className="chat-hub-line">
            <span className="chat-hub-line-icon"><Icon name="serverCog" /></span>
            <span className="chat-hub-line-label">Global</span>
            <span className="chat-hub-line-actions chat-hub-hub-actions">
              <ChatHubDisclosureButton
                label="NPM"
                info={`${ops.npm.outdatedCount}`}
                icon="package"
                updateAvailable={ops.npm.outdatedCount > 0}
                pending={ops.npm.pending}
                expanded={sectionOpen('npm')}
                onToggle={() => toggleSection('npm')}
              />
              <ChatHubDisclosureButton
                label="MCP"
                info="0"
                icon="mcp"
                expanded={sectionOpen('mcp')}
                onToggle={() => toggleSection('mcp')}
              />
              <ChatHubDisclosureButton
                label="Skills"
                info={`${ops.skills.hubItems.length}`}
                icon="wand"
                pending={ops.skills.loading || ops.skills.operationRunning}
                expanded={sectionOpen('skills')}
                onToggle={() => toggleSection('skills')}
              />
            </span>
          </div>
          {sectionOpen('npm') ? (
            <ChatHubNpmDetail hubId={hubId} ops={ops} onUpdateAll={onRequestNpmUpdate} onPackageAction={onPackageAction} />
          ) : null}
          {sectionOpen('mcp') ? <ChatHubMcpDetail /> : null}
          {sectionOpen('skills') ? (
            <ChatHubSkillsDetail
              hubId={hubId}
              ops={ops}
              actions={skillActions}
            />
          ) : null}
          <div className="chat-hub-line">
            <span className="chat-hub-line-icon"><Icon name="folder" /></span>
            <span className="chat-hub-line-label">Projects</span>
            <span className="chat-hub-line-actions chat-hub-project-actions">
              <ChatHubDisclosureButton
                label="Visibility"
                info={`${visibleProjectCount}/${treeItem.projects.length}`}
                icon="eye"
                expanded={sectionOpen('visibility')}
                onToggle={() => toggleSection('visibility')}
              />
              <ChatHubDisclosureButton
                label="Scan"
                info={`${ops.index.indexedCount}/${ops.index.totalCount}`}
                icon="scanLine"
                pending={ops.index.pending}
                expanded={sectionOpen('scan')}
                onToggle={() => toggleSection('scan')}
              />
              <ChatHubDisclosureButton
                label="Skills"
                ariaLabel="Project Skills details"
                info={`${projectSkillTotal(ops.skills.projects)}`}
                icon="wand"
                pending={ops.skills.loading || ops.skills.operationRunning}
                expanded={sectionOpen('projectSkills')}
                onToggle={() => toggleSection('projectSkills')}
              />
            </span>
          </div>
          {sectionOpen('visibility') ? (
            <div className="chat-hub-detail">
              <div className="chat-hub-project-list">
                {treeItem.projects.map(projectItem => {
                  const visible = !hiddenProjectIdSet.has(projectItem.projectId);
                  return (
                    <button
                      key={`${hubId}:project:${projectItem.projectId}`}
                      type="button"
                      className={`chat-hub-project-row${visible ? '' : ' hidden'}`}
                      role="checkbox"
                      aria-checked={visible}
                      onClick={event => {
                        event.stopPropagation();
                        onToggleProject(projectItem.projectId, !visible);
                      }}
                      title={projectItem.path || projectItem.projectId}
                    >
                      <span className="chat-hub-project-check" aria-hidden="true">
                        {visible ? <Icon name="check" /> : null}
                      </span>
                      <span className="chat-hub-project-name">{projectItem.name}</span>
                    </button>
                  );
                })}
                {treeItem.projects.length === 0 ? (
                  <div className="chat-hub-project-empty">No projects</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {sectionOpen('scan') ? (
            <ChatHubScanDetail hubId={hubId} ops={ops} onScanAll={onScanAllIndexes} onScanProject={onScanProject} />
          ) : null}
          {sectionOpen('projectSkills') ? (
            <ChatHubProjectSkillsDetail
              hubId={hubId}
              activeProjectId={activeProjectId}
              ops={ops}
              actions={skillActions}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const ChatHubMenu = React.memo(function ChatHubMenu(props: ChatHubMenuProps): React.JSX.Element {
  const {
    mobile,
    open,
    exiting,
    summaryLabel,
    projectLabel,
    hubIds,
    popoverStyle,
    menuRef,
    popoverRef,
    onToggle,
    onClose,
    latestVersion,
    updateAllAvailableCount,
    updateAllPending,
    onUpdateAllHubs,
    skillSurface,
    skillInstall,
    skillDetail,
    onCloseSkillSurface,
  } = props;

  const panel = (
    <>
      {hubIds.length > 0 ? (
        hubIds.map(hubId => <ChatHubBlock key={hubId} {...props} hubId={hubId} />)
      ) : (
        <div className="chat-hub-empty">No hubs</div>
      )}
      <div className="chat-hub-footer">
        <span className="chat-hub-footer-version">
          Latest <span className="chat-hub-footer-version-value">{latestVersion}</span>
        </span>
        <button
          type="button"
          className="chat-hub-footer-update-all"
          disabled={updateAllAvailableCount === 0 || updateAllPending}
          onClick={onUpdateAllHubs}
        >
          {updateAllPending ? <Icon name="loader" spin /> : <Icon name="cloudDownload" />}
          {updateAllPending ? 'Updating all hubs…' : 'Update all hubs'}
        </button>
      </div>
    </>
  );

  return (
    <div ref={menuRef} className="chat-hub-summary">
      <button
        type="button"
        className="chat-hub-summary-button"
        aria-label={`Show connected hubs, ${summaryLabel}, ${projectLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="chat-hub-summary-copy">
          <span className="chat-hub-summary-label">{summaryLabel}</span>
          <span className="chat-hub-summary-project-label">{projectLabel}</span>
        </span>
        <Icon name="chevronDown" />
      </button>
      {open && typeof document !== 'undefined' ? createPortal(
        mobile ? (
          <div
            ref={popoverRef}
            className={`chat-hub-page${exiting ? ' sl-menu-exit' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Hub settings"
          >
            <div className="chat-hub-page-header">
              <button
                type="button"
                className="chat-hub-page-back"
                aria-label="Back"
                onClick={skillSurface ? onCloseSkillSurface : onClose}
              >
                <Icon name="arrowLeft" />
              </button>
              <span className="chat-hub-page-title">
                {skillSurface
                  ? skillSurface.kind === 'install'
                    ? 'Add Skill'
                    : skillSurface.target.skillName
                  : 'Hubs'}
              </span>
            </div>
            <div className={`chat-hub-page-body${skillSurface ? ' skill-child' : ''}`}>
              {skillSurface ? (
                <React.Suspense fallback={null}>
                  <ChatHubSkillCompanion
                    surface={skillSurface}
                    install={skillInstall}
                    detail={skillDetail}
                    onClose={onCloseSkillSurface}
                  />
                </React.Suspense>
              ) : panel}
            </div>
          </div>
        ) : (
          <div
            ref={popoverRef}
            className="chat-hub-popover-stack"
            style={popoverStyle}
          >
            <div
              className={`chat-hub-popover topbar-menu-surface${exiting ? ' sl-menu-exit' : ''}`}
              role="dialog"
              aria-label="Hub and project display preferences"
            >
              {panel}
            </div>
            {skillSurface ? (
              <aside className="chat-hub-skill-companion desktop">
                <React.Suspense fallback={null}>
                  <ChatHubSkillCompanion
                    surface={skillSurface}
                    install={skillInstall}
                    detail={skillDetail}
                    onClose={onCloseSkillSurface}
                  />
                </React.Suspense>
              </aside>
            ) : null}
          </div>
        ),
        document.body,
      ) : null}
    </div>
  );
});
