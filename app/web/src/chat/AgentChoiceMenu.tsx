import React, {useState} from 'react';

import {buildAgentChoiceNodes, type AgentChoiceNode} from './projectAgents';

export type AgentChoiceMenuProps = {
  agents: string[];
  variant: 'wide' | 'mobile';
  onSelect: (agentType: string) => void;
};

function renderAgentButton(
  node: Extract<AgentChoiceNode, {kind: 'agent'}>,
  onSelect: (agentType: string) => void,
) {
  return (
    <button
      key={node.agentType}
      type="button"
      className="agent-choice-item"
      onClick={() => onSelect(node.agentType)}
    >
      <span>{node.label}</span>
    </button>
  );
}

export function AgentChoiceMenu({agents, variant, onSelect}: AgentChoiceMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const nodes = buildAgentChoiceNodes(agents);

  return (
    <div className={`agent-choice-menu ${variant}`}>
      {nodes.map(node => {
        if (node.kind === 'agent') {
          return renderAgentButton(node, onSelect);
        }

        return (
          <React.Fragment key={node.agentType}>
            <div className="agent-choice-row">
              <button type="button" className="agent-choice-main" onClick={() => onSelect(node.agentType)}>
                <span>{node.label}</span>
              </button>
              <button
                type="button"
                className="agent-choice-expand"
                aria-label={expanded ? 'Collapse Claude agents' : 'Expand Claude agents'}
                aria-expanded={expanded}
                onClick={() => setExpanded(value => !value)}
              >
                <span
                  className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`}
                  aria-hidden="true"
                />
              </button>
            </div>
            {expanded ? (
              <div className="agent-choice-children">
                {node.children.map(child => (
                  <button
                    key={child.agentType}
                    type="button"
                    className="agent-choice-child"
                    onClick={() => onSelect(child.agentType)}
                  >
                    <span>{child.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
