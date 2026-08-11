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
      {onForkPromptDone, forkSupported: true},
    );
    const forkButton = mapped.root.findByProps({'aria-label': 'Fork session from here'});
    expect(forkButton.props.disabled).toBe(false);
    expect(forkButton.findByProps({'data-icon-name': 'gitBranch'})).toBeTruthy();
    await act(async () => {
      forkButton.props.onClick();
    });
    expect(onForkPromptDone).toHaveBeenCalledTimes(1);
    expect(onForkPromptDone).toHaveBeenCalledWith('historical');

    const unmapped = await renderTurn(message('prompt_done', {stopReason: 'end_turn'}), {onForkPromptDone});
    expect(unmapped.root.findAllByProps({'aria-label': 'Fork session from here'})).toHaveLength(0);

    const unsupported = await renderTurn(message('prompt_done', {
      stopReason: 'end_turn',
      forkPoint: {provider: 'codex', ref: 'turn-1'},
    }), {onForkPromptDone, forkSupported: false});
    expect(unsupported.root.findAllByProps({'aria-label': 'Fork session from here'})).toHaveLength(0);

    const readOnly = await renderTurn(message('prompt_done', {
      stopReason: 'end_turn',
      forkPoint: {provider: 'codex', ref: 'turn-1'},
    }));
    expect(readOnly.root.findAllByProps({'aria-label': 'Fork session from here'})).toHaveLength(0);
  });

  it('shows a current-session fork without requiring a forkPoint when enabled by the caller', async () => {
    const onForkPromptDone = jest.fn();
    const tree = await renderTurn(
      message('prompt_done', {stopReason: 'end_turn'}),
      {onForkPromptDone, forkCurrentSessionSupported: true},
    );

    const forkButton = tree.root.findByProps({'aria-label': 'Fork session from here'});
    await act(async () => {
      forkButton.props.onClick();
    });

    expect(onForkPromptDone).toHaveBeenCalledWith('current');
  });

  it('prefers historical fork when both fork modes are available', async () => {
    const onForkPromptDone = jest.fn();
    const tree = await renderTurn(
      message('prompt_done', {
        stopReason: 'end_turn',
        forkPoint: {provider: 'codex', ref: 'turn-1'},
      }),
      {onForkPromptDone, forkSupported: true, forkCurrentSessionSupported: true},
    );

    const forkButton = tree.root.findByProps({'aria-label': 'Fork session from here'});
    await act(async () => {
      forkButton.props.onClick();
    });

    expect(onForkPromptDone).toHaveBeenCalledWith('historical');
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
    expect(tree.root.findByProps({'data-icon-name': 'gitBranch'})).toBeTruthy();
    const text = tree.root.findByProps({className: 'chat-session-operation-label'}).children.join('');
    expect(text).toContain('Forked from Source session');
  });
});

describe('ChatTurnView failed prompt retry', () => {
  it('offers retry from the terminal transcript turn', async () => {
    const onRetryFailedPrompt = jest.fn();
    const tree = await renderTurn(message('prompt_done', {
      stopReason: 'failed',
      message: 'provider failed',
    }), {onRetryFailedPrompt});

    const retryButton = tree.root.findByProps({'aria-label': 'Retry failed prompt'});
    await act(async () => retryButton.props.onClick());
    expect(onRetryFailedPrompt).toHaveBeenCalledTimes(1);
  });
});

describe('ChatTurnView sharing actions', () => {
  it('keeps Copy, replaces image/HTML buttons with Share, and forwards the terminal turn', async () => {
    const onSharePromptDone = jest.fn();
    const tree = await renderTurn(message('prompt_done', {stopReason: 'end_turn'}), {
      copyDisabled: false,
      readAloudEnabled: true,
      onReadAloud: jest.fn(),
      shareMenuMode: 'popover',
      shareResponseDisabled: false,
      shareSessionDisabled: false,
      onSharePromptDone,
    });

    expect(tree.root.findByProps({'aria-label': 'Copy response markdown'})).toBeTruthy();
    expect(tree.root.findByProps({'aria-label': 'Read response aloud'})).toBeTruthy();
    expect(tree.root.findAllByProps({'aria-label': 'Export response markdown image'})).toHaveLength(0);
    expect(tree.root.findAllByProps({'aria-label': 'Export response markdown as HTML'})).toHaveLength(0);
    const trigger = tree.root.findByProps({'aria-label': 'Share response or session'});
    expect(trigger.findByProps({'data-icon-name': 'share2'})).toBeTruthy();

    await act(async () => trigger.props.onClick());
    const action = tree.root.findByProps({'aria-label': 'Share current response as image'});
    await act(async () => action.props.onClick());

    expect(onSharePromptDone).toHaveBeenCalledWith(2, {
      scope: 'response',
      format: 'image',
      includeWorkDetails: false,
    });
  });
});

