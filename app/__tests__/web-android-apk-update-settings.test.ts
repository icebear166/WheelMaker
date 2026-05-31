import fs from 'fs';
import path from 'path';

describe('android apk update settings card', () => {
  const projectRoot = path.join(__dirname, '..');

  test('renders Android-only APK update card above hub update controls', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles.css'), 'utf8');

    expect(mainTsx).toContain("from './androidApkUpdate'");
    expect(mainTsx).toContain('const androidApkUpdateBridge = useMemo(() => createAndroidApkUpdateBridge(), []);');
    expect(mainTsx).toContain('const [androidApkUpdateSupported, setAndroidApkUpdateSupported]');
    expect(mainTsx).toContain('refreshAndroidApkUpdate');
    expect(mainTsx).toContain('GITHUB_ANDROID_LATEST_RELEASE_API');
    expect(mainTsx).toContain('parseAndroidLatestRelease');
    expect(mainTsx).toContain('resolveAndroidApkUpdateStatus');
    expect(mainTsx).toContain('wheelmaker:android-apk-update');
    expect(mainTsx).toContain('requestAndroidApkInstall');
    expect(mainTsx).toContain('Download and Install');

    const updateDetailStart = mainTsx.indexOf('const renderUpdateSettingsDetail');
    const updateDetailEnd = mainTsx.indexOf('const renderTokenStatsSettingsDetail', updateDetailStart);
    const updateDetail = mainTsx.slice(updateDetailStart, updateDetailEnd);
    expect(updateDetail.indexOf('android-apk-update-card')).toBeGreaterThanOrEqual(0);
    expect(updateDetail.indexOf('android-apk-update-card')).toBeLessThan(updateDetail.indexOf('update-summary-bar'));
    expect(updateDetail.indexOf('update-summary-bar')).toBeLessThan(updateDetail.indexOf('agent-package-hub-list'));
    expect(updateDetail).toContain('androidApkUpdateSupported ?');
    expect(updateDetail).toContain('android-apk-update-heading');
    expect(updateDetail).toContain('android-apk-update-meta-grid');

    expect(stylesCss).toContain('.android-apk-update-card');
    expect(stylesCss).toContain('.android-apk-update-heading');
    expect(stylesCss).toContain('.android-apk-update-meta-grid');
    expect(stylesCss).toContain('.android-apk-update-actions');
  });
});
