/** @jest-environment jsdom */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../code/markdownPreview', () => ({
  useMarkdownCapabilityPlugins: () => ({
    pending: false,
    remarkPlugins: [],
    rehypePlugins: [],
  }),
}));

import type {
  RegistryChatMessage,
  RegistrySessionSummary,
} from '../registry/registryTypes';
import {
  ChatSubagentDialog,
  ChatSubagentsSurface,
  partitionSubagentSessions,
  resolveActivatableSessionId,
} from './ChatSubagentsSurface';

const makeChild = (
  sessionId: string,
  name: string,
  spawnSequence: number,
  status: NonNullable<RegistrySessionSummary['subagent']>['status'],
): RegistrySessionSummary => ({
  sessionId,
  title: name,
  preview: '',
  updatedAt: '2026-08-19T10:00:00Z',
  messageCount: 1,
  sessionKind: 'subagent',
  parentSessionId: 'root-1',
  rootSessionId: 'root-1',
  readOnly: true,
  subagent: { name, spawnSequence, status },
});

describe('ChatSubagentsSurface', () => {
  it('separates child summaries and redirects stale child selection to its root', () => {
    const root: RegistrySessionSummary = {
      sessionId: 'root-1',
      title: 'Root',
      preview: '',
      updatedAt: '',
      messageCount: 0,
    };
    const child = makeChild('child-1', 'Zeno', 1, 'running');

    expect(partitionSubagentSessions([child, root])).toEqual({
      roots: [root],
      subagents: [child],
    });
    expect(resolveActivatableSessionId('child-1', [root, child])).toBe(
      'root-1',
    );
    expect(resolveActivatableSessionId('root-1', [root, child])).toBe('root-1');
  });

  it('renders descendants in stable spawn order and opens the selected child', async () => {
    const onOpen = jest.fn();
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatSubagentsSurface
          sessions={[
            makeChild('child-2', 'Dalton', 2, 'completed'),
            makeChild('child-1', 'Zeno', 1, 'running'),
          ]}
          onOpen={onOpen}
        />,
      );
    });

    const rows = tree!.root.findAllByProps({ className: 'chat-subagent-row' });
    expect(
      rows.map(
        row => row.findByProps({ className: 'chat-subagent-name' }).children[0],
      ),
    ).toEqual(['Zeno', 'Dalton']);
    expect(rows[0].props['data-subagent-status']).toBe('running');
    rows[0].props.onClick();
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'child-1' }),
    );
  });
});

describe('ChatSubagentDialog', () => {
  it('shows a read-only transcript and closes with Escape', async () => {
    const onClose = jest.fn();
    const messages: RegistryChatMessage[] = [
      {
        sessionId: 'child-1',
        turnIndex: 1,
        method: 'agent_message_chunk',
        param: { text: 'Child result' },
        finished: true,
      },
    ];
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatSubagentDialog
          session={makeChild('child-1', 'Zeno', 1, 'completed')}
          messages={messages}
          loading={false}
          error=""
          onClose={onClose}
        />,
      );
    });

    expect(tree!.root.findByProps({ role: 'dialog' }).props['aria-modal']).toBe(
      true,
    );
    expect(
      tree!.root.findByProps({ className: 'chat-subagent-dialog-readonly' })
        .children,
    ).toEqual(['Read only']);
    expect(
      tree!.root.findAllByProps({ className: 'chat-subagent-dialog-composer' }),
    ).toHaveLength(0);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
