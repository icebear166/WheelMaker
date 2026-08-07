# Hub 菜单统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 per-hub 操作全部收口到 hub 菜单（复合按钮行模型），删除 Update 设置页。

**Architecture:** ChatHubMenu 的行从"整行手风琴"升级为"摘要 + 复合按钮组"（split button：主点击 = 动作，▾ = 展开 detail），detail 每 hub 互斥；Update 设置页删除，Android APK 卡迁移到 Settings 根页，Latest + Update all hubs 成为面板 footer。

**Tech Stack:** React 18 + TS（app/web），jest + react-test-renderer，CSS in app/web/src/styles/chat.css。Worktree：`.worktree/hub-menu-unification`（分支 `hub-menu-unification`），所有路径相对 worktree 根。

**Spec:** `docs/scope/2026-07-29-hub-menu-unification.md`

关键既有事实：
- `app/web/src/app/ChatHubMenu.tsx`：当前组件（Settings/Hub Ops/Projects 三行手风琴）。
- `app/web/src/app/WorkspaceApp.tsx`：`chatHubOpsByHubId` memo（~L12805）、`handleChatHub*` 回调（~L13883）、`requestAgentPackageAction`（~L13715，签名 `(action, hubId, pkg: RegistryNpmPackage)`）、`agentPackageActionKey`（L1295 附近模块级函数）、`toggleHubVisibility`（`hubProjectPreferences.ts:212`，签名 `(currentHidden, hubProjects, visible)`）。
- detail id 现称 `ChatHubSectionId = 'settings' | 'ops' | 'projects'`，state 在 WorkspaceApp `chatHubExpandedSections`。
- Update 页引用点：`settingsNavigation.ts`、`SettingsSurface.tsx`（shortcut + title）、`WorkspaceApp.tsx`（lazy import L686、renderUpdateSettingsDetail L15979、renderSettingsDetailActions 'update' 分支 L15863、update-entry effect L13293-13312、`updateSurfaceActiveRef` effect L12909、renderDetail 路由 L16160）、`SettingsBundle.ts:6`。

---

