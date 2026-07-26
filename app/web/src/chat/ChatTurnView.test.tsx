import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({children}: {children?: React.ReactNode}) => <>{children}</>,
}));
jest.mock('../code/markdownPreview', () => ({
  useMarkdownCapabilityPlugins: () => ({
    pending: false,
    remarkPlugins: [],
    rehypePlugins: [],
  }),
}));

import type {RegistryChatMessage} from '../registry/registryTypes';
import {ChatTurnView} from './ChatTurnView';

const markdownComponents = {};
const markdownUrlTransform = (value: string) => value;

function message(method: string, param: Record<string, unknown>): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex: method === 'prompt_done' ? 2 : 3,
    method,
    param,
    finished: true,
  };
}

async function renderTurn(
  value: RegistryChatMessage,
  extra?: Partial<React.ComponentProps<typeof ChatTurnView>>,
): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <ChatTurnView
        message={value}
        markdownComponents={markdownComponents}
        markdownUrlTransform={markdownUrlTransform}
        {...extra}
      />,
    );
  });
  return tree!;
}

describe('ChatTurnView session fork', () => {
  it('shows fork only for prompt_done with a forkPoint and invokes the action', async () => {
    const onForkPromptDone = jest.fn();
    const mapped = await renderTurn(
      message('prompt_done', {
        stopReason: 'end_turn',
        forkPoint: {provider: 'codex', ref: 'turn-1'},
      }),
      {onForkPromptDone},
    );
    const forkButton = mapped.root.findByProps({'aria-label': 'Fork session from here'});
    expect(forkButton.props.disabled).toBe(false);
    await act(async () => {
      forkButton.props.onClick();
    });
    expect(onForkPromptDone).toHaveBeenCalledTimes(1);

    const unmapped = await renderTurn(message('prompt_done', {stopReason: 'end_turn'}), {onForkPromptDone});
    expect(unmapped.root.findAllByProps({'aria-label': 'Fork session from here'})).toHaveLength(0);

    const readOnly = await renderTurn(message('prompt_done', {
      stopReason: 'end_turn',
      forkPoint: {provider: 'codex', ref: 'turn-1'},
    }));
    expect(readOnly.root.findAllByProps({'aria-label': 'Fork session from here'})).toHaveLength(0);
  });

  it('renders a non-clickable fork operation row', async () => {
    const tree = await renderTurn(message('session_operation', {
      operationId: 'fork-1',
      type: 'fork',
      status: 'completed',
      forkedFrom: {
        sessionId: 'source-session',
        turnIndex: 9,
        title: 'Source session',
      },
    }));
    expect(tree.root.findAllByType('button')).toHaveLength(0);
    expect(tree.root.findByProps({'data-icon-name': 'gitFork'})).toBeTruthy();
    const text = tree.root.findByProps({className: 'chat-session-operation-label'}).children.join('');
    expect(text).toContain('Forked from Source session');
  });
});
