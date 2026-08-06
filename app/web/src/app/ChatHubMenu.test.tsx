import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {Icon} from '../common/Icon';

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({children}: {children?: React.ReactNode}) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// The suite runs in the node environment; createPortal is mocked to render
// inline, so a minimal document stub satisfies the component's SSR guard.
(globalThis as {document?: unknown}).document = {body: {}};

import {
  ChatHubMenu,
  toggleChatHubDetailSections,
  type ChatHubMenuProps,
  type ChatHubOpsView,
} from './ChatHubMenu';

function createHarness(overrides: Partial<ChatHubMenuProps> = {}) {
  const callbacks = {
    onToggle: jest.fn(),
    onClose: jest.fn(),
    onCloseSkillSurface: jest.fn(),
    onToggleHub: jest.fn(),
    onToggleSection: jest.fn(),
    onToggleColorMenu: jest.fn(),
    onFlickerSwitchMode: jest.fn(),
    onUpdateHubConfig: jest.fn().mockResolvedValue(undefined),
    onRequestWheelMakerUpdate: jest.fn(),
    onRequestWheelMakerRestart: jest.fn(),
    onRequestGatewayUpdate: jest.fn(),
    onRequestNpmUpdate: jest.fn(),
    onPackageAction: jest.fn(),
    onRequestSkillInstall: jest.fn(),
    onRequestSkillDetail: jest.fn(),
    onRequestSkillUpdate: jest.fn(),
    onRequestSkillUninstall: jest.fn(),
    onRequestSkillBatchUninstall: jest.fn(),
    onRetrySkills: jest.fn(),
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
    activeProjectId: 'hub-a:p1',
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
    skillSurface: null,
    skillInstall: {
      sourceInput: '',
      onSourceInputChange: jest.fn(),
      sourceLoading: false,
      sourceError: '',
      candidates: [],
      selectedNames: [],
      onList: jest.fn().mockResolvedValue(undefined),
      onToggleAll: jest.fn(),
      onToggleCandidate: jest.fn(),
      onInstall: jest.fn(),
    },
    skillDetail: {
      entries: {},
      pendingKey: '',
      onUninstall: jest.fn(),
    },
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
      pendingAction: null,
      currentVersion: 'v1.2',
      updateVisible: true,
      restartVisible: true,
      updateAvailable: true,
    },
    gateway: {
      loading: false,
      pending: false,
      pendingAction: null,
      currentVersion: '-',
      updateVisible: false,
      updateAvailable: false,
    },
    npm: {
      loading: false,
      pending: false,
      outdatedCount: 2,
      myFlickerAvailable: false,
      packages: [],
    },
    skills: {
      loading: false,
      operationRunning: false,
      error: '',
      pendingKey: '',
      hubItems: [],
      projects: [],
    },
    index: {pending: false, indexedCount: 1, totalCount: 2, projects: []},
    ...patch,
  };
}

function flickerOpsView(): ChatHubOpsView {
  return opsView({
    npm: {
      loading: false,
      pending: false,
      outdatedCount: 0,
      myFlickerAvailable: true,
      packages: [],
    },
  });
}

test('detail toggling is mutually exclusive only within its row group', () => {
  expect(toggleChatHubDetailSections(['settings', 'npm', 'scan'], 'skills'))
    .toEqual(['settings', 'skills', 'scan']);
  expect(toggleChatHubDetailSections(['settings', 'npm', 'scan'], 'mcp'))
    .toEqual(['settings', 'mcp', 'scan']);
  expect(toggleChatHubDetailSections(['settings', 'mcp', 'scan'], 'skills'))
    .toEqual(['settings', 'skills', 'scan']);
  expect(toggleChatHubDetailSections(['settings', 'skills', 'scan'], 'visibility'))
    .toEqual(['settings', 'skills', 'visibility']);
  expect(toggleChatHubDetailSections(['settings', 'skills', 'scan'], 'projectSkills'))
    .toEqual(['settings', 'skills', 'projectSkills']);
  expect(toggleChatHubDetailSections(['settings', 'skills', 'projectSkills'], 'visibility'))
    .toEqual(['settings', 'skills', 'visibility']);
  expect(toggleChatHubDetailSections(['settings', 'skills', 'visibility'], 'settings'))
    .toEqual(['skills', 'visibility']);
});

