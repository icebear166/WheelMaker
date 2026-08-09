import React from 'react';

import {agentTagVariantClass} from './agentTagVariant';
import {agentDisplayLabel} from './projectAgents';

export type AgentTagProps = {
  agentType?: string | null;
  tooltip?: string;
};

export function AgentTag({agentType, tooltip}: AgentTagProps) {
  const normalized = (agentType || '').trim();
  if (!normalized) {
    return null;
  }
  return (
    <span
      className={`wide-session-agent-tag ${agentTagVariantClass(normalized)}`}
      data-tooltip={tooltip}
    >
      {agentDisplayLabel(normalized)}
    </span>
  );
}
