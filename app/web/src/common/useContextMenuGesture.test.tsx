/**
 * @jest-environment jsdom
 */
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {useContextMenuGesture, useContextMenuTargetGesture} from './useContextMenuGesture';
import * as contextMenuGestureModule from './useContextMenuGesture';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({onOpen}: {onOpen: (position: {x: number; y: number}) => void}) {
  const gesture = useContextMenuGesture(onOpen);
  return <button type="button" {...gesture}>file</button>;
}

function TargetHarness({onOpen}: {onOpen: (value: string, position: {x: number; y: number}) => void}) {
  const bind = useContextMenuTargetGesture(onOpen);
  return <button type="button" {...bind('report.txt')}>file</button>;
}

type ActionGestureHook = () => React.HTMLAttributes<HTMLElement> & {
  'data-context-menu-action'?: string;
};

const useContextMenuActionGesture = (
  contextMenuGestureModule as typeof contextMenuGestureModule & {
    useContextMenuActionGesture?: ActionGestureHook;
  }
).useContextMenuActionGesture ?? (() => ({}));

function ActionHarness({
  onClick,
  onParentPointerDown,
  onParentContextMenu,
}: {
  onClick: () => void;
  onParentPointerDown: () => void;
  onParentContextMenu: () => void;
}) {
  const gesture = useContextMenuActionGesture();
  return (
    <div onPointerDown={onParentPointerDown} onContextMenu={onParentContextMenu}>
      <button type="button" {...gesture} onClick={onClick}>close</button>
    </div>
  );
}

function pointerEvent(type: string, values: Record<string, unknown>): Event {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true});
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, {configurable: true, value});
  }
  return event;
}

describe('useContextMenuGesture', () => {
  let root: Root;
  let container: HTMLDivElement;
  let vibrate: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    vibrate = jest.fn();
    Object.defineProperty(navigator, 'vibrate', {configurable: true, value: vibrate});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  test('opens for right click and touch long press at the same coordinates', () => {
    const onOpen = jest.fn();
    act(() => root.render(<Harness onOpen={onOpen} />));
    const button = container.querySelector('button')!;
    const context = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 12, clientY: 18,
    });
    act(() => button.dispatchEvent(context));
    expect(context.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenLastCalledWith({x: 12, y: 18});
    expect(vibrate).not.toHaveBeenCalled();

    act(() => button.dispatchEvent(pointerEvent('pointerdown', {
      pointerType: 'touch', pointerId: 7, clientX: 30, clientY: 40,
    })));
    act(() => jest.advanceTimersByTime(449));
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1));
    expect(onOpen).toHaveBeenLastCalledWith({x: 30, y: 40});
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(12);

    const syntheticContextMenu = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 30, clientY: 40,
    });
    act(() => button.dispatchEvent(syntheticContextMenu));
    expect(syntheticContextMenu.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(2);
    const click = new MouseEvent('click', {bubbles: true, cancelable: true});
    act(() => button.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);

    const nextContextMenu = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 50, clientY: 60,
    });
    act(() => button.dispatchEvent(nextContextMenu));
    expect(onOpen).toHaveBeenLastCalledWith({x: 50, y: 60});
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  test('cancels long press after movement, pointer up, or pointer cancel', () => {
    const onOpen = jest.fn();
    act(() => root.render(<Harness onOpen={onOpen} />));
    const button = container.querySelector('button')!;

    act(() => {
      button.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0,
      }));
      button.dispatchEvent(pointerEvent('pointermove', {
        pointerType: 'touch', pointerId: 1, clientX: 9, clientY: 0,
      }));
      button.dispatchEvent(pointerEvent('pointermove', {
        pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0,
      }));
      jest.advanceTimersByTime(500);
    });
    act(() => {
      button.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'pen', pointerId: 2, clientX: 0, clientY: 0,
      }));
      button.dispatchEvent(pointerEvent('pointerup', {pointerId: 2}));
      jest.advanceTimersByTime(500);
    });
    act(() => {
      button.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'touch', pointerId: 3, clientX: 0, clientY: 0,
      }));
      button.dispatchEvent(pointerEvent('pointercancel', {pointerId: 3}));
      jest.advanceTimersByTime(500);
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  test('opens for a pen long press and clears pending work on unmount', () => {
    const onOpen = jest.fn();
    act(() => root.render(<Harness onOpen={onOpen} />));
    const button = container.querySelector('button')!;
    act(() => button.dispatchEvent(pointerEvent('pointerdown', {
      pointerType: 'pen', pointerId: 9, button: 0, clientX: 14, clientY: 16,
    })));
    act(() => jest.advanceTimersByTime(450));
    expect(onOpen).toHaveBeenCalledWith({x: 14, y: 16});
    expect(vibrate).toHaveBeenCalledTimes(1);

    act(() => button.dispatchEvent(pointerEvent('pointerdown', {
      pointerType: 'touch', pointerId: 10, button: 0, clientX: 20, clientY: 22,
    })));
    act(() => root.unmount());
    act(() => jest.advanceTimersByTime(500));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('does not arm long press for an unknown pointer type', () => {
    const onOpen = jest.fn();
    act(() => root.render(<Harness onOpen={onOpen} />));
    const button = container.querySelector('button')!;

    act(() => {
      button.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: '', pointerId: 12, button: 0, clientX: 6, clientY: 8,
      }));
      jest.advanceTimersByTime(500);
    });

    expect(onOpen).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  test('binds the same gesture state to a target value', () => {
    const onOpen = jest.fn();
    act(() => root.render(<TargetHarness onOpen={onOpen} />));
    const button = container.querySelector('button')!;
    act(() => button.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 5, clientY: 6,
    })));
    expect(onOpen).toHaveBeenCalledWith('report.txt', {x: 5, y: 6});
    expect(button.getAttribute('data-context-menu-target')).toBe('true');
  });

  test('isolates nested actions and suppresses only a held action click', () => {
    const onClick = jest.fn();
    const onParentPointerDown = jest.fn();
    const onParentContextMenu = jest.fn();
    act(() => root.render(
      <ActionHarness
        onClick={onClick}
        onParentPointerDown={onParentPointerDown}
        onParentContextMenu={onParentContextMenu}
      />,
    ));
    const button = container.querySelector('button')!;

    act(() => {
      button.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'touch', pointerId: 21, button: 0, clientX: 4, clientY: 5,
      }));
      button.dispatchEvent(pointerEvent('pointerup', {pointerId: 21}));
      button.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onParentPointerDown).not.toHaveBeenCalled();

    act(() => {
      button.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'touch', pointerId: 22, button: 0, clientX: 4, clientY: 5,
      }));
      jest.advanceTimersByTime(450);
    });
    const heldClick = new MouseEvent('click', {bubbles: true, cancelable: true});
    act(() => button.dispatchEvent(heldClick));
    expect(heldClick.defaultPrevented).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(vibrate).not.toHaveBeenCalled();

    const contextMenu = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
    act(() => button.dispatchEvent(contextMenu));
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(onParentContextMenu).not.toHaveBeenCalled();
    expect(button.getAttribute('data-context-menu-action')).toBe('true');
  });
});
