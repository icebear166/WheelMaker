import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web mobile enter key settings', () => {
  test('defines send as the default mobile enter key behavior', () => {
    const projectRoot = path.join(__dirname, '..');
    const chatBehaviorPath = path.join(projectRoot, 'web', 'src', 'chat', 'mobileEnterKeyBehavior.ts');

    expect(fs.existsSync(chatBehaviorPath)).toBe(true);
    const chatBehaviorTs = readSourceText(chatBehaviorPath);
    expect(chatBehaviorTs).toContain("export type MobileEnterKeyBehavior = 'send' | 'newline';");
    expect(chatBehaviorTs).toContain("export const DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR: MobileEnterKeyBehavior = 'send';");
    expect(chatBehaviorTs).toContain("{id: 'send', label: 'Send'}");
    expect(chatBehaviorTs).toContain("{id: 'newline', label: 'New Line'}");
    expect(chatBehaviorTs).toContain('export function isMobileEnterKeyBehavior');
    expect(chatBehaviorTs).toContain('export function normalizeMobileEnterKeyBehavior');
  });

  test('persists mobile enter key behavior and exposes it in Chat settings', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));

    expect(persistence).toContain('mobileEnterKeyBehavior: MobileEnterKeyBehavior;');
    expect(persistence).toContain("mobileEnterKeyBehavior: 'mobileEnterKeyBehavior',");
    expect(persistence).toContain('mobileEnterKeyBehavior: DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR,');
    expect(persistence).toContain('mobileEnterKeyBehavior: normalizeMobileEnterKeyBehavior(input.mobileEnterKeyBehavior, base.mobileEnterKeyBehavior),');
    expect(persistence).toContain('const rows = globalRowsForPatch(patch, next, now);');
    expect(persistence).toContain('{k: GLOBAL_KEYS.mobileEnterKeyBehavior, v: serialize(this.state.global.mobileEnterKeyBehavior), updatedAt}');

    expect(mainTsx).toContain('const [mobileEnterKeyBehavior, setMobileEnterKeyBehavior] = useState<MobileEnterKeyBehavior>(');
    expect(mainTsx).toContain('normalizeMobileEnterKeyBehavior(persistedGlobal.mobileEnterKeyBehavior)');
    expect(mainTsx).toContain('mobileEnterKeyBehavior,');
    expect(mainTsx).toContain('mobileEnterKeyBehavior={mobileEnterKeyBehavior}');
    expect(mainTsx).toContain('setMobileEnterKeyBehavior={setMobileEnterKeyBehavior}');

    expect(settingsRootTsx).toContain('mobileEnterKeyBehavior: MobileEnterKeyBehavior;');
    expect(settingsRootTsx).toContain('setMobileEnterKeyBehavior: (value: MobileEnterKeyBehavior) => void;');
    expect(settingsRootTsx).toContain('Mobile Enter Key');
    expect(settingsRootTsx).toContain('value={mobileEnterKeyBehavior}');
    expect(settingsRootTsx).toContain('if (isMobileEnterKeyBehavior(next)) setMobileEnterKeyBehavior(next);');
    expect(settingsRootTsx).toContain('MOBILE_ENTER_KEY_BEHAVIOR_OPTIONS.map(item => (');
    expect(settingsRootTsx).toContain('{!isWide ? (');

    const chatStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const connectionStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'connection'", chatStart);
    const settingStart = settingsRootTsx.indexOf('Mobile Enter Key');
    const mobileOnlyStart = settingsRootTsx.lastIndexOf('{!isWide ? (', settingStart);
    const mobileOnlyEnd = settingsRootTsx.indexOf(') : null}', settingStart);
    expect(chatStart).toBeGreaterThanOrEqual(0);
    expect(connectionStart).toBeGreaterThan(chatStart);
    expect(settingStart).toBeGreaterThan(chatStart);
    expect(settingStart).toBeLessThan(connectionStart);
    expect(mobileOnlyStart).toBeGreaterThan(chatStart);
    expect(mobileOnlyStart).toBeLessThan(settingStart);
    expect(mobileOnlyEnd).toBeGreaterThan(settingStart);
    expect(mobileOnlyEnd).toBeLessThan(connectionStart);
  });

  test('uses mobile enter preference for keyboard hint and plain Enter send ownership', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("enterKeyHint={isWide ? undefined : mobileEnterKeyBehavior === 'send' ? 'send' : 'enter'}");
    expect(mainTsx).toContain("const shouldSendChatOnEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing;");
    expect(mainTsx).toContain("const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';");
    expect(mainTsx).toContain('if (mobileEnterShouldSend || isWindowsPlatform) {');
    expect(mainTsx).toContain('event.preventDefault();');
    expect(mainTsx).toContain('sendChatMessage().catch(() => undefined);');
  });
});
