import React from 'react';

import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';
import type {ChatPlanEntry, ChatPlanSnapshot} from './chatPlan';
import {useChatEdgeSurfaceGeometry} from './layout/chatEdgeSurfaceGeometry';

export type ChatPlanSurfaceProps = {
  plan: ChatPlanSnapshot | null;
  mode: 'desktop' | 'mobile';
};

function planStepClassName(entry: ChatPlanEntry): string {
  switch (entry.status) {
    case 'completed':
      return 'completed';
    case 'in_progress':
      return 'in-progress';
    default:
      return 'pending';
  }
}

function planStepIconClassName(entry: ChatPlanEntry): string {
  switch (entry.status) {
    case 'completed':
      return 'codicon-check';
    case 'in_progress':
      return 'codicon-arrow-right';
    default:
      return 'codicon-circle-outline';
  }
}

function renderPlanList(plan: ChatPlanSnapshot) {
  return (
    <ol className="chat-plan-surface-list">
      {plan.entries.map((entry, index) => (
        <li
          key={`${plan.turnIndex}:${index}:${entry.content}`}
          className={`chat-plan-step ${planStepClassName(entry)}`}
        >
          <span className={`codicon ${planStepIconClassName(entry)} chat-plan-step-marker`} aria-hidden="true" />
          <span className="chat-plan-step-content">{entry.content}</span>
        </li>
      ))}
    </ol>
  );
}

function compactChevronClassName(expanded: boolean, mode: 'desktop' | 'mobile'): string {
  if (mode === 'desktop') {
    return expanded ? 'codicon-chevron-up' : 'codicon-chevron-down';
  }
  return expanded ? 'codicon-chevron-down' : 'codicon-chevron-up';
}

function renderCompactTrigger({
  activeEntry,
  expanded,
  mode,
  onClick,
  progressLabel,
}: {
  activeEntry: ChatPlanEntry | null;
  expanded: boolean;
  mode: 'desktop' | 'mobile';
  onClick: () => void;
  progressLabel: string;
}) {
  return (
    <button
      type="button"
      className="chat-plan-compact-trigger"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse current plan' : 'Expand current plan'}
      title={expanded ? 'Collapse current plan' : 'Expand current plan'}
    >
      <span
        className={`codicon ${activeEntry ? planStepIconClassName(activeEntry) : 'codicon-checklist'} chat-plan-compact-marker`}
        aria-hidden="true"
      />
      <span className="chat-plan-progress">{progressLabel}</span>
      <span className="chat-plan-current">{activeEntry?.content ?? ''}</span>
      <span
        className={`codicon ${compactChevronClassName(expanded, mode)} chat-plan-compact-chevron`}
        aria-hidden="true"
      />
    </button>
  );
}

export const ChatPlanSurface = React.memo(function ChatPlanSurface({
  plan,
  mode,
}: ChatPlanSurfaceProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = React.useState(false);
  const desktopSurfaceRef = useChatEdgeSurfaceGeometry('left', mode === 'desktop' && !!plan);

  React.useEffect(() => {
    setExpanded(false);
    setDesktopCollapsed(false);
  }, [mode, plan?.turnIndex]);

  if (!plan) {
    return null;
  }

  const activeEntry = plan.activeEntry ?? plan.entries[plan.entries.length - 1] ?? null;
  const currentStep = plan.totalCount > 0
    ? Math.max(1, Math.min(plan.totalCount, plan.activeIndex + 1))
    : 0;
  const progressLabel = `${currentStep}/${plan.totalCount}`;

  if (mode === 'desktop') {
    return (
      <aside
        ref={desktopSurfaceRef}
        className={`chat-plan-surface desktop ${desktopCollapsed ? 'collapsed' : 'expanded'}`}
        aria-label="Current plan"
      >
        <div className="chat-edge-surface-glass" aria-hidden="true" />
        <div className="chat-edge-surface-content">
          <ChatEdgeSurfaceHeader
            title="Plan"
            collapsed={desktopCollapsed}
            onToggleCollapsed={() => setDesktopCollapsed(value => !value)}
            summary={desktopCollapsed ? activeEntry?.content : undefined}
            actions={<span className="chat-plan-progress">{progressLabel}</span>}
          />
          {desktopCollapsed ? null : renderPlanList(plan)}
        </div>
      </aside>
    );
  }

  return (
    <div className={`chat-plan-surface mobile${expanded ? ' expanded' : ''}`}>
      {renderCompactTrigger({
        activeEntry,
        expanded,
        mode,
        onClick: () => setExpanded(value => !value),
        progressLabel,
      })}
      {expanded ? renderPlanList(plan) : null}
    </div>
  );
});
