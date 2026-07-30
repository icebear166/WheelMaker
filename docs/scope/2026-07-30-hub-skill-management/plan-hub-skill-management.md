# Hub Skill Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move complete Hub-global and Project-scoped Skill management into the Hub menu without changing list row height, mixing scopes, or removing the transitional Skills settings page.

**Architecture:** Keep `WorkspaceApp` as the owner of Registry calls, confirmation state, polling, and global feedback. Add focused Hub-menu list and companion-surface components that consume existing Skill snapshots and shared detail/install content. Hub-global and selected-Project targets are represented by explicit scope objects so every install, update, uninstall, and retry preserves its boundary.

**Tech Stack:** React 19, TypeScript, `react-test-renderer`, Jest 30, existing Registry workspace service, CSS in `app/web/src/styles`.

---

## Planned file structure

- `app/web/src/settings/skillManagementView.ts`: shared Skill UI target types and pure scope/pending/project helpers.
- `app/web/src/settings/SkillManagementContent.tsx`: reusable install form and detail body used by both Settings and the Hub companion surface.
- `app/web/src/settings/SkillManagementContent.test.tsx`: component tests for Marketplace placement, candidate selection, detail markdown, and external status.
- `app/web/src/settings/SkillsSettingsDetail.tsx`: retain the transitional settings page while consuming shared content.
- `app/web/src/app/ChatHubSkillManagement.tsx`: compact Hub/Project toolbars, selector, stable-row list, and selection mode.
- `app/web/src/app/ChatHubSkillManagement.test.tsx`: behavior and scope tests for the compact list.
- `app/web/src/app/ChatHubSkillCompanion.tsx`: desktop/mobile detail and install content wrapper, loaded only when opened.
- `app/web/src/app/ChatHubSkillCompanion.test.tsx`: companion header, content, and close behavior tests.
- `app/web/src/app/ChatHubMenu.tsx`: three-way Projects row, Skill disclosures, desktop companion card, and mobile child page.
- `app/web/src/app/ChatHubMenu.test.tsx`: Hub menu integration, mutual exclusion, non-closing actions, and responsive surface tests.
- `app/web/src/common/RetryToast.tsx`: persistent action toast with Retry and Dismiss.
- `app/web/src/common/RetryToast.test.tsx`: persistent toast interaction tests.
- `app/web/src/common/Icon.tsx`: verified Lucide `info` and `link` glyphs.
- `app/web/src/app/WorkspaceApp.tsx`: Skill snapshot mapping, scope-safe actions, surface ownership, polling feedback, and Android back priority.
- `app/web/src/styles/chat.css`: compact list, three equal controls, desktop companion, mobile child page, and stable action slots.
- `app/web/src/styles/settings.css`: shared install/detail content compatibility after extraction.
- `app/web/src/styles/shell.css`: persistent retry toast styling.
- `app/__tests__/web-skill-management-view.test.ts`: pure helper coverage.
- `app/__tests__/web-skill-management-settings.test.ts`: source-level migration and scope-boundary assertions.
- `app/__tests__/web-mobile-settings-system-back.test.ts`: APK back ordering for Hub Skill child pages.
- `app/__tests__/web-chat-ui.test.ts`: outside-click containment for the desktop companion wrapper.

### Task 1: Centralize Skill scope models and pure helpers

**Files:**
- Modify: `app/web/src/settings/skillManagementView.ts`
- Modify: `app/__tests__/web-skill-management-view.test.ts`
- Modify: `app/web/src/settings/SkillsSettingsDetail.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [ ] **Step 1: Write failing tests for scope identity, online Projects, total counts, and pending keys**

Add imports and cases to `app/__tests__/web-skill-management-view.test.ts`:

```ts
import {
  onlineSkillProjects,
  projectSkillTotal,
  sameSkillScopeTarget,
  skillActionPendingKey,
  skillScopeSelectionKey,
} from '../web/src/settings/skillManagementView';

test('keeps all-project counts separate from online project selection', () => {
  const projects = [
    {projectName: 'offline', online: false, skills: [{name: 'one', category: '', categoryKey: '', managed: true}]},
    {projectName: 'beta', online: true, skills: [{name: 'two', category: '', categoryKey: '', managed: true}]},
    {projectName: 'alpha', online: true, skills: []},
  ];

  expect(projectSkillTotal(projects)).toBe(2);
  expect(onlineSkillProjects(projects).map(project => project.projectName)).toEqual(['alpha', 'beta']);
});

