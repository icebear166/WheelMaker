import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods} from '../web/src/registry/registryMethods';

describe('request permission registry service', () => {
  test('sends the selected option through the project-scoped permission method', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        accepted: true,
        permissionId: 'perm-1',
        outcome: 'selected',
        optionId: 'allow',
      },
    });
    const repository = new RegistryRepository({request} as never);

    const result = await (repository as any).respondSessionPermission(
      'hub:project',
      'sess-1',
      'perm-1',
      'allow',
    );

    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionPermissionRespond,
      projectId: 'hub:project',
      payload: {
        sessionId: 'sess-1',
        permissionId: 'perm-1',
        optionId: 'allow',
      },
      timeoutMs: 15000,
    });
    expect(result).toEqual({
      accepted: true,
      permissionId: 'perm-1',
      outcome: 'selected',
      optionId: 'allow',
    });
  });
});
