import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

// The suite runs in the node environment; createPortal is mocked to render
// inline, so a minimal document stub satisfies the component's SSR guard.
(globalThis as {document?: unknown}).document = {body: {}};

import {ChatHubMenu, type ChatHubMenuProps, type ChatHubOpsView} from './ChatHubMenu';

function createHarness(overrides: Partial<ChatHubMenuProps> = {}) {
  const callbacks = {
    onToggle: jest.fn(),
    onClose: jest.fn(),
    onToggleHub: jest.fn(),
    onToggleSection: jest.fn(),
    onToggleColorMenu: jest.fn(),
    onFlickerSwitchMode: jest.fn(),
    onUpdateHubConfig: jest.fn().mockResolvedValue(undefined),
    onRequestWheelMakerUpdate: jest.fn(),
    onRequestNpmUpdate: jest.fn(),
    onPackageAction: jest.fn(),
    onScanSkills: jest.fn(),
    onScanAllIndexes: jest.fn(),
    onScanProject: jest.fn(),
    onToggleAllProjects: jest.fn(),
    onUpdateAllHubs: jest.fn(),
    onToggleProject: jest.fn(),
  };
  const props: ChatHubMenuProps = {
    mobile: false,
    open: true,
    exiting: false,
    summaryLabel: '1 Hub',
    projectLabel: '2 Projects',
    hubIds: ['hub-a'],
    treeItems: [{
      hubId: 'hub-a',
      projects: [
        {projectId: 'hub-a:p1', name: 'p1'},
        {projectId: 'hub-a:p2', name: 'p2'},
      ],
    }],
    popoverStyle: undefined,
    menuRef: React.createRef(),
    popoverRef: React.createRef(),
    expandedHubIds: ['hub-a'],
    expandedSections: {},
    hubColors: {},
    setHubColors: jest.fn(),
    hubAccentStyle: () => ({}) as React.CSSProperties,
    colorMenuHubId: null,
    colorMenuExiting: false,
    flickerStatuses: {},
    flickerActionHubId: '',
    hubConfigByHubId: {},
    opsByHubId: {},
    hiddenProjectIdSet: new Set<string>(),
    latestVersion: '-',
    updateAllAvailableCount: 0,
    updateAllPending: false,
    ...callbacks,
    ...overrides,
  };
  return {props, callbacks};
}

function sectionHeaders(root: TestRenderer.ReactTestInstance) {
  return root.findAll(
    node => typeof node.props.className === 'string' && node.props.className.startsWith('chat-hub-section-header'),
  );
}

function actionMains(root: TestRenderer.ReactTestInstance) {
  return root.findAll(
    node => typeof node.props.className === 'string' && node.props.className === 'chat-hub-action-main',
  );
}

function actionMainByLabel(root: TestRenderer.ReactTestInstance, label: string) {
  return actionMains(root).find(button =>
    button.findAllByProps({className: 'chat-hub-action-label'})
      .some(node => node.children.includes(label)),
  );
}

function opsView(patch: Partial<ChatHubOpsView> = {}): ChatHubOpsView {
  return {
    wheelMaker: {
      loading: false,
      pending: false,
      currentVersion: 'v1.2',
      actionLabel: 'Update Hub',
      actionVisible: true,
      updateAvailable: true,
    },
    npm: {loading: false, pending: false, outdatedCount: 2, packages: []},
    skills: {pending: false, error: '', count: 0},
    index: {pending: false, indexedCount: 1, totalCount: 2, projects: []},
    ...patch,
  };
}

test('toggling the summary button calls onToggle and renders hub rows', async () => {
  const {props, callbacks} = createHarness();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  act(() => {
    renderer.root.findByProps({className: 'chat-hub-summary-button'}).props.onClick();
  });
  expect(callbacks.onToggle).toHaveBeenCalled();
  expect(renderer.root.findByProps({className: 'chat-hub-row-name'}).children).toEqual(['hub-a']);
  expect(sectionHeaders(renderer.root).map(header => header.findByProps({className: 'chat-hub-section-label'}).children))
    .toEqual([['Settings']]);
  expect(renderer.root.findAllByProps({className: 'chat-hub-line-label'})
    .map(label => label.children)).toEqual([['Hub'], ['Projects']]);
});

