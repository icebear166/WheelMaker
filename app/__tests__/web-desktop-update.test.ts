import {checkDesktopUpdate} from '../web/src/platform/desktop/desktopUpdate';
import type {DesktopWindowBridge} from '../web/src/platform/desktop/desktopRuntime';

function stableWithDesktop(version: string, sha256: string) {
  return {
    schema: 2,
    version: 'v1.24',
    publishedAt: '2026-07-18T09:00:00Z',
    sourceSha: 'c'.repeat(40),
    desktopExe: {
      version,
      path: `/releases/${version}/WheelMakerDesktop.exe`,
      sha256,
    },
  };
}

function bridgeWith(
  sha256: string,
  updaterReady: boolean,
  version: string | null = 'v1.21',
): DesktopWindowBridge {
  return {
    enabled: true,
    getDesktopUpdateInfo: jest.fn(async () => ({
      ...(version === null ? {} : {version}),
      sha256,
      updaterReady,
    })),
    requestDesktopUpdate: jest.fn(async () => undefined),
  };
}

function stableFetch(sha256: string): typeof fetch {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => stableWithDesktop('v1.22', sha256),
  })) as unknown as typeof fetch;
}

function failingFetch(): typeof fetch {
  return jest.fn(async () => {
    throw new Error('network failed');
  }) as unknown as typeof fetch;
}

test('reports an available update only when the Desktop SHA differs', async () => {
  const bridge = bridgeWith('a'.repeat(64), true);

  await expect(checkDesktopUpdate(bridge, stableFetch('b'.repeat(64)))).resolves.toEqual({
    status: 'available',
    currentVersion: 'v1.21',
    latestVersion: 'v1.22',
  });
});

test('reports the inherited Desktop pointer as current when its SHA matches', async () => {
  await expect(
    checkDesktopUpdate(bridgeWith('a'.repeat(64), true), stableFetch('a'.repeat(64))),
  ).resolves.toEqual({status: 'current', currentVersion: 'v1.21'});
});

test('keeps an unknown legacy Desktop version distinct from the latest version', async () => {
  await expect(
    checkDesktopUpdate(bridgeWith('a'.repeat(64), true, null), stableFetch('b'.repeat(64))),
  ).resolves.toEqual({
    status: 'available',
    currentVersion: '',
    latestVersion: 'v1.22',
  });
});

test('does not infer a legacy Desktop version even when its SHA is current', async () => {
  await expect(
    checkDesktopUpdate(bridgeWith('a'.repeat(64), true, null), stableFetch('a'.repeat(64))),
  ).resolves.toEqual({
    status: 'current',
    currentVersion: '',
  });
});

test('maps missing helper, missing native action, and request failures to failed', async () => {
  await expect(
    checkDesktopUpdate(bridgeWith('a'.repeat(64), false), stableFetch('b'.repeat(64))),
  ).resolves.toEqual({status: 'failed'});
  await expect(
    checkDesktopUpdate({enabled: true}, stableFetch('b'.repeat(64))),
  ).resolves.toEqual({status: 'failed'});
  await expect(
    checkDesktopUpdate(bridgeWith('a'.repeat(64), true), failingFetch()),
  ).resolves.toEqual({status: 'failed'});
});