test('expanded update-only hub shows protocol mismatch without hiding controls', async () => {
  const {props} = createHarness({
    hubIds: ['hub-old'],
    treeItems: [{
      hubId: 'hub-old',
      projects: [],
      connectionMode: 'update_only',
    }],
    expandedHubIds: ['hub-old'],
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-protocol-mismatch'}).children)
    .toEqual(['Protocol mismatch · Update only']);
  expect(sectionHeaders(renderer.root).length).toBeGreaterThan(0);
});

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
    .map(label => label.children)).toEqual([['Global'], ['Projects']]);
});

test('uses a full Hub row disclosure behind the independent color control', async () => {
  const {props, callbacks} = createHarness({opsByHubId: {'hub-a': opsView()}});
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const row = renderer.root.findByProps({className: 'chat-hub-row'});
  const rowButtons = row.findAllByType('button');
  expect(rowButtons.map(button => button.props.className)).toEqual([
    'chat-hub-expand-button',
    'chat-hub-color-button',
    'chat-hub-action chat-hub-version-action chat-hub-version-update-action',
    'chat-hub-action chat-hub-version-action chat-hub-version-restart-action',
  ]);
  expect(row.findByProps({className: 'chat-hub-expand-chevron'})).toBeTruthy();

  act(() => rowButtons[0].props.onClick());
  expect(callbacks.onToggleHub).toHaveBeenCalledWith('hub-a');
});