test('builds stable Skill scope and action identities', () => {
  const target = {hubId: 'hub-a', scope: 'project' as const, projectName: 'WheelMaker'};

  expect(skillScopeSelectionKey(target)).toBe('hub-a:project:WheelMaker');
  expect(skillActionPendingKey({...target, skillName: 'scope', action: 'skillUpdate'}))
    .toBe('hub-a:project:WheelMaker:scope:skillUpdate');
  expect(sameSkillScopeTarget(target, {...target})).toBe(true);
  expect(sameSkillScopeTarget(target, {hubId: 'hub-a', scope: 'hub'})).toBe(false);
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run from `app/`:

```powershell
npm test -- --runInBand __tests__/web-skill-management-view.test.ts
```

Expected: FAIL because the new helpers are not exported.

- [ ] **Step 3: Add shared target types and helpers**

Add to `skillManagementView.ts`:

```ts
export type SkillScopeTarget = {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
};

export type SkillInstallTarget = SkillScopeTarget;

export type SkillDetailTarget = SkillScopeTarget & {
  skillName: string;
};

export type SkillUpdateTarget = SkillScopeTarget & {
  includeProjects?: boolean;
  skills?: string[];
};

export type SkillUninstallTarget = SkillScopeTarget & {
  skillName: string;
};

export type SkillBatchUninstallTarget = SkillScopeTarget & {
  skillNames: string[];
};

export type SkillPendingKeyInput = SkillScopeTarget & {
  skillName?: string;
  action: string;
};

export function skillScopeSelectionKey(input: SkillScopeTarget): string {
  return [input.hubId, input.scope, input.projectName || ''].join(':');
}

export function skillActionPendingKey(input: SkillPendingKeyInput): string {
  return [
    input.hubId,
    input.scope,
    input.projectName || '',
    input.skillName || '',
    input.action,
  ].join(':');
}

export function sameSkillScopeTarget(
  left: SkillScopeTarget | null,
  right: SkillScopeTarget,
): boolean {
  return Boolean(
    left
    && left.hubId === right.hubId
    && left.scope === right.scope
    && (left.projectName || '') === (right.projectName || ''),
  );
}

export function projectSkillTotal(projects: RegistrySkillProjectSnapshot[]): number {
  return projects.reduce((total, project) => total + project.skills.length, 0);
}

export function onlineSkillProjects(
  projects: RegistrySkillProjectSnapshot[],
): RegistrySkillProjectSnapshot[] {
  return sortSkillProjects(projects).filter(project => project.online);
}
```

Move the duplicate target types and `skillScopeSelectionKey` out of `SkillsSettingsDetail.tsx`, and move `skillActionPendingKey` plus `sameSkillInstallTarget` out of `WorkspaceApp.tsx`. Import the shared definitions in both files without changing behavior.

- [ ] **Step 4: Run helper and TypeScript tests**

Run:

```powershell
npm test -- --runInBand __tests__/web-skill-management-view.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 5: Commit the shared model extraction**

```powershell
git add app/web/src/settings/skillManagementView.ts app/web/src/settings/SkillsSettingsDetail.tsx app/web/src/app/WorkspaceApp.tsx app/__tests__/web-skill-management-view.test.ts
git commit -m "refactor(app): centralize skill scope helpers"
```

### Task 2: Extract reusable Skill install and detail content

**Files:**
- Create: `app/web/src/settings/SkillManagementContent.tsx`
- Create: `app/web/src/settings/SkillManagementContent.test.tsx`
- Modify: `app/web/src/settings/SkillsSettingsDetail.tsx`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`
- Modify: `app/web/src/styles/settings.css`

- [ ] **Step 1: Write failing shared-content tests**

Create `SkillManagementContent.test.tsx` with a renderer helper and these assertions:

```tsx
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  SkillDetailContent,
  SkillInstallContent,
} from './SkillManagementContent';

test('keeps Marketplace inside the Add Skill content', async () => {
  const onList = jest.fn().mockResolvedValue(undefined);
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SkillInstallContent
        sourceInput=""
        onSourceInputChange={jest.fn()}
        sourceLoading={false}
        sourceError=""
        candidates={[{name: 'baseline-ui', category: 'UI', categoryKey: 'ui'}]}
        selectedNames={[]}
        onList={onList}
        onToggleAll={jest.fn()}
        onToggleCandidate={jest.fn()}
        onInstall={jest.fn()}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'skill-install-marketplace'}).props.href)
    .toBe('https://www.skills.sh/');
  expect(renderer.root.findByProps({placeholder: 'owner/repo or npx skills add --skill name'}))
    .toBeTruthy();
  act(() => renderer.root.findByProps({'aria-label': 'List source skills'}).props.onClick());
  expect(onList).toHaveBeenCalled();
});

test('renders managed state, markdown, and supporting files in detail content', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SkillDetailContent
        loading={false}
        error=""
        detail={{
          name: 'baseline-ui',
          scope: 'hub',
          category: 'UI',
          categoryKey: 'ui',
          managed: false,
          source: 'owner/repo',
          skillMarkdown: '# Baseline UI',
          supportingFiles: [{relativePath: 'references/a.md', size: 12}],
        }}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'skill-detail-managed-state'}).children)
    .toEqual(['External']);
  expect(renderer.root.findByProps({className: 'skill-detail-markdown markdown-preview'}))
    .toBeTruthy();
  expect(renderer.root.findByProps({title: 'references/a.md'})).toBeTruthy();
});
```

- [ ] **Step 2: Run the content test and verify it fails**

Run:

```powershell
npm test -- --runInBand web/src/settings/SkillManagementContent.test.tsx
```

Expected: FAIL because `SkillManagementContent.tsx` does not exist.

- [ ] **Step 3: Implement shared content with no surface positioning**

Create `SkillManagementContent.tsx` with:

```tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {Icon} from '../common/Icon';
import type {
  RegistrySkillDetail,
  RegistrySkillSourceCandidate,
  RegistrySkillSupportingFile,
} from '../registry/registryTypes';

export const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';
const SKILL_MARKDOWN_REMARK_PLUGINS = [remarkGfm];

export type SkillInstallContentProps = {
  sourceInput: string;
  onSourceInputChange: (value: string) => void;
  sourceLoading: boolean;
  sourceError: string;
  candidates: RegistrySkillSourceCandidate[];
  selectedNames: string[];
  onList: () => Promise<void>;
  onToggleAll: () => void;
  onToggleCandidate: (name: string) => void;
  onInstall: () => void;
};

export type SkillDetailContentProps = {
  loading: boolean;
  error: string;
  detail: RegistrySkillDetail | null;
};
```

Implement the install content with this fixed order:

1. Marketplace link.
2. Source input and List button.
3. Source error.
4. Select-all row and candidate rows.
5. Selected count and Install button.

Implement detail content with loading/error states followed by Install metadata, managed/external state, rendered `Skill.md`, and sorted supporting files. Keep positioning, headers, close buttons, and destructive actions in the owning Settings or Hub surface.

- [ ] **Step 4: Replace duplicated Settings content without changing the transitional page layout**

In `SkillsSettingsDetail.tsx`:

- use `SkillInstallContent` inside the existing `settings-skills-install-panel`;
- use `SkillDetailContent` inside `SkillDetailPanel`;
- remove the fixed Marketplace card from `settings-skills-fixed-controls`;
- keep Hub picker, category groups, Project groups, existing confirmations, and settings-side-panel behavior unchanged.

Update `web-skill-management-settings.test.ts` so it reads `SkillManagementContent.tsx` and asserts:

```ts
expect(contentTsx).toContain("export const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';");
expect(contentTsx).toContain('className="skill-install-marketplace"');
expect(detailTsx).not.toContain('settings-skills-marketplace-link');
expect(contentTsx).toContain("import ReactMarkdown from 'react-markdown';");
expect(contentTsx).toContain('remarkPlugins={SKILL_MARKDOWN_REMARK_PLUGINS}');
```

- [ ] **Step 5: Run focused Settings regressions**

Run:

```powershell
npm test -- --runInBand web/src/settings/SkillManagementContent.test.tsx __tests__/web-skill-management-settings.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit the shared content extraction**

```powershell
git add app/web/src/settings/SkillManagementContent.tsx app/web/src/settings/SkillManagementContent.test.tsx app/web/src/settings/SkillsSettingsDetail.tsx app/web/src/styles/settings.css app/__tests__/web-skill-management-settings.test.ts
git commit -m "refactor(app): share skill management content"
```

### Task 3: Build the compact scope-safe Skill list

**Files:**
- Create: `app/web/src/app/ChatHubSkillManagement.tsx`
- Create: `app/web/src/app/ChatHubSkillManagement.test.tsx`
- Modify: `app/web/src/common/Icon.tsx`

- [ ] **Step 1: Add failing tests for flat rows, fixed actions, and scope-safe bulk actions**

Create `ChatHubSkillManagement.test.tsx`. Use this target and action harness:

```tsx
const hubTarget = {hubId: 'hub-a', scope: 'hub' as const};
const projectTarget = {
  hubId: 'hub-a',
  scope: 'project' as const,
  projectName: 'alpha',
};
const skills = [
  {name: 'baseline-ui', category: 'UI', categoryKey: 'ui', managed: true},
  {name: 'external-skill', category: 'External', categoryKey: 'external', managed: false},
];
const actions = {
  onAdd: jest.fn(),
  onDetail: jest.fn(),
  onUpdate: jest.fn(),
  onUninstall: jest.fn(),
  onBatchUninstall: jest.fn(),
  onRetry: jest.fn(),
};
```

Assert the Hub scope:

```tsx
expect(renderer.root.findAllByProps({className: 'chat-hub-skill-row'})).toHaveLength(2);
expect(renderer.root.findAllByProps({className: 'chat-hub-skill-category'})).toHaveLength(0);
expect(renderer.root.findAllByProps({className: 'chat-hub-skill-meta'})).toHaveLength(0);

const managed = renderer.root.findByProps({'data-skill-name': 'baseline-ui'});
expect(managed.findAllByType('button').map(button => button.props['aria-label']))
  .toEqual(['View baseline-ui details', 'Update baseline-ui', 'Uninstall baseline-ui']);
expect(managed.findByProps({className: 'chat-hub-skill-name'}).type).toBe('span');

const external = renderer.root.findByProps({'data-skill-name': 'external-skill'});
expect(external.findByProps({'data-icon-name': 'link'})).toBeTruthy();
expect(external.findByProps({'aria-label': 'View external-skill details'}).props.disabled)
  .not.toBe(true);
expect(external.findByProps({'aria-label': 'Update external-skill'}).props.disabled).toBe(true);
expect(external.findByProps({'aria-label': 'Uninstall external-skill'}).props.disabled).toBe(true);
```

Assert toolbar behavior:

```tsx
act(() => renderer.root.findByProps({'aria-label': 'Add Hub skills'}).props.onClick());
expect(actions.onAdd).toHaveBeenCalledWith(hubTarget);

act(() => renderer.root.findByProps({'aria-label': 'Update all Hub skills'}).props.onClick());
expect(actions.onUpdate).toHaveBeenCalledWith({...hubTarget, includeProjects: false});

act(() => renderer.root.findByProps({'aria-label': 'Select Hub skills'}).props.onClick());
const checkbox = renderer.root.findByProps({'aria-label': 'Select baseline-ui'});
act(() => checkbox.props.onChange());
act(() => renderer.root.findByProps({'aria-label': 'Uninstall selected Hub skills'}).props.onClick());
expect(actions.onBatchUninstall).toHaveBeenCalledWith({
  ...hubTarget,
  skillNames: ['baseline-ui'],
});
```

Add a Project case that expects:

```tsx
expect(actions.onUpdate).toHaveBeenCalledWith(projectTarget);
expect(actions.onBatchUninstall).toHaveBeenCalledWith({
  ...projectTarget,
  skillNames: ['project-skill'],
});
```

Add a pending-action case that checks only the matching Update or Uninstall icon becomes `loader`, while all three action slots remain rendered.

- [ ] **Step 2: Run the compact-list test and verify it fails**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubSkillManagement.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add verified icons**

Use the Better Icons CLI before editing:

```powershell
better-icons get lucide:info
better-icons get lucide:link
```

Add `info` and `link` to `Icon.tsx` using the Lucide 24×24 path geometry, adapted to the repository’s single renderer-level stroke. Reuse the existing `listChecks`, `plus`, `refreshCw`, `trash`, `loader`, and `eye` icons.

- [ ] **Step 4: Implement `ChatHubSkillScopeDetail`**

Export these concrete interfaces:

```ts
export type ChatHubSkillActions = {
  onAdd: (target: SkillInstallTarget) => void;
  onDetail: (target: SkillDetailTarget) => void;
  onUpdate: (target: SkillUpdateTarget) => void;
  onUninstall: (target: SkillUninstallTarget) => void;
  onBatchUninstall: (target: SkillBatchUninstallTarget) => void;
  onRetry: (hubId: string) => void;
};

export type ChatHubSkillScopeDetailProps = {
  target: SkillScopeTarget;
  label: string;
  skills: RegistrySkillSnapshot[];
  loading: boolean;
  error: string;
  operationRunning: boolean;
  pendingKey: string;
  actions: ChatHubSkillActions;
};
```

Implement these fixed render rules:

- sort rows by `name`;
- reserve a checkbox column at all times and use `visibility: hidden` outside selection mode;
- render name as a `span`, with a `link` icon beside external Skills;
- reserve exactly three row action buttons: Detail, Update, Uninstall;
- show a loader only in the matching action button by comparing `pendingKey` with `skillActionPendingKey`;
- enter selection mode through `listChecks`;
- only managed Skills are selectable;
- keep row actions in their grid while selection mode is active, but hide them with CSS visibility;
- keep toolbar height fixed while swapping normal actions for selected count, Cancel, and Uninstall;
- call Hub Update all with `{hubId, scope: 'hub', includeProjects: false}`;
- call Project Update all with `{hubId, scope: 'project', projectName}`;
- display `No managed skills` in the disabled text button when no managed Skill exists;
- display loading or empty copy only when the list has no rows;
- expose a Retry button only for load errors.

- [ ] **Step 5: Run compact-list tests and type checking**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubSkillManagement.test.tsx
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit the compact list**

```powershell
git add app/web/src/app/ChatHubSkillManagement.tsx app/web/src/app/ChatHubSkillManagement.test.tsx app/web/src/common/Icon.tsx
git commit -m "feat(app): add compact hub skill lists"
```

### Task 4: Add Project Skills and three equal Projects controls

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Extend failing mutual-exclusion and Projects-row tests**

Update the detail group test:

```ts
expect(toggleChatHubDetailSections(['settings', 'skills', 'scan'], 'projectSkills'))
  .toEqual(['settings', 'skills', 'projectSkills']);
expect(toggleChatHubDetailSections(['settings', 'skills', 'projectSkills'], 'visibility'))
  .toEqual(['settings', 'skills', 'visibility']);
```

Add a Projects-row test with one online and one offline project snapshot:

```tsx
const projectButtons = renderer.root
  .findByProps({className: 'chat-hub-line-actions chat-hub-project-actions'})
  .findAllByType('button');

expect(projectButtons).toHaveLength(3);
expect(projectButtons.map(button => button.props['aria-label']))
  .toEqual(['Visibility details', 'Scan details', 'Project Skills details']);
expect(projectButtons[0].findByProps({'data-icon-name': 'eye'})).toBeTruthy();
expect(projectButtons[0].findAllByProps({className: 'chat-hub-action-label'})).toHaveLength(0);
expect(projectButtons[2].findByProps({className: 'chat-hub-action-info'}).children)
  .toEqual(['3']);
```

Add a Project detail test:

```tsx
expect(renderer.root.findAllByProps({role: 'option'}).map(option => option.props['data-project-name']))
  .toEqual(['alpha']);
expect(renderer.root.findByProps({className: 'chat-hub-project-skill-count'}).children)
  .toEqual(['2']);
expect(renderer.root.findAllByProps({'data-project-name': 'offline'})).toHaveLength(0);
```

- [ ] **Step 2: Run the Hub menu test and verify it fails**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx
```

Expected: FAIL because `projectSkills`, icon-only disclosure labels, and Project Skill data are absent.

- [ ] **Step 3: Extend menu types and disclosure rendering**

Change the detail ID and group:

```ts
export type ChatHubDetailId =
  | 'settings'
  | 'npm'
  | 'skills'
  | 'visibility'
  | 'scan'
  | 'projectSkills';
```

Add to the Skill portion of `ChatHubOpsView`:

```ts
skills: {
  loading: boolean;
  operationRunning: boolean;
  error: string;
  pendingKey: string;
  hubItems: RegistrySkillSnapshot[];
  projects: RegistrySkillProjectSnapshot[];
};
```

Extend `ChatHubDisclosureButton` with:

```ts
icon?: IconName;
hideLabel?: boolean;
```

Keep the visible text for normal disclosures. For Visibility, render `Icon name="eye"` and omit only the visual label while preserving `aria-label="Visibility details"`.

- [ ] **Step 4: Render Hub and Project Skill details**

- Replace the old `ChatHubSkillsDetail` with `ChatHubSkillScopeDetail` for `{hubId, scope: 'hub'}`.
- Compute the outer Project Skill count with `projectSkillTotal(ops.skills.projects)`.
- Render `Project Skills` as the third Projects disclosure.
- In the Project detail, derive `onlineSkillProjects(ops.skills.projects)`, default to the first entry, and reset to the first entry if the current selection disappears.
- Render the selected Project through `ChatHubSkillScopeDetail`.
- Keep the selection in local component state so closing the Hub menu discards it.
- Do not render offline Projects; show `No online projects` if the filtered list is empty.

- [ ] **Step 5: Add the three-column and stable-row CSS**

Change:

```css
.chat-hub-project-actions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
```

Add fixed grids:

```css
.chat-hub-skill-row {
  min-height: 28px;
  grid-template-columns: 18px minmax(0, 1fr) 78px;
}

.chat-hub-skill-row-actions {
  width: 78px;
  grid-template-columns: repeat(3, 24px);
}

.chat-hub-skill-select-slot.is-hidden,
.chat-hub-skill-row-actions.is-selection-mode {
  visibility: hidden;
}
```

Keep the mobile row height fixed at 44px with three 28px action slots. Do not add conditional margins, padding, borders, metadata blocks, or status banners that change the row height.

- [ ] **Step 6: Run Hub menu and compact-list tests**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx web/src/app/ChatHubSkillManagement.test.tsx
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 7: Commit the Projects integration**

```powershell
git add app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubMenu.test.tsx app/web/src/styles/chat.css
git commit -m "feat(app): add project skills to hub menu"
```

### Task 5: Wire all existing Skill operations through explicit scopes

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`

- [ ] **Step 1: Add failing source-boundary tests**

Replace the old Hub-only wiring assertions with exact controller assertions:

```ts
expect(mainTsx).toContain('hubItems: hubSkills,');
expect(mainTsx).toContain('projects: skillProjects,');
expect(mainTsx).toContain('pendingKey: skillsPendingKey,');
expect(mainTsx).toContain('onRequestSkillInstall={target => requestSkillInstall(target, \'hub\')}');
expect(mainTsx).toContain('onRequestSkillDetail={target => requestSkillDetail(target, \'hub\')}');
expect(mainTsx).toContain('onRequestSkillUpdate={requestSkillUpdate}');
expect(mainTsx).toContain('onRequestSkillBatchUninstall={requestSkillBatchUninstall}');
```

Extract the Hub rendering block and assert:

```ts
expect(summaryBlock).toContain("includeProjects: false");
expect(summaryBlock).not.toContain("includeProjects: true");
```

Add component assertions that:

- Hub Update all sends `scope: 'hub', includeProjects: false`;
- Project Update all sends `scope: 'project', projectName: 'alpha'` and no `includeProjects`;
- Project install, detail, uninstall, and batch uninstall all carry `projectName: 'alpha'`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
npm test -- --runInBand __tests__/web-skill-management-settings.test.ts web/src/app/ChatHubMenu.test.tsx
```

Expected: FAIL because Workspace exposes only Hub update/uninstall callbacks and the view model strips Project snapshots.

- [ ] **Step 3: Add explicit surface ownership without changing Registry payloads**

In `WorkspaceApp.tsx`, add:

```ts
type SkillSurfaceOwner = 'settings' | 'hub';

const [skillInstallOwner, setSkillInstallOwner] = useState<SkillSurfaceOwner | null>(null);
const [skillDetailOwner, setSkillDetailOwner] = useState<SkillSurfaceOwner | null>(null);
```

Change the open functions to:

```ts
const requestSkillInstall = useCallback((
  target: SkillInstallTarget,
  owner: SkillSurfaceOwner = 'settings',
) => {
  const sameTarget = sameSkillScopeTarget(skillInstallTarget, target);
  setSkillInstallOwner(owner);
  setSkillDetailOwner(null);
  setSkillDetailTarget(null);
  setSkillInstallTarget(target);
  if (!sameTarget) {
    setSkillSourceError('');
    setSkillSourceCandidates([]);
    setSkillSourceSelectedNames([]);
  }
}, [skillInstallTarget]);
```

Change the detail request entry to this shape:

```ts
const requestSkillDetail = useCallback(async (
  target: SkillDetailTarget,
  owner: SkillSurfaceOwner = 'settings',
) => {
  const cacheKey = skillDetailCacheKey(target);
  setSkillDetailOwner(owner);
  setSkillInstallOwner(null);
  setSkillInstallTarget(null);
  setSkillDetailTarget(target);
  if (owner === 'settings' && !isWide) {
    setSidebarSettingsOpen(true);
    setSettingsDetailView('skillDetail');
  }
  const cached = skillDetailCache[cacheKey];
  if (cached?.detail || cached?.loading) return;
  await loadSkillDetail(target, cacheKey);
}, [isWide, loadSkillDetail, setSidebarSettingsOpen, skillDetailCache]);
```

Extract the current cache mutation and `service.getSkillDetail` request into `loadSkillDetail(target, cacheKey)` without changing its response/error behavior. Opening one Hub companion clears the other companion target.

Keep UI-only owner fields out of `service.installSkills`, `service.getSkillDetail`, `service.updateSkills`, and `service.uninstallSkills` payloads.

- [ ] **Step 4: Expose raw Hub and Project snapshots to the Hub menu**

Build the Skill view without category/agent remapping:

```ts
const hubSkills = skillHub?.data?.hubSkills?.skills ?? [];
const skillProjects = skillHub?.data?.projects ?? [];

skills: {
  loading: skillHub?.loading === true,
  operationRunning: skillHub?.data?.operation?.running === true,
  error: skillHub?.error || '',
  pendingKey: skillsPendingKey,
  hubItems: hubSkills,
  projects: skillProjects,
},
```

Pass the generic target callbacks to `ChatHubMenu`. Ensure the Hub menu’s `onRequestSkillUpdate` wrapper forces `includeProjects: false` for Hub-wide calls, while Project calls pass no `includeProjects`.

- [ ] **Step 5: Keep automatic synchronization and remove manual refresh**

Retain the existing menu-open scan:

```ts
Promise.all(
  registryHubIds.map(hubId => refreshSkillManagementHubRef.current?.(hubId)),
).catch(() => undefined);
```

Retain `await refreshSkillManagementHub(target.hubId)` after successful actions. Wire load-error Retry to `refreshSkillManagementHubRef.current?.(hubId)`. Do not add a refresh icon to either Skill toolbar.

- [ ] **Step 6: Run scope and Registry regressions**

Run:

```powershell
npm test -- --runInBand __tests__/web-skill-management-settings.test.ts __tests__/web-skill-management-service.test.ts web/src/app/ChatHubMenu.test.tsx
npm run tsc:web
```

Expected: PASS, including the existing `includeProjects: false` assertion for Hub menu updates.

- [ ] **Step 7: Commit the action wiring**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-skill-management-settings.test.ts app/web/src/app/ChatHubMenu.test.tsx
git commit -m "feat(app): wire scoped hub skill actions"
```

### Task 6: Add shared desktop and mobile companion surfaces

**Files:**
- Create: `app/web/src/app/ChatHubSkillCompanion.tsx`
- Create: `app/web/src/app/ChatHubSkillCompanion.test.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-mobile-settings-system-back.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Write failing companion content tests**

Create `ChatHubSkillCompanion.test.tsx` and assert:

```tsx
test('renders one Add Skill companion with the bound target', async () => {
  const target = {hubId: 'hub-a', scope: 'project' as const, projectName: 'alpha'};
  const onClose = jest.fn();
  const installHarness = {
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
  };
  const detailHarness = {
    entries: {},
    pendingKey: '',
    onUninstall: jest.fn(),
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatHubSkillCompanion
        surface={{kind: 'install', target}}
        install={installHarness}
        detail={detailHarness}
        onClose={onClose}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'chat-hub-skill-companion-title'}).children)
    .toEqual(['Add Skill']);
  expect(renderer.root.findByProps({className: 'chat-hub-skill-companion-scope'}).children)
    .toEqual(['Project: alpha']);
  expect(renderer.root.findAllByProps({className: 'skill-install-marketplace'})).toHaveLength(1);
});
```

Add a detail case that checks the title, shared detail content, and close callback.

- [ ] **Step 2: Add failing desktop/mobile Hub menu tests**

Desktop:

```tsx
expect(renderer.root.findByProps({className: 'chat-hub-popover-stack'})).toBeTruthy();
expect(renderer.root.findByProps({className: 'chat-hub-skill-companion desktop'})).toBeTruthy();
act(() => renderer.root.findByProps({'aria-label': 'Close Skill details'}).props.onClick());
expect(callbacks.onCloseSkillSurface).toHaveBeenCalled();
expect(callbacks.onClose).not.toHaveBeenCalled();
```

Mobile:

```tsx
expect(renderer.root.findByProps({className: 'chat-hub-page-title'}).children)
  .toEqual(['baseline-ui']);
expect(renderer.root.findByProps({className: 'chat-hub-page-body skill-child'})).toBeTruthy();
act(() => renderer.root.findByProps({className: 'chat-hub-page-back'}).props.onClick());
expect(callbacks.onCloseSkillSurface).toHaveBeenCalled();
expect(callbacks.onClose).not.toHaveBeenCalled();
```

Update `web-mobile-settings-system-back.test.ts` so the Hub Skill child close appears before the Hub page close:

```ts
const skillChildBack = backBody.indexOf('if (!isWide && chatHubMenuOpen && chatHubSkillSurfaceOpen) {');
const hubClose = backBody.indexOf('if (!isWide && chatHubMenuOpen) {');
expect(skillChildBack).toBeGreaterThanOrEqual(0);
expect(skillChildBack).toBeLessThan(hubClose);
expect(backBody.slice(skillChildBack, hubClose)).toContain('closeChatHubSkillSurface();');
expect(backBody.slice(skillChildBack, hubClose)).toContain('return true;');
```

- [ ] **Step 3: Run companion and back tests and verify failure**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubSkillCompanion.test.tsx web/src/app/ChatHubMenu.test.tsx __tests__/web-mobile-settings-system-back.test.ts
```

Expected: FAIL because the Hub-specific companion does not exist.

- [ ] **Step 4: Implement the lazily loaded companion**

`ChatHubSkillCompanion.tsx` must:

- accept the discriminated union:

```ts
export type ChatHubSkillSurface =
  | {kind: 'install'; target: SkillInstallTarget}
  | {kind: 'detail'; target: SkillDetailTarget};
```

- render one common header with title, `skillScopeLabel(target)`, and explicit close button;
- render `SkillInstallContent` for install;
- read the active detail cache entry with `skillDetailCacheKey(target)` and render `SkillDetailContent` for detail;
- expose managed detail uninstall as a destructive footer action;
- contain no portal, fixed positioning, or mobile navigation logic.

Load it in `ChatHubMenu.tsx` with:

```ts
const ChatHubSkillCompanion = React.lazy(
  () => import('./ChatHubSkillCompanion').then(module => ({
    default: module.ChatHubSkillCompanion,
  })),
);
```

- [ ] **Step 5: Wrap the desktop popover and companion in one outside-click boundary**

For desktop, render:

```tsx
<div
  ref={popoverRef}
  className="chat-hub-popover-stack"
  style={popoverStyle}
>
  <div className="chat-hub-popover topbar-menu-surface">{panel}</div>
  {skillSurface ? (
    <aside className="chat-hub-skill-companion desktop">
      <React.Suspense fallback={null}>
        <ChatHubSkillCompanion />
      </React.Suspense>
    </aside>
  ) : null}
</div>
```

Move fixed position, top, and left to the stack. Keep the main popover at 340px and put the companion to its right with an 8px gap and width clamped between 380px and 520px. Update `chatHubPopoverStyle` to shift the main stack left only when required to keep both surfaces inside a 12px viewport inset. The main list width must not shrink.

Update outside-click source tests to assert the wrapper remains assigned to `chatHubPopoverRef`.

- [ ] **Step 6: Render a true mobile child page**

When a Hub-owned Skill surface exists:

- replace the Hub panel body with companion content;
- set the header title to `Add Skill` or the Skill name;
- make Back close only the companion;
- leave the explicit Close button as the only control that closes the whole Hub page;
- preserve the underlying expanded Hub and Project state for the return.

In `handleAndroidNativeBack`, close the Hub Skill child before closing the Hub page. Include `chatHubSkillSurfaceOpen` and `closeChatHubSkillSurface` in the callback dependencies.

- [ ] **Step 7: Run companion, outside-click, back, and type tests**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubSkillCompanion.test.tsx web/src/app/ChatHubMenu.test.tsx __tests__/web-mobile-settings-system-back.test.ts __tests__/web-chat-ui.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit responsive companion surfaces**

```powershell
git add app/web/src/app/ChatHubSkillCompanion.tsx app/web/src/app/ChatHubSkillCompanion.test.tsx app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubMenu.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-mobile-settings-system-back.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): add hub skill companion surfaces"
```

### Task 7: Add non-layout-changing success and retry feedback

**Files:**
- Create: `app/web/src/common/RetryToast.tsx`
- Create: `app/web/src/common/RetryToast.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`
- Modify: `app/web/src/styles/shell.css`

- [ ] **Step 1: Write the failing persistent toast test**

Create `RetryToast.test.tsx`:

```tsx
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {RetryToast} from './RetryToast';

test('keeps an error visible and exposes retry and dismiss actions', async () => {
  const onRetry = jest.fn();
  const onDismiss = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <RetryToast
        message="Skill update failed"
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'app-retry-toast-message'}).children)
    .toEqual(['Skill update failed']);
  act(() => renderer.root.findByProps({'aria-label': 'Retry Skill action'}).props.onClick());
  act(() => renderer.root.findByProps({'aria-label': 'Dismiss Skill error'}).props.onClick());
  expect(onRetry).toHaveBeenCalled();
  expect(onDismiss).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the toast test and verify it fails**

