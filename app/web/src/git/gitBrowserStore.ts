import type {ProjectGitLogOptions} from '../registry/RegistryWorkspaceService';
import type {
  RegistryGitCommit,
  RegistryGitCommitFile,
  RegistryGitRev,
  RegistryGitStatus,
  RegistryProject,
} from '../registry/registryTypes';
import {
  GIT_HISTORY_PAGE_SIZE,
  buildWorkingTreeGroups,
  gitProjectAvailable,
  mergeGitCommitPage,
  normalizeGitBranchOptions,
  revisionChange,
  type GitBranchOption,
  type GitWorkingTreeGroups,
} from './gitBrowserModel';

export type GitBrowserGateway = {
  getRev(projectId: string): Promise<RegistryGitRev>;
  getRefs(projectId: string): Promise<{
    current: string;
    branches: string[];
    remoteBranches: string[];
  }>;
  getLog(projectId: string, options: ProjectGitLogOptions): Promise<RegistryGitCommit[]>;
  getCommitFiles(projectId: string, sha: string): Promise<RegistryGitCommitFile[]>;
  getStatus(projectId: string): Promise<RegistryGitStatus>;
};

export type GitBrowserProjectSnapshot = {
  projectId: string;
  available: boolean;
  online: boolean;
  currentBranch: string;
  headSha: string;
  branches: GitBranchOption[];
  selectedRefs: string[];
  commits: RegistryGitCommit[];
  commitFilesBySha: Record<string, RegistryGitCommitFile[]>;
  expandedCommitSha: string;
  worktree: GitWorkingTreeGroups;
  gitRev: string;
  worktreeRev: string;
  refsLoaded: boolean;
  historyLoaded: boolean;
  statusLoaded: boolean;
  historyDone: boolean;
  historyCursor: string;
  historyLoading: boolean;
  historyMoreLoading: boolean;
  statusLoading: boolean;
  commitFilesLoadingSha: string;
  historyError: string;
  statusError: string;
  commitFilesError: string;
};

export type GitBrowserSnapshot = Readonly<Record<string, GitBrowserProjectSnapshot>>;

const EMPTY_WORKTREE: GitWorkingTreeGroups = {
  staged: [],
  unstaged: [],
  untracked: [],
};

