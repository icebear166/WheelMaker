import {RegistryAuthController} from '../web/src/registry/RegistryAuthController';

describe('registry browser login controller', () => {
  test('moves through checking, unauthenticated, logging-in, and authenticated without retaining token', async () => {
    const client = {
      status: jest.fn().mockResolvedValue({authenticated: false}),
      login: jest.fn().mockResolvedValue({authenticated: true, csrfToken: 'csrf'}),
      logout: jest.fn(),
    };
    const controller = new RegistryAuthController(client);
    const states: string[] = [];
    controller.subscribe(snapshot => states.push(snapshot.state));

    await controller.check();
    await controller.login('browser-login-token', 'My Browser');

    expect(states).toEqual(expect.arrayContaining(['checking', 'unauthenticated', 'logging-in', 'authenticated']));
    expect(client.login).toHaveBeenCalledWith('browser-login-token', 'My Browser');
    expect(JSON.stringify(controller.snapshot())).not.toContain('browser-login-token');
  });

  test('reports a retryable error without echoing credentials', async () => {
    const client = {
      status: jest.fn().mockRejectedValue(new Error('network unavailable')),
      login: jest.fn(),
      logout: jest.fn(),
    };
    const controller = new RegistryAuthController(client);
    await controller.check();
    expect(controller.snapshot()).toEqual({state: 'error', error: 'network unavailable'});
  });
});
