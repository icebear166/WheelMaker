import fs from 'fs';
import path from 'path';

describe('server settings protocol hard cut', () => {
  const root = path.resolve(__dirname, '..');

  test('uses server config methods and removes the obsolete secret protocol', () => {
    const methods = fs.readFileSync(path.join(root, 'web/src/registry/registryMethods.ts'), 'utf8');
    const types = fs.readFileSync(path.join(root, 'web/src/registry/registryTypes.ts'), 'utf8');
    const repository = fs.readFileSync(path.join(root, 'web/src/registry/RegistryRepository.ts'), 'utf8');

    expect(methods).toContain("ServerConfigGet: 'server.config.get'");
    expect(methods).toContain("ServerConfigUpdate: 'server.config.update'");
    expect(methods).not.toContain('security.secret.');
    expect(types).not.toContain('RegistrySecretStatus');
    expect(repository).toContain('getServerSettings');
    expect(repository).toContain('updateServerSettings');
    expect(repository).not.toContain('getSecretStatus');
    expect(repository).not.toContain('updateSecret');
  });
});
