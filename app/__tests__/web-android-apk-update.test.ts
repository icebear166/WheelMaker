import {
  createAndroidApkUpdateBridge,
  normalizeSha256Digest,
  parseAndroidStableRelease,
  resolveAndroidApkUpdateStatus,
} from '../web/src/platform/android/androidApkUpdate';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

describe('android apk update model', () => {
  test('parses carried Android APK pointer from stable metadata', () => {
    const latest = parseAndroidStableRelease({
      schema: 1,
      version: 'v1.24',
      androidApk: {
        version: 'v1.22',
        versionName: '1.22',
        versionCode: 22,
        publishedAt: '2026-05-31T03:49:50Z',
        sourceSha: 'a'.repeat(40),
        url: 'https://example.com/WheelMakerAndroid.apk',
        sha256: 'a'.repeat(64),
        size: 5408163,
      },
    });

    expect(latest).toEqual({
      tagName: 'v1.22',
      publishedAt: '2026-05-31T03:49:50Z',
      apk: {
        downloadUrl: 'https://example.com/WheelMakerAndroid.apk',
        sha256: 'a'.repeat(64),
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
    const latest = parseAndroidStableRelease({
      schema: 1,
      version: 'v1.1',
      androidApk: {
        version: 'v1.1',
        versionName: '1.1',
        versionCode: 1,
        publishedAt: '2026-05-31T03:49:50Z',
        sourceSha: 'a'.repeat(40),
        url: 'https://example.com/WheelMakerAndroid.apk',
        sha256: 'abcdef'.padEnd(64, '0'),
        size: 1,
      },
    });

    expect(resolveAndroidApkUpdateStatus({...local, apkSha256: 'abcdef'.padEnd(64, '0')}, latest)).toBe('up_to_date');
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
  });
});
