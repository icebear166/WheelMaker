# External File Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let chat file links preview any file on the selected project's Hub, add link-local path and Desktop actions, and keep external files outside project cache, index, tree, and sync flows.

**Architecture:** Parse every local file link into one normalized request path plus absolute/relative display paths. Project-relative requests keep using `project.fs.info/read`; absolute requests use additive `project.fs.external.info/read` methods routed through the chat project to its Hub. Desktop exposes separate absolute-file bindings while retaining the old project-relative bindings as an internal-file compatibility fallback.

**Tech Stack:** React 19, TypeScript 5.8, Jest 30, Go, Gorilla WebSocket, Windows WebView2 bridge, CSS/Codicons.

---

## File structure

- `app/web/src/preview/previewFileLink.ts` owns browser-safe Windows/POSIX path parsing, lexical normalization, project containment, URI decoding, and line extraction.
- `app/web/src/chat/ChatFileLinkContextMenu.tsx` owns rendering and dismissal behavior for the link context menu; it does not resolve paths or access Registry services.
- `app/web/src/platform/desktop/desktopRuntime.ts` owns Desktop capability detection, absolute-file invocation, and fallback to existing project-relative bindings.
- `app/web/src/registry/registryMethods.ts`, `RegistryRepository.ts`, and `RegistryWorkspaceService.ts` own the App-side additive protocol calls and old-Hub error translation.
- `server/internal/protocol/registry_methods.go` owns protocol registration and routing metadata without changing protocol version.
- `server/internal/hub/reporter.go` owns host absolute-path validation and external file info/read responses.
- `server/cmd/wheelmaker-desktop/desktop_file_actions_windows.go`, `desktop_bridge.go`, `webview_policy.go`, and `webview_windows.go` own trusted absolute-file native actions.
- `app/web/src/app/WorkspaceApp.tsx` only orchestrates parsed references, preview loading, clipboard actions, native actions, and menu state.
- Existing tests receive behavior assertions where they already cover the unit; one focused React menu test and one focused Registry service test are added.

### Task 1: Commit the approved design record

**Files:**
- Add: `docs/scope/2026-07-24-external-file-links.md`
- Add: `docs/wiki/features/file-links.md`
- Modify: `docs/wiki/features/features.md`
- Modify: `docs/wiki/protocols/registry.md`

- [x] **Step 1: Rebase the uncommitted design documents onto current main**

Run:

```powershell
git stash push -u -m "external-file-links design before rebase"
git fetch origin
git rebase origin/main
git stash pop
```

Expected: the feature branch is based on current `origin/main`; the spec, plan, and wiki edits are restored without conflict.

- [x] **Step 2: Verify the approved documents**

Run:

```powershell
rg -n "project\.fs\.external\.(info|read)|Copy relative path|Open with VS Code" docs/scope/2026-07-24-external-file-links.md docs/wiki/features/file-links.md docs/wiki/protocols/registry.md
git add docs/scope/2026-07-24-external-file-links.md docs/plans/2026-07-24-external-file-links/plan-external-file-links.md docs/wiki/features/file-links.md docs/wiki/features/features.md docs/wiki/protocols/registry.md
git diff --cached --check
```

Expected: the spec and both wiki topics contain the approved method and action boundaries; `git diff --cached --check` exits 0.

- [x] **Step 3: Commit the design record**

```powershell
git commit -m "docs: define external file link behavior"
```

Expected: one documentation commit; no production source is changed.

### Task 2: Normalize project and external file links

**Files:**
- Modify: `app/web/src/preview/previewFileLink.ts`
- Modify: `app/__tests__/web-preview-file-regressions.test.tsx`

- [x] **Step 1: Write failing parser tests**

Extend the `PreviewFileLinkModule` test type to expose `isAbsolutePreviewFilePath`, and replace the single selected-project assertion with table-driven cases using this result shape:

```ts
type PreviewFileLink = {
  path: string;
  absolutePath: string;
  relativePath: string | null;
  line: number | null;
};

const cases: Array<[string, string, PreviewFileLink]> = [
  [
    'D:/Code/WheelMaker/src/main.ts:42:7',
    'D:/Code/WheelMaker',
    {
      path: 'src/main.ts',
      absolutePath: 'D:/Code/WheelMaker/src/main.ts',
      relativePath: 'src/main.ts',
      line: 42,
    },
  ],
  [
    '../OtherProject/src/worker.ts#L9',
    'D:/Code/WheelMaker',
    {
      path: 'D:/Code/OtherProject/src/worker.ts',
      absolutePath: 'D:/Code/OtherProject/src/worker.ts',
      relativePath: null,
      line: 9,
    },
  ],
  [
    '/var/log/system.log',
    '/srv/wheelmaker',
    {
      path: '/var/log/system.log',
      absolutePath: '/var/log/system.log',
      relativePath: null,
      line: null,
    },
  ],
  [
    'file://fileserver/share/report.txt',
    'D:/Code/WheelMaker',
    {
      path: '//fileserver/share/report.txt',
      absolutePath: '//fileserver/share/report.txt',
      relativePath: null,
      line: null,
    },
  ],
  [
    'vscode://file/D:/Code/WheelMaker/app/main.ts:12:3',
    'D:/Code/WheelMaker',
    {
      path: 'app/main.ts',
      absolutePath: 'D:/Code/WheelMaker/app/main.ts',
      relativePath: 'app/main.ts',
      line: 12,
    },
  ],
];

for (const [href, root, expected] of cases) {
  expect(resolvePreviewFileLink!(href, root)).toEqual(expected);
}

expect(resolvePreviewFileLink!('https://example.com/file.ts', 'D:/Code/WheelMaker')).toBeNull();
expect(resolvePreviewFileLink!('D:/Code/WheelMaker', 'D:/Code/WheelMaker')).toBeNull();
expect(isAbsolutePreviewFilePath!('D:/outside.txt')).toBe(true);
expect(isAbsolutePreviewFilePath!('//server/share/outside.txt')).toBe(true);
expect(isAbsolutePreviewFilePath!('/var/log/system.log')).toBe(true);
expect(isAbsolutePreviewFilePath!('src/main.ts')).toBe(false);
```

