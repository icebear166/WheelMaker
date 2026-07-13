import fs from 'fs';
import path from 'path';

describe('backend TTS boundary', () => {
  test('routes synthesis through Registry without browser credentials', () => {
    const root = path.resolve(__dirname, '..');
    const methods = fs.readFileSync(path.join(root, 'web/src/registry/registryMethods.ts'), 'utf8');
    const repository = fs.readFileSync(path.join(root, 'web/src/registry/RegistryRepository.ts'), 'utf8');
    const client = fs.readFileSync(path.join(root, 'web/src/features/tts/ttsClient.ts'), 'utf8');
    const settings = fs.readFileSync(path.join(root, 'web/src/features/tts/ttsSettings.ts'), 'utf8');

    expect(methods).toContain("TTSSynthesize: 'tts.synthesize'");
    expect(repository).toContain('synthesizeTTS');
    expect(client).not.toMatch(/Authorization|Bearer|fetch\s*\(/);
    expect(settings).not.toMatch(/apiKey|TTS_API_BASE/);
  });
});
