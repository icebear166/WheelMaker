import type {
  RegistryFileIndexStatusResponse,
  RegistryFlickerBridgeStatus,
  RegistryHubState,
  RegistryNpmCommandResponse,
  RegistrySkillOperation,
  RegistryWheelMakerUpdateResponse,
} from '../registry/registryTypes';
import type {HubStoreSnapshot} from './hubStore';

export interface RegistrySkillInventoryItem {
  name: string;
  description?: string;
  managed?: boolean;
  agents?: string[];
  locations?: Record<string, {path?: string; resolvedPath?: string; fingerprint?: string}>;
  sync?: {status?: 'aligned' | 'agentsOnly' | 'claudeOnly' | 'contentMismatch' | 'unknown'};
}

export interface RegistrySkillsStateSnapshot {
  hubInventory?: Record<string, RegistrySkillInventoryItem>;
  projectLocalInventories?: Record<string, Record<string, RegistrySkillInventoryItem>>;
  effectiveSkills?: Record<string, Record<string, RegistrySkillInventoryItem[]>>;
  operation?: RegistrySkillOperation | null;
}

function sectionData<T>(state: RegistryHubState | undefined, name: string): T | undefined {
  return state?.sections[name]?.data as T | undefined;
}

export const selectWheelmakerUpdate = (state: RegistryHubState | undefined) =>
  sectionData<RegistryWheelMakerUpdateResponse>(state, 'wheelmakerUpdate');

export const selectAgentPackages = (state: RegistryHubState | undefined) =>
  sectionData<RegistryNpmCommandResponse>(state, 'agentPackages');

export const selectSkills = <T = unknown>(state: RegistryHubState | undefined) =>
  sectionData<T>(state, 'skills');

export const selectFileIndex = (state: RegistryHubState | undefined) =>
  sectionData<RegistryFileIndexStatusResponse>(state, 'fileIndex');

export const selectFlickerBridge = (state: RegistryHubState | undefined) =>
  sectionData<RegistryFlickerBridgeStatus>(state, 'flickerBridge');

export const selectTokenStats = <T = unknown>(state: RegistryHubState | undefined) =>
  sectionData<T>(state, 'tokenStats');

export function selectComposerSkills(
  snapshot: HubStoreSnapshot,
  projectId: string,
  agent: string,
): Array<{name: string; description: string}> {
  const state = hubForProject(snapshot, projectId);
  const skills = selectSkills<RegistrySkillsStateSnapshot>(state);
  const byAgent = skills?.effectiveSkills?.[projectId] ?? {};
  const key = Object.keys(byAgent).find(name => name.toLowerCase() === agent.trim().toLowerCase());
  return (key ? byAgent[key] : [])
    .map(item => ({name: item.name.trim(), description: item.description?.trim() ?? ''}))
    .filter(item => item.name)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: 'base'}));
}

export function selectComposerDiagnostic(snapshot: HubStoreSnapshot, projectId: string): string {
  const state = hubForProject(snapshot, projectId);
  const inventory = selectSkills<RegistrySkillsStateSnapshot>(state)
    ?.projectLocalInventories?.[projectId] ?? {};
  const statuses = Object.values(inventory).map(item => item.sync?.status);
  if (statuses.includes('contentMismatch')) return 'Some .agents and .claude skill content differs.';
  if (statuses.includes('agentsOnly') || statuses.includes('claudeOnly')) {
    return 'Some skills are available in only one agent directory.';
  }
  return '';
}

function hubForProject(snapshot: HubStoreSnapshot, projectId: string): RegistryHubState | undefined {
  const separator = projectId.indexOf(':');
  const hubId = separator >= 0 ? projectId.slice(0, separator) : projectId;
  return snapshot.hubs[hubId];
}