- [x] **Step 2: Run the parser test and confirm RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-preview-file-regressions.test.tsx
```

Expected: FAIL because the resolver does not return absolute/relative metadata, rejects `../`, and strips POSIX/UNC roots.

- [x] **Step 3: Implement lexical local-path resolution**

Change the exported contract to:

```ts
export type PreviewFileLink = {
  path: string;
  absolutePath: string;
  relativePath: string | null;
  line: number | null;
};

export function isAbsolutePreviewFilePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return /^[a-zA-Z]:\//.test(normalized)
    || /^\/\/[^/]+\/[^/]+/.test(normalized)
    || normalized.startsWith('/');
}
```

Inside `resolvePreviewFileLink`, perform these operations in order:

```ts
const decoded = decodePath(pathCandidate).replaceAll('\\', '/');
const withoutLine = extractPreviewLine(decoded);
const normalizedRoot = normalizeAbsoluteLocalPath(projectRoot);
const absolutePath = isAbsolutePreviewFilePath(withoutLine.path)
  ? normalizeAbsoluteLocalPath(withoutLine.path)
  : normalizedRoot
    ? resolveAbsoluteLocalPath(normalizedRoot, withoutLine.path)
    : '';
const relativePath = absolutePath && normalizedRoot
  ? relativePathWithinRoot(normalizedRoot, absolutePath)
  : isAbsolutePreviewFilePath(withoutLine.path)
    ? null
    : normalizeRelativeLocalPath(withoutLine.path);
if (!absolutePath && !relativePath) return null;
return {
  path: relativePath ?? absolutePath,
  absolutePath,
  relativePath,
  line: withoutLine.line,
};
```

Implement `normalizeAbsoluteLocalPath`, `resolveAbsoluteLocalPath`, and `relativePathWithinRoot` in the same file. Preserve `C:/`, `/`, and `//server/share` roots; collapse `.` and `..` segments lexically; compare Windows drive and UNC paths case-insensitively; compare POSIX paths case-sensitively. A path exactly equal to the project root is not a file link.

For file URIs, build UNC paths as `//${parsed.hostname}${decodedPathname}`. For `vscode://file`, require `hostname.toLowerCase() === 'file'` and use the decoded pathname. Keep the existing JavaScript/VBScript and non-file scheme rejection.
Before absolute-path classification, convert `/C:/path` to `C:/path` so WHATWG URL pathnames for Windows file URIs retain drive semantics.

- [x] **Step 4: Run parser tests and type-check**

Run:

```powershell
npm test -- --runInBand __tests__/web-preview-file-regressions.test.tsx
npm run tsc:web
```

Expected: PASS; no TypeScript errors.

- [x] **Step 5: Commit**

```powershell
git add app/web/src/preview/previewFileLink.ts app/__tests__/web-preview-file-regressions.test.tsx
git commit -m "feat(app): resolve external file links"
```

