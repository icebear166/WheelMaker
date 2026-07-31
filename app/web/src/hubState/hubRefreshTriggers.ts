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
  private readonly refreshedMenuHubs = new Set<string>();
  private readonly expanded = new Set<string>();

  constructor(private readonly refresh: RefreshHubState) {}

  async setMenuOpen(open: boolean, hubIds: string[], expandedHubIds: string[] = []): Promise<void> {
    if (!open) {
      this.menuOpen = false;
      this.refreshedMenuHubs.clear();
      this.expanded.clear();
      return;
    }
    if (!this.menuOpen) {
      this.menuOpen = true;
      this.refreshedMenuHubs.clear();
      this.expanded.clear();
    }
    const requests: Promise<RegistryHubStateRefreshResponse>[] = [];
    for (const hubId of new Set(hubIds)) {
      if (this.refreshedMenuHubs.has(hubId)) continue;
      this.refreshedMenuHubs.add(hubId);
      requests.push(this.refresh(hubId, ['wheelmakerUpdate'], false));
    }
    for (const hubId of new Set(expandedHubIds)) {
      if (this.expanded.has(hubId)) continue;
      this.expanded.add(hubId);
      requests.push(this.refresh(
        hubId,
        ['flickerBridge', 'agentPackages', 'skills', 'fileIndex'],
        false,
      ));
    }
    await Promise.allSettled(requests);
  }

  async setHubExpanded(hubId: string, expanded: boolean): Promise<void> {
    const opening = expanded && !this.expanded.has(hubId);
    if (expanded) this.expanded.add(hubId);
    else this.expanded.delete(hubId);
    if (!opening) return;
    try {
      await this.refresh(
        hubId,
        ['flickerBridge', 'agentPackages', 'skills', 'fileIndex'],
        false,
      );
    } catch {
      // The next user edge or connection generation can retry the refresh.
    }
  }
}
