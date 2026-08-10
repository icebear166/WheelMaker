import type {RegistryClient} from './RegistryClient';
import {RegistryRepository} from './RegistryRepository';
import {hubStateRefreshBatches} from './RegistryWorkspaceService';

test('deduplicates Hub refresh sections without Gateway coupling', () => {
  expect(hubStateRefreshBatches('normal', ['wheelmakerUpdate', 'wheelmakerUpdate'])).toEqual([
    ['wheelmakerUpdate'],
  ]);
  expect(hubStateRefreshBatches('update_only', ['wheelmakerUpdate', 'skills'])).toEqual([
    ['wheelmakerUpdate', 'skills'],
  ]);
});

test('prepares a managed file download with project and csrf scope', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      ok: true,
      downloadPath: '/download/token-1',
      fileName: 'report.txt',
      mimeType: 'text/plain',
      size: 42,
    },
  });
  const repository = new RegistryRepository({request} as unknown as RegistryClient);

  await expect(repository.prepareFileDownload(
    'hub:project',
    'csrf-1',
    {kind: 'project-file', path: 'docs/report.txt'},
  )).resolves.toEqual({
    ok: true,
    downloadPath: '/download/token-1',
    fileName: 'report.txt',
    mimeType: 'text/plain',
    size: 42,
  });
  expect(request).toHaveBeenCalledWith({
    method: 'file.download.prepare',
    projectId: 'hub:project',
    payload: {
      csrfToken: 'csrf-1',
      source: {kind: 'project-file', path: 'docs/report.txt'},
    },
    timeoutMs: 20000,
  });
});
