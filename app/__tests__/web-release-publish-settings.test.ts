import fs from 'fs';
import path from 'path';

describe('release publish settings UI', () => {
  const projectRoot = path.join(__dirname, '..');
  const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'ReleasePublishSettings.tsx');
  const detailTsx = fs.readFileSync(detailPath, 'utf8');
  const appDialogsTsx = fs.readFileSync(
    path.join(projectRoot, 'web', 'src', 'shell', 'AppDialogs.tsx'),
    'utf8',
  );
  const stylesCss = fs.readFileSync(
    path.join(projectRoot, 'web', 'src', 'styles', 'settings.css'),
    'utf8',
  );

  test('uses the unified settings kit for sections, fields, buttons and errors', () => {
    expect(detailTsx).toContain('className="set-card"');
    expect(detailTsx).toContain('className="set-card-title"');
    expect(detailTsx).toContain('className="set-field"');
    expect(detailTsx).toContain('className="set-btn set-btn--primary"');
    expect(detailTsx).toContain('className="set-error" role="alert"');
    expect(detailTsx).not.toContain('settings-inline-error');
    expect(detailTsx).not.toContain('release-publish-section');
    expect(detailTsx).not.toContain('Run a persistent publishing task');
    expect(stylesCss).toMatch(/\.release-publish-page \{[\s\S]*margin: 0 auto;[\s\S]*padding: 10px 14px 24px;/);
  });

  test('confirms publish actions through the shared app dialog', () => {
    expect(detailTsx).toContain("import {AppConfirmDialog");
    expect(detailTsx).toContain("kind: 'releasePublish'");
    expect(detailTsx).toContain('<AppConfirmDialog');
    expect(appDialogsTsx).toContain("kind: 'releasePublish'");
    expect(appDialogsTsx).toContain('Publish version?');
    expect(appDialogsTsx).toContain('Publish temporary Web?');
    expect(appDialogsTsx).toContain("return 'Publish';");
  });

  test('shows pending labels and polls unfinished publish jobs', () => {
    expect(detailTsx).toContain('Publishing...');
    expect(detailTsx).toContain('pendingKind');
    expect(detailTsx).toContain('window.setInterval(');
    expect(detailTsx).toContain('job?.finishedAt');
  });

  test('renders job status with the shared status vocabulary and full-width mobile actions', () => {
    expect(detailTsx).toContain('set-status');
    expect(stylesCss).toContain('.release-publish-options');
    expect(stylesCss).toMatch(/@media \(max-width: 560px\)[\s\S]{0,200}release-publish-actions[\s\S]{0,80}flex: 1 1 100%/);
  });
});
