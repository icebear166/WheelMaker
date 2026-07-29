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
    pending: boolean;
    error: string;
    count: number;
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
  skills: {pending: false, error: '', count: 0},
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
  expandedSections: Record<string, ChatHubDetailId | null>;
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
  onScanSkills: (hubId: string) => void;
  onScanAllIndexes: (hubId: string) => void;
  onScanProject: (hubId: string, projectId: string) => void;
  hiddenProjectIdSet: Set<string>;
  onToggleProject: (projectId: string, visible: boolean) => void;
  onToggleAllProjects: (hubId: string, visible: boolean) => void;
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

function ChatHubActionButton({
  icon,
  label,
  expandLabel,
  info,
  disabled = false,
  pending = false,
  expanded,
  onAction,
  onExpand,
}: {
  /** When set, the main button shows the icon and uses label as its aria-label. */
  icon?: IconName;
  label: string;
  /** aria-label base for the expand toggle; defaults to label. */
  expandLabel?: string;
  info?: string;
  disabled?: boolean;
  pending?: boolean;
  expanded?: boolean;
  onAction: () => void;
  onExpand?: () => void;
}): React.JSX.Element {
  return (
    <span className={`chat-hub-action${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="chat-hub-action-main"
        aria-label={icon ? label : undefined}
        disabled={disabled || pending}
        onClick={onAction}
      >
        {pending ? <Icon name="loader" spin /> : icon ? <Icon name={icon} /> : null}
        {icon ? null : <span className="chat-hub-action-label">{label}</span>}
        {info ? <span className="chat-hub-action-info">{info}</span> : null}
      </button>
      {onExpand ? (
        <button
          type="button"
          className="chat-hub-action-toggle"
          aria-expanded={expanded === true}
          aria-label={`${expandLabel ?? label} details`}
          onClick={onExpand}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
        </button>
      ) : null}
    </span>
  );
}

function ChatHubNpmDetail({
  hubId,
  ops,
  onPackageAction,
}: {
  hubId: string;
  ops: ChatHubOpsView;
  onPackageAction: ChatHubMenuProps['onPackageAction'];
}): React.JSX.Element {
  if (ops.npm.packages.length === 0) {
    return <div className="chat-hub-detail"><div className="chat-hub-detail-empty">No packages</div></div>;
  }
  return (
    <div className="chat-hub-detail">
      {ops.npm.packages.map(pkg => (
        <div key={pkg.packageName} className="chat-hub-npm-row">
          <span className="chat-hub-npm-name" title={pkg.packageName}>{pkg.displayName}</span>
          <span className="chat-hub-npm-versions">
            {pkg.installedVersion || '—'}{pkg.latestVersion ? ` → ${pkg.latestVersion}` : ''}
          </span>
          <span className="chat-hub-npm-actions">
            {pkg.action ? (
              <button
                type="button"
                className="chat-hub-mini-btn"
                disabled={pkg.pending}
                onClick={() => onPackageAction(hubId, pkg.action as 'update' | 'install', pkg)}
              >
                {pkg.pending ? 'Running…' : pkg.action === 'update' ? 'Update' : 'Install'}
              </button>
            ) : null}
            {pkg.canUninstall ? (
              <button
                type="button"
                className="chat-hub-icon-btn"
                aria-label={`Uninstall ${pkg.displayName}`}
                disabled={pkg.pending}
                onClick={() => onPackageAction(hubId, 'uninstall', pkg)}
              >
                <Icon name="trash" />
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChatHubSkillsDetail({ops}: {ops: ChatHubOpsView}): React.JSX.Element {
  return (
    <div className="chat-hub-detail">
      <div className="chat-hub-skills-summary">
        {ops.skills.pending ? 'Scanning skills…' : `${ops.skills.count} skills indexed`}
      </div>
      {ops.skills.error ? <div className="chat-hub-ops-error">{ops.skills.error}</div> : null}
    </div>
  );
}

function ChatHubScanDetail({
  hubId,
  ops,
  onScanProject,
}: {
  hubId: string;
  ops: ChatHubOpsView;
  onScanProject: ChatHubMenuProps['onScanProject'];
}): React.JSX.Element {
  if (ops.index.projects.length === 0) {
    return <div className="chat-hub-detail"><div className="chat-hub-detail-empty">No projects</div></div>;
  }
  return (
    <div className="chat-hub-detail">
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
    onScanSkills,
    onScanAllIndexes,
    onScanProject,
    hiddenProjectIdSet,
    onToggleProject,
    onToggleAllProjects,
    mobile,
  } = props;
  const treeItem = treeItems.find(item => item.hubId === hubId) ?? {hubId, projects: []};
  const expanded = expandedHubIds.includes(hubId);
  const colorMenuOpen = colorMenuHubId === hubId;
  const flickerStatus = flickerStatuses[hubId];
  const configView = hubConfigByHubId[hubId];
  const ops = opsByHubId[hubId] ?? EMPTY_OPS_VIEW;
  const openSection = expandedSections[hubId] ?? null;
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
  const allProjectsVisible = visibleProjectCount === treeItem.projects.length;

  return (
    <div className={`chat-hub-tree${expanded ? ' expanded' : ''}${colorMenuOpen ? ' color-open' : ''}`}>
      <div className="chat-hub-row" style={hubAccentStyle(hubId)}>
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
        <button
          type="button"
          className="chat-hub-expand-button"
          aria-expanded={expanded}
          onClick={() => onToggleHub(hubId)}
        >
          <span className="chat-hub-row-name">{hubId}</span>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
        </button>
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
              expanded={openSection === 'settings'}
              onToggle={() => toggleSection('settings')}
            />
            {openSection === 'settings' ? (
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
            <span className="chat-hub-line-summary">
              <span className="chat-hub-section-version">
                {ops.wheelMaker.currentVersion}
                {ops.wheelMaker.updateAvailable ? (
                  <span className="chat-hub-section-version-dot" role="img" aria-label="Update available" />
                ) : null}
              </span>
            </span>
            <span className="chat-hub-line-actions">
              <ChatHubActionButton
                label={ops.wheelMaker.actionLabel}
                disabled={!ops.wheelMaker.actionVisible}
                pending={ops.wheelMaker.pending}
                onAction={() => onRequestWheelMakerUpdate(hubId)}
              />
              <ChatHubActionButton
                label="NPM"
                info={ops.npm.outdatedCount > 0 ? `·${ops.npm.outdatedCount}` : undefined}
                disabled={ops.npm.outdatedCount === 0}
                pending={ops.npm.pending}
                expanded={openSection === 'npm'}
                onAction={() => onRequestNpmUpdate(hubId)}
                onExpand={() => toggleSection('npm')}
              />
              <ChatHubActionButton
                label="Skills"
                info={ops.skills.count > 0 ? `·${ops.skills.count}` : undefined}
                pending={ops.skills.pending}
                expanded={openSection === 'skills'}
                onAction={() => onScanSkills(hubId)}
                onExpand={() => toggleSection('skills')}
              />
            </span>
          </div>
          {openSection === 'npm' ? (
            <ChatHubNpmDetail hubId={hubId} ops={ops} onPackageAction={onPackageAction} />
          ) : null}
          {openSection === 'skills' ? (
            <ChatHubSkillsDetail ops={ops} />
          ) : null}
          <div className="chat-hub-line">
            <span className="chat-hub-line-icon"><Icon name="folder" /></span>
            <span className="chat-hub-line-label">Projects</span>
            <span className="chat-hub-line-summary">
              {visibleProjectCount}/{treeItem.projects.length}
            </span>
            <span className="chat-hub-line-actions">
              <ChatHubActionButton
                icon="eye"
                label={allProjectsVisible ? 'Hide all projects' : 'Show all projects'}
                expandLabel="Visibility"
                info={`${visibleProjectCount}/${treeItem.projects.length}`}
                expanded={openSection === 'visibility'}
                onAction={() => onToggleAllProjects(hubId, !allProjectsVisible)}
                onExpand={() => toggleSection('visibility')}
              />
              <ChatHubActionButton
                label="Scan"
                info={`${ops.index.indexedCount}/${ops.index.totalCount}`}
                pending={ops.index.pending}
                expanded={openSection === 'scan'}
                onAction={() => onScanAllIndexes(hubId)}
                onExpand={() => toggleSection('scan')}
              />
            </span>
          </div>
          {openSection === 'visibility' ? (
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
          {openSection === 'scan' ? (
            <ChatHubScanDetail hubId={hubId} ops={ops} onScanProject={onScanProject} />
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