### Task 3: Register additive Registry methods

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/__tests__/web-registry-protocol-domain-service.test.ts`

- [x] **Step 1: Write failing protocol registration tests**

Add both methods to `TestRegistryProtocolDomainTargetMethods` and assert their descriptors:

```go
for _, method := range []string{
    RegistryMethodProjectFSExternalInfo,
    RegistryMethodProjectFSExternalRead,
} {
    descriptor, ok := RegistryMethod(method)
    if !ok {
        t.Fatalf("%s should be registered", method)
    }
    if descriptor.Route != RegistryRouteProjectForward || !descriptor.RequiresProjectID {
        t.Fatalf("%s descriptor=%+v, want project forward with projectId", method, descriptor)
    }
    if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
        t.Fatalf("%s should allow client callers", method)
    }
}
```

Add App assertions:

```ts
const registryMethodsTs = readAppSource('web/src/registry/registryMethods.ts');
expect(registryMethodsTs).toContain("ProjectFSExternalInfo: 'project.fs.external.info'");
expect(registryMethodsTs).toContain("ProjectFSExternalRead: 'project.fs.external.read'");
expect(registryMethodsTs).toContain("RegistryProtocolVersion = '2.6'");
```

- [x] **Step 2: Run protocol tests and confirm RED**

Run:

```powershell
cd server
go test ./internal/protocol -run RegistryProtocol -count=1
cd ..\app
npm test -- --runInBand __tests__/web-registry-protocol-domain-service.test.ts
```

Expected: FAIL because the constants and descriptors do not exist.

- [x] **Step 3: Add constants and project-forward descriptors**

Add these constants without changing `RegistryProtocolVersion`:

```go
RegistryMethodProjectFSExternalInfo = "project.fs.external.info"
RegistryMethodProjectFSExternalRead = "project.fs.external.read"
```

```go
RegistryMethodProjectFSExternalInfo: registryProjectMethod(
    RegistryMethodProjectFSExternalInfo,
    RegistryRouteProjectForward,
),
RegistryMethodProjectFSExternalRead: registryProjectMethod(
    RegistryMethodProjectFSExternalRead,
    RegistryRouteProjectForward,
),
```

Add the matching TypeScript constants:

```ts
ProjectFSExternalInfo: 'project.fs.external.info',
ProjectFSExternalRead: 'project.fs.external.read',
```

- [x] **Step 4: Run protocol tests**

Run the two commands from Step 2.

Expected: PASS; protocol version remains `2.6`.

- [x] **Step 5: Commit**

```powershell
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go app/web/src/registry/registryMethods.ts app/__tests__/web-registry-protocol-domain-service.test.ts
git commit -m "feat(registry): register external file reads"
```

### Task 4: Serve external files from the routed Hub

**Files:**
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [x] **Step 1: Write failing Hub integration tests**

Extend `TestReporterRun_RegistersAndServesFSRequests` so the project is a child of a temporary base directory and `outside.txt` is its sibling:

```go
base := t.TempDir()
root := filepath.Join(base, "project")
if err := os.MkdirAll(root, 0o755); err != nil {
    t.Fatal(err)
}
externalPath := filepath.Join(base, "outside.txt")
if err := os.WriteFile(externalPath, []byte("outside registry"), 0o644); err != nil {
    t.Fatal(err)
}
```

After the existing project read, send `project.fs.external.info` and `project.fs.external.read` with `externalPath`. Assert:

```go
if externalInfo.Payload["path"] != filepath.Clean(externalPath) ||
    externalInfo.Payload["kind"] != "file" {
    t.Fatalf("unexpected external info: %#v", externalInfo.Payload)
}
if externalRead.Payload["path"] != filepath.Clean(externalPath) ||
    externalRead.Payload["content"] != "outside registry" ||
    externalRead.Payload["notModified"] != false {
    t.Fatalf("unexpected external read: %#v", externalRead.Payload)
}
```

Send a relative path, a directory path, a missing absolute path, and an external read payload containing the returned hash as `knownHash`. Expect `INVALID_ARGUMENT` for relative/directory, `NOT_FOUND` for missing, and a full response with `notModified: false` for the hash case.

- [x] **Step 2: Run the Hub test and confirm RED**

Run:

```powershell
cd server
go test ./internal/hub -run TestReporterRun_RegistersAndServesFSRequests -count=1
```

Expected: FAIL because the old Hub returns `unsupported method on hub`.

- [x] **Step 3: Add external handlers and shared file response helpers**

Add switch cases:

```go
case rp.RegistryMethodProjectFSExternalInfo:
    r.replyFSExternalInfo(conn, in)
case rp.RegistryMethodProjectFSExternalRead:
    r.replyFSExternalRead(conn, in)
```

Add an absolute regular-file validator:

```go
func resolveExternalFilePath(raw string) (string, error) {
    if raw == "" {
        return "", fmt.Errorf("external file path is required")
    }
    clean := filepath.Clean(filepath.FromSlash(raw))
    if !filepath.IsAbs(clean) {
        return "", fmt.Errorf("external file path must be absolute")
    }
    return clean, nil
}
```

Both handlers must first call `r.projectRoot(req.ProjectID)` to prove the routed project belongs to this Hub. Refactor the current info/read response construction into helpers that accept `(targetPath, responsePath)` so existing project handlers pass `(target, rel)` and external handlers pass `(target, target)`.

The external info helper must reject directories and non-regular files with `INVALID_ARGUMENT`. External read accepts only `path`; ignore an unrecognized `knownHash` field and always return the full body with `notModified: false`. Preserve current binary Base64, MIME, hash, line count, and large-file metadata semantics.

Map `os.IsNotExist` to `NOT_FOUND`; keep other stat/read failures as `INTERNAL`.

- [x] **Step 4: Run focused and related Hub tests**

Run:

```powershell
go test ./internal/hub -run 'TestReporterRun_RegistersAndServesFSRequests|TestReporterFSHashNegotiationAndGitStatus' -count=1
go test ./internal/protocol ./internal/registry ./internal/hub
```

Expected: PASS; existing project hash negotiation still works.

- [x] **Step 5: Commit**

```powershell
git add server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(hub): read routed external files"
```

### Task 5: Add uncached App repository and service calls

**Files:**
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Add: `app/__tests__/web-external-file-service.test.ts`

- [x] **Step 1: Write failing repository/service tests**

Create a mock request test:

```ts
import {RegistryRequestError} from '../web/src/registry/RegistryClient';
import {RegistryMethods} from '../web/src/registry/registryMethods';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {translateExternalFileError} from '../web/src/registry/RegistryWorkspaceService';