test('settings accordion delegates toggling and detail ids open their detail', async () => {
  const {props, callbacks} = createHarness({expandedSections: {'hub-a': 'npm'}});
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const headers = sectionHeaders(renderer.root);
  expect(headers).toHaveLength(1);
  expect(headers[0].props['aria-expanded']).toBe(false);
  expect(renderer.root.findAllByProps({className: 'chat-hub-settings'})).toHaveLength(0);
  expect(renderer.root.findByProps({className: 'chat-hub-detail'})).toBeTruthy();

  act(() => headers[0].props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'settings');
});

test('hub row renders version summary and action buttons; main clicks fire actions without expanding', async () => {
  const {props, callbacks} = createHarness({
    opsByHubId: {'hub-a': opsView()},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-section-version-dot'})).toBeTruthy();
  const mains = actionMains(renderer.root);
  expect(mains[0].findByProps({className: 'chat-hub-action-label'}).children).toEqual(['Update Hub']);
  const toggles = renderer.root.findAllByProps({className: 'chat-hub-action-toggle'});
  expect(toggles.map(toggle => toggle.props['aria-label']))
    .toEqual(['NPM details', 'Skills details', 'Visibility details', 'Scan details']);

  act(() => mains[0].props.onClick());
  expect(callbacks.onRequestWheelMakerUpdate).toHaveBeenCalledWith('hub-a');
  expect(callbacks.onToggleSection).not.toHaveBeenCalled();

  const npmMain = actionMainByLabel(renderer.root, 'NPM');
  act(() => npmMain!.props.onClick());
  expect(callbacks.onRequestNpmUpdate).toHaveBeenCalledWith('hub-a');
  const skillsMain = actionMainByLabel(renderer.root, 'Skills');
  act(() => skillsMain!.props.onClick());
  expect(callbacks.onScanSkills).toHaveBeenCalledWith('hub-a');

  act(() => toggles[0].props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'npm');
});

test('hub row disables unavailable actions', async () => {
  const {props} = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: false,
          currentVersion: 'v1.2',
          actionLabel: 'Restart',
          actionVisible: false,
          updateAvailable: false,
        },
        npm: {loading: false, pending: false, outdatedCount: 0, packages: []},
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const mains = actionMains(renderer.root);
  expect(mains[0].findByProps({className: 'chat-hub-action-label'}).children).toEqual(['Restart']);
  expect(mains[0].props.disabled).toBe(true);
  const npmMain = actionMainByLabel(renderer.root, 'NPM');
  expect(npmMain!.props.disabled).toBe(true);
});

test('npm detail lists packages with Update/Install plus Uninstall and no reinstall', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'npm'},
    opsByHubId: {
      'hub-a': opsView({
        npm: {
          loading: false, pending: false, outdatedCount: 1,
          packages: [
            {packageName: '@a/one', displayName: 'One', installedVersion: '1.0', latestVersion: '1.1', action: 'update', canUninstall: true, pending: false},
            {packageName: '@a/two', displayName: 'Two', installedVersion: '', latestVersion: '2.0', action: 'install', canUninstall: false, pending: false},
          ],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const rows = renderer.root.findAllByProps({className: 'chat-hub-npm-row'});
  expect(rows).toHaveLength(2);
  expect(rows[0].findByProps({className: 'chat-hub-npm-versions'}).children.join('')).toContain('1.0');
  const rowButtons = rows.map(row => row.findAllByType('button').map(button => button.children.join('')));
  expect(rowButtons[0][0]).toBe('Update');
  expect(rowButtons[1][0]).toBe('Install');
  expect(JSON.stringify(rowButtons)).not.toContain('Reinstall');
  act(() => rows[0].findAllByType('button')[0].props.onClick());
  expect(callbacks.onPackageAction).toHaveBeenCalledWith('hub-a', 'update', expect.objectContaining({packageName: '@a/one'}));
  act(() => rows[1].findAllByType('button')[0].props.onClick());
  expect(callbacks.onPackageAction).toHaveBeenCalledWith('hub-a', 'install', expect.objectContaining({packageName: '@a/two'}));
  expect(rows[0].findByProps({'aria-label': 'Uninstall One'})).toBeTruthy();
  expect(rows[1].findAllByProps({'aria-label': 'Uninstall Two'})).toHaveLength(0);
  act(() => rows[0].findByProps({'aria-label': 'Uninstall One'}).props.onClick());
  expect(callbacks.onPackageAction).toHaveBeenCalledWith('hub-a', 'uninstall', expect.objectContaining({packageName: '@a/one'}));
});

test('projects row split buttons drive visibility and scan', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'scan'},
    hiddenProjectIdSet: new Set<string>(['hub-a:p2']),
    opsByHubId: {
      'hub-a': opsView({
        index: {
          pending: false, indexedCount: 1, totalCount: 2,
          projects: [
            {projectId: 'hub-a:p1', name: 'p1', status: 'indexed', pending: false},
            {projectId: 'hub-a:p2', name: 'p2', status: 'missing', pending: true},
          ],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const toggles = renderer.root.findAllByProps({className: 'chat-hub-action-toggle'});
  const labels = toggles.map(toggle => toggle.props['aria-label']);
  expect(labels).toEqual(expect.arrayContaining(['Visibility details', 'Scan details']));

  const scanRows = renderer.root.findAllByProps({className: 'chat-hub-scan-row'});
  expect(scanRows).toHaveLength(2);
  expect(scanRows[1].findByProps({'aria-label': 'Scan p2'}).props.disabled).toBe(true);
  act(() => scanRows[0].findByProps({'aria-label': 'Scan p1'}).props.onClick());
  expect(callbacks.onScanProject).toHaveBeenCalledWith('hub-a', 'hub-a:p1');

  const scanMain = actionMainByLabel(renderer.root, 'Scan');
  act(() => scanMain!.props.onClick());
  expect(callbacks.onScanAllIndexes).toHaveBeenCalledWith('hub-a');

  const visibilityMain = actionMains(renderer.root)
    .find(button => button.props['aria-label'] === 'Show all projects');
  act(() => visibilityMain!.props.onClick());
  expect(callbacks.onToggleAllProjects).toHaveBeenCalledWith('hub-a', true);
});

test('visibility detail toggles project visibility', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'visibility'},
    hiddenProjectIdSet: new Set<string>(['hub-a:p2']),
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const rows = renderer.root.findAll(
    node => typeof node.props.className === 'string' && node.props.className.startsWith('chat-hub-project-row'),
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].props['aria-checked']).toBe(true);
  expect(rows[1].props['aria-checked']).toBe(false);
  act(() => rows[0].props.onClick({stopPropagation: jest.fn()}));
  expect(callbacks.onToggleProject).toHaveBeenCalledWith('hub-a:p1', false);
});

test('footer shows latest version and update-all action', async () => {
  const {props, callbacks} = createHarness({
    latestVersion: 'v1.3',
    updateAllAvailableCount: 1,
    updateAllPending: false,
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });
  const footer = renderer.root.findByProps({className: 'chat-hub-footer'});
  expect(footer.findByProps({className: 'chat-hub-footer-version-value'}).children).toEqual(['v1.3']);
  const button = footer.findByProps({className: 'chat-hub-footer-update-all'});
  expect(button.props.disabled).toBe(false);
  act(() => button.props.onClick());
  expect(callbacks.onUpdateAllHubs).toHaveBeenCalled();

  const exhausted = createHarness({latestVersion: 'v1.3'});
  let exhaustedRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    exhaustedRenderer = TestRenderer.create(<ChatHubMenu {...exhausted.props} />);
  });
  expect(exhaustedRenderer.root.findByProps({className: 'chat-hub-footer-update-all'}).props.disabled).toBe(true);
});

