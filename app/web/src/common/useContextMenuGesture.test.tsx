/**
 * @jest-environment jsdom
 */
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {useContextMenuGesture, useContextMenuTargetGesture} from './useContextMenuGesture';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({onOpen}: {onOpen: (position: {x: number; y: number}) => void}) {
  const gesture = useContextMenuGesture(onOpen);
  return <button type="button" {...gesture}>file</button>;
}

function TargetHarness({onOpen}: {onOpen: (value: string, position: {x: number; y: number}) => void}) {
  const bind = useContextMenuTargetGesture(onOpen);
  return <button type="button" {...bind('report.txt')}>file</button>;
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

  beforeEach(() => {
    jest.useFakeTimers();
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

    act(() => button.dispatchEvent(pointerEvent('pointerdown', {
      pointerType: 'touch', pointerId: 7, clientX: 30, clientY: 40,
    })));
    act(() => jest.advanceTimersByTime(449));
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1));
    expect(onOpen).toHaveBeenLastCalledWith({x: 30, y: 40});

    const click = new MouseEvent('click', {bubbles: true, cancelable: true});
    act(() => button.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
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
  });

  test('binds the same gesture state to a target value', () => {
    const onOpen = jest.fn();
    act(() => root.render(<TargetHarness onOpen={onOpen} />));
    const button = container.querySelector('button')!;
    act(() => button.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 5, clientY: 6,
    })));
    expect(onOpen).toHaveBeenCalledWith('report.txt', {x: 5, y: 6});
  });
});
