import fs from 'fs';
import path from 'path';

describe('backend secret protocol', () => {
  const root = path.resolve(__dirname, '..');

  test('exposes set-only status and update methods', () => {
    const methods = fs.readFileSync(path.join(root, 'web/src/registry/registryMethods.ts'), 'utf8');
    const types = fs.readFileSync(path.join(root, 'web/src/registry/registryTypes.ts'), 'utf8');
    const repository = fs.readFileSync(path.join(root, 'web/src/registry/RegistryRepository.ts'), 'utf8');

    expect(methods).toContain("SecuritySecretStatus: 'security.secret.status'");
    expect(methods).toContain("SecuritySecretUpdate: 'security.secret.update'");
    expect(types).toMatch(/RegistrySecretStatus[\s\S]*configured:\s*boolean/);
    expect(repository).toContain('getSecretStatus');
    expect(repository).toContain('updateSecret');
    expect(types).not.toMatch(/RegistrySecretStatus[\s\S]{0,240}(?:value|apiKey):/);
  });
});