test('settings accordion delegates toggling and detail ids open their detail', async () => {
  const {props, callbacks} = createHarness({expandedSections: {'hub-a': ['npm']}});
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

test('hub row uses independent update and restart actions with three icon-count Global disclosures', async () => {
  const {props, callbacks} = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        skills: {
          loading: false,
          operationRunning: false,
          error: '',
          pendingKey: '',
          hubItems: [
            {name: 'one', category: '', categoryKey: '', managed: true},
            {name: 'two', category: '', categoryKey: '', managed: true},
            {name: 'three', category: '', categoryKey: '', managed: true},
          ],
          projects: [],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findAllByProps({className: 'chat-hub-action-toggle'})).toHaveLength(0);
  const row = renderer.root.findByProps({className: 'chat-hub-row'});
  const version = row.findByProps({className: 'chat-hub-version-readout'});
  const update = row.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-update-action'});
  const restart = row.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-restart-action'});
  expect(version.findByProps({className: 'chat-hub-action-label'}).children).toEqual(['v1.2']);
  expect(update.props['aria-label']).toBe('Update WheelMaker v1.2');
  expect(restart.props['aria-label']).toBe('Restart WheelMaker v1.2');
  act(() => update.props.onClick());
  expect(callbacks.onRequestWheelMakerUpdate).toHaveBeenCalledWith('hub-a');
  act(() => restart.props.onClick());
  expect(callbacks.onRequestWheelMakerRestart).toHaveBeenCalledWith('hub-a');
  expect(callbacks.onToggleSection).not.toHaveBeenCalled();

  const npm = renderer.root.findByProps({'aria-label': 'NPM details'});
  const hubActions = renderer.root.findByProps({className: 'chat-hub-line-actions chat-hub-hub-actions'});
  const mcp = hubActions.findByProps({'aria-label': 'MCP details'});
  const skills = hubActions.findByProps({'aria-label': 'Skills details'});
  expect(hubActions.findAllByType('button')).toEqual([npm, mcp, skills]);
  const globalIcons = hubActions.findAll(
    node => ['package', 'mcp', 'wand'].includes(node.props['data-icon-name']),
  );
  expect(globalIcons.map(node => node.props['data-icon-name'])).toEqual(['package', 'mcp', 'wand']);
  expect(globalIcons.map(node => node.props.width)).toEqual([14, 14, 14]);
  expect(update.findAllByProps({className: 'chat-hub-update-dot'})).toHaveLength(1);
  expect(npm.findAllByProps({className: 'chat-hub-update-dot'})).toHaveLength(1);
  expect(mcp.findAllByProps({className: 'chat-hub-update-dot'})).toHaveLength(0);
  expect(skills.findAllByProps({className: 'chat-hub-update-dot'})).toHaveLength(0);
  expect(npm.findByProps({className: 'chat-hub-action-info'}).children).toEqual(['2']);
  expect(mcp.findByProps({className: 'chat-hub-action-info'}).children).toEqual(['0']);
  expect(skills.findByProps({className: 'chat-hub-action-info'}).children).toEqual(['3']);
  expect(hubActions.findAllByProps({className: 'chat-hub-action-label'})).toHaveLength(0);
  expect(hubActions.findAll(
    node => node.props['data-icon-name'] === 'chevronRight'
      || node.props['data-icon-name'] === 'chevronDown',
  )).toHaveLength(0);
  act(() => npm.props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'npm');
  expect(callbacks.onRequestNpmUpdate).not.toHaveBeenCalled();
  act(() => mcp.props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'mcp');
  act(() => skills.props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'skills');
});

test('hub row shows an installed Gateway before WheelMaker with an independent update action', async () => {
  const {props, callbacks} = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        gateway: {
          loading: false,
          pending: false,
          pendingAction: null,
          currentVersion: 'v1.3',
          updateVisible: true,
          updateAvailable: true,
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const row = renderer.root.findByProps({className: 'chat-hub-row'});
  const version = row.findByProps({className: 'chat-hub-version-readout'});
  expect(version.findAllByProps({className: 'chat-hub-action-label'}).map(item => item.children)).toEqual([
    ['Gateway ', 'v1.3'],
    ['v1.2'],
  ]);
  const gatewayUpdate = row.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-gateway-update-action'});
  expect(gatewayUpdate.props['aria-label']).toBe('Update Gateway v1.3');
  act(() => gatewayUpdate.props.onClick());
  expect(callbacks.onRequestGatewayUpdate).toHaveBeenCalledWith('hub-a');
});

test('MCP opens a local inline zero-state without dispatching an operation', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': ['mcp']},
    opsByHubId: {
      'hub-a': opsView({
        npm: {
          loading: false,
          pending: false,
          outdatedCount: 0,
          myFlickerAvailable: false,
          packages: [{
            packageName: '@openai/codex',
            displayName: 'Codex',
            agentTypes: ['codex'],
            installedVersion: '0.129.0',
            latestVersion: '0.129.0',
            action: null,
            canUninstall: true,
            pending: false,
          }],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const detail = renderer.root.findByProps({className: 'chat-hub-detail chat-hub-mcp-detail'});
  expect(detail.findByProps({className: 'chat-hub-detail-title'}).children).toEqual(['MCP servers']);
  expect(detail.findByProps({className: 'chat-hub-detail-empty'}).children)
    .toEqual(['No MCP servers configured.']);
  expect(callbacks.onRequestNpmUpdate).not.toHaveBeenCalled();
  expect(callbacks.onRequestSkillUpdate).not.toHaveBeenCalled();
});

test('hub row disables unavailable actions', async () => {
  const {props} = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: false,
          pendingAction: null,
          currentVersion: 'v1.2',
          updateVisible: false,
          restartVisible: false,
          updateAvailable: false,
        },
        npm: {
          loading: false,
          pending: false,
          outdatedCount: 0,
          myFlickerAvailable: false,
          packages: [],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const version = renderer.root.findByProps({className: 'chat-hub-version-readout'});
  expect(version.findByProps({className: 'chat-hub-action-label'}).children).toEqual(['v1.2']);
  expect(renderer.root.findAllByProps({className: 'chat-hub-version-update-action'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({className: 'chat-hub-version-restart-action'})).toHaveLength(0);
  expect(renderer.root.findByProps({'aria-label': 'NPM details'})
    .findAllByProps({className: 'chat-hub-update-dot'})).toHaveLength(0);
  expect(renderer.root.findByProps({'aria-label': 'NPM details'}).props.disabled).not.toBe(true);
});

test('only Restart shows loading while its restart request is pending', async () => {
  const {props} = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: true,
          pendingAction: 'restart',
          currentVersion: 'v1.2',
          updateVisible: true,
          restartVisible: true,
          updateAvailable: true,
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const row = renderer.root.findByProps({className: 'chat-hub-row'});
  const update = row.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-update-action'});
  const restart = row.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-restart-action'});
  expect(update.props.disabled).toBe(true);
  expect(restart.props.disabled).toBe(true);
  expect(update.findByType(Icon).props.name).toBe('refreshCw');
  expect(restart.findByType(Icon).props.name).toBe('loader');
});

test('only Update shows loading while its update request is pending', async () => {
  const {props} = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: true,
          pendingAction: 'update',
          currentVersion: 'v1.2',
          updateVisible: true,
          restartVisible: true,
          updateAvailable: true,
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const row = renderer.root.findByProps({className: 'chat-hub-row'});
  const update = row.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-update-action'});
  const restart = row.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-restart-action'});
  expect(update.props.disabled).toBe(true);
  expect(restart.props.disabled).toBe(true);
  expect(update.findByType(Icon).props.name).toBe('loader');
  expect(restart.findByType(Icon).props.name).toBe('power');
});

test('update-only Hub keeps Update and hides Restart', async () => {
  const {props} = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: false,
          pendingAction: null,
          currentVersion: 'v1.2',
          updateVisible: true,
          restartVisible: false,
          updateAvailable: true,
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-update-action'}))
    .toBeTruthy();
  expect(renderer.root.findAllByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-restart-action'}))
    .toHaveLength(0);
});

test('npm detail keeps version next to the name and hugs actions right', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': ['npm']},
    opsByHubId: {
      'hub-a': opsView({
        npm: {
          loading: false, pending: false, outdatedCount: 1,
          myFlickerAvailable: false,
          packages: [
            {packageName: '@a/one', displayName: 'One', agentTypes: ['claude'], installedVersion: '1.0', latestVersion: '1.1', action: 'update', canUninstall: true, pending: false},
            {packageName: '@a/two', displayName: 'Two', agentTypes: ['codex'], installedVersion: '', latestVersion: '2.0', action: 'install', canUninstall: false, pending: false},
            {packageName: '@a/three', displayName: 'Three', agentTypes: [], installedVersion: '3.0', latestVersion: '3.0', action: null, canUninstall: true, pending: false},
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
  expect(rows).toHaveLength(3);
  expect(rows[0].findByProps({className: 'chat-hub-npm-version-new'}).children).toEqual(['1.1']);
  expect(rows[1].findByProps({className: 'chat-hub-npm-version-copy'}).children).toEqual(['2.0']);
  expect(rows[2].findByProps({className: 'chat-hub-npm-version-copy'}).children).toEqual(['3.0']);
  expect(rows.flatMap(row => row.findAllByProps({className: 'chat-hub-npm-version-new'}))).toHaveLength(1);
  expect(rows.map(row => row.findByProps({className: 'chat-hub-npm-name-cell'}).findByProps({className: 'chat-hub-npm-versions'}))).toHaveLength(3);
  expect(rows[0].findByProps({className: 'chat-hub-npm-agent-tag wide-session-agent-2'}).children).toEqual(['One']);
  expect(rows[1].findByProps({className: 'chat-hub-npm-agent-tag wide-session-agent-0 missing'}).children).toEqual(['Two']);
  expect(rows[2].findByProps({className: 'chat-hub-npm-agent-tag'}).children).toEqual(['Three']);
  expect(rows.flatMap(row => row.findAllByProps({className: 'chat-hub-action-slot'}))).toHaveLength(0);
  const firstActions = rows[0].findByProps({className: 'chat-hub-npm-actions'}).findAllByType('button');
  const secondActions = rows[1].findByProps({className: 'chat-hub-npm-actions'}).findAllByType('button');
  const thirdActions = rows[2].findByProps({className: 'chat-hub-npm-actions'}).findAllByType('button');
  expect(firstActions.map(button => button.props['aria-label'])).toEqual(['Update One', 'Uninstall One']);
  expect(secondActions.map(button => button.props['aria-label'])).toEqual(['Install Two']);
  expect(thirdActions.map(button => button.props['aria-label'])).toEqual(['Uninstall Three']);
  expect(firstActions[0].props.className).toBe('chat-hub-icon-btn accent');
  expect(secondActions[0].props.className).toBe('chat-hub-icon-btn');
  expect(thirdActions[0].props.className).toBe('chat-hub-icon-btn danger');
  act(() => firstActions[0].props.onClick());
  expect(callbacks.onPackageAction).toHaveBeenCalledWith('hub-a', 'update', expect.objectContaining({packageName: '@a/one'}));
  act(() => secondActions[0].props.onClick());
  expect(callbacks.onPackageAction).toHaveBeenCalledWith('hub-a', 'install', expect.objectContaining({packageName: '@a/two'}));
  act(() => rows[0].findByProps({'aria-label': 'Uninstall One'}).props.onClick());
  expect(callbacks.onPackageAction).toHaveBeenCalledWith('hub-a', 'uninstall', expect.objectContaining({packageName: '@a/one'}));
  const updateAll = renderer.root.findByProps({'aria-label': 'Update all NPM packages'});
  act(() => updateAll.props.onClick());
  expect(callbacks.onRequestNpmUpdate).toHaveBeenCalledWith('hub-a');
});

test('skills detail shows only Hub-global skills with scoped actions', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': ['skills']},
    opsByHubId: {
      'hub-a': opsView({
        skills: {
          loading: false,
          operationRunning: false,
          error: '',
          pendingKey: '',
          hubItems: [
            {name: 'baseline-ui', category: 'UI', categoryKey: 'ui', managed: true},
            {name: 'external-skill', category: 'External', categoryKey: 'external', managed: false},
          ],
          projects: [],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const rows = renderer.root.findAllByProps({className: 'chat-hub-skill-row'});
  expect(rows).toHaveLength(2);
  const managedName = rows[0].findByProps({className: 'chat-hub-skill-name'});
  expect(managedName.children).toEqual(['baseline-ui']);
  const managedActions = rows[0].findByProps({className: 'chat-hub-skill-row-actions'}).findAllByType('button');
  expect(managedActions.map(button => button.props['aria-label']))
    .toEqual(['Update baseline-ui', 'Uninstall baseline-ui']);
  act(() => managedName.props.onClick());
  expect(callbacks.onRequestSkillDetail).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'hub',
    skillName: 'baseline-ui',
  });
  act(() => managedActions[0].props.onClick());
  expect(callbacks.onRequestSkillUpdate).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'hub',
    skills: ['baseline-ui'],
  });
  act(() => managedActions[1].props.onClick());
  expect(callbacks.onRequestSkillUninstall).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'hub',
    skillName: 'baseline-ui',
  });

  const externalActions = rows[1].findByProps({className: 'chat-hub-skill-row-actions'}).findAllByType('button');
  expect(rows[1].findAllByProps({className: 'chat-hub-action-slot'})).toHaveLength(2);
  const externalName = rows[1].findByProps({className: 'chat-hub-skill-name'});
  expect(externalName.props['data-tooltip']).toBe('external-skill');
  expect(externalName.props.disabled).not.toBe(true);
  expect(externalActions).toHaveLength(0);
  const updateAll = renderer.root.findByProps({'aria-label': 'Update all Hub skills'});
  act(() => updateAll.props.onClick());
  expect(callbacks.onRequestSkillUpdate).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'hub',
    includeProjects: false,
  });
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

test('skills detail disables stale row actions while the Hub snapshot refreshes', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': ['skills']},
    opsByHubId: {
      'hub-a': opsView({
        skills: {
          loading: true,
          operationRunning: false,
          error: '',
          pendingKey: '',
          hubItems: [{name: 'baseline-ui', category: 'UI', categoryKey: 'ui', managed: true}],
          projects: [],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const actions = renderer.root.findByProps({className: 'chat-hub-skill-row'})
    .findByProps({className: 'chat-hub-skill-row-actions'})
    .findAllByType('button');
  expect(actions.every(button => button.props.disabled)).toBe(true);
});

test('settings, one Hub detail, and one Projects detail may be open together', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': ['settings', 'npm', 'scan']},
    opsByHubId: {'hub-a': opsView()},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findAllByProps({className: 'chat-hub-settings'})).toHaveLength(1);
  expect(renderer.root.findAllByProps({'aria-label': 'Update all NPM packages'})).toHaveLength(1);
  expect(renderer.root.findAllByProps({'aria-label': 'Scan all projects'})).toHaveLength(1);
});

test('projects row disclosures keep bulk visibility out of the title and scan all inside detail', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': ['scan']},
    hiddenProjectIdSet: new Set<string>(['hub-a:p2']),
    opsByHubId: {
      'hub-a': opsView({
        skills: {
          loading: false,
          operationRunning: false,
          error: '',
          pendingKey: '',
          hubItems: [],
          projects: [
            {
              projectName: 'alpha',
              online: true,
              skills: [
                {name: 'one', category: '', categoryKey: '', managed: true},
                {name: 'two', category: '', categoryKey: '', managed: true},
              ],
            },
            {
              projectName: 'offline',
              online: false,
              skills: [{name: 'three', category: '', categoryKey: '', managed: true}],
            },
          ],
        },
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

  expect(renderer.root.findAllByProps({className: 'chat-hub-action-toggle'})).toHaveLength(0);
  const visibility = renderer.root.findByProps({'aria-label': 'Visibility details'});
  const scan = renderer.root.findByProps({'aria-label': 'Scan details'});
  const projectButtons = renderer.root
    .findByProps({className: 'chat-hub-line-actions chat-hub-project-actions'})
    .findAllByType('button');
  expect(projectButtons).toHaveLength(3);
  expect(projectButtons.map(button => button.props['aria-label']))
    .toEqual(['Visibility details', 'Scan details', 'Project Skills details']);
  expect(projectButtons.map(button => (
    button.findAllByProps({className: 'chat-hub-action-label'}).length
  ))).toEqual([0, 0, 0]);
  const projectIcons = projectButtons.map(button => button.findAll(
    node => ['eye', 'scanLine', 'wand'].includes(node.props['data-icon-name']),
  ));
  expect(projectIcons.map(icons => icons.map(node => node.props['data-icon-name'])))
    .toEqual([['eye'], ['scanLine'], ['wand']]);
  expect(projectIcons.map(icons => icons.map(node => node.props.width)))
    .toEqual([[14], [14], [14]]);
  expect(projectButtons.map(button => button.findByProps({className: 'chat-hub-action-info'}).children))
    .toEqual([['1/2'], ['1/2'], ['3']]);
  expect(projectButtons.flatMap(button => button.findAll(
    node => node.props['data-icon-name'] === 'chevronRight'
      || node.props['data-icon-name'] === 'chevronDown',
  ))).toHaveLength(0);

  const scanRows = renderer.root.findAllByProps({className: 'chat-hub-scan-row'});
  expect(scanRows).toHaveLength(2);
  expect(scanRows[1].findByProps({'aria-label': 'Scan p2'}).props.disabled).toBe(true);
  act(() => scanRows[0].findByProps({'aria-label': 'Scan p1'}).props.onClick());
  expect(callbacks.onScanProject).toHaveBeenCalledWith('hub-a', 'hub-a:p1');

  act(() => scan.props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'scan');
  expect(callbacks.onScanAllIndexes).not.toHaveBeenCalled();
  const scanAll = renderer.root.findByProps({'aria-label': 'Scan all projects'});
  act(() => scanAll.props.onClick());
  expect(callbacks.onScanAllIndexes).toHaveBeenCalledWith('hub-a');

  act(() => visibility.props.onClick());
  expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'visibility');
  expect(callbacks.onToggleAllProjects).not.toHaveBeenCalled();
});

test('Project Skills lists only online projects and keeps every action in the selected project', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': ['projectSkills']},
    opsByHubId: {
      'hub-a': opsView({
        skills: {
          loading: false,
          operationRunning: false,
          error: '',
          pendingKey: '',
          hubItems: [],
          projects: [
            {
              projectName: 'alpha',
              online: true,
              skills: [
                {name: 'one', category: '', categoryKey: '', managed: true},
                {name: 'two', category: '', categoryKey: '', managed: true},
              ],
            },
            {
              projectName: 'offline',
              online: false,
              skills: [{name: 'three', category: '', categoryKey: '', managed: true}],
            },
            {
              projectName: 'beta-project',
              online: true,
              skills: [{name: 'beta-skill', category: '', categoryKey: '', managed: true}],
            },
          ],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  const projectTrigger = renderer.root.findByProps({className: 'chat-hub-project-skill-trigger'});
  expect(projectTrigger.props['aria-expanded']).toBe(false);
  expect(projectTrigger.props['data-selected-project']).toBe('alpha');
  expect(projectTrigger.findByProps({className: 'chat-hub-project-skill-name'}).children)
    .toEqual(['alpha']);
  expect(projectTrigger.findByProps({className: 'chat-hub-project-skill-count'}).children)
    .toEqual(['2']);
  expect(renderer.root.findAllByProps({role: 'option'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({'data-project-name': 'offline'})).toHaveLength(0);

  act(() => renderer.root.findByProps({'aria-label': 'Add Project skills'}).props.onClick());
  expect(callbacks.onRequestSkillInstall).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'project',
    projectName: 'alpha',
  });
  act(() => renderer.root.findByProps({'aria-label': 'View one details'}).props.onClick());
  expect(callbacks.onRequestSkillDetail).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'project',
    projectName: 'alpha',
    skillName: 'one',
  });
  act(() => renderer.root.findByProps({'aria-label': 'Update one'}).props.onClick());
  expect(callbacks.onRequestSkillUpdate).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'project',
    projectName: 'alpha',
    skills: ['one'],
  });
  act(() => renderer.root.findByProps({'aria-label': 'Uninstall one'}).props.onClick());
  expect(callbacks.onRequestSkillUninstall).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'project',
    projectName: 'alpha',
    skillName: 'one',
  });
  act(() => renderer.root.findByProps({'aria-label': 'Select Project skills'}).props.onClick());
  act(() => renderer.root.findByProps({'aria-label': 'Select two'}).props.onChange());
  act(() => renderer.root.findByProps({'aria-label': 'Uninstall selected Project skills'}).props.onClick());
  expect(callbacks.onRequestSkillBatchUninstall).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'project',
    projectName: 'alpha',
    skillNames: ['two'],
  });

  act(() => projectTrigger.props.onClick());
  expect(renderer.root.findByProps({className: 'chat-hub-project-skill-trigger'}).props['aria-expanded'])
    .toBe(true);
  expect(renderer.root.findAllByProps({role: 'option'}).map(option => option.props['data-project-name']))
    .toEqual(['alpha', 'beta-project']);
  act(() => renderer.root.findByProps({'data-project-name': 'beta-project'}).props.onClick());
  const selectedBeta = renderer.root.findByProps({className: 'chat-hub-project-skill-trigger'});
  expect(selectedBeta.props['aria-expanded']).toBe(false);
  expect(selectedBeta.props['data-selected-project']).toBe('beta-project');
  expect(selectedBeta.props['data-tooltip']).toBe('beta-project');
  act(() => renderer.root.findByProps({'aria-label': 'Add Project skills'}).props.onClick());
  expect(callbacks.onRequestSkillInstall).toHaveBeenLastCalledWith({
    hubId: 'hub-a',
    scope: 'project',
    projectName: 'beta-project',
  });
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

test('Project Skills defaults to the active chat project instead of the first project', async () => {
  const {props, callbacks} = createHarness({
    activeProjectId: 'hub-a:zeta',
    expandedSections: {'hub-a': ['projectSkills']},
    opsByHubId: {
      'hub-a': opsView({
        skills: {
          loading: false,
          operationRunning: false,
          error: '',
          pendingKey: '',
          hubItems: [],
          projects: [
            {
              projectId: 'hub-a:alpha',
              projectName: 'alpha',
              online: true,
              skills: [],
            },
            {
              projectId: 'hub-a:zeta',
              projectName: 'zeta',
              online: true,
              skills: [],
            },
          ],
        },
      }),
    },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-project-skill-trigger'})
    .props['data-selected-project']).toBe('zeta');
  act(() => renderer.root.findByProps({'aria-label': 'Add Project skills'}).props.onClick());
  expect(callbacks.onRequestSkillInstall).toHaveBeenCalledWith({
    hubId: 'hub-a',
    scope: 'project',
    projectName: 'zeta',
  });
});

test('visibility detail toggles project visibility', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': ['visibility']},
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
    expandedSections: {'hub-a': ['settings']},
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
          deepSeekPlatform: {configured: false},
          apiKeys: {
            kimi: {configured: true, updatedAt: '2026-07-29T12:00:00Z'},
          },
        },
      },
    },
    opsByHubId: {'hub-a': flickerOpsView()},
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

test('hides Flicker controls, summary, and errors when MyFlicker is unavailable', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': ['settings']},
    flickerStatuses: {
      'hub-a': {
        configured: true,
        supported: true,
        state: 'failed',
        mode: 'v1',
        availableModes: ['v1'],
        modeErrors: {},
        endpoint: 'http://127.0.0.1:17999',
        port: 17999,
        error: 'MyFlicker registry is unavailable',
      },
    },
    hubConfigByHubId: {
      'hub-a': {
        loading: false,
        error: '',
        busyField: '',
        data: {
          flickerBridge: {mode: 'v1', enabled: true},
          deepSeekPlatform: {configured: false},
          apiKeys: {
            kimi: {configured: true, updatedAt: '2026-07-29T12:00:00Z'},
          },
        },
      },
    },
    opsByHubId: {'hub-a': opsView()},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findAllByProps({className: 'chat-hub-flicker-row'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({'aria-label': 'Use Flicker Bridge V1'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({className: 'chat-hub-settings-state'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({className: 'chat-hub-settings-hint error'})).toHaveLength(0);
  expect(renderer.root.findAllByType('input')).toHaveLength(4);
});

test('flicker segment disables unavailable modes and surfaces the inline error', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': ['settings']},
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
        data: {flickerBridge: {mode: 'v1', enabled: true}, apiKeys: {}, deepSeekPlatform: {configured: false}},
      },
    },
    opsByHubId: {'hub-a': flickerOpsView()},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({'aria-label': 'Use Flicker Bridge V2'}).props).toMatchObject({
    disabled: true,
    'data-tooltip': 'Node.js 22 is required',
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
        data: {flickerBridge: {mode: 'v2', enabled: true}, apiKeys: {}, deepSeekPlatform: {configured: false}},
      },
    },
    opsByHubId: {'hub-a': flickerOpsView()},
  });
  let enabledRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    enabledRenderer = TestRenderer.create(<ChatHubMenu {...enabled.props} />);
  });
  const enabledState = enabledRenderer.root.findByProps({
    className: 'chat-hub-settings-state on',
  });
  expect(enabledState.children).toContain('V2');
  expect(enabledState.findByProps({
    className: 'chat-hub-settings-state-dot',
  })).toBeTruthy();
  expect(enabledRenderer.root.findAll(
    node => typeof node.props.className === 'string'
      && node.props.className.includes('chat-hub-summary-mark'),
  )).toHaveLength(0);

  const disabled = createHarness({
    hubConfigByHubId: {
      'hub-a': {
        loading: false,
        error: '',
        busyField: '',
        data: {flickerBridge: {mode: 'v1', enabled: false}, apiKeys: {}, deepSeekPlatform: {configured: false}},
      },
    },
    opsByHubId: {'hub-a': flickerOpsView()},
  });
  let disabledRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    disabledRenderer = TestRenderer.create(<ChatHubMenu {...disabled.props} />);
  });
  const offState = disabledRenderer.root.findByProps({
    className: 'chat-hub-settings-state off',
  });
  expect(offState.children).toContain('Off');
  expect(offState.findByProps({
    className: 'chat-hub-settings-state-dot',
  })).toBeTruthy();
});

test('version action uses an update or restart icon instead of a detached status dot', async () => {
  const {props} = createHarness({opsByHubId: {'hub-a': opsView()}});
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });
  const updateAction = renderer.root.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-update-action'});
  expect(updateAction.findByType(Icon).props.name).toBe('refreshCw');
  const restartAction = renderer.root.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-restart-action'});
  expect(restartAction.findByType(Icon).props.name).toBe('power');
  expect(renderer.root.findAllByProps({className: 'chat-hub-section-version-dot'})).toHaveLength(0);

  const current = createHarness({
    opsByHubId: {
      'hub-a': opsView({
        wheelMaker: {
          loading: false,
          pending: false,
          pendingAction: null,
          currentVersion: 'v1.2',
          updateVisible: false,
          restartVisible: true,
          updateAvailable: false,
        },
      }),
    },
  });
  let currentRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    currentRenderer = TestRenderer.create(<ChatHubMenu {...current.props} />);
  });
  expect(currentRenderer.root.findAllByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-update-action'})).toHaveLength(0);
  const currentRestartAction = currentRenderer.root.findByProps({className: 'chat-hub-action chat-hub-version-action chat-hub-version-restart-action'});
  expect(currentRestartAction.findByType(Icon).props.name).toBe('power');
});