Run:

```powershell
npm test -- --runInBand web/src/common/RetryToast.test.tsx
```

Expected: FAIL because `RetryToast` does not exist.

- [ ] **Step 3: Implement the persistent retry toast**

Create:

```tsx
import React from 'react';
import {Icon} from './Icon';

export function RetryToast({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="app-retry-toast" role="alert" aria-live="assertive">
      <span className="app-retry-toast-message">{message}</span>
      <button type="button" onClick={onRetry} aria-label="Retry Skill action">Retry</button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss Skill error">
        <Icon name="x" />
      </button>
    </div>
  );
}
```

Style it as a fixed overlay near the existing `.app-toast`. It must not participate in Hub menu or list layout.

- [ ] **Step 4: Track replayable Skill failures**

In `WorkspaceApp.tsx`, define:

```ts
type SkillConfirmedTarget = Extract<
  ConfirmTarget,
  {kind: 'skillInstall' | 'skillUninstall' | 'skillBatchUninstall' | 'skillUpdate'}
>;

type SkillRetryTarget =
  | {kind: 'refresh'; hubId: string}
  | {kind: 'action'; target: SkillConfirmedTarget};

const [skillRetryNotice, setSkillRetryNotice] = useState<{
  message: string;
  retry: SkillRetryTarget;
} | null>(null);
const skillActionByHubIdRef = useRef(new Map<string, SkillConfirmedTarget>());
const seenSkillOperationRef = useRef(new Map<string, string>());
```

