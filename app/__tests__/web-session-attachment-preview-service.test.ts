import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryWorkspaceService} from '../web/src/registry/RegistryWorkspaceService';
import {RegistryMethods} from '../web/src/registry/registryMethods';

describe('registry session attachment preview service', () => {
  test('reads generated attachment thumbnails through the registry repository', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        payload: {
          ok: true,
          sessionId: 'sess-1',
          attachmentId: 'sha256-a',
          mimeType: 'image/jpeg',
          encoding: 'base64',
          content: '/9j/',
          width: 128,
          height: 96,
          size: 321,
          hash: 'thumb-hash',
        },
      }),
    };
    const repository = new RegistryRepository(client as never);

    const response = await repository.readSessionAttachmentThumbnail('project-1', {
      sessionId: 'sess-1',
      uri: 'file:///tmp/sha256-a.png',
    });

    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionAttachmentThumbnail,
      projectId: 'project-1',
      payload: {
        sessionId: 'sess-1',
        uri: 'file:///tmp/sha256-a.png',
      },
      timeoutMs: 15000,
    });
    expect(response).toEqual({
      ok: true,
      sessionId: 'sess-1',
      attachmentId: 'sha256-a',
      mimeType: 'image/jpeg',
      encoding: 'base64',
      content: '/9j/',
      width: 128,
      height: 96,
      size: 321,
      hash: 'thumb-hash',
    });
  });

  test('reads original attachment content through the registry repository', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        payload: {
          ok: true,
          sessionId: 'sess-1',
          attachmentId: 'sha256-a',
          mimeType: 'image/png',
          encoding: 'base64',
          content: 'iVBORw0=',
          isBinary: true,
          size: 456,
          hash: 'original-hash',
        },
      }),
    };
    const repository = new RegistryRepository(client as never);

    const response = await repository.readSessionAttachment('project-1', {
      sessionId: 'sess-1',
      attachmentId: 'sha256-a',
    });

    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionAttachmentRead,
      projectId: 'project-1',
      payload: {
        sessionId: 'sess-1',
        attachmentId: 'sha256-a',
      },
      timeoutMs: 30000,
    });
    expect(response.content).toBe('iVBORw0=');
    expect(response.mimeType).toBe('image/png');
    expect(response.isBinary).toBe(true);
  });

  test('preserves text attachment binary metadata through the registry repository', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        payload: {
          ok: true,
          sessionId: 'sess-1',
          attachmentId: 'sha256-b',
          mimeType: 'text/plain',
          encoding: 'utf-8',
          content: 'hello world',
          isBinary: false,
          size: 11,
          hash: 'text-hash',
        },
      }),
    };
    const repository = new RegistryRepository(client as never);

    const response = await repository.readSessionAttachment('project-1', {
      sessionId: 'sess-1',
      attachmentId: 'sha256-b',
    });

    expect(response.content).toBe('hello world');
    expect(response.mimeType).toBe('text/plain');
    expect(response.isBinary).toBe(false);
  });

  test('workspace service delegates attachment thumbnail and original reads to the selected chat project', async () => {
    const service = new RegistryWorkspaceService();
    const repository = {
      readSessionAttachmentThumbnail: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', attachmentId: 'sha256-a', mimeType: 'image/jpeg', encoding: 'base64', content: '/9j/'}),
      readSessionAttachment: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', attachmentId: 'sha256-a', mimeType: 'image/png', encoding: 'base64', content: 'iVBORw0='}),
    };

    Object.assign(service as unknown as { repository: unknown; session: unknown }, {
      repository,
      session: {
        projects: [],
        selectedProjectId: 'workspace-project',
        fileEntries: [],
      },
    });

    await (service as any).readProjectSessionAttachmentThumbnail('chat-project', {
      sessionId: 's1',
      uri: 'file:///tmp/sha256-a.png',
    });
    await (service as any).readProjectSessionAttachment('chat-project', {
      sessionId: 's1',
      attachmentId: 'sha256-a',
    });

    expect(repository.readSessionAttachmentThumbnail).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      uri: 'file:///tmp/sha256-a.png',
    });
    expect(repository.readSessionAttachment).toHaveBeenCalledWith('chat-project', {
      sessionId: 's1',
      attachmentId: 'sha256-a',
    });
  });
});