test('external info and read use additive methods without knownHash', async () => {
  const request = jest.fn()
    .mockResolvedValueOnce({payload: {path: 'D:/outside.txt', kind: 'file', size: 7}})
    .mockResolvedValueOnce({
      payload: {
        path: 'D:/outside.txt',
        content: 'outside',
        notModified: false,
        isBinary: false,
      },
    });
  const repository = new RegistryRepository({request} as never);

  await expect(repository.getExternalFileInfo('hub:p', 'D:/outside.txt'))
    .resolves.toMatchObject({path: 'D:/outside.txt', kind: 'file'});
  await expect(repository.readExternalFile('hub:p', 'D:/outside.txt'))
    .resolves.toMatchObject({path: 'D:/outside.txt', content: 'outside', notModified: false});

  expect(request.mock.calls).toEqual([
    [{
      method: RegistryMethods.ProjectFSExternalInfo,
      projectId: 'hub:p',
      payload: {path: 'D:/outside.txt'},
      signal: undefined,
    }],
    [{
      method: RegistryMethods.ProjectFSExternalRead,
      projectId: 'hub:p',
      payload: {path: 'D:/outside.txt'},
      signal: undefined,
    }],
  ]);
});
```

Add service tests that translate both an old Hub and an old Registry, but leave unrelated invalid-argument errors unchanged:

```ts
for (const message of ['unsupported method on hub', 'unsupported method']) {
  expect(() => translateExternalFileError(
    new RegistryRequestError(
      message,
      'INVALID_ARGUMENT',
      {method: RegistryMethods.ProjectFSExternalRead},
    ),
  )).toThrow('This Hub does not support external file preview.');
}
const unrelated = new RegistryRequestError(
  'unsupported method',
  'INVALID_ARGUMENT',
  {method: RegistryMethods.ProjectGitStatus},
);
expect(() => translateExternalFileError(unrelated)).toThrow(unrelated);
```

- [x] **Step 2: Run the new test and confirm RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-external-file-service.test.ts
```

Expected: FAIL because external repository and service methods do not exist.

- [x] **Step 3: Implement repository calls**

Add:

```ts
async getExternalFileInfo(
  projectId: string,
  path: string,
  options?: Pick<RegistryFileRequestOptions, 'signal'>,
): Promise<RegistryFsInfo>

async readExternalFile(
  projectId: string,
  path: string,
  options?: Pick<RegistryFileRequestOptions, 'signal'>,
): Promise<RegistryFsReadResponse>
```

Use `{path}` only for both payloads. Extract private `normalizeFileInfoResponse(payload)` and `normalizeFileReadResponse(payload, requestedPath)` helpers from the existing `getFileInfo` and `readFile` field mappings, then call those helpers from both project and external methods.

- [x] **Step 4: Implement service forwarding and old-Hub translation**

Import `RegistryMethods` from `./registryMethods`, then add:

```ts
async getExternalFileInfo(
  projectId: string,
  path: string,
  options?: Pick<RegistryFileRequestOptions, 'signal'>,
): Promise<RegistryFsInfo>

async readExternalFile(
  projectId: string,
  path: string,
  options?: Pick<RegistryFileRequestOptions, 'signal'>,
): Promise<{
  content: string;
  hash?: string;
  notModified: boolean;
  total?: number;
  isBinary?: boolean;
}>
```

Wrap only this exact legacy signal:

```ts
export function translateExternalFileError(error: unknown): never {
  const details = error instanceof RegistryRequestError
    && error.details
    && typeof error.details === 'object'
    ? error.details as {method?: unknown}
    : {};
  if (
    error instanceof RegistryRequestError &&
    error.code === 'INVALID_ARGUMENT' &&
    (error.message === 'unsupported method on hub' || error.message === 'unsupported method') &&
    (
      details.method === RegistryMethods.ProjectFSExternalInfo ||
      details.method === RegistryMethods.ProjectFSExternalRead
    )
  ) {
    throw new Error('This Hub does not support external file preview.');
  }
  throw error;
}
```

Do not change project file error handling.

- [x] **Step 5: Run tests and type-check**

Run:

```powershell
npm test -- --runInBand __tests__/web-external-file-service.test.ts __tests__/web-registry-protocol-domain-service.test.ts
npm run tsc:web
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/__tests__/web-external-file-service.test.ts
git commit -m "feat(app): request external file previews"
```

