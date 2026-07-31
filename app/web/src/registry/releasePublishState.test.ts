// @ts-nocheck
import {RegistryRepository} from './RegistryRepository';

test('returns a failed release publish job response', async () => {
  const repository = new RegistryRepository({
    request: async () => ({
      payload: {
        ok: false,
        status: 'failed',
        error: 'release token is not configured',
      },
    }),
  } as any);

  await expect(repository.startReleasePublish('publisher', {})).resolves.toEqual({
    ok: false,
    status: 'failed',
    error: 'release token is not configured',
  });
});
