import fs from 'fs';
import path from 'path';

describe('native shell PWA gating', () => {
  test('keeps browser PWA registration guarded away from native shell hosts', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'main.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain("import {cleanupNativeWebViewPWA} from './platform/pwa/nativePwaGuard';");
    expect(mainTsx).toContain("import {isNativeShellHost} from './platform/native/webSource';");
    expect(mainTsx).toContain('const nativeShellHost = isNativeShellHost();');
    expect(mainTsx).toContain('if (nativeShellHost) {');
    expect(mainTsx).toContain('cleanupNativeWebViewPWA().catch(() => undefined);');
    expect(mainTsx).not.toContain('installWebFreshnessAutoRefresh');
    expect(mainTsx).not.toContain('./platform/pwa/webFreshness');
    expect(mainTsx).toContain("if (!nativeShellHost && 'serviceWorker' in navigator && window.isSecureContext) {");
  });

  test('does not remove browser PWA assets or notification handling', () => {
    const projectRoot = path.join(__dirname, '..');
    const serviceWorker = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'service-worker.js'),
      'utf8',
    );
    const manifest = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'manifest.webmanifest'),
      'utf8',
    );

    expect(serviceWorker).toContain("self.addEventListener('push'");
    expect(serviceWorker).toContain("self.addEventListener('fetch'");
    expect(serviceWorker).toContain("event.data?.type === 'WM_PWA_NOTIFY'");
    expect(manifest).toContain('"display": "standalone"');
  });
});
