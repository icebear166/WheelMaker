import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

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
  test('clips transparent desktop edge tails out of pointer hit testing until reveal', () => {
    const stylesCss = readWebStyles(path.join(__dirname, '..'));

    expect(stylesCss).toMatch(
      /\.chat-plan-surface\.desktop,[\s\S]*\.chat-recent-sessions-surface\.desktop,[\s\S]*\.chat-function-surface\.desktop \{[\s\S]*clip-path: inset\(0 calc\(100% - var\(--chat-edge-fade-end\)\) 0 0\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-recent-sessions-surface\.desktop:is\(:hover, :focus-within\),[\s\S]*\.chat-plan-surface\.desktop:is\(\.chat-edge-surface-hover-revealed, :focus-within\),[\s\S]*\.chat-function-surface\.desktop\.monitor-surface:is\(\.chat-edge-surface-hover-revealed, :focus-within\) \{[\s\S]*--chat-edge-hidden-alpha: 100%;[\s\S]*clip-path: none;[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('.chat-plan-surface.desktop:is(:hover');
    expect(stylesCss).not.toContain('.chat-function-surface.desktop.monitor-surface:is(:hover');
  });

  test('moves the recent sessions fade with the actual left edge of the text column', () => {
    const geometry = loadGeometryModule();
    expect(geometry).not.toBeNull();
    if (!geometry) return;

    const surface = {left: 26, right: 386, width: 360};

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'left',
      surface,
      textColumn: {left: 266, right: 1066, width: 800},
    })).toEqual({start: 202, end: 230});

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'left',
      surface,
      textColumn: {left: 326, right: 1126, width: 800},
    })).toEqual({start: 262, end: 290});
  });

  test('keeps the text side transparent and fades only across the outer 28 pixels', () => {
    const geometry = loadGeometryModule();
    expect(geometry).not.toBeNull();
    if (!geometry) return;

    expect(geometry.resolveChatEdgeSurfaceFadeStops({
      side: 'right',
      surface: {left: 946, right: 1266, width: 320},
      textColumn: {left: 266, right: 1066, width: 800},
    })).toEqual({start: 130, end: 158});
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
