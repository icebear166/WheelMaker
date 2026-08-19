import React from 'react';
import type { Components } from 'react-markdown';

import type {
  RegistryChatMessage,
  RegistrySessionSummary,
  RegistrySubagentStatus,
} from '../registry/registryTypes';
import { ChatEdgeSurfaceHeader } from './ChatEdgeSurfaceHeader';
import { ChatToolCallGroup } from './ChatToolCallGroup';
import { ChatTurnView } from './ChatTurnView';
import { ChatWorkGroup } from './ChatWorkGroup';
import { useChatEdgeSurfaceGeometry } from './layout/chatEdgeSurfaceGeometry';
import { useChatEdgeSurfaceHoverReveal } from './layout/chatEdgeSurfaceHoverReveal';
import { SessionIcon } from './sessionlist/SessionIcon';
import {
  buildChatDisplayIndex,
  combineAssistantGroupMessages,
  type ChatDisplayIndexItem,
} from './turns/chatDisplayIndex';
import { ChatVirtuosoTurnList } from './turns/ChatVirtuosoTurnList';

const readOnlyMarkdownComponents: Components = {};
const readOnlyUrlTransform = (value: string) => {
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(value)?.[0].toLowerCase() ?? '';
  return !scheme ||
    scheme === 'http:' ||
    scheme === 'https:' ||
    scheme === 'mailto:'
    ? value
    : '';
};

