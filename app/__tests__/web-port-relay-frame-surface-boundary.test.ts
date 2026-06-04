import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const mainPath = path.join(root, 'web/src/app/WorkspaceApp.tsx');
const surfacePath = path.join(root, 'web/src/portRelay/PortRelayFrameSurface.tsx');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

describe('port relay frame surface boundary', () => {
  test('main delegates relay frame and floating button rendering to port relay components', () => {
    const main = readFile(mainPath);

    expect(main).toContain("import { PortRelayFloatingButton, PortRelayFrameSurface } from '../portRelay/PortRelayFrameSurface';");
    expect(main).toContain('<PortRelayFrameSurface');
    expect(main).toContain('<PortRelayFloatingButton');
    expect(main).not.toContain('const renderPortRelayFrameSurface =');
    expect(main).not.toContain('className={`port-relay-frame-surface ${mode}`}');
    expect(main).not.toContain('className="port-relay-frame"');
    expect(main).not.toContain('className="port-relay-target-switch-menu"');
    expect(main).not.toContain('className="drawer-toggle-bubble port-relay-floating-bubble"');
  });

  test('port relay surface owns iframe chrome and mobile target switch markup', () => {
    expect(fs.existsSync(surfacePath)).toBe(true);
    const source = readFile(surfacePath);

    expect(source).toContain('export function PortRelayFrameSurface');
    expect(source).toContain('export function PortRelayFloatingButton');
    expect(source).toContain('className={`port-relay-frame-surface ${mode}`}');
    expect(source).toContain('className="port-relay-frame"');
    expect(source).toContain('aria-label="Open relay page in browser"');
    expect(source).toContain('className="drawer-toggle-bubble port-relay-floating-bubble"');
    expect(source).toContain('className="port-relay-target-switch-menu"');
    expect(source).toContain('className="port-relay-target-switch-item"');
  });
});
