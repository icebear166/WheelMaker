import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionRow} from './SessionRow';

const gesture = {
  onPointerDown: () => undefined,
  onPointerUp: () => undefined,
  onPointerCancel: () => undefined,
  onPointerLeave: () => undefined,
  onContextMenu: () => undefined,
};

async function renderRow(extra?: Partial<React.ComponentProps<typeof SessionRow>>) {
  let tree: ReactTestRenderer | undefined;
  const onClick = jest.fn();
  const onUnpin = jest.fn();
  await act(async () => {
    tree = create(
      <SessionRow
        title="Fix login bug"
        agentLabel="cc · kimi"
        agentClassName="wide-session-agent variant-1"
        timeLabel="3m"
        timeTitle="2026-07-24"
        selected={false}
        pinned={false}
        gestureHandlers={gesture}
        onClick={onClick}
        onUnpin={onUnpin}
        {...extra}
      />,
    );
  });
  return {tree: () => tree!, onClick, onUnpin};
}

describe('SessionRow', () => {
  it('renders title, agent pill and time with the legacy classes', async () => {
    const {tree} = await renderRow();
    expect(tree().root.findByProps({className: 'wide-session-title'}).children).toEqual(['Fix login bug']);
    expect(tree().root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('wide-session-agent-tag'))).toHaveLength(1);
    expect(tree().root.findByProps({className: 'wide-session-time'}).children).toEqual(['3m']);
  });

  it('shows time when unpinned and an svg pin button when pinned', async () => {
    const unpinned = await renderRow();
    expect(unpinned.tree().root.findAllByProps({className: 'wide-session-time'})).toHaveLength(1);

    const pinned = await renderRow({pinned: true});
    expect(pinned.tree().root.findAllByProps({className: 'wide-session-time'})).toHaveLength(0);
    const pinBtn = pinned.tree().root.findByProps({className: 'wide-session-pin-btn'});
    expect(pinBtn.findAllByType('svg')).toHaveLength(1);
  });

  it('fires onUnpin from the pin button without triggering row click', async () => {
    const {tree, onClick, onUnpin} = await renderRow({pinned: true});
    const pinBtn = tree().root.findByProps({className: 'wide-session-pin-btn'});
    const stopEvent = {preventDefault: jest.fn(), stopPropagation: jest.fn()};
    await act(async () => {
      pinBtn.props.onClick(stopEvent);
    });
    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks selected rows', async () => {
    const {tree} = await renderRow({selected: true});
    const row = tree().root.findAllByType('button').find(b => b.props.className.includes('wide-session-row'))!;
    expect(row.props.className).toContain('selected');
  });
});
