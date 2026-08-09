import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {AgentTag} from './AgentTag';

test('renders a lower-case shared agent capsule from its agent type', async () => {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<AgentTag agentType="Claude" tooltip="Claude skill directory" />);
  });

  const tag = tree!.root.findByProps({className: 'wide-session-agent-tag wide-session-agent-2'});
  expect(tag.children).toEqual(['claude']);
  expect(tag.props['data-tooltip']).toBe('Claude skill directory');
});
