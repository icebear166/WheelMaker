import type {RegistryNpmPackage} from '../registry/registryTypes';

export const MY_FLICKER_PACKAGE_NAME = '@myflicker/cli';

export function hasMyFlickerPackage(
  packages: readonly Pick<RegistryNpmPackage, 'packageName'>[] | undefined,
): boolean {
  return packages?.some(pkg => pkg.packageName === MY_FLICKER_PACKAGE_NAME) === true;
}

export function filterMyFlickerAgentTypes(agentTypes: readonly string[], available: boolean): string[] {
  if (available) {
    return [...agentTypes];
  }
  return agentTypes.filter(agentType => {
    const normalized = agentType.trim().toLowerCase();
    return normalized !== 'flicker' && normalized !== 'cc-flicker';
  });
}
