# File Icon Startup Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Seti file icon theme data and font out of the Chat startup bundle while preserving File tab icon behavior after the File tab is opened.

**Architecture:** Extract Seti-specific imports, theme parsing, icon resolution, and font-face CSS into one dedicated `file/fileIcons.ts` module loaded only through a coarse `file-icons` dynamic import. `main.tsx` keeps a lightweight fallback file icon resolver until the module loads, and the shared shell only injects the Seti font style when that module is available. This is intentionally smaller than a full FileFeature extraction and only isolates static File resources that currently tax Chat startup.

**Tech Stack:** React 19, TypeScript, webpack 5 dynamic imports, Jest source-structure tests, production asset report.

---

## Scope

This plan moves only Seti file icon resources out of the initial entry. It does not extract File tree state, Git diff state, Port Relay, iframe surfaces, or Settings polling from `main.tsx`.

## Files

- Create: `app/__tests__/web-file-icon-startup-boundary.test.ts`
  - Source-level regression tests for the lazy `file-icons` boundary.
- Create: `app/web/src/file/fileIcons.ts`
  - Owns Seti theme imports, Seti font import, icon theme types, `resolveSetiIcon`, and `setiFontFaceCss`.
- Modify: `app/web/src/main.tsx`
  - Remove top-level Seti resource imports and Seti resolver implementation.
  - Add a cached `file-icons` dynamic import and a fallback icon resolver for File tab rendering.
  - Load file icon resources only when `tab === 'file'`.
- Modify: `app/web/src/shell/ResponsiveShell.tsx`
  - Make `setiFontCss` optional and inject the style tag only when present.

## Task 1: Write File Icon Startup Boundary Tests

**Files:**
- Create: `app/__tests__/web-file-icon-startup-boundary.test.ts`

- [ ] **Step 1: Add the source-structure test file**

Create `app/__tests__/web-file-icon-startup-boundary.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    : '';
}

describe('web file icon startup boundary', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsxPath = path.join(projectRoot, 'web', 'src', 'main.tsx');
  const fileIconsPath = path.join(projectRoot, 'web', 'src', 'file', 'fileIcons.ts');

  test('keeps Seti resources out of the chat startup module', () => {
    const mainTsx = readSourceText(mainTsxPath);

    expect(mainTsx).not.toContain('@codingame/monaco-vscode-theme-seti-default-extension');
    expect(mainTsx).not.toContain('setiThemeJson');
    expect(mainTsx).not.toContain('setiFontUrl');
    expect(mainTsx).toMatch(
      /import\(\s*\/\* webpackChunkName: "file-icons" \*\/\s*'\.\/file\/fileIcons'\s*\)/,
    );
    expect(mainTsx).toContain("if (tab !== 'file'");
    expect(mainTsx).toContain('const [fileIconResources, setFileIconResources]');
    expect(mainTsx).toContain('fileIconResources?.setiFontCss() ??');
  });

  test('loads Seti icon resolution from a dedicated lazy module', () => {
    const fileIconsTs = readSourceText(fileIconsPath);

    expect(fs.existsSync(fileIconsPath)).toBe(true);
    expect(fileIconsTs).toContain(
      "import setiThemeJson from '@codingame/monaco-vscode-theme-seti-default-extension/resources/vs-seti-icon-theme.json';",
    );
    expect(fileIconsTs).toContain(
      "import setiFontUrl from '@codingame/monaco-vscode-theme-seti-default-extension/resources/seti.woff';",
    );
    expect(fileIconsTs).toContain("export type FileIconThemeMode = 'dark' | 'light';");
    expect(fileIconsTs).toContain('export function resolveSetiIcon');
    expect(fileIconsTs).toContain('export function setiFontFaceCss');
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `app/`:

```powershell
npm test -- --runTestsByPath __tests__/web-file-icon-startup-boundary.test.ts
```

Expected: FAIL because `main.tsx` still imports Seti resources directly and `file/fileIcons.ts` does not exist.

## Task 2: Implement the File Icon Lazy Boundary

**Files:**
- Create: `app/web/src/file/fileIcons.ts`
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/shell/ResponsiveShell.tsx`

- [ ] **Step 1: Create the file icon module**

Create `app/web/src/file/fileIcons.ts` with the Seti imports, types, resolver, and font CSS:

```ts
import setiThemeJson from '@codingame/monaco-vscode-theme-seti-default-extension/resources/vs-seti-icon-theme.json';
import setiFontUrl from '@codingame/monaco-vscode-theme-seti-default-extension/resources/seti.woff';

export type FileIconThemeMode = 'dark' | 'light';

type SetiThemeSection = {
  file: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
};

type SetiIconDefinition = {
  fontCharacter?: string;
  fontColor?: string;
};

type SetiTheme = {
  iconDefinitions: Record<string, SetiIconDefinition>;
  file: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  light?: SetiThemeSection;
};

export type FileResolvedIcon = {
  glyph: string;
  color: string;
};

const setiTheme = setiThemeJson as SetiTheme;

function toSetiGlyph(fontCharacter?: string): string {
  if (!fontCharacter) return '?';
  const hex = fontCharacter.replace('\\', '');
  const code = Number.parseInt(hex, 16);
  if (Number.isNaN(code)) return '?';
  return String.fromCodePoint(code);
}

export function resolveSetiIcon(name: string, mode: FileIconThemeMode): FileResolvedIcon {
  const section: SetiThemeSection =
    mode === 'light' && setiTheme.light
      ? {
          file: setiTheme.light.file,
          fileExtensions: setiTheme.light.fileExtensions,
          fileNames: setiTheme.light.fileNames,
        }
      : {
          file: setiTheme.file,
          fileExtensions: setiTheme.fileExtensions,
          fileNames: setiTheme.fileNames,
        };

  const lowerName = name.toLowerCase();
  let iconId = section.file;

  if (section.fileNames?.[lowerName]) {
    iconId = section.fileNames[lowerName];
  } else if (section.fileExtensions) {
    const parts = lowerName.split('.');
    for (let i = 0; i < parts.length; i += 1) {
      const candidate = parts.slice(i).join('.');
      if (section.fileExtensions[candidate]) {
        iconId = section.fileExtensions[candidate];
        break;
      }
    }
  }

  const definition =
    setiTheme.iconDefinitions[iconId] ??
    setiTheme.iconDefinitions[section.file] ??
    {};
  return {
    glyph: toSetiGlyph(definition.fontCharacter),
    color: definition.fontColor ?? '#d4d7d6',
  };
}

export function setiFontFaceCss(): string {
  return `@font-face { font-family: 'wm-seti'; src: url('${setiFontUrl}') format('woff'); font-weight: normal; font-style: normal; }`;
}
```

