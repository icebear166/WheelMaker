# Chat-First Web Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Chat the fastest startup path by removing accidental initial chunking, protecting persisted configuration, caching immutable assets, preloading critical icons, and consolidating cold Settings chunks.

**Architecture:** Keep the current React/webpack app structure for the first implementation pass, but change the loading policy from automatic fine-grained chunking to explicit coarse chunks. P0 fixes operate at stable seams: webpack config, service worker, public HTML, and workspace persistence. P1 consolidates Settings lazy imports through one shared Settings bundle without changing Settings behavior.

**Tech Stack:** React 19, TypeScript, webpack 5, HtmlWebpackPlugin, MiniCssExtractPlugin, Jest source-structure tests, service worker Cache Storage.

---

## Scope

This plan implements the first two slices from the design:

- P0: correctness and startup rollback.
- P1: coarse Settings chunk consolidation.

It does not fully extract `FileFeature`, `GitFeature`, `PortRelayFeature`, or `ChatFeature` from `main.tsx`. Those are larger feature-boundary tasks and should follow after the P0/P1 performance regression is fixed and measured.

## Execution Status

Completed on `main`:

- `7c77263 Restore chat startup loading policy`
- `10b4bf9 Protect persisted identity during startup`
- `c722b0c Group settings into one lazy bundle`

Verified:

- `npm run tsc:web`
- `npm test`
- `npm run build:web`
- `npm run report:web-assets`

Generated asset shape after implementation:

- no `runtime.*.js` or `vendors.*.js` initial script
- one initial `bundle.*.js` script and one initial `bundle.*.css` stylesheet
- `codicon.ttf` emitted at the preload path
- one coarse `settings.*.js` lazy chunk

## Files

- Modify: `app/__tests__/web-setup.test.js`
  - Update webpack loading-policy assertions.
  - Add service worker immutable asset cache assertions.
  - Add Codicon preload assertion.
- Modify: `app/__tests__/web-workspace-persistence-reset-policy.test.ts`
  - Add source-level regression tests for non-destructive localStorage identity overlay.
- Modify: `app/__tests__/web-chat-ui.test.ts`
  - Update Settings lazy-boundary assertions from detail-level imports to one Settings bundle loader.
- Modify: Settings source-structure tests that currently assert individual detail lazy imports:
  - `app/__tests__/web-android-apk-update-settings.test.ts`
  - `app/__tests__/web-agent-package-update-settings.test.ts`
  - `app/__tests__/web-cc-switch-settings.test.ts`
  - `app/__tests__/web-connection-settings-ui.test.ts`
  - `app/__tests__/web-database-settings-ui.test.ts`
  - `app/__tests__/web-port-relay-settings.test.ts`
  - `app/__tests__/web-registry-debug-settings.test.ts`
  - `app/__tests__/web-skill-management-settings.test.ts`
  - `app/__tests__/web-token-stats-settings-ui.test.ts`
- Modify: `app/web/webpack.config.js`
  - Remove automatic initial `runtimeChunk` and `splitChunks: all`.
  - Add stable emitted asset names for fonts if needed for preload.
- Modify: `app/web/public/index.html`
  - Add Codicon preload link.
- Modify: `app/web/public/service-worker.js`
  - Add cache-first policy for immutable hashed JS/CSS/font assets.
- Modify: `app/web/src/services/workspacePersistence.ts`
  - Make localStorage identity overlay partial and non-destructive.
- Create: `app/web/src/settings/SettingsBundle.ts`
  - Re-export Settings root and detail components through one dynamic import target.
- Modify: `app/web/src/main.tsx`
  - Replace many Settings detail lazy import targets with one shared Settings bundle loader.

## Task 1: Write P0 Loading Policy Tests

**Files:**
- Modify: `app/__tests__/web-setup.test.js`

- [ ] **Step 1: Update webpack loading-policy test**

Replace the current test named `production webpack splits the runtime and shared chunks for browser caching` with:

```js
  test('production webpack keeps chat startup on the app entry instead of automatic initial chunks', () => {
    const projectRoot = path.join(__dirname, '..');
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');

    expect(webpackConfig.optimization.runtimeChunk).toBeUndefined();
    expect(webpackConfig.optimization.splitChunks).toBeUndefined();
    expect(webpackConfig.optimization.minimizer[0].options.parallel).toBe(false);
  });
```

- [ ] **Step 2: Update filename expectations in the CSS extraction test**

In `production webpack extracts css instead of injecting it through javascript`, remove the runtime/vendor filename expectations and keep only bundle and async checks:

