import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

describe('registry login device UI', () => {
  test('requires only the registry token and resolves the device name automatically', () => {
    const source = readFileSync(resolve(__dirname, '../web/src/app/WorkspaceApp.tsx'), 'utf8');
    expect(source).not.toContain('placeholder="Device name"');
    expect(source).not.toContain('loginDeviceName');
    expect(source).toContain('resolveLoginDeviceName');
    expect(source.match(/className="connect-titlebar"/g)).toHaveLength(1);
    expect(source).toContain('<DesktopWindowControls />');
  });
});
