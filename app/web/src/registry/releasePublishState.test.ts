// @ts-nocheck
import {RegistryRepository} from './RegistryRepository';

test('maps a failed release publish action to its Hub error', async () => {
  const repository = new RegistryRepository({
    request: async () => ({
      payload: {
        state: {
          hubId: 'publisher',
          status: 'error',
          sections: {
            releasePublish: {
              status: 'error',
              error: 'release token is not configured',
              action: {status: 'failed', error: 'release token is not configured'},
            },
          },
        },
      },
    }),
  } as any);

  await expect(repository.startReleasePublish('publisher', {})).resolves.toEqual({
    ok: false,
    status: 'failed',
    error: 'release token is not configured',
  });
});
