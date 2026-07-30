# Hub Menu Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In one pass, make the Hub menu easier to scan and operate by clarifying hierarchy, eliminating truncated Project actions, aligning rows, simplifying status indicators, and making the footer consistently visible without changing behavior or row heights.

**Architecture:** Keep `ChatHubMenu` and its existing callbacks as the sole interaction surface. Change only presentation markup and CSS: retain the full-row Hub disclosure, independent color/version controls, existing section expansion state, and existing desktop/mobile surfaces. Use the existing theme tokens and `Icon` component; add no animation, protocol, API, state, or data-loading changes.

**Tech Stack:** React 19, TypeScript, project-native CSS/theme tokens, Jest, `react-test-renderer`.

---

## Locked design decisions

- Keep the popover at `340px`; solve truncation through shorter labels and a segmented action group instead of making the whole surface wider.
- Preserve desktop row heights (`32px`) and mobile row heights (`44px`); expanded styling must not change header row height.
- Keep the entire Hub header row clickable, with color, version action, and disclosure chevron remaining independent controls.
- Rename the child scope label from `Hub` to `Global`; it contains Hub-global NPM and Skills.
- Keep Project actions in this order: visibility, scan, Skills.
- Visibility remains icon-only; rename `Project Skills` to `Skills`.
- Render the two Global actions and three Project actions as shared segmented groups rather than separate rounded cards.
- Replace Settings check/X marks with a small state dot plus `V1`, `V2`, or `Off`.
- Keep the configured Hub colors; only enlarge and clean up the color dot so similar user-selected colors are not silently rewritten.
- Make the footer a sticky toolbar with a top divider. Enabled “Update all hubs” remains primary; disabled remains legible but clearly inactive.
- Do not add JavaScript animation, layout animation, gradients, glow, new z-index values, or a second component primitive system.

## Files

- Modify: `app/web/src/app/ChatHubMenu.tsx`
  - Simplify Settings summary markup.
  - Apply the Hub accent at the group root.
  - Shorten Global/Project labels without changing callbacks.
- Modify: `app/web/src/styles/chat.css`
  - Establish the header grid, expanded hierarchy guide, segmented action groups, status-dot treatment, and sticky footer.
  - Preserve current desktop/mobile minimum row heights.
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
  - Lock the new labels, status markup, action order, icons, and unchanged interaction callbacks.
- Modify: `app/__tests__/web-chat-ui.test.ts`
  - Lock the CSS layout contract and prevent reintroduction of per-button card styling or row-height regressions.

### Task 1: Add failing visual-structure tests

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.test.tsx:171-253`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx:490-518`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx:780-824`
- Modify: `app/__tests__/web-chat-ui.test.ts:833-905`

- [ ] **Step 1: Update the Settings summary test to require state-dot markup**

Replace the check/X assertions in `ChatHubMenu.test.tsx` with:

```tsx
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

const offState = disabledRenderer.root.findByProps({
  className: 'chat-hub-settings-state off',
});
expect(offState.children).toContain('Off');
expect(offState.findByProps({
  className: 'chat-hub-settings-state-dot',
})).toBeTruthy();
```

- [ ] **Step 2: Update the Global and Project action contract**

Add these assertions to the existing action tests:

```tsx
expect(renderer.root.findAllByProps({className: 'chat-hub-line-label'})
  .map(label => label.children)).toEqual([['Global'], ['Projects']]);

expect(projectButtons.map(button => button.props['aria-label']))
  .toEqual(['Visibility details', 'Scan details', 'Project Skills details']);
expect(projectButtons[0].findByProps({'data-icon-name': 'eye'})).toBeTruthy();
expect(projectButtons[0].findAllByProps({className: 'chat-hub-action-label'})).toHaveLength(0);
expect(projectButtons[1].findByProps({className: 'chat-hub-action-label'}).children).toEqual(['Scan']);
expect(projectButtons[2].findByProps({className: 'chat-hub-action-label'}).children).toEqual(['Skills']);
```

Keep the existing click assertions so the test continues to prove:

```tsx
act(() => npm.props.onClick());
expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'npm');

act(() => skills.props.onClick());
expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'skills');