Before sending an action, save its target in `skillActionByHubIdRef`. On immediate failure, close the confirmation dialog and publish a persistent retry notice with the exact target. On refresh failure, publish `{kind: 'refresh', hubId}`.

When polling returns a terminal operation, deduplicate it by:

```ts
const operationKey = [
  result.operation?.action || '',
  result.operation?.startedAt || '',
  result.operation?.finishedAt || '',
  result.operation?.status || '',
].join(':');
```

- successful terminal operation: call `setToastMessage('Skill operation completed.')`;
- failed terminal operation: use the saved action target for Retry;
- clear the saved target only after terminal success or explicit dismissal.

If an action response is already terminal rather than accepted/running, show the same success Toast immediately after `refreshSkillManagementHub(target.hubId)` succeeds. Do not show an early success Toast for an accepted operation that is still polling.

The Retry button directly repeats an already-confirmed action through `handleSkillConfirmedAction`, or repeats a failed scan through `refreshSkillManagementHubRef`.

- [ ] **Step 5: Ensure pending UI replaces icons in place**

Map `skillsPendingKey` unchanged into the compact component. Do not render operation banners or inline success/error blocks above rows. The only list-level error UI is the empty-state Retry control used when no rows can be loaded; runtime action failures use `RetryToast`.

Add source assertions:

