# Unified WheelMaker App Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cross-platform WheelMaker icon behavior with one application menu for Settings, theme switching, native client update, Release Publishing, and Desktop Dev Mode.

**Architecture:** A focused `WheelMakerAppMenu` component owns menu mechanics and selects a Desktop, Android, or browser update controller. Platform modules keep native bridge and stable-metadata details out of the component, while `WorkspaceApp` owns navigation to Settings and the new standalone Release Publishing surface. Desktop release builds inject their version with Go linker metadata so the existing bridge can report both version and executable digest.

**Tech Stack:** React 19, TypeScript, Jest/react-test-renderer, Go 1.26, Android WebMessage RPC, webpack, Node release scripts.

## Completion record

- [x] Task 1 — normalized native client update state and legacy version display.
- [x] Task 2 — embedded the Desktop release version in release builds.
- [x] Task 3 — added the shared cross-platform WheelMaker App Menu.
- [x] Task 4 — wired native update controllers and standalone Release Publishing.
- [x] Task 5 — removed app theme, APK update, and publishing from Settings.
- [x] Task 6 — passed App tests, typecheck, production build, Desktop tests, and release-script tests.

---

### Task 1: Normalize client update state and Desktop version display

**Files:**
- Create: `app/web/src/platform/clientUpdate.ts`
- Create: `app/web/src/platform/clientUpdate.test.ts`
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts`
- Modify: `app/web/src/platform/desktop/desktopUpdate.ts`
- Modify: `app/__tests__/web-desktop-update.test.ts`
- Modify: `app/web/src/platform/android/androidApkUpdate.ts`
- Modify: `app/__tests__/web-android-apk-update.test.ts`

- [ ] **Step 1: Write failing projection tests for every menu update state**

Create `app/web/src/platform/clientUpdate.test.ts` with explicit state-to-view expectations:

```ts
import {clientUpdateView} from './clientUpdate';

