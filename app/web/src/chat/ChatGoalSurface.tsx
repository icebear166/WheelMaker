import React from 'react';

import type {RegistrySessionGoal} from '../registry/registryTypes';
import {Icon, type IconName} from '../common/Icon';
import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';
import {
  canResumeGoal,
  formatGoalElapsed,
  formatGoalTokens,
  goalStatusLabel,
  goalStatusTone,
} from './chatGoal';
import {useChatEdgeSurfaceGeometry} from './layout/chatEdgeSurfaceGeometry';
import {useChatEdgeSurfaceHoverReveal} from './layout/chatEdgeSurfaceHoverReveal';

export type ChatGoalSurfaceProps = {
  goal: RegistrySessionGoal;
  mode: 'desktop' | 'mobile';
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onClear: () => void;
};

function GoalAction({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      className={`chat-goal-action${destructive ? ' destructive' : ''}`}
      aria-label={label}
      data-tooltip={label}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function GoalPrimaryAction({
  goal,
  onPause,
  onResume,
}: Pick<ChatGoalSurfaceProps, 'goal' | 'onPause' | 'onResume'>) {
  if (goal.status === 'active') {
    return <GoalAction icon="pause" label="Pause goal" onClick={onPause} />;
  }
  if (canResumeGoal(goal.status)) {
    return <GoalAction icon="play" label="Resume goal" onClick={onResume} />;
  }
  return null;
}

function GoalStatus({goal}: {goal: RegistrySessionGoal}) {
  return (
    <span className={`chat-goal-status ${goalStatusTone(goal.status)}`}>
      <span className="chat-goal-status-dot" aria-hidden="true" />
      <span>{goalStatusLabel(goal.status)}</span>
    </span>
  );
}

function GoalDetails({goal}: {goal: RegistrySessionGoal}) {
  return (
    <div className="chat-goal-details">
      <div className="chat-goal-objective">
        <Icon name="target" size={16} />
        <span>{goal.objective}</span>
      </div>
      <div className="chat-goal-stats">
        <GoalStatus goal={goal} />
        <span className="chat-goal-stat">
          <span className="chat-goal-stat-label">Tokens</span>
          <span>{formatGoalTokens(goal.tokensUsed)}</span>
        </span>
        <span className="chat-goal-stat">
          <span className="chat-goal-stat-label">Budget</span>
          <span className="chat-goal-budget-value">
            {goal.tokenBudget === null ? 'Unlimited' : formatGoalTokens(goal.tokenBudget)}
          </span>
        </span>
        <span className="chat-goal-stat">
          <span className="chat-goal-stat-label">Elapsed</span>
          <span>{formatGoalElapsed(goal.timeUsedSeconds)}</span>
        </span>
      </div>
    </div>
  );
}

function GoalActions({
  goal,
  onPause,
  onResume,
  onEdit,
  onClear,
  includeSecondary = true,
}: ChatGoalSurfaceProps & {includeSecondary?: boolean}) {
  return (
    <>
      <GoalPrimaryAction goal={goal} onPause={onPause} onResume={onResume} />
      {includeSecondary ? <GoalAction icon="pencil" label="Edit goal" onClick={onEdit} /> : null}
      {includeSecondary ? <GoalAction icon="trash" label="Clear goal" onClick={onClear} destructive /> : null}
    </>
  );
}

export const ChatGoalSurface = React.memo(function ChatGoalSurface({
  goal,
  mode,
  onPause,
  onResume,
  onEdit,
  onClear,
}: ChatGoalSurfaceProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = React.useState(false);
  const desktopSurfaceRef = useChatEdgeSurfaceGeometry('left', mode === 'desktop');
  const hoverReveal = useChatEdgeSurfaceHoverReveal(mode === 'desktop');

  React.useEffect(() => {
    setExpanded(false);
    setDesktopCollapsed(false);
  }, [goal.sessionId, mode]);

  if (mode === 'desktop') {
    return (
      <aside
        ref={desktopSurfaceRef}
        className={`chat-goal-surface desktop ${desktopCollapsed ? 'collapsed' : 'expanded'}${hoverReveal.revealed ? ' chat-edge-surface-hover-revealed' : ''}`}
        aria-label="Session goal"
        onPointerEnter={hoverReveal.onPointerEnter}
        onPointerLeave={hoverReveal.onPointerLeave}
      >
        <div className="chat-edge-surface-glass" aria-hidden="true" />
        <div className="chat-edge-surface-content">
          <ChatEdgeSurfaceHeader
            title="Goal"
            collapsed={desktopCollapsed}
            onToggleCollapsed={() => setDesktopCollapsed(value => !value)}
            summary={desktopCollapsed ? goal.objective : undefined}
            actions={(
              <GoalActions
                goal={goal}
                mode={mode}
                onPause={onPause}
                onResume={onResume}
                onEdit={onEdit}
                onClear={onClear}
              />
            )}
          />
          {desktopCollapsed ? null : <GoalDetails goal={goal} />}
        </div>
      </aside>
    );
  }

  return (
    <div className={`chat-goal-surface mobile${expanded ? ' expanded' : ''}`} aria-label="Session goal">
      <div className="chat-goal-mobile-row">
        <button
          type="button"
          className="chat-goal-compact-trigger"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse goal details' : 'Expand goal details'}
          data-tooltip={expanded ? 'Collapse goal details' : 'Expand goal details'}
          onClick={() => setExpanded(value => !value)}
        >
          <Icon name="target" size={16} />
          <GoalStatus goal={goal} />
          <span className="chat-goal-compact-objective">{goal.objective}</span>
          <Icon name={expanded ? 'chevronDown' : 'chevronUp'} size={14} />
        </button>
        <span className="chat-goal-mobile-primary">
          <GoalActions
            goal={goal}
            mode={mode}
            onPause={onPause}
            onResume={onResume}
            onEdit={onEdit}
            onClear={onClear}
            includeSecondary={false}
          />
        </span>
      </div>
      {expanded ? (
        <>
          <GoalDetails goal={goal} />
          <div className="chat-goal-mobile-secondary">
            <GoalAction icon="pencil" label="Edit goal" onClick={onEdit} />
            <GoalAction icon="trash" label="Clear goal" onClick={onClear} destructive />
          </div>
        </>
      ) : null}
    </div>
  );
});
