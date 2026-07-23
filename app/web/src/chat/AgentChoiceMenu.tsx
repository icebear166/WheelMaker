import React, {useEffect, useRef, useState} from 'react';

import {agentTagVariantClass} from './agentTagVariant';
import {buildAgentChoiceNodes} from './projectAgents';

export type AgentChoiceMenuProps = {
  agents: string[];
  /** When provided, this agent sorts first (pure ordering, no visual distinction). */
  defaultAgent?: string;
  variant: 'wide' | 'mobile';
  onSelect: (agentType: string) => void;
  onClose?: () => void;
};

export function AgentChoiceMenu({agents, defaultAgent, variant, onSelect, onClose}: AgentChoiceMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const pills = buildAgentChoiceNodes(agents);
  // Default agent sorts first; everything else keeps its reported order.
  const sortedPills = defaultAgent
    ? [...pills].sort((a, b) => {
        const key = defaultAgent.toLowerCase();
        const aDefault = a.agentType.toLowerCase() === key;
        const bDefault = b.agentType.toLowerCase() === key;
        if (aDefault === bDefault) {
          return 0;
        }
        return aDefault ? -1 : 1;
      })
    : pills;

  const safeActiveIndex = sortedPills.length === 0 ? 0 : Math.min(activeIndex, sortedPills.length - 1);

  // Reset to the first pill and move focus into the listbox whenever the agent
  // set actually changes (by content, not array identity).
  const agentsKey = agents.join('|');
  useEffect(() => {
    setActiveIndex(0);
    containerRef.current?.focus();
  }, [agentsKey]);

  // Keep the active pill in view while navigating by keyboard.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const activePill = container.children[safeActiveIndex] as HTMLElement | undefined;
    activePill?.scrollIntoView({block: 'nearest'});
  }, [safeActiveIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const count = sortedPills.length;
    if (count === 0) {
      return;
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onClose?.();
        return;
      case 'Enter':
        event.preventDefault();
        onSelect(sortedPills[safeActiveIndex].agentType);
        return;
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        setActiveIndex(prev => (prev + 1) % count);
        return;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        setActiveIndex(prev => (prev - 1 + count) % count);
        return;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        event.preventDefault();
        setActiveIndex(count - 1);
        return;
      default:
        return;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`agent-choice-menu ${variant}`}
      role="listbox"
      aria-label="Select agent"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {sortedPills.map((pill, index) => {
        const isActive = index === safeActiveIndex;
        return (
          <button
            key={pill.agentType}
            type="button"
            className={`agent-choice-pill${isActive ? ' active' : ''}`}
            role="option"
            aria-selected={isActive}
            onClick={() => onSelect(pill.agentType)}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <span
              className={`agent-choice-pill-dot ${agentTagVariantClass(pill.agentType)}`}
              aria-hidden="true"
            />
            <span>{pill.label}</span>
          </button>
        );
      })}
    </div>
  );
}
