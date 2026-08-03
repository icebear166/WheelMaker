import React from 'react';

import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';
import type {ChatPlanEntry, ChatPlanSnapshot} from './chatPlan';
import {useChatEdgeSurfaceGeometry} from './layout/chatEdgeSurfaceGeometry';
import {useChatEdgeSurfaceHoverReveal} from './layout/chatEdgeSurfaceHoverReveal';
import {SessionIcon} from './sessionlist/SessionIcon';

export const PLAN_SEGMENT_TRACK_MAX_STEPS = 12;

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

function planStepIconName(entry: ChatPlanEntry): 'check' | 'arrowRight' | 'circle' {
  switch (entry.status) {
    case 'completed':
      return 'check';
    case 'in_progress':
      return 'arrowRight';
    default:
      return 'circle';
  }
}

function PlanProgressTrack({plan}: {plan: ChatPlanSnapshot}) {
  if (plan.totalCount <= 0) {
    return null;
  }
  if (plan.totalCount > PLAN_SEGMENT_TRACK_MAX_STEPS) {
    const percent = Math.round((plan.completedCount / plan.totalCount) * 100);
    const active = plan.completedCount < plan.totalCount;
    return (
      <span className={`chat-plan-progress-track continuous${active ? ' active' : ''}`} aria-hidden="true">
        <span className="chat-plan-progress-track-fill" style={{width: `${percent}%`}} />
      </span>
    );
  }
  return (
    <span className="chat-plan-progress-track segmented" aria-hidden="true">
      {plan.entries.map((entry, index) => (
        <span
          key={`${plan.turnIndex}:${index}`}
          className={`chat-plan-progress-segment ${planStepClassName(entry)}`}
        />
      ))}
    </span>
  );
}

function renderPlanList(plan: ChatPlanSnapshot) {
  return (
    <ol className="chat-plan-surface-list">
      {plan.entries.map((entry, index) => (
        <li
          key={`${plan.turnIndex}:${index}:${entry.content}`}
          className={`chat-plan-step ${planStepClassName(entry)}`}
        >
          <SessionIcon name={planStepIconName(entry)} className="chat-plan-step-marker" />
          <span className="chat-plan-step-content">{entry.content}</span>
        </li>
      ))}
    </ol>
  );
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
      data-tooltip={expanded ? 'Collapse current plan' : 'Expand current plan'}
    >
      <SessionIcon
        name={activeEntry ? planStepIconName(activeEntry) : 'listChecks'}
        className={`chat-plan-compact-marker${activeEntry ? ` ${planStepClassName(activeEntry)}` : ''}`}
      />
      <span className="chat-plan-progress">{progressLabel}</span>
      <span className="chat-plan-current">{activeEntry?.content ?? ''}</span>
      <SessionIcon
        name={mode === 'desktop' ? (expanded ? 'chevronUp' : 'chevronDown') : (expanded ? 'chevronDown' : 'chevronUp')}
        className="chat-plan-compact-chevron"
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
  const hoverReveal = useChatEdgeSurfaceHoverReveal(mode === 'desktop' && !!plan);

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
        className={`chat-plan-surface desktop ${desktopCollapsed ? 'collapsed' : 'expanded'}${hoverReveal.revealed ? ' chat-edge-surface-hover-revealed' : ''}`}
        aria-label="Current plan"
        onPointerEnter={hoverReveal.onPointerEnter}
        onPointerLeave={hoverReveal.onPointerLeave}
      >
        <div className="chat-edge-surface-glass" aria-hidden="true" />
        <div className="chat-edge-surface-content">
          <ChatEdgeSurfaceHeader
            title="Plan"
            collapsed={desktopCollapsed}
            onToggleCollapsed={() => setDesktopCollapsed(value => !value)}
            summary={desktopCollapsed ? activeEntry?.content : undefined}
            actions={
              <span className="chat-plan-header-progress">
                <PlanProgressTrack plan={plan} />
                <span className="chat-plan-progress">{progressLabel}</span>
              </span>
            }
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
