import { RegistryClient, type RegistryDebugSink } from './RegistryClient';
import type {RegistryDebugConnection} from '../debug/registryDebug';
import {RegistryMethods, RegistryProtocolVersion} from './registryMethods';
import {
  normalizeServerSettings,
  type ServerSettings,
  type ServerSettingsUpdate,
  type SpeechModelId,
} from '../settings/serverSettings';
import {
  decodeSessionTurnToMessage,
  normalizeSessionReadPayload,
} from '../chat/chatWire';
import type {
  RegistryDebugUploadLogPayload,
  RegistryDebugUploadLogResponse,
  RegistryDeviceSession,
  RegistryClientName,
  RegistryEnvelope,
  RegistryFileIndexRebuildResponse,
  RegistryFileIndexSearchResponse,
  RegistryFileIndexStatusResponse,
  RegistryFsInfo,
  RegistryFsListResponse,
  RegistryFsReadResponse,
  RegistryGitCommit,
  RegistryGitCommitFile,
  RegistryGitFileDiff,
  RegistryGitRev,
  RegistryGitStatus,
  RegistryHub,
  RegistryHubConfig,
  RegistryHubConfigResponse,
  RegistryHubConfigUpdatePayload,
  RegistryHubState,
  RegistryHubStateSectionName,
  RegistryUsageHistoryLimit,
  RegistryUsageHistoryResponse,
	RegistryReleasePublishResponse,
  RegistryNpmCommandResponse,
  RegistryNpmHubSnapshot,
  RegistryNpmPackage,
  RegistryProject,
  RegistryProjectAgentProfile,
  RegistryProjectListResponse,
  RegistryPortRelayEnablePayload,
  RegistryPortRelaySnapshot,
  RegistryPermissionRespondResponse,
  RegistryResumableSession,
  RegistryArchivedSessionSummary,
  RegistrySessionArchiveReadResponse,
  RegistrySessionArchiveRestoreResponse,
  RegistrySpeechCancelPayload,
  RegistrySpeechChunkPayload,
  RegistrySpeechFinishPayload,
  RegistrySpeechStartPayload,
  RegistrySpeechStartResponse,
	RegistryTTSSynthesizePayload,
	RegistryTTSSynthesizeResponse,
  RegistrySessionAttachmentCancelPayload,
  RegistrySessionAttachmentCancelResponse,
  RegistrySessionAttachmentChunkPayload,
  RegistrySessionAttachmentChunkResponse,
  RegistrySessionAttachmentDeletePayload,
  RegistrySessionAttachmentDeleteResponse,
  RegistrySessionAttachmentFinishPayload,
  RegistrySessionAttachmentFinishResponse,
  RegistrySessionAttachmentReadPayload,
  RegistrySessionAttachmentContentResponse,
  RegistrySessionAttachmentStartPayload,
  RegistrySessionAttachmentStartResponse,
  RegistrySessionArtifactReadResponse,
  RegistrySessionContentBlock,
  RegistrySessionConfigOption,
  RegistrySessionConfigOptionValue,
  RegistrySessionCommand,
  RegistrySessionActionCapabilities,
  RegistrySessionActionCapability,
  RegistrySessionQueueAction,
  RegistrySessionQueueEnqueueItem,
  RegistrySessionQueueItem,
  RegistrySessionQueueResponse,
  RegistrySessionQueueSnapshot,
  RegistrySessionForkResponse,
  RegistrySessionGoal,
  RegistrySessionGoalClearResponse,
  RegistrySessionGoalPatch,
  RegistrySessionGoalResponse,
  RegistrySessionGoalStatus,
  RegistrySessionCredits,
  RegistrySessionIndividualLimit,
  RegistrySessionRateLimit,
  RegistrySessionResetCredits,
  RegistrySessionStatusAccount,
  RegistrySessionStatusContext,
  RegistrySessionStatusResult,
  RegistrySessionUsage,
  RegistrySessionMessage,
  RegistrySessionMessageEventPayload,
  RegistrySessionMarkColor,
  RegistrySessionReadResponse,
  RegistrySessionSearchError,
  RegistrySessionSearchResponse,
  RegistrySessionSearchResult,
  RegistrySessionSearchStatusResponse,
  RegistrySessionSummary,
  RegistrySessionTurn,
  RegistrySkillCommandResponse,
  RegistrySkillDetailPayload,
  RegistrySkillInstallPayload,
  RegistrySkillScopePayload,
  RegistryTerminalCreateResponse,
  RegistryTerminalGetResponse,
  RegistryTerminalInputEvent,
  RegistryTerminalListResponse,
  RegistryTerminalResizeRequest,
  RegistryTerminalResizeResponse,
  RegistryWheelMakerUpdateResponse,
  RegistryWorkingTreeFileDiff,
} from './registryTypes';

export type RegistryFileRequestOptions = {
  knownHash?: string;
  signal?: AbortSignal;
};

const SESSION_CREATE_TIMEOUT_MS = 120000;
const SESSION_FORK_TIMEOUT_MS = SESSION_CREATE_TIMEOUT_MS;

function normalizeAgentType(agentType: unknown): string | undefined {
  if (typeof agentType !== 'string') {
    return undefined;
  }
  const normalized = agentType.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function normalizeAgentTypes(agentTypes: unknown): string[] {
  if (!Array.isArray(agentTypes)) {
    return [];
  }
  return agentTypes
    .map(item => normalizeAgentType(item))
    .filter((item): item is string => !!item);
}

function normalizeDeviceSession(raw: unknown): RegistryDeviceSession | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const input = raw as Record<string, unknown>;
  if (
    typeof input.deviceId !== 'string' || input.deviceId.length === 0 ||
    typeof input.deviceName !== 'string' ||
    typeof input.basePath !== 'string' ||
    typeof input.lastLoginIp !== 'string' ||
    typeof input.lastLoginLocation !== 'string' ||
    typeof input.createdAt !== 'string' ||
    typeof input.lastSeenAt !== 'string' ||
    typeof input.expiresAt !== 'string'
  ) {
    return null;
  }
  return {
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    basePath: input.basePath,
    lastLoginIp: input.lastLoginIp,
    lastLoginLocation: input.lastLoginLocation,
    createdAt: input.createdAt,
    lastSeenAt: input.lastSeenAt,
    expiresAt: input.expiresAt,
    current: input.current === true,
  };
}

function normalizeNpmPackage(raw: unknown): RegistryNpmPackage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const input = raw as Record<string, unknown>;
  const packageName = typeof input.packageName === 'string' ? input.packageName : '';
  if (!packageName) {
    return null;
  }
  return {
    packageName,
    displayName: typeof input.displayName === 'string' ? input.displayName : packageName,
    agentTypes: normalizeAgentTypes(input.agentTypes),
    kind: input.kind === 'deprecated' ? 'deprecated' : 'runtime',
    installed: input.installed === true,
    installedVersion: typeof input.installedVersion === 'string' ? input.installedVersion : '',
    latestVersion: typeof input.latestVersion === 'string' ? input.latestVersion : '',
    status: typeof input.status === 'string' ? input.status as RegistryNpmPackage['status'] : 'latest_unknown',
    error: typeof input.error === 'string' ? input.error : '',
    canInstall: input.canInstall === true,
    canUpdate: input.canUpdate === true,
    canUninstall: input.canUninstall === true,
  };
}

function normalizeNpmHubSnapshot(raw: unknown, hubId: string): RegistryNpmHubSnapshot | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  const packages = Array.isArray(input.packages)
    ? input.packages.map(item => normalizeNpmPackage(item)).filter((item): item is RegistryNpmPackage => !!item)
    : [];
  return {
    hubId: typeof input.hubId === 'string' && input.hubId ? input.hubId : hubId,
    nodeVersion: typeof input.nodeVersion === 'string' ? input.nodeVersion : '',
    npmVersion: typeof input.npmVersion === 'string' ? input.npmVersion : '',
    npmPrefix: typeof input.npmPrefix === 'string' ? input.npmPrefix : '',
    warning: typeof input.warning === 'string' ? input.warning : '',
    error: typeof input.error === 'string' ? input.error : '',
    packages,
  };
}

function normalizeNpmCommandResponse(raw: unknown, hubId: string): RegistryNpmCommandResponse {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    ok: input.ok === true,
    accepted: input.accepted === true ? true : undefined,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
    hub: normalizeNpmHubSnapshot(input.hub, hubId),
    operation: (input.operation ?? null) as RegistryNpmCommandResponse['operation'],
  };
}

function hubIdFromProjectId(projectId: string): string {
  const index = projectId.indexOf(':');
  return (index > 0 ? projectId.slice(0, index) : projectId).trim();
}

function hubStateSectionData<T>(state: RegistryHubState, section: RegistryHubStateSectionName): T | undefined {
  return state.sections[section]?.data as T | undefined;
}

function releasePublishStateResponse(state: RegistryHubState): RegistryReleasePublishResponse {
  const section = state.sections.releasePublish;
  const error = section?.action?.status === 'failed'
    ? section.action.error || section.error
    : section?.status === 'error'
      ? section.error
      : '';
  if (error) {
    return {ok: false, status: 'failed', error};
  }
  return hubStateSectionData<RegistryReleasePublishResponse>(state, 'releasePublish')
    ?? {ok: false, status: 'missing_hub_state_response'};
}

