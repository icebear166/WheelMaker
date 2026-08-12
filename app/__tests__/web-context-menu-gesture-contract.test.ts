import fs from 'fs';
import path from 'path';

describe('web context menu gesture style contract', () => {
  test('locally suppresses selection and callout after the selectable text reset', () => {
    const projectRoot = path.join(__dirname, '..');
    const settingsCss = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const targetSelector = "[data-context-menu-target='true']";
    const targetRuleIndex = settingsCss.indexOf(targetSelector);
    const selectableResetIndex = settingsCss.indexOf('.chat-main-message *');

    expect(targetRuleIndex).toBeGreaterThan(selectableResetIndex);
    const targetRule = settingsCss.slice(targetRuleIndex, settingsCss.indexOf('}', targetRuleIndex));
    expect(targetRule).toContain('-webkit-touch-callout: none;');
    expect(targetRule).toContain('-webkit-user-select: none;');
    expect(targetRule).toContain('user-select: none;');
    expect(targetRule).not.toContain('.chat-main-message');
    expect(targetRule).not.toContain('.wm-shiki-line-content');
    expect(targetRule).not.toContain('.terminal-xterm-surface');

    const surfaceSelector = "[data-context-menu-surface='true']";
    const surfaceRuleIndex = settingsCss.indexOf(surfaceSelector);
    expect(surfaceRuleIndex).toBeGreaterThan(selectableResetIndex);
    const surfaceRule = settingsCss.slice(surfaceRuleIndex, settingsCss.indexOf('}', surfaceRuleIndex));
    expect(surfaceRule).toContain('-webkit-touch-callout: none;');
    expect(surfaceRule).toContain('-webkit-user-select: none;');
    expect(surfaceRule).toContain('user-select: none;');
  });

  test('routes Session and Project targets through the shared position contract', () => {
    const projectRoot = path.join(__dirname, '..');
    const workspaceApp = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const sessionList = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionListView.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(sessionList).toContain('useContextMenuTargetGesture');
    expect(sessionList).toContain('bindSessionContextMenu({projectId, sessionId: session.sessionId})');
    expect(sessionList).toContain('bindProjectContextMenu(projectId)');
    expect(workspaceApp).toContain('onOpenSessionContextMenu: openProjectSessionContextMenu');
    expect(workspaceApp).toContain('onOpenProjectContextMenu: openProjectContextMenu');
    expect(workspaceApp).not.toContain('PROJECT_PIN_LONG_PRESS_MS');
    expect(workspaceApp).not.toContain('PROJECT_SESSION_LONG_PRESS_MS');
    expect(workspaceApp).not.toContain('projectPinLongPressTimerRef');
    expect(workspaceApp).not.toContain('projectSessionLongPressTimerRef');
    expect(workspaceApp).toMatch(/className=\{`mobile-project-sheet[^\n]*\n\s+\{\.\.\.contextMenuSurfaceProps\}/);
    expect(workspaceApp).toMatch(/className=\{`wide-project-action-popover[^\n]*\n\s+\{\.\.\.contextMenuSurfaceProps\}/);

    const actionsStart = workspaceApp.indexOf("actionMenu.kind === 'actions' ? (");
    const actionsEnd = workspaceApp.indexOf(") : actionMenu.phase === 'agents' ? (", actionsStart);
    expect(actionsStart).toBeGreaterThanOrEqual(0);
    expect(actionsEnd).toBeGreaterThan(actionsStart);
    const actionsBlock = workspaceApp.slice(actionsStart, actionsEnd);
    expect(actionsBlock).toContain('Resume session');
    expect(actionsBlock).toContain('Pin Project');
    expect(actionsBlock).not.toContain('New Session');
  });

  test('keeps all Workspace-managed file result entry points on the shared binder', () => {
    const projectRoot = path.join(__dirname, '..');
    const workspaceApp = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(workspaceApp).toContain('const bindManagedFileContextMenu = useContextMenuTargetGesture<ManagedFileMenuTarget>');
    expect(workspaceApp).toMatch(/<a[\s\S]*?bindManagedFileContextMenu\(fileMenuTarget\)[\s\S]*?className=\{\[/);
    expect(workspaceApp).toMatch(/className=\{`preview-workbench-file-search-node file[\s\S]*?bindManagedFileContextMenu\(fileMenuTarget\)/);
    expect(workspaceApp).toMatch(/className=\{`quick-file-search-option[\s\S]*?bindManagedFileContextMenu\(fileMenuTarget\)/);
  });
});
