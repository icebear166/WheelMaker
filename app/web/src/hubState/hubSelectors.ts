import type {
  RegistryFileIndexStatusResponse,
  RegistryFlickerBridgeStatus,
  RegistryHubState,
  RegistryNpmCommandResponse,
  RegistryWheelMakerUpdateResponse,
} from '../registry/registryTypes';

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