act(() => scan.props.onClick());
expect(callbacks.onToggleSection).toHaveBeenCalledWith('hub-a', 'scan');
```

- [ ] **Step 3: Add a CSS contract test**

Add this test inside `describe('web chat integration', ...)` in `web-chat-ui.test.ts`:

```ts
test('Hub menu uses stable rows, segmented actions, hierarchy, and a sticky footer', () => {
  const projectRoot = path.join(__dirname, '..');
  const stylesCss = readWebStyles(projectRoot);
  const hubRow = cssRuleBlock(stylesCss, '.chat-hub-row');
  const sections = cssRuleBlock(stylesCss, '.chat-hub-sections');
  const actions = cssRuleBlock(stylesCss, '.chat-hub-line-actions');
  const projectActions = cssRuleBlock(stylesCss, '.chat-hub-project-actions');
  const footer = cssRuleBlock(stylesCss, '.chat-hub-footer');
  const mobileHubRow = cssRuleBlocksContainingSelector(stylesCss, '.chat-hub-row')
    .find(block => block.includes('min-height: 44px')) ?? '';

  expect(hubRow).toContain('min-height: 32px;');
  expect(hubRow).toContain('grid-template-columns: 24px minmax(0, 1fr) auto 16px;');
  expect(sections).toContain('border-left: 1px solid');
  expect(actions).toContain('overflow: hidden;');
  expect(actions).toContain('border-radius: 7px;');
  expect(projectActions).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
  expect(footer).toContain('position: sticky;');
  expect(footer).toContain('bottom: 0;');
  expect(mobileHubRow).toContain('min-height: 44px;');
});
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
Set-Location app
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx __tests__/web-chat-ui.test.ts
```

Expected: FAIL because the old code still renders `Hub`, `Project Skills`, check/X status marks, flex Hub rows, individual action cards, and a non-sticky footer.

### Task 2: Simplify the React presentation without changing behavior

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx:539-570`
- Modify: `app/web/src/app/ChatHubMenu.tsx:860-1008`

- [ ] **Step 1: Make disclosure labels available to hover and accessibility**

Add `title={label}` to the existing disclosure button while retaining its current `aria-expanded`, `aria-label`, and callback:

```tsx
function ChatHubDisclosureButton({
  label,
  ariaLabel,
  info,
  icon,
  hideLabel = false,
  pending = false,
  expanded,
  onToggle,
}: {
  label: string;
  ariaLabel?: string;
  info?: string;
  icon?: IconName;
  hideLabel?: boolean;
  pending?: boolean;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`chat-hub-action chat-hub-disclosure-action${expanded ? ' expanded' : ''}`}
      aria-expanded={expanded}
      aria-label={ariaLabel ?? `${label} details`}
      title={label}
      onClick={onToggle}
    >
      {icon ? <Icon name={icon} /> : null}
      {!hideLabel ? <span className="chat-hub-action-label">{label}</span> : null}
      {info ? <span className="chat-hub-action-info">{info}</span> : null}
      <Icon name={pending ? 'loader' : expanded ? 'chevronDown' : 'chevronRight'} spin={pending} />
    </button>
  );
}
```

- [ ] **Step 2: Replace check/X Settings status marks**

Replace `settingsSummary` with:

```tsx
const settingsSummary = (
  <span className={`chat-hub-settings-state ${flickerOn ? 'on' : 'off'}`}>
    <span className="chat-hub-settings-state-dot" aria-hidden="true" />
    {flickerOn ? flickerMode || 'On' : 'Off'}
  </span>
);
```

The text remains visible to assistive technology; the dot is decorative.

- [ ] **Step 3: Move the accent style to the Hub group root**

Change the group opening markup to:

```tsx
<div
  className={`chat-hub-tree${expanded ? ' expanded' : ''}${colorMenuOpen ? ' color-open' : ''}`}
  style={hubAccentStyle(hubId)}
>
  <div className="chat-hub-row">
```

Remove the redundant `style={hubAccentStyle(hubId)}` from `.chat-hub-color-button`; it inherits `--hub-accent` from `.chat-hub-tree`. Keep the color palette’s explicit style handling unchanged.

- [ ] **Step 4: Clarify child scopes and shorten Project actions**

Use this exact scope/action markup:

```tsx
<div className="chat-hub-line">
  <span className="chat-hub-line-icon"><Icon name="serverCog" /></span>
  <span className="chat-hub-line-label">Global</span>
  <span className="chat-hub-line-actions chat-hub-hub-actions">
    <ChatHubDisclosureButton
      label="NPM"
      info={ops.npm.outdatedCount > 0 ? `${ops.npm.outdatedCount}` : undefined}
      pending={ops.npm.pending}
      expanded={sectionOpen('npm')}
      onToggle={() => toggleSection('npm')}
    />
    <ChatHubDisclosureButton
      label="Skills"
      info={ops.skills.hubItems.length > 0 ? `${ops.skills.hubItems.length}` : undefined}
      pending={ops.skills.loading || ops.skills.operationRunning}
      expanded={sectionOpen('skills')}
      onToggle={() => toggleSection('skills')}
    />
  </span>
</div>

<div className="chat-hub-line">
  <span className="chat-hub-line-icon"><Icon name="folder" /></span>
  <span className="chat-hub-line-label">Projects</span>
  <span className="chat-hub-line-actions chat-hub-project-actions">
    <ChatHubDisclosureButton
      label="Visibility"
      info={`${visibleProjectCount}/${treeItem.projects.length}`}
      icon="eye"
      hideLabel
      expanded={sectionOpen('visibility')}
      onToggle={() => toggleSection('visibility')}
    />
    <ChatHubDisclosureButton
      label="Scan"
      info={`${ops.index.indexedCount}/${ops.index.totalCount}`}
      pending={ops.index.pending}
      expanded={sectionOpen('scan')}
      onToggle={() => toggleSection('scan')}
    />
    <ChatHubDisclosureButton
      label="Skills"
      ariaLabel="Project Skills details"
      info={projectSkillTotal(ops.skills.projects) > 0
        ? `${projectSkillTotal(ops.skills.projects)}`
        : undefined}
      pending={ops.skills.loading || ops.skills.operationRunning}
      expanded={sectionOpen('projectSkills')}
      onToggle={() => toggleSection('projectSkills')}
    />
  </span>
</div>
```

