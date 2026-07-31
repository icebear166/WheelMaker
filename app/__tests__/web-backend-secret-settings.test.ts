import fs from 'fs';
import path from 'path';

describe('server settings', () => {
  const root = path.resolve(__dirname, '..');

  test('renders voice and speech settings inside Chat in the approved row order', () => {
    const settings = fs.readFileSync(path.join(root, 'web/src/settings/SettingsRootContent.tsx'), 'utf8');
    const chat = settings.indexOf('<SettingsSection id="chat"');
    const code = settings.indexOf('<SettingsSection id="code"');
    const chatBlock = settings.slice(chat, code);

    expect(chat).toBeGreaterThanOrEqual(0);
    expect(code).toBeGreaterThan(chat);
    expect(chatBlock.indexOf('Voice Input Key')).toBeLessThan(chatBlock.indexOf('Voice Input Model'));
    expect(chatBlock.indexOf('Voice Input Model')).toBeLessThan(chatBlock.indexOf('Speech Key'));
    expect(chatBlock.indexOf('Speech Key')).toBeLessThan(chatBlock.indexOf('Speech Model'));
    expect(chatBlock.indexOf('Speech Model')).toBeLessThan(chatBlock.indexOf('Speech Voice'));
    expect(chatBlock).toMatch(/Voice Input Key[\s\S]*configured=\{serverSettings\.voiceInput\.configured\}/);
    expect(chatBlock).toMatch(/Speech Key[\s\S]*configured=\{serverSettings\.textToSpeech\.configured\}/);
    expect(chatBlock).not.toContain('DeepSeek');
  });

  test('renders set-only password editors and never binds a server secret value', () => {
    const editor = fs.readFileSync(path.join(root, 'web/src/common/SecretEditor.tsx'), 'utf8');
    const settings = fs.readFileSync(path.join(root, 'web/src/settings/SettingsRootContent.tsx'), 'utf8');

    expect(settings).toContain('SecretEditor');
    expect(editor).toContain('Configured');
    expect(editor).toContain('Not configured');
    expect(editor).toContain('type="password"');
    expect(editor).toContain("useState('')");
    expect(editor).not.toMatch(/(?:apiKey|accessToken|secret)\.value/);
    expect(editor).not.toContain('BackendSecretEditor');
    expect(editor).not.toContain('retryBackendSecretMigration');
  });
});