### Task 6: Route external preview tabs without cache participation

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-preview-workbench-state.test.ts`
- Modify: `app/__tests__/web-disable-file-cache-settings.test.ts`

- [x] **Step 1: Write failing preview routing and restore tests**

Add a state test proving an absolute file path survives snapshot/restore without content:

```ts
const state = openPreviewTab(createPreviewWorkbenchState('p1'), {
  type: 'file',
  projectId: 'p1',
  path: 'D:/outside/report.md',
  targetLine: 7,
  title: 'report.md',
});
const restored = previewWorkbenchStateFromSnapshot(previewWorkbenchSnapshotFromState(state));
expect(activePreviewTab(restored)).toMatchObject({
  type: 'file',
  path: 'D:/outside/report.md',
  targetLine: 7,
  content: '',
});
```

Update source-wiring assertions to require:

```ts
expect(mainTsx).toContain('isAbsolutePreviewFilePath(path)');
expect(mainTsx).toContain('service.getExternalFileInfo(targetProjectId, path');
expect(mainTsx).toContain('service.readExternalFile(targetProjectId, path');
expect(mainTsx).toContain('service.getProjectFileInfo(targetProjectId, path');
expect(mainTsx).toContain('service.readProjectFile(path, targetProjectId');
expect(mainTsx).not.toContain('workspaceStore.cacheFile(');
expect(mainTsx).toContain('if (isAbsolutePreviewFilePath(chatFilePeek.path)) return;');
expect(mainTsx).toContain('disabled={!chatFilePeek?.path || isAbsolutePreviewFilePath(chatFilePeek.path)}');
```

Keep the existing directory-cache assertions unchanged.

- [x] **Step 2: Run preview tests and confirm RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-disable-file-cache-settings.test.ts
```

Expected: FAIL because preview loading always calls project file methods.

- [x] **Step 3: Route initial and restored file loads**

Import `isAbsolutePreviewFilePath`. In both `readChatFilePeek` and the file branch of `loadRestoredPreviewTab`, select the service methods from the path:

```ts
const external = isAbsolutePreviewFilePath(path);
const info = external
  ? await service.getExternalFileInfo(targetProjectId, path, {signal: controller.signal})
  : await service.getProjectFileInfo(targetProjectId, path, {signal: controller.signal});
const result = external
  ? await service.readExternalFile(targetProjectId, path, {signal: controller.signal})
  : await service.readProjectFile(path, targetProjectId, {signal: controller.signal});
```

Use the restored tab's `projectId` and `path` in the restored branch. Keep the same AbortController, request sequencing, large-file confirmation, error tab, binary rendering, and target-line flow. Do not access `workspaceStore`, `fileMemoryCache`, `knownHash`, directory state, tree expansion, index, or search for external content.

Guard `locateActivePreviewFileInTree` and its toolbar button with `isAbsolutePreviewFilePath(chatFilePeek.path)`. The project tree may remain visible, but an external path must never be expanded, selected, or searched for in that tree.

- [x] **Step 4: Run preview tests and type-check**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-disable-file-cache-settings.test.ts __tests__/web-preview-file-regressions.test.tsx
npm run tsc:web
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-preview-workbench-state.test.ts app/__tests__/web-disable-file-cache-settings.test.ts
git commit -m "feat(app): preview external files"
```

### Task 7: Add trusted absolute Desktop file actions

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_file_actions_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_file_actions_windows_test.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts`
- Modify: `app/__tests__/web-desktop-runtime.test.ts`

- [x] **Step 1: Write failing native absolute-path tests**

Add environment tests:

```go
func TestDesktopAbsoluteFileActions(t *testing.T) {
    file := filepath.Join(t.TempDir(), "outside file.go")
    if err := os.WriteFile(file, []byte("package outside"), 0o644); err != nil {
        t.Fatal(err)
    }
    var launches [][]string
    environment := desktopFileActionEnvironment{
        stat: os.Stat,
        lookPath: func(string) (string, error) { return `C:\Code.exe`, nil },
        getenv: func(string) string { return "" },
        launch: func(name string, args ...string) error {
            launches = append(launches, append([]string{name}, args...))
            return nil
        },
    }

    if err := environment.openFileInVSCode(file); err != nil {
        t.Fatal(err)
    }
    if err := environment.showFileInFolder(file); err != nil {
        t.Fatal(err)
    }
    if len(launches) != 2 ||
        launches[0][1] != file ||
        launches[1][0] != "explorer.exe" ||
        launches[1][1] != "/select,"+file {
        t.Fatalf("launches=%v", launches)
    }
}
```

Add table cases rejecting relative, missing, and directory paths without launching.

Extend bridge policy matrices so `desktopBridgeOpenFileInVSCode` and `desktopBridgeShowFileInFolder` are allowed only for the same committed trusted remote main-frame pages as existing project file actions, and denied for bootstrap, local dev, iframe, wrong origin, and outside-base-path pages.

- [x] **Step 2: Write failing App runtime tests**

Extend `DesktopWindowBridge` test doubles with:

```ts
openFileInVSCode?: (absolutePath: string) => Promise<void> | void;
showFileInFolder?: (absolutePath: string) => Promise<void> | void;
```

Test the new helper:

```ts
await invokeDesktopFileAction(
  bridge,
  'vscode',
  {
    absolutePath: 'D:/outside/file.ts',
    projectRoot: '',
    relativePath: null,
  },
);
expect(openFileInVSCode).toHaveBeenCalledWith('D:/outside/file.ts');
expect(openProjectFileInVSCode).not.toHaveBeenCalled();
```

Also prove an old Desktop bridge falls back to `openProjectFileInVSCode(projectRoot, relativePath)` for an internal target, while an external target rejects with `Desktop file action is unavailable.` when the absolute binding is missing.

