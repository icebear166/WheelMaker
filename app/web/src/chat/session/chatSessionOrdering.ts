import type {RegistryChatSession} from '../../registry/registryTypes';

function parsedTimestamp(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareChatSessionUpdatedAtDesc(left: string, right: string): number {
  const leftTimestamp = parsedTimestamp(left);
  const rightTimestamp = parsedTimestamp(right);
  if (leftTimestamp !== null && rightTimestamp !== null) {
    return rightTimestamp - leftTimestamp;
  }
  if (leftTimestamp !== null) {
    return -1;
  }
  if (rightTimestamp !== null) {
    return 1;
  }
  if (!left && right) {
    return 1;
  }
  if (left && !right) {
    return -1;
  }
  return right.localeCompare(left);
}

export function sortChatSessions(items: RegistryChatSession[]): RegistryChatSession[] {
  return [...items].sort((left, right) =>
    compareChatSessionUpdatedAtDesc(left.updatedAt || '', right.updatedAt || ''),
  );
}

export function sortProjectChatSessions(items: RegistryChatSession[]): RegistryChatSession[] {
  return [...items].sort((left, right) => {
    const pinOrder = Number(right.pinned === true) - Number(left.pinned === true);
    if (pinOrder !== 0) {
      return pinOrder;
    }
    return compareChatSessionUpdatedAtDesc(left.updatedAt || '', right.updatedAt || '');
  });
}

function mergeSessionSummary(
  existing: RegistryChatSession | undefined,
  next: Partial<RegistryChatSession> & {sessionId: string},
): RegistryChatSession {
  const hasMarkColor = Object.prototype.hasOwnProperty.call(next, 'markColor');
  const hasGoal = Object.prototype.hasOwnProperty.call(next, 'goal');
  return {
    sessionId: next.sessionId,
    title: next.title ?? existing?.title ?? '',
    preview: next.preview ?? existing?.preview ?? '',
    updatedAt: next.updatedAt ?? existing?.updatedAt ?? '',
    messageCount: next.messageCount ?? existing?.messageCount ?? 0,
    unreadCount: next.unreadCount ?? existing?.unreadCount,
    agentType: next.agentType ?? existing?.agentType,
    createRequestId: next.createRequestId ?? existing?.createRequestId,
    latestTurnIndex: next.latestTurnIndex ?? existing?.latestTurnIndex,
    running: next.running ?? existing?.running,
    lastDoneTurnIndex: next.lastDoneTurnIndex ?? existing?.lastDoneTurnIndex,
    lastDoneSuccess: next.lastDoneSuccess ?? existing?.lastDoneSuccess,
    lastReadTurnIndex: next.lastReadTurnIndex ?? existing?.lastReadTurnIndex,
    pinned: next.pinned ?? existing?.pinned ?? false,
    markColor: hasMarkColor ? next.markColor : existing?.markColor,
    pendingPermissionCount: next.pendingPermissionCount ?? existing?.pendingPermissionCount ?? 0,
    configOptions: next.configOptions ?? existing?.configOptions,
    commands: next.commands ?? existing?.commands,
    usage: next.usage ?? existing?.usage,
    sessionActions: next.sessionActions ?? existing?.sessionActions,
    goal: hasGoal ? next.goal : existing?.goal,
    forkedFrom: next.forkedFrom ?? existing?.forkedFrom,
  };
}

export function mergeChatSession(
  list: RegistryChatSession[],
  next: Partial<RegistryChatSession> & {sessionId: string},
): RegistryChatSession[] {
  const existing = list.find(item => item.sessionId === next.sessionId);
  const merged = mergeSessionSummary(existing, next);
  if (
    existing &&
    merged.updatedAt === existing.updatedAt &&
    (merged.pinned === true) === (existing.pinned === true)
  ) {
    return list.map(item => item.sessionId === next.sessionId ? merged : item);
  }
  return sortProjectChatSessions([
    merged,
    ...list.filter(item => item.sessionId !== next.sessionId),
  ]);
}

export function mergeChatSessionList(
  existing: RegistryChatSession[],
  incoming: RegistryChatSession[],
): RegistryChatSession[] {
  const existingById = new Map(existing.map(session => [session.sessionId, session]));
  const incomingById = new Map<string, RegistryChatSession>();
  for (const item of incoming) {
    incomingById.set(
      item.sessionId,
      mergeSessionSummary(incomingById.get(item.sessionId) ?? existingById.get(item.sessionId), item),
    );
  }
  const orderChanged =
    incomingById.size !== existingById.size ||
    existing.some(session => {
      const next = incomingById.get(session.sessionId);
      return !next ||
        next.updatedAt !== session.updatedAt ||
        (next.pinned === true) !== (session.pinned === true);
    });
  if (!orderChanged) {
    return existing.map(session => incomingById.get(session.sessionId) ?? session);
  }
  return sortProjectChatSessions(Array.from(incomingById.values()));
}
