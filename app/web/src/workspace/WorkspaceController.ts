import type {RegistryHub, RegistryProject} from '../registry/registryTypes';
import type {RegistryWorkspaceService} from '../registry/RegistryWorkspaceService';
import type {HydratedProjectState, WorkspaceStore} from './WorkspaceStore';

export type ProjectLoadResult = {
  projects: RegistryProject[];
  hubs: RegistryHub[];
  hydrated: HydratedProjectState;
};

export class WorkspaceController {
  constructor(
    private readonly service: RegistryWorkspaceService,
    private readonly store: WorkspaceStore,
  ) {}

  async connect(wsUrl: string): Promise<ProjectLoadResult> {
    const baseSession = await this.service.connect(wsUrl);
    const targetProjectId = this.store.selectProjectOnConnect(
      baseSession.projects,
      baseSession.selectedProjectId,
    );
    const session = targetProjectId !== baseSession.selectedProjectId
      ? await this.service.selectProjectLightweight(targetProjectId)
      : baseSession;
    return {
      projects: session.projects,
      hubs: session.hubs,
      hydrated: this.store.hydrateProject(session.selectedProjectId),
    };
  }

  async switchProjectLightweight(projectId: string): Promise<ProjectLoadResult> {
    const session = await this.service.selectProjectLightweight(projectId);
    return {
      projects: session.projects,
      hubs: session.hubs,
      hydrated: this.store.hydrateCachedProject(session.selectedProjectId),
    };
  }
}