describe('ChatTurnView option replies', () => {
  const optionText = [
    'Pick one:',
    '',
    'A. Apply the change',
    'B. Keep the current behavior',
  ].join('\n');

  it('renders historical option-looking text as ordinary markdown', async () => {
    const tree = await renderTurn(message('agent_message_chunk', {text: optionText}));

    expect(tree.root.findAllByProps({className: 'chat-option-reply-static'})).toHaveLength(0);
    expect(tree.root.findAllByProps({className: 'chat-option-reply-inline-button'})).toHaveLength(0);
  });
});

describe('ChatTurnView Changed Files interactions', () => {
  it('keeps left-click diff behavior and forwards only file-row context menus', async () => {
    const onOpenPromptArtifact = jest.fn();
    const onOpenPromptArtifactFileContextMenu = jest.fn();
    const value = message('prompt_done', {
      artifacts: [{
        artifactId: 'artifact-1',
        type: 'diff',
        format: 'unified-diff',
        fileCount: 1,
        files: [{
          path: 'src/main.ts',
          status: 'M',
          additions: 4,
          deletions: 1,
        }],
      }],
    });
    const tree = await renderTurn(value, {
      onOpenPromptArtifact,
      onOpenPromptArtifactFileContextMenu,
    });

    const summary = tree.root.findByProps({className: 'chat-prompt-artifact-summary'});
    const fileRow = tree.root.findByProps({className: 'chat-prompt-artifact-file'});
    const contextEvent = {
      clientX: 32,
      clientY: 48,
      preventDefault: jest.fn(),
    };

    await act(async () => fileRow.props.onClick());
    expect(onOpenPromptArtifact).toHaveBeenCalledWith(
      expect.objectContaining({artifactId: 'artifact-1'}),
      value,
      'src/main.ts',
    );

    await act(async () => fileRow.props.onContextMenu(contextEvent));
    expect(onOpenPromptArtifactFileContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({artifactId: 'artifact-1'}),
      value,
      expect.objectContaining({path: 'src/main.ts', status: 'M'}),
      {x: 32, y: 48},
    );
    expect(contextEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(summary.props.onContextMenu).toBeUndefined();
  });
});

describe('ChatTurnView attachment interactions', () => {
  it('opens the shared context menu for a persisted attachment', async () => {
    const onOpenPromptAttachmentContextMenu = jest.fn();
    const value = message('user_message_chunk', {
      contentBlocks: [{
        type: 'resource_link',
        uri: 'file:///attachments/sha256-abc/report.pdf',
        name: 'report.pdf',
        mimeType: 'application/pdf',
      }],
    });
    const tree = await renderTurn(value, {onOpenPromptAttachmentContextMenu});
    const chip = tree.root.findByProps({className: 'chat-prompt-attachment-chip file'});
    const event = {clientX: 15, clientY: 21, preventDefault: jest.fn()};

    await act(async () => chip.props.onContextMenu(event));

    expect(onOpenPromptAttachmentContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({name: 'report.pdf'}),
      value,
      {x: 15, y: 21},
    );
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does not install attachment context handlers without an eligible callback', async () => {
    const tree = await renderTurn(message('user_message_chunk', {
      contentBlocks: [{type: 'resource_link', uri: 'file:///draft.txt', name: 'draft.txt'}],
    }));
    expect(tree.root.findByProps({className: 'chat-prompt-attachment-chip file'}).props.onContextMenu)
      .toBeUndefined();
  });
});
