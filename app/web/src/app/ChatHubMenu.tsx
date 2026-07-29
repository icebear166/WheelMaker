import React from 'react';
import {createPortal} from 'react-dom';

import {Icon, type IconName} from '../common/Icon';
import {SecretEditor} from '../common/SecretEditor';
import type {
  RegistryFlickerBridgeMode,
  RegistryFlickerBridgeStatus,
  RegistryHubConfig,
  RegistryHubConfigUpdatePayload,
} from '../registry/registryTypes';
import {
  HUB_COLOR_PRESETS,
  hubColorToHsv,
  hubHsvToColor,
  resolveDefaultHubColor,
  resolveHubColor,
  setHubColorPreference,
  type HubColorHsv,
} from '../workspace/hubProjectPreferences';
export type ChatHubDetailId = 'settings' | 'npm' | 'skills' | 'visibility' | 'scan';

function chatHubDetailGroup(section: ChatHubDetailId): 'settings' | 'hub' | 'projects' {
  if (section === 'settings') return 'settings';
  if (section === 'npm' || section === 'skills') return 'hub';
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

export interface ChatHubSkillView {
  name: string;
  category: string;
  managed: boolean;
  agents: string[];
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
    pending: boolean;
    error: string;
    count: number;
    items: ChatHubSkillView[];
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
  skills: {loading: false, pending: false, error: '', count: 0, items: []},
  index: {pending: false, indexedCount: 0, totalCount: 0, projects: []},
};

export interface ChatHubMenuProps {
  mobile: boolean;
  open: boolean;
  exiting: boolean;
  summaryLabel: string;
  projectLabel: string;
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
  onRequestSkillUpdate: (hubId: string, skillName?: string) => void;
  onRequestSkillUninstall: (hubId: string, skillName: string) => void;
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
      <Icon name={expanded ? 'chevronDown' : 'chevronRight'} className="chat-hub-section-chevron" />
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

  return (
    <div
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
          aria-valuetext={`${Math.round(currentHubHsv.s * 100)}% saturation, ${Math.round(currentHubHsv.v * 100)}% brightness`}
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
          aria-valuenow={currentHubHsv.h}
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
  info,
  pending = false,
  expanded,
  onToggle,
}: {
  label: string;
  info?: string;
  pending?: boolean;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`chat-hub-action chat-hub-disclosure-action${expanded ? ' expanded' : ''}`}
      aria-expanded={expanded}
      aria-label={`${label} details`}
      onClick={onToggle}
    >
      <span className="chat-hub-action-label">{label}</span>
      {info ? <span className="chat-hub-action-info">{info}</span> : null}
      <Icon name={pending ? 'loader' : expanded ? 'chevronDown' : 'chevronRight'} spin={pending} />
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
      {ops.npm.packages.map(pkg => (
        <div key={pkg.packageName} className="chat-hub-npm-row">
          <span className="chat-hub-npm-name" title={pkg.packageName}>{pkg.displayName}</span>
          <span className="chat-hub-npm-versions">
            <span className={`chat-hub-npm-install-state ${pkg.installedVersion ? 'installed' : 'not-installed'}`}>
              {pkg.installedVersion ? 'Installed' : 'Not installed'}
            </span>
            <span className="chat-hub-npm-version-copy">
              {pkg.installedVersion
                ? `${pkg.installedVersion}${pkg.latestVersion ? ` → ${pkg.latestVersion}` : ''}`
                : pkg.latestVersion
                  ? `Latest ${pkg.latestVersion}`
                  : 'No version'}
            </span>
          </span>
          <span className="chat-hub-row-actions">
            <button
              type="button"
              className="chat-hub-icon-btn"
              aria-label={pkg.action ? `${pkg.action === 'install' ? 'Install' : 'Update'} ${pkg.displayName}` : `${pkg.displayName} is up to date`}
              disabled={!pkg.action || pkg.pending}
              onClick={() => pkg.action && onPackageAction(hubId, pkg.action, pkg)}
            >
              <Icon name={pkg.pending ? 'loader' : pkg.action === 'install' ? 'cloudDownload' : 'refreshCw'} spin={pkg.pending} />
            </button>
            <button
              type="button"
              className="chat-hub-icon-btn danger"
              aria-label={`Uninstall ${pkg.displayName}`}
              disabled={!pkg.canUninstall || pkg.pending}
              onClick={() => onPackageAction(hubId, 'uninstall', pkg)}
            >
              <Icon name="trash" />
            </button>
          </span>
        </div>
      ))}
      {ops.npm.packages.length === 0 ? <div className="chat-hub-detail-empty">No packages</div> : null}
    </div>
  );
}

