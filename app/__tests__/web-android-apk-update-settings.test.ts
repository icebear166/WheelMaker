import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('android apk update settings card', () => {
  const projectRoot = path.join(__dirname, '..');

  test('renders the Android-only APK update card on the settings root page', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const rootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("from '../platform/android/androidApkUpdate'");
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).not.toContain('<UpdateSettingsDetail');
    expect(mainTsx).toContain('const androidApkUpdateBridge = useMemo(() => createAndroidApkUpdateBridge(), []);');
    expect(mainTsx).toContain('const [androidApkUpdateSupported, setAndroidApkUpdateSupported]');
    expect(mainTsx).toContain('refreshAndroidApkUpdate');
    expect(mainTsx).not.toContain('GITHUB_ANDROID_LATEST_RELEASE_API');
    expect(mainTsx).toContain('parseAndroidStableRelease');
    expect(mainTsx).toContain('wheelMakerPublicMetadata?.stable');
    expect(mainTsx).toContain('wheelmaker:android-apk-update');
    expect(mainTsx).toContain('requestAndroidApkInstall');
    expect(mainTsx).toContain('androidApkUpdateSupported={androidApkUpdateSupported}');

    expect(rootTsx).toContain('Download & Install');
    expect(rootTsx).toContain('update-apk-card');
    expect(rootTsx).toContain('androidApkUpdateSupported ?');
    expect(rootTsx).toContain('update-apk-scope');
    expect(rootTsx).toContain('update-apk-versions');
    expect(rootTsx).toContain('resolveAndroidApkUpdateStatus');
    expect(rootTsx.indexOf("id: 'android'")).toBeLessThan(rootTsx.indexOf("id: 'appearance'"));

    expect(stylesCss).toContain('.update-apk-row');
    expect(stylesCss).toContain('.update-apk-scope');
    expect(stylesCss).toContain('.update-apk-versions');
    expect(stylesCss).toContain('.update-apk-actions');
  });
});
