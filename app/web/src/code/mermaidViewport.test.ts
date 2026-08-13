import {
  MERMAID_MAX_SCALE,
  MERMAID_MIN_SCALE,
  createMermaidViewport,
  mermaidViewportKeyAction,
  panMermaidViewport,
  setMermaidViewportScale,
} from './mermaidViewport';

describe('Mermaid viewport', () => {
  it('scales around the supplied pointer anchor', () => {
    const viewport = setMermaidViewportScale(
      createMermaidViewport(),
      1.2,
      {x: 100, y: 80},
    );

    expect(viewport).toEqual({
      scale: 1.2,
      offsetX: -20,
      offsetY: -16,
    });
  });

  it('clamps requested scale to the supported range', () => {
    const viewport = createMermaidViewport();

    expect(setMermaidViewportScale(viewport, 0.1, {x: 0, y: 0}).scale).toBe(MERMAID_MIN_SCALE);
    expect(setMermaidViewportScale(viewport, 20, {x: 0, y: 0}).scale).toBe(MERMAID_MAX_SCALE);
  });

  it('keeps a bounded viewport unchanged when zooming beyond its limit', () => {
    const viewport = setMermaidViewportScale(
      createMermaidViewport(),
      MERMAID_MAX_SCALE,
      {x: 120, y: 90},
    );

    expect(setMermaidViewportScale(viewport, 20, {x: 40, y: 30})).toEqual(viewport);
  });

  it('adds keyboard pan distance to the current offset', () => {
    expect(panMermaidViewport({scale: 1.5, offsetX: 12, offsetY: -8}, -40, 40)).toEqual({
      scale: 1.5,
      offsetX: -28,
      offsetY: 32,
    });
  });

  it('maps supported keyboard commands and ignores unrelated keys', () => {
    expect(mermaidViewportKeyAction('+')).toBe('zoom-in');
    expect(mermaidViewportKeyAction('=')).toBe('zoom-in');
    expect(mermaidViewportKeyAction('-')).toBe('zoom-out');
    expect(mermaidViewportKeyAction('0')).toBe('reset');
    expect(mermaidViewportKeyAction('ArrowLeft')).toBe('pan-left');
    expect(mermaidViewportKeyAction('ArrowRight')).toBe('pan-right');
    expect(mermaidViewportKeyAction('ArrowUp')).toBe('pan-up');
    expect(mermaidViewportKeyAction('ArrowDown')).toBe('pan-down');
    expect(mermaidViewportKeyAction('Enter')).toBeNull();
  });
});
