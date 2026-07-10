# Responsive File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep file preview responsive while a single file request is pending and while medium or large source files are tokenized and highlighted.

**Architecture:** Keep the existing whole-file Registry response and Promise-based asynchronous loading, while adding client-side cancellation for stale preview work. Replace whole-file Shiki tokenization for expensive inputs with a cancellable 50-line pipeline that carries `grammarState`, renders each completed batch, and yields to the browser between batches; small files retain the current one-shot path.

**Tech Stack:** React 19, TypeScript, Shiki 4, Registry WebSocket client, Jest, webpack

---

## Scope and constraints

- Keep `project.fs.read` as a single content request; do not add range reads, streaming responses, or a server cancellation method.
- Cancellation releases the UI immediately and ignores late responses. It does not stop an already-running Hub filesystem operation.
- Keep the existing RegistryClient generic request timeout unchanged; do not add a Preview-specific deadline.
- Preserve syntax correctness across chunks with Shiki `grammarState`.
- Skip tokenization for pathological long lines with `tokenizeMaxLineLength`, and bound per-line work with `tokenizeTimeLimit`.
- Preserve line numbers, line selection, scrolling, themes, fonts, wrapping, and Markdown fenced-code use of `ShikiCodeBlock`.
- Before implementation, resolve how to handle the 238 pre-existing deleted files shown by `git status`; the repository completion gate uses `git add -A` and must not accidentally commit unrelated changes.

## Planned file responsibilities

- `app/web/src/registry/RegistryClient.ts`: own request abort handling and cleanup of timeout/signal listeners.
- `app/web/src/registry/RegistryRepository.ts`: pass `AbortSignal` through file info/read requests.
- `app/web/src/registry/RegistryWorkspaceService.ts`: expose cancellable project file APIs to the UI.
- `app/web/src/app/WorkspaceApp.tsx`: own active preview load controllers, stale-load cancellation, and abort-safe UI state.
- `app/web/src/code/shikiRenderer.ts`: tokenize source incrementally with grammar continuity and bounded line work.
- `app/web/src/code/ShikiCodeBlock.tsx`: select one-shot versus incremental mode and progressively mount completed highlighted chunks.
- `app/__tests__/web-registry-client-close-policy.test.ts`: verify request cancellation semantics.
- `app/__tests__/web-file-not-modified-cache.test.ts`: verify cancellation is wired through every project-file load path without changing cache negotiation.
- `app/__tests__/web-shiki-incremental-tokenization.test.ts`: verify chunk ordering, grammar continuity, yielding, cancellation, and long-line fallback.
- `app/__tests__/web-code-layout.test.ts`: protect the component-level incremental pipeline wiring.

### Task 1: Make Registry file requests cancellable

**Files:**
- Modify: `app/__tests__/web-registry-client-close-policy.test.ts`
- Modify: `app/web/src/registry/RegistryClient.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`

- [x] **Step 1: Write a failing RegistryClient abort test**

Add a behavioral test that installs a fake open socket, starts a request with a signal, aborts it, and verifies that the promise rejects immediately and the pending entry is removed:

```ts
import {RegistryClient} from '../web/src/registry/RegistryClient';

test('aborting a request rejects it and removes the pending response slot', async () => {
  const send = jest.fn();
  const client = new RegistryClient(8000);
  Object.assign(client as unknown as {ws: unknown}, {
    ws: {readyState: WebSocket.OPEN, send},
  });
  const controller = new AbortController();

  const request = client.request({
    method: 'project.fs.read',
    projectId: 'hub:project',
    payload: {path: 'src/large.ts'},
    signal: controller.signal,
  });
  controller.abort();

  await expect(request).rejects.toMatchObject({name: 'AbortError'});
  expect(send).toHaveBeenCalledTimes(1);
  expect((client as unknown as {pending: Map<number, unknown>}).pending.size).toBe(0);
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-registry-client-close-policy.test.ts
```

