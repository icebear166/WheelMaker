import type {
  RegistryEnvelope,
  RegistryFlickerBridgeStatus,
  RegistryHubState,
} from '../registry/registryTypes';

export type FlickerBridgeStatusByHub = Record<string, RegistryFlickerBridgeStatus>;

export function normalizeFlickerBridgeStatus(value: unknown): RegistryFlickerBridgeStatus {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const port = typeof data.port === 'number' && Number.isFinite(data.port) ? data.port : 17999;
  const mode = data.mode === 'v2' ? 'v2' : 'v1';
  const runningMode = data.runningMode === 'v1' || data.runningMode === 'v2'
    ? data.runningMode
    : undefined;
  const availableModes: Array<'v1' | 'v2'> = Array.isArray(data.availableModes)
    ? data.availableModes.filter((candidate): candidate is 'v1' | 'v2' => candidate === 'v1' || candidate === 'v2')
    : ['v1'];
  const rawModeErrors = data.modeErrors && typeof data.modeErrors === 'object'
    ? data.modeErrors as Record<string, unknown>
    : {};
  return {
    configured: data.configured === true,
    supported: data.supported !== false,
    state: typeof data.state === 'string' ? data.state : 'notConfigured',
    mode,
    runningMode,
    availableModes,
    modeErrors: {
      ...(typeof rawModeErrors.v1 === 'string' ? {v1: rawModeErrors.v1} : {}),
      ...(typeof rawModeErrors.v2 === 'string' ? {v2: rawModeErrors.v2} : {}),
    },
    endpoint: typeof data.endpoint === 'string' ? data.endpoint : `http://127.0.0.1:${port}`,
    port,
    pid: typeof data.pid === 'number' ? data.pid : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export function flickerBridgeActions(status: RegistryFlickerBridgeStatus | undefined): {
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
} {
  const configured = status?.configured === true && status.supported !== false;
  const hasLiveProcess = typeof status?.pid === 'number' && status.pid > 0;
  return {
    canStart: configured && (status?.state === 'stopped' || (status?.state === 'failed' && !hasLiveProcess)),
    canStop: configured && (hasLiveProcess || status?.state === 'running' || status?.state === 'starting'),
    canRestart: configured && (status?.state === 'running' || (status?.state === 'failed' && hasLiveProcess)),
  };
}

export function applyFlickerBridgeHubStateEvent(
  current: FlickerBridgeStatusByHub,
  event: RegistryEnvelope,
): FlickerBridgeStatusByHub {
  if (event.method !== 'hub.state.updated' || !event.payload || typeof event.payload !== 'object') {
    return current;
  }
  const payload = event.payload as {sections?: unknown; state?: RegistryHubState};
  if (!Array.isArray(payload.sections) || !payload.sections.includes('flickerBridge')) {
    return current;
  }
  const hubId = event.hubId || payload.state?.hubId;
  const section = payload.state?.sections?.flickerBridge;
  if (!hubId || !section || section.data === undefined) {
    return current;
  }
  return {
    ...current,
    [hubId]: normalizeFlickerBridgeStatus(section.data),
  };
}