const statusLabels: Record<RegistrySubagentStatus, string> = {
  initializing: 'Starting',
  running: 'Running',
  waiting_approval: 'Approval',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

export function sortSubagentSessions<T extends RegistrySessionSummary>(
  sessions: T[],
): T[] {
  return [...sessions].sort((left, right) => {
    const leftSequence =
      left.subagent?.spawnSequence ?? Number.MAX_SAFE_INTEGER;
    const rightSequence =
      right.subagent?.spawnSequence ?? Number.MAX_SAFE_INTEGER;
    if (leftSequence === rightSequence) {
      return left.sessionId.localeCompare(right.sessionId);
    }
    return leftSequence - rightSequence;
  });
}

export function partitionSubagentSessions(sessions: RegistrySessionSummary[]): {
  roots: RegistrySessionSummary[];
  subagents: RegistrySessionSummary[];
} {
  const roots: RegistrySessionSummary[] = [];
  const subagents: RegistrySessionSummary[] = [];
  for (const session of sessions) {
    if (session.sessionKind === 'subagent') {
      subagents.push(session);
    } else {
      roots.push(session);
    }
  }
  return { roots, subagents };
}

export function resolveActivatableSessionId(
  requestedSessionId: string,
  sessions: RegistrySessionSummary[],
): string {
  const requested = sessions.find(
    session => session.sessionId === requestedSessionId,
  );
  if (requested?.sessionKind === 'subagent') {
    return requested.rootSessionId ?? '';
  }
  return requested?.sessionId ?? requestedSessionId;
}

export function ChatSubagentsSurface({
  sessions,
  onOpen,
}: {
  sessions: RegistrySessionSummary[];
  onOpen: (session: RegistrySessionSummary) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const sortedSessions = React.useMemo(
    () => sortSubagentSessions(sessions),
    [sessions],
  );
  const surfaceRef = useChatEdgeSurfaceGeometry(
    'left',
    sortedSessions.length > 0,
  );
  const hoverReveal = useChatEdgeSurfaceHoverReveal(sortedSessions.length > 0);

  if (sortedSessions.length === 0) {
    return null;
  }

  return (
    <aside
      ref={surfaceRef}
      className={`chat-subagents-surface desktop ${
        collapsed ? 'collapsed' : 'expanded'
      }${hoverReveal.revealed ? ' chat-edge-surface-hover-revealed' : ''}`}
      aria-label="Subagents"
      onPointerEnter={hoverReveal.onPointerEnter}
      onPointerLeave={hoverReveal.onPointerLeave}
    >
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content">
        <ChatEdgeSurfaceHeader
          title="Subagents"
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(value => !value)}
          summary={
            collapsed
              ? sortedSessions
                  .map(session => session.subagent?.name ?? session.title)
                  .join(', ')
              : undefined
          }
          actions={
            <span className="chat-subagent-count">{sortedSessions.length}</span>
          }
        />
        {collapsed ? null : (
          <div className="chat-subagent-list">
            {sortedSessions.map(session => {
              const status = session.subagent?.status ?? 'initializing';
              const name =
                session.subagent?.name || session.title || 'Subagent';
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  className="chat-subagent-row"
                  onClick={() => onOpen(session)}
                  data-subagent-status={status}
                >
                  <span className="chat-subagent-state-rail" aria-hidden="true">
                    <span className="chat-subagent-state-dot" />
                  </span>
                  <span className="chat-subagent-name">{name}</span>
                  <span
                    className="chat-subagent-status"
                    data-subagent-status={status}
                  >
                    {statusLabels[status]}
                  </span>
                  <SessionIcon
                    name="chevronRight"
                    className="chat-subagent-chevron"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function ReadOnlyTranscript({
  messages,
  runtimeKey,
  scrollRef,
}: {
  messages: RegistryChatMessage[];
  runtimeKey: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const displayIndex = React.useMemo(
    () => buildChatDisplayIndex(messages, { collapseCompletedWork: true }),
    [messages],
  );

  const renderItem = (item: ChatDisplayIndexItem): React.ReactNode => {
    if (item.kind === 'work-group') {
      return (
        <ChatWorkGroup
          status={item.workStatus ?? 'worked'}
          durationMs={item.durationMs ?? 0}
        >
          {(item.childItems ?? []).map(child => (
            <div
              key={child.key}
              className={`chat-work-group-child${
                child.compact ? ' compact' : ''
              }`}
            >
              {renderItem(child)}
            </div>
          ))}
        </ChatWorkGroup>
      );
    }
    if (item.kind === 'tool-group') {
      const toolMessages = item.sourceIndexes
        .map(index => messages[index])
        .filter(
          (message): message is RegistryChatMessage =>
            !!message && message.method === 'tool_call',
        );
      return toolMessages.length > 0 ? (
        <div className="chat-view-content">
          <ChatToolCallGroup messages={toolMessages} active={false} />
        </div>
      ) : null;
    }
    const sourceMessage =
      item.kind === 'assistant-group'
        ? combineAssistantGroupMessages(
            item.sourceIndexes
              .map(index => messages[index])
              .filter((message): message is RegistryChatMessage => !!message),
          )
        : item.kind === 'turn'
        ? messages[item.sourceIndex]
        : undefined;
    return sourceMessage ? (
      <div className="chat-view-content">
        <ChatTurnView
          message={sourceMessage}
          markdownComponents={readOnlyMarkdownComponents}
          markdownUrlTransform={readOnlyUrlTransform}
          copyDisabled={false}
        />
      </div>
    ) : null;
  };

  return (
    <div className="chat-subagent-transcript">
      <ChatVirtuosoTurnList
        scrollRef={scrollRef}
        displayIndex={displayIndex}
        runtimeKey={`subagent:${runtimeKey}`}
        renderItem={item => renderItem(item)}
      />
    </div>
  );
}

export function ChatSubagentDialog({
  session,
  messages,
  loading,
  error,
  onClose,
}: {
  session: RegistrySessionSummary;
  messages: RegistryChatMessage[];
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const name = session.subagent?.name || session.title || 'Subagent';
  const status = session.subagent?.status ?? 'initializing';
  return (
    <div
      className="chat-subagent-dialog-overlay"
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="chat-subagent-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby="chat-subagent-dialog-title"
      >
        <header className="chat-subagent-dialog-header">
          <span
            className="chat-subagent-dialog-agent"
            data-subagent-status={status}
          >
            <span className="chat-subagent-state-dot" aria-hidden="true" />
            <span>
              <strong id="chat-subagent-dialog-title">{name}</strong>
              <small>{session.subagent?.role || statusLabels[status]}</small>
            </span>
          </span>
          <span className="chat-subagent-dialog-readonly">Read only</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="chat-subagent-dialog-close"
            onClick={onClose}
            aria-label="Close subagent details"
          >
            <SessionIcon name="x" />
          </button>
        </header>
        {session.subagent?.prompt ? (
          <div className="chat-subagent-dialog-prompt">
            {session.subagent.prompt}
          </div>
        ) : null}
        <div ref={bodyRef} className="chat-subagent-dialog-body">
          {loading ? (
            <div className="chat-subagent-dialog-state">
              Loading subagent activity…
            </div>
          ) : null}
          {!loading && error ? (
            <div className="chat-subagent-dialog-state error" role="alert">
              {error}
            </div>
          ) : null}
          {!loading && !error && messages.length === 0 ? (
            <div className="chat-subagent-dialog-state">
              No activity recorded yet.
            </div>
          ) : null}
          {!loading && !error && messages.length > 0 ? (
            <ReadOnlyTranscript
              messages={messages}
              runtimeKey={session.sessionId}
              scrollRef={bodyRef}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