function ChatHubSkillsDetail({
  hubId,
  ops,
  onUpdate,
  onUninstall,
}: {
  hubId: string;
  ops: ChatHubOpsView;
  onUpdate: ChatHubMenuProps['onRequestSkillUpdate'];
  onUninstall: ChatHubMenuProps['onRequestSkillUninstall'];
}): React.JSX.Element {
  return (
    <div className="chat-hub-detail">
      <ChatHubDetailToolbar
        label="Global skills"
        actionLabel="Update all Hub skills"
        pending={ops.skills.pending}
        disabled={ops.skills.loading || ops.skills.items.every(skill => !skill.managed)}
        onAction={() => onUpdate(hubId)}
      />
      {ops.skills.items.map(skill => {
        const disabled = !skill.managed || ops.skills.loading || ops.skills.pending || skill.pending;
        return (
          <div key={skill.name} className="chat-hub-skill-row">
            <span className="chat-hub-skill-main">
              <span className="chat-hub-skill-name" title={skill.name}>{skill.name}</span>
              <span className="chat-hub-skill-meta">
                {skill.category}{skill.agents.length > 0 ? ` · ${skill.agents.join(', ')}` : ''}
              </span>
            </span>
            <span className="chat-hub-row-actions">
              <button
                type="button"
                className="chat-hub-icon-btn"
                aria-label={`Update ${skill.name}`}
                disabled={disabled}
                onClick={() => onUpdate(hubId, skill.name)}
              >
                <Icon name={skill.pending ? 'loader' : 'refreshCw'} spin={skill.pending} />
              </button>
              <button
                type="button"
                className="chat-hub-icon-btn danger"
                aria-label={`Uninstall ${skill.name}`}
                disabled={disabled}
                onClick={() => onUninstall(hubId, skill.name)}
              >
                <Icon name="trash" />
              </button>
            </span>
          </div>
        );
      })}
      {ops.skills.loading && ops.skills.items.length === 0 ? (
        <div className="chat-hub-detail-empty"><Icon name="loader" spin /> Loading skills…</div>
      ) : null}
      {!ops.skills.loading && ops.skills.items.length === 0 && !ops.skills.error ? (
        <div className="chat-hub-detail-empty">No global skills</div>
      ) : null}
      {ops.skills.error ? <div className="chat-hub-ops-error">{ops.skills.error}</div> : null}
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
    onRequestSkillUpdate,
    onRequestSkillUninstall,
    onScanAllIndexes,
    onScanProject,
    hiddenProjectIdSet,
    onToggleProject,
    mobile,
  } = props;
  const treeItem = treeItems.find(item => item.hubId === hubId) ?? {hubId, projects: []};
  const expanded = expandedHubIds.includes(hubId);
  const colorMenuOpen = colorMenuHubId === hubId;
  const flickerStatus = flickerStatuses[hubId];
  const configView = hubConfigByHubId[hubId];
  const ops = opsByHubId[hubId] ?? EMPTY_OPS_VIEW;
  const openSections = expandedSections[hubId] ?? [];
  const sectionOpen = (section: ChatHubDetailId) => openSections.includes(section);
  const visibleProjectCount = treeItem.projects.filter(project => !hiddenProjectIdSet.has(project.projectId)).length;

  const flickerConfig = configView?.data?.flickerBridge ?? null;
  const flickerOn = flickerConfig
    ? flickerConfig.enabled
    : flickerStatus?.state === 'running' || flickerStatus?.state === 'starting';
  const flickerMode = (flickerStatus?.mode ?? flickerConfig?.mode ?? '').toUpperCase();
  const settingsSummary = flickerOn ? (
    <>
      {flickerMode || 'On'}
      <Icon name="check" className="chat-hub-summary-mark ok" aria-label="Flicker Bridge on" />
    </>
  ) : (
    <>
      Off
      <Icon name="x" className="chat-hub-summary-mark" aria-label="Flicker Bridge off" />
    </>
  );

  const toggleSection = (section: ChatHubDetailId) => onToggleSection(hubId, section);
  return (
    <div className={`chat-hub-tree${expanded ? ' expanded' : ''}${colorMenuOpen ? ' color-open' : ''}`}>
      <div className="chat-hub-row" style={hubAccentStyle(hubId)}>
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
          style={hubAccentStyle(hubId)}
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
        </button>
        <Icon
          name={expanded ? 'chevronDown' : 'chevronRight'}
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
            <span className="chat-hub-line-label">Hub</span>
            <span className="chat-hub-line-actions chat-hub-hub-actions">
              <ChatHubDisclosureButton
                label="NPM"
                info={ops.npm.outdatedCount > 0 ? `${ops.npm.outdatedCount}` : undefined}
                pending={ops.npm.pending}
                expanded={sectionOpen('npm')}
                onToggle={() => toggleSection('npm')}
              />
              <ChatHubDisclosureButton
                label="Skills"
                info={ops.skills.count > 0 ? `${ops.skills.count}` : undefined}
                pending={ops.skills.loading || ops.skills.pending}
                expanded={sectionOpen('skills')}
                onToggle={() => toggleSection('skills')}
              />
            </span>
          </div>
          {sectionOpen('npm') ? (
            <ChatHubNpmDetail hubId={hubId} ops={ops} onUpdateAll={onRequestNpmUpdate} onPackageAction={onPackageAction} />
          ) : null}
          {sectionOpen('skills') ? (
            <ChatHubSkillsDetail
              hubId={hubId}
              ops={ops}
              onUpdate={onRequestSkillUpdate}
              onUninstall={onRequestSkillUninstall}
            />
          ) : null}
          <div className="chat-hub-line">
            <span className="chat-hub-line-icon"><Icon name="folder" /></span>
            <span className="chat-hub-line-label">Projects</span>
            <span className="chat-hub-line-actions chat-hub-project-actions">
              <ChatHubDisclosureButton
                label="Visibility"
                info={`${visibleProjectCount}/${treeItem.projects.length}`}
                expanded={sectionOpen('visibility')}
                onToggle={() => toggleSection('visibility')}
              />
              <ChatHubDisclosureButton
                label="Scan"
                info={`${ops.index.indexedCount}/${ops.index.totalCount}`}
                pending={ops.index.pending}
                expanded={sectionOpen('scan')}
                onToggle={() => toggleSection('scan')}
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
    colorMenuHubId,
    latestVersion,
    updateAllAvailableCount,
    updateAllPending,
    onUpdateAllHubs,
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
              <button type="button" className="chat-hub-page-back" aria-label="Back" onClick={onClose}>
                <Icon name="arrowLeft" />
              </button>
              <span className="chat-hub-page-title">Hubs</span>
              <button type="button" className="chat-hub-page-close" aria-label="Close" onClick={onClose}>
                <Icon name="x" />
              </button>
            </div>
            <div className="chat-hub-page-body">{panel}</div>
          </div>
        ) : (
          <div
            ref={popoverRef}
            className={`chat-hub-popover topbar-menu-surface${colorMenuHubId ? ' no-overflow' : ''}${exiting ? ' sl-menu-exit' : ''}`}
            role="dialog"
            aria-label="Hub and project display preferences"
            style={popoverStyle}
          >
            {panel}
          </div>
        ),
        document.body,
      ) : null}
    </div>
  );
});
