import fs from 'fs';
import path from 'path';

const REQUIRED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "form-action 'self'",
  'upgrade-insecure-requests',
];

describe('web security policy', () => {
  test('production document defines a restrictive CSP and no-referrer policy', () => {
    const html = fs.readFileSync(path.resolve('web/public/index.html'), 'utf8');
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      expect(html).toContain(directive);
    }
    expect(html).toContain(
      "connect-src 'self' wss: <%= releaseOrigin %> https://codexradar.com",
    );
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(html).not.toContain("script-src 'self' 'unsafe-eval'");
  });

  test('development server is loopback-only and emits defense-in-depth headers', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const createConfig = require('../web/webpack.config.js');
    const config = createConfig({}, {mode: 'development'});
    const devServer = config.devServer;
    const headersFor = (url: string): Record<string, string> =>
      devServer.headers({url}, {}, {});
    const documentHeaders = headersFor('/');

    expect(devServer.host).toBe('127.0.0.1');
    expect(devServer.allowedHosts).toEqual(['localhost', '127.0.0.1']);
    expect(documentHeaders['Content-Security-Policy']).toContain("default-src 'self'");
    expect(documentHeaders['Content-Security-Policy']).toContain(
      "connect-src 'self' ws: wss: https://release.wheelmaker.top https://codexradar.com",
    );
    expect(documentHeaders['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(documentHeaders['Content-Security-Policy']).not.toContain('github.com');
    expect(documentHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(documentHeaders['X-Frame-Options']).toBe('DENY');
    expect(documentHeaders['Referrer-Policy']).toBe('no-referrer');
    expect(devServer.proxy[0].context).toEqual(['/ws']);

    for (const url of ['/ws/preview/', '/wheelmaker/ws/preview/']) {
      const previewHeaders = headersFor(url);
      expect(previewHeaders['Content-Security-Policy']).toBeUndefined();
      expect(previewHeaders['X-Frame-Options']).toBeUndefined();
      expect(previewHeaders['X-Content-Type-Options']).toBe('nosniff');
      expect(previewHeaders['Referrer-Policy']).toBe('no-referrer');
    }
  });

  test('deployment documentation includes matching static response headers', () => {
    const docs = [
      fs.readFileSync(path.resolve('../docs/nginx-security.md'), 'utf8'),
      fs.readFileSync(path.resolve('../INSTALL.md'), 'utf8'),
    ];
    const combinedDocs = docs.join('\n');
    expect(combinedDocs).toContain('Content-Security-Policy');
    expect(combinedDocs).toContain('https://codexradar.com');
    expect(combinedDocs).toContain('X-Content-Type-Options "nosniff" always');
    expect(combinedDocs).toContain('X-Frame-Options "DENY" always');
    expect(combinedDocs).toContain('Referrer-Policy "no-referrer" always');
    for (const doc of docs) {
      expect(doc).toContain('/ws/preview/');
      expect(doc).toContain('prefix location');
      expect(doc).toContain('upstream Content-Security-Policy');
      expect(doc).toContain('must not add X-Frame-Options: DENY');
    }
  });
});