- [x] **Step 3: Run Desktop tests and confirm RED**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(AbsoluteFileActions|BridgeAuthorization|RuntimeFileActionBindings)' -count=1
cd ..\app
npm test -- --runInBand __tests__/web-desktop-runtime.test.ts
```

Expected: FAIL because the absolute actions and bridge methods do not exist.

- [x] **Step 4: Implement common native resolved-file actions**

Add:

```go
func resolveDesktopAbsoluteFilePath(absolutePath string) (string, error)
func openFileInVSCode(absolutePath string) error
func (environment desktopFileActionEnvironment) openFileInVSCode(absolutePath string) error
func showFileInFolder(absolutePath string) error
func (environment desktopFileActionEnvironment) showFileInFolder(absolutePath string) error
```

`resolveDesktopAbsoluteFilePath` must require `filepath.IsAbs`, clean the path, stat it, and require `Mode().IsRegular()`. Extract launch helpers so both new absolute actions and old project-relative actions share VS Code discovery and the final `launch` calls. Preserve the old project's missing-file Explorer fallback; the new absolute Explorer action requires an existing regular file.

- [x] **Step 5: Expose and authorize the absolute bindings**

Add private bindings and trusted-page methods:

```go
desktopOpenFileInVSCodeBinding = "__wheelMakerDesktopOpenFileInVSCode"
desktopShowFileInFolderBinding = "__wheelMakerDesktopShowFileInFolder"
```

```js
openFileInVSCode: invoke('__wheelMakerDesktopOpenFileInVSCode'),
showFileInFolder: invoke('__wheelMakerDesktopShowFileInFolder'),
```

Bind each method in `webview_windows.go`, call `authorize` with its dedicated policy action, and invoke the new environment method. Do not expose either binding in bootstrap or local-dev objects.

- [x] **Step 6: Implement App capability selection**

Add to `DesktopWindowBridge`:

```ts
openFileInVSCode?: (absolutePath: string) => Promise<void> | void;
showFileInFolder?: (absolutePath: string) => Promise<void> | void;
```

Add:

```ts
export type DesktopFileActionTarget = {
  absolutePath: string;
  projectRoot: string;
  relativePath: string | null;
};

export function canInvokeDesktopFileAction(
  bridge: DesktopWindowBridge | null,
  action: DesktopProjectFileAction,
  target: DesktopFileActionTarget,
): boolean

export async function invokeDesktopFileAction(
  bridge: DesktopWindowBridge,
  action: DesktopProjectFileAction,
  target: DesktopFileActionTarget,
): Promise<void>
```

Prefer `openFileInVSCode/showFileInFolder` with `absolutePath`. If the new method is absent and `relativePath`, `projectRoot`, and the matching old project method exist, call the old method. Never send an external absolute path through a project-relative binding. Keep `invokeDesktopProjectFileAction` exported for existing callers and tests.

- [x] **Step 7: Run Desktop suites**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop -count=1
cd ..\app
npm test -- --runInBand __tests__/web-desktop-runtime.test.ts __tests__/web-desktop-titlebar.test.tsx
npm run tsc:web
```

Expected: PASS.

- [x] **Step 8: Commit**

```powershell
git add server/cmd/wheelmaker-desktop/desktop_file_actions_windows.go server/cmd/wheelmaker-desktop/desktop_file_actions_windows_test.go server/cmd/wheelmaker-desktop/desktop_bridge.go server/cmd/wheelmaker-desktop/webview_policy.go server/cmd/wheelmaker-desktop/webview_policy_test.go server/cmd/wheelmaker-desktop/webview_windows.go server/cmd/wheelmaker-desktop/webview_windows_test.go app/web/src/platform/desktop/desktopRuntime.ts app/__tests__/web-desktop-runtime.test.ts
git commit -m "feat(desktop): open absolute files"
```

### Task 8: Add the file-link context menu

**Files:**
- Add: `app/web/src/chat/ChatFileLinkContextMenu.tsx`
- Add: `app/__tests__/web-chat-file-link-context-menu.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [x] **Step 1: Write failing component tests**

Render the component with React Test Renderer. For an internal reference and Desktop capabilities, assert this exact label order:

```ts
import TestRenderer, {act} from 'react-test-renderer';
import {
  ChatFileLinkContextMenu,
  type ChatFileLinkContextMenuProps,
} from '../web/src/chat/ChatFileLinkContextMenu';

function labels(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(node => node.props.role === 'menuitem')
    .map(button => button.findAllByType('span')[1].props.children as string);
}

const internalProps: ChatFileLinkContextMenuProps = {
  x: 24,
  y: 36,
  link: {
    path: 'src/main.ts',
    absolutePath: 'D:/repo/src/main.ts',
    relativePath: 'src/main.ts',
    line: 4,
  },
  canOpenInVSCode: true,
  canShowInFolder: true,
  onAction: jest.fn(),
  onClose: jest.fn(),
};

let renderer!: TestRenderer.ReactTestRenderer;
act(() => {
  renderer = TestRenderer.create(<ChatFileLinkContextMenu {...internalProps} />);
});

expect(labels(renderer)).toEqual([
  'Open with VS Code',
  'Show in File Explorer',
  'Copy relative path',
  'Copy absolute path',
]);
```

For an external reference in a browser, assert:

```ts
expect(labels(renderer)).toEqual(['Copy absolute path']);
```

Invoke each button and assert `onAction` receives one of:

```ts
type ChatFileLinkMenuAction =
  | 'vscode'
  | 'folder'
  | 'copy-relative'
  | 'copy-absolute';
