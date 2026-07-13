import fs from 'fs';
import path from 'path';

describe('backend DeepSeek secret boundary', () => {
  test('browser repository never accepts or sends an API key', () => {
    const root = path.resolve(__dirname, '..');
    const repository = fs.readFileSync(path.join(root, 'web/src/registry/RegistryRepository.ts'), 'utf8');
    const method = repository.match(/async fetchDeepSeekTokenStats[\s\S]*?\n  }/)?.[0] ?? '';

    expect(method).toContain("'tokenStats', 'deepseekStats'");
    expect(method).not.toMatch(/apiKey/);
  });
});
