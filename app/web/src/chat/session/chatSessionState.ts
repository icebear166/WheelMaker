import type { RegistryChatSession } from '../../registry/registryTypes';
import {isCodexAppAgentType} from '../projectAgents';

export type ChatSessionVisualState =
  | 'idle'
  | 'running'
  | 'completed-unviewed'
  | 'failed-unviewed';

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

export function getChatSessionVisualState(session: Pick<
  RegistryChatSession,
  'running' | 'lastDoneTurnIndex' | 'lastDoneSuccess' | 'lastReadTurnIndex'
>): ChatSessionVisualState {
  if (session.running === true) {
    return 'running';
  }
  const lastDoneTurnIndex = nonNegativeInteger(session.lastDoneTurnIndex);
  const lastReadTurnIndex = nonNegativeInteger(session.lastReadTurnIndex);
  if (lastDoneTurnIndex <= 0 || lastDoneTurnIndex <= lastReadTurnIndex) {
    return 'idle';
  }
  return session.lastDoneSuccess === false
    ? 'failed-unviewed'
    : 'completed-unviewed';
}

export function resolveChatSessionVisualState(
  session: Pick<
    RegistryChatSession,
    'running' | 'lastDoneTurnIndex' | 'lastDoneSuccess' | 'lastReadTurnIndex'
  >,
): ChatSessionVisualState {
  return getChatSessionVisualState(session);
}

export function hasMessageLifecycleFeature(
  session: Pick<RegistryChatSession, 'agentType' | 'sessionFeatures'> | null | undefined,
  historical = false,
): boolean {
  if (session?.sessionFeatures?.messageLifecycle?.version === 1) {
    return true;
  }
  return historical && session?.sessionFeatures == null && isCodexAppAgentType(session?.agentType);
}
