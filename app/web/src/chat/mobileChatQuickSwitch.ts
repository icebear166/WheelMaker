import type {RegistryChatSession, RegistryProject} from '../registry/registryTypes';

export type MobileChatQuickSwitchSection = {
  projectId: string;
  projectName: string;
  projectHubId: string;
  projectHubLabel: string;
  sessions: RegistryChatSession[];
};

type BuildMobileChatQuickSwitchSectionsInput = {
  projects: RegistryProject[];
  sessionsByProjectId: Record<string, RegistryChatSession[]>;
  limit?: number;
};

type MobileChatQuickSwitchCandidate = {
  key: string;
  projectId: string;
  projectName: string;
  projectHubId: string;
  projectHubLabel: string;
  projectIndex: number;
  session: RegistryChatSession;
  sessionIndex: number;
  priority: boolean;
};

function chatQuickSwitchSessionKey(projectId: string, sessionId: string): string {
  return `${projectId}\n${sessionId}`;
}

function isPriorityQuickSwitchSession(session: RegistryChatSession): boolean {
  return (session.unreadCount ?? 0) > 0 || session.running === true;
}

function nonNegativeTurnIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

export function hasCompletedUnreadChatSession(
  sessionsByProjectId: Record<string, RegistryChatSession[]>,
): boolean {
  return Object.values(sessionsByProjectId).some(sessions =>
    sessions.some(session => {
      if (session.running === true) {
        return false;
      }
      const lastDoneTurnIndex = nonNegativeTurnIndex(session.lastDoneTurnIndex);
      const lastReadTurnIndex = nonNegativeTurnIndex(session.lastReadTurnIndex);
      return lastDoneTurnIndex > 0 && lastDoneTurnIndex > lastReadTurnIndex;
    }),
  );
}

function compareUpdatedAtDesc(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return right.localeCompare(left);
}

function compareQuickSwitchCandidates(
  left: MobileChatQuickSwitchCandidate,
  right: MobileChatQuickSwitchCandidate,
): number {
  if (left.priority !== right.priority) {
    return left.priority ? -1 : 1;
  }
  const updatedAtDiff = compareUpdatedAtDesc(
    left.session.updatedAt || '',
    right.session.updatedAt || '',
  );
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }
  if (left.projectIndex !== right.projectIndex) {
    return left.projectIndex - right.projectIndex;
  }
  return left.sessionIndex - right.sessionIndex;
}

export function buildMobileChatQuickSwitchSections({
  projects,
  sessionsByProjectId,
  limit = 6,
}: BuildMobileChatQuickSwitchSectionsInput): MobileChatQuickSwitchSection[] {
  const candidates: MobileChatQuickSwitchCandidate[] = [];
  const seen = new Set<string>();

  for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
    const project = projects[projectIndex];
    const projectId = project.projectId;
    if (!projectId) {
      continue;
    }
    const projectHubId = project.hubId || 'local';
    const sessions = sessionsByProjectId[projectId] ?? [];
    for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex += 1) {
      const session = sessions[sessionIndex];
      if (!session.sessionId) {
        continue;
      }
      const key = chatQuickSwitchSessionKey(projectId, session.sessionId);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        key,
        projectId,
        projectName: project.name || projectId,
        projectHubId,
        projectHubLabel: projectHubId,
        projectIndex,
        session,
        sessionIndex,
        priority: isPriorityQuickSwitchSession(session),
      });
    }
  }

  const selected = candidates
    .sort(compareQuickSwitchCandidates)
    .slice(0, Math.max(0, limit));
  if (selected.length === 0) {
    return [];
  }

  const sections: MobileChatQuickSwitchSection[] = [];
  const sectionsByProjectId = new Map<string, MobileChatQuickSwitchSection>();
  for (const candidate of selected) {
    let section = sectionsByProjectId.get(candidate.projectId);
    if (!section) {
      section = {
        projectId: candidate.projectId,
        projectName: candidate.projectName,
        projectHubId: candidate.projectHubId,
        projectHubLabel: candidate.projectHubLabel,
        sessions: [],
      };
      sectionsByProjectId.set(candidate.projectId, section);
      sections.push(section);
    }
    section.sessions.push(candidate.session);
  }
  return sections;
}
