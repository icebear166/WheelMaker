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
  const usageSurface = fs.readFileSync(path.join(root, 'web', 'src', 'usage', 'UsageFeatureSurface.tsx'), 'utf8');

  test('uses the shared Monitor preference without an independent IQ setting', () => {
    expect(persistence).toContain('showMonitor: boolean;');
    expect(persistence).not.toContain('showModelEfficiency: boolean;');
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.showMonitor, v: serialize(this.state.global.showMonitor), updatedAt}',
    );

    const chatStart = settings.indexOf('<SettingsSection id="chat"');
    const codeStart = settings.indexOf('<SettingsSection id="code"');
    const chatSection = settings.slice(chatStart, codeStart);
    expect(chatSection).toContain('Show Monitor');
    expect(chatSection).not.toContain('Show Model Efficiency');

    expect(main).toMatch(
      /typeof persistedGlobal\.showMonitor === 'boolean'\r?\n\s*\? persistedGlobal\.showMonitor\r?\n\s*: true/,
    );
    expect(main).toContain('showMonitor={showMonitor}');
    expect(main).toContain('setShowMonitor={setShowMonitor}');
    expect(main).not.toContain('showModelEfficiency={showModelEfficiency}');
  });

  test('creates one frontend store, subscribes once, and performs only startup/manual refreshes', () => {
    expect(main).toContain('const modelEfficiencyStore = useMemo(() => new ModelEfficiencyStore(), []);');
    expect(main).toContain('modelEfficiencyStore.subscribe(setModelEfficiencySnapshot)');
    expect(main).toContain('void modelEfficiencyStore.refresh();');
    expect(store).toContain("https://codexradar.com/data/intelligence-efficiency.json");
    expect(store).not.toContain('localStorage');
    expect(store).not.toContain('sessionStorage');
    expect(store).not.toContain('setInterval');
    expect(store).not.toContain('setTimeout');
    expect(model).not.toContain('currentModel');
    expect(model).not.toContain('selectedModel');
  });

  test('mounts IQ inside the shared desktop Monitor card', () => {
    expect(main).toContain("import {MonitorSurface} from '../usage/MonitorSurface';");
    expect(main).not.toContain("import {ModelEfficiencySurface} from '../modelEfficiency/ModelEfficiencySurface';");
    expect(main).toContain('showMonitor ? (');
    expect(main).toContain('<MonitorSurface');
    expect(main).toContain('efficiencySnapshot={modelEfficiencySnapshot}');
    expect(main).toContain('onRefreshIq={() => { void modelEfficiencyStore.refresh(); }}');

    const edgeVisibilityLine = main.split(/\r?\n/).find(line => line.includes('const showChatEdgeSurfaces')) ?? '';
    expect(edgeVisibilityLine).toContain('showMonitor');

    const stackStart = main.indexOf('className={`chat-edge-surface-stack');
    const stackEnd = main.indexOf('{isWide && chatSidebarCollapsed', stackStart);
    const leftStack = stackStart >= 0 && stackEnd >= 0 ? main.slice(stackStart, stackEnd) : '';
    expect(leftStack).toContain('MonitorSurface');
    expect(leftStack).not.toContain('UsageFeatureSurface');
    expect(leftStack).not.toContain('ModelEfficiencySurface');
  });

  test('removes the obsolete independent desktop card shells', () => {
    expect(fs.existsSync(path.join(
      root,
      'web',
      'src',
      'modelEfficiency',
      'ModelEfficiencySurface.tsx',
    ))).toBe(false);
    expect(usageSurface).not.toContain('export function UsageFeatureSurface');
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
    expect(dialogs).toContain("| {kind: 'hideMonitor'}");
    expect(dialogs).toContain("if (target.kind === 'hideMonitor') return 'Hide monitor?';");
    expect(dialogs).toContain("if (target.kind === 'hideMonitor') return 'Hide';");
    expect(main).toContain("onRequestHide={() => setConfirmTarget({kind: 'hideMonitor'})}");
    expect(main).toContain("if (confirmTarget.kind === 'hideMonitor') {");
    expect(main).toContain('setShowMonitor(false);');

    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <AppConfirmDialog
          target={{kind: 'hideMonitor'} as ConfirmTarget}
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
