import {
  createRegistryRepository,
  type RegistryFileRequestOptions,
  type RegistryRepository,
} from './RegistryRepository';
import {RegistryRequestError} from './RegistryClient';
import type {RegistryDebugSink} from './RegistryClient';
import {RegistryMethods} from './registryMethods';
import type {RegistryDebugConnection} from '../debug/registryDebug';
import type {ServerSettings, ServerSettingsUpdate, SpeechModelId} from '../settings/serverSettings';
import type {
  RegistryEnvelope,
  RegistryClientName,
  RegistryDebugUploadLogPayload,
  RegistryDebugUploadLogResponse,
  RegistryDeviceSession,
  RegistryFileIndexRebuildResponse,
  RegistryFileIndexSearchResponse,
  RegistryFileIndexStatusResponse,
  RegistryFsInfo,
  RegistryFsEntry,
  RegistryGitCommit,
  RegistryGitCommitFile,
  RegistryGitFileDiff,
  RegistryGitRev,
  RegistryGitStatus,
  RegistryHub,
  RegistryHubState,
  RegistryHubStateSectionName,
	RegistryReleasePublishResponse,
  RegistryNpmCommandResponse,
  RegistryPortRelayEnablePayload,
  RegistryPortRelaySnapshot,
  RegistryPermissionRespondResponse,
  RegistryProject,
  RegistryProjectListResponse,
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
  RegistrySessionMessage,
  RegistryArchivedSessionSummary,
  RegistrySessionArchiveReadResponse,
  RegistrySessionArchiveRestoreResponse,
  RegistrySessionReadResponse,
  RegistrySessionSearchResponse,
  RegistrySessionSearchStatusResponse,
  RegistryResumableSession,
  RegistrySessionSummary,
  RegistrySessionCompactAccepted,
  RegistrySessionStatusResult,
  RegistrySkillCommandResponse,
  RegistrySkillDetailPayload,
  RegistrySkillInstallPayload,
  RegistrySkillScopePayload,
  RegistrySpeechCancelPayload,
  RegistrySpeechChunkPayload,
  RegistrySpeechFinishPayload,
  RegistrySpeechStartPayload,
  RegistrySpeechStartResponse,
	RegistryTTSSynthesizePayload,
	RegistryTTSSynthesizeResponse,
  RegistryTerminalCreateResponse,
  RegistryTerminalGetResponse,
  RegistryTerminalInputEvent,
  RegistryTerminalListResponse,
  RegistryTerminalResizeRequest,
  RegistryTerminalResizeResponse,
  RegistryWheelMakerUpdateResponse,
  RegistryWorkingTreeFileDiff,
} from './registryTypes';

export type WorkspaceSession = {
  projects: RegistryProject[];
  hubs: RegistryHub[];
  selectedProjectId: string;
  fileEntries: RegistryFsEntry[];
};

export type RegistryWorkspaceServiceOptions = {
  createRepository?: (debugSink?: RegistryDebugSink, debugConnection?: RegistryDebugConnection) => RegistryRepository;
  clientName?: RegistryClientName;
};

export function translateExternalFileError(error: unknown): never {
  const details = error instanceof RegistryRequestError
    && error.details
    && typeof error.details === 'object'
    ? error.details as {method?: unknown}
    : {};
  if (
    error instanceof RegistryRequestError
    && error.code === 'INVALID_ARGUMENT'
    && (error.message === 'unsupported method on hub' || error.message === 'unsupported method')
    && (
      details.method === RegistryMethods.ProjectFSExternalInfo
      || details.method === RegistryMethods.ProjectFSExternalRead
    )
  ) {
    throw new Error('This Hub does not support external file preview.');
  }
  throw error;
}

export class RegistryWorkspaceService {
  private repository: RegistryRepository | null = null;
  private session: WorkspaceSession | null = null;
  private eventListeners = new Set<(event: RegistryEnvelope) => void>();
  private closeListeners = new Set<() => void>();
  private unsubscribeRepositoryEvent: (() => void) | null = null;
  private unsubscribeRepositoryClose: (() => void) | null = null;
  private readonly createRepository: (debugSink?: RegistryDebugSink, debugConnection?: RegistryDebugConnection) => RegistryRepository;
  private readonly clientName: RegistryClientName;

