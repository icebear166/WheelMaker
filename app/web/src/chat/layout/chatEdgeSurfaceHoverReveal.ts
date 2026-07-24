import React from 'react';

export const CHAT_EDGE_SURFACE_HOVER_REVEAL_DELAY_MS = 600;

export function useChatEdgeSurfaceHoverReveal(enabled: boolean) {
  const [revealed, setRevealed] = React.useState(false);
  const revealTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelReveal = React.useCallback(() => {
    if (revealTimeout.current !== null) {
      clearTimeout(revealTimeout.current);
      revealTimeout.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      cancelReveal();
      setRevealed(false);
    }
  }, [cancelReveal, enabled]);

  React.useEffect(() => cancelReveal, [cancelReveal]);

  const onPointerEnter = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType === 'touch') {
      return;
    }

    cancelReveal();
    revealTimeout.current = setTimeout(() => {
      revealTimeout.current = null;
      setRevealed(true);
    }, CHAT_EDGE_SURFACE_HOVER_REVEAL_DELAY_MS);
  }, [cancelReveal, enabled]);

  const onPointerLeave = React.useCallback(() => {
    cancelReveal();
    setRevealed(false);
  }, [cancelReveal]);

  return {
    revealed: enabled && revealed,
    onPointerEnter: enabled ? onPointerEnter : undefined,
    onPointerLeave: enabled ? onPointerLeave : undefined,
  };
}