```ts
expect(mainTsx).toContain('<RetryToast');
expect(mainTsx).toContain("setToastMessage('Skill operation completed.')");
expect(mainTsx).toContain("retry: {kind: 'refresh', hubId}");
expect(chatHubSkillTsx).not.toContain('agent-package-task');
expect(chatHubSkillTsx).not.toContain('skillOperationStatusLabel');
```

- [ ] **Step 6: Run toast, Skill, and type tests**

Run:

```powershell
npm test -- --runInBand web/src/common/RetryToast.test.tsx web/src/app/ChatHubSkillManagement.test.tsx __tests__/web-skill-management-settings.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 7: Commit operation feedback**

```powershell
git add app/web/src/common/RetryToast.tsx app/web/src/common/RetryToast.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/shell.css app/__tests__/web-skill-management-settings.test.ts
git commit -m "feat(app): add retryable skill operation feedback"
```

### Task 8: Complete visual, accessibility, and regression verification

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.test.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/settings.css`
- Modify: `docs/wiki/frontend-interaction/hub-menu.md` only if implementation facts differ from the approved wording

- [ ] **Step 1: Add final invariant tests**

Add assertions that:

```tsx
expect(skillRows.map(row => row.props.className)).toEqual([
  'chat-hub-skill-row',
  'chat-hub-skill-row',
]);
expect(skillRows.every(row => row.findAllByProps({className: 'chat-hub-skill-meta'}).length === 0))
  .toBe(true);
expect(renderer.root.findAllByProps({'aria-label': 'Refresh skills'})).toHaveLength(0);
expect(renderer.root.findAllByProps({className: 'chat-hub-skill-row-actions'})
  .every(actions => actions.findAllByType('button').length === 3)).toBe(true);
```

