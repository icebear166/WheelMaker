import React from 'react';
import {act, create, type ReactTestInstance, type ReactTestRenderer} from 'react-test-renderer';
import {SessionRow} from './SessionRow';

const gesture = {
  'data-context-menu-target': 'true' as const,
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
        agentType="cc-kimi"
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
    expect(tree().root.findByProps({className: 'wide-session-time compact-age'}).children).toEqual(['3m']);
  });

  it('shows time when unpinned and an svg pin button when pinned', async () => {
    const unpinned = await renderRow();
    expect(unpinned.tree().root.findAllByProps({className: 'wide-session-time compact-age'})).toHaveLength(1);

    const pinned = await renderRow({pinned: true});
    expect(pinned.tree().root.findAllByProps({className: 'wide-session-time compact-age'})).toHaveLength(0);
    const pinBtn = pinned.tree().root.findByProps({className: 'wide-session-pin-btn'});
    expect(pinBtn.findAllByType('svg')).toHaveLength(1);
  });

  it('shows a noninteractive pin indicator when unpin is unavailable', async () => {
    const {tree} = await renderRow({pinned: true, onUnpin: undefined});

    expect(tree().root.findByProps({className: 'wide-session-pin-indicator'}).findAllByType('svg')).toHaveLength(1);
    expect(tree().root.findAllByProps({className: 'wide-session-pin-btn'})).toHaveLength(0);
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

  it('suppresses the Unpin action after a touch hold', async () => {
    jest.useFakeTimers();
    const {tree, onUnpin} = await renderRow({pinned: true});
    const pinBtn = tree().root.findByProps({className: 'wide-session-pin-btn'});
    const pointerDown = {pointerType: 'touch', button: 0, pointerId: 3, clientX: 4, clientY: 5, stopPropagation: jest.fn()};
    await act(async () => {
      pinBtn.props.onPointerDown(pointerDown);
      jest.advanceTimersByTime(450);
    });
    const heldClick = {preventDefault: jest.fn(), stopPropagation: jest.fn()};
    await act(async () => {
      pinBtn.props.onClickCapture(heldClick);
    });
    expect(pointerDown.stopPropagation).toHaveBeenCalledTimes(1);
    expect(heldClick.preventDefault).toHaveBeenCalledTimes(1);
    expect(heldClick.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onUnpin).not.toHaveBeenCalled();
    expect(pinBtn.props['data-context-menu-action']).toBe('true');
    jest.useRealTimers();
  });

  it('marks selected rows', async () => {
    const {tree} = await renderRow({selected: true});
    const row = tree().root.findAllByType('button').find(b => b.props.className.includes('wide-session-row'))!;
    expect(row.props.className).toContain('selected');
  });

  it('renders a fork-origin marker inside the row without another button', async () => {
    const {tree} = await renderRow({forked: true});
    const title = tree().root.findByProps({className: 'wide-session-title forked'});
    const [marker, text] = title.children as ReactTestInstance[];
    expect(marker.props.name).toBe('gitBranch');
    expect(text.props.className).toBe('wide-session-title-text');
    expect(tree().root.findAllByType('button')).toHaveLength(1);
  });

  it('renders a non-interactive trailing mark for pinned and unpinned rows', async () => {
    const unpinned = await renderRow({markColor: 'red'});
    const unpinnedMark = unpinned.tree().root.findByProps({
      className: 'wide-session-mark session-mark-red',
    });

    expect(unpinnedMark.props.role).toBe('img');
    expect(unpinnedMark.props['aria-label']).toBe('Red mark');
    expect(unpinned.tree().root.findAllByType('button')).toHaveLength(1);

    const pinned = await renderRow({pinned: true, markColor: 'blue'});
    const pinnedMark = pinned.tree().root.findByProps({
      className: 'wide-session-mark session-mark-blue',
    });

    expect(pinnedMark.props['aria-label']).toBe('Blue mark');
    expect(pinned.tree().root.findAllByType('button')).toHaveLength(2);
  });
});
