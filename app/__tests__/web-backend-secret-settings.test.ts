import fs from 'fs';
import path from 'path';

describe('server settings', () => {
  const root = path.resolve(__dirname, '..');

  test('renders the Server section between Chat and Connection in the approved row order', () => {
    const settings = fs.readFileSync(path.join(root, 'web/src/settings/SettingsRootContent.tsx'), 'utf8');
    const chat = settings.indexOf("renderSettingsSection({id: 'chat'");
    const server = settings.indexOf("renderSettingsSection({id: 'server'");
    const connection = settings.indexOf("renderSettingsSection({id: 'connection'");
    const serverBlock = settings.slice(server, connection);

    expect(chat).toBeGreaterThanOrEqual(0);
    expect(server).toBeGreaterThan(chat);
    expect(connection).toBeGreaterThan(server);
    expect(serverBlock.indexOf('Voice Input')).toBeLessThan(serverBlock.indexOf('Text-to-Speech'));
    expect(serverBlock).toMatch(/Voice Input[\s\S]*Volcengine ASR Access Token[\s\S]*Model/);
    expect(serverBlock).toMatch(/Text-to-Speech[\s\S]*MiMo TTS API Key[\s\S]*Model[\s\S]*Voice/);
    expect(serverBlock).not.toContain('DeepSeek');
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