```

Capture registered `pointerdown`, `keydown`, `scroll`, and `resize` listeners. Assert outside pointer, Escape, scroll, and resize call `onClose`, while pointerdown inside the menu does not.

Use an explicit listener registry in the test:

```ts
const listeners = new Map<string, EventListener>();
jest.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
  listeners.set(type, listener as EventListener);
});
jest.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
  if (listeners.get(type) === listener) listeners.delete(type);
});
```

- [x] **Step 2: Run the component test and confirm RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-chat-file-link-context-menu.test.tsx
```

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement the focused menu component**

Use this prop contract:

```ts
export type ChatFileLinkContextMenuProps = {
  x: number;
  y: number;
  link: PreviewFileLink;
  canOpenInVSCode: boolean;
  canShowInFolder: boolean;
  onAction: (action: ChatFileLinkMenuAction) => void;
  onClose: () => void;
};
```

Render a fixed `role="menu"` container and `role="menuitem"` buttons. Use the existing Codicons:

```tsx
<span className="codicon codicon-code" aria-hidden="true" />
<span className="codicon codicon-folder-opened" aria-hidden="true" />
<span className="codicon codicon-copy" aria-hidden="true" />
<span className="codicon codicon-clippy" aria-hidden="true" />
```

Do not add SVG files or icon dependencies. Only render `Copy relative path` when `link.relativePath !== null`. Register and clean up capture-phase outside pointer, Escape, capture-phase scroll, and resize listeners while mounted.

- [x] **Step 4: Style the menu with existing design tokens**

Add `.chat-file-link-context-menu` rules to `chat.css` using:

```css
position: fixed;
z-index: 140;
min-width: 196px;
padding: 4px;
border: 1px solid color-mix(in srgb, var(--border-subtle) 76%, transparent);
border-radius: 7px;
background: var(--surface-panel);
box-shadow: 0 14px 34px rgba(0, 0, 0, 0.3);
```

Match the existing preview menu's 28px rows, 7px icon gap, token colors, hover background, and focus-visible outline.

- [x] **Step 5: Wire right-click state and actions in WorkspaceApp**

Store:

```ts
type ChatFileLinkMenuState = {
  x: number;
  y: number;
  projectId: string;
  projectRoot: string;
  link: PreviewFileLink;
};
```

In the Markdown anchor:

```tsx
onContextMenu={event => {
  if (!targetFile) return;
  event.preventDefault();
  setChatFileLinkMenu({
    x: Math.min(event.clientX, Math.max(8, window.innerWidth - 212)),
    y: Math.min(event.clientY, Math.max(8, window.innerHeight - 140)),
    projectId: linkProjectId,
    projectRoot: linkProjectRoot,
    link: targetFile,
  });
}}
```

The menu action handler must:

- close the menu first;
- copy `relativePath` only for `copy-relative`;
- copy `absolutePath` for `copy-absolute`;
- show `Copied relative path.` or `Copied absolute path.` only after clipboard success;
- use `canInvokeDesktopFileAction` / `invokeDesktopFileAction` for native actions;
- send `{absolutePath, projectRoot, relativePath}` to the Desktop helper;
- display the existing action-specific failure prefixes in the app toast.

Render `ChatFileLinkContextMenu` beside the existing top-level `previewSelectionContextMenu`. Do not add long-press handlers.

- [x] **Step 6: Update Workspace wiring assertions**

Require the new import, `onContextMenu`, menu component, relative-path condition, absolute Desktop target, and top-level render. Keep ordinary click assertions and verify Relay/ordinary links do not open this menu.

- [x] **Step 7: Run menu and chat tests**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-file-link-context-menu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-preview-file-regressions.test.tsx __tests__/web-port-relay-settings.test.ts
npm run tsc:web
```

Expected: PASS.

- [x] **Step 8: Commit**

```powershell
git add app/web/src/chat/ChatFileLinkContextMenu.tsx app/__tests__/web-chat-file-link-context-menu.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat(app): add file link context menu"
```

### Task 9: Reuse absolute actions in the preview menu

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-preview-workbench-state.test.ts`

- [x] **Step 1: Write failing preview action assertions**

Update the preview action test to require:

```ts
expect(actionsBody).toContain('const confirmedPath = resolvePreviewDesktopFilePath(tab);');
expect(actionsBody).toContain('const fileTarget = resolvePreviewFileLink(confirmedPath, projectRoot);');
expect(actionsBody).toContain('canInvokeDesktopFileAction(desktopBridge,');
expect(actionsBody).toContain('invokeDesktopFileAction(desktopBridge, action,');
expect(actionsBody).toContain('<span>Copy absolute path</span>');
```

Add an external ordinary-file state case:

```ts
expect(resolvePreviewDesktopFilePath(filePreviewTab({
  path: 'D:/outside/report.md',
  info: {path: 'D:/outside/report.md', kind: 'file'},
}))).toBe('D:/outside/report.md');
```

Assert `copyChatFilePreviewPath` uses `fileTarget.absolutePath` and does not concatenate `projectRoot` with an already absolute path.

