import {useCallback, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';

export interface SheetDragDismiss {
  /** Current downward drag distance in px (0 when not dragging). */
  dragOffset: number;
  /** True while a drag gesture is in progress (kill transitions then). */
  dragging: boolean;
  /** Duration used by the return transition after a non-dismissed release. */
  releaseDurationMs: number;
  /** Pointer handlers for the sheet's drag handle region (grip/header). */
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

export function resolveSheetReleaseDuration(velocityPxPerMs: number): number {
  const normalized = Math.min(1, Math.max(0, Math.abs(velocityPxPerMs) / 0.8));
  return Math.round(180 - normalized * 80);
}

/**
 * Drag-to-dismiss for mobile bottom sheets. Pulling the sheet down past
 * `threshold` px — or flicking it down faster than `velocity` px/ms — calls
 * onDismiss; anything shorter springs back. Only touch/pen pointers start a
 * drag so desktop mouse selection is unaffected.
 */
export function useSheetDragToDismiss(
  onDismiss: () => void,
  options?: {threshold?: number; velocity?: number},
): SheetDragDismiss {
  const threshold = options?.threshold ?? 72;
  const velocityThreshold = options?.velocity ?? 0.5;
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [releaseDurationMs, setReleaseDurationMs] = useState(160);
  const dragRef = useRef<{startY: number; startTime: number; pointerId: number} | null>(null);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') {
      return;
    }
    dragRef.current = {
      startY: event.clientY,
      startTime: Date.now(),
      pointerId: event.pointerId,
    };
    setReleaseDurationMs(160);
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail for synthetic or already-ended pointers.
    }
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setDragOffset(Math.max(0, event.clientY - drag.startY));
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    const distance = Math.max(0, event.clientY - drag.startY);
    const elapsed = Math.max(1, Date.now() - drag.startTime);
    const velocity = distance / elapsed;
    const dismissed = distance > threshold || velocity > velocityThreshold;
    setDragging(false);
    if (dismissed) {
      // Dismissed by drag: keep dragOffset so the exit animation starts from
      // the gesture position instead of teleporting back to 0.
      onDismiss();
      return;
    }
    setReleaseDurationMs(resolveSheetReleaseDuration(velocity));
    setDragOffset(0);
  }, [onDismiss, threshold, velocityThreshold]);

  return {
    dragOffset,
    dragging,
    releaseDurationMs,
    handleProps: {onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag},
  };
}
