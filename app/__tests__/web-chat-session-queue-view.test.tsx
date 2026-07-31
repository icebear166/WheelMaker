import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({children}: {children?: React.ReactNode}) => <>{children}</>,
}));
jest.mock('../web/src/code/markdownPreview', () => ({
  useMarkdownCapabilityPlugins: () => ({
    pending: false,
    remarkPlugins: [],
    rehypePlugins: [],
  }),
}));

import {
  ChatQueueCompactView,
  ChatTurnView,
  type ChatQueueActions,
} from '../web/src/chat/ChatTurnView';
import type {
  RegistryChatMessage,
  RegistrySessionQueueItem,
  RegistrySessionQueueItemStatus,
} from '../web/src/registry/registryTypes';

const markdownComponents = {};
const markdownUrlTransform = (value: string) => value;

function promptMessage(): RegistryChatMessage {
  return {
    sessionId: 'session-1',
    turnIndex: 2,
    method: 'prompt_request',
    param: {contentBlocks: [{type: 'text', text: 'queued prompt'}]},
    finished: false,
  };
}

function compactItem(
  status: RegistrySessionQueueItemStatus,
  overrides: Partial<RegistrySessionQueueItem> = {},
): RegistrySessionQueueItem & {kind: 'compact'} {
  return {
    itemId: 'compact-1',
    kind: 'compact',
    createdAt: '2026-07-31T00:00:00Z',
    status,
    cancelSupported: status !== 'running',
    ...overrides,
  } as RegistrySessionQueueItem & {kind: 'compact'};
}

function buttonLabels(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('button')
    .map(button => String(button.props['aria-label'] ?? ''))
    .filter(Boolean);
}

async function renderPrompt(
  status: RegistrySessionQueueItemStatus,
  queueActions: ChatQueueActions,
  error = '',
) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <ChatTurnView
        message={promptMessage()}
        queueItemStatus={status}
        queueItemError={error}
        queueActions={queueActions}
        markdownComponents={markdownComponents}
        markdownUrlTransform={markdownUrlTransform}
      />,
    );
  });
  return renderer!;
}

describe('authoritative session queue views', () => {
  test('queued prompt exposes cancel, prioritize, and steer', async () => {
    const renderer = await renderPrompt('queued', {
      cancel: jest.fn(),
      prioritize: jest.fn(),
      steer: jest.fn(),
    });

    expect(buttonLabels(renderer)).toEqual(['Steer', 'Prioritize', 'Cancel']);
  });

  test('steering prompt keeps only cancel available', async () => {
    const renderer = await renderPrompt('steering', {
      cancel: jest.fn(),
      prioritize: jest.fn(),
      steer: jest.fn(),
    });

    expect(buttonLabels(renderer)).toEqual(['Cancel']);
  });

  test('failed prompt shows the server error and retry/cancel', async () => {
    const renderer = await renderPrompt(
      'failed',
      {retry: jest.fn(), cancel: jest.fn()},
      'provider failed',
    );

    expect(buttonLabels(renderer)).toEqual(['Retry', 'Cancel']);
    expect(renderer.root.findByProps({role: 'alert'}).children).toContain('provider failed');
  });

  test('cancelling prompt has no second action', async () => {
    const renderer = await renderPrompt('cancelling', {cancel: jest.fn()});

    expect(buttonLabels(renderer)).toEqual([]);
  });

  test('waiting compact supports prioritize/cancel while running compact is read-only', async () => {
    let queued: ReactTestRenderer.ReactTestRenderer | undefined;
    let running: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      queued = ReactTestRenderer.create(
        <ChatQueueCompactView
          item={compactItem('queued')}
          actions={{prioritize: jest.fn(), cancel: jest.fn()}}
        />,
      );
      running = ReactTestRenderer.create(
        <ChatQueueCompactView
          item={compactItem('running')}
          actions={{}}
        />,
      );
    });

    expect(buttonLabels(queued!)).toEqual(['Prioritize', 'Cancel']);
    expect(buttonLabels(running!)).toEqual([]);
    expect(
      running!.root.findByProps({className: 'chat-session-operation-label'}).children,
    ).toContain('Compressing context');
  });
});