- [x] **Step 2: Run preview tests and confirm RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-preview-workbench-state.test.ts
```

Expected: FAIL because preview actions still invoke only project-relative bindings and construct absolute paths by string concatenation.

- [x] **Step 3: Build one confirmed preview file target**

In `renderPreviewWorkbenchActions`:

```ts
const projectRoot = projects.find(project => project.projectId === tab.projectId)?.path ?? '';
const confirmedPath = resolvePreviewDesktopFilePath(tab);
const fileTarget = confirmedPath
  ? resolvePreviewFileLink(confirmedPath, projectRoot)
  : null;
const desktopTarget = fileTarget
  ? {
      absolutePath: fileTarget.absolutePath,
      projectRoot,
      relativePath: fileTarget.relativePath,
    }
  : null;
```

Use `canInvokeDesktopFileAction` for visibility and `invokeDesktopFileAction` for execution. Internal files can use old bindings as fallback; external files require the new absolute binding.

Change `copyChatFilePreviewPath` to resolve the active file's server-confirmed `info.path` and copy `fileTarget.absolutePath`. Keep the existing preview action labels and order. Do not add `Copy relative path` to the preview overflow menu; that action is specific to the chat-link context menu.

- [x] **Step 4: Run preview and Desktop tests**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-desktop-runtime.test.ts
npm run tsc:web
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-preview-workbench-state.test.ts
git commit -m "refactor(app): share preview file actions"
```

### Task 10: Full verification, rebase, and publish the branch

**Files:**
- Modify: `docs/plans/2026-07-24-external-file-links/plan-external-file-links.md` only to check completed steps and record final verification outcomes.

- [x] **Step 1: Run all focused App tests**

```powershell
cd app
npm test -- --runInBand __tests__/web-preview-file-regressions.test.tsx __tests__/web-external-file-service.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-chat-file-link-context-menu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-disable-file-cache-settings.test.ts __tests__/web-desktop-runtime.test.ts __tests__/web-registry-protocol-domain-service.test.ts __tests__/web-port-relay-settings.test.ts
```

Expected: all suites PASS.

- [x] **Step 2: Run App type-check and production build**

```powershell
npm run tsc:web
npm run build:web
```

Expected: both commands exit 0; build output goes to `~/.wheelmaker/web`, not `app/dist`.

- [x] **Step 3: Run all relevant Go tests**

```powershell
cd ..\server
go test ./internal/protocol ./internal/registry ./internal/hub ./cmd/wheelmaker-desktop
```

Expected: all packages PASS.

- [ ] **Step 4: Perform Desktop and browser smoke checks**

Use one internal link and one external link containing spaces:

```text
[internal](app/package.json:1)
[external](D:/Code/Other Project/report.md:7)
```

Confirm:

1. Both ordinary clicks open preview and jump to the requested line.
2. Internal right-click shows relative and absolute copy actions; external right-click shows only absolute copy.
3. Browser mode shows no VS Code or Explorer actions.
4. Desktop mode opens both targets in VS Code and selects both in Explorer.
5. Escape, outside click, scroll, resize, and action selection close the menu.
6. A normal HTTPS link and a Relay link retain their existing behavior.
7. An old Hub reports `This Hub does not support external file preview.` for only the external link.

- [x] **Step 5: Rebase on the latest remote main and rerun changed-area tests**

```powershell
git fetch origin
git rebase origin/main
cd app
npm test -- --runInBand __tests__/web-preview-file-regressions.test.tsx __tests__/web-external-file-service.test.ts __tests__/web-chat-file-link-context-menu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-desktop-runtime.test.ts
cd ..\server
go test ./internal/protocol ./internal/hub ./cmd/wheelmaker-desktop
```

Expected: rebase completes without semantic conflict and all changed-area tests PASS. If the rebase changes behavior, rerun Steps 1–3.

- [x] **Step 6: Record verification and run the required completion gate**

Mark every completed checkbox in this plan, append the exact successful commands and outcomes under this step, then run from the feature worktree:

```powershell
git add -A
git commit -m "docs: record external file link verification"
git push origin feat/external-file-links
```

Expected: all three commands succeed in this exact order. Report the resulting commit hash and remote branch. Do not claim completion if any command fails.

Verification recorded on 2026-07-24:

- PASS: focused App Jest command, 9 suites and 124 tests.
- PASS: `npm run tsc:web`.
- PASS: `npm run build:web`; webpack rebuilt after worktree cache warnings and exited successfully.
- PASS: `go test ./internal/protocol ./internal/registry ./internal/hub ./cmd/wheelmaker-desktop`.
- PASS after `git fetch origin` and no-op rebase: changed-area App suites, 5 suites and 75 tests; changed-area Go packages.
- PASS after root-path hardening: focused App suites, 9 suites and 124 tests, plus `npm run tsc:web`.
- NOT RUN: interactive Desktop/browser smoke checks in Step 4; no interactive Desktop or authenticated Hub session is available in this environment.

- [x] **Step 7: Follow the configured merge preference**

From the clean main worktree, merge the pushed feature branch without creating a PR, push `main`, and report whether cleanup could be completed. Preserve the feature branch/worktree if any uncommitted change, ambiguous conflict, failed validation, or failed push remains.

Integration result: merged into `main` without conflict and without a PR. The final push and branch/worktree cleanup are reported in the implementation handoff.
