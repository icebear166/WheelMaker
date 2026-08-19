import {normalizeServerSettings} from './serverSettings';

describe('normalizeServerSettings', () => {
  test('keeps the optional personal Wiki URL from the server snapshot', () => {
    const settings = normalizeServerSettings({
      knowledgeRegistry: {publicUrl: 'https://wiki.example.com'},
    });

    expect(settings.knowledgeRegistry.publicUrl).toBe('https://wiki.example.com/');
  });

  test('ignores a missing or unsafe personal Wiki URL', () => {
    expect(normalizeServerSettings({}).knowledgeRegistry.publicUrl).toBeUndefined();
    expect(normalizeServerSettings({
      knowledgeRegistry: {publicUrl: 'javascript:alert(1)'},
    }).knowledgeRegistry.publicUrl).toBeUndefined();
  });
});
