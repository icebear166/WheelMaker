import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

describe('web asset report script', () => {
  test('reports configured build target assets sorted by size', () => {
    const appRoot = path.join(__dirname, '..');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelmaker-web-assets-'));
    const script = path.join(appRoot, 'scripts', 'report_web_assets.js');

    try {
      fs.writeFileSync(path.join(target, 'runtime.abc123.js'), 'r'.repeat(256));
      fs.writeFileSync(path.join(target, 'bundle.def456.css'), 'c'.repeat(1024));
      fs.writeFileSync(path.join(target, 'bundle.ghi789.js'), 'j'.repeat(2048));

      const result = spawnSync(process.execPath, [script], {
        cwd: appRoot,
        env: {
          ...process.env,
          WHEELMAKER_WEB_TARGET: target,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Web asset report');
      expect(result.stdout).toContain(target);
      expect(result.stdout).toContain('Total size: 3.25 KiB');
      expect(result.stdout).toMatch(/bundle\.ghi789\.js\s+2\.00 KiB/);
      expect(result.stdout).toMatch(/bundle\.def456\.css\s+1\.00 KiB/);
      expect(result.stdout.indexOf('bundle.ghi789.js')).toBeLessThan(
        result.stdout.indexOf('bundle.def456.css'),
      );
      expect(result.stdout.indexOf('bundle.def456.css')).toBeLessThan(
        result.stdout.indexOf('runtime.abc123.js'),
      );
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('asset report is wired through npm without changing the release build', () => {
    const appRoot = path.join(__dirname, '..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts['report:web-assets']).toBe('node scripts/report_web_assets.js');
    expect(packageJson.scripts['build:web:release']).toBe(
      'npm run build:web && node scripts/export_web_release.js',
    );
  });
});
