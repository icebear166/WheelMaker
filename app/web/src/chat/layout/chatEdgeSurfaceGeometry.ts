import React from 'react';

export type ChatEdgeSurfaceSide = 'left' | 'right';

export type ChatEdgeSurfaceRect = {
  left: number;
  right: number;
  width: number;
};

export type ChatEdgeSurfaceFadeStops = {
  start: number;
  end: number;
};

const DEFAULT_CHAT_EDGE_FADE_WIDTH = 28;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveChatEdgeSurfaceFadeStops({
  side,
  surface,
  textColumn,
  fadeWidth = DEFAULT_CHAT_EDGE_FADE_WIDTH,
}: {
  side: ChatEdgeSurfaceSide;
  surface: ChatEdgeSurfaceRect;
  textColumn: ChatEdgeSurfaceRect;
  fadeWidth?: number;
}): ChatEdgeSurfaceFadeStops {
  const width = Math.max(0, surface.width);
  const resolvedFadeWidth = Math.max(0, fadeWidth);

  if (side === 'left') {
    if (textColumn.left >= surface.right) {
      return {start: width, end: width};
    }
    const boundary = clamp(textColumn.left - surface.left, 0, width);
    return {
      start: Math.max(0, boundary - resolvedFadeWidth),
      end: boundary,
    };
  }

  if (textColumn.right <= surface.left) {
    return {start: 0, end: 0};
  }
  const boundary = clamp(textColumn.right - surface.left, 0, width);
  return {
    start: boundary,
    end: Math.min(width, boundary + resolvedFadeWidth),
  };
}

function cssPixelValue(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

export function useChatEdgeSurfaceGeometry(
  side: ChatEdgeSurfaceSide,
  active = true,
): React.RefObject<HTMLElement | null> {
  const surfaceRef = React.useRef<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!active || !surface) {
      return undefined;
    }

    const chatMain = surface.closest<HTMLElement>('.chat-main');
    const textColumn = chatMain?.querySelector<HTMLElement>('.chat-composer-content');
    if (!chatMain || !textColumn) {
      return undefined;
    }

    let updateFrame: number | null = null;
    const update = () => {
      updateFrame = null;
      const stops = resolveChatEdgeSurfaceFadeStops({
        side,
        surface: surface.getBoundingClientRect(),
        textColumn: textColumn.getBoundingClientRect(),
      });
      surface.style.setProperty('--chat-edge-fade-start', cssPixelValue(stops.start));
      surface.style.setProperty('--chat-edge-fade-end', cssPixelValue(stops.end));
    };
    const scheduleUpdate = () => {
      if (updateFrame !== null) {
        window.cancelAnimationFrame(updateFrame);
      }
      updateFrame = window.requestAnimationFrame(update);
    };

    update();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleUpdate);
    observer?.observe(chatMain);
    observer?.observe(textColumn);
    observer?.observe(surface);
    window.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      if (updateFrame !== null) {
        window.cancelAnimationFrame(updateFrame);
      }
    };
  }, [active, side]);

  return surfaceRef;
}
