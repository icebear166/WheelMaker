import {useCallback, useEffect, useRef} from 'react';
import type React from 'react';

const longPressDelayMs = 450;
const longPressMoveThreshold = 8;

type ActivePress = {
  pointerId: number;
  x: number;
  y: number;
};

export function useContextMenuGesture(
  onOpen: (position: {x: number; y: number}) => void,
): Pick<
  React.HTMLAttributes<HTMLElement>,
  | 'onContextMenu'
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerCancel'
  | 'onPointerLeave'
  | 'onClickCapture'
> {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<ActivePress | null>(null);
  const suppressClickRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    activeRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onContextMenu: event => {
      event.preventDefault();
      cancel();
      onOpen({x: event.clientX, y: event.clientY});
    },
    onPointerDown: event => {
      if (event.pointerType === 'mouse' || event.button !== 0) return;
      cancel();
      const press = {pointerId: event.pointerId, x: event.clientX, y: event.clientY};
      activeRef.current = press;
      timerRef.current = setTimeout(() => {
        if (activeRef.current !== press) return;
        timerRef.current = null;
        activeRef.current = null;
        suppressClickRef.current = true;
        onOpen({x: press.x, y: press.y});
      }, longPressDelayMs);
    },
    onPointerMove: event => {
      const press = activeRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (
        Math.abs(event.clientX - press.x) > longPressMoveThreshold
        || Math.abs(event.clientY - press.y) > longPressMoveThreshold
      ) {
        cancel();
      }
    },
    onPointerUp: event => {
      if (activeRef.current?.pointerId === event.pointerId) cancel();
    },
    onPointerCancel: event => {
      if (activeRef.current?.pointerId === event.pointerId) cancel();
    },
    onPointerLeave: event => {
      if (activeRef.current?.pointerId === event.pointerId) cancel();
    },
    onClickCapture: event => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

export function useContextMenuTargetGesture<T>(
  onOpen: (target: T, position: {x: number; y: number}) => void,
): (target: T) => ReturnType<typeof useContextMenuGesture> {
  const targetRef = useRef<T | null>(null);
  const handlers = useContextMenuGesture(position => {
    if (targetRef.current !== null) {
      onOpen(targetRef.current, position);
    }
  });

  return useCallback((target: T) => ({
    onContextMenu: event => {
      targetRef.current = target;
      handlers.onContextMenu?.(event);
    },
    onPointerDown: event => {
      targetRef.current = target;
      handlers.onPointerDown?.(event);
    },
    onPointerMove: handlers.onPointerMove,
    onPointerUp: handlers.onPointerUp,
    onPointerCancel: handlers.onPointerCancel,
    onPointerLeave: handlers.onPointerLeave,
    onClickCapture: handlers.onClickCapture,
  }), [handlers]);
}