```js
    const bundleJsName = webpackConfig.output.filename({chunk: {name: 'bundle'}});
    const asyncJsName = webpackConfig.output.chunkFilename({chunk: {name: 'settings'}});
    const bundleCssName = cssPlugin.options.filename({chunk: {name: 'bundle'}});
    const asyncCssName = cssPlugin.options.chunkFilename({chunk: {name: 'settings'}});

    expect(bundleJsName).toBe('bundle.[contenthash].js');
    expect(asyncJsName).toBe('[name].[contenthash].js');
    expect(bundleCssName).toBe('bundle.[contenthash].css');
    expect(asyncCssName).toBe('[name].[contenthash].css');
```

Remove these old expectations from that test:

```js
    expect(runtimeJsName).toBe('runtime.[contenthash].js');
    expect(vendorJsName).toBe('vendors.[contenthash].js');
    expect(vendorCssName).toBe('vendors.[contenthash].css');
```

- [ ] **Step 3: Add Codicon preload assertion**

Add this test after the PWA icon test:

```js
  test('preloads codicons because chat uses icon font classes on the first screen', () => {
    const projectRoot = path.join(__dirname, '..');
    const indexHtml = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'index.html'),
      'utf8',
    );
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'main.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain("import '@vscode/codicons/dist/codicon.css';");
    expect(indexHtml).toContain('rel="preload"');
    expect(indexHtml).toContain('as="font"');
    expect(indexHtml).toContain('href="/codicon.ttf"');
    expect(indexHtml).toContain('crossorigin');
  });
```

- [ ] **Step 4: Add immutable asset cache assertions**

Extend `service worker does not persist the app shell` with:

```js
    expect(sw).toContain('isImmutableBuildAsset');
    expect(sw).toContain("url.pathname === '/codicon.ttf'");
    expect(sw).toContain("event.respondWith(cacheFirst(req));");
```

Add this test after it:

```js
  test('service worker cache-firsts immutable build assets but not navigation or service worker updates', () => {
    const projectRoot = path.join(__dirname, '..');
    const sw = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'service-worker.js'),
      'utf8',
    );

    expect(sw).toContain('function isImmutableBuildAsset(url)');
    expect(sw).toContain('/\\.[0-9a-f]{8,}\\./.test(url.pathname)');
    expect(sw).toContain("['.js', '.css', '.woff', '.woff2', '.ttf', '.svg']");
    expect(sw).toContain("if (req.mode === 'navigate')");
    expect(sw).toContain("if (url.pathname.endsWith('/service-worker.js')) return;");
    expect(sw).not.toContain("cache.addAll(['/', '/index.html']");
  });
```

- [ ] **Step 5: Run tests and verify they fail before implementation**

Run:

```powershell
npm test -- --runTestsByPath __tests__/web-setup.test.js
```

Expected: FAIL because webpack still has `runtimeChunk`, index HTML lacks Codicon preload, and the service worker lacks `isImmutableBuildAsset`.

## Task 2: Implement P0 Loading Policy

**Files:**
- Modify: `app/web/webpack.config.js`
- Modify: `app/web/public/index.html`
- Modify: `app/web/public/service-worker.js`
- Modify: `app/__tests__/web-setup.test.js` if Task 1 exposed exact assertion drift

- [ ] **Step 1: Remove automatic initial runtime/vendor splitting**

In `app/web/webpack.config.js`, replace:

```js
    optimization: {
      runtimeChunk: { name: 'runtime' },
      splitChunks: {
        chunks: 'all',
      },
      minimizer: [new TerserPlugin({ parallel: false })],
    },
```

with:

```js
    optimization: {
      minimizer: [new TerserPlugin({ parallel: false })],
    },
```

- [ ] **Step 2: Emit Codicon font under a stable preload path**

In the asset rule in `app/web/webpack.config.js`, replace:

```js
        {
          test: /\.(woff2?|ttf|eot|svg)$/,
          type: 'asset/resource',
        },
```

with:

```js
        {
          test: /\.(woff2?|ttf|eot|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: pathData => {
              const rawFilename = pathData.filename || '';
              return rawFilename.replace(/\\/g, '/').endsWith('@vscode/codicons/dist/codicon.ttf')
                ? 'codicon.ttf'
                : '[hash][ext][query]';
            },
          },
        },
```

- [ ] **Step 3: Add Codicon preload**

In `app/web/public/index.html`, add this before the manifest link:

```html
    <link rel="preload" href="/codicon.ttf" as="font" type="font/ttf" crossorigin />
```

- [ ] **Step 4: Add immutable asset detection to the service worker**

In `app/web/public/service-worker.js`, add below `cacheFirst`:

```js
function isImmutableBuildAsset(url) {
  const extension = url.pathname.slice(url.pathname.lastIndexOf('.'));
  if (url.pathname === '/codicon.ttf') return true;
  if (!['.js', '.css', '.woff', '.woff2', '.ttf', '.svg'].includes(extension)) {
    return false;
  }
  return /\.[0-9a-f]{8,}\./.test(url.pathname);
}
```

Then in the fetch handler, after the `/icons/` branch and before `event.respondWith(fetch(req));`, add:

```js
  if (isImmutableBuildAsset(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }
```

- [ ] **Step 5: Run focused setup tests**

Run:

```powershell
npm test -- --runTestsByPath __tests__/web-setup.test.js
```

Expected: PASS.

- [ ] **Step 6: Build and inspect initial assets**

Run:

```powershell
npm run build:web
npm run report:web-assets
```

Expected:

- `~/.wheelmaker/web/index.html` contains no `runtime.*.js`.
- `~/.wheelmaker/web/index.html` contains one `bundle.*.js` entry script.
- `~/.wheelmaker/web/codicon.ttf` exists.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "Restore chat startup loading policy"
git push origin main
```

## Task 3: Write Persistence Regression Tests

**Files:**
- Modify: `app/__tests__/web-workspace-persistence-reset-policy.test.ts`

- [ ] **Step 1: Add source-level tests for partial local identity**

Add these tests inside `describe('workspace persistence reset policy', () => { ... })`:

```ts
  test('reads local identity as partial values so missing localStorage does not blank IndexedDB state', () => {
    const source = workspacePersistenceSource();

    expect(source).toContain("type LocalIdentityState = Partial<Pick<PersistedGlobalState, 'address' | 'token'>>");
    expect(source).toContain("private mergeLocalIdentityState(base: PersistedGlobalState): PersistedGlobalState");
    expect(source).toContain("return sanitizeGlobalState({...base, ...localIdentity});");
    expect(source).not.toContain("return {address: '', token: ''};");
  });

  test('only explicit identity patches write localStorage mirrors', () => {
    const source = workspacePersistenceSource();
    const patchBlock = functionBlock(source, 'patchGlobalState(patch: Partial<PersistedGlobalState>): void');

    expect(patchBlock).toContain("'address' in patch || 'token' in patch");
    expect(patchBlock).toContain('this.saveLocalIdentityState(this.state.global)');
    expect(patchBlock).not.toContain('this.saveLocalIdentityState(this.state.global);\\n\\n    const now');
  });
```

- [ ] **Step 2: Run tests and verify they fail before implementation**

Run:

```powershell
npm test -- --runTestsByPath __tests__/web-workspace-persistence-reset-policy.test.ts
```

Expected: FAIL because `readLocalIdentityState` still returns empty strings and `patchGlobalState` writes localStorage on every patch.

## Task 4: Implement Persistence Protection

**Files:**
- Modify: `app/web/src/services/workspacePersistence.ts`
- Modify: `app/__tests__/web-workspace-persistence-reset-policy.test.ts` if exact source snippets need adjustment

- [ ] **Step 1: Add partial local identity type**

Near `type PersistedWorkspaceState`, add:

```ts
type LocalIdentityState = Partial<Pick<PersistedGlobalState, 'address' | 'token'>>;
```

- [ ] **Step 2: Make localStorage reads partial**

Replace `readLocalIdentityState` with:

```ts
  private readLocalIdentityState(): LocalIdentityState {
    if (typeof window === 'undefined') {
      return {};
    }
    const identity: LocalIdentityState = {};
    try {
      const rawAddress = window.localStorage.getItem(LOCAL_ADDRESS_KEY);
      if (typeof rawAddress === 'string') {
        identity.address = rawAddress;
      }
    } catch {
      // ignore
    }
    try {
      const rawToken = window.localStorage.getItem(LOCAL_TOKEN_KEY);
      if (typeof rawToken === 'string') {
        identity.token = rawToken;
      }
    } catch {
      // ignore
    }
    return identity;
  }
```

- [ ] **Step 3: Add identity merge helper**

Below `readLocalIdentityState`, add:

```ts
  private mergeLocalIdentityState(base: PersistedGlobalState): PersistedGlobalState {
    const localIdentity = this.readLocalIdentityState();
    return sanitizeGlobalState({...base, ...localIdentity});
  }
```

- [ ] **Step 4: Use merge helper for IndexedDB restore and global reads**

In `fromDbRows`, replace:

```ts
      global: sanitizeGlobalState({...base.global, ...globalPatch, ...this.readLocalIdentityState()}),
