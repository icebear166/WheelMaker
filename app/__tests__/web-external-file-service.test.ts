import {RegistryRequestError} from '../web/src/registry/RegistryClient';
import {RegistryMethods} from '../web/src/registry/registryMethods';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {translateExternalFileError} from '../web/src/registry/RegistryWorkspaceService';

describe('external file service', () => {
  test('external info and read use additive methods without knownHash', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        payload: {path: 'D:/outside.txt', kind: 'file', size: 7},
      })
      .mockResolvedValueOnce({
        payload: {
          path: 'D:/outside.txt',
          content: 'outside',
          notModified: false,
          isBinary: false,
        },
      });
    const repository = new RegistryRepository({request} as never);

    await expect(repository.getExternalFileInfo('hub:p', 'D:/outside.txt'))
      .resolves.toMatchObject({path: 'D:/outside.txt', kind: 'file'});
    await expect(repository.readExternalFile('hub:p', 'D:/outside.txt'))
      .resolves.toMatchObject({
        path: 'D:/outside.txt',
        content: 'outside',
        notModified: false,
      });

    expect(request.mock.calls).toEqual([
      [{
        method: RegistryMethods.ProjectFSExternalInfo,
        projectId: 'hub:p',
        payload: {path: 'D:/outside.txt'},
        signal: undefined,
      }],
      [{
        method: RegistryMethods.ProjectFSExternalRead,
        projectId: 'hub:p',
        payload: {path: 'D:/outside.txt'},
        signal: undefined,
      }],
    ]);
  });

  test('translates only legacy unsupported external file methods', () => {
    for (const message of ['unsupported method on hub', 'unsupported method']) {
      expect(() => translateExternalFileError(
        new RegistryRequestError(
          message,
          'INVALID_ARGUMENT',
          {method: RegistryMethods.ProjectFSExternalRead},
        ),
      )).toThrow('This Hub does not support external file preview.');
    }

    const unrelated = new RegistryRequestError(
      'unsupported method',
      'INVALID_ARGUMENT',
      {method: RegistryMethods.ProjectGitStatus},
    );
    expect(() => translateExternalFileError(unrelated)).toThrow(unrelated);
  });
});
