import { resolveFixedChatMarginLeft } from './fixedChatAlignment';
import * as fixedChatAlignmentModule from './fixedChatAlignment';

const EDGE_GAP = 18;
const R = 360 + EDGE_GAP + 12; // surface width + edge gap + column gap

describe('resolveFixedChatMarginLeft', () => {
  it('centers the column when the main area is wide', () => {
    // W=1600, C=800 -> centered = 400; rightMin = 782; min(R,782)=390; max(400,390)=400
    expect(resolveFixedChatMarginLeft({ mainWidth: 1600, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(400);
  });

  it('docks to the reserved surface width when centering would overlap it', () => {
    // centered < R <= rightMin -> margin = R
    // W=1300: centered=250 < 390; rightMin=482 >= 390
    expect(resolveFixedChatMarginLeft({ mainWidth: 1300, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(R);
  });

  it('shrinks below the reservation (overlap phase) once the right gutter hits its minimum', () => {
    // W=1200: rightMin=382 < R=390 -> min(R,382)=382; max(centered=200,382)=382
    expect(resolveFixedChatMarginLeft({ mainWidth: 1200, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(382);
  });

  it('is continuous across the center/dock boundary', () => {
    // boundary: centered == R -> W = 800 + 2R = 1580
    const at = resolveFixedChatMarginLeft({ mainWidth: 1580, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    const before = resolveFixedChatMarginLeft({ mainWidth: 1579, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    const after = resolveFixedChatMarginLeft({ mainWidth: 1581, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
    expect(at).toBe(R);
  });

  it('is continuous across the dock/overlap boundary', () => {
    // boundary: rightMin == R -> W = 800 + R + edgeGap = 1208
    const before = resolveFixedChatMarginLeft({ mainWidth: 1207, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    const after = resolveFixedChatMarginLeft({ mainWidth: 1209, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  it('never moves the column more than the width change (continuity under resize)', () => {
    for (let w = 900; w < 2000; w += 1) {
      const a = resolveFixedChatMarginLeft({ mainWidth: w, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
      const b = resolveFixedChatMarginLeft({ mainWidth: w + 1, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
      expect(Math.abs(b - a)).toBeLessThanOrEqual(1);
    }
  });

  it('returns 0 when the main area is narrower than the column', () => {
    expect(resolveFixedChatMarginLeft({ mainWidth: 700, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(0);
  });

  it('ignores the reservation when no surface is visible (pure centering)', () => {
    expect(resolveFixedChatMarginLeft({ mainWidth: 1200, surfaceReservedWidth: 0, edgeGap: EDGE_GAP })).toBe(200);
  });
});

describe('resolveFixedChatLayout', () => {
  it('keeps 100px of the floating cards visible before shrinking the chat column', () => {
    const resolveLayout = (
      fixedChatAlignmentModule as typeof fixedChatAlignmentModule & {
        resolveFixedChatLayout?: (input: {
          mainWidth: number;
          surfaceReservedWidth: number;
          edgeGap: number;
          minimumSurfaceReveal: number;
        }) => {marginLeft: number; columnWidth: number};
      }
    ).resolveFixedChatLayout;
    expect(resolveLayout).toBeDefined();
    if (!resolveLayout) return;

    expect(resolveLayout({
      mainWidth: 850,
      surfaceReservedWidth: R,
      edgeGap: 0,
      minimumSurfaceReveal: 100,
    })).toEqual({marginLeft: 100, columnWidth: 750});
    expect(resolveLayout({
      mainWidth: 1200,
      surfaceReservedWidth: R,
      edgeGap: 0,
      minimumSurfaceReveal: 100,
    })).toEqual({marginLeft: 390, columnWidth: 800});
  });

  it('changes continuously across the 100px reveal threshold', () => {
    const resolveLayout = (
      fixedChatAlignmentModule as typeof fixedChatAlignmentModule & {
        resolveFixedChatLayout?: (input: {
          mainWidth: number;
          surfaceReservedWidth: number;
          edgeGap: number;
          minimumSurfaceReveal: number;
        }) => {marginLeft: number; columnWidth: number};
      }
    ).resolveFixedChatLayout;
    expect(resolveLayout).toBeDefined();
    if (!resolveLayout) return;

    const before = resolveLayout({mainWidth: 899, surfaceReservedWidth: R, edgeGap: 0, minimumSurfaceReveal: 100});
    const after = resolveLayout({mainWidth: 901, surfaceReservedWidth: R, edgeGap: 0, minimumSurfaceReveal: 100});
    expect(Math.abs(after.marginLeft - before.marginLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.columnWidth - before.columnWidth)).toBeLessThanOrEqual(1);
  });

  it('does not reserve 100px when no floating surface is present', () => {
    const resolveLayout = fixedChatAlignmentModule.resolveFixedChatLayout;
    expect(resolveLayout({
      mainWidth: 850,
      surfaceReservedWidth: 0,
      edgeGap: 0,
      minimumSurfaceReveal: 100,
    })).toEqual({marginLeft: 25, columnWidth: 800});
  });
});

describe('1200px column tier', () => {
  it('centers the 1200px column when the main area is wide', () => {
    // W=2000, C=1200 -> centered = 400; rightMin = 782; min(R,782)=390; max(400,390)=400
    expect(resolveFixedChatMarginLeft({
      mainWidth: 2000,
      surfaceReservedWidth: R,
      edgeGap: EDGE_GAP,
      columnWidth: 1200,
    })).toBe(400);
  });

  it('compresses the 1200px column when the main area is narrower', () => {
    expect(fixedChatAlignmentModule.resolveFixedChatLayout({
      mainWidth: 1100,
      surfaceReservedWidth: 0,
      edgeGap: 0,
      minimumSurfaceReveal: 100,
      columnWidth: 1200,
    })).toEqual({marginLeft: 0, columnWidth: 1100});
  });

  it('keeps the surface reveal when docking the 1200px column', () => {
    // W=1300, C=1200: column = min(1200, 1300-100) = 1200; centered=50; rightMin=100; margin=100
    expect(fixedChatAlignmentModule.resolveFixedChatLayout({
      mainWidth: 1300,
      surfaceReservedWidth: R,
      edgeGap: 0,
      minimumSurfaceReveal: 100,
      columnWidth: 1200,
    })).toEqual({marginLeft: 100, columnWidth: 1200});
  });
});