test('settings section renders the flicker segment row and compact key editors', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'settings'},
    flickerStatuses: {
      'hub-a': {
        configured: true,
        supported: true,
        state: 'stopped',
        mode: 'v1',
        availableModes: ['v1', 'v2'],
        modeErrors: {},
        endpoint: 'http://127.0.0.1:17999',
        port: 17999,
      },
    },
    hubConfigByHubId: {
      'hub-a': {
        loading: false,
        error: '',
        busyField: '',
        data: {
          flickerBridge: {mode: 'v1', enabled: true},
          apiKeys: {
            kimi: {configured: true, updatedAt: '2026-07-29T12:00:00Z'},
          },
        },
      },
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  // Off/V1/V2 segmented control: enabled + mode v1 → V1 selected, Off clickable.
  const off = renderer.root.findByProps({'aria-label': 'Disable Flicker Bridge'});
  expect(off.props['aria-pressed']).toBe(false);
  expect(renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V1'}).props['aria-pressed']).toBe(true);
  act(() => off.props.onClick());
  expect(callbacks.onUpdateHubConfig).toHaveBeenCalledWith('hub-a', {
    section: 'flickerBridge',
    field: 'enabled',
    action: 'clear',
  });

  // Mode switch while enabled goes through the flicker action path.
  act(() => renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V2'}).props.onClick());
  expect(callbacks.onFlickerSwitchMode).toHaveBeenCalledWith('hub-a', 'v2');

  // Off/V1/V2 is the only lifecycle control; no contradictory runtime toggle.
  expect(renderer.root.findAllByProps({'aria-label': 'Start Flicker Bridge'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({'aria-label': 'Stop Flicker Bridge'})).toHaveLength(0);

  // Compact key rows: status icon instead of a "Not configured" label line.
  expect(renderer.root.findAllByType('input')).toHaveLength(4);
  expect(renderer.root.findAll(
    node => typeof node.props.className === 'string' && node.props.className.startsWith('secret-compact-status'),
  )).toHaveLength(4);
  expect(renderer.root.findAll(
    node => node.children.includes('Not configured'),
  )).toHaveLength(0);
  expect(renderer.root.findByProps({className: 'chat-hub-settings-hint'}).children)
    .toEqual(['Changes apply automatically.']);
});

test('flicker segment disables unavailable modes and surfaces the inline error', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': 'settings'},
    flickerStatuses: {
      'hub-a': {
        configured: true,
        supported: true,
        state: 'running',
        mode: 'v1',
        runningMode: 'v1',
        availableModes: ['v1'],
        modeErrors: {v2: 'Node.js 22 is required'},
        endpoint: 'http://127.0.0.1:17999',
        port: 17999,
      },
    },
    hubConfigByHubId: {
      'hub-a': {
        loading: false,
        error: '',
        busyField: '',
        data: {flickerBridge: {mode: 'v1', enabled: true}, apiKeys: {}},
      },
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V2'}).props).toMatchObject({
    disabled: true,
    title: 'Node.js 22 is required',
  });
  expect(renderer.root.findByProps({className: 'chat-hub-settings-hint error'}).children)
    .toEqual(['V2 unavailable · Node.js 22 is required']);
  expect(renderer.root.findAllByProps({'aria-label': 'Stop Flicker Bridge'})).toHaveLength(0);
});

test('collapsed settings summary shows the flicker mode with a mark', async () => {
  const enabled = createHarness({
    flickerStatuses: {
      'hub-a': {
        configured: true,
        supported: true,
        state: 'running',
        mode: 'v2',
        runningMode: 'v2',
        availableModes: ['v1', 'v2'],
        modeErrors: {},
        endpoint: 'http://127.0.0.1:17999',
        port: 17999,
      },
    },
    hubConfigByHubId: {
      'hub-a': {
        loading: false,
        error: '',
        busyField: '',
        data: {flickerBridge: {mode: 'v2', enabled: true}, apiKeys: {}},
      },
    },
  });
  let enabledRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    enabledRenderer = TestRenderer.create(<ChatHubMenu {...enabled.props} />);
  });
  const marks = enabledRenderer.root.findAll(
    node => typeof node.type === 'string' &&
      typeof node.props.className === 'string' && node.props.className.includes('chat-hub-summary-mark'),
  );
  expect(marks).toHaveLength(1);
  expect(marks[0].props.className).toContain('ok');

  const disabled = createHarness({
    hubConfigByHubId: {
      'hub-a': {
        loading: false,
        error: '',
        busyField: '',
        data: {flickerBridge: {mode: 'v1', enabled: false}, apiKeys: {}},
      },
    },
  });
  let disabledRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    disabledRenderer = TestRenderer.create(<ChatHubMenu {...disabled.props} />);
  });
  const offHeader = disabledRenderer.root.findAll(
    node => typeof node.props.className === 'string' && node.props.className.startsWith('chat-hub-section-summary'),
  )[0];
  expect(offHeader.children).toContain('Off');
  const offMark = disabledRenderer.root.findAll(
    node => typeof node.type === 'string' &&
      typeof node.props.className === 'string' && node.props.className.includes('chat-hub-summary-mark'),
  )[0];
  expect(offMark.props.className).not.toContain('ok');
});