describe('client update menu projection', () => {
  test.each([
    [{status: 'checking'}, {meta: 'Checking…', disabled: true, showDot: false}],
    [{status: 'current', currentVersion: 'v1.9'}, {meta: 'v1.9 · Current', disabled: true, showDot: false}],
    [{
      status: 'available',
      currentVersion: 'v1.8',
      latestVersion: 'v1.9',
    }, {meta: 'v1.8 → v1.9', disabled: false, showDot: true}],
    [{
      status: 'available',
      currentVersion: '',
      latestVersion: 'v1.9',
    }, {meta: 'Unknown → v1.9', disabled: false, showDot: true}],
    [{status: 'failed'}, {meta: 'Retry', disabled: false, showDot: false}],
    [{status: 'updating', meta: 'Downloading…'}, {meta: 'Downloading…', disabled: true, showDot: false}],
  ] as const)('projects %j', (state, expected) => {
    expect(clientUpdateView(state)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the projection test and verify the missing-module failure**

Run:

```powershell
cd app
npx jest web/src/platform/clientUpdate.test.ts --runInBand
```

Expected: FAIL because `clientUpdate.ts` does not exist.

- [ ] **Step 3: Add the shared discriminated union and pure projection**

Create `app/web/src/platform/clientUpdate.ts`:

```ts
export type ClientUpdateState =
  | {status: 'checking'}
  | {status: 'current'; currentVersion: string}
  | {status: 'available'; currentVersion: string; latestVersion: string}
  | {status: 'failed'}
  | {status: 'updating'; meta: string};

export type ClientUpdateView = {
  meta: string;
  disabled: boolean;
  showDot: boolean;
};

export function clientUpdateView(state: ClientUpdateState): ClientUpdateView {
  switch (state.status) {
    case 'checking':
      return {meta: 'Checking…', disabled: true, showDot: false};
    case 'current':
      return {meta: `${state.currentVersion || 'Unknown'} · Current`, disabled: true, showDot: false};
    case 'available':
      return {
        meta: `${state.currentVersion || 'Unknown'} → ${state.latestVersion}`,
        disabled: false,
        showDot: true,
      };
    case 'updating':
      return {meta: state.meta, disabled: true, showDot: false};
    case 'failed':
      return {meta: 'Retry', disabled: false, showDot: false};
  }
}
```

- [ ] **Step 4: Change Desktop and Android tests to require normalized states**

In `app/__tests__/web-desktop-update.test.ts`, make Desktop bridge fixtures return a version and assert exact states:

```ts
getDesktopUpdateInfo: async () => ({
  version: 'v1.8',
  sha256: 'a'.repeat(64),
  updaterReady: true,
})
```

```ts
await expect(checkDesktopUpdate(bridge, request)).resolves.toEqual({
  status: 'available',
  currentVersion: 'v1.8',
  latestVersion: 'v1.9',
});
```

Add a legacy assertion:

```ts
await expect(checkDesktopUpdate({
  ...bridge,
  getDesktopUpdateInfo: async () => ({
    version: '',
    sha256: 'a'.repeat(64),
    updaterReady: true,
  }),
}, request)).resolves.toMatchObject({
  status: 'available',
  currentVersion: '',
});
```

In `app/__tests__/web-android-apk-update.test.ts`, add:

```ts
await expect(checkAndroidApkUpdate(bridge, async () => stableResponse)).resolves.toEqual({
  state: {
    status: 'available',
    currentVersion: 'v1.8',
    latestVersion: 'v1.9',
  },
  latest,
});
```

- [ ] **Step 5: Run platform tests and verify that the new contracts fail**

Run:

```powershell
cd app
npx jest __tests__/web-desktop-update.test.ts __tests__/web-android-apk-update.test.ts --runInBand
```

Expected: FAIL because Desktop lacks `version/currentVersion/latestVersion` and Android lacks `checkAndroidApkUpdate`.

- [ ] **Step 6: Implement platform check functions against the shared state**

Extend `DesktopUpdateInfo` in `app/web/src/platform/desktop/desktopRuntime.ts`:

```ts
export type DesktopUpdateInfo = {
  version: string;
  sha256: string;
  updaterReady: boolean;
};
```

Make `checkDesktopUpdate` return `ClientUpdateState` in `desktopUpdate.ts`:

```ts
return info.sha256 === pointer.sha256
  ? {status: 'current', currentVersion: info.version || pointer.version}
  : {
      status: 'available',
      currentVersion: info.version,
      latestVersion: pointer.version,
    };
```

Do not use `pointer.version` as the local version in the available branch.

Add `checkAndroidApkUpdate` in `androidApkUpdate.ts`:

```ts
export type AndroidApkUpdateCheck = {
  state: ClientUpdateState;
  latest: AndroidApkLatestRelease | null;
};

export async function checkAndroidApkUpdate(
  bridge: AndroidApkUpdateBridge,
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<AndroidApkUpdateCheck> {
  try {
    const [local, response] = await Promise.all([
      bridge.getLocalRelease(),
      request(WHEELMAKER_STABLE_URL, {cache: 'no-store'}),
    ]);
    const latest = response.ok ? parseAndroidStableRelease(await response.json()) : null;
    const status = resolveAndroidApkUpdateStatus(local, latest);
    if (!latest || status === 'unknown') return {state: {status: 'failed'}, latest: null};
    const currentVersion = local.versionName ? `v${local.versionName}` : '';
    return {
      state: status === 'up_to_date'
        ? {status: 'current', currentVersion}
        : {status: 'available', currentVersion, latestVersion: latest.tagName},
      latest,
    };
  } catch {
    return {state: {status: 'failed'}, latest: null};
  }
}
```

- [ ] **Step 7: Run the focused platform tests**

Run:

```powershell
cd app
npx jest web/src/platform/clientUpdate.test.ts __tests__/web-desktop-update.test.ts __tests__/web-android-apk-update.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit the platform model**

```powershell
git add app/web/src/platform/clientUpdate.ts app/web/src/platform/clientUpdate.test.ts app/web/src/platform/desktop/desktopRuntime.ts app/web/src/platform/desktop/desktopUpdate.ts app/web/src/platform/android/androidApkUpdate.ts app/__tests__/web-desktop-update.test.ts app/__tests__/web-android-apk-update.test.ts
git commit -m "feat(update): normalize native client update state"
```

### Task 2: Inject and expose the Desktop release version

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_update.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_update_test.go`
- Modify: `scripts/release/build.mjs`
- Modify: `scripts/release/build.test.mjs`

- [ ] **Step 1: Add failing Go and release-script assertions**

In `desktop_update_test.go`, preserve and restore the package variable:

```go
func TestDesktopUpdateInfoIncludesReleaseVersion(t *testing.T) {
	oldVersion := desktopReleaseVersion
	desktopReleaseVersion = "v1.42"
	t.Cleanup(func() { desktopReleaseVersion = oldVersion })

	controller := desktopUpdateTestController(t)
	info, err := controller.Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.Version != "v1.42" {
		t.Fatalf("version=%q", info.Version)
	}
}
```

Factor the existing standard-install fixture into `desktopUpdateTestController(t)` so both tests exercise the real `Info` method.

In `scripts/release/build.test.mjs`, locate the Desktop build invocation and assert:

```js
const desktopBuild = runner.calls.find(
  ({command, args}) => command === 'go' && args.at(-1) === './cmd/wheelmaker-desktop',
);
assert.equal(
  desktopBuild.args.includes(
    '-ldflags=-s -w -H windowsgui -X main.desktopReleaseVersion=v1.7',
  ),
  true,
);
```

- [ ] **Step 2: Run the failing Desktop tests**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop -run DesktopUpdateInfo -count=1
cd ..
node --test scripts/release/build.test.mjs
```

Expected: FAIL because `desktopReleaseVersion` and `desktopUpdateInfo.Version` do not exist, and the build lacks `-X`.

- [ ] **Step 3: Add linker-owned version metadata to the bridge response**

In `desktop_update.go`:

```go
var desktopReleaseVersion string

type desktopUpdateInfo struct {
	Version      string `json:"version"`
	SHA256       string `json:"sha256"`
	UpdaterReady bool   `json:"updaterReady"`
}
```

Return it from `Info`:

```go
return desktopUpdateInfo{
	Version:      desktopReleaseVersion,
	SHA256:       sha,
	UpdaterReady: c.updaterReady(updater),
}, nil
```

In the Desktop `go build` arguments in `scripts/release/build.mjs`, replace the current linker argument with:

```js
`-ldflags=-s -w -H windowsgui -X main.desktopReleaseVersion=${version}`
```

Keep local development builds unchanged so their version remains empty; Dev Mode does not show Update.

- [ ] **Step 4: Run Desktop Go and release build tests**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop -count=1
cd ..
node --test scripts/release/build.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Desktop metadata**

```powershell
git add server/cmd/wheelmaker-desktop/desktop_update.go server/cmd/wheelmaker-desktop/desktop_update_test.go scripts/release/build.mjs scripts/release/build.test.mjs
git commit -m "feat(desktop): embed release version metadata"
```

### Task 3: Build the shared WheelMaker App Menu

**Files:**
- Create: `app/web/src/shell/WheelMakerAppMenu.tsx`
- Create: `app/web/src/shell/WheelMakerAppMenu.test.tsx`
- Delete: `app/web/src/shell/layouts/desktop/DesktopAppMenu.tsx`
- Modify: `app/__tests__/web-desktop-titlebar.test.tsx`
- Modify: `app/web/src/styles/shell.css`

- [ ] **Step 1: Write failing cross-platform menu tests**

Create `WheelMakerAppMenu.test.tsx` with a controller injection seam:

```tsx
const baseProps = {
  themeMode: 'dark' as const,
  setThemeMode: jest.fn(),
  onOpenSettings: jest.fn(),
  onOpenReleasePublishing: jest.fn(),
};
```

Cover these exact action arrays after opening:

```ts
expect(actions(browserRoot)).toEqual(['settings', 'theme', 'release-publish']);
expect(actions(androidRoot)).toEqual(['settings', 'theme', 'update', 'release-publish']);
expect(actions(desktopRoot)).toEqual([
  'settings',
  'theme',
  'update',
  'release-publish',
  'local-dev',
]);
```

Also assert:

```ts
expect(root.findByProps({'data-app-menu-action': 'theme'}).props['data-app-menu-meta']).toBe('Dark');
expect(check).toHaveBeenCalledTimes(1);
expect(root.findByProps({'data-app-menu-action': 'update'}).props.disabled).toBe(true);
```

Close and reopen, then assert `check` has two calls. Click Theme and verify `setThemeMode('light')`. Click Release Publishing and verify its callback. For available state, click Update twice in one act and verify `start` has one call.

- [ ] **Step 2: Run the shared-menu test and verify the missing component failure**

Run:

```powershell
cd app
npx jest web/src/shell/WheelMakerAppMenu.test.tsx --runInBand
```

Expected: FAIL because `WheelMakerAppMenu.tsx` does not exist.

- [ ] **Step 3: Implement a platform-controller seam and consistent menu rows**

Export these component contracts from `WheelMakerAppMenu.tsx`:

```tsx
export type ClientUpdateController = {
  check: () => Promise<ClientUpdateState>;
  start: () => Promise<void>;
};

export type WheelMakerAppMenuProps = {
  themeMode: 'dark' | 'light';
  setThemeMode: (mode: 'dark' | 'light') => void;
  onOpenSettings: () => void;
  onOpenReleasePublishing: () => void;
  updateController?: ClientUpdateController | null;
};
```

Render rows through one helper so every item has identical geometry:

```tsx
const menuRow = ({
  action,
  icon,
  label,
  meta,
  disabled = false,
  onClick,
}: MenuRow) => (
  <button
    type="button"
    role="menuitem"
    data-app-menu-action={action}
    data-app-menu-meta={meta}
    disabled={disabled}
    onClick={onClick}
  >
    <SessionIcon name={icon} />
    <span className="app-menu-label">{label}</span>
    {meta ? <span className="app-menu-meta">{meta}</span> : null}
  </button>
);
```

On the closed-to-open transition:

```tsx
const toggleMenu = () => {
  const opening = !menuOpen;
  setMenuOpen(opening);
  if (opening && updateController) {
    setUpdateState({status: 'checking'});
    void updateController.check().then(setUpdateState, () => setUpdateState({status: 'failed'}));
  }
};
```

Use a ref guard around `start`:

```tsx
if (updateStartPendingRef.current) return;
updateStartPendingRef.current = true;
setUpdateState({status: 'updating', meta: 'Starting…'});
try {
  await updateController.start();
} catch {
  updateStartPendingRef.current = false;
  setUpdateState({status: 'failed'});
}
```

Port the existing Local Dev dialog and focus trap without changing its bridge calls. Preserve portal rendering, exit animation, outside-click close, Escape close, arrow-key navigation, trigger focus restoration, update red dot on the product icon, and `data-desktop-window-interactive`.

- [ ] **Step 4: Replace Desktop-specific assertions with shared-menu assertions**

In `web-desktop-titlebar.test.tsx`, import `WheelMakerAppMenu`, retain window-control tests, and update source-path assertions to `web/src/shell/WheelMakerAppMenu.tsx`. Require the exact Desktop order and divider:

```ts
expect(actionNames).toEqual([
  'settings',
  'theme',
  'update',
  'release-publish',
  'local-dev',
]);
expect(root.findAllByProps({className: 'app-menu-divider'})).toHaveLength(1);
```

Keep the existing Dev Mode dialog, checked-state, update retry, launch failure, portal, exit-animation, and focus-trap coverage.

- [ ] **Step 5: Add uniform single-line styles**

Rename Desktop-only menu selectors in `shell.css` to shared `.app-menu-*` selectors. Enforce:

```css
.app-menu-surface > button {
  min-height: 38px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.app-menu-label,
.app-menu-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-menu-meta {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.app-menu-divider {
  height: 1px;
  margin: 5px 8px;
  background: var(--border-subtle);
}
```

Keep the surface width bounded on narrow screens with `max-width: calc(100vw - 16px)`.

- [ ] **Step 6: Run menu and Desktop titlebar tests**

Run:

```powershell
cd app
npx jest web/src/shell/WheelMakerAppMenu.test.tsx __tests__/web-desktop-titlebar.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit the shared menu**

```powershell
git add app/web/src/shell/WheelMakerAppMenu.tsx app/web/src/shell/WheelMakerAppMenu.test.tsx app/web/src/shell/layouts/desktop/DesktopAppMenu.tsx app/__tests__/web-desktop-titlebar.test.tsx app/web/src/styles/shell.css
git commit -m "feat(ui): unify WheelMaker app menu"
```

### Task 4: Wire native controllers and standalone Release Publishing

**Files:**
- Create: `app/web/src/shell/mobileStandalonePageHistory.ts`
- Create: `app/web/src/shell/mobileStandalonePageHistory.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-android-apk-update-settings.test.ts`
- Modify: `app/__tests__/web-mobile-settings-system-back.test.ts`

- [ ] **Step 1: Write failing history and source-structure tests**

Create `mobileStandalonePageHistory.test.ts`:

```ts
import {
  createStandalonePageHistoryState,
  isStandalonePageHistoryState,
} from './mobileStandalonePageHistory';

test('recognizes only the Release Publishing history entry', () => {
  expect(createStandalonePageHistoryState()).toEqual({
    wheelMakerStandalonePage: 'release-publish',
  });
  expect(isStandalonePageHistoryState({
    wheelMakerStandalonePage: 'release-publish',
  })).toBe(true);
  expect(isStandalonePageHistoryState({wheelMakerStandalonePage: 'settings'})).toBe(false);
  expect(isStandalonePageHistoryState(null)).toBe(false);
});
```

Update existing structure tests to require:

```ts
expect(mainTsx).toContain('<WheelMakerAppMenu');
expect(mainTsx).toContain('onOpenReleasePublishing={openReleasePublishing}');
expect(mainTsx).toContain('wheelMakerStandalonePage');
expect(mainTsx).not.toContain('<DesktopAppMenu');
```

Require Release Publishing outside settings state:

```ts
expect(settingsNavigation).not.toContain("'releasePublish'");
expect(settingsRoot).not.toContain("openSettingsChild('releasePublish')");
expect(mainTsx).toContain('const [releasePublishingOpen, setReleasePublishingOpen] = useState(false);');
```

- [ ] **Step 2: Run focused integration tests and verify failures**

Run:

```powershell
cd app
npx jest web/src/shell/mobileStandalonePageHistory.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-android-apk-update-settings.test.ts __tests__/web-mobile-settings-system-back.test.ts --runInBand
```

Expected: FAIL because the standalone history module and integration do not exist.

- [ ] **Step 3: Implement strict mobile standalone-page history state**

Create `mobileStandalonePageHistory.ts`:

```ts
export type StandalonePageHistoryState = {
  wheelMakerStandalonePage: 'release-publish';
};

export function createStandalonePageHistoryState(): StandalonePageHistoryState {
  return {wheelMakerStandalonePage: 'release-publish'};
}

export function isStandalonePageHistoryState(
  value: unknown,
): value is StandalonePageHistoryState {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Record<string, unknown>).wheelMakerStandalonePage === 'release-publish',
  );
}
```

- [ ] **Step 4: Add controller factories and use the shared menu from both headers**

In `WorkspaceApp.tsx`, memoize a Desktop controller when the bridge supports production self-update and an Android controller when native APK RPC is supported. The Android controller stores the checked latest pointer for `start`:

```ts
const latestAndroidReleaseRef = useRef<AndroidApkLatestRelease | null>(null);
```

```ts
const androidUpdateController = useMemo<ClientUpdateController | null>(() => {
  if (!androidApkUpdateBridge.isSupported()) return null;
  return {
    check: async () => {
      const result = await checkAndroidApkUpdate(androidApkUpdateBridge);
      latestAndroidReleaseRef.current = result.latest;
      return result.state;
    },
    start: async () => {
      const latest = latestAndroidReleaseRef.current;
      if (!latest) throw new Error('Android release is unavailable.');
      const result = await androidApkUpdateBridge.installLatest({
        downloadUrl: latest.apk.downloadUrl,
        expectedSha256: latest.apk.sha256,
        expectedSize: latest.apk.size,
        tagName: latest.tagName,
      });
      if (!result.ok) throw new Error(result.error || result.status);
    },
  };
}, [androidApkUpdateBridge]);
```

Render the same component for both `mobile` branches:

```tsx
<WheelMakerAppMenu
  themeMode={themeMode}
  setThemeMode={setThemeMode}
  onOpenSettings={handleDesktopSettingsSelect}
  onOpenReleasePublishing={openReleasePublishing}
  updateController={isWide ? desktopUpdateController : androidUpdateController}
/>
```

Browser/PWA supplies `null`, so it makes no stable request and renders no Update.

- [ ] **Step 5: Add the independent Release Publishing surface and back behavior**

Add state and mutually exclusive open logic:

```ts
const [releasePublishingOpen, setReleasePublishingOpen] = useState(false);

const openReleasePublishing = useCallback(() => {
  closeSettingsPanel();
  setDrawerOpen(false);
  setReleasePublishingOpen(true);
  if (!isWide) {
    window.history.pushState(createStandalonePageHistoryState(), '');
  }
}, [closeSettingsPanel, isWide, setDrawerOpen]);
```

Render `ReleasePublishSettings` directly inside `SettingsScreen` for Desktop and `MobileSettingsScreen` for mobile, with title `Release publishing`, no settings shortcuts, and a back/close callback. Extend the existing `popstate` listener so a transition away from the standalone state closes `releasePublishingOpen`; the visible mobile back button calls `window.history.back()`.

Keep the existing props:

```tsx
<ReleasePublishSettings
  hubIds={updateHubCards.map(card => card.hubId)}
  start={startReleasePublish}
  query={queryReleasePublish}
/>
```

- [ ] **Step 6: Move Android update lifecycle out of Settings**

Delete Android APK update state, Settings-open effects, install handlers, and props that existed solely for `SettingsRootContent`. Keep `createAndroidApkUpdateBridge` and native install events only where the App Menu controller needs them. Do not alter native RPC action names or Android Kotlin code.

- [ ] **Step 7: Run integration tests**

Run:

```powershell
cd app
npx jest web/src/shell/mobileStandalonePageHistory.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-android-apk-update-settings.test.ts __tests__/web-mobile-settings-system-back.test.ts web/src/shell/WheelMakerAppMenu.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit shell integration**

```powershell
git add app/web/src/shell/mobileStandalonePageHistory.ts app/web/src/shell/mobileStandalonePageHistory.test.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-settings-navigation.test.ts app/__tests__/web-android-apk-update-settings.test.ts app/__tests__/web-mobile-settings-system-back.test.ts
git commit -m "feat(shell): add standalone publishing entry"
```

### Task 5: Remove application theme, APK update, and publishing from Settings

**Files:**
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/settings/settingsNavigation.ts`
- Modify: `app/web/src/settings/SettingsSurface.tsx`
- Modify: `app/web/src/settings/SettingsBundle.ts`
- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-android-apk-update-settings.test.ts`

- [ ] **Step 1: Tighten Settings tests to the approved boundary**

Require:

```ts
expect(SETTINGS_CHILD_DETAILS).toEqual([
  'connectionStatus',
  'database',
  'debugLogs',
  'deviceSessions',
  'skillDetail',
]);
expect(settingsRoot).not.toContain('Dark Mode');
expect(settingsRoot).not.toContain('Android APK');
expect(settingsRoot).not.toContain('Release publishing');
expect(settingsRoot).toContain('Code Theme');
```

Update the section-ID assertion to:

```ts
expect(settingsRoot).toContain(
  "type SettingsSectionId = 'chat' | 'server' | 'connection' | 'code-display' | 'debug';",
);
```

- [ ] **Step 2: Run Settings tests and verify old rows fail the assertions**

Run:

```powershell
cd app
npx jest __tests__/web-settings-navigation.test.ts __tests__/web-android-apk-update-settings.test.ts --runInBand
```

Expected: FAIL while Appearance, Android APK, or Release Publishing remains in Settings.

- [ ] **Step 3: Remove obsolete Settings contracts and rows**

From `SettingsRootContentProps` and destructuring, remove:

```ts
themeMode
setThemeMode
androidApkUpdateSupported
androidApkLocalRelease
androidApkLatestRelease
androidApkUpdateLoading
androidApkUpdateError
androidApkInstallStatus
androidApkInstallPending
refreshAndroidApkUpdate
requestAndroidApkInstall
androidApkUpdateStatusLabel
```

Remove the complete Android section, Appearance section, and Release Publishing Debug button. Remove their Android imports and keep Code Theme imports.

Remove `'releasePublish'` from `SettingsChildDetail`, `SETTINGS_CHILD_DETAILS`, `settingsDetailTitle`, and Settings detail rendering. Keep exporting `ReleasePublishSettings` from `SettingsBundle.ts` because the standalone shell still lazy-loads it.

- [ ] **Step 4: Run Settings and TypeScript checks**

Run:

```powershell
cd app
npx jest __tests__/web-settings-navigation.test.ts __tests__/web-android-apk-update-settings.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 5: Commit Settings cleanup**

```powershell
git add app/web/src/settings/SettingsRootContent.tsx app/web/src/settings/settingsNavigation.ts app/web/src/settings/SettingsSurface.tsx app/web/src/settings/SettingsBundle.ts app/__tests__/web-settings-navigation.test.ts app/__tests__/web-android-apk-update-settings.test.ts
git commit -m "refactor(settings): move app actions into app menu"
```

### Task 6: Validate behavior, documentation, and release safety

**Files:**
- Verify: `docs/scope/2026-07-30-unified-app-menu/spec-unified-app-menu.md`
- Verify: `docs/scope/2026-07-30-unified-app-menu/plan-unified-app-menu.md`
- Verify: `docs/wiki/frontend-interaction/app-menu.md`
- Verify: `docs/wiki/frontend-interaction/frontend-interaction.md`
- Verify: `docs/wiki/release-and-build/desktop-self-update.md`

- [ ] **Step 1: Run focused App tests**

Run:

```powershell
cd app
npx jest web/src/platform/clientUpdate.test.ts web/src/shell/WheelMakerAppMenu.test.tsx web/src/shell/mobileStandalonePageHistory.test.ts __tests__/web-desktop-update.test.ts __tests__/web-desktop-titlebar.test.tsx __tests__/web-android-apk-update.test.ts __tests__/web-android-apk-update-settings.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-mobile-settings-system-back.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run the complete App unit and type suites**

Run:

```powershell
cd app
npm test -- --runInBand
npm run tsc:web
```

Expected: PASS, or only repository-baseline failures reproduced unchanged on `main`.

- [ ] **Step 3: Run Desktop and release-script tests**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop -count=1
cd ..
node --test scripts/release/build.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run formatting and documentation checks**

Run:

```powershell
git diff --check
Get-Content -LiteralPath docs/wiki/frontend-interaction/app-menu.md -TotalCount 1
Get-Content -LiteralPath docs/wiki/release-and-build/desktop-self-update.md -TotalCount 1
```

Expected: `git diff --check` exits 0 and both Wiki files begin with `> 摘要：`.

- [ ] **Step 5: Rebase on the latest remote branch before the completion commit**

Run:

```powershell
git fetch origin
git rebase origin/main
```

Expected: successful rebase. Resolve only mechanically unambiguous conflicts; stop for product-semantic conflicts.

- [ ] **Step 6: Commit remaining approved documentation and verification updates**

```powershell
git add docs/scope/2026-07-30-unified-app-menu docs/wiki/frontend-interaction/app-menu.md docs/wiki/frontend-interaction/frontend-interaction.md docs/wiki/release-and-build/desktop-self-update.md
git commit -m "docs: record unified app menu behavior"
```

- [ ] **Step 7: Push the feature branch**

```powershell
git push -u origin feature/unified-app-menu
```

Expected: branch push succeeds.