Assert every toolbar and row action click leaves `callbacks.onClose` untouched. Assert the mobile child Back closes the child while the explicit page Close calls `onClose`.

- [ ] **Step 2: Run the final focused tests and verify they fail if an invariant is missing**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx web/src/app/ChatHubSkillManagement.test.tsx web/src/app/ChatHubSkillCompanion.test.tsx
```

Expected before final polish: any uncovered invariant fails. Adjust only the component or CSS responsible for the failure.

- [ ] **Step 3: Finish responsive and focus-visible styling**

Confirm in CSS:

- Projects controls remain three equal columns at desktop and mobile widths;
- Visibility keeps an accessible name while showing only the eye icon and count;
- desktop main popover stays 340px wide when the companion opens;
- companion scroll is independent from the Hub list;
- mobile child body honors safe-area bottom inset;
- all toolbar and row icon buttons have at least 24px desktop and 28px mobile hit areas;
- selection mode, loading, managed/external state, and disabled state never change row min-height;
- focus-visible treatment exists for Project selector options, toolbars, row icons, Retry, and companion close/back controls;
- reduced-motion mode disables companion entry animation.

- [ ] **Step 4: Run all relevant suites**

Run from `app/`:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx web/src/app/ChatHubSkillManagement.test.tsx web/src/app/ChatHubSkillCompanion.test.tsx web/src/settings/SkillManagementContent.test.tsx web/src/common/RetryToast.test.tsx __tests__/web-skill-management-view.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-skill-management-service.test.ts __tests__/web-mobile-settings-system-back.test.ts __tests__/web-chat-ui.test.ts
npm run tsc:web
npm run build:web
```

