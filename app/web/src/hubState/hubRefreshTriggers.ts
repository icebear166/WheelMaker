import type {
  RegistryHubStateRefreshResponse,
  RegistryHubStateSectionName,
} from '../registry/registryTypes';

type RefreshHubState = (
  hubId: string,
  sections: RegistryHubStateSectionName[],
  force: boolean,
) => Promise<RegistryHubStateRefreshResponse>;

export class HubRefreshTriggers {
  private menuOpen = false;
  private readonly expanded = new Set<string>();

  constructor(private readonly refresh: RefreshHubState) {}

  async setMenuOpen(open: boolean, hubIds: string[]): Promise<void> {
    const opening = open && !this.menuOpen;
    this.menuOpen = open;
    if (!opening) return;
    await Promise.all(hubIds.map(hubId =>
      this.refresh(hubId, ['wheelmakerUpdate'], false),
    ));
  }

  async setHubExpanded(hubId: string, expanded: boolean): Promise<void> {
    const opening = expanded && !this.expanded.has(hubId);
    if (expanded) this.expanded.add(hubId);
    else this.expanded.delete(hubId);
    if (!opening) return;
    await this.refresh(
      hubId,
      ['flickerBridge', 'agentPackages', 'skills', 'fileIndex'],
      false,
    );
  }
}