function normalizeUsageHistoryLimit(raw: unknown): RegistryUsageHistoryLimit | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const windowKind = input.windowKind;
  if (
    typeof input.id !== 'string'
    || typeof input.label !== 'string'
    || (windowKind !== 'fixed' && windowKind !== 'calendarMonth')
    || !Array.isArray(input.samples)
  ) {
    return null;
  }
  const windowDurationMins = input.windowDurationMins;
  if (
    windowDurationMins !== undefined
    && (typeof windowDurationMins !== 'number'
      || !Number.isFinite(windowDurationMins)
      || windowDurationMins <= 0)
  ) {
    return null;
  }
  if (windowKind === 'fixed' && windowDurationMins === undefined) return null;
  const resetsAt = input.resetsAt;
  if (resetsAt !== undefined && (typeof resetsAt !== 'string' || !Number.isFinite(Date.parse(resetsAt)))) {
    return null;
  }
  const samples = input.samples.map(sample => {
    if (!Array.isArray(sample) || sample.length !== 2) return null;
    const [observedAtMillis, remainingPercent] = sample;
    if (
      typeof observedAtMillis !== 'number'
      || !Number.isFinite(observedAtMillis)
      || !Number.isInteger(observedAtMillis)
      || observedAtMillis < 0
      || typeof remainingPercent !== 'number'
      || !Number.isFinite(remainingPercent)
      || remainingPercent < 0
      || remainingPercent > 100
    ) {
      return null;
    }
    return {observedAtMillis, remainingPercent};
  });
  if (samples.some(sample => sample === null)) return null;
  return {
    id: input.id,
    label: input.label,
    windowKind,
    windowDurationMins,
    resetsAt,
    samples: samples.filter(sample => sample !== null),
  };
}

export class RegistryRepository {
  constructor(private readonly client: RegistryClient) {}

  private normalizeHubConfigResponse(raw: unknown, fallbackHubId: string): RegistryHubConfigResponse {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const configInput = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
      ? input.config as Record<string, unknown>
      : {};
    const flickerInput = configInput.flickerBridge && typeof configInput.flickerBridge === 'object'
      ? configInput.flickerBridge as Record<string, unknown>
      : {};
    const apiKeysInput = configInput.apiKeys && typeof configInput.apiKeys === 'object' && !Array.isArray(configInput.apiKeys)
      ? configInput.apiKeys as Record<string, unknown>
      : {};
    const apiKeys: RegistryHubConfig['apiKeys'] = {};
    for (const [name, value] of Object.entries(apiKeysInput)) {
      const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      apiKeys[name] = {
        configured: entry.configured === true,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
      };
    }
    return {
      hubId: typeof input.hubId === 'string' && input.hubId ? input.hubId : fallbackHubId,
      config: {
        flickerBridge: {
          mode: flickerInput.mode === 'v2' ? 'v2' : 'v1',
          enabled: flickerInput.enabled === true,
        },
        apiKeys,
      },
    };
  }