test('ops summary shows a red dot on the version only when an update is available', async () => {
  const {props} = createHarness({opsByHubId: {'hub-a': opsView()}});
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });
  expect(renderer.root.findByProps({className: 'chat-hub-section-version-dot'})).toBeTruthy();
  expect(renderer.root.findAll(
    node => typeof node.props.className === 'string' && node.props.className.includes('chat-hub-section-badge'),
  )).toHaveLength(0);

  const current = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: false,
          currentVersion: 'v1.2',
          actionLabel: 'Restart',
          actionVisible: true,
          updateAvailable: false,
        },
      }),
    },
  });
  let currentRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    currentRenderer = TestRenderer.create(<ChatHubMenu {...current.props} />);
  });
  expect(currentRenderer.root.findAllByProps({className: 'chat-hub-section-version-dot'})).toHaveLength(0);
});

test('settings section surfaces the unsupported-hub message', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': 'settings'},
    hubConfigByHubId: {
      'hub-a': {loading: false, error: 'This hub does not support hub configuration yet.', busyField: '', data: null},
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-settings-hint error'}).children)
    .toEqual(['This hub does not support hub configuration yet.']);
  expect(renderer.root.findAllByType('input')).toHaveLength(0);
  expect(renderer.root.findAllByProps({'aria-label': 'Disable Flicker Bridge'})).toHaveLength(0);
});