### Task 1: ChatHubMenu — detail id 模型 + split button + Hub 行重构

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`（`ChatHubSectionId`→`ChatHubDetailId`，新增 `ChatHubActionButton`，Hub 行改为摘要 + 按钮组）
- Modify: `app/web/src/app/WorkspaceApp.tsx`（type import 与 state 类型跟随改名）
- Test: `app/web/src/app/ChatHubMenu.test.tsx`

- [ ] **Step 1: 写失败测试 — Hub 行渲染摘要 + 三个按钮，主点击不触发展开**

在 `ChatHubMenu.test.tsx` 追加：

```tsx
test('hub row renders summary and action buttons; main clicks fire actions without expanding', async () => {
  const {props, callbacks} = createHarness({
    opsByHubId: {'hub-a': opsView()},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  // version summary with red dot
  expect(renderer.root.findByProps({className: 'chat-hub-section-version-dot'})).toBeTruthy();
  // three action buttons: Update (simple), NPM (split), Skills (split)
  const updateMain = renderer.root.findByProps({className: 'chat-hub-action-main'});
  expect(updateMain.children).toContain('Update Hub');
  const toggles = renderer.root.findAll(
    node => typeof node.props.className === 'string' && node.props.className === 'chat-hub-action-toggle',
  );
  expect(toggles).toHaveLength(2); // NPM and Skills; Update has no toggle
  act(() => updateMain.props.onClick());
  expect(callbacks.onRequestWheelMakerUpdate).toHaveBeenCalledWith('hub-a');
  expect(callbacks.onToggleSection).not.toHaveBeenCalled();
  expect(toggles[0].props['aria-label']).toBe('NPM details');
  expect(toggles[1].props['aria-label']).toBe('Skills details');
});
```

同时把 opsView() 的 skills 补 `count`、npm 补 `packages`、index 补 `projects`（见 Task 2/3，测试 helper 同步扩展）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx jest web/src/app/ChatHubMenu.test.tsx -t "hub row renders summary"`
Expected: FAIL（找不到 `chat-hub-action-main` / `chat-hub-section-version-dot` 之外的结构错误）

- [ ] **Step 3: 实现 `ChatHubDetailId` 与 `ChatHubActionButton`**

`ChatHubMenu.tsx` 中：

```tsx
export type ChatHubDetailId = 'settings' | 'npm' | 'skills' | 'visibility' | 'scan';
```

`ChatHubMenuProps` 中 `expandedSections: Record<string, ChatHubDetailId | null>`、`onToggleSection: (hubId: string, section: ChatHubDetailId) => void`（WorkspaceApp import 同步改名，`chatHubExpandedSections` state 类型同步）。

新增组件（放在 `ChatHubSectionHeader` 之后）：

```tsx
function ChatHubActionButton({
  label,
  info,
  disabled = false,
  pending = false,
  expanded,
  onAction,
  onExpand,
}: {
  label: string;
  info?: string;
  disabled?: boolean;
  pending?: boolean;
  expanded?: boolean;
  onAction: () => void;
  onExpand?: () => void;
}): React.JSX.Element {
  return (
    <span className={`chat-hub-action${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="chat-hub-action-main"
        disabled={disabled || pending}
        onClick={onAction}
      >
        {pending ? <Icon name="loader" spin /> : null}
        <span className="chat-hub-action-label">{label}</span>
        {info ? <span className="chat-hub-action-info">{info}</span> : null}
      </button>
      {onExpand ? (
        <button
          type="button"
          className="chat-hub-action-toggle"
          aria-expanded={expanded === true}
          aria-label={`${label} details`}
          onClick={onExpand}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
        </button>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 4: Hub 行重构（替换现有 Hub Ops section）**

`ChatHubBlock` 中删除 'ops' 的 `ChatHubSectionHeader` + body，替换为：

```tsx
<div className="chat-hub-line">
  <span className="chat-hub-line-icon"><Icon name="serverCog" /></span>
  <span className="chat-hub-line-label">Hub</span>
  <span className="chat-hub-line-summary">
    <span className="chat-hub-section-version">
      {ops.wheelMaker.currentVersion}
      {ops.wheelMaker.updateAvailable ? (
        <span className="chat-hub-section-version-dot" role="img" aria-label="Update available" />
      ) : null}
    </span>
  </span>
  <span className="chat-hub-line-actions">
    <ChatHubActionButton
      label={ops.wheelMaker.actionLabel}
      disabled={!ops.wheelMaker.actionVisible}
      pending={ops.wheelMaker.pending}
      onAction={() => onRequestWheelMakerUpdate(hubId)}
    />
    <ChatHubActionButton
      label="NPM"
      info={ops.npm.outdatedCount > 0 ? `·${ops.npm.outdatedCount}` : undefined}
      disabled={ops.npm.outdatedCount === 0}
      pending={ops.npm.pending}
      expanded={openSection === 'npm'}
      onAction={() => onRequestNpmUpdate(hubId)}
      onExpand={() => toggleSection('npm')}
    />
    <ChatHubActionButton
      label="Skills"
      info={ops.skills.count > 0 ? `·${ops.skills.count}` : undefined}
      pending={ops.skills.pending}
      expanded={openSection === 'skills'}
      onAction={() => onScanSkills(hubId)}
      onExpand={() => toggleSection('skills')}
    />
  </span>
</div>
{openSection === 'npm' ? <ChatHubNpmDetail hubId={hubId} ops={ops} onPackageAction={onPackageAction} /> : null}
{openSection === 'skills' ? <ChatHubSkillsDetail ops={ops} /> : null}
```

（`ChatHubNpmDetail` / `ChatHubSkillsDetail` 在 Task 2/3 实现，本步先渲染占位 `null` 并保留旧 ops grid 组件直到 Task 2 切换；实际执行时直接跳到 Task 2 完成后一次性通过测试。）

- [ ] **Step 5: 运行测试**

Run: `cd app && npx jest web/src/app/ChatHubMenu.test.tsx`
Expected: 新测试 PASS；旧 'ops row' 两个测试 FAIL（ops grid 已移除——下一步删除它们）

- [ ] **Step 6: 删除旧 ops grid 测试与组件代码，Commit**

删除 `ChatHubMenu.test.tsx` 中 `'ops row invokes callbacks...'` 与 `'ops row disables actions...'` 两测试及 `ChatHubOpsRow` 组件。

```bash
git add -A && git commit -m "feat(hub-menu): split-button hub row with detail ids"
```

---

### Task 2: NPM detail — 逐包行

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`（`ChatHubOpsView.npm.packages`、`ChatHubNpmDetail`、新 props `onPackageAction`）
- Test: `app/web/src/app/ChatHubMenu.test.tsx`

- [ ] **Step 1: 写失败测试 — 逐包行按钮（Update/Install 二选一 + Uninstall，无 reinstall）**

```tsx
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

  const rows = renderer.root.findAll(
    node => typeof node.props.className === 'string' && node.props.className === 'chat-hub-npm-row',
  );
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
  // uninstall only when installed
  expect(rows[0].findByProps({'aria-label': 'Uninstall One'})).toBeTruthy();
  expect(rows[1].findAllByProps({'aria-label': 'Uninstall Two'})).toHaveLength(0);
  act(() => rows[0].findByProps({'aria-label': 'Uninstall One'}).props.onClick());
  expect(callbacks.onPackageAction).toHaveBeenCalledWith('hub-a', 'uninstall', expect.objectContaining({packageName: '@a/one'}));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npx jest web/src/app/ChatHubMenu.test.tsx -t "npm detail"`
Expected: FAIL（`onPackageAction` prop 不存在 / 无 `chat-hub-npm-row`）

- [ ] **Step 3: 实现视图类型 + `ChatHubNpmDetail`**

`ChatHubMenu.tsx`：

```tsx
export interface ChatHubNpmPackageView {
  packageName: string;
  displayName: string;
  installedVersion: string;
  latestVersion: string;
  action: 'update' | 'install' | null;
  canUninstall: boolean;
  pending: boolean;
}
// ChatHubOpsView.npm 增加: packages: ChatHubNpmPackageView[];
// ChatHubMenuProps 增加: onPackageAction: (hubId: string, action: 'install' | 'update' | 'uninstall', pkg: ChatHubNpmPackageView) => void;

function ChatHubNpmDetail({
  hubId,
  ops,
  onPackageAction,
}: {
  hubId: string;
  ops: ChatHubOpsView;
  onPackageAction: ChatHubMenuProps['onPackageAction'];
}): React.JSX.Element {
  if (ops.npm.packages.length === 0) {
    return <div className="chat-hub-detail"><div className="chat-hub-detail-empty">No packages</div></div>;
  }
  return (
    <div className="chat-hub-detail">
      {ops.npm.packages.map(pkg => (
        <div key={pkg.packageName} className="chat-hub-npm-row">
          <span className="chat-hub-npm-name" title={pkg.packageName}>{pkg.displayName}</span>
          <span className="chat-hub-npm-versions">
            {pkg.installedVersion || '—'}{pkg.latestVersion ? ` → ${pkg.latestVersion}` : ''}
          </span>
          <span className="chat-hub-npm-actions">
            {pkg.action ? (
              <button
                type="button"
                className="chat-hub-mini-btn"
                disabled={pkg.pending}
                onClick={() => onPackageAction(hubId, pkg.action as 'update' | 'install', pkg)}
              >
                {pkg.pending ? 'Running…' : pkg.action === 'update' ? 'Update' : 'Install'}
              </button>
            ) : null}
            {pkg.canUninstall ? (
              <button
                type="button"
                className="chat-hub-icon-btn"
                aria-label={`Uninstall ${pkg.displayName}`}
                disabled={pkg.pending}
                onClick={() => onPackageAction(hubId, 'uninstall', pkg)}
              >
                <Icon name="trash" />
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试通过后 Commit**

Run: `cd app && npx jest web/src/app/ChatHubMenu.test.tsx`
Expected: PASS

```bash
git add -A && git commit -m "feat(hub-menu): per-package npm detail rows"
```

---

### Task 3: Skills / Visibility / Scan details + Projects 行 + footer

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Test: `app/web/src/app/ChatHubMenu.test.tsx`

- [ ] **Step 1: 写失败测试 — Projects 行双复合按钮、互斥、footer**

```tsx
test('projects row split buttons expand visibility and scan details mutually exclusively', async () => {
  const {props, callbacks} = createHarness({
    expandedSections: {'hub-a': 'scan'},
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
  // scan detail open: status rows, per-project scan disabled while pending
  const scanRows = renderer.root.findAll(
    node => typeof node.props.className === 'string' && node.props.className === 'chat-hub-scan-row',
  );
  expect(scanRows).toHaveLength(2);
  expect(scanRows[1].findByProps({'aria-label': 'Scan p2'}).props.disabled).toBe(true);
  act(() => scanRows[0].findByProps({'aria-label': 'Scan p1'}).props.onClick());
  expect(callbacks.onScanProject).toHaveBeenCalledWith('hub-a', 'hub-a:p1');
  // visibility main click toggles all
  const visibilityMain = renderer.root.findAllByProps({className: 'chat-hub-action-main'})
    .find(button => button.props['aria-label'] === 'Show all projects');
  act(() => visibilityMain!.props.onClick());
  expect(callbacks.onToggleAllProjects).toHaveBeenCalledWith('hub-a', true);
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
  expect(footer.findByProps({className: 'chat-hub-footer-version'}).children.join('')).toContain('v1.3');
  const button = footer.findByProps({className: 'chat-hub-footer-update-all'});
  expect(button.props.disabled).toBe(false);
  act(() => button.props.onClick());
  expect(callbacks.onUpdateAllHubs).toHaveBeenCalled();
});
```

（createHarness defaults 增加：`latestVersion: '-'`, `updateAllAvailableCount: 0`, `updateAllPending: false`, 及 callbacks `onPackageAction/onScanProject/onToggleAllProjects/onUpdateAllHubs: jest.fn()`。）

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npx jest web/src/app/ChatHubMenu.test.tsx -t "projects row"`
Expected: FAIL

- [ ] **Step 3: 实现**

`ChatHubOpsView` 扩展：

```tsx
export interface ChatHubIndexProjectView {
  projectId: string;
  name: string;
  status: string;
  pending: boolean;
}
// skills 增加 count: number; index 增加 projects: ChatHubIndexProjectView[];
```

`ChatHubMenuProps` 增加：

```tsx
onScanProject: (hubId: string, projectId: string) => void;
onToggleAllProjects: (hubId: string, visible: boolean) => void;
latestVersion: string;
updateAllAvailableCount: number;
updateAllPending: boolean;
onUpdateAllHubs: () => void;
```

Projects 行（替换现有 Projects section header + body，可见性 detail 复用现有 `chat-hub-project-list` JSX 移入 `openSection === 'visibility'` 分支）：

```tsx
<div className="chat-hub-line">
  <span className="chat-hub-line-icon"><Icon name="folder" /></span>
  <span className="chat-hub-line-label">Projects</span>
  <span className="chat-hub-line-summary">{visibleProjectCount}/{treeItem.projects.length}</span>
  <span className="chat-hub-line-actions">
    <ChatHubActionButton
      label="👁"
      info={`${visibleProjectCount}/${treeItem.projects.length}`}
      aria-label...
    />
  </span>
</div>
```

可见性按钮不用 emoji —— 用 `Icon name="eye"` 作为主按钮内容（`ChatHubActionButton` 增加可选 `icon?: IconName`，有 icon 时 label 作为 aria-label）：

```tsx
<ChatHubActionButton
  icon="eye"
  label={visibleProjectCount === treeItem.projects.length ? 'Hide all projects' : 'Show all projects'}
  info={`${visibleProjectCount}/${treeItem.projects.length}`}
  expanded={openSection === 'visibility'}
  onAction={() => onToggleAllProjects(hubId, visibleProjectCount !== 0)}
  onExpand={() => toggleSection('visibility')}
/>
<ChatHubActionButton
  label="Scan"
  info={`${ops.index.indexedCount}/${ops.index.totalCount}`}
  pending={ops.index.pending}
  expanded={openSection === 'scan'}
  onAction={() => onScanAllIndexes(hubId)}
  onExpand={() => toggleSection('scan')}
/>
```

注意可见性主点击语义：当前全显（visibleCount === total）→ 全隐（visible=false），否则全显（visible=true）；aria-label 相应为 `Hide all projects` / `Show all projects`，上面测试用 `'Show all projects'`（初始 p2 hidden → 非全显 → 主点击全显 visible=true）。实现：`onToggleAllProjects(hubId, visibleProjectCount < treeItem.projects.length)`。

Scan detail：

```tsx
function ChatHubScanDetail({hubId, ops, onScanProject}: {hubId: string; ops: ChatHubOpsView; onScanProject: ChatHubMenuProps['onScanProject']}): React.JSX.Element {
  return (
    <div className="chat-hub-detail">
      {ops.index.projects.map(project => (
        <div key={project.projectId} className="chat-hub-scan-row">
          <span className="chat-hub-scan-name" title={project.projectId}>{project.name}</span>
          <span className={`chat-hub-scan-status status-${project.status}`}>{project.status}</span>
          <button
            type="button"
            className="chat-hub-icon-btn"
            aria-label={`Scan ${project.name}`}
            disabled={project.pending || ops.index.pending}
            onClick={() => onScanProject(hubId, project.projectId)}
          >
            <Icon name={project.pending ? 'loader' : 'refreshCw'} spin={project.pending} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

Skills detail：

```tsx
function ChatHubSkillsDetail({ops}: {ops: ChatHubOpsView}): React.JSX.Element {
  return (
    <div className="chat-hub-detail">
      <div className="chat-hub-skills-summary">
        {ops.skills.pending ? 'Scanning skills…' : `${ops.skills.count} skills indexed`}
      </div>
      {ops.skills.error ? <div className="chat-hub-ops-error">{ops.skills.error}</div> : null}
    </div>
  );
}
```

footer（放在 `ChatHubMenu` 的 panel 末尾，popover 与 mobile page 共用，渲染在 hub 列表之后）：

```tsx
<div className="chat-hub-footer">
  <span className="chat-hub-footer-version">Latest <span className="chat-hub-footer-version-value">{latestVersion}</span></span>
  <button
    type="button"
    className="chat-hub-footer-update-all"
    disabled={updateAllAvailableCount === 0 || updateAllPending}
    onClick={onUpdateAllHubs}
  >
    {updateAllPending ? <Icon name="loader" spin /> : <Icon name="cloudDownload" />}
    {updateAllPending ? 'Updating all hubs…' : 'Update all hubs'}
  </button>
</div>
```

`ChatHubSectionHeader` 现在只服务 Settings 行；ops/projects 两个 section 的旧 header 调用删除，`ChatHubSectionHeader` 保留（Settings 用）。

- [ ] **Step 4: 运行测试通过后 Commit**

Run: `cd app && npx jest web/src/app/ChatHubMenu.test.tsx`
Expected: 全 PASS

```bash
git add -A && git commit -m "feat(hub-menu): projects split buttons, detail views, footer"
```

---

### Task 4: WorkspaceApp — 视图模型扩展 + 新回调

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（`chatHubOpsByHubId`、新回调、`renderChatHubSummary` props）

- [ ] **Step 1: `chatHubOpsByHubId` 扩展**

在现有 memo 的 `views[card.hubId] = {...}` 中替换 npm / skills / index 三个字段：

```ts
const hubPackages = card.agentPackage?.hub?.packages ?? [];
const indexedSkills = (() => {
  const names = new Set<string>();
  projects
    .filter(project => (project.hubId || '').trim() === card.hubId)
    .forEach(project => {
      (project.agentProfiles ?? []).forEach(profile => {
        (profile.skills ?? []).forEach(skill => {
          const normalized = skill.trim().toLowerCase();
          if (normalized) names.add(normalized);
        });
      });
    });
  return names.size;
})();
// npm:
npm: {
  loading: card.agentPackage?.loading === true || agentPackagesLoading,
  pending: agentPackageHubUpdatePendingId === card.hubId || card.agentPackage?.operation?.running === true,
  outdatedCount: npmUpdatable.length,
  packages: hubPackages.map(pkg => ({
    packageName: pkg.packageName,
    displayName: pkg.displayName,
    installedVersion: pkg.installedVersion,
    latestVersion: pkg.latestVersion,
    action: pkg.canUpdate ? 'update' as const : pkg.canInstall ? 'install' as const : null,
    canUninstall: pkg.canUninstall === true,
    pending: agentPackageActionPendingKey === agentPackageActionKey(card.hubId, pkg.packageName),
  })),
},
// skills:
skills: {
  pending: skillIndexScanPendingByHubId[card.hubId] === true,
  error: skillIndexScanErrorByHubId[card.hubId] || '',
  count: indexedSkills,
},
// index:
index: {
  pending: projectIndexScanAllPendingByHubId[card.hubId] === true,
  indexedCount: indexTargets.filter(project => project.status === 'indexed').length,
  totalCount: indexTargets.length,
  projects: indexTargets.map(project => ({
    projectId: project.projectId,
    name: project.name,
    status: project.status,
    pending: projectIndexScanPendingByProjectId[project.projectId] === true,
  })),
},
```

deps 增加 `agentPackageActionPendingKey`、`projectIndexScanPendingByProjectId`、`projects`。

- [ ] **Step 2: 新回调 + footer 数据**

放在 `handleChatHubScanAllIndexes` 之后：

```ts
const handleChatHubPackageAction = useCallback((
  hubId: string,
  action: 'install' | 'update' | 'uninstall',
  pkg: ChatHubNpmPackageView,
) => {
  const fullPackage = updateHubCards
    .find(card => card.hubId === hubId)
    ?.agentPackage?.hub?.packages.find(item => item.packageName === pkg.packageName);
  if (fullPackage) {
    requestAgentPackageAction(action, hubId, fullPackage);
  }
}, [requestAgentPackageAction, updateHubCards]);

const handleChatHubScanProject = useCallback((hubId: string, projectId: string) => {
  void handleScanProjectIndex(hubId, projectId);
}, [handleScanProjectIndex]);

const handleChatHubToggleAllProjects = useCallback((hubId: string, visible: boolean) => {
  const treeItem = chatHubTreeItems.find(item => item.hubId === hubId);
  setHiddenProjectIds(current => toggleHubVisibility(current, treeItem?.projects ?? [], visible));
}, [chatHubTreeItems, setHiddenProjectIds]);

const chatHubUpdateAllHubIds = useMemo(() => {
  const stableRelease = wheelMakerPublicMetadata?.stable ?? null;
  return updateHubCards
    .filter(card => deriveWheelMakerHubStatus(
      card.wheelMaker?.data?.installed,
      stableRelease,
      card.wheelMaker?.data?.job,
    ) === 'update_available')
    .map(card => card.hubId);
}, [updateHubCards, wheelMakerPublicMetadata]);

const handleChatHubUpdateAllHubs = useCallback(() => {
  requestWheelMakerUpdateAll(chatHubUpdateAllHubIds);
}, [chatHubUpdateAllHubIds, requestWheelMakerUpdateAll]);
```

import 增加：`toggleHubVisibility`（hubProjectPreferences）、`type ChatHubNpmPackageView`（ChatHubMenu）。

- [ ] **Step 3: `renderChatHubSummary` 补 props**

```tsx
onPackageAction={handleChatHubPackageAction}
onScanProject={handleChatHubScanProject}
onToggleAllProjects={handleChatHubToggleAllProjects}
latestVersion={wheelMakerPublicMetadata?.stable.version || '-'}
updateAllAvailableCount={chatHubUpdateAllHubIds.length}
updateAllPending={wheelMakerUpdateAllPending}
onUpdateAllHubs={handleChatHubUpdateAllHubs}
```

- [ ] **Step 4: tsc + jest 通过后 Commit**

Run: `cd app && npm run tsc:web && npx jest web/src/app/ChatHubMenu.test.tsx`
Expected: tsc 无输出；测试 PASS

```bash
git add -A && git commit -m "feat(hub-menu): wire npm/scan/visibility/footer actions"
```

---

### Task 5: CSS — split button / detail / footer

**Files:**
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 追加样式（替换 `.chat-hub-ops-grid` / `.chat-hub-ops-button*` 块）**

```css
.chat-hub-line {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 30px;
  font-size: 11px;
}

.chat-hub-line + .chat-hub-line,
.chat-hub-section + .chat-hub-line,
.chat-hub-line + .chat-hub-section {
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 30%, transparent);
}

.chat-hub-line-icon { flex: 0 0 auto; color: var(--text-tertiary); display: inline-flex; }
.chat-hub-line-label { color: var(--text-primary); font-weight: 600; }
.chat-hub-line-summary {
  flex: 1 1 auto; min-width: 0; text-align: right;
  color: var(--text-tertiary); font-size: 10px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chat-hub-line-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; }

.chat-hub-action {
  display: inline-flex; align-items: stretch;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent);
  border-radius: 6px; overflow: hidden;
}
.chat-hub-action.expanded { border-color: color-mix(in srgb, var(--border-subtle) 95%, transparent); }
.chat-hub-action-main {
  appearance: none; border: none; background: transparent;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px; color: var(--text-secondary);
  font: inherit; font-size: 10px; font-weight: 600; cursor: pointer;
}
.chat-hub-action-main:hover:not(:disabled) { color: var(--text-primary); background: color-mix(in srgb, var(--hover) 70%, transparent); }
.chat-hub-action-main:disabled { opacity: 0.5; cursor: default; }
.chat-hub-action-info { color: var(--text-tertiary); font-weight: 500; }
.chat-hub-action-toggle {
  appearance: none; border: none;
  border-left: 1px solid color-mix(in srgb, var(--border-subtle) 45%, transparent);
  background: transparent; color: var(--text-tertiary);
  display: inline-flex; align-items: center; padding: 0 3px; cursor: pointer;
}
.chat-hub-action-toggle:hover { color: var(--text-primary); background: color-mix(in srgb, var(--hover) 70%, transparent); }

.chat-hub-detail {
  margin: 0 0 4px 30px; padding: 2px 0 4px;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 30%, transparent);
}
.chat-hub-detail-empty { padding: 3px 2px; color: var(--text-tertiary); font-size: 10px; }

.chat-hub-npm-row, .chat-hub-scan-row {
  min-height: 26px; display: flex; align-items: center; gap: 6px; padding: 1px 2px;
}
.chat-hub-npm-name, .chat-hub-scan-name {
  flex: 1 1 auto; min-width: 0; font-size: 11px; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chat-hub-npm-versions { flex: 0 0 auto; font-size: 10px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.chat-hub-npm-actions { flex: 0 0 auto; display: inline-flex; gap: 4px; align-items: center; }
.chat-hub-scan-status { flex: 0 0 auto; font-size: 10px; color: var(--text-tertiary); }
.chat-hub-scan-status.status-indexed { color: var(--state-success); }
.chat-hub-scan-status.status-error, .chat-hub-scan-status.status-failed { color: var(--danger, #df6674); }

.chat-hub-mini-btn {
  appearance: none; border: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
  background: transparent; color: var(--text-secondary);
  font: inherit; font-size: 10px; font-weight: 600;
  border-radius: 5px; padding: 2px 8px; cursor: pointer;
}
.chat-hub-mini-btn:hover:not(:disabled) { color: var(--text-primary); background: color-mix(in srgb, var(--hover) 80%, transparent); }
.chat-hub-mini-btn:disabled { opacity: 0.45; cursor: default; }

.chat-hub-icon-btn {
  appearance: none; width: 20px; height: 20px; border: none; border-radius: 5px;
  background: transparent; color: var(--text-tertiary);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.chat-hub-icon-btn:hover:not(:disabled) { color: var(--text-primary); background: color-mix(in srgb, var(--hover) 80%, transparent); }
.chat-hub-icon-btn:disabled { opacity: 0.45; cursor: default; }

.chat-hub-skills-summary { padding: 3px 2px; font-size: 10px; color: var(--text-tertiary); }

.chat-hub-footer {
  margin-top: 4px; padding: 6px 4px 2px;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 40%, transparent);
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.chat-hub-footer-version { font-size: 10px; color: var(--text-tertiary); }
.chat-hub-footer-version-value { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.chat-hub-footer-update-all {
  appearance: none; border: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
  background: transparent; color: var(--text-secondary);
  display: inline-flex; align-items: center; gap: 5px;
  font: inherit; font-size: 10px; font-weight: 600;
  border-radius: 6px; padding: 3px 9px; cursor: pointer;
}
.chat-hub-footer-update-all:hover:not(:disabled) { color: var(--text-primary); background: color-mix(in srgb, var(--hover) 80%, transparent); }
.chat-hub-footer-update-all:disabled { opacity: 0.45; cursor: default; }
```

删除不再使用的 `.chat-hub-ops-grid`、`.chat-hub-ops-button`、`.chat-hub-ops-button-label`、`.chat-hub-ops-button-sub` 块（`.chat-hub-ops-error` 保留，skills detail 用）。

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(hub-menu): split button, detail and footer styles"
```

---

### Task 6: 删除 Update 设置页 + APK 卡迁移 Settings 根页

**Files:**
- Delete: `app/web/src/settings/UpdateSettingsDetail.tsx`、`app/web/src/settings/UpdateSettingsDetail.test.tsx`
- Modify: `app/web/src/settings/SettingsBundle.ts`、`settingsNavigation.ts`、`SettingsSurface.tsx`、`SettingsRootContent.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [ ] **Step 1: 导航清理**

`settingsNavigation.ts`：从 `SettingsPeerDetail` 联合与 `SETTINGS_PEER_DETAILS` 删除 `'update'`；`mobileSettingsShortcutIndex` 改为 `case 'skills': return 1; case 'portRelay': return 2;`。

`SettingsSurface.tsx`：删除 `MOBILE_SETTINGS_SHORTCUTS` 的 update 项与 `settingsDetailTitle` 的 `case 'update'`。

`SettingsBundle.ts`：删除 `export { UpdateSettingsDetail } from './UpdateSettingsDetail';`。

- [ ] **Step 2: WorkspaceApp 清理**

删除：
1. `UpdateSettingsDetail` lazy import（L686-688 区块）。
2. `renderUpdateSettingsDetail` 函数（L15979-16040）及 renderDetail 路由中 `if (detail === 'update')` 分支（L16160 附近）。
3. `renderSettingsDetailActions` 的 `if (detail === 'update')` 分支（L15863-15878）。
4. update-entry effect（L13293-13312 整块）。
5. `refreshWheelMakerReleaseHistory` 函数与 `wheelMakerReleaseHistory`/`Loading`/`Error` state、`fetchWheelMakerReleaseHistory` import（死代码）。
6. `updateSurfaceActiveRef` effect 简化为：

```ts
const updateSurfaceActiveRef = useRef(false);
useEffect(() => {
  updateSurfaceActiveRef.current = chatHubMenuOpen;
}, [chatHubMenuOpen]);
```

7. `expandedNpmUpdateHubIds` / `expandedProjectIndexHubIds` state（仅 Update 页使用）。
8. Android APK 触发：新增 settings 打开时刷新（APK 卡搬到根页后需要数据）：

```ts
useEffect(() => {
  if (sidebarSettingsOpen) {
    refreshAndroidApkUpdateRef.current?.().catch(() => undefined);
  }
}, [sidebarSettingsOpen]);
```

- [ ] **Step 3: APK 卡迁移到 `SettingsRootContent.tsx`**

Props 增加（类型来自 `platform/android/androidApkUpdate`）：

```ts
androidApkUpdateSupported: boolean;
androidApkLocalRelease: AndroidApkLocalRelease | null;
androidApkLatestRelease: AndroidApkLatestRelease | null;
androidApkUpdateLoading: boolean;
androidApkUpdateError: string;
androidApkInstallStatus: string;
androidApkInstallPending: boolean;
refreshAndroidApkUpdate: () => Promise<void>;
requestAndroidApkInstall: () => Promise<void>;
androidApkUpdateStatusLabel: (status: AndroidApkUpdateStatus) => string;
```

在 `renderSettingsSection({id: 'server', ...})` 之前插入（仅 Android 渲染）：

```tsx
{androidApkUpdateSupported ? renderSettingsSection({id: 'android', title: 'Android', icon: 'smartphone', rows: (
  <div className="set-card set-card--tight update-apk-card">
    <div className="update-apk-row">
      <Icon name="smartphone" size={15} className="update-apk-icon" />
      <span className="update-apk-scope">Android APK</span>
      <span className="update-apk-versions set-mono set-num">
        {androidApkLocalRelease?.versionName ? `v${androidApkLocalRelease.versionName}` : '-'}
        {resolveAndroidApkUpdateStatus(androidApkLocalRelease, androidApkLatestRelease) === 'update_available' && androidApkLatestRelease?.tagName
          ? ` → ${androidApkLatestRelease.tagName}` : ''}
      </span>
      <span className="set-card-spacer" />
      <div className="update-apk-actions">
        <button type="button" className="set-btn set-btn--primary"
          disabled={androidApkInstallPending}
          onClick={() => requestAndroidApkInstall().catch(() => undefined)}>
          {androidApkInstallPending ? 'Preparing...' : 'Download & Install'}
        </button>
        <button type="button" className="set-btn"
          disabled={androidApkUpdateLoading}
          onClick={() => refreshAndroidApkUpdate().catch(() => undefined)}>
          {androidApkUpdateLoading ? 'Checking...' : 'Check'}
        </button>
      </div>
    </div>
    {androidApkUpdateError ? <div className="set-error">{androidApkUpdateError}</div> : null}
    {androidApkInstallStatus ? <div className="set-muted">{androidApkInstallStatus}</div> : null}
  </div>
)}) : null}
```

`SettingsSectionId` 联合增加 `'android'`。import 增加 `resolveAndroidApkUpdateStatus` 及类型。

- [ ] **Step 4: `renderSettingsRootContent` 接线**

WorkspaceApp 传给 `SettingsRootContent` 增加上述 10 个 APK props（state/handler 均现成）。

- [ ] **Step 5: 删除文件 + tsc**

```bash
git rm app/web/src/settings/UpdateSettingsDetail.tsx app/web/src/settings/UpdateSettingsDetail.test.tsx
cd app && npm run tsc:web
```

Expected: tsc 无输出（若有残留引用，逐个清理）

```bash
git add -A && git commit -m "refactor(settings): remove Update detail page, move APK card to settings root"
```

---

### Task 7: 测试套件迁移 + 全量验证 + 合回 main

**Files:**
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-responsive-ui-state.test.ts`、`web-chat-ui.test.ts`（如引用 renderUpdateSettingsDetail / update 路由）
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`（footer/projects 已含；补 Settings 行不受影响回归）

- [ ] **Step 1: 跑全量 jest 收集失败**

Run: `cd app && npx jest 2>&1 | Select-String "^FAIL"`
Expected: `web-agent-package-update-settings.test.ts` 及可能 1-2 个源码结构套件 FAIL

- [ ] **Step 2: 重写 `web-agent-package-update-settings.test.ts`**

该套件混合两类断言：(a) `UpdateSettingsDetail.tsx` 源码结构（删除整个 describe/相关 test）；(b) WorkspaceApp 轮询/refs 结构（保留，但 update-entry effect 断言 L320-332 改为菜单打开 effect）：

```ts
const menuEffectStart = mainTsx.indexOf('if (!chatHubMenuOpen || !connected || registryHubs.length === 0) {');
expect(menuEffectStart).toBeGreaterThanOrEqual(0);
const menuEffect = mainTsx.slice(menuEffectStart, mainTsx.indexOf('}, [chatHubMenuOpen', menuEffectStart));
expect(menuEffect).toContain('refreshWheelMakerUpdatesRef.current?.({silent: true})');
expect(menuEffect).toContain('refreshAgentPackagesRef.current?.({silent: true})');
expect(menuEffect).toContain('refreshProjectFileIndexesRef.current?.(hubIds, {silent: true})');
```

同时删除对 `renderUpdateSettingsDetail`、`UpdateSettingsDetail.tsx`、`expandedNpmUpdateHubIds`、`settingsDetailView !== 'update'` effect 的所有断言；`updateSurfaceActiveRef` 断言改为：

```ts
expect(mainTsx).toContain('updateSurfaceActiveRef.current = chatHubMenuOpen;');
```

- [ ] **Step 3: 其余套件按失败信息就地修正**

Run: `cd app && npx jest`
对仍 FAIL 的断言：凡引用 `renderUpdateSettingsDetail`、`detail === 'update'`、`MOBILE_SETTINGS_SHORTCUTS` update 项、`settingsDetailTitle` Update 的，删除或改指 ChatHubMenu/SettingsRootContent。APK 卡断言改指 `SettingsRootContent.tsx`（含 `update-apk-card`）。

- [ ] **Step 4: 全量验证**

Run: `cd app && npx jest && npm run tsc:web && npm run build:web`
Expected: jest 全 PASS；tsc 无输出；webpack compiled successfully

Run: `cd server && go test ./...`
Expected: 全 ok（本计划零 server 改动，防 worktree 漂移）

- [ ] **Step 5: Commit + push 分支 + 合回 main**

```bash
git add -A && git commit -m "test(hub-menu): migrate suites off the removed Update page"
git push origin hub-menu-unification
```

按 `docs/user/git-preferences.md`：main 工作树干净 → 合回并 push main，清理 worktree/分支：

```bash
cd D:\Code\WheelMaker
git merge --no-ff hub-menu-unification -m "feat(hub-menu): unify per-hub operations into the hub menu"
git push origin main
git worktree remove .worktree/hub-menu-unification
git branch -d hub-menu-unification
git push origin --delete hub-menu-unification
```

---

## 自我审查结果

- **Spec 覆盖**：复合按钮行（T1）、NPM 逐包（T2）、Skills/Visibility/Scan detail + footer（T3）、数据与回调（T4）、样式（T5）、Update 页删除 + APK 迁移 + 导航清理（T6）、测试迁移（T7）。spec「轮询保活」由 T6-Step2.6 保持；「老 hub 降级」无改动（既有行为）；「移动端同构」由 ChatHubMenu 单面板天然覆盖。
- **占位符**：Task 1 Step 4 含一句过渡说明（先占位后由 T2/T3 完成）——执行时按 T1→T2→T3 顺序连续完成同一测试文件的绿灯，不产生中间态 commit。
- **类型一致性**：`ChatHubDetailId`、`ChatHubNpmPackageView`、`ChatHubIndexProjectView` 在 T1-T4 间签名一致；`onPackageAction` 三处（props/测试/handler）一致；`toggleHubVisibility` 签名与 `hubProjectPreferences.ts:212` 一致。