test('settings section surfaces the unsupported-hub message', async () => {
  const {props} = createHarness({
    expandedSections: {'hub-a': ['settings']},
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
  expect(renderer.root.findAllByProps({className: 'chat-hub-page-close'})).toHaveLength(0);
  act(() => renderer.root.findByProps({className: 'chat-hub-page-back'}).props.onClick());
  expect(callbacks.onClose).toHaveBeenCalled();
});

test('desktop keeps Skill detail in a companion inside the shared outside-click boundary', async () => {
  const target = {hubId: 'hub-a', scope: 'hub' as const, skillName: 'baseline-ui'};
  const {props, callbacks} = createHarness({
    skillSurface: {kind: 'detail', target},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-popover-stack'})).toBeTruthy();
  expect(renderer.root.findByProps({className: 'chat-hub-skill-companion desktop'})).toBeTruthy();
  act(() => renderer.root.findByProps({'aria-label': 'Close Skill details'}).props.onClick());
  expect(callbacks.onCloseSkillSurface).toHaveBeenCalled();
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

test('mobile renders a Skill detail as a child page and Back preserves the Hub page', async () => {
  const target = {hubId: 'hub-a', scope: 'hub' as const, skillName: 'baseline-ui'};
  const {props, callbacks} = createHarness({
    mobile: true,
    skillSurface: {kind: 'detail', target},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-page-title'}).children)
    .toEqual(['baseline-ui']);
  expect(renderer.root.findByProps({className: 'chat-hub-page-body skill-child'})).toBeTruthy();
  act(() => renderer.root.findByProps({className: 'chat-hub-page-back'}).props.onClick());
  expect(callbacks.onCloseSkillSurface).toHaveBeenCalled();
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({className: 'chat-hub-page-close'})).toHaveLength(0);
});

test('desktop palette stays a flyout inside the scrollable popover; mobile palette is inline', async () => {
  const desktop = createHarness({colorMenuHubId: 'hub-a'});
  let desktopRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    desktopRenderer = TestRenderer.create(<ChatHubMenu {...desktop.props} />);
  });
  const popover = desktopRenderer.root.find(
    node => typeof node.props.className === 'string' &&
      node.props.className.startsWith('chat-hub-popover topbar-menu-surface'),
  );
  expect(popover.props.className).not.toContain('no-overflow');
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
