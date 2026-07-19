import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatSessionPanel} from './ChatSessionPanel';

describe('ChatSessionPanel', () => {
  it('uses one titled, scrollable panel frame for the slide-out session navigation', async () => {
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatSessionPanel
          mode="slideout"
          title="Sessions"
          header={<button type="button">Pin</button>}
        >
          <div>All sessions</div>
        </ChatSessionPanel>,
      );
    });

    expect(tree!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Sessions']);
    expect(tree!.root.findByProps({className: 'chat-session-panel-scroll'}).children).toHaveLength(1);
    expect(tree!.root.findByProps({className: 'chat-session-panel chat-session-panel-slideout'})).toBeDefined();
  });

  it('keeps pointer-leave handling on the shared frame', async () => {
    const onPointerLeave = jest.fn();
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatSessionPanel
          mode="pinned"
          title="Sessions"
          onPointerLeave={onPointerLeave}
        >
          <div>All sessions</div>
        </ChatSessionPanel>,
      );
    });

    tree!.root.findByProps({className: 'chat-session-panel chat-session-panel-pinned'}).props.onPointerLeave();
    expect(onPointerLeave).toHaveBeenCalledTimes(1);
  });

  it('forwards scroll events through the shared scroll container', async () => {
    const onScroll = jest.fn();
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatSessionPanel mode="slideout" title="Sessions" onScroll={onScroll}>
          <div>All sessions</div>
        </ChatSessionPanel>,
      );
    });

    tree!.root.findByProps({className: 'chat-session-panel-scroll'}).props.onScroll({currentTarget: {scrollTop: 240}});
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it('forwards list pointer handling through the shared scroll container', async () => {
    const onPointerDown = jest.fn();
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ChatSessionPanel
          mode="slideout"
          title="Sessions"
          scrollProps={{onPointerDown}}
        >
          <div>All sessions</div>
        </ChatSessionPanel>,
      );
    });

    tree!.root.findByProps({className: 'chat-session-panel-scroll'}).props.onPointerDown();
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
