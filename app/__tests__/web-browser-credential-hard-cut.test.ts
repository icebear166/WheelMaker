import fs from 'fs';
import path from 'path';
import {obsoleteBrowserCredentialRows} from '../web/src/compatibility/browserCredentialCleanup';

const source = (relative: string): string => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const productionSources = (): string => {
  const repositoryRoot = path.join(__dirname, '..', '..');
  const roots = ['app/web/src', 'server', 'mobile/android/app/src/main'];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(repositoryRoot, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!relative.includes('/dist/') && !relative.includes('/test/')) visit(fullPath);
      } else if (
        /\.(?:go|ts|tsx|kt|kts)$/.test(entry.name) &&
        !entry.name.endsWith('_test.go') &&
        !relative.includes('/__tests__/') &&
        !relative.includes('/compatibility/')
      ) {
        files.push(fullPath);
      }
    }
  };
  for (const root of roots) visit(path.join(repositoryRoot, root));
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
};

describe('browser credential hard cut', () => {
  test('deletes every obsolete credential/settings row without parsing or replacing it', () => {
    const deletes = obsoleteBrowserCredentialRows([
      {k: 'address', v: 'malformed'},
      {k: 'token', v: JSON.stringify('registry-secret')},
      {k: 'deepseekApiKey', v: JSON.stringify('deepseek-secret')},
      {k: 'speechSettings', v: JSON.stringify({volcengineApiKey: 'asr-secret'})},
      {k: 'ttsSettings', v: JSON.stringify({apiKey: 'tts-secret'})},
      {k: 'themeMode', v: JSON.stringify('light')},
    ]);

    expect(deletes.sort()).toEqual([
      'address',
      'deepseekApiKey',
      'speechSettings',
      'token',
      'ttsSettings',
    ]);
  });

  test('removes browser server settings persistence and scrubs obsolete rows before use', () => {
    const persistence = source('web/src/workspace/WorkspacePersistence.ts');
    const cleanup = source('web/src/compatibility/browserCredentialCleanup.ts');
    const app = source('web/src/app/WorkspaceApp.tsx');

    expect(persistence).not.toMatch(/PersistedGlobalState[\s\S]{0,1000}\b(?:address|token|deepseekApiKey|speechSettings|ttsSettings):/);
    expect(persistence).not.toContain('extractLegacyBackendSecrets');
    expect(persistence).not.toContain('getLegacyBackendSecrets');
    expect(persistence).not.toContain('clearLegacyBackendSecret');
    expect(cleanup).not.toMatch(/JSON\.parse|upload|migrate/i);
    expect(app.indexOf('scrubLegacyBrowserCredentials')).toBeLessThan(app.indexOf('new WorkspaceStore'));
  });

  test('keeps token out of the browser websocket connect chain', () => {
    const controller = source('web/src/workspace/WorkspaceController.ts');
    const service = source('web/src/registry/RegistryWorkspaceService.ts');
    const repository = source('web/src/registry/RegistryRepository.ts');
    const app = source('web/src/app/WorkspaceApp.tsx');

    expect(controller).toMatch(/connect\(wsUrl: string, options\?/);
    expect(service).toMatch(/connect\(wsUrl: string\)/);
    expect(repository).toMatch(/initialize\(url: string, clientName: RegistryClientName\)/);
    const initialize = repository.match(/async initialize[\s\S]*?\n  }/)?.[0] ?? '';
    expect(initialize).not.toMatch(/token/);
    expect(app).toContain('deriveRegistryEndpoints(document.baseURI');
    expect(app).not.toMatch(/Registry token \(optional\)|Registry address|setAddress\(|setToken\(/);
  });

  test('keeps retired backend key migration APIs out of production sources', () => {
    const production = productionSources();
    for (const retired of [
      'migrateLegacyBackendSecrets',
      'extractLegacyBackendSecrets',
      'getLegacyBackendSecrets',
      'clearLegacyBackendSecret',
      'retryBackendSecretMigration',
      'config.json.secrets',
    ]) {
      expect(production).not.toContain(retired);
    }
  });
});