  constructor(private readonly debugSink?: RegistryDebugSink, options: RegistryWorkspaceServiceOptions = {}) {
    this.createRepository = options.createRepository ?? createRegistryRepository;
    this.clientName = options.clientName ?? 'wheelmaker-web';
  }

  async connect(wsUrl: string): Promise<WorkspaceSession> {
    const repository = this.createRepository(this.debugSink, 'Remote');
    try {
      await repository.initialize(wsUrl, this.clientName);
      const previousRepository = this.repository;
      this.bindRepository(repository);
      const snapshot = await this.listProjectSnapshotWithRetry(repository);
      const {selectedProjectId, fileEntries} = snapshot.projects.length > 0
        ? await this.selectFirstReachableProject(repository, snapshot.projects)
        : {selectedProjectId: '', fileEntries: []};
      previousRepository?.close();
      this.repository = repository;
      this.session = {...snapshot, selectedProjectId, fileEntries};
      return this.session;
    } catch (error) {
      this.unbindRepository();
      repository.close();
      throw error;
    }
  }

  private bindRepository(repository: RegistryRepository): void {
    this.unbindRepository();
    this.unsubscribeRepositoryEvent = repository.onEvent(event => {
      this.eventListeners.forEach(listener => listener(event));
    });
    this.unsubscribeRepositoryClose = repository.onClose(() => {
      this.closeListeners.forEach(listener => listener());
    });
  }

  private unbindRepository(): void {
    this.unsubscribeRepositoryEvent?.();
    this.unsubscribeRepositoryEvent = null;
    this.unsubscribeRepositoryClose?.();
    this.unsubscribeRepositoryClose = null;
  }

  private async listProjectSnapshotWithRetry(repository: RegistryRepository): Promise<RegistryProjectListResponse> {
    const retryDelaysMs = [0, 400, 900];
    let lastSnapshot: RegistryProjectListResponse = {projects: [], hubs: []};
    for (let i = 0; i < retryDelaysMs.length; i += 1) {
      if (retryDelaysMs[i] > 0) {
        await new Promise(resolve => {
          setTimeout(resolve, retryDelaysMs[i]);
        });
      }
      const snapshot = await repository.listProjectSnapshot();
      lastSnapshot = snapshot;
      if (snapshot.projects.length > 0 || snapshot.hubs.length > 0) return snapshot;
    }
    return lastSnapshot;
  }

  private async selectFirstReachableProject(
    repository: RegistryRepository,
    projects: RegistryProject[],
  ): Promise<{selectedProjectId: string; fileEntries: RegistryFsEntry[]}> {
    let lastError: unknown = null;
    for (const project of projects) {
      if (!project.projectId) continue;
      try {
        const fileList = await repository.listFiles(project.projectId, '.');
        return {selectedProjectId: project.projectId, fileEntries: fileList.entries ?? []};
      } catch (error) {
        lastError = error;
        const offline =
          error instanceof RegistryRequestError &&
          (error.code === 'NOT_FOUND' || error.code === 'UNAVAILABLE');
        if (!offline) {
          throw error;
        }
      }
    }
    if (lastError instanceof Error) {
      throw new Error(`No reachable projects. Last error: ${lastError.message}`);
    }
    throw new Error('No reachable projects. All listed projects appear offline.');
  }

  close(): void {
    this.repository?.close();
    this.repository = null;
    this.session = null;
  }

  getSession(): WorkspaceSession | null {
    return this.session;
  }