  private normalizeHubState(raw: unknown, fallbackHubId: string): RegistryHubState {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const sectionsInput = input.sections && typeof input.sections === 'object' && !Array.isArray(input.sections)
      ? input.sections as Record<string, unknown>
      : {};
    const sections: RegistryHubState['sections'] = {};
    for (const [name, value] of Object.entries(sectionsInput)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        sections[name] = {status: 'empty'};
        continue;
      }
      const sectionInput = value as Record<string, unknown>;
      sections[name] = {
        status: typeof sectionInput.status === 'string' ? sectionInput.status : 'empty',
        updatedAt: typeof sectionInput.updatedAt === 'string' ? sectionInput.updatedAt : undefined,
        startedAt: typeof sectionInput.startedAt === 'string' ? sectionInput.startedAt : undefined,
        error: typeof sectionInput.error === 'string' ? sectionInput.error : undefined,
        data: sectionInput.data,
        action: sectionInput.action && typeof sectionInput.action === 'object' && !Array.isArray(sectionInput.action)
          ? sectionInput.action as RegistryHubState['sections'][string]['action']
          : undefined,
      };
    }
    return {
      hubId: typeof input.hubId === 'string' && input.hubId ? input.hubId : fallbackHubId,
      status: typeof input.status === 'string' ? input.status : 'empty',
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
      sections,
    };
  }

  private normalizeSessionConfigOptionValue(raw: unknown): RegistrySessionConfigOptionValue | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const value = typeof input.value === 'string' ? input.value.trim() : '';
    if (!value) {
      return null;
    }
    return {
      value,
      name: typeof input.name === 'string' ? input.name : undefined,
      description: typeof input.description === 'string' ? input.description : undefined,
    };
  }

  private normalizeSessionConfigOption(raw: unknown): RegistrySessionConfigOption | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) {
      return null;
    }
    const options = Array.isArray(input.options)
      ? input.options
          .map(item => this.normalizeSessionConfigOptionValue(item))
          .filter((item): item is RegistrySessionConfigOptionValue => !!item)
      : undefined;
    return {
      id,
      name: typeof input.name === 'string' ? input.name : undefined,
      description: typeof input.description === 'string' ? input.description : undefined,
      category: typeof input.category === 'string' ? input.category : undefined,
      type: typeof input.type === 'string' ? input.type : undefined,
      currentValue: typeof input.currentValue === 'string' ? input.currentValue : undefined,
      options,
    };
  }

  private normalizeSessionCommand(raw: unknown): RegistrySessionCommand | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const nameRaw = typeof input.name === 'string' ? input.name.trim() : '';
    if (!nameRaw) {
      return null;
    }
    const name = nameRaw.startsWith('/') ? nameRaw : `/${nameRaw}`;
    return {
      name,
      description: typeof input.description === 'string' ? input.description : undefined,
    };
  }
  private normalizeSessionUsage(raw: unknown): RegistrySessionUsage | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    const used = typeof input.used === 'number' && Number.isFinite(input.used)
      ? Math.max(0, Math.trunc(input.used))
      : undefined;
    if (used === undefined) {
      return undefined;
    }
    const size = typeof input.size === 'number' && Number.isFinite(input.size)
      ? Math.max(0, Math.trunc(input.size))
      : undefined;
    return {
      used,
      size,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
    };
  }
  private normalizeSessionActionCapability(raw: unknown): RegistrySessionActionCapability {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      supported: input.supported === true,
      reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : undefined,
    };
  }
  private normalizeSessionActions(raw: unknown): RegistrySessionActionCapabilities | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    return {
      status: this.normalizeSessionActionCapability(input.status),
      compact: this.normalizeSessionActionCapability(input.compact),
      steer: this.normalizeSessionActionCapability(input.steer),
      fork: this.normalizeSessionActionCapability(input.fork),
      goal: this.normalizeSessionActionCapability(input.goal),
    };
  }
  private normalizeSessionGoalStatus(raw: unknown): RegistrySessionGoalStatus | null {
    switch (raw) {
      case 'active':
      case 'paused':
      case 'blocked':
      case 'usageLimited':
      case 'budgetLimited':
      case 'complete':
        return raw;
      default:
        return null;
    }
  }
  private normalizeSessionGoal(raw: unknown): RegistrySessionGoal | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    const objective = typeof input.objective === 'string' ? input.objective : '';
    const status = this.normalizeSessionGoalStatus(input.status);
    if (!sessionId || !objective || !status) {
      return undefined;
    }
    const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : 0;
    const tokenBudget = input.tokenBudget === null
      ? null
      : typeof input.tokenBudget === 'number' && Number.isFinite(input.tokenBudget) && input.tokenBudget > 0
        ? Math.trunc(input.tokenBudget)
        : null;
    return {
      sessionId,
      objective,
      status,
      tokenBudget,
      tokensUsed: count(input.tokensUsed),
      timeUsedSeconds: count(input.timeUsedSeconds),
      createdAt: count(input.createdAt),
      updatedAt: count(input.updatedAt),
    };
  }
  private normalizeSessionGoalResponse(
    raw: unknown,
    fallbackSessionId: string,
  ): RegistrySessionGoalResponse {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      ok: input.ok === true,
      sessionId: typeof input.sessionId === 'string' ? input.sessionId : fallbackSessionId,
      goal: this.normalizeSessionGoal(input.goal) ?? null,
    };
  }
  private normalizeSessionStatusContext(raw: unknown): RegistrySessionStatusContext | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    if (typeof input.used !== 'number' || !Number.isFinite(input.used)) {
      return undefined;
    }
    return {
      used: Math.max(0, Math.trunc(input.used)),
      size: typeof input.size === 'number' && Number.isFinite(input.size)
        ? Math.max(0, Math.trunc(input.size))
        : undefined,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
    };
  }
  private normalizeSessionRateLimit(raw: unknown): RegistrySessionRateLimit | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) {
      return null;
    }
    const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
      ? Math.min(100, Math.max(0, Math.trunc(value)))
      : 0;
    return {
      id,
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : id,
      usedPercent: percent(input.usedPercent),
      remainingPercent: percent(input.remainingPercent),
      windowDurationMins: typeof input.windowDurationMins === 'number' && Number.isFinite(input.windowDurationMins)
        ? Math.max(0, Math.trunc(input.windowDurationMins))
        : undefined,
      resetsAt: typeof input.resetsAt === 'string' ? input.resetsAt : undefined,
    };
  }
  private normalizeSessionCredits(raw: unknown): RegistrySessionCredits | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    return {
      hasCredits: input.hasCredits === true,
      unlimited: input.unlimited === true,
      balance: typeof input.balance === 'string' ? input.balance : undefined,
    };
  }
  private normalizeSessionIndividualLimit(raw: unknown): RegistrySessionIndividualLimit | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    const limit = typeof input.limit === 'string' ? input.limit : '';
    const used = typeof input.used === 'string' ? input.used : '';
    if (!limit && !used) {
      return undefined;
    }
    return {
      limit,
      used,
      remainingPercent: typeof input.remainingPercent === 'number' && Number.isFinite(input.remainingPercent)
        ? Math.min(100, Math.max(0, Math.trunc(input.remainingPercent)))
        : 0,
      resetsAt: typeof input.resetsAt === 'string' ? input.resetsAt : undefined,
    };
  }
  private normalizeSessionResetCredits(raw: unknown): RegistrySessionResetCredits | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    if (typeof input.availableCount !== 'number' || !Number.isFinite(input.availableCount)) {
      return undefined;
    }
    return {availableCount: Math.max(0, Math.trunc(input.availableCount))};
  }
  private normalizeSessionStatusAccount(raw: unknown): RegistrySessionStatusAccount | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    return {
      planType: typeof input.planType === 'string' ? input.planType : undefined,
      credits: this.normalizeSessionCredits(input.credits),
      individualLimit: this.normalizeSessionIndividualLimit(input.individualLimit),
      rateLimitReachedType: typeof input.rateLimitReachedType === 'string' ? input.rateLimitReachedType : undefined,
      rateLimitResetCredits: this.normalizeSessionResetCredits(input.rateLimitResetCredits),
    };
  }
  private normalizeSessionMarkColor(raw: unknown): RegistrySessionMarkColor | undefined {
    switch (raw) {
      case 'red':
      case 'yellow':
      case 'green':
      case 'blue':
        return raw;
      default:
        return undefined;
    }
  }

  private normalizeSessionQueueItem(raw: unknown): RegistrySessionQueueItem | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const itemId = typeof input.itemId === 'string' ? input.itemId.trim() : '';
    const createdAt = typeof input.createdAt === 'string' ? input.createdAt.trim() : '';
    const kind = input.kind === 'prompt' || input.kind === 'compact' ? input.kind : undefined;
    const status = ['queued', 'running', 'cancelling', 'steering', 'failed'].includes(String(input.status))
      ? input.status as RegistrySessionQueueItem['status']
      : undefined;
    if (!itemId || !createdAt || !kind || !status) {
      return null;
    }
    const common = {
      itemId,
      createdAt,
      status,
      cancelSupported: input.cancelSupported === true,
      error: typeof input.error === 'string' && input.error.trim() ? input.error : undefined,
    };
    if (kind === 'compact') {
      if (Array.isArray(input.blocks) && input.blocks.length > 0) {
        return null;
      }
      return {...common, kind};
    }
    if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
      return null;
    }
    const blocks: RegistrySessionContentBlock[] = [];
    for (const block of input.blocks) {
      if (!block || typeof block !== 'object') continue;
      const value = block as Record<string, unknown>;
      if (value.type !== 'text' && value.type !== 'image' && value.type !== 'resource_link') continue;
      blocks.push({
        type: value.type,
        text: typeof value.text === 'string' ? value.text : undefined,
        mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined,
        data: typeof value.data === 'string' ? value.data : undefined,
        uri: typeof value.uri === 'string' ? value.uri : undefined,
        name: typeof value.name === 'string' ? value.name : undefined,
        size: typeof value.size === 'number' && Number.isFinite(value.size)
          ? Math.max(0, Math.trunc(value.size))
          : undefined,
      });
    }
    if (blocks.length !== input.blocks.length) {
      return null;
    }
    return {...common, kind, blocks};
  }

  private normalizeSessionQueue(raw: unknown): RegistrySessionQueueSnapshot | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    const generation = typeof input.generation === 'string' ? input.generation.trim() : '';
    if (!generation) {
      return undefined;
    }
    const activeItem = input.activeItem === undefined
      ? undefined
      : this.normalizeSessionQueueItem(input.activeItem) ?? undefined;
    const waitingItems = input.waitingItems === undefined
      ? undefined
      : Array.isArray(input.waitingItems)
        ? input.waitingItems
            .map(item => this.normalizeSessionQueueItem(item))
            .filter((item): item is RegistrySessionQueueItem => !!item)
        : undefined;
    return {
      generation,
      revision: typeof input.revision === 'number' && Number.isFinite(input.revision)
        ? Math.max(0, Math.trunc(input.revision))
        : 0,
      paused: input.paused === true,
      activeKind: input.activeKind === 'prompt' || input.activeKind === 'compact'
        ? input.activeKind
        : undefined,
      waitingCount: typeof input.waitingCount === 'number' && Number.isFinite(input.waitingCount)
        ? Math.max(0, Math.trunc(input.waitingCount))
        : 0,
      ...(activeItem ? {activeItem} : {}),
      ...(waitingItems ? {waitingItems} : {}),
    };
  }

  private normalizeSessionSummary(raw: unknown): RegistrySessionSummary | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    if (!sessionId) {
      return null;
    }
    return {
      sessionId,
      title: typeof input.title === 'string' ? input.title : '',
      preview: typeof input.preview === 'string' ? input.preview : '',
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
      messageCount: typeof input.messageCount === 'number' && Number.isFinite(input.messageCount) ? input.messageCount : 0,
      unreadCount: typeof input.unreadCount === 'number' && Number.isFinite(input.unreadCount) ? input.unreadCount : undefined,
      agentType: normalizeAgentType(input.agentType),
      createRequestId: typeof input.createRequestId === 'string' && input.createRequestId.trim()
        ? input.createRequestId.trim()
        : undefined,
      latestTurnIndex: typeof input.latestTurnIndex === 'number' && Number.isFinite(input.latestTurnIndex)
        ? Math.max(0, Math.trunc(input.latestTurnIndex))
        : undefined,
      running: input.running === true,
      pendingPermissionCount: typeof input.pendingPermissionCount === 'number' && Number.isFinite(input.pendingPermissionCount)
        ? Math.max(0, Math.trunc(input.pendingPermissionCount))
        : undefined,
      lastDoneTurnIndex: typeof input.lastDoneTurnIndex === 'number' && Number.isFinite(input.lastDoneTurnIndex)
        ? Math.max(0, Math.trunc(input.lastDoneTurnIndex))
        : undefined,
      lastDoneSuccess: typeof input.lastDoneSuccess === 'boolean' ? input.lastDoneSuccess : undefined,
      lastReadTurnIndex: typeof input.lastReadTurnIndex === 'number' && Number.isFinite(input.lastReadTurnIndex)
        ? Math.max(0, Math.trunc(input.lastReadTurnIndex))
        : undefined,
      pinned: input.pinned === true,
      markColor: this.normalizeSessionMarkColor(input.markColor),
      configOptions: Array.isArray(input.configOptions)
        ? input.configOptions
            .map(item => this.normalizeSessionConfigOption(item))
            .filter((item): item is RegistrySessionConfigOption => !!item)
        : undefined,
      commands: Array.isArray(input.commands)
        ? input.commands
            .map(item => this.normalizeSessionCommand(item))
            .filter((item): item is RegistrySessionCommand => !!item)
        : undefined,
      usage: this.normalizeSessionUsage(input.usage),
      sessionActions: this.normalizeSessionActions(input.sessionActions),
      goal: this.normalizeSessionGoal(input.goal),
      forkedFrom: this.normalizeSessionForkOrigin(input.forkedFrom),
      queue: this.normalizeSessionQueue(input.queue),
    };
  }

  private normalizeSessionQueueResponse(raw: unknown, sessionId: string): RegistrySessionQueueResponse {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const session = this.normalizeSessionSummary(input.session) ?? {
      sessionId,
      title: '',
      preview: '',
      updatedAt: '',
      messageCount: 0,
    };
    return {
      ok: input.ok === true,
      sessionId,
      session,
    };
  }

  private normalizeSessionForkOrigin(raw: unknown): RegistrySessionSummary['forkedFrom'] {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const input = raw as Record<string, unknown>;
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    const turnIndex = typeof input.turnIndex === 'number' && Number.isFinite(input.turnIndex)
      ? Math.max(0, Math.trunc(input.turnIndex))
      : 0;
    if (!sessionId || turnIndex <= 0) {
      return undefined;
    }
    return {
      sessionId,
      turnIndex,
      title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
    };
  }

  private normalizeArchivedSessionSummary(raw: unknown): RegistryArchivedSessionSummary | null {
    const base = this.normalizeSessionSummary(raw);
    if (!base || !raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const archivedAt = typeof input.archivedAt === 'string' ? input.archivedAt : '';
    if (!archivedAt) {
      return null;
    }
    const {
      pinned: _activeSessionPin,
      markColor: _activeSessionMark,
      ...archivedBase
    } = base;
    return {
      ...archivedBase,
      projectName: typeof input.projectName === 'string' ? input.projectName : undefined,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : undefined,
      archivedAt,
      restoredAt: typeof input.restoredAt === 'string' ? input.restoredAt : undefined,
      turnCount: typeof input.turnCount === 'number' && Number.isFinite(input.turnCount)
        ? Math.max(0, Math.trunc(input.turnCount))
        : 0,
      gapCount: typeof input.gapCount === 'number' && Number.isFinite(input.gapCount)
        ? Math.max(0, Math.trunc(input.gapCount))
        : 0,
      nativeArchivedAt: typeof input.nativeArchivedAt === 'string' ? input.nativeArchivedAt : undefined,
      nativeUnarchivedAt: typeof input.nativeUnarchivedAt === 'string' ? input.nativeUnarchivedAt : undefined,
      nativeSyncWarning: typeof input.nativeSyncWarning === 'string' ? input.nativeSyncWarning : undefined,
    };
  }

  private normalizeSessionSearchResult(raw: unknown, fallbackProjectId: string): RegistrySessionSearchResult | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    if (!sessionId) {
      return null;
    }
    const source = input.source === 'title' || input.source === 'prompt' ? input.source : '';
    if (!source) {
      return null;
    }
    const projectId = typeof input.projectId === 'string'
      ? input.projectId.trim()
      : fallbackProjectId;
    if (!projectId) {
      return null;
    }
    if (source === 'title') {
      return {projectId, sessionId, source};
    }
    const turnIndex = typeof input.turnIndex === 'number' && Number.isFinite(input.turnIndex)
      ? Math.max(0, Math.trunc(input.turnIndex))
      : 0;
    if (turnIndex <= 0) {
      return null;
    }
    return {projectId, sessionId, source, turnIndex};
  }

  private normalizeSessionSearchError(raw: unknown, fallbackProjectId: string): RegistrySessionSearchError | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const projectId = typeof input.projectId === 'string'
      ? input.projectId.trim()
      : fallbackProjectId;
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!projectId || !message) {
      return null;
    }
    const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim()
      ? input.sessionId.trim()
      : undefined;
    return {
      projectId,
      ...(sessionId ? {sessionId} : {}),
      message,
    };
  }

  private normalizeSessionSearchResponse(raw: unknown, fallbackProjectId: string, fallbackSearchId: string): RegistrySessionSearchResponse {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const searchId = typeof input.searchId === 'string' && input.searchId.trim()
      ? input.searchId.trim()
      : fallbackSearchId;
    const results = Array.isArray(input.results)
      ? input.results
          .map(item => this.normalizeSessionSearchResult(item, fallbackProjectId))
          .filter((item): item is RegistrySessionSearchResult => !!item)
      : [];
    const errors = Array.isArray(input.errors)
      ? input.errors
          .map(item => this.normalizeSessionSearchError(item, fallbackProjectId))
          .filter((item): item is RegistrySessionSearchError => !!item)
      : [];
    return {
      searchId,
      done: input.done === true,
      results,
      errors,
    };
  }

  private normalizeSessionSearchStatusResponse(raw: unknown, fallbackSearchId: string): RegistrySessionSearchStatusResponse {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      searchId: typeof input.searchId === 'string' && input.searchId.trim()
        ? input.searchId.trim()
        : fallbackSearchId,
      done: input.done === true,
    };
  }

  private async listSessionsByMethod(projectId: string, method: typeof RegistryMethods.SessionList): Promise<RegistrySessionSummary[]> {
    const resp = await this.client.request({
      method,
      projectId,
      payload: {},
      timeoutMs: 15000,
    });
    const payload = (resp.payload ?? {}) as {sessions?: unknown[]};
    return (payload.sessions ?? [])
      .map(item => this.normalizeSessionSummary(item))
      .filter((item): item is RegistrySessionSummary => !!item);
  }

  private async readSessionByMethod(
    projectId: string,
    sessionId: string,
    afterTurnIndex: number,
    method: typeof RegistryMethods.SessionRead,
  ): Promise<RegistrySessionReadResponse> {
    const resp = await this.client.request({
      method,
      projectId,
      payload: afterTurnIndex > 0 ? {sessionId, afterTurnIndex} : {sessionId},
      timeoutMs: 15000,
    });
    const payload = (resp.payload ?? {}) as {
      sessionId?: unknown;
      session?: unknown;
      latestTurnIndex?: unknown;
      turns?: unknown[];
    };
    const latestTurnIndex = typeof payload.latestTurnIndex === 'number' && Number.isFinite(payload.latestTurnIndex)
      ? Math.max(0, Math.trunc(payload.latestTurnIndex))
      : 0;
    const normalized = normalizeSessionReadPayload(
      payload,
      sessionId,
      raw => this.normalizeSessionSummary(raw),
    );
    if (!normalized) {
      return {
        sessionId: '',
        turns: [],
        messages: [],
        latestTurnIndex,
      };
    }
    if (normalized.session) {
      normalized.session.latestTurnIndex = normalized.latestTurnIndex;
    }
    const normalizedTurns: RegistrySessionTurn[] = normalized.turns;
    const normalizedMessages: RegistrySessionMessage[] = normalizedTurns
      .map(turn => decodeSessionTurnToMessage(normalized.sessionId, turn))
      .filter((item): item is RegistrySessionMessage => !!item);

    return {
      sessionId: normalized.sessionId,
      turns: normalizedTurns,
      ...(normalized.session ? {session: normalized.session} : {}),
      messages: normalizedMessages,
      latestTurnIndex: normalized.latestTurnIndex,
    };
  }
  async initialize(url: string, clientName: RegistryClientName): Promise<void> {
    await this.client.connect(url);
    await this.client.connectInit({
      clientName,
      clientVersion: '0.1.0',
      protocolVersion: RegistryProtocolVersion,
      role: 'client',
    });
  }

  async listProjectSnapshot(): Promise<RegistryProjectListResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.RegistryProjectList,
      payload: {},
    });
    const payload = (resp.payload ?? {}) as { projects?: RegistryProject[]; hubs?: RegistryHub[] };
    const projects = (payload.projects ?? [])
      .filter(project => !!project.projectId)
      .map(project => ({
        ...project,
        agent: normalizeAgentType(project.agent),
        agents: Array.isArray(project.agents)
          ? project.agents
              .filter((item): item is string => typeof item === 'string')
              .map(item => normalizeAgentType(item))
              .filter((item): item is string => !!item)
          : undefined,
        agentProfiles: Array.isArray(project.agentProfiles)
          ? project.agentProfiles
              .map((item): RegistryProjectAgentProfile | null => {
                const name = normalizeAgentType(item?.name) ?? '';
                if (!name) {
                  return null;
                }
                const skills = Array.isArray(item.skills)
                  ? item.skills
                      .filter((skill): skill is string => typeof skill === 'string')
                      .map(skill => skill.trim())
                      .filter(skill => skill.length > 0)
                  : [];
                const skillNamesByKey = new Map(skills.map(skill => [skill.toLowerCase(), skill]));
                const skillDescriptions = item.skillDescriptions && typeof item.skillDescriptions === 'object'
                  ? Object.fromEntries(Object.entries(item.skillDescriptions).flatMap(([skillName, description]) => {
                      const normalizedName = skillNamesByKey.get(skillName.trim().toLowerCase());
                      const normalizedDescription = typeof description === 'string' ? description.trim() : '';
                      return normalizedName && normalizedDescription
                        ? [[normalizedName, normalizedDescription]]
                        : [];
                    }))
                  : {};
                return {
                  name,
                  skills,
                  ...(Object.keys(skillDescriptions).length > 0 ? {skillDescriptions} : {}),
                };
              })
              .filter((item): item is RegistryProjectAgentProfile => !!item)
          : undefined,
        hubId: project.hubId || project.projectId.split(':', 1)[0] || '',
      }));
    const seenHubIds = new Set<string>();
    const hubs = (payload.hubs ?? [])
      .map((hub): RegistryHub => ({
        hubId: typeof hub?.hubId === 'string' ? hub.hubId.trim() : '',
      }))
      .filter(hub => {
        if (!hub.hubId || seenHubIds.has(hub.hubId)) {
          return false;
        }
        seenHubIds.add(hub.hubId);
        return true;
      });
    return {projects, hubs};
  }

  async listProjects(): Promise<RegistryProject[]> {
    return (await this.listProjectSnapshot()).projects;
  }

  async listDeviceSessions(): Promise<RegistryDeviceSession[]> {
    const resp = await this.client.request({
      method: RegistryMethods.SecuritySessionList,
      payload: {},
    });
    const payload = (resp.payload ?? {}) as {sessions?: unknown[]};
    return (Array.isArray(payload.sessions) ? payload.sessions : [])
      .map(normalizeDeviceSession)
      .filter((session): session is RegistryDeviceSession => session !== null);
  }

  async revokeDeviceSession(deviceId: string): Promise<void> {
    await this.client.request({
      method: RegistryMethods.SecuritySessionRevoke,
      payload: {deviceId},
    });
  }

  async revokeAllDeviceSessions(): Promise<void> {
    await this.client.request({
      method: RegistryMethods.SecuritySessionRevokeAll,
      payload: {},
    });
  }

  async getServerSettings(): Promise<ServerSettings> {
    const response = await this.client.request({
      method: RegistryMethods.ServerConfigGet,
      payload: {},
    });
    return normalizeServerSettings(response.payload);
  }

  async updateServerSettings(payload: ServerSettingsUpdate): Promise<ServerSettings> {
    const response = await this.client.request({
      method: RegistryMethods.ServerConfigUpdate,
      payload,
    });
    return normalizeServerSettings(response.payload);
  }

  async getAndroidSpeechCredential(): Promise<{accessToken: string; version: string; model: SpeechModelId}> {
    const response = await this.client.request({
      method: RegistryMethods.ServerAndroidSpeechCredentialGet,
      payload: {},
    });
    const input = response.payload && typeof response.payload === 'object'
      ? response.payload as Record<string, unknown>
      : {};
    if (
      typeof input.accessToken !== 'string' || input.accessToken.length === 0 ||
      typeof input.version !== 'string' ||
      input.model !== 'doubao-streaming-asr-2.0'
    ) {
      throw new Error('invalid Android speech credential response');
    }
    return {accessToken: input.accessToken, version: input.version, model: input.model};
  }

  async uploadDebugLog(payload: RegistryDebugUploadLogPayload): Promise<RegistryDebugUploadLogResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.DebugUploadLog,
      payload,
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistryDebugUploadLogResponse>;
    return {
      ok: body.ok === true,
      fileName: body.fileName ?? '',
    };
  }

	async synthesizeTTS(payload: RegistryTTSSynthesizePayload): Promise<RegistryTTSSynthesizeResponse> {
		const resp = await this.client.request({
			method: RegistryMethods.TTSSynthesize,
			payload,
			timeoutMs: 50000,
		});
		const body = (resp.payload ?? {}) as Partial<RegistryTTSSynthesizeResponse>;
		if (typeof body.audioBase64 !== 'string' || !body.audioBase64) {
			throw new Error('TTS response contains no audio data');
		}
		return {audioBase64: body.audioBase64, format: typeof body.format === 'string' ? body.format : 'wav'};
	}

  async getPortRelayStatus(): Promise<RegistryPortRelaySnapshot> {
    const resp = await this.client.request({
      method: RegistryMethods.RegistryRelayStatus,
      payload: {},
    });
    return (resp.payload ?? {ok: true, enabled: false, status: 'Disabled'}) as RegistryPortRelaySnapshot;
  }

  async enablePortRelay(payload: RegistryPortRelayEnablePayload): Promise<RegistryPortRelaySnapshot> {
    const resp = await this.client.request({
      method: RegistryMethods.RegistryRelayEnable,
      payload,
      timeoutMs: 15000,
    });
    return (resp.payload ?? {}) as RegistryPortRelaySnapshot;
  }

  async disablePortRelay(): Promise<RegistryPortRelaySnapshot> {
    const resp = await this.client.request({
      method: RegistryMethods.RegistryRelayDisable,
      payload: {},
    });
    return (resp.payload ?? {ok: true, enabled: false, status: 'Disabled'}) as RegistryPortRelaySnapshot;
  }

  async regeneratePortRelayAccessCode(accessCode: string): Promise<RegistryPortRelaySnapshot> {
    const resp = await this.client.request({
      method: RegistryMethods.RegistryRelayRegenerateAccessCode,
      payload: {accessCode},
    });
    return (resp.payload ?? {}) as RegistryPortRelaySnapshot;
  }

  async gitRev(projectId: string): Promise<RegistryGitRev> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitRev,
      projectId,
      payload: {},
      timeoutMs: 8000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistryGitRev>;
    return {
      gitRev: body.gitRev ?? '',
      worktreeRev: body.worktreeRev ?? '',
    };
  }

  async listFiles(projectId: string, path = '.', knownHash?: string): Promise<RegistryFsListResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectFSList,
      projectId,
      payload: knownHash ? {path, knownHash} : {path},
      timeoutMs: 20000,
    });
    const payload = (resp.payload ?? {}) as RegistryFsListResponse;
    const basePath = payload.path ?? path;
    const joinPath = (parent: string, name: string): string => {
      const cleanParent = (parent || '.').replace(/\\/g, '/');
      if (cleanParent === '.' || cleanParent === '') return name;
      return `${cleanParent.replace(/\/+$/, '')}/${name}`;
    };
    const entries = (payload.entries ?? [])
      .filter(entry => !!entry?.name)
      .map(entry => ({
        ...entry,
        path: entry.path && entry.path.trim().length > 0 ? entry.path : joinPath(basePath, entry.name),
      }));
    return {
      path: payload.path ?? path,
      hash: payload.hash,
      notModified: payload.notModified ?? false,
      entries,
    };
  }

  async getFileInfo(
    projectId: string,
    path: string,
    options?: Pick<RegistryFileRequestOptions, 'signal'>,
  ): Promise<RegistryFsInfo> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectFSInfo,
      projectId,
      payload: {path},
      signal: options?.signal,
    });
    return this.normalizeFileInfoResponse((resp.payload ?? {}) as RegistryFsInfo);
  }

  async getExternalFileInfo(
    projectId: string,
    path: string,
    options?: Pick<RegistryFileRequestOptions, 'signal'>,
  ): Promise<RegistryFsInfo> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectFSExternalInfo,
      projectId,
      payload: {path},
      signal: options?.signal,
    });
    return this.normalizeFileInfoResponse((resp.payload ?? {}) as RegistryFsInfo);
  }

  private normalizeFileInfoResponse(payload: RegistryFsInfo): RegistryFsInfo {
    const tabSize = typeof payload.tabSize === 'number' && Number.isFinite(payload.tabSize)
      ? Math.max(1, Math.min(12, Math.trunc(payload.tabSize)))
      : undefined;
    return {
      path: typeof payload.path === 'string' ? payload.path : '',
      kind: payload.kind ?? 'file',
      size: payload.size ?? 0,
      isBinary: payload.isBinary ?? false,
      mimeType: payload.mimeType ?? '',
      totalLines: payload.totalLines ?? 0,
      tabSize,
      entryCount: payload.entryCount ?? 0,
      hash: payload.hash ?? '',
    };
  }

  async readFile(
    projectId: string,
    path: string,
    options?: RegistryFileRequestOptions,
  ): Promise<RegistryFsReadResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectFSRead,
      projectId,
      payload: {
        path,
        ...(options?.knownHash ? {knownHash: options.knownHash} : {}),
      },
      signal: options?.signal,
    });
    return this.normalizeFileReadResponse(
      (resp.payload ?? {}) as RegistryFsReadResponse,
      path,
    );
  }

  async readExternalFile(
    projectId: string,
    path: string,
    options?: Pick<RegistryFileRequestOptions, 'signal'>,
  ): Promise<RegistryFsReadResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectFSExternalRead,
      projectId,
      payload: {path},
      signal: options?.signal,
    });
    return this.normalizeFileReadResponse(
      (resp.payload ?? {}) as RegistryFsReadResponse,
      path,
    );
  }

  private normalizeFileReadResponse(
    payload: RegistryFsReadResponse,
    requestedPath: string,
  ): RegistryFsReadResponse {
    return {
      path: payload.path ?? requestedPath,
      hash: payload.hash,
      notModified: payload.notModified ?? false,
      isBinary: payload.isBinary ?? false,
      mimeType: payload.mimeType ?? '',
      encoding: payload.encoding ?? 'utf-8',
      content: payload.content ?? '',
      size: payload.size ?? 0,
      total: payload.total ?? 0,
      returned: payload.returned ?? 0,
    };
  }

  async getFileIndexStatus(hubId: string): Promise<RegistryFileIndexStatusResponse> {
    const state = await this.refreshHubState(hubId, ['fileIndex']);
    const payload = hubStateSectionData<RegistryFileIndexStatusResponse>(state, 'fileIndex') ?? {
      hubId,
      projects: [],
    };
    return {
      hubId: payload.hubId ?? hubId,
      projects: Array.isArray(payload.projects) ? payload.projects : [],
    };
  }

  async rebuildFileIndex(projectId: string): Promise<RegistryFileIndexRebuildResponse> {
    const hubId = hubIdFromProjectId(projectId);
    const state = await this.runHubStateAction(hubId, 'fileIndex', 'rebuild', {projectId});
    return hubStateSectionData<RegistryFileIndexRebuildResponse>(state, 'fileIndex') ?? {
      ok: false,
      accepted: false,
      running: false,
      projectId,
      status: 'error',
    };
  }

  async searchFileIndex(
    projectId: string,
    payload: {query: string; querySessionId?: string; queryId?: number; limit?: number},
  ): Promise<RegistryFileIndexSearchResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectFSIndexSearch,
      projectId,
      payload,
      timeoutMs: 20000,
    });
    const body = (resp.payload ?? {}) as RegistryFileIndexSearchResponse;
    return {
      query: body.query ?? payload.query,
      querySessionId: body.querySessionId ?? payload.querySessionId,
      queryId: body.queryId ?? payload.queryId,
      status: body.status ?? 'missing',
      indexed: body.indexed === true,
      fileCount: typeof body.fileCount === 'number' ? body.fileCount : 0,
      results: Array.isArray(body.results) ? body.results : [],
      error: body.error,
    };
  }

  async gitLog(
    projectId: string,
    ref = 'HEAD',
    cursor = '',
    limit = 50,
    refs: string[] = [],
  ): Promise<RegistryGitCommit[]> {
    const normalizedRefs = refs
      .map(item => item.trim())
      .filter(item => item.length > 0);
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitLog,
      projectId,
      payload: normalizedRefs.length > 0
        ? {ref, refs: normalizedRefs, cursor, limit}
        : {ref, cursor, limit},
      timeoutMs: 30000,
    });
    const payload = (resp.payload ?? {}) as { commits?: RegistryGitCommit[] };
    return (payload.commits ?? []).filter(commit => !!commit.sha);
  }

  async gitBranches(projectId: string): Promise<{current: string; branches: string[]; remoteBranches: string[]}> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitRefs,
      projectId,
      payload: {},
      timeoutMs: 20000,
    });
    const payload = (resp.payload ?? {}) as {current?: string; branches?: string[]; remoteBranches?: string[]};
    return {
      current: payload.current ?? '',
      branches: payload.branches ?? [],
      remoteBranches: payload.remoteBranches ?? [],
    };
  }

  async gitCommitFiles(projectId: string, sha: string): Promise<RegistryGitCommitFile[]> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitCommitFiles,
      projectId,
      payload: { sha },
      timeoutMs: 20000,
    });
    const payload = (resp.payload ?? {}) as { files?: RegistryGitCommitFile[] };
    return (payload.files ?? []).filter(file => !!file.path);
  }

  async gitCommitFileDiff(
    projectId: string,
    sha: string,
    path: string,
    contextLines = 3,
  ): Promise<RegistryGitFileDiff> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitCommitFileDiff,
      projectId,
      payload: { sha, path, contextLines },
      timeoutMs: 30000,
    });
    const payload = (resp.payload ?? {}) as RegistryGitFileDiff;
    return {
      sha: payload.sha ?? sha,
      path: payload.path ?? path,
      isBinary: payload.isBinary ?? false,
      diff: payload.diff ?? '',
      truncated: payload.truncated ?? false,
    };
  }

  async gitStatus(projectId: string): Promise<RegistryGitStatus> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitStatus,
      projectId,
      payload: {},
      timeoutMs: 20000,
    });
    const payload = (resp.payload ?? {}) as Partial<RegistryGitStatus>;
    return {
      dirty: payload.dirty ?? false,
      worktreeRev: payload.worktreeRev ?? '',
      staged: payload.staged ?? [],
      unstaged: payload.unstaged ?? [],
      untracked: payload.untracked ?? [],
    };
  }

  async gitWorkingTreeFileDiff(
    projectId: string,
    path: string,
    scope: 'staged' | 'unstaged' | 'untracked' = 'unstaged',
    contextLines = 3,
  ): Promise<RegistryWorkingTreeFileDiff> {
    const resp = await this.client.request({
      method: RegistryMethods.ProjectGitWorkingTreeFileDiff,
      projectId,
      payload: {path, scope, contextLines},
      timeoutMs: 30000,
    });
    const payload = (resp.payload ?? {}) as Partial<RegistryWorkingTreeFileDiff>;
    return {
      path: payload.path ?? path,
      scope: payload.scope ?? scope,
      isBinary: payload.isBinary ?? false,
      diff: payload.diff ?? '',
      truncated: payload.truncated ?? false,
    };
  }

  async listSessions(projectId: string): Promise<RegistrySessionSummary[]> {
    return this.listSessionsByMethod(projectId, RegistryMethods.SessionList);
  }

  async readSession(projectId: string, sessionId: string, afterTurnIndex = 0): Promise<RegistrySessionReadResponse> {
    return this.readSessionByMethod(projectId, sessionId, afterTurnIndex, RegistryMethods.SessionRead);
  }

  async readSessionArtifact(
    projectId: string,
    sessionId: string,
    artifactId: string,
  ): Promise<RegistrySessionArtifactReadResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionArtifactRead,
      projectId,
      payload: {sessionId, artifactId},
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionArtifactReadResponse>;
    return {
      artifactId: body.artifactId ?? artifactId,
      type: body.type ?? 'diff',
      format: body.format ?? 'unified-diff',
      content: body.content ?? '',
    };
  }

  async startSessionSearch(projectId: string, searchId: string, query: string): Promise<RegistrySessionSearchStatusResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionSearch,
      projectId,
      payload: {action: 'start', searchId, query},
      timeoutMs: 15000,
    });
    return this.normalizeSessionSearchStatusResponse(resp.payload, searchId);
  }

  async querySessionSearch(projectId: string, searchId: string): Promise<RegistrySessionSearchResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionSearch,
      projectId,
      payload: {action: 'query', searchId},
      timeoutMs: 15000,
    });
    return this.normalizeSessionSearchResponse(resp.payload, projectId, searchId);
  }

  async cancelSessionSearch(projectId: string, searchId: string): Promise<RegistrySessionSearchStatusResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionSearch,
      projectId,
      payload: {action: 'cancel', searchId},
      timeoutMs: 15000,
    });
    return this.normalizeSessionSearchStatusResponse(resp.payload, searchId);
  }

  async markSessionRead(
    projectId: string,
    sessionId: string,
    lastReadTurnIndex: number,
  ): Promise<{ok: boolean; session?: RegistrySessionSummary}> {
    const cursor = Number.isFinite(lastReadTurnIndex)
      ? Math.max(0, Math.trunc(lastReadTurnIndex))
      : 0;
    const resp = await this.client.request({
      method: RegistryMethods.SessionMarkRead,
      projectId,
      payload: {
        sessionId,
        lastReadTurnIndex: cursor,
      },
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; session?: unknown};
    return {
      ok: body.ok ?? false,
      session: this.normalizeSessionSummary(body.session) ?? undefined,
    };
  }

  async createSession(
    projectId: string,
    agentType: string,
    title?: string,
    createRequestId?: string,
  ): Promise<{ok: boolean; session: RegistrySessionSummary}> {
    agentType = normalizeAgentType(agentType) ?? agentType.trim();
    const normalizedTitle = title?.trim() || '';
    const normalizedCreateRequestId = createRequestId?.trim() || '';
    const resp = await this.client.request({
      method: RegistryMethods.SessionCreate,
      projectId,
      payload: {
        agentType,
        ...(normalizedTitle ? {title: normalizedTitle} : {}),
        ...(normalizedCreateRequestId ? {createRequestId: normalizedCreateRequestId} : {}),
      },
      timeoutMs: SESSION_CREATE_TIMEOUT_MS,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; session?: RegistrySessionSummary};
    return {
      ok: body.ok ?? false,
      session: body.session ?? {
        sessionId: '',
        title: normalizedTitle,
        preview: '',
        updatedAt: '',
        messageCount: 0,
        agentType,
      },
    };
  }

  async mutateSessionQueue(
    projectId: string,
    payload:
      | {sessionId: string; action: 'enqueue'; item: RegistrySessionQueueEnqueueItem}
      | {sessionId: string; action: Exclude<RegistrySessionQueueAction, 'enqueue'>; itemId: string},
  ): Promise<RegistrySessionQueueResponse> {
    const response = await this.client.request({
      method: RegistryMethods.SessionQueue,
      projectId,
      payload,
      timeoutMs: 30000,
    });
    return this.normalizeSessionQueueResponse(response.payload, payload.sessionId);
  }

  async statusSession(projectId: string, sessionId: string): Promise<RegistrySessionStatusResult> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionStatus,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    const body = resp.payload && typeof resp.payload === 'object'
      ? resp.payload as Record<string, unknown>
      : {};
    return {
      ok: body.ok === true,
      sessionId,
      context: this.normalizeSessionStatusContext(body.context),
      limits: Array.isArray(body.limits)
        ? body.limits
            .map(item => this.normalizeSessionRateLimit(item))
            .filter((item): item is RegistrySessionRateLimit => !!item)
        : [],
      account: this.normalizeSessionStatusAccount(body.account),
      updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : '',
    };
  }

  async createSessionGoal(
    projectId: string,
    sessionId: string,
    objective: string,
    tokenBudget: number | null = null,
  ): Promise<RegistrySessionGoalResponse> {
    const response = await this.client.request({
      method: RegistryMethods.SessionGoalCreate,
      projectId,
      payload: {sessionId, objective, tokenBudget},
      timeoutMs: 30000,
    });
    return this.normalizeSessionGoalResponse(response.payload, sessionId);
  }

  async getSessionGoal(projectId: string, sessionId: string): Promise<RegistrySessionGoalResponse> {
    const response = await this.client.request({
      method: RegistryMethods.SessionGoalGet,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    return this.normalizeSessionGoalResponse(response.payload, sessionId);
  }

  async updateSessionGoal(
    projectId: string,
    sessionId: string,
    patch: RegistrySessionGoalPatch,
  ): Promise<RegistrySessionGoalResponse> {
    const response = await this.client.request({
      method: RegistryMethods.SessionGoalUpdate,
      projectId,
      payload: {sessionId, ...patch},
      timeoutMs: 30000,
    });
    return this.normalizeSessionGoalResponse(response.payload, sessionId);
  }

  async stopSessionGoal(projectId: string, sessionId: string): Promise<RegistrySessionGoalResponse> {
    const response = await this.client.request({
      method: RegistryMethods.SessionGoalStop,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    return this.normalizeSessionGoalResponse(response.payload, sessionId);
  }

  async clearSessionGoal(projectId: string, sessionId: string): Promise<RegistrySessionGoalClearResponse> {
    const response = await this.client.request({
      method: RegistryMethods.SessionGoalClear,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    const body = response.payload && typeof response.payload === 'object'
      ? response.payload as Record<string, unknown>
      : {};
    return {
      ok: body.ok === true,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : sessionId,
      cleared: body.cleared === true,
    };
  }

  async forkSession(projectId: string, sessionId: string, turnIndex: number): Promise<RegistrySessionForkResponse> {
    const normalizedTurnIndex = Number.isFinite(turnIndex) ? Math.max(0, Math.trunc(turnIndex)) : 0;
    const resp = await this.client.request({
      method: RegistryMethods.SessionFork,
      projectId,
      payload: {sessionId, turnIndex: normalizedTurnIndex},
      timeoutMs: SESSION_FORK_TIMEOUT_MS,
    });
    const body = resp.payload && typeof resp.payload === 'object'
      ? resp.payload as Record<string, unknown>
      : {};
    const session = this.normalizeSessionSummary(body.session);
    return {
      ok: body.ok === true,
      session: session ?? {
        sessionId: '',
        title: '',
        preview: '',
        updatedAt: '',
        messageCount: 0,
      },
    };
  }

  async startSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentStartPayload,
  ): Promise<RegistrySessionAttachmentStartResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionAttachmentStart,
      projectId,
      payload,
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionAttachmentStartResponse>;
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      uploadId: body.uploadId ?? '',
      chunkSize: body.chunkSize ?? 1024 * 1024,
      expiresIn: body.expiresIn,
    };
  }

  async uploadSessionAttachmentChunk(
    projectId: string,
    payload: RegistrySessionAttachmentChunkPayload,
  ): Promise<RegistrySessionAttachmentChunkResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionAttachmentChunk,
      projectId,
      payload,
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionAttachmentChunkResponse>;
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      uploadId: body.uploadId ?? payload.uploadId,
      received: body.received ?? payload.offset,
    };
  }

  async finishSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentFinishPayload,
  ): Promise<RegistrySessionAttachmentFinishResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionAttachmentFinish,
      projectId,
      payload,
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionAttachmentFinishResponse>;
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      attachment: body.attachment ?? {id: '', name: '', size: 0, uri: ''},
      block: body.block ?? {type: 'resource_link', uri: '', name: '', size: 0},
    };
  }

  async cancelSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentCancelPayload,
  ): Promise<RegistrySessionAttachmentCancelResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionAttachmentCancel,
      projectId,
      payload,
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionAttachmentCancelResponse>;
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      uploadId: body.uploadId ?? payload.uploadId,
    };
  }

  async deleteSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentDeletePayload,
  ): Promise<RegistrySessionAttachmentDeleteResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionAttachmentDelete,
      projectId,
      payload,
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionAttachmentDeleteResponse>;
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      attachmentId: body.attachmentId ?? payload.attachmentId,
    };
  }

  async readSessionAttachmentThumbnail(
    projectId: string,
    payload: RegistrySessionAttachmentReadPayload,
  ): Promise<RegistrySessionAttachmentContentResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionAttachmentThumbnail,
      projectId,
      payload,
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionAttachmentContentResponse>;
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      attachmentId: body.attachmentId ?? payload.attachmentId ?? '',
      mimeType: body.mimeType,
      encoding: body.encoding ?? 'base64',
      content: body.content ?? '',
      isBinary: body.isBinary,
      width: body.width,
      height: body.height,
      size: body.size,
      hash: body.hash,
    };
  }

  async readSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentReadPayload,
  ): Promise<RegistrySessionAttachmentContentResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionAttachmentRead,
      projectId,
      payload,
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistrySessionAttachmentContentResponse>;
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      attachmentId: body.attachmentId ?? payload.attachmentId ?? '',
      mimeType: body.mimeType,
      encoding: body.encoding ?? 'base64',
      content: body.content ?? '',
      isBinary: body.isBinary,
      width: body.width,
      height: body.height,
      size: body.size,
      hash: body.hash,
    };
  }

  async archiveSession(projectId: string, sessionId: string): Promise<{ok: boolean; sessionId: string; warning?: string}> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionArchive,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string; warning?: string};
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? sessionId,
      warning: typeof body.warning === 'string' ? body.warning : undefined,
    };
  }

  async listArchivedSessions(projectId: string): Promise<RegistryArchivedSessionSummary[]> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionArchiveList,
      projectId,
      payload: {},
      timeoutMs: 15000,
    });
    const payload = (resp.payload ?? {}) as {sessions?: unknown[]};
    return (payload.sessions ?? [])
      .map(item => this.normalizeArchivedSessionSummary(item))
      .filter((item): item is RegistryArchivedSessionSummary => !!item);
  }

  async readArchivedSession(projectId: string, sessionId: string): Promise<RegistrySessionArchiveReadResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionArchiveRead,
      projectId,
      payload: {sessionId},
      timeoutMs: 15000,
    });
    const payload = (resp.payload ?? {}) as {
      sessionId?: unknown;
      session?: unknown;
      latestTurnIndex?: unknown;
      turns?: unknown[];
      readOnly?: unknown;
    };
    const normalized = normalizeSessionReadPayload(
      payload,
      sessionId,
      raw => this.normalizeArchivedSessionSummary(raw),
    );
    const session = this.normalizeArchivedSessionSummary(payload.session) ?? {
      sessionId,
      title: '',
      preview: '',
      updatedAt: '',
      messageCount: 0,
      running: false,
      archivedAt: '',
      turnCount: 0,
      gapCount: 0,
    };
    const turns = normalized?.turns ?? [];
    return {
      sessionId: normalized?.sessionId ?? sessionId,
      session,
      turns,
      messages: turns
        .map(turn => decodeSessionTurnToMessage(normalized?.sessionId ?? sessionId, turn))
        .filter((item): item is RegistrySessionMessage => !!item),
      latestTurnIndex: normalized?.latestTurnIndex ?? 0,
      readOnly: true,
    };
  }

  async restoreArchivedSession(projectId: string, sessionId: string): Promise<RegistrySessionArchiveRestoreResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionArchiveRestore,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string; session?: unknown; warning?: string};
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? sessionId,
      session: this.normalizeSessionSummary(body.session) ?? {
        sessionId,
        title: '',
        preview: '',
        updatedAt: '',
        messageCount: 0,
      },
      warning: typeof body.warning === 'string' ? body.warning : undefined,
    };
  }

  async deleteSession(projectId: string, sessionId: string): Promise<{ok: boolean; sessionId: string}> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionDelete,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string};
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? sessionId,
    };
  }

  async renameSession(projectId: string, sessionId: string, title: string): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionRename,
      projectId,
      payload: {sessionId, title},
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string; session?: unknown};
    const session = this.normalizeSessionSummary(body.session) ?? {
      sessionId,
      title,
      preview: '',
      updatedAt: '',
      messageCount: 0,
    };
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? session.sessionId ?? sessionId,
      session,
    };
  }

  async pinSession(
    projectId: string,
    sessionId: string,
    pinned: boolean,
  ): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionPin,
      projectId,
      payload: {sessionId, pinned},
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string; session?: unknown};
    const session = this.normalizeSessionSummary(body.session) ?? {
      sessionId,
      title: '',
      preview: '',
      updatedAt: '',
      messageCount: 0,
      pinned,
    };
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? session.sessionId ?? sessionId,
      session,
    };
  }

  async markSession(
    projectId: string,
    sessionId: string,
    markColor: RegistrySessionMarkColor | '',
  ): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionMark,
      projectId,
      payload: {sessionId, markColor},
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string; session?: unknown};
    const session = this.normalizeSessionSummary(body.session) ?? {
      sessionId,
      title: '',
      preview: '',
      updatedAt: '',
      messageCount: 0,
      markColor: markColor || undefined,
    };
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? session.sessionId ?? sessionId,
      session,
    };
  }

  async setSessionConfig(
    projectId: string,
    payload: {sessionId: string; configId: string; value: string},
  ): Promise<{ok: boolean; sessionId: string; configOptions: RegistrySessionConfigOption[]}> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionConfig,
      projectId,
      payload,
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as {
      ok?: boolean;
      sessionId?: string;
      configOptions?: unknown[];
    };
    const configOptions = (Array.isArray(body.configOptions) ? body.configOptions : [])
      .map(item => this.normalizeSessionConfigOption(item))
      .filter((item): item is RegistrySessionConfigOption => !!item);
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? payload.sessionId,
      configOptions,
    };
  }

  async listResumableSessions(projectId: string, agentType: string): Promise<RegistryResumableSession[]> {
    agentType = normalizeAgentType(agentType) ?? agentType.trim();
    const resp = await this.client.request({
      method: RegistryMethods.SessionResumeList,
      projectId,
      payload: {agentType},
      timeoutMs: 15000,
    });
    const payload = (resp.payload ?? {}) as {sessions?: RegistryResumableSession[]};
    return payload.sessions ?? [];
  }

  async importResumedSession(projectId: string, agentType: string, sessionId: string): Promise<{ok: boolean; session: RegistrySessionSummary}> {
    agentType = normalizeAgentType(agentType) ?? agentType.trim();
    const resp = await this.client.request({
      method: RegistryMethods.SessionResumeImport,
      projectId,
      payload: {agentType, sessionId},
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; session?: RegistrySessionSummary};
    return {
      ok: body.ok ?? false,
      session: body.session ?? {
        sessionId,
        title: '',
        preview: '',
        updatedAt: '',
        messageCount: 0,
        agentType,
      },
    };
  }

  async reloadSession(projectId: string, sessionId: string): Promise<{ok: boolean; sessionId: string}> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionReload,
      projectId,
      payload: {sessionId},
      timeoutMs: 30000,
    });
    const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string};
    return {
      ok: body.ok ?? false,
      sessionId: body.sessionId ?? sessionId,
    };
  }

  async getHubState(hubId: string, sections?: RegistryHubStateSectionName[]): Promise<RegistryHubState> {
    const resp = await this.client.request({
      method: RegistryMethods.HubStateGet,
      hubId,
      payload: sections && sections.length > 0 ? {sections} : {},
      timeoutMs: 15000,
    });
    const payload = (resp.payload ?? {}) as {state?: unknown};
    return this.normalizeHubState(payload.state, hubId);
  }

  async getUsageHistory(
    hubId: string,
    providerId: string,
    accountLocalId: string,
  ): Promise<RegistryUsageHistoryResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.UsageHistoryGet,
      hubId,
      payload: {providerId, accountLocalId},
      timeoutMs: 15000,
    });
    const payload = resp.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('invalid usage history response');
    }
    const input = payload as Record<string, unknown>;
    if (
      input.hubId !== hubId
      || input.providerId !== providerId
      || input.accountLocalId !== accountLocalId
      || !Array.isArray(input.limits)
    ) {
      throw new Error('invalid usage history response');
    }
    const limits = input.limits.map(normalizeUsageHistoryLimit);
    if (limits.some(limit => limit === null)) {
      throw new Error('invalid usage history response');
    }
    return {
      hubId,
      providerId,
      accountLocalId,
      limits: limits.filter(limit => limit !== null),
    };
  }

  async refreshHubState(
    hubId: string,
    sections: RegistryHubStateSectionName[],
    options: {force?: boolean} = {},
  ): Promise<RegistryHubState> {
    const resp = await this.client.request({
      method: RegistryMethods.HubStateRefresh,
      hubId,
      payload: options.force === true ? {sections, force: true} : {sections},
      timeoutMs: 60000,
    });
    const payload = (resp.payload ?? {}) as {state?: unknown};
    return this.normalizeHubState(payload.state, hubId);
  }

  async runHubStateAction(
    hubId: string,
    section: RegistryHubStateSectionName,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<RegistryHubState> {
    const resp = await this.client.request({
      method: RegistryMethods.HubStateAction,
      hubId,
      payload: {section, action, params},
      timeoutMs: 60000,
    });
    const payload = (resp.payload ?? {}) as {state?: unknown};
    return this.normalizeHubState(payload.state, hubId);
  }

  async getHubConfig(hubId: string): Promise<RegistryHubConfigResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.HubConfigGet,
      hubId,
      payload: {},
      timeoutMs: 15000,
    });
    return this.normalizeHubConfigResponse(resp.payload, hubId);
  }

  async updateHubConfig(
    hubId: string,
    update: RegistryHubConfigUpdatePayload,
  ): Promise<RegistryHubConfigResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.HubConfigUpdate,
      hubId,
      payload: update,
      timeoutMs: 15000,
    });
    return this.normalizeHubConfigResponse(resp.payload, hubId);
  }

  async listTerminals(hubId: string): Promise<RegistryTerminalListResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.TerminalList,
      hubId,
      payload: {},
    });
    const payload = (resp.payload ?? {}) as Partial<RegistryTerminalListResponse>;
    return {terminals: Array.isArray(payload.terminals) ? payload.terminals : []};
  }

  async createTerminal(projectId: string, cols: number, rows: number): Promise<RegistryTerminalCreateResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.TerminalCreate,
      projectId,
      payload: {cols, rows},
    });
    return (resp.payload ?? {}) as RegistryTerminalCreateResponse;
  }

  async getTerminal(hubId: string, terminalId: string): Promise<RegistryTerminalGetResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.TerminalGet,
      hubId,
      payload: {terminalId},
    });
    return (resp.payload ?? {}) as RegistryTerminalGetResponse;
  }

  async resizeTerminal(hubId: string, payload: RegistryTerminalResizeRequest): Promise<RegistryTerminalResizeResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.TerminalResize,
      hubId,
      payload,
    });
    return (resp.payload ?? {}) as RegistryTerminalResizeResponse;
  }

  async closeTerminal(hubId: string, terminalId: string): Promise<void> {
    await this.client.request({
      method: RegistryMethods.TerminalClose,
      hubId,
      payload: {terminalId},
    });
  }

  async restartTerminal(hubId: string, terminalId: string): Promise<RegistryTerminalCreateResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.TerminalRestart,
      hubId,
      payload: {terminalId},
    });
    return (resp.payload ?? {}) as RegistryTerminalCreateResponse;
  }

  sendTerminalInput(hubId: string, payload: RegistryTerminalInputEvent): void {
    this.client.sendEvent({
      method: RegistryMethods.TerminalInput,
      hubId,
      payload,
    });
  }

  async scanNpmPackages(hubId: string): Promise<RegistryNpmCommandResponse> {
    const state = await this.refreshHubState(hubId, ['agentPackages']);
    return normalizeNpmCommandResponse(hubStateSectionData(state, 'agentPackages'), hubId);
  }

  async installNpmPackage(hubId: string, packageName: string, version = 'latest'): Promise<RegistryNpmCommandResponse> {
    const state = await this.runHubStateAction(hubId, 'agentPackages', 'install', {
      packageName,
      version,
    });
    return normalizeNpmCommandResponse(hubStateSectionData(state, 'agentPackages'), hubId);
  }

  async installNpmPackages(hubId: string, packageNames: string[], version = 'latest'): Promise<RegistryNpmCommandResponse> {
    const state = await this.runHubStateAction(hubId, 'agentPackages', 'installMany', {
      packageNames,
      version,
    });
    return normalizeNpmCommandResponse(hubStateSectionData(state, 'agentPackages'), hubId);
  }

  async uninstallNpmPackage(hubId: string, packageName: string): Promise<RegistryNpmCommandResponse> {
    const state = await this.runHubStateAction(hubId, 'agentPackages', 'uninstall', {packageName});
    return normalizeNpmCommandResponse(hubStateSectionData(state, 'agentPackages'), hubId);
  }

  async reinstallNpmPackage(hubId: string, packageName: string): Promise<RegistryNpmCommandResponse> {
    const state = await this.runHubStateAction(hubId, 'agentPackages', 'reinstall', {packageName});
    return normalizeNpmCommandResponse(hubStateSectionData(state, 'agentPackages'), hubId);
  }

  async queryWheelMakerUpdate(hubId: string): Promise<RegistryWheelMakerUpdateResponse> {
    const state = await this.refreshHubState(hubId, ['wheelmakerUpdate']);
    return hubStateSectionData<RegistryWheelMakerUpdateResponse>(state, 'wheelmakerUpdate') ?? {
      ok: false,
      status: 'checking_failed',
      hubId,
      canRequestUpdate: false,
      errorCode: 'missing_hub_state_response',
    };
  }

  async requestWheelMakerUpdate(hubId: string): Promise<RegistryWheelMakerUpdateResponse> {
    const state = await this.runHubStateAction(hubId, 'wheelmakerUpdate', 'requestUpdate');
    return hubStateSectionData<RegistryWheelMakerUpdateResponse>(state, 'wheelmakerUpdate') ?? {
      ok: false,
      status: 'checking_failed',
      hubId,
      canRequestUpdate: false,
      errorCode: 'missing_hub_state_response',
    };
  }

  async startReleasePublish(hubId: string, input: Record<string, unknown>): Promise<RegistryReleasePublishResponse> {
    const state = await this.runHubStateAction(hubId, 'releasePublish', 'start', input);
    return releasePublishStateResponse(state);
  }

  async respondSessionPermission(
    projectId: string,
    sessionId: string,
    permissionId: string,
    optionId: string,
  ): Promise<RegistryPermissionRespondResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SessionPermissionRespond,
      projectId,
      payload: {sessionId, permissionId, optionId},
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as Partial<RegistryPermissionRespondResponse>;
    return {
      accepted: body.accepted === true,
      permissionId: typeof body.permissionId === 'string' ? body.permissionId : permissionId,
      outcome: typeof body.outcome === 'string' ? body.outcome : '',
      optionId: typeof body.optionId === 'string' ? body.optionId : optionId,
    };
  }

  async queryReleasePublish(hubId: string, jobId: string): Promise<RegistryReleasePublishResponse> {
    const state = await this.runHubStateAction(hubId, 'releasePublish', 'status', {jobId});
    return releasePublishStateResponse(state);
  }

  async scanSkills(hubId: string): Promise<RegistrySkillCommandResponse> {
    const state = await this.refreshHubState(hubId, ['skills']);
    return hubStateSectionData<RegistrySkillCommandResponse>(state, 'skills') ?? {
      ok: false,
      hubId,
      errorSummary: 'missing hub state response',
    };
  }

  async reindexSkills(hubId: string): Promise<RegistrySkillCommandResponse> {
    const state = await this.runHubStateAction(hubId, 'skills', 'reindex');
    return hubStateSectionData<RegistrySkillCommandResponse>(state, 'skills') ?? {
      ok: false,
      hubId,
      errorSummary: 'missing hub state response',
    };
  }

  async listSkillsSource(hubId: string, source: string): Promise<RegistrySkillCommandResponse> {
    const state = await this.runHubStateAction(hubId, 'skills', 'listSource', {source});
    return hubStateSectionData<RegistrySkillCommandResponse>(state, 'skills') ?? {
      ok: false,
      hubId,
      source,
      errorSummary: 'missing hub state response',
    };
  }

  async installSkills(payload: RegistrySkillInstallPayload): Promise<RegistrySkillCommandResponse> {
    const {hubId, ...params} = payload;
    const state = await this.runHubStateAction(hubId, 'skills', 'install', params);
    return hubStateSectionData<RegistrySkillCommandResponse>(state, 'skills') ?? {
      ok: false,
      hubId,
      errorSummary: 'missing hub state response',
    };
  }

  async uninstallSkills(payload: RegistrySkillScopePayload): Promise<RegistrySkillCommandResponse> {
    const {hubId, ...params} = payload;
    const state = await this.runHubStateAction(hubId, 'skills', 'uninstall', params);
    return hubStateSectionData<RegistrySkillCommandResponse>(state, 'skills') ?? {
      ok: false,
      hubId,
      errorSummary: 'missing hub state response',
    };
  }

  async getSkillDetail(payload: RegistrySkillDetailPayload): Promise<RegistrySkillCommandResponse> {
    const {hubId, ...params} = payload;
    const state = await this.runHubStateAction(hubId, 'skills', 'detail', params);
    return hubStateSectionData<RegistrySkillCommandResponse>(state, 'skills') ?? {
      ok: false,
      hubId,
      errorSummary: 'missing hub state response',
    };
  }

  async updateSkills(payload: RegistrySkillScopePayload): Promise<RegistrySkillCommandResponse> {
    const {hubId, ...params} = payload;
    const state = await this.runHubStateAction(hubId, 'skills', 'update', params);
    return hubStateSectionData<RegistrySkillCommandResponse>(state, 'skills') ?? {
      ok: false,
      hubId,
      errorSummary: 'missing hub state response',
    };
  }

  async startSpeech(payload: RegistrySpeechStartPayload): Promise<RegistrySpeechStartResponse> {
    const resp = await this.client.request({
      method: RegistryMethods.SpeechStart,
      payload,
      timeoutMs: 15000,
    });
    return (resp.payload ?? {}) as RegistrySpeechStartResponse;
  }

  async sendSpeechChunk(payload: RegistrySpeechChunkPayload): Promise<void> {
    await this.client.request({
      method: RegistryMethods.SpeechChunk,
      payload,
      timeoutMs: 8000,
    });
  }

  async finishSpeech(payload: RegistrySpeechFinishPayload): Promise<void> {
    await this.client.request({
      method: RegistryMethods.SpeechFinish,
      payload,
      timeoutMs: 15000,
    });
  }

  async cancelSpeech(payload: RegistrySpeechCancelPayload): Promise<void> {
    await this.client.request({
      method: RegistryMethods.SpeechCancel,
      payload,
      timeoutMs: 8000,
    });
  }

  close(): void {
    this.client.close();
  }

  onEvent(
    listener: (
      event:
        | RegistryEnvelope<RegistrySessionMessageEventPayload>
        | RegistryEnvelope<Record<string, never>>,
    ) => void,
  ): () => void {
    return this.client.onEvent(listener as (event: RegistryEnvelope) => void);
  }

  onClose(listener: () => void): () => void {
    return this.client.onClose(listener);
  }
}

export const createRegistryRepository = (
  debugSink?: RegistryDebugSink,
  debugConnection: RegistryDebugConnection = 'Remote',
): RegistryRepository => {
  return new RegistryRepository(new RegistryClient(8000, debugSink, debugConnection));
};

export type RegistryResponse<TPayload> = RegistryEnvelope<TPayload>;







