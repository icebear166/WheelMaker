import {
  GITHUB_ANDROID_LATEST_RELEASE_API,
  createAndroidApkUpdateBridge,
  normalizeSha256Digest,
  parseAndroidLatestRelease,
  resolveAndroidApkUpdateStatus,
} from '../web/src/platform/android/androidApkUpdate';
import {createAndroidNativeMessageTestHost} from './androidNativeMessageTestHost';

describe('android apk update model', () => {
  test('parses latest GitHub release apk asset metadata', () => {
    const latest = parseAndroidLatestRelease({
      tag_name: 'android-v20260531-114748',
      target_commitish: 'abc123',
      published_at: '2026-05-31T03:49:50Z',
      html_url: 'https://github.com/swm8023/WheelMaker/releases/tag/android-v20260531-114748',
      assets: [
        {
          name: 'android-release.json',
          browser_download_url: 'https://example.com/android-release.json',
          digest: 'sha256:manifest',
          size: 695,
        },
        {
          name: 'WheelMakerAndroid.apk',
          browser_download_url: 'https://example.com/WheelMakerAndroid.apk',
          digest: 'sha256:ABCDEF',
          size: 5408163,
        },
      ],
    });

    expect(latest).toEqual({
      tagName: 'android-v20260531-114748',
      targetCommitish: 'abc123',
      publishedAt: '2026-05-31T03:49:50Z',
      releaseUrl: 'https://github.com/swm8023/WheelMaker/releases/tag/android-v20260531-114748',
      manifestUrl: 'https://example.com/android-release.json',
      apk: {
        downloadUrl: 'https://example.com/WheelMakerAndroid.apk',
        sha256: 'abcdef',
        size: 5408163,
      },
    });
  });

  test('normalizes sha256 digests and compares installed apk to latest release', () => {
    expect(normalizeSha256Digest('sha256:ABCDEF')).toBe('abcdef');
    expect(normalizeSha256Digest(' ABCDEF ')).toBe('abcdef');

    const local = {
      supported: true,
      packageName: 'com.wheelmaker.android',
      versionName: '0.0.1',
      versionCode: 1,
      apkSha256: 'abcdef',
      buildSha: 'abc123',
      builtAt: '2026-05-31T03:49:18Z',
      canRequestPackageInstalls: true,
    };
    const latest = parseAndroidLatestRelease({
      tag_name: 'android-v1',
      target_commitish: 'abc123',
      published_at: '2026-05-31T03:49:50Z',
      assets: [{
        name: 'WheelMakerAndroid.apk',
        browser_download_url: 'https://example.com/WheelMakerAndroid.apk',
        digest: 'sha256:abcdef',
        size: 1,
      }],
    });

    expect(resolveAndroidApkUpdateStatus(local, latest)).toBe('up_to_date');
    expect(resolveAndroidApkUpdateStatus({...local, apkSha256: '0000'}, latest)).toBe('update_available');
    expect(resolveAndroidApkUpdateStatus({...local, apkSha256: ''}, latest)).toBe('unknown');
  });

  test('uses the Android WebMessage bridge for APK updates', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'apk.getReleaseState': () => ({supported: true, apkSha256: 'abc'}),
      'apk.install': payload => ({ok: typeof payload.downloadUrl === 'string'}),
    });
    const bridge = createAndroidApkUpdateBridge({
      WheelMakerAndroidNative: target,
    } as any);

    expect(bridge.isSupported()).toBe(true);
    await expect(bridge.getLocalRelease()).resolves.toMatchObject({supported: true, apkSha256: 'abc'});
    await expect(bridge.installLatest({downloadUrl: 'https://example.com/app.apk'})).resolves.toMatchObject({ok: true});
    expect(requests.map(request => request.action)).toEqual(['apk.getReleaseState', 'apk.install']);

    expect(createAndroidApkUpdateBridge({} as any).isSupported()).toBe(false);
    expect(GITHUB_ANDROID_LATEST_RELEASE_API).toContain('/repos/swm8023/WheelMaker/releases/latest');
  });
});