  async selectProject(projectId: string): Promise<WorkspaceSession> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    const fileEntries = (await this.repository.listFiles(projectId, '.')).entries ?? [];
    this.session = {...this.session, selectedProjectId: projectId, fileEntries};
    return this.session;
  }

  async selectProjectLightweight(projectId: string): Promise<WorkspaceSession> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    if (!this.session.projects.some(project => project.projectId === projectId)) {
      throw new Error('Project is no longer available');
    }
    this.session = {...this.session, selectedProjectId: projectId};
    return this.session;
  }

  async listDirectory(path: string, knownHash?: string): Promise<{entries: RegistryFsEntry[]; hash?: string; notModified: boolean}> {
    if (!this.session || !this.repository) {
      return {entries: [], hash: '', notModified: false};
    }
    if (!this.session.selectedProjectId) {
      return {entries: [], hash: '', notModified: false};
    }
    const result = await this.repository.listFiles(this.session.selectedProjectId, path || '.', knownHash);
    return {
      entries: result.entries ?? [],
      hash: result.hash,
      notModified: result.notModified,
    };
  }

  async listProjectDirectory(projectId: string, path: string, knownHash?: string): Promise<{entries: RegistryFsEntry[]; hash?: string; notModified: boolean}> {
    if (!this.repository || !projectId) {
      return {entries: [], hash: '', notModified: false};
    }
    const result = await this.repository.listFiles(projectId, path || '.', knownHash);
    return {
      entries: result.entries ?? [],
      hash: result.hash,
      notModified: result.notModified,
    };
  }

  async getFileInfo(path: string, options?: Pick<RegistryFileRequestOptions, 'signal'>): Promise<RegistryFsInfo> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.getProjectFileInfo(this.session.selectedProjectId, path, options);
  }

  async getProjectFileInfo(projectId: string, path: string, options?: Pick<RegistryFileRequestOptions, 'signal'>): Promise<RegistryFsInfo> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.getFileInfo(projectId, path, options);
  }

  async getExternalFileInfo(
    projectId: string,
    path: string,
    options?: Pick<RegistryFileRequestOptions, 'signal'>,
  ): Promise<RegistryFsInfo> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    try {
      return await this.repository.getExternalFileInfo(projectId, path, options);
    } catch (error) {
      return translateExternalFileError(error);
    }
  }

  async readFile(path: string, options?: RegistryFileRequestOptions): Promise<{
    content: string;
    hash?: string;
    notModified: boolean;
    total?: number;
    isBinary?: boolean;
  }> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.readProjectFile(path, this.session.selectedProjectId, options);
  }

  async readProjectFile(path: string, projectId: string, options?: RegistryFileRequestOptions): Promise<{
    content: string;
    hash?: string;
    notModified: boolean;
    total?: number;
    isBinary?: boolean;
  }> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    const result = await this.repository.readFile(projectId, path, options);
    return {
      content: typeof result.content === 'string' ? result.content : '',
      hash: result.hash,
      notModified: result.notModified,
      total: result.total,
      isBinary: result.isBinary,
    };
  }

  async readExternalFile(
    path: string,
    projectId: string,
    options?: Pick<RegistryFileRequestOptions, 'signal'>,
  ): Promise<{
    content: string;
    hash?: string;
    notModified: boolean;
    total?: number;
    isBinary?: boolean;
  }> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    try {
      const result = await this.repository.readExternalFile(projectId, path, options);
      return {
        content: typeof result.content === 'string' ? result.content : '',
        hash: result.hash,
        notModified: result.notModified,
        total: result.total,
        isBinary: result.isBinary,
      };
    } catch (error) {
      return translateExternalFileError(error);
    }
  }

  async getFileIndexStatus(hubId: string): Promise<RegistryFileIndexStatusResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.getFileIndexStatus(hubId);
  }

  async rebuildFileIndex(projectId: string): Promise<RegistryFileIndexRebuildResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.rebuildFileIndex(projectId);
  }

  async searchFileIndex(
    projectId: string,
    payload: {query: string; querySessionId?: string; queryId?: number; limit?: number},
  ): Promise<RegistryFileIndexSearchResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.searchFileIndex(projectId, payload);
  }

  async listGitCommits(ref = 'HEAD', refs: string[] = []): Promise<RegistryGitCommit[]> {
    if (!this.session || !this.repository) return [];
    return this.repository.gitLog(this.session.selectedProjectId, ref, '', 50, refs);
  }

  async getGitRev(): Promise<RegistryGitRev> {
    if (!this.session || !this.repository) {
      return {gitRev: '', worktreeRev: ''};
    }
    return this.repository.gitRev(this.session.selectedProjectId);
  }

  async listGitBranches(): Promise<{current: string; branches: string[]; remoteBranches: string[]}> {
    if (!this.session || !this.repository) {
      return {current: '', branches: [], remoteBranches: []};
    }
    return this.repository.gitBranches(this.session.selectedProjectId);
  }

  async listGitCommitFiles(sha: string): Promise<RegistryGitCommitFile[]> {
    if (!this.session || !this.repository) return [];
    return this.repository.gitCommitFiles(this.session.selectedProjectId, sha);
  }

  async readGitFileDiff(sha: string, path: string): Promise<RegistryGitFileDiff> {
    if (!this.session || !this.repository) {
      return {sha, path, isBinary: false, diff: '', truncated: false};
    }
    return this.repository.gitCommitFileDiff(this.session.selectedProjectId, sha, path, 3);
  }

  async getGitStatus(): Promise<RegistryGitStatus> {
    if (!this.session || !this.repository) {
      return {dirty: false, worktreeRev: '', staged: [], unstaged: [], untracked: []};
    }
    return this.repository.gitStatus(this.session.selectedProjectId);
  }

  async readWorkingTreeFileDiff(
    path: string,
    scope: 'staged' | 'unstaged' | 'untracked' = 'unstaged',
  ): Promise<RegistryWorkingTreeFileDiff> {
    if (!this.session || !this.repository) {
      return {path, scope, isBinary: false, diff: '', truncated: false};
    }
    return this.repository.gitWorkingTreeFileDiff(this.session.selectedProjectId, path, scope, 3);
  }

  async listProjects(): Promise<RegistryProject[]> {
    return (await this.listProjectSnapshot()).projects;
  }

  async uploadDebugLog(payload: RegistryDebugUploadLogPayload): Promise<RegistryDebugUploadLogResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.uploadDebugLog(payload);
  }

  async listProjectSnapshot(): Promise<RegistryProjectListResponse> {
    if (!this.repository) {
      return {projects: this.session?.projects ?? [], hubs: this.session?.hubs ?? []};
    }
    const snapshot = await this.repository.listProjectSnapshot();
    if (this.session) {
      this.session = {...this.session, projects: snapshot.projects, hubs: snapshot.hubs};
    }
    return snapshot;
  }

  async listSessions(): Promise<RegistrySessionSummary[]> {
    if (!this.session || !this.repository) {
      return [];
    }
    return this.repository.listSessions(this.session.selectedProjectId);
  }

  async listProjectSessions(projectId: string): Promise<RegistrySessionSummary[]> {
    if (!this.repository) {
      return [];
    }
    return this.repository.listSessions(projectId);
  }

  async readSession(sessionId: string, afterTurnIndex = 0): Promise<RegistrySessionReadResponse> {
    if (!this.session || !this.repository) {
      return {
        sessionId: '',
        turns: [],
        messages: [],
        latestTurnIndex: 0,
      };
    }
    return this.repository.readSession(this.session.selectedProjectId, sessionId, afterTurnIndex);
  }

  async readProjectSession(projectId: string, sessionId: string, afterTurnIndex = 0): Promise<RegistrySessionReadResponse> {
    if (!this.repository) {
      return {
        sessionId: '',
        turns: [],
        messages: [],
        latestTurnIndex: 0,
      };
    }
    return this.repository.readSession(projectId, sessionId, afterTurnIndex);
  }

  async readSessionArtifact(
    projectId: string,
    sessionId: string,
    artifactId: string,
  ): Promise<RegistrySessionArtifactReadResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.readSessionArtifact(projectId, sessionId, artifactId);
  }

  async startProjectSessionSearch(projectId: string, searchId: string, query: string): Promise<RegistrySessionSearchStatusResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.startSessionSearch(projectId, searchId, query);
  }

  async queryProjectSessionSearch(projectId: string, searchId: string): Promise<RegistrySessionSearchResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.querySessionSearch(projectId, searchId);
  }

  async cancelProjectSessionSearch(projectId: string, searchId: string): Promise<RegistrySessionSearchStatusResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.cancelSessionSearch(projectId, searchId);
  }

  async markSessionRead(sessionId: string, lastReadTurnIndex: number): Promise<{ok: boolean; session?: RegistrySessionSummary}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.markSessionRead(this.session.selectedProjectId, sessionId, lastReadTurnIndex);
  }

  async markProjectSessionRead(
    projectId: string,
    sessionId: string,
    lastReadTurnIndex: number,
  ): Promise<{ok: boolean; session?: RegistrySessionSummary}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.markSessionRead(projectId, sessionId, lastReadTurnIndex);
  }

  async createSession(agentType: string, title?: string, createRequestId?: string): Promise<{ok: boolean; session: RegistrySessionSummary}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.createSession(this.session.selectedProjectId, agentType, title, createRequestId);
  }

  async createProjectSession(projectId: string, agentType: string, title?: string, createRequestId?: string): Promise<{ok: boolean; session: RegistrySessionSummary}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.createSession(projectId, agentType, title, createRequestId);
  }

  async sendSessionMessage(payload: {sessionId: string; text?: string; blocks?: RegistrySessionContentBlock[]}): Promise<{ok: boolean; sessionId: string}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.sendSessionMessage(this.session.selectedProjectId, payload);
  }

  async sendProjectSessionMessage(projectId: string, payload: {sessionId: string; text?: string; blocks?: RegistrySessionContentBlock[]}): Promise<{ok: boolean; sessionId: string}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.sendSessionMessage(projectId, payload);
  }

  async statusProjectSession(projectId: string, sessionId: string): Promise<RegistrySessionStatusResult> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.statusSession(projectId, sessionId);
  }

  async compactProjectSession(projectId: string, sessionId: string): Promise<RegistrySessionCompactAccepted> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.compactSession(projectId, sessionId);
  }

  async startProjectSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentStartPayload,
  ): Promise<RegistrySessionAttachmentStartResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.startSessionAttachment(projectId, payload);
  }

  async uploadProjectSessionAttachmentChunk(
    projectId: string,
    payload: RegistrySessionAttachmentChunkPayload,
  ): Promise<RegistrySessionAttachmentChunkResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.uploadSessionAttachmentChunk(projectId, payload);
  }

  async finishProjectSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentFinishPayload,
  ): Promise<RegistrySessionAttachmentFinishResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.finishSessionAttachment(projectId, payload);
  }

  async cancelProjectSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentCancelPayload,
  ): Promise<RegistrySessionAttachmentCancelResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.cancelSessionAttachment(projectId, payload);
  }

  async deleteProjectSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentDeletePayload,
  ): Promise<RegistrySessionAttachmentDeleteResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.deleteSessionAttachment(projectId, payload);
  }

  async readProjectSessionAttachmentThumbnail(
    projectId: string,
    payload: RegistrySessionAttachmentReadPayload,
  ): Promise<RegistrySessionAttachmentContentResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.readSessionAttachmentThumbnail(projectId, payload);
  }

  async readProjectSessionAttachment(
    projectId: string,
    payload: RegistrySessionAttachmentReadPayload,
  ): Promise<RegistrySessionAttachmentContentResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.readSessionAttachment(projectId, payload);
  }

  async cancelProjectSession(projectId: string, sessionId: string): Promise<{ok: boolean; sessionId: string}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.cancelSession(projectId, sessionId);
  }

  async respondProjectSessionPermission(
    projectId: string,
    sessionId: string,
    permissionId: string,
    optionId: string,
  ): Promise<RegistryPermissionRespondResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.respondSessionPermission(projectId, sessionId, permissionId, optionId);
  }

  async archiveSession(sessionId: string): Promise<{ok: boolean; sessionId: string; warning?: string}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.archiveSession(this.session.selectedProjectId, sessionId);
  }

  async archiveProjectSession(projectId: string, sessionId: string): Promise<{ok: boolean; sessionId: string; warning?: string}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.archiveSession(projectId, sessionId);
  }

  async listProjectArchivedSessions(projectId: string): Promise<RegistryArchivedSessionSummary[]> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.listArchivedSessions(projectId);
  }

  async readProjectArchivedSession(projectId: string, sessionId: string): Promise<RegistrySessionArchiveReadResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.readArchivedSession(projectId, sessionId);
  }

  async restoreProjectArchivedSession(projectId: string, sessionId: string): Promise<RegistrySessionArchiveRestoreResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.restoreArchivedSession(projectId, sessionId);
  }

  async deleteProjectSession(projectId: string, sessionId: string): Promise<{ok: boolean; sessionId: string}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.deleteSession(projectId, sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.renameSession(this.session.selectedProjectId, sessionId, title);
  }

  async renameProjectSession(projectId: string, sessionId: string, title: string): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.renameSession(projectId, sessionId, title);
  }

  async pinProjectSession(
    projectId: string,
    sessionId: string,
    pinned: boolean,
  ): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.pinSession(projectId, sessionId, pinned);
  }

  async listResumableSessions(agentType: string): Promise<RegistryResumableSession[]> {
    if (!this.session || !this.repository) {
      return [];
    }
    return this.repository.listResumableSessions(this.session.selectedProjectId, agentType);
  }

  async listProjectResumableSessions(projectId: string, agentType: string): Promise<RegistryResumableSession[]> {
    if (!this.repository) {
      return [];
    }
    return this.repository.listResumableSessions(projectId, agentType);
  }

  async importResumedSession(agentType: string, sessionId: string): Promise<{ok: boolean; session: RegistrySessionSummary}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.importResumedSession(this.session.selectedProjectId, agentType, sessionId);
  }

  async importProjectResumedSession(projectId: string, agentType: string, sessionId: string): Promise<{ok: boolean; session: RegistrySessionSummary}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.importResumedSession(projectId, agentType, sessionId);
  }

  async reloadSession(sessionId: string): Promise<{ok: boolean; sessionId: string}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.reloadSession(this.session.selectedProjectId, sessionId);
  }

  async reloadProjectSession(projectId: string, sessionId: string): Promise<{ok: boolean; sessionId: string}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.reloadSession(projectId, sessionId);
  }

  async setSessionConfig(payload: {sessionId: string; configId: string; value: string}): Promise<{ok: boolean; sessionId: string; configOptions: RegistrySessionConfigOption[]}> {
    if (!this.session || !this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.setSessionConfig(this.session.selectedProjectId, payload);
  }

  async setProjectSessionConfig(projectId: string, payload: {sessionId: string; configId: string; value: string}): Promise<{ok: boolean; sessionId: string; configOptions: RegistrySessionConfigOption[]}> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.setSessionConfig(projectId, payload);
  }

  async getHubState(hubId: string, sections?: RegistryHubStateSectionName[]): Promise<RegistryHubState> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.getHubState(hubId, sections);
  }

  async refreshHubState(hubId: string, sections: RegistryHubStateSectionName[]): Promise<RegistryHubState> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.refreshHubState(hubId, sections);
  }

  async scanNpmPackages(hubId: string): Promise<RegistryNpmCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.scanNpmPackages(hubId);
  }

  async getPortRelayStatus(): Promise<RegistryPortRelaySnapshot> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.getPortRelayStatus();
  }

  async enablePortRelay(payload: RegistryPortRelayEnablePayload): Promise<RegistryPortRelaySnapshot> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.enablePortRelay(payload);
  }

  async disablePortRelay(): Promise<RegistryPortRelaySnapshot> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.disablePortRelay();
  }

  async regeneratePortRelayAccessCode(accessCode: string): Promise<RegistryPortRelaySnapshot> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.regeneratePortRelayAccessCode(accessCode);
  }

  async installNpmPackage(hubId: string, packageName: string, version = 'latest'): Promise<RegistryNpmCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.installNpmPackage(hubId, packageName, version);
  }

  async installNpmPackages(hubId: string, packageNames: string[], version = 'latest'): Promise<RegistryNpmCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.installNpmPackages(hubId, packageNames, version);
  }

  async uninstallNpmPackage(hubId: string, packageName: string): Promise<RegistryNpmCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.uninstallNpmPackage(hubId, packageName);
  }

  async queryWheelMakerUpdate(hubId: string): Promise<RegistryWheelMakerUpdateResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.queryWheelMakerUpdate(hubId);
  }

  async requestWheelMakerUpdate(hubId: string): Promise<RegistryWheelMakerUpdateResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.requestWheelMakerUpdate(hubId);
  }

  async startReleasePublish(hubId: string, input: Record<string, unknown>): Promise<RegistryReleasePublishResponse> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.startReleasePublish(hubId, input);
  }

  async queryReleasePublish(hubId: string, jobId: string): Promise<RegistryReleasePublishResponse> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.queryReleasePublish(hubId, jobId);
  }

  async scanSkills(hubId: string): Promise<RegistrySkillCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.scanSkills(hubId);
  }

  async listSkillsSource(hubId: string, source: string): Promise<RegistrySkillCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.listSkillsSource(hubId, source);
  }

  async installSkills(payload: RegistrySkillInstallPayload): Promise<RegistrySkillCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.installSkills(payload);
  }

  async uninstallSkills(payload: RegistrySkillScopePayload): Promise<RegistrySkillCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.uninstallSkills(payload);
  }

  async getSkillDetail(payload: RegistrySkillDetailPayload): Promise<RegistrySkillCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.getSkillDetail(payload);
  }

  async updateSkills(payload: RegistrySkillScopePayload): Promise<RegistrySkillCommandResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.updateSkills(payload);
  }

  async startSpeech(payload: RegistrySpeechStartPayload): Promise<RegistrySpeechStartResponse> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.startSpeech(payload);
  }

  async listDeviceSessions(): Promise<RegistryDeviceSession[]> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.listDeviceSessions();
  }

  async revokeDeviceSession(deviceId: string): Promise<void> {
    if (!this.repository) throw new Error('session is not ready');
    await this.repository.revokeDeviceSession(deviceId);
  }

  async revokeAllDeviceSessions(): Promise<void> {
    if (!this.repository) throw new Error('session is not ready');
    await this.repository.revokeAllDeviceSessions();
  }

  async getServerSettings(): Promise<ServerSettings> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.getServerSettings();
  }

  async updateServerSettings(payload: ServerSettingsUpdate): Promise<ServerSettings> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.updateServerSettings(payload);
  }

  async getAndroidSpeechCredential(): Promise<{accessToken: string; version: string; model: SpeechModelId}> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.getAndroidSpeechCredential();
  }

	async synthesizeTTS(payload: RegistryTTSSynthesizePayload): Promise<RegistryTTSSynthesizeResponse> {
		if (!this.repository) throw new Error('session is not ready');
		return this.repository.synthesizeTTS(payload);
	}

  async listTerminals(hubId: string): Promise<RegistryTerminalListResponse> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.listTerminals(hubId);
  }

  async createTerminal(projectId: string, cols: number, rows: number): Promise<RegistryTerminalCreateResponse> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.createTerminal(projectId, cols, rows);
  }

  async getTerminal(hubId: string, terminalId: string): Promise<RegistryTerminalGetResponse> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.getTerminal(hubId, terminalId);
  }

  async resizeTerminal(hubId: string, payload: RegistryTerminalResizeRequest): Promise<RegistryTerminalResizeResponse> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.resizeTerminal(hubId, payload);
  }

  async closeTerminal(hubId: string, terminalId: string): Promise<void> {
    if (!this.repository) throw new Error('session is not ready');
    await this.repository.closeTerminal(hubId, terminalId);
  }

  async restartTerminal(hubId: string, terminalId: string): Promise<RegistryTerminalCreateResponse> {
    if (!this.repository) throw new Error('session is not ready');
    return this.repository.restartTerminal(hubId, terminalId);
  }

  sendTerminalInput(hubId: string, payload: RegistryTerminalInputEvent): void {
    if (!this.repository) throw new Error('session is not ready');
    this.repository.sendTerminalInput(hubId, payload);
  }

  async sendSpeechChunk(payload: RegistrySpeechChunkPayload): Promise<void> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.sendSpeechChunk(payload);
  }

  async finishSpeech(payload: RegistrySpeechFinishPayload): Promise<void> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.finishSpeech(payload);
  }

  async cancelSpeech(payload: RegistrySpeechCancelPayload): Promise<void> {
    if (!this.repository) {
      throw new Error('session is not ready');
    }
    return this.repository.cancelSpeech(payload);
  }

  onEvent(listener: (event: RegistryEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }
}







