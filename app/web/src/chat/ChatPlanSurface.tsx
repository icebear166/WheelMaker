import React from 'react';

import type {ChatPlanEntry, ChatPlanSnapshot} from './chatPlan';

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

export const ChatPlanSurface = React.memo(function ChatPlanSurface({
  plan,
  mode,
}: ChatPlanSurfaceProps) {
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    setExpanded(false);
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
      <aside className="chat-plan-surface desktop" aria-label="Current plan">
        <div className="chat-plan-surface-header">
          <span className="codicon codicon-checklist" aria-hidden="true" />
          <span className="chat-plan-surface-title">Plan</span>
          <span className="chat-plan-progress">{progressLabel}</span>
        </div>
        {renderPlanList(plan)}
      </aside>
    );
  }

  return (
    <div className={`chat-plan-surface mobile${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="chat-plan-compact-trigger"
        onClick={() => setExpanded(value => !value)}
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
          className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-up'} chat-plan-compact-chevron`}
          aria-hidden="true"
        />
      </button>
      {expanded ? renderPlanList(plan) : null}
    </div>
  );
});
