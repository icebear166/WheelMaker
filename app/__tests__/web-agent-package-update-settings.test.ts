import {
  deriveOperationalHubIds,
  deriveWheelMakerHubStatus,
  fetchWheelMakerPublicMetadata,
  fetchWheelMakerReleaseHistory,
  parseWheelMakerStable,
  WHEELMAKER_PUBLISH_STATUS_URL,
  WHEELMAKER_RELEASE_HISTORY_URL,
  WHEELMAKER_STABLE_URL,
  wheelMakerUpdateJobActive,
  wheelMakerUpdateStatusLabel,
  wheelMakerVersionCopy,
} from '../web/src/settings/agentPackageUpdateView';
import type {RegistryWheelMakerUpdateResponse} from '../web/src/registry/registryTypes';

test('includes online project hubs in operational refreshes', () => {
  expect(
    deriveOperationalHubIds(
      [{hubId: 'snapshot-hub'}],
      [
        {hubId: 'reported-hub', online: true},
        {hubId: 'offline-hub', online: false},
      ],
    ),
  ).toEqual(['reported-hub', 'snapshot-hub']);
});

test('derives installed/stable release status and update labels', () => {
  const updateResponse: RegistryWheelMakerUpdateResponse = {
    ok: true,
    status: 'installed',
    hubId: 'hub-a',
    installed: {
      schemaVersion: 2,
      version: 'v1.22',
      publishedAt: '2026-07-15T09:00:00Z',
      sourceSha: 'a'.repeat(40),
      manifestSha256: 'c'.repeat(64),
      installedAt: '2026-07-15T09:05:00Z',
    },
    canRequestUpdate: true,
  };
  const stable = parseWheelMakerStable({
    schema: 2,
    version: 'v1.23',
    publishedAt: '2026-07-16T09:00:00Z',
    sourceSha: 'b'.repeat(40),
  });

  expect(wheelMakerVersionCopy(updateResponse, stable)).toEqual({current: 'v1.22', latest: 'v1.23'});
  expect(deriveWheelMakerHubStatus(updateResponse.installed, stable)).toBe('update_available');
  expect(deriveWheelMakerHubStatus({...updateResponse.installed, version: 'v1.23'}, stable)).toBe('up_to_date');
  expect(deriveWheelMakerHubStatus({...updateResponse.installed, version: 'v1.24'}, stable)).toBe('local_newer');
  expect(wheelMakerUpdateStatusLabel('downloading')).toBe('Downloading');
  expect(
    wheelMakerUpdateJobActive({
      schema: 1,
      jobId: 'job-a',
      state: 'downloading',
      startedAt: '2026-07-16T09:00:00Z',
      updatedAt: '2026-07-16T09:01:00Z',
    }),
  ).toBe(true);
  expect(
    wheelMakerUpdateJobActive({
      schema: 1,
      jobId: 'job-a',
      state: 'succeeded',
      startedAt: '2026-07-16T09:00:00Z',
      updatedAt: '2026-07-16T09:02:00Z',
    }),
  ).toBe(false);
});

test('accepts a valid Desktop release pointer and rejects unsafe metadata', () => {
  const stable = parseWheelMakerStable({
    schema: 2,
    version: 'v1.24',
    publishedAt: '2026-07-18T09:00:00Z',
    sourceSha: 'a'.repeat(40),
    desktopExe: {
      version: 'v1.22',
      path: '/releases/v1.22/WheelMakerDesktop.exe',
      sha256: 'b'.repeat(64),
    },
  });
  expect(stable.desktopExe).toMatchObject({version: 'v1.22', sha256: 'b'.repeat(64)});

  for (const desktopExe of [
    {version: 'v1.22', path: 'https://evil.example/Desktop.exe', sha256: 'b'.repeat(64)},
    {version: 'v1.22', path: '/releases/v1.22/WheelMakerDesktop.exe', sha256: 'bad'},
  ]) {
    expect(() =>
      parseWheelMakerStable({
        schema: 2,
        version: 'v1.24',
        publishedAt: '2026-07-18T09:00:00Z',
        sourceSha: 'a'.repeat(40),
        desktopExe,
      }),
    ).toThrow(/Desktop pointer/);
  }
});

test('loads public metadata once per endpoint and rejects an old schema', async () => {
  const requests: string[] = [];
  const request = jest.fn(async (url: string) => {
    requests.push(url);
    if (url.endsWith('/stable.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schema: 2,
          version: 'v1.24',
          publishedAt: '2026-07-17T09:00:00Z',
          sourceSha: 'a'.repeat(40),
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({schema: 1, state: 'running', phase: 'packaging', version: 'v1.25'}),
    };
  }) as unknown as typeof fetch;

  await expect(fetchWheelMakerPublicMetadata(request)).resolves.toMatchObject({
    stable: {version: 'v1.24'},
    publishStatus: {phase: 'packaging'},
  });
  expect(requests.filter(url => url.endsWith('/stable.json'))).toHaveLength(1);
  expect(requests.filter(url => url.endsWith('/publish-status.json'))).toHaveLength(1);
  expect(() => parseWheelMakerStable({schema: 1, version: 'v1.24'})).toThrow(/stable metadata/i);
});

test('loads and sorts release history from the canonical origin', async () => {
  expect(WHEELMAKER_STABLE_URL).toBe('https://release.wheelmaker.top/stable.json');
  expect(WHEELMAKER_PUBLISH_STATUS_URL).toBe('https://release.wheelmaker.top/publish-status.json');
  expect(WHEELMAKER_RELEASE_HISTORY_URL).toBe('https://release.wheelmaker.top/releases.json');

  const request = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      schema: 1,
      releases: [
        {version: 'v1.2', publishedAt: '2026-07-15T09:00:00Z', sourceSha: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), assets: []},
        {version: 'v1.3', publishedAt: '2026-07-16T09:00:00Z', sourceSha: 'c'.repeat(40), manifestSha256: 'd'.repeat(64), assets: []},
      ],
    }),
  }) as unknown as typeof fetch;

  await expect(fetchWheelMakerReleaseHistory(request)).resolves.toEqual([
    {version: 'v1.3', publishedAt: '2026-07-16T09:00:00Z', url: 'https://release.wheelmaker.top/releases/v1.3/release-manifest.json'},
    {version: 'v1.2', publishedAt: '2026-07-15T09:00:00Z', url: 'https://release.wheelmaker.top/releases/v1.2/release-manifest.json'},
  ]);
  expect(request).toHaveBeenCalledWith(WHEELMAKER_RELEASE_HISTORY_URL, {cache: 'no-store'});
});