- [ ] **Step 5: Run the component test**

Run:

```powershell
Set-Location app
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx
```

Expected: PASS for the DOM/interaction assertions; the CSS contract remains RED until Task 3.

### Task 3: Apply the single-pass visual system

**Files:**
- Modify: `app/web/src/styles/chat.css:1344-1457`
- Modify: `app/web/src/styles/chat.css:1708-1787`
- Modify: `app/web/src/styles/chat.css:1985-2104`
- Modify: `app/web/src/styles/chat.css:2479-2537`
- Modify: `app/web/src/styles/chat.css:2714-2735`

- [ ] **Step 1: Align Hub headers and strengthen expanded-state hierarchy**

Replace the relevant Hub group/header rules with:

```css
.chat-hub-tree + .chat-hub-tree {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 58%, transparent);
}

.chat-hub-tree {
  --hub-accent: var(--accent-primary);
  position: relative;
  padding: 2px 0;
}

.chat-hub-tree.color-open {
  z-index: 3;
}

.chat-hub-row {
  position: relative;
  min-height: 32px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 6px;
  font-size: 12px;
}

.chat-hub-row:hover,
.chat-hub-tree.expanded > .chat-hub-row {
  background: color-mix(in srgb, var(--hover) 64%, transparent);
}

.chat-hub-color-button {
  position: relative;
  z-index: 1;
  width: 24px;
  height: 24px;
  border-radius: 5px;
}

.chat-hub-color-dot {
  width: 10px;
  height: 10px;
  border: 1px solid color-mix(in srgb, var(--hub-accent) 68%, var(--text-primary));
  border-radius: 999px;
  background: var(--hub-accent);
}

.chat-hub-expand-chevron {
  position: relative;
  z-index: 1;
  justify-self: end;
  color: color-mix(in srgb, var(--text-tertiary) 78%, var(--text-secondary));
  font-size: 14px;
  pointer-events: none;
}

.chat-hub-row-name {
  position: relative;
  z-index: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.chat-hub-sections {
  margin: 1px 2px 4px 8px;
  padding: 1px 0 2px;
  border-left: 1px solid color-mix(in srgb, var(--hub-accent) 38%, var(--border-subtle));
}
```

Do not add transition or animation rules.

- [ ] **Step 2: Keep child content at the current horizontal footprint**

Update the child row/detail spacing so the new hierarchy guide does not waste width:

```css
.chat-hub-section-header {
  appearance: none;
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.chat-hub-section-body {
  margin: 0 0 4px 4px;
  padding: 2px 0 4px;
}

.chat-hub-line {
  min-height: 32px;
  display: grid;
  grid-template-columns: 14px 52px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  font-size: 11px;
}

.chat-hub-detail {
  margin: 0 4px 4px 4px;
  padding: 2px 0 4px;
}
```

- [ ] **Step 3: Replace Settings marks with a compact state**

Delete `.chat-hub-summary-mark` and `.chat-hub-summary-mark.ok`. Add:

```css
.chat-hub-settings-state {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.chat-hub-settings-state-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 999px;
  background: var(--text-tertiary);
}

.chat-hub-settings-state.on .chat-hub-settings-state-dot {
  background: var(--state-success);
}
```

- [ ] **Step 4: Convert action cards into segmented groups**

Use the following rules:

