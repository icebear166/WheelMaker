import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

describe('web chat fixed 800px layout', () => {

  test('defines relaxed desktop session density and persists it without changing mobile density', () => {
    const projectRoot = path.join(__dirname, '..');
    const densityModulePath = path.join(projectRoot, 'web', 'src', 'chat', 'sessionListDensity.ts');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));
    const stylesCss = readWebStyles(projectRoot);

    expect(fs.existsSync(densityModulePath)).toBe(true);
    const density = require(densityModulePath) as {
      DEFAULT_SESSION_LIST_DENSITY: string;
      SESSION_LIST_DENSITY_OPTIONS: Array<{id: string; label: string}>;
      isSessionListDensity: (value: unknown) => boolean;
      normalizeSessionListDensity: (value: unknown, fallback?: string) => string;
    };
    expect(density.DEFAULT_SESSION_LIST_DENSITY).toBe('relaxed');
    expect(density.SESSION_LIST_DENSITY_OPTIONS).toEqual([
      {id: 'relaxed', label: 'Relaxed'},
      {id: 'compact', label: 'Compact'},
    ]);
    expect(density.isSessionListDensity('relaxed')).toBe(true);
    expect(density.isSessionListDensity('compact')).toBe(true);
    expect(density.isSessionListDensity('mobile')).toBe(false);
    expect(density.normalizeSessionListDensity('invalid')).toBe('relaxed');
    expect(density.normalizeSessionListDensity(undefined, 'compact')).toBe('compact');

    expect(persistence).toContain('sessionListDensity: SessionListDensity;');
    expect(persistence).toContain("sessionListDensity: 'sessionListDensity',");
    expect(persistence).toContain('sessionListDensity: DEFAULT_SESSION_LIST_DENSITY,');
    expect(persistence).toContain('sessionListDensity: normalizeSessionListDensity(input.sessionListDensity, base.sessionListDensity),');
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.sessionListDensity, v: serialize(this.state.global.sessionListDensity), updatedAt}',
    );

    expect(mainTsx).toContain('const [sessionListDensity, setSessionListDensity] = useState<SessionListDensity>(');
    expect(mainTsx).toContain('normalizeSessionListDensity(persistedGlobal.sessionListDensity)');
    expect(mainTsx).toContain('sessionListDensity,');
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(mainTsx).toContain('setSessionListDensity={setSessionListDensity}');
    expect(mainTsx).toContain('dataSessionListDensity={sessionListDensity}');

    expect(settingsRootTsx).toContain('sessionListDensity: SessionListDensity;');
    expect(settingsRootTsx).toContain('setSessionListDensity: (value: SessionListDensity) => void;');
    expect(settingsRootTsx).toContain('Session List Density');
    expect(settingsRootTsx).toContain('value={sessionListDensity}');
    expect(settingsRootTsx).toContain('if (isSessionListDensity(next)) setSessionListDensity(next);');
    expect(settingsRootTsx).toContain('SESSION_LIST_DENSITY_OPTIONS.map(item => (');
    const chatStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const densitySettingStart = settingsRootTsx.indexOf('Session List Density');
    expect(densitySettingStart).toBeGreaterThan(chatStart);
    expect(settingsRootTsx.slice(chatStart, densitySettingStart)).toContain('isWide ? (');

    const relaxedTokens = stylesCss.match(/\.wide-project-session-nav,[\s\S]*?\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(relaxedTokens).toContain('--sl-row-py: 5px;');
    expect(relaxedTokens).toContain('--sl-row-font: 12.5px;');
    const compactTokens = cssRuleBlock(stylesCss, '[data-session-list-density="compact"]');
    expect(compactTokens).toContain('--sl-row-py: 3px;');
    expect(compactTokens).toContain('--sl-row-font: 12px;');
    expect(cssRuleBlock(stylesCss, '.mobile-project-session-nav')).not.toContain('min-height: 30px;');
  });

  test('removes the chat view width setting and always uses the fixed 800px layout', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));

    expect(persistence).not.toContain('chatViewWidth');
    expect(settingsRootTsx).not.toContain('chatViewWidth');
    expect(settingsRootTsx).not.toContain('Chat View Width');
    expect(mainTsx).not.toContain('chatViewWidth');
    expect(mainTsx).toContain('const chatMainClassName = isWide');
    expect(mainTsx).toContain("`chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}`");
  });

  test('keeps fixed-width chat messages and composer together on desktop', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('className={chatMainClassName}');
    expect(mainTsx).toContain("'chat-view-content'");
    expect((mainTsx.match(/className="chat-view-content chat-empty-state-content"/g) ?? []).length).toBe(3);
    expect(mainTsx).toContain('className="chat-composer-content"');
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-view-content \{[\s\S]*width: min\(800px, 100%\);[\s\S]*margin-left: auto;[\s\S]*margin-right: auto;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-composer-content \{[\s\S]*width: min\(800px, 100%\);[\s\S]*margin-left: auto;[\s\S]*margin-right: auto;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main \{[\s\S]*--chat-scrollbar-gutter-width: 8px;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-composer \{[\s\S]*padding-left: 18px;[\s\S]*padding-right: calc\(8px \+ var\(--chat-scrollbar-gutter-width, 8px\)\);[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('.chat-view-width-fixed-800 .chat-scroll-bottom-button');
  });

  test('keeps fixed-width chat centered while preserving preview resize', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const shellTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'shell', 'ResponsiveShell.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const CHAT_FIXED_VIEW_WIDTH = 800;');
    expect(mainTsx).toContain('const desktopChatFixedPreview = isWide && chatPreviewOpen;');
    expect(mainTsx).toContain('const [chatFilePeekWidthResized, setChatFilePeekWidthResized] = useState(false);');
    expect(mainTsx).toContain('const fixedChatPreviewDefaultWidth = useMemo(() => {');
    expect(mainTsx).toContain('desktopChatFixedPreview && !chatFilePeekWidthResized');
    expect(mainTsx).toContain('setChatFilePeekWidthResized(true);');
    expect(mainTsx).toContain('clampChatFilePeekWidthForViewport(nextWidth, desktopChatFixedPreview);');
    expect(mainTsx).toContain('desktopChatFixedPreview={desktopChatFixedPreview}');
    expect(shellTsx).toContain('desktopChatFixedPreview: boolean;');
    expect(shellTsx).toContain("data-chat-fixed-preview={desktopChatFixedPreview ? 'true' : undefined}");
    const fixedWorkspace = cssRuleBlock(stylesCss, ".desktop-shell[data-chat-fixed-preview='true'] .workspace-right");
    const fixedPreviewPane = cssRuleBlock(stylesCss, ".desktop-shell[data-chat-fixed-preview='true'] .chat-preview-pane");
    expect(fixedWorkspace).not.toContain('flex: 0 0 800px;');
    expect(fixedPreviewPane).toContain('max-width: none;');
    expect(fixedPreviewPane).not.toContain('flex: 1 1 auto;');
    expect(fixedPreviewPane).not.toContain('width: auto;');
  });
});
