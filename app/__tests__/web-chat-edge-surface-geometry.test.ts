import fs from 'fs';
import path from 'path';

type GeometryModule = typeof import('../web/src/chat/layout/chatEdgeSurfaceGeometry');

function loadGeometryModule(): GeometryModule | null {
  const modulePath = path.join(
    __dirname,
    '..',
    'web',
    'src',
    'chat',
    'layout',
    'chatEdgeSurfaceGeometry.ts',
  );
  if (!fs.existsSync(modulePath)) {
    return null;
  }
  return require(modulePath) as GeometryModule;
}

describe('chat edge surface geometry', () => {
  test('moves the recent sessions fade with the actual left edge of the text column', () => {
    const geometry = loadGeometryModule();
    expect(geometry).not.toBeNull();
    if (!geometry) return;

    const surface = {left: 26, right: 386, width: 360};

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'left',
      surface,
      textColumn: {left: 266, right: 1066, width: 800},
    })).toEqual({start: 212, end: 240});

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'left',
      surface,
      textColumn: {left: 326, right: 1126, width: 800},
    })).toEqual({start: 272, end: 300});
  });

  test('keeps the text side transparent and fades only across the outer 28 pixels', () => {
    const geometry = loadGeometryModule();
    expect(geometry).not.toBeNull();
    if (!geometry) return;

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'right',
      surface: {left: 946, right: 1266, width: 320},
      textColumn: {left: 266, right: 1066, width: 800},
    })).toEqual({start: 120, end: 148});
  });

  test('shows a panel fully when it does not overlap the text column', () => {
    const geometry = loadGeometryModule();
    expect(geometry).not.toBeNull();
    if (!geometry) return;

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'left',
      surface: {left: 20, right: 260, width: 240},
      textColumn: {left: 300, right: 1100, width: 800},
    })).toEqual({start: 240, end: 240});

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'right',
      surface: {left: 1120, right: 1440, width: 320},
      textColumn: {left: 300, right: 1100, width: 800},
    })).toEqual({start: 0, end: 0});
  });
});