Expected: all tests PASS, TypeScript exits 0, and production webpack build exits 0.

- [ ] **Step 5: Run the complete App test suite**

Run:

```powershell
npm test -- --runInBand
```

Expected: all App suites and tests PASS.

- [ ] **Step 6: Review the approved scope and Wiki against the implementation**

Check:

```powershell
rg -n "includeProjects|projectSkills|No managed skills|skill-install-marketplace|chat-hub-skill-companion" web/src __tests__
git diff --check
git status --short
```

Verify:

- Hub Update all always uses `includeProjects: false`;
- Project actions always include exactly one selected `projectName`;
- offline Projects are excluded only from the selector, while the outer total still includes their last-known Skills;
- no manual refresh control exists;
- old Skills settings entry remains;
- no Registry protocol or server file changed.

- [ ] **Step 7: Commit final polish**

```powershell
git add app docs/wiki/frontend-interaction/hub-menu.md
git commit -m "test(app): verify hub skill management"
```

- [ ] **Step 8: Rebase, rerun the completion gate, and publish**

From the feature worktree:

```powershell
git fetch origin
git rebase origin/main
cd app
npm test -- --runInBand
npm run tsc:web
npm run build:web
cd ..
git add -A
git commit -m "feat(app): complete hub skill management"
git push origin feature/hub-skill-management
```

The executing agent must keep plan checkbox progress and final verification evidence uncommitted until this exact tail so the required final commit succeeds. Follow `docs/user/git-preferences.md` for merging into `main` and cleanup after the pushed branch is verified.

## Implementation verification

- [x] Tasks 1–3: shared scope helpers, shared install/detail content, and stable compact rows.
- [x] Tasks 4–5: three-column Projects controls, online Project selector, and scope-safe Workspace actions.
- [x] Task 6: shared desktop companion, mobile child page, outside-click boundary, and Android Back priority.
- [x] Task 7: fixed success feedback and persistent retryable failure feedback.
- [x] Task 8 focused regression: 10 suites, 130 tests passed.
- [x] Task 8 full App regression: 246 suites, 1472 tests passed.
- [x] `npm run tsc:web` passed.
- [x] `npm run build:web` passed (webpack production build).
- [x] `git diff --check` passed; no Registry protocol or server implementation files changed.
