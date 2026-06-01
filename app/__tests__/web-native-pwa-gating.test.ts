import fs from 'fs';
import path from 'path';

describe('native WebView PWA gating', () => {
  test('keeps browser PWA registration guarded away from native WebView hosts', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'main.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain("import {cleanupNativeWebViewPWA} from './pwa/nativePwaGuard';");
    expect(mainTsx).toContain("import {isNativeWebViewHost} from './shell/native/webSource';");
    expect(mainTsx).toContain('const nativeWebViewHost = isNativeWebViewHost();');
    expect(mainTsx).toContain('if (nativeWebViewHost) {');
    expect(mainTsx).toContain('cleanupNativeWebViewPWA().catch(() => undefined);');
    expect(mainTsx).toContain('if (!nativeWebViewHost) {');
    expect(mainTsx).toContain('installWebFreshnessAutoRefresh({');
    expect(mainTsx).toContain("if (!nativeWebViewHost && 'serviceWorker' in navigator && window.isSecureContext) {");
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