function emptyProject(projectId: string): GitBrowserProjectSnapshot {
  return {
    projectId,
    available: false,
    online: false,
    currentBranch: '',
    headSha: '',
    branches: [],
    selectedRefs: [],
    commits: [],
    commitFilesBySha: {},
    expandedCommitSha: '',
    worktree: EMPTY_WORKTREE,
    gitRev: '',
    worktreeRev: '',
    refsLoaded: false,
    historyLoaded: false,
    statusLoaded: false,
    historyDone: false,
    historyCursor: '',
    historyLoading: false,
    historyMoreLoading: false,
    statusLoading: false,
    commitFilesLoadingSha: '',
    historyError: '',
    statusError: '',
    commitFilesError: '',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class GitBrowserStore {
  private readonly listeners = new Set<() => void>();
  private readonly projects = new Map<string, GitBrowserProjectSnapshot>();
  private readonly emptyProjects = new Map<string, GitBrowserProjectSnapshot>();
  private readonly generations = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<void>>();
  private currentSnapshot: GitBrowserSnapshot = {};

  constructor(private readonly gateway: GitBrowserGateway) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): GitBrowserSnapshot => this.currentSnapshot;

  project(projectId: string): GitBrowserProjectSnapshot {
    const existing = this.projects.get(projectId);
    if (existing) return existing;
    const empty = this.emptyProjects.get(projectId) ?? emptyProject(projectId);
    this.emptyProjects.set(projectId, empty);
    return empty;
  }

  async syncProjects(projects: RegistryProject[]): Promise<void> {
    const incomingIds = new Set(projects.map(project => project.projectId));
    const refreshes: Promise<void>[] = [];
    let changed = false;
    for (const project of projects) {
      const existing = this.projects.get(project.projectId) ?? emptyProject(project.projectId);
      const reportedAvailable = gitProjectAvailable(project.git);
      const nextRevision = reportedAvailable
        ? {
          gitRev: project.git?.gitRev ?? '',
          worktreeRev: project.git?.worktreeRev ?? '',
        }
        : {gitRev: existing.gitRev, worktreeRev: existing.worktreeRev};
      const changes = revisionChange(
        {gitRev: existing.gitRev, worktreeRev: existing.worktreeRev},
        nextRevision,
      );
      const currentBranch = reportedAvailable
        ? project.git?.branch ?? ''
        : existing.currentBranch;
      const selectedRefs = existing.selectedRefs.length > 0
        ? existing.selectedRefs
        : currentBranch ? [currentBranch] : [];
      const next: GitBrowserProjectSnapshot = {
        ...existing,
        available: project.online
          ? reportedAvailable
          : existing.available || reportedAvailable,
        online: project.online,
        currentBranch,
        headSha: reportedAvailable ? project.git?.headSha ?? '' : existing.headSha,
        selectedRefs,
        gitRev: nextRevision.gitRev,
        worktreeRev: nextRevision.worktreeRev,
      };
      this.projects.set(project.projectId, next);
      changed = true;

      if (project.online && changes.history && existing.historyLoaded) {
        refreshes.push(this.reloadHistory(project.projectId));
      }
      if (project.online && changes.worktree && existing.statusLoaded) {
        refreshes.push(this.reloadStatus(project.projectId));
      }
    }
    for (const projectId of this.projects.keys()) {
      if (incomingIds.has(projectId)) continue;
      this.projects.delete(projectId);
      changed = true;
    }
    if (changed) this.emit();
    await Promise.all(refreshes);
  }

  async ensureStatus(projectId: string): Promise<void> {
    const state = this.project(projectId);
    if (state.statusLoaded || state.statusLoading || !state.available || !state.online) {
      return this.inflight.get(this.inflightKey(projectId, 'status'));
    }
    return this.loadStatus(projectId);
  }

  async ensureHistory(projectId: string): Promise<void> {
    const state = this.project(projectId);
    if (!state.available || !state.online) return;
    const refs = state.refsLoaded ? Promise.resolve() : this.ensureRefs(projectId);
    if (state.historyLoaded || state.historyLoading) {
      await Promise.all([
        refs,
        this.inflight.get(this.inflightKey(projectId, 'history')) ?? Promise.resolve(),
      ]);
      return;
    }
    await Promise.all([refs, this.loadHistoryPage(projectId, true)]);
  }

  async loadMore(projectId: string): Promise<void> {
    const state = this.project(projectId);
    if (
      !state.available
      || !state.online
      || !state.historyLoaded
      || state.historyDone
      || state.historyLoading
      || state.historyMoreLoading
    ) return;
    await this.loadHistoryPage(projectId, false);
  }

  async setSelectedRefs(projectId: string, refs: string[]): Promise<void> {
    const state = this.project(projectId);
    const normalized = [...new Set(refs.filter(Boolean))];
    const selectedRefs = normalized.length > 0
      ? normalized
      : state.currentBranch ? [state.currentBranch] : [];
    this.bump(projectId, 'history');
    this.setProject(projectId, {
      ...state,
      selectedRefs,
      commits: [],
      expandedCommitSha: '',
      historyLoaded: false,
      historyDone: false,
      historyCursor: '',
      historyLoading: false,
      historyMoreLoading: false,
      historyError: '',
    });
    await this.ensureHistory(projectId);
  }

  async toggleCommit(projectId: string, sha: string): Promise<void> {
    const state = this.project(projectId);
    if (state.expandedCommitSha === sha) {
      this.setProject(projectId, {...state, expandedCommitSha: ''});
      return;
    }
    this.setProject(projectId, {
      ...state,
      expandedCommitSha: sha,
      commitFilesError: '',
    });
    if (Object.prototype.hasOwnProperty.call(state.commitFilesBySha, sha)) return;
    if (!state.available || !state.online) return;

    const operation = `files:${sha}`;
    const generation = this.bump(projectId, operation);
    const request = this.gateway.getCommitFiles(projectId, sha)
      .then(files => {
        if (!this.isCurrent(projectId, operation, generation)) return;
        const latest = this.project(projectId);
        this.setProject(projectId, {
          ...latest,
          commitFilesBySha: {...latest.commitFilesBySha, [sha]: files},
          commitFilesLoadingSha: latest.commitFilesLoadingSha === sha ? '' : latest.commitFilesLoadingSha,
          commitFilesError: '',
        });
      })
      .catch(error => {
        if (!this.isCurrent(projectId, operation, generation)) return;
        const latest = this.project(projectId);
        this.setProject(projectId, {
          ...latest,
          commitFilesLoadingSha: latest.commitFilesLoadingSha === sha ? '' : latest.commitFilesLoadingSha,
          commitFilesError: errorMessage(error),
        });
      });
    this.setProject(projectId, {
      ...this.project(projectId),
      commitFilesLoadingSha: sha,
    });
    this.track(this.inflightKey(projectId, operation), request);
    await request;
  }

  async refresh(projectId: string): Promise<void> {
    const state = this.project(projectId);
    if (!state.available || !state.online) return;
    const revisionOperation = 'revision';
    const generation = this.bump(projectId, revisionOperation);
    const revision = this.gateway.getRev(projectId)
      .then(next => {
        if (!this.isCurrent(projectId, revisionOperation, generation)) return;
        const latest = this.project(projectId);
        this.setProject(projectId, {...latest, ...next});
      });
    await Promise.all([
      revision,
      this.ensureRefs(projectId, true),
      state.historyLoaded ? this.reloadHistory(projectId) : Promise.resolve(),
      state.statusLoaded ? this.reloadStatus(projectId) : Promise.resolve(),
    ]);
  }

  private async ensureRefs(projectId: string, force = false): Promise<void> {
    const state = this.project(projectId);
    const key = this.inflightKey(projectId, 'refs');
    if (!force && state.refsLoaded) return;
    const active = this.inflight.get(key);
    if (active) return active;
    const generation = this.bump(projectId, 'refs');
    const request = this.gateway.getRefs(projectId)
      .then(refs => {
        if (!this.isCurrent(projectId, 'refs', generation)) return;
        const latest = this.project(projectId);
        const currentBranch = refs.current || latest.currentBranch;
        this.setProject(projectId, {
          ...latest,
          currentBranch,
          branches: normalizeGitBranchOptions({...refs, current: currentBranch}),
          selectedRefs: latest.selectedRefs.length > 0
            ? latest.selectedRefs
            : currentBranch ? [currentBranch] : [],
          refsLoaded: true,
          historyError: '',
        });
      })
      .catch(error => {
        if (!this.isCurrent(projectId, 'refs', generation)) return;
        const latest = this.project(projectId);
        this.setProject(projectId, {...latest, historyError: errorMessage(error)});
      });
    this.track(key, request);
    await request;
  }

  private async reloadHistory(projectId: string): Promise<void> {
    this.bump(projectId, 'history');
    const state = this.project(projectId);
    this.setProject(projectId, {
      ...state,
      historyLoading: false,
      historyMoreLoading: false,
      historyError: '',
    });
    await this.loadHistoryPage(projectId, true);
  }

  private async loadHistoryPage(projectId: string, reset: boolean): Promise<void> {
    const state = this.project(projectId);
    if (!state.available || !state.online) return;
    const operation = 'history';
    const generation = this.generation(projectId, operation);
    const key = this.inflightKey(projectId, operation);
    const cursor = reset ? '' : state.historyCursor;
    const previous = reset ? [] : state.commits;
    this.setProject(projectId, {
      ...state,
      historyLoading: reset,
      historyMoreLoading: !reset,
      historyError: '',
    });
    const request = this.gateway.getLog(projectId, {
      ref: 'HEAD',
      refs: state.selectedRefs,
      cursor,
      limit: GIT_HISTORY_PAGE_SIZE,
    }).then(page => {
      if (!this.isCurrent(projectId, operation, generation)) return;
      const latest = this.project(projectId);
      const merged = mergeGitCommitPage(previous, page, GIT_HISTORY_PAGE_SIZE);
      this.setProject(projectId, {
        ...latest,
        commits: merged.commits,
        historyLoaded: true,
        historyDone: merged.done,
        historyCursor: merged.nextCursor,
        historyLoading: false,
        historyMoreLoading: false,
        historyError: '',
      });
    }).catch(error => {
      if (!this.isCurrent(projectId, operation, generation)) return;
      const latest = this.project(projectId);
      this.setProject(projectId, {
        ...latest,
        historyLoading: false,
        historyMoreLoading: false,
        historyError: errorMessage(error),
      });
    });
    this.track(key, request);
    await request;
  }

  private async reloadStatus(projectId: string): Promise<void> {
    this.bump(projectId, 'status');
    const state = this.project(projectId);
    this.setProject(projectId, {...state, statusLoading: false, statusError: ''});
    await this.loadStatus(projectId);
  }

  private async loadStatus(projectId: string): Promise<void> {
    const state = this.project(projectId);
    if (!state.available || !state.online) return;
    const operation = 'status';
    const generation = this.generation(projectId, operation);
    const key = this.inflightKey(projectId, operation);
    this.setProject(projectId, {...state, statusLoading: true, statusError: ''});
    const request = this.gateway.getStatus(projectId)
      .then(status => {
        if (!this.isCurrent(projectId, operation, generation)) return;
        const latest = this.project(projectId);
        this.setProject(projectId, {
          ...latest,
          worktree: buildWorkingTreeGroups(status),
          worktreeRev: latest.worktreeRev || status.worktreeRev,
          statusLoaded: true,
          statusLoading: false,
          statusError: '',
        });
      })
      .catch(error => {
        if (!this.isCurrent(projectId, operation, generation)) return;
        const latest = this.project(projectId);
        this.setProject(projectId, {
          ...latest,
          statusLoading: false,
          statusError: errorMessage(error),
        });
      });
    this.track(key, request);
    await request;
  }

  private setProject(projectId: string, state: GitBrowserProjectSnapshot): void {
    this.projects.set(projectId, state);
    this.emit();
  }

  private emit(): void {
    this.currentSnapshot = Object.fromEntries(this.projects);
    this.listeners.forEach(listener => listener());
  }

  private generation(projectId: string, operation: string): number {
    return this.generations.get(this.inflightKey(projectId, operation)) ?? 0;
  }

  private bump(projectId: string, operation: string): number {
    const next = this.generation(projectId, operation) + 1;
    this.generations.set(this.inflightKey(projectId, operation), next);
    return next;
  }

  private isCurrent(projectId: string, operation: string, generation: number): boolean {
    return this.generation(projectId, operation) === generation;
  }

  private inflightKey(projectId: string, operation: string): string {
    return `${projectId}:${operation}`;
  }

  private track(key: string, request: Promise<void>): void {
    this.inflight.set(key, request);
    void request.finally(() => {
      if (this.inflight.get(key) === request) this.inflight.delete(key);
    });
  }
}
