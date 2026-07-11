import fs from 'fs';
import path from 'path';

describe('web hide tool calls setting', () => {
  test('persists a default-on setting and skips tool entries only while rendering chat', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const chatTurnTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'chat', 'ChatTurnView.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const workspacePersistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(workspacePersistence).toContain('hideToolCalls: boolean;');
    expect(workspacePersistence).toContain("hideToolCalls: 'hideToolCalls',");
    expect(workspacePersistence).toContain('hideToolCalls: true,');
    expect(workspacePersistence).toContain(
      "hideToolCalls: typeof input.hideToolCalls === 'boolean' ? input.hideToolCalls : base.hideToolCalls",
    );
    expect(workspacePersistence).toContain(
      'const rows = globalRowsForPatch(patch, next, now);',
    );
    expect(workspacePersistence).toContain(
      '{k: GLOBAL_KEYS.hideToolCalls, v: serialize(this.state.global.hideToolCalls), updatedAt}',
    );

    expect(mainTsx).toContain('const [hideToolCalls, setHideToolCalls] = useState(');
    expect(mainTsx).toMatch(
      /typeof persistedGlobal\.hideToolCalls === 'boolean'\r?\n\s*\? persistedGlobal\.hideToolCalls\r?\n\s*: true/,
    );
    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'chat'");
    const chatSettingsStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const hideToolCallsSettingStart = settingsRootTsx.indexOf('Hide Tool Calls', chatSettingsStart);
    expect(settingsRootTsx).not.toContain('Use Latest Prompt Title');
    expect(hideToolCallsSettingStart).toBeGreaterThan(chatSettingsStart);
    expect(mainTsx).not.toContain('checked={useLatestPromptTitle}');
    expect(mainTsx).not.toContain('onChange={e => setUseLatestPromptTitle(e.target.checked)}');
    expect(settingsRootTsx).toContain('Hide Tool Calls');
    expect(mainTsx).toContain('hideToolCalls={hideToolCalls}');
    expect(chatTurnTsx).toMatch(
      /if \(hideToolCalls && kind === 'tool'\) \{\s*return null;\s*\}/,
    );

    const turnStart = chatTurnTsx.indexOf('export const ChatTurnView = React.memo(function ChatTurnView(');
    const turnEnd = chatTurnTsx.indexOf('});', turnStart);
    expect(turnStart).toBeGreaterThanOrEqual(0);
    expect(turnEnd).toBeGreaterThan(turnStart);
    const turnView = chatTurnTsx.slice(turnStart, turnEnd);
    expect(turnView).toContain("if (kind === 'tool') {");
    expect(turnView).not.toContain('groupChatMessagesByPrompt');
  });
});