```

with:

```ts
      global: this.mergeLocalIdentityState(sanitizeGlobalState({...base.global, ...globalPatch})),
```

In `getGlobalState`, replace:

```ts
    const localIdentity = this.readLocalIdentityState();
    this.state.global = sanitizeGlobalState({...this.state.global, ...localIdentity});
```

with:

```ts
    this.state.global = this.mergeLocalIdentityState(this.state.global);
```

- [ ] **Step 5: Save localStorage only on explicit identity patch**

In `patchGlobalState`, replace:

```ts
    this.state.global = sanitizeGlobalState({...this.state.global, ...patch});
    this.saveLocalIdentityState(this.state.global);
```

with:

```ts
    this.state.global = sanitizeGlobalState({...this.state.global, ...patch});
    if ('address' in patch || 'token' in patch) {
      this.saveLocalIdentityState(this.state.global);
    }
```

- [ ] **Step 6: Preserve clear-cache behavior**

In `clearCachePreservingToken`, keep this line unchanged:

```ts
    this.saveLocalIdentityState({address: preservedAddress, token: preservedToken});
```

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npm test -- --runTestsByPath __tests__/web-workspace-persistence-reset-policy.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "Protect persisted identity during startup"
git push origin main
```

## Task 5: Write Settings Coarse Chunk Tests

**Files:**
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify listed Settings tests that assert detail-level lazy imports

- [ ] **Step 1: Update the central Settings lazy assertion**

In `app/__tests__/web-chat-ui.test.ts`, replace the assertion that expects:

```ts
expect(mainTsx).toContain("const SettingsRootContent = React.lazy(() => import('./settings/SettingsRootContent')");
```

with:

```ts
expect(mainTsx).toContain("const loadSettingsBundle = () => import(/* webpackChunkName: \"settings\" */ './settings/SettingsBundle')");
expect(mainTsx).toContain('const SettingsRootContent = React.lazy(() => loadSettingsBundle().then(module => ({');
```

- [ ] **Step 2: Update detail tests to expect the shared Settings bundle**

For each test file that currently expects a string like:

```ts
expect(mainTsx).toContain("React.lazy(() => import('./settings/DatabaseSettingsDetail')");
```

replace it with:

```ts
expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ './settings/SettingsBundle')");
```

Keep assertions that verify render functions and component JSX, for example:

```ts
expect(mainTsx).toContain('renderDatabaseSettingsDetail(options)');
expect(mainTsx).toContain('<DatabaseSettingsDetail');
```

- [ ] **Step 3: Add Settings bundle export assertions**

Add this helper in one Settings-focused test file such as `app/__tests__/web-chat-ui.test.ts`:

```ts
const settingsBundleTs = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsBundle.ts'));
```

Add expectations:

```ts
expect(settingsBundleTs).toContain("export { SettingsRootContent } from './SettingsRootContent';");
expect(settingsBundleTs).toContain("export { DatabaseSettingsDetail } from './DatabaseSettingsDetail';");
expect(settingsBundleTs).toContain("export { UpdateSettingsDetail } from './UpdateSettingsDetail';");
expect(settingsBundleTs).toContain("export { DebugLogsSettingsDetail } from '../debug/DebugLogsSettingsDetail';");
```

- [ ] **Step 4: Run focused tests and verify they fail before implementation**

Run:

```powershell
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-database-settings-ui.test.ts __tests__/web-token-stats-settings-ui.test.ts __tests__/web-cc-switch-settings.test.ts __tests__/web-agent-package-update-settings.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-port-relay-settings.test.ts __tests__/web-registry-debug-settings.test.ts __tests__/web-connection-settings-ui.test.ts __tests__/web-android-apk-update-settings.test.ts
```

Expected: FAIL because `SettingsBundle.ts` does not exist and `main.tsx` still imports individual detail chunks.

## Task 6: Implement Settings Coarse Chunk

**Files:**
- Create: `app/web/src/settings/SettingsBundle.ts`
- Modify: `app/web/src/main.tsx`
- Modify: tests listed in Task 5 if exact source-structure expectations need alignment

- [ ] **Step 1: Create Settings bundle module**

Create `app/web/src/settings/SettingsBundle.ts`:

```ts
export { SettingsRootContent } from './SettingsRootContent';
export { CCSwitchSettingsDetail } from './CCSwitchSettingsDetail';
export { ConnectionStatusSettingsDetail } from './ConnectionStatusSettingsDetail';
export { DatabaseSettingsDetail } from './DatabaseSettingsDetail';
export { PortRelaySettingsDetail } from './PortRelaySettingsDetail';
export { SkillsSettingsDetail } from './SkillsSettingsDetail';
export { TokenStatsSettingsDetail } from './TokenStatsSettingsDetail';
export { UpdateSettingsDetail } from './UpdateSettingsDetail';
export { DebugLogsSettingsDetail } from '../debug/DebugLogsSettingsDetail';
```

