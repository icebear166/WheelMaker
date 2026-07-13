import fs from 'fs';
import path from 'path';

describe('monitor protocol retirement', () => {
  test('removes monitor methods and DTOs from the Web registry boundary', () => {
    const root = path.resolve(__dirname, '..');
    for (const relative of [
      'web/src/registry/registryMethods.ts',
      'web/src/registry/registryTypes.ts',
      'web/src/registry/RegistryRepository.ts',
    ]) {
      const source = fs.readFileSync(path.join(root, relative), 'utf8');
      expect(source).not.toMatch(/Monitor|monitor\.(?:listHub|status|log|db|action|restart)/);
    }
  });
});
