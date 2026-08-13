export type MermaidViewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type MermaidViewportPoint = {
  x: number;
  y: number;
};

export type MermaidViewportKeyAction =
  | 'zoom-in'
  | 'zoom-out'
  | 'reset'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down';

export const MERMAID_MIN_SCALE = 0.5;
export const MERMAID_MAX_SCALE = 4;
export const MERMAID_ZOOM_STEP = 0.2;
export const MERMAID_PAN_STEP = 40;

export function createMermaidViewport(): MermaidViewport {
  return {scale: 1, offsetX: 0, offsetY: 0};
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, scale));
}

export function setMermaidViewportScale(
  viewport: MermaidViewport,
  requestedScale: number,
  anchor: MermaidViewportPoint,
): MermaidViewport {
  const nextScale = clampScale(requestedScale);
  if (nextScale === viewport.scale) return viewport;

  const ratio = nextScale / viewport.scale;
  return {
    scale: nextScale,
    offsetX: anchor.x - (anchor.x - viewport.offsetX) * ratio,
    offsetY: anchor.y - (anchor.y - viewport.offsetY) * ratio,
  };
}

export function panMermaidViewport(
  viewport: MermaidViewport,
  deltaX: number,
  deltaY: number,
): MermaidViewport {
  return {
    ...viewport,
    offsetX: viewport.offsetX + deltaX,
    offsetY: viewport.offsetY + deltaY,
  };
}

export function mermaidViewportKeyAction(key: string): MermaidViewportKeyAction | null {
  switch (key) {
    case '+':
    case '=':
      return 'zoom-in';
    case '-':
      return 'zoom-out';
    case '0':
      return 'reset';
    case 'ArrowLeft':
      return 'pan-left';
    case 'ArrowRight':
      return 'pan-right';
    case 'ArrowUp':
      return 'pan-up';
    case 'ArrowDown':
      return 'pan-down';
    default:
      return null;
  }
}
