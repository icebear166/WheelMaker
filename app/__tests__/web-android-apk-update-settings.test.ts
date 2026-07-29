import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('android apk update app menu', () => {
  const projectRoot = path.join(__dirname, '..');

  test('keeps native APK update out of the settings root page', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const rootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("from '../platform/android/androidApkUpdate'");
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).not.toContain('<UpdateSettingsDetail');
    expect(mainTsx).toContain('const androidApkUpdateBridge = useMemo(() => createAndroidApkUpdateBridge(), []);');
    expect(mainTsx).toContain('const androidUpdateController = useMemo<ClientUpdateController | null>');
    expect(mainTsx).toContain('checkAndroidApkUpdate(androidApkUpdateBridge)');
    expect(mainTsx).not.toContain('GITHUB_ANDROID_LATEST_RELEASE_API');
    expect(mainTsx).toContain('latestAndroidReleaseRef.current');
    expect(mainTsx).toContain('androidApkUpdateBridge.installLatest');

    expect(rootTsx).not.toContain('Download & Install');
    expect(rootTsx).not.toContain('update-apk-card');
    expect(rootTsx).not.toContain('androidApkUpdateSupported');
    expect(stylesCss).not.toContain('.update-apk-row');
    expect(stylesCss).not.toContain('.android-apk-update-card');
    expect(stylesCss).not.toContain('.android-apk-update-row');
    expect(stylesCss).not.toContain('.android-apk-update-actions');
  });
});
