import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('android apk update settings card', () => {
  const projectRoot = path.join(__dirname, '..');

  test('renders Android-only APK update card above hub update controls', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const detailTsx = fs.existsSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'))
      ? fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8')
      : '';
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("from '../platform/android/androidApkUpdate'");
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('<UpdateSettingsDetail');
    expect(mainTsx).toContain('const androidApkUpdateBridge = useMemo(() => createAndroidApkUpdateBridge(), []);');
    expect(mainTsx).toContain('const [androidApkUpdateSupported, setAndroidApkUpdateSupported]');
    expect(mainTsx).toContain('refreshAndroidApkUpdate');
    expect(mainTsx).not.toContain('GITHUB_ANDROID_LATEST_RELEASE_API');
    expect(mainTsx).toContain('parseAndroidStableRelease');
    expect(mainTsx).toContain('wheelMakerPublicMetadata?.stable');
    expect(mainTsx).toContain('resolveAndroidApkUpdateStatus');
    expect(mainTsx).toContain('wheelmaker:android-apk-update');
    expect(mainTsx).toContain('requestAndroidApkInstall');
    expect(detailTsx).toContain('Download & Install');

    expect(detailTsx.indexOf('update-apk-card')).toBeGreaterThanOrEqual(0);
    expect(detailTsx.indexOf('update-apk-card')).toBeLessThan(detailTsx.indexOf('update-overview'));
    expect(detailTsx.indexOf('update-overview')).toBeLessThan(detailTsx.indexOf('update-hub-list'));
    expect(detailTsx).toContain('androidApkUpdateSupported ?');
    expect(detailTsx).toContain('update-apk-scope');
    expect(detailTsx).toContain('update-apk-versions');

    expect(stylesCss).toContain('.update-apk-row');
    expect(stylesCss).toContain('.update-apk-scope');
    expect(stylesCss).toContain('.update-apk-versions');
    expect(stylesCss).toContain('.update-apk-actions');
  });
});
