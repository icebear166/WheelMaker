import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const mainPath = path.join(root, 'web/src/app/WorkspaceApp.tsx');
const surfacePath = path.join(root, 'web/src/portRelay/PortRelayFrameSurface.tsx');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

describe('port relay frame surface boundary', () => {
  test('main delegates relay frame rendering to the port relay component', () => {
    const main = readFile(mainPath);

    expect(main).toContain("import { PortRelayFrameSurface } from '../portRelay/PortRelayFrameSurface';");
    expect(main).toContain('<PortRelayFrameSurface');
    expect(main).not.toContain('<PortRelayFloatingButton');
    expect(main).not.toContain('const renderPortRelayFrameSurface =');
    expect(main).not.toContain('className={`port-relay-frame-surface ${mode}`}');
    expect(main).not.toContain('className="port-relay-frame"');
  });

  test('port relay surface owns iframe chrome markup', () => {
    expect(fs.existsSync(surfacePath)).toBe(true);
    const source = readFile(surfacePath);

    expect(source).toContain('export function PortRelayFrameSurface');
    expect(source).not.toContain('PortRelayFloatingButton');
    expect(source).toContain('className={`port-relay-frame-surface ${mode}`}');
    expect(source).toContain('className="port-relay-frame"');
    expect(source).toContain('aria-label="Open relay page in browser"');
    expect(source).not.toContain('codicon');
  });
});