```css
.chat-hub-line-actions {
  min-width: 0;
  display: grid;
  align-items: stretch;
  gap: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--surface-raised) 38%, transparent);
}

.chat-hub-hub-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.chat-hub-project-actions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.chat-hub-action {
  appearance: none;
  min-width: 0;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.chat-hub-line-actions > .chat-hub-action {
  border: 0;
  border-radius: 0;
}

.chat-hub-line-actions > .chat-hub-action + .chat-hub-action {
  border-left: 1px solid color-mix(in srgb, var(--border-subtle) 58%, transparent);
}

.chat-hub-action.expanded {
  background: color-mix(in srgb, var(--hover) 78%, transparent);
  color: var(--text-primary);
}

.chat-hub-action:hover:not(:disabled),
.chat-hub-action:focus-visible {
  background: color-mix(in srgb, var(--hover) 70%, transparent);
  color: var(--text-primary);
}

.chat-hub-action-info {
  min-width: 16px;
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-raised) 82%, var(--surface-panel));
  color: var(--text-secondary);
  font-size: 9px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-align: center;
}

.chat-hub-row > .chat-hub-version-action {
  position: relative;
  z-index: 1;
  min-height: 26px;
  padding: 2px 6px;
  border-color: transparent;
  background: color-mix(in srgb, var(--surface-raised) 45%, transparent);
}
```

This keeps all three Project buttons in one row while giving `Scan` and `Skills` enough width to remain readable.

- [ ] **Step 5: Make the footer a visible sticky toolbar**

Replace the footer rules with:

```css
.chat-hub-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 0 0;
  padding: 8px 6px max(8px, env(safe-area-inset-bottom, 0px));
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
  border-radius: 0;
  background: var(--surface-overlay);
}

.chat-hub-footer-version {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.chat-hub-footer-version-value {
  color: var(--accent-primary);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.chat-hub-footer-update-all {
  appearance: none;
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--accent-primary);
  border-radius: 6px;
  background: var(--accent-primary);
  color: var(--button-primary-text, #fff);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
}

.chat-hub-footer-update-all:disabled {
  border-color: color-mix(in srgb, var(--border-subtle) 82%, transparent);
  background: var(--surface-panel);
  color: var(--text-secondary);
  opacity: 1;
  cursor: default;
}
```

- [ ] **Step 6: Preserve mobile touch heights**

Keep these mobile overrides:

```css
@media (max-width: 899px) {
  .chat-hub-row {
    min-height: 44px;
  }

  .chat-hub-section-header {
    min-height: 44px;
  }

  .chat-hub-line {
    min-height: 44px;
    grid-template-columns: 14px 52px minmax(0, 1fr);
  }

  .chat-hub-action {
    min-height: 36px;
    padding: 4px 6px;
  }
}
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
Set-Location app
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx __tests__/web-chat-ui.test.ts
```

Expected: both suites PASS with no snapshot changes or console warnings.

### Task 4: Visual and regression verification

**Files:**
- Verify only; no new production files.

- [ ] **Step 1: Verify the desktop visual matrix**

Run the existing app and inspect the Hub menu at `900×720`, `1280×800`, and `1440×900` with:

```powershell
Set-Location app
npm run web
```

Acceptance checklist:

```text
[ ] Expanded and collapsed Hub headers remain exactly 32px high.
[ ] Color dot, Hub name, version action, and final chevron share stable columns.
[ ] The entire Hub header row still toggles expansion.
[ ] Color and version controls do not toggle the Hub.
[ ] Global NPM/Skills appear as one two-segment group.
[ ] Project visibility/Scan/Skills appear as one three-segment group.
[ ] Neither “Scan” nor “Skills” shows an ellipsis at the 340px menu width.
[ ] Settings reads V1, V2, or Off with a dot; no X/check ambiguity remains.
[ ] Expanded content has a visible hierarchy guide without moving content farther right.
[ ] Hub group separators are visible without becoming card borders.
[ ] Footer stays visible at short viewport heights.
[ ] Enabled Update all is primary; disabled Update all remains legible.
[ ] Opening NPM, Skills, Visibility, Scan, or Project Skills does not change the height of its trigger row.
```

- [ ] **Step 2: Verify the mobile visual matrix**

Inspect `390×844` and `412×915`:

```text
[ ] Hub, Settings, Global, and Projects trigger rows remain at least 44px high.
[ ] The three Project actions remain on one line and are independently tappable.
[ ] Footer bottom padding clears the device safe area.
[ ] Android native/system Back behavior remains unchanged.
[ ] No horizontal scrolling appears in the Hub page.
```

- [ ] **Step 3: Run all automated checks**

Run:

```powershell
Set-Location app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected:

```text
All Jest suites pass.
TypeScript exits with code 0.
Webpack production build exits with code 0.
```

- [ ] **Step 4: Commit the completed one-pass polish**

Before committing, use `git-workflow-preferences`, confirm the current branch is synchronized with `origin/main`, and then run the repository completion gate:

```powershell
git add -A
git commit -m "style(app): polish hub menu hierarchy"
git push origin main
```

No PR, protocol version change, new branch, or worktree is required for this no-spec UI polish under the current Git preferences.