Expected: FAIL because `RegistryClient.request` does not accept or observe `signal`.

- [x] **Step 3: Implement abort-safe pending request cleanup**

Extend the request shape and pending entry:

```ts
type PendingRequest = {
  resolve: (value: RegistryEnvelope) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
};

async request(args: {
  method: string;
  payload: unknown;
  projectId?: string;
  hubId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<RegistryEnvelope> {
  if (args.signal?.aborted) {
    throw new DOMException('Registry request aborted', 'AbortError');
  }
  // Existing envelope creation remains unchanged.
}
```

When registering the pending request, add one abort listener that deletes the matching request, clears its timer, removes itself, and rejects with `AbortError`. On timeout, response, `close()`, and socket close, always call `removeAbortListener?.()` before resolving or rejecting. A late response must find no pending entry and be ignored.

- [x] **Step 4: Pass the signal through repository and service APIs**

Use one consistent option shape:

```ts
type RegistryFileRequestOptions = {
  knownHash?: string;
  signal?: AbortSignal;
};
```

Update `RegistryRepository.getFileInfo`, `RegistryRepository.readFile`, `RegistryWorkspaceService.getProjectFileInfo`, and `RegistryWorkspaceService.readProjectFile` so the signal reaches `RegistryClient.request`. Preserve the existing `knownHash` payload exactly; `signal` is local-only and must not be serialized.

- [x] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-registry-client-close-policy.test.ts __tests__/web-registry-client-debug.test.ts __tests__/web-file-not-modified-cache.test.ts
```

Expected: all suites PASS, with debug capture and hash negotiation unchanged.

### Task 2: Cancel stale preview loads without blocking navigation

**Files:**
- Modify: `app/__tests__/web-file-not-modified-cache.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [x] **Step 1: Write failing wiring assertions for load cancellation**

Protect these behaviors in the existing source-structure tests:

```ts
expect(mainTsx).toContain('const fileReadAbortControllerRef = useRef<AbortController | null>(null);');
expect(mainTsx).toContain('fileReadAbortControllerRef.current?.abort();');
expect(mainTsx).toContain('signal: controller.signal');
expect(mainTsx).toContain("if (isAbortError(err))");
```

For chat/Workbench preview, also require controllers keyed by project and tab so main-file reads and different Preview tabs do not cancel each other:

```ts
expect(mainTsx).toContain('const previewFileLoadControllersRef = useRef<Map<string, AbortController>>(new Map());');
```

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-file-not-modified-cache.test.ts __tests__/web-chat-file-peek-viewer.test.ts
```

Expected: FAIL because no abort controllers exist.

- [x] **Step 3: Add load-scoped controllers**

Add refs near the existing file-load state:

```ts
const fileReadAbortControllerRef = useRef<AbortController | null>(null);
const previewFileLoadControllersRef = useRef<Map<string, AbortController>>(new Map());
```

At the start of each main-file load, abort the previous controller and create a new controller before `getProjectFileInfo`. Pass the same signal to both metadata and content requests. In `finally`, only clear the ref when it still points to that controller. Abort caused by a file switch is silent; keep the existing request-sequence checks as defense against stale state writes.

- [x] **Step 4: Apply the same lifecycle to chat and restored Preview tabs**

`readChatFilePeek` and the file branch of `loadRestoredPreviewTab` use the controller map. Reloading or closing the same tab aborts its old load without cancelling independent tabs. Abort errors must not call `failPreviewTabLoad` for a request that is no longer current.

On App unmount, abort both controllers through the normal effect cleanup path.

- [x] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-file-not-modified-cache.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-reconnect-fallback.test.ts
```

Expected: all suites PASS; cache reuse, restored tabs, and stale request IDs remain intact.

### Task 3: Add grammar-correct incremental Shiki tokenization

**Files:**
- Create: `app/__tests__/web-shiki-incremental-tokenization.test.ts`
- Modify: `app/web/src/code/shikiRenderer.ts`

