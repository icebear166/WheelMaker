import fs from 'fs';
import path from 'path';

describe('android apk update settings card', () => {
  const projectRoot = path.join(__dirname, '..');

  test('renders Android-only APK update card above hub update controls', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const detailTsx = fs.existsSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'))
      ? fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8')
      : '';
    const stylesCss = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles.css'), 'utf8');

    expect(mainTsx).toContain("from '../platform/android/androidApkUpdate'");
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('<UpdateSettingsDetail');
    expect(mainTsx).toContain('const androidApkUpdateBridge = useMemo(() => createAndroidApkUpdateBridge(), []);');
    expect(mainTsx).toContain('const [androidApkUpdateSupported, setAndroidApkUpdateSupported]');
    expect(mainTsx).toContain('refreshAndroidApkUpdate');
    expect(mainTsx).toContain('GITHUB_ANDROID_LATEST_RELEASE_API');
    expect(mainTsx).toContain('parseAndroidLatestRelease');
    expect(mainTsx).toContain('resolveAndroidApkUpdateStatus');
    expect(mainTsx).toContain('wheelmaker:android-apk-update');
    expect(mainTsx).toContain('requestAndroidApkInstall');
    expect(detailTsx).toContain('Download and Install');

    expect(detailTsx.indexOf('android-apk-update-card')).toBeGreaterThanOrEqual(0);
    expect(detailTsx.indexOf('android-apk-update-card')).toBeLessThan(detailTsx.indexOf('update-summary-bar'));
    expect(detailTsx.indexOf('update-summary-bar')).toBeLessThan(detailTsx.indexOf('agent-package-hub-list'));
    expect(detailTsx).toContain('androidApkUpdateSupported ?');
    expect(detailTsx).toContain('android-apk-update-heading');
    expect(detailTsx).toContain('android-apk-update-meta-grid');

    expect(stylesCss).toContain('.android-apk-update-card');
    expect(stylesCss).toContain('.android-apk-update-heading');
    expect(stylesCss).toContain('.android-apk-update-meta-grid');
    expect(stylesCss).toContain('.android-apk-update-actions');
  });
});
