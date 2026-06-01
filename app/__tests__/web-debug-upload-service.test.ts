import {RegistryRepository} from '../web/src/services/registryRepository';

describe('debug log upload service', () => {
  test('sends compact diagnostic text to registry debug upload endpoint', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        payload: {
          ok: true,
          fileName: 'web-diagnostics-20260601.log',
        },
      }),
      onEvent: jest.fn(),
      onClose: jest.fn(),
    };
    const repository = new RegistryRepository(client as never);

    const response = await repository.uploadDebugLog({
      source: 'web',
      text: '00:00:01.000 info workspace select_session durationMs=42\n',
    });

    expect(client.request).toHaveBeenCalledWith({
      method: 'debug.uploadLog',
      payload: {
        source: 'web',
        text: '00:00:01.000 info workspace select_session durationMs=42\n',
      },
      timeoutMs: 15000,
    });
    expect(response).toEqual({
      ok: true,
      fileName: 'web-diagnostics-20260601.log',
    });
  });
});