- [x] **Step 1: Write failing tests for chunking and grammar continuity**

Define the desired API through a real Shiki test:

```ts
import {
  tokenizeShikiCode,
  tokenizeShikiCodeInChunks,
} from '../web/src/code/shikiRenderer';

test('tokenizes ordered chunks while preserving grammar state', async () => {
  const content = [
    'const before = 1;',
    '/* comment starts',
    'comment continues */',
    'const after = 2;',
  ].join('\n');
  const chunks: Array<{startLine: number; tokens: unknown[][]}> = [];
  const yieldControl = jest.fn(async () => undefined);

  await tokenizeShikiCodeInChunks(content, 'typescript', 'dark', 'auto-plus', {
    chunkLines: 2,
    yieldControl,
    onChunk: chunk => chunks.push(chunk),
  });

  const whole = await tokenizeShikiCode(content, 'typescript', 'dark', 'auto-plus');
  expect(chunks.map(chunk => chunk.startLine)).toEqual([0, 2]);
  expect(chunks.flatMap(chunk => chunk.tokens)).toEqual(whole.tokens);
  expect(yieldControl).toHaveBeenCalledTimes(1);
});
```

Add a cancellation test that aborts after the first emitted chunk and expects `AbortError`, plus a long-line test that verifies a line longer than 20,000 characters is returned as one plain token rather than fully tokenized.

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-shiki-incremental-tokenization.test.ts
```

Expected: FAIL because `tokenizeShikiCodeInChunks` does not exist.

- [x] **Step 3: Implement the incremental tokenizer**

Add the bounded defaults and callback type:

```ts
const DEFAULT_TOKENIZE_CHUNK_LINES = 50;
const DEFAULT_TOKENIZE_MAX_LINE_LENGTH = 20_000;
const DEFAULT_TOKENIZE_TIME_LIMIT_MS = 20;

export type ShikiTokenChunk = {
  index: number;
  startLine: number;
  tokens: ThemedToken[][];
  fg: string;
  bg: string;
  themeName: string;
  totalLines: number;
};
```

Split the content into line batches. Call `highlighter.codeToTokens` for each batch with the previous result's `grammarState`, `tokenizeMaxLineLength`, and `tokenizeTimeLimit`. Emit one `ShikiTokenChunk`, check `signal.aborted` before and after each expensive call, and await `yieldControl` between batches but not after the last batch.

The default browser yield is:

```ts
const yieldToBrowser = () => new Promise<void>(resolve => {
  window.setTimeout(resolve, 0);
});
```

Use `Promise.resolve()` as the non-browser fallback.

- [x] **Step 4: Bound the existing one-shot renderer too**

Pass the same `tokenizeMaxLineLength` and `tokenizeTimeLimit` values to `codeToHtml`/`codeToTokens` on the small-file path. This prevents a sub-threshold minified single line from consuming the default 500ms line budget.

- [x] **Step 5: Run tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-shiki-incremental-tokenization.test.ts __tests__/web-shiki-blank-line-preservation.test.ts
```

Expected: all suites PASS, including exact token equivalence across a multiline grammar boundary.

### Task 4: Pipeline tokenization, HTML generation, and progressive rendering

**Files:**
- Modify: `app/__tests__/web-code-layout.test.ts`
- Modify: `app/__tests__/web-shiki-code-fallback.test.ts`
- Modify: `app/web/src/code/ShikiCodeBlock.tsx`

- [x] **Step 1: Write failing component pipeline assertions**

Extend the layout test to require incremental tokenization, cancellation, and size-based routing:

```ts
expect(shikiBlock).toContain('tokenizeShikiCodeInChunks');
expect(shikiBlock).toContain('const controller = new AbortController();');
expect(shikiBlock).toContain('renderChunkHtmlFromTokens');
expect(shikiBlock).toContain('controller.abort();');
expect(shikiBlock).toContain('INCREMENTAL_HIGHLIGHT_CHAR_THRESHOLD');
expect(shikiBlock).not.toContain('tokenizeShikiCode(content, language, themeMode, codeTheme)');
```

