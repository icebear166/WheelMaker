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
    onFlickerLifecycle: jest.fn(),
    onFlickerSwitchMode: jest.fn(),
    onUpdateHubConfig: jest.fn().mockResolvedValue(undefined),
    onRequestWheelMakerUpdate: jest.fn(),
    onRequestNpmUpdate: jest.fn(),
    onScanSkills: jest.fn(),
    onScanAllIndexes: jest.fn(),
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

function opsView(patch: Partial<ChatHubOpsView> = {}): ChatHubOpsView {
  return {
    wheelMaker: {
      loading: false,
      pending: false,
      currentVersion: 'v1.2',
      actionLabel: 'Update Hub',
      actionVisible: true,
      updateAvailable: true,
      dotVariant: 'is-warn',
    },
    npm: {loading: false, pending: false, outdatedCount: 2},
    skills: {pending: false, error: ''},
    index: {pending: false, indexedCount: 1, totalCount: 2},
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
    .toEqual([['Settings'], ['Hub Ops'], ['Projects']]);
});

test('section accordion delegates toggling and renders the open section body', async () => {
  const {props, callbacks} = createHarness({expandedSections: {'hub-a': 'ops'}});
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const headers = sectionHeaders(renderer.root);
  expect(headers).toHaveLength(3);
  expect(headers[0].props['aria-expanded']).toBe(false);
  expect(headers[1].props['aria-expanded']).toBe(true);
  expect(renderer.root.findByProps({className: 'chat-hub-ops-grid'})).toBeTruthy();
  expect(renderer.root.findAllByProps({className: 'chat-hub-settings'})).toHaveLength(0);

  act(() => headers[0].props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'settings');
});

test('ops row invokes callbacks with the hub id and reflects availability', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'ops'},
    opsByHubId: {'hub-a': opsView()},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const buttons = renderer.root.findByProps({className: 'chat-hub-ops-grid'}).findAllByType('button');
  expect(buttons).toHaveLength(4);
  expect(buttons[0].findByProps({className: 'chat-hub-ops-button-label'}).children).toEqual(['Update Hub']);
  expect(buttons[0].props.disabled).toBe(false);
  expect(buttons[1].findByProps({className: 'chat-hub-ops-button-sub'}).children).toEqual(['2 available']);
  act(() => buttons[0].props.onClick());
  expect(callbacks.onRequestWheelMakerUpdate).toHaveBeenCalledWith('hub-a');
  act(() => buttons[1].props.onClick());
  expect(callbacks.onRequestNpmUpdate).toHaveBeenCalledWith('hub-a');
  act(() => buttons[2].props.onClick());
  expect(callbacks.onScanSkills).toHaveBeenCalledWith('hub-a');
  act(() => buttons[3].props.onClick());
  expect(callbacks.onScanAllIndexes).toHaveBeenCalledWith('hub-a');
});

test('ops row disables actions that are unavailable', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': 'ops'},
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: false,
          currentVersion: 'v1.2',
          actionLabel: 'Restart',
          actionVisible: false,
          updateAvailable: false,
          dotVariant: 'is-ok',
        },
        npm: {loading: false, pending: false, outdatedCount: 0},
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const buttons = renderer.root.findByProps({className: 'chat-hub-ops-grid'}).findAllByType('button');
  expect(buttons[0].props.disabled).toBe(true);
  expect(buttons[1].props.disabled).toBe(true);
  expect(buttons[1].findByProps({className: 'chat-hub-ops-button-sub'}).children).toEqual(['Up to date']);
});

test('settings section renders API key editors and the restart hint from hub config', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'settings'},
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

  expect(renderer.root.findByProps({role: 'switch'}).props['aria-checked']).toBe(true);
  expect(renderer.root.findAllByType('input')).toHaveLength(4);
  expect(renderer.root.findByProps({className: 'chat-hub-settings-hint'}).children)
    .toEqual(['API keys take effect after the hub restarts.']);

  act(() => renderer.root.findByProps({role: 'switch'}).props.onClick());
  expect(callbacks.onUpdateHubConfig).toHaveBeenCalledWith('hub-a', {
    section: 'flickerBridge',
    field: 'enabled',
    action: 'clear',
  });
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
  expect(renderer.root.findAllByProps({role: 'switch'})).toHaveLength(0);
});

test('projects section toggles project visibility', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'projects'},
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