test('mobile renders the fullscreen page and back closes it', async () => {
  const {props, callbacks} = createHarness({mobile: true});
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-page'})).toBeTruthy();
  act(() => renderer.root.findByProps({className: 'chat-hub-page-back'}).props.onClick());
  expect(callbacks.onClose).toHaveBeenCalled();
});

test('desktop palette stays a flyout and forces popover no-overflow; mobile palette is inline', async () => {
  const desktop = createHarness({colorMenuHubId: 'hub-a'});
  let desktopRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    desktopRenderer = TestRenderer.create(<ChatHubMenu {...desktop.props} />);
  });
  const popover = desktopRenderer.root.find(
    node => typeof node.props.className === 'string' && node.props.className.includes('chat-hub-popover'),
  );
  expect(popover.props.className).toContain('no-overflow');
  const flyout = desktopRenderer.root.find(
    node => typeof node.props.className === 'string' && node.props.className.includes('chat-hub-color-palette'),
  );
  expect(flyout.props.className).not.toContain('inline');

  const mobile = createHarness({mobile: true, colorMenuHubId: 'hub-a'});
  let mobileRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    mobileRenderer = TestRenderer.create(<ChatHubMenu {...mobile.props} />);
  });
  const inline = mobileRenderer.root.find(
    node => typeof node.props.className === 'string' && node.props.className.includes('chat-hub-color-palette'),
  );
  expect(inline.props.className).toContain('inline');
});