- [ ] **Step 2: Add a cached dynamic import to `main.tsx`**

Remove these top-level imports from `app/web/src/main.tsx`:

```ts
import setiThemeJson from '@codingame/monaco-vscode-theme-seti-default-extension/resources/vs-seti-icon-theme.json';
import setiFontUrl from '@codingame/monaco-vscode-theme-seti-default-extension/resources/seti.woff';
```

Add lightweight file icon types and loader near the other constants:

```ts
type FileResolvedIcon = {
  glyph: string;
  color: string;
};

type FileIconResources = {
  resolveSetiIcon: (name: string, mode: ThemeMode) => FileResolvedIcon;
  setiFontCss: () => string;
};

const FALLBACK_FILE_ICON: FileResolvedIcon = {glyph: '?', color: '#d4d7d6'};
let fileIconResourcesPromise: Promise<FileIconResources> | null = null;

const loadFileIconResources = () => {
  if (!fileIconResourcesPromise) {
    fileIconResourcesPromise = import(/* webpackChunkName: "file-icons" */ './file/fileIcons').then(module => ({
      resolveSetiIcon: module.resolveSetiIcon,
      setiFontCss: module.setiFontFaceCss,
    }));
  }
  return fileIconResourcesPromise;
};
```

- [ ] **Step 3: Remove Seti implementation from `main.tsx`**

Delete the `SetiThemeSection`, `SetiIconDefinition`, `SetiTheme`, and `SetiResolvedIcon` type definitions from `main.tsx`.

Delete:

```ts
const setiTheme = setiThemeJson as SetiTheme;
```

Delete the `toSetiGlyph`, `resolveSetiIcon`, and `setiFontFaceCss` functions from `main.tsx`.

- [ ] **Step 4: Load file icons only for the File tab**

Inside `App`, replace:

```ts
  const setiFontCss = useMemo(() => setiFontFaceCss(), []);
  const resolveFileIcon = (name: string) => resolveSetiIcon(name, themeMode);
```

with:

```ts
  const [fileIconResources, setFileIconResources] = useState<FileIconResources | null>(null);

  useEffect(() => {
    if (tab !== 'file' || fileIconResources) {
      return;
    }
    let cancelled = false;
    loadFileIconResources()
      .then(resources => {
        if (!cancelled) {
          setFileIconResources(resources);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab, fileIconResources]);

  const setiFontCss = useMemo(
    () => fileIconResources?.setiFontCss() ?? '',
    [fileIconResources],
  );
  const resolveFileIcon = useCallback(
    (name: string) => fileIconResources?.resolveSetiIcon(name, themeMode) ?? FALLBACK_FILE_ICON,
    [fileIconResources, themeMode],
  );
```

- [ ] **Step 5: Avoid empty shell style tags**

In `app/web/src/shell/ResponsiveShell.tsx`, change:

```ts
  setiFontCss: string;
```

to:

```ts
  setiFontCss?: string;
```

Replace each shell-level:

```tsx
<style>{setiFontCss}</style>
```

with:

```tsx
{setiFontCss ? <style>{setiFontCss}</style> : null}
```

In `app/web/src/main.tsx`, replace the connection page style tag:

```tsx
<style>{setiFontCss}</style>
```

with:

```tsx
{setiFontCss ? <style>{setiFontCss}</style> : null}
```

- [ ] **Step 6: Run focused tests**

Run from `app/`:

```powershell
npm test -- --runTestsByPath __tests__/web-file-icon-startup-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run TypeScript**

Run from `app/`:

```powershell
npm run tsc:web
```

Expected: PASS.

## Task 3: Verify Production Asset Shape

**Files:**
- No intended source modifications.

- [ ] **Step 1: Build the web app**

Run from `app/`:

```powershell
npm run build:web
```

Expected: PASS.

- [ ] **Step 2: Report web assets**

Run from `app/`:

```powershell
npm run report:web-assets
```

Expected:

- `~/.wheelmaker/web/index.html` still has one initial `bundle.*.js`.
- `~/.wheelmaker/web/index.html` does not include `runtime.*.js` or `vendors.*.js`.
- A `file-icons.*.js` async chunk exists.
- Seti font is no longer referenced from `main.tsx`.

- [ ] **Step 3: Commit**

Run from repo root:

```powershell
git add -A
git commit -m "Move file icon resources out of chat startup"
git push origin main
```

## Final Verification Before Completion

Run from `app/`:

```powershell
npm run tsc:web
npm test -- --runTestsByPath __tests__/web-file-icon-startup-boundary.test.ts
npm run build:web
npm run report:web-assets
```

Run from repo root:

```powershell
git status --short
```

Expected final state:

- all focused checks pass
- `file-icons.*.js` is async, not an initial script
- no uncommitted files
- commit is pushed to `origin main`
