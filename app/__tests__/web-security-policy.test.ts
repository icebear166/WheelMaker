import fs from 'fs';
import path from 'path';

const REQUIRED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "connect-src 'self' wss: https://api.github.com",
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
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(html).not.toContain("script-src 'self' 'unsafe-eval'");
  });

  test('development server is loopback-only and emits defense-in-depth headers', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const createConfig = require('../web/webpack.config.js');
    const config = createConfig({}, {mode: 'development'});
    const devServer = config.devServer;

    expect(devServer.host).toBe('127.0.0.1');
    expect(devServer.allowedHosts).toEqual(['localhost', '127.0.0.1']);
    expect(devServer.headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(devServer.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(devServer.headers['X-Frame-Options']).toBe('DENY');
    expect(devServer.headers['Referrer-Policy']).toBe('no-referrer');
  });

  test('deployment documentation includes matching static response headers', () => {
    const docs = [
      fs.readFileSync(path.resolve('../docs/nginx-security.md'), 'utf8'),
      fs.readFileSync(path.resolve('../INSTALL.md'), 'utf8'),
    ].join('\n');
    expect(docs).toContain('Content-Security-Policy');
    expect(docs).toContain('X-Content-Type-Options "nosniff" always');
    expect(docs).toContain('X-Frame-Options "DENY" always');
    expect(docs).toContain('Referrer-Policy "no-referrer" always');
  });
});