- [ ] **Step 2: Replace individual lazy imports with a shared loader**

In `app/web/src/main.tsx`, replace the Settings and debug-log lazy block:

```ts
const DebugLogsSettingsDetail = React.lazy(() => import('./debug/DebugLogsSettingsDetail').then(module => ({
  default: module.DebugLogsSettingsDetail,
})));
const ConnectionStatusSettingsDetail = React.lazy(() => import('./settings/ConnectionStatusSettingsDetail').then(module => ({
  default: module.ConnectionStatusSettingsDetail,
})));
```

and the other individual Settings detail lazy imports with:

```ts
const loadSettingsBundle = () => import(/* webpackChunkName: "settings" */ './settings/SettingsBundle');
const DebugLogsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.DebugLogsSettingsDetail,
})));
const ConnectionStatusSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.ConnectionStatusSettingsDetail,
})));
const TokenStatsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.TokenStatsSettingsDetail,
})));
const CCSwitchSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.CCSwitchSettingsDetail,
})));
const DatabaseSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.DatabaseSettingsDetail,
})));
const PortRelaySettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.PortRelaySettingsDetail,
})));
const UpdateSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.UpdateSettingsDetail,
})));
const SkillsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.SkillsSettingsDetail,
})));
const SettingsRootContent = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.SettingsRootContent,
})));
```

Keep `RegistryDebugPanel` as its own debug lazy import.

- [ ] **Step 3: Run focused Settings tests**

Run:

```powershell
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-database-settings-ui.test.ts __tests__/web-token-stats-settings-ui.test.ts __tests__/web-cc-switch-settings.test.ts __tests__/web-agent-package-update-settings.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-port-relay-settings.test.ts __tests__/web-registry-debug-settings.test.ts __tests__/web-connection-settings-ui.test.ts __tests__/web-android-apk-update-settings.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "Group settings into one lazy bundle"
git push origin main
```

## Task 7: Verify Build and Asset Shape

**Files:**
- No intended source modifications.

- [ ] **Step 1: Run TypeScript check**

Run:

```powershell
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 2: Run full Jest suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build:web
```

Expected: PASS.

- [ ] **Step 4: Report assets**

Run:

```powershell
npm run report:web-assets
```

Expected:

- output includes `bundle.<hash>.js`
- output does not include `runtime.<hash>.js`
- output includes one `settings.<hash>.js` chunk
- output includes `codicon.ttf`

- [ ] **Step 5: Inspect generated HTML**

Run:

```powershell
Get-Content -LiteralPath $HOME\.wheelmaker\web\index.html
```

Expected:

- contains `/codicon.ttf` preload
- contains no `/runtime.` script
- contains no automatic vendor initial script unless a future explicit entry creates one

## Task 8: Prepare Next Feature-Boundary Slice

**Files:**
- Modify or create only if implementation continues beyond P0/P1 in this branch.

- [ ] **Step 1: Measure remaining startup imports**

Run:

```powershell
rg -n "setiThemeJson|setiFontUrl|resolveSetiIcon|renderFile|renderGit|projectIndexPollTimerRef|wheelMakerUpdatePollTimerRef|skillOperationPollTimerRef" web\src\main.tsx
```

Expected: output identifies remaining File/Git/Settings/Update/Skill logic still in `main.tsx`.

- [ ] **Step 2: Do not move Seti alone with a dynamic import**

Do not replace Seti with an ad hoc async icon resolver inside `main.tsx`. That would create icon flicker in File without removing enough Chat code. Move Seti when extracting `FileFeature`, so File tree, file icons, and file-only state move together.

- [ ] **Step 3: Create the next plan before extracting File/Git**

Create a separate implementation plan for `FileFeature`/`GitFeature` extraction after P0/P1 verification. That plan should include component props, state ownership, and tests that Chat startup no longer imports Seti or Git diff code.

## Final Verification Before Completion

Run all commands from `app/` unless noted:

```powershell
npm run tsc:web
npm test
npm run build:web
npm run report:web-assets
```

From repo root:

```powershell
git status --short
```

Expected final state:

- no uncommitted files except intentional generated assets ignored by git
- all commits pushed to `origin main`
- generated web asset report confirms no initial `runtime.*.js`
- generated web asset report confirms `codicon.ttf`
- Jest and TypeScript pass
