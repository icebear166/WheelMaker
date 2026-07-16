import fs from 'fs';
import path from 'path';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods} from '../web/src/registry/registryMethods';

describe('web file read cache on notModified', () => {
  test('restores cached content when fs.read returns notModified', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain("const fileMemoryCacheKey = (activeProjectId: string, path: string) => `${activeProjectId}\\n${path}`;");
    expect(mainTsx).toContain('const fileCacheRef = useRef<Record<string, string>>({});');
    expect(mainTsx).toContain('const cacheKey = fileMemoryCacheKey(targetProjectId, path);');
    expect(mainTsx).toContain('const persistedFile = fileCacheDisabled ? null : workspaceStore.getCachedFile(targetProjectId, path);');
    expect(mainTsx).toContain('const cachedContent = fileCacheDisabled ? undefined : fileCacheRef.current[cacheKey] ?? persistedFile?.content;');
    expect(mainTsx).toContain("const knownHash = !fileCacheDisabled && typeof cachedContent === 'string'");
    expect(mainTsx).toContain('knownHash: fileCacheDisabled ? undefined : knownHash || undefined,');
    expect(mainTsx).toContain('if (result.notModified) {');
    expect(mainTsx).toContain('if (result.notModified && fileCacheDisabled) {');
    expect(mainTsx).toContain('const freshResult = await service.readProjectFile(path, targetProjectId, {signal: controller.signal});');
    expect(mainTsx).toContain("setFileContent(cachedContent);");
    expect(mainTsx).not.toContain("fileCacheRef.current[path] ?? persistedFile?.content ?? '';");
    expect(mainTsx).toContain('fileCacheRef.current[cacheKey] = result.content;');
    expect(mainTsx).toContain('fileHashRef.current[cacheKey] = nextHash;');
  });

  test('reads files against an explicit project instead of mutable service selection', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const serviceTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'),
      'utf8',
    );
    const repositoryTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'registry', 'RegistryRepository.ts'),
      'utf8',
    );

    expect(serviceTs).toContain('async getProjectFileInfo(projectId: string, path: string, options?: Pick<RegistryFileRequestOptions, \'signal\'>): Promise<RegistryFsInfo>');
    expect(serviceTs).toContain('async readProjectFile(path: string, projectId: string, options?: RegistryFileRequestOptions)');
    expect(repositoryTs).toContain('export type RegistryFileRequestOptions = {');
    expect(repositoryTs).toContain('signal?: AbortSignal;');
    expect(repositoryTs).toContain('signal: options?.signal,');
    expect(mainTsx).toContain('const targetProjectId = projectIdRef.current || projectId;');
    expect(mainTsx).toContain(
      'const info = await service.getProjectFileInfo(targetProjectId, path, {signal: controller.signal});',
    );
    expect(mainTsx).toContain('const result = await service.readProjectFile(path, targetProjectId, {');
    expect(mainTsx).toContain('if (requestSeq !== fileReadSeqRef.current || projectIdRef.current !== targetProjectId) return;');
  });

  test('cancels stale selected-file requests without changing cache negotiation', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const readStart = mainTsx.indexOf('const readSelectedFile = async');
    const readEnd = mainTsx.indexOf('const readChatFilePeek = useCallback', readStart);
    const readBody = mainTsx.slice(readStart, readEnd);

    expect(mainTsx).toContain('const fileReadAbortControllerRef = useRef<AbortController | null>(null);');
    expect(readBody).toContain('fileReadAbortControllerRef.current?.abort();');
    expect(readBody).toContain('signal: controller.signal');
    expect(readBody).toContain('if (isAbortError(err))');
    expect(readBody).toContain('knownHash: fileCacheDisabled ? undefined : knownHash || undefined,');
  });
});

describe('RegistryRepository file info canonical paths', () => {
  test.each([
    ['missing', {}],
    ['null', {path: null}],
  ])('fails closed when the server path is %s while preserving file metadata', async (_label, pathPayload) => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ...pathPayload,
        kind: 'file',
        size: 128,
        isBinary: false,
        mimeType: 'text/markdown',
        totalLines: 8,
        tabSize: 2,
        entryCount: 0,
        hash: 'readme-hash',
      },
    });
    const repository = new RegistryRepository({request} as never);

    const info = await repository.getFileInfo('p1', 'src/../README.md');

    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.ProjectFSInfo,
      projectId: 'p1',
      payload: {path: 'src/../README.md'},
      signal: undefined,
    });
    expect(info).toEqual({
      path: '',
      kind: 'file',
      size: 128,
      isBinary: false,
      mimeType: 'text/markdown',
      totalLines: 8,
      tabSize: 2,
      entryCount: 0,
      hash: 'readme-hash',
    });
  });

  test('preserves a canonical path returned by the server', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {path: 'README.md', kind: 'file'},
    });
    const repository = new RegistryRepository({request} as never);

    const info = await repository.getFileInfo('p1', 'src/../README.md');

    expect(info.path).toBe('README.md');
  });
});
