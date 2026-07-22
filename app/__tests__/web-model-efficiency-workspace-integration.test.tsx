import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {AppConfirmDialog, type ConfirmTarget} from '../web/src/shell/AppDialogs';

function renderedText(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('');
}

describe('model efficiency workspace integration', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
  const persistence = fs.readFileSync(path.join(root, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'), 'utf8');
  const dialogs = fs.readFileSync(path.join(root, 'web', 'src', 'shell', 'AppDialogs.tsx'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'web', 'src', 'modelEfficiency', 'modelEfficiencyStore.ts'), 'utf8');
  const model = fs.readFileSync(path.join(root, 'web', 'src', 'modelEfficiency', 'modelEfficiencyModel.ts'), 'utf8');

  test('defaults the independent Chat setting on and persists boolean changes', () => {
    expect(persistence).toContain('showModelEfficiency: boolean;');
    expect(persistence).toContain("showModelEfficiency: 'showModelEfficiency',");
    expect(persistence).toContain('showModelEfficiency: true,');
    expect(persistence).toContain(
      "showModelEfficiency: typeof input.showModelEfficiency === 'boolean' ? input.showModelEfficiency : base.showModelEfficiency",
    );
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.showModelEfficiency, v: serialize(this.state.global.showModelEfficiency), updatedAt}',
    );

    const chatStart = settings.indexOf("renderSettingsSection({id: 'chat'");
    const connectionStart = settings.indexOf("renderSettingsSection({id: 'connection'");
    const chatSection = settings.slice(chatStart, connectionStart);
    expect(chatSection).toContain('Show Model Efficiency');
    expect(chatSection).toContain('checked={showModelEfficiency}');
    expect(chatSection).toContain('setShowModelEfficiency(e.target.checked)');

    expect(main).toMatch(
      /typeof persistedGlobal\.showModelEfficiency === 'boolean'\r?\n\s*\? persistedGlobal\.showModelEfficiency\r?\n\s*: true/,
    );
    expect(main).toContain('showModelEfficiency={showModelEfficiency}');
    expect(main).toContain('setShowModelEfficiency={setShowModelEfficiency}');
    expect(main).toContain('showModelEfficiency,');
  });

  test('creates one frontend store, subscribes once, and performs only startup/manual refreshes', () => {
    expect(main).toContain('const modelEfficiencyStore = useMemo(() => new ModelEfficiencyStore(), []);');
    expect(main).toContain('modelEfficiencyStore.subscribe(setModelEfficiencySnapshot)');
    expect(main).toContain('void modelEfficiencyStore.refresh();');
    expect(store).toContain("https://codexradar.com/current.json");
    expect(store).not.toContain('localStorage');
    expect(store).not.toContain('sessionStorage');
    expect(store).not.toContain('setInterval');
    expect(store).not.toContain('setTimeout');
    expect(model).not.toContain('currentModel');
    expect(model).not.toContain('selectedModel');
  });

  test('mounts the desktop card on the right without joining left reservation logic', () => {
    expect(main).toContain("import {ModelEfficiencySurface} from '../modelEfficiency/ModelEfficiencySurface';");
    expect(main).toContain('isWide && !archivedMode && showModelEfficiency ? (');
    expect(main).toContain('<ModelEfficiencySurface');
    expect(main).toContain('snapshot={modelEfficiencySnapshot}');
    expect(main).toContain('onRefresh={() => void modelEfficiencyStore.refresh()}');

    const edgeVisibilityLine = main.split(/\r?\n/).find(line => line.includes('const showChatEdgeSurfaces')) ?? '';
    expect(edgeVisibilityLine).not.toContain('showModelEfficiency');

    const stackStart = main.indexOf('className={`chat-edge-surface-stack');
    const stackEnd = main.indexOf('</div>', stackStart);
    const leftStack = stackStart >= 0 && stackEnd >= 0 ? main.slice(stackStart, stackEnd) : '';
    expect(leftStack).not.toContain('ModelEfficiencySurface');
  });

  test('passes the same snapshot and manual refresh into the existing mobile dialog', () => {
    const overlayStart = main.indexOf('const mobileUsageOverlay = !isWide && mobileUsageOpen ? (');
    const overlayEnd = main.indexOf(') : null;', overlayStart);
    const overlay = overlayStart >= 0 && overlayEnd >= 0
      ? main.slice(overlayStart, overlayEnd)
      : '';
    expect(overlay).toContain('<MobileUsageDialog');
    expect(overlay).toContain('efficiencySnapshot={modelEfficiencySnapshot}');
    expect(overlay).toContain('onRefreshEfficiency={() => void modelEfficiencyStore.refresh()}');
  });

  test('routes hiding through the shared confirmation dialog and Settings recovery copy', () => {
    expect(dialogs).toContain("| {kind: 'hideModelEfficiency'}");
    expect(dialogs).toContain("if (target.kind === 'hideModelEfficiency') return 'Hide model efficiency?';");
    expect(dialogs).toContain("if (target.kind === 'hideModelEfficiency') return 'Hide';");
    expect(main).toContain("onRequestHide={() => setConfirmTarget({kind: 'hideModelEfficiency'})}");
    expect(main).toContain("if (confirmTarget.kind === 'hideModelEfficiency') {");
    expect(main).toContain('setShowModelEfficiency(false);');

    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <AppConfirmDialog
          target={{kind: 'hideModelEfficiency'} as ConfirmTarget}
          busy={false}
          error=""
          onCancel={jest.fn()}
          onPrimary={jest.fn()}
        />,
      );
    });
    expect(renderedText(view!.root)).toContain('You can show it again from Settings > Chat.');
  });
});
