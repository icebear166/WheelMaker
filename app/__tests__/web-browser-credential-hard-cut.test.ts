import fs from 'fs';
import path from 'path';
import {scrubLegacyGlobalRows} from '../web/src/workspace/WorkspacePersistence';

const source = (relative: string): string => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('browser credential hard cut', () => {
  test('deletes known IndexedDB credentials while retaining non-sensitive preferences', () => {
    const result = scrubLegacyGlobalRows([
      {k: 'address', v: JSON.stringify('wss://old.example/ws'), updatedAt: 1},
      {k: 'token', v: JSON.stringify('registry-secret'), updatedAt: 1},
      {k: 'deepseekApiKey', v: JSON.stringify('deepseek-secret'), updatedAt: 1},
      {k: 'speechSettings', v: JSON.stringify({enabled: true, volcengineApiKey: 'asr-secret'}), updatedAt: 1},
      {k: 'ttsSettings', v: JSON.stringify({enabled: true, model: 'mimo-v2.5-tts', voice: 'Mia', apiKey: 'tts-secret'}), updatedAt: 1},
      {k: 'themeMode', v: JSON.stringify('light'), updatedAt: 1},
    ]);

    expect(result.deletes.sort()).toEqual(['address', 'deepseekApiKey', 'token']);
    expect(JSON.parse(result.puts.find(row => row.k === 'speechSettings')!.v)).toEqual({
      enabled: true,
      provider: 'volcengine',
      model: 'doubao-streaming-asr-2.0',
    });
    expect(JSON.parse(result.puts.find(row => row.k === 'ttsSettings')!.v)).toEqual({
      enabled: true,
      model: 'mimo-v2.5-tts',
      voice: 'Mia',
    });
    expect(result.puts.some(row => row.k === 'themeMode')).toBe(false);
  });

  test('removes browser token/address persistence and scrubs legacy keys before use', () => {
    const persistence = source('web/src/workspace/WorkspacePersistence.ts');
    const app = source('web/src/app/WorkspaceApp.tsx');

    expect(persistence).not.toMatch(/PersistedGlobalState[\s\S]{0,500}\b(?:address|token|deepseekApiKey):/);
    expect(persistence).not.toContain('wheelmaker.workspace.token');
    expect(persistence).not.toContain('wheelmaker.workspace.address');
    expect(persistence).toContain('scrubLegacyBrowserCredentials');
    expect(app.indexOf('scrubLegacyBrowserCredentials')).toBeLessThan(app.indexOf('new WorkspaceStore'));
    expect(app).not.toContain('getDefaultRegistryAddress');
  });

  test('removes token from the entire browser websocket connect chain', () => {
    const controller = source('web/src/workspace/WorkspaceController.ts');
    const service = source('web/src/registry/RegistryWorkspaceService.ts');
    const repository = source('web/src/registry/RegistryRepository.ts');
    const app = source('web/src/app/WorkspaceApp.tsx');

    expect(controller).toMatch(/connect\(wsUrl: string, options\?/);
    expect(service).toMatch(/connect\(wsUrl: string\)/);
    expect(repository).toMatch(/initialize\(url: string\)/);
    const initialize = repository.match(/async initialize[\s\S]*?\n  }/)?.[0] ?? '';
    expect(initialize).not.toMatch(/token/);
    expect(app).toContain('deriveRegistryEndpoints(document.baseURI');
    expect(app).not.toMatch(/Registry token \(optional\)|Registry address|setAddress\(|setToken\(/);
  });
});