Add a pure routing assertion for a large single-line input so it cannot fall back to `ShikiCodeBlockSmall` merely because its line count is one.

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-code-layout.test.ts __tests__/web-shiki-code-fallback.test.ts
```

Expected: FAIL because the virtualized component still tokenizes the whole file once and routing only considers line count.

- [x] **Step 3: Route expensive content to the incremental component**

Keep the current small-file component for content below both thresholds:

```ts
const VIRTUALIZE_LINE_THRESHOLD = 2000;
const INCREMENTAL_HIGHLIGHT_CHAR_THRESHOLD = 100_000;

if (
  lineCount >= VIRTUALIZE_LINE_THRESHOLD ||
  props.content.length >= INCREMENTAL_HIGHLIGHT_CHAR_THRESHOLD
) {
  return <ShikiCodeBlockVirtualized {...props} />;
}
```

- [x] **Step 4: Convert the virtualized component into a cancellable pipeline**

Replace the whole-file `tokenizeShikiCode` effect with `tokenizeShikiCodeInChunks`. For each emitted token chunk:

1. Generate that chunk's HTML with `renderChunkHtmlFromTokens`.
2. Store the completed HTML under its chunk index.
3. Render completed chunks only when their placeholder is within the IntersectionObserver margin; otherwise retain the existing fixed-height placeholder.
4. Preserve absolute line offsets for line numbers and selected-line highlighting.

Create one `AbortController` per effect and abort it during cleanup. Treat `AbortError` as normal cancellation; only show `Failed to tokenize file.` for real failures.

- [x] **Step 5: Preserve fallback and interaction behavior**

While the first batch is pending, show the existing readable plain-code fallback for a bounded initial slice rather than a blank `Tokenizing...` panel. Keep gutter-only line clicks, wrapping, fonts, themes, and line-height placeholder calculations unchanged.

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-code-layout.test.ts __tests__/web-shiki-code-fallback.test.ts __tests__/web-markdown-preview-mode.test.ts
```

Expected: all suites PASS and Markdown fenced code continues to use the shared `ShikiCodeBlock` pipeline.

### Task 5: Verify responsiveness and regressions

**Files:**
- Verify only; no new production files expected.

- [x] **Step 1: Run TypeScript checking**

Run:

```powershell
npm run tsc:web
```

Expected: exit code 0.

- [ ] **Step 2: Run the complete App test suite**

Run:

```powershell
npm test -- --runInBand
```

Expected: all suites PASS with no new warnings.

- [x] **Step 3: Build the production Web bundle**

Run:

```powershell
npm run build:web
```

Expected: webpack exits successfully and emits the Web bundle to the configured `~/.wheelmaker/web` target.

- [x] **Step 4: Repeat the measured tokenizer scenario**

Run the 512 KiB TypeScript diagnostic used during investigation. Expected acceptance signal:

- Whole task may take roughly the same total CPU time.
- After highlighter initialization, each 50-line batch stays near 10ms on the same machine rather than one continuous ~1.5s block.
- Aborting after the first chunk prevents later chunks from being emitted.

- [ ] **Step 5: Manually verify Preview behavior**

Open a medium TypeScript file, immediately switch to another file, and confirm:

- Navigation and chat remain responsive while the request is pending.
- The old file never replaces the new file after its response arrives.
- Highlighted chunks appear progressively without blanking the entire pane.
- Multiline comments spanning chunk boundaries keep the correct color.
- A minified long-line file remains responsive and displays readable plain text.

- [ ] **Step 6: Run the repository completion gate**

Only after the pre-existing deletion state is resolved or explicitly authorized, run this exact sequence from the repository root:

```powershell
git add -A
git commit -m "fix(web): keep file preview responsive"
git push origin main
```

Expected: all three commands succeed and the pushed commit contains only the intended preview fix plus explicitly authorized pre-existing changes.
