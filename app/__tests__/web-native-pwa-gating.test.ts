import fs from 'fs';
import path from 'path';

describe('native shell PWA boundary', () => {
  test('keeps browser PWA registration and assets outside native shells', () => {
    const projectRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const serviceWorker = fs.readFileSync(path.join(projectRoot, 'web', 'public', 'service-worker.js'), 'utf8');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'web', 'public', 'manifest.webmanifest'), 'utf8'),
    ) as {display?: string};

    expect(main).toContain('const nativeShellHost = isNativeShellHost();');
    expect(main).toContain('cleanupNativeWebViewPWA().catch(() => undefined);');
    expect(main).toContain("if (!nativeShellHost && 'serviceWorker' in navigator && window.isSecureContext) {");
    expect(main).not.toContain('installWebFreshnessAutoRefresh');
    expect(serviceWorker).toContain("self.addEventListener('push'");
    expect(serviceWorker).toContain("self.addEventListener('fetch'");
    expect(serviceWorker).toContain("event.data?.type === 'WM_PWA_NOTIFY'");
    expect(manifest.display).toBe('standalone');
  });
});
