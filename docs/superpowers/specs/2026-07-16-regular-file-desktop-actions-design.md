# Regular File Desktop Actions Design

## Goal

Add the existing desktop file actions to ordinary source-file preview tabs. A user viewing a normal file in the preview workbench can open that file in VS Code or reveal it in File Explorer without leaving WheelMaker.

## Scope

- Add `Open with VS Code` and `Show in File Explorer` to `file` preview tabs.
- Keep the existing `Copy absolute path`, `Open in File tab`, and `Rebuild file index` actions.
- Preserve the existing Prompt Diff actions and behavior.
- Do not add desktop file actions to attachment or port-relay tabs.
- Do not change the desktop bridge protocol or its native path validation.

## Interaction

For an ordinary file preview tab, the actions menu is ordered as follows:

1. `Open with VS Code`
2. `Show in File Explorer`
3. `Copy absolute path`
4. `Open in File tab`
5. `Rebuild file index`

The first two actions are shown only when all required runtime data is available: the project has a root path, the ordinary file has finished loading, the server has returned its canonical `tab.info.path`, and the native desktop bridge exposes the corresponding action. While `info` is unavailable, including loading and error states, both desktop actions are hidden. Browser-only sessions therefore retain their current menu.

## Architecture and Data Flow

`renderPreviewWorkbenchActions` will derive one project-relative file path for desktop actions:

- `file` tab: use the server-returned canonical `tab.info.path` after `safeJoin` has confirmed and normalized it; never use the raw `tab.path` for a desktop action.
- `prompt-diff` tab: use the resolved active diff file path.
- other tab types: use no desktop-action path.

The menu will use this derived path with the existing `invokeDesktopProjectFileAction` helper and `WheelMakerDesktop` bridge. The native layer continues to resolve the path against the selected project's root and reject paths outside that root.

The existing Prompt Diff-specific variable and handler names will become generic project-file action names so the shared behavior is explicit and future changes cannot accidentally update only one tab type.

## Error Handling

The menu closes before invoking a desktop action. Native or bridge errors are caught and displayed through the existing toast messages:

- `Failed to open file in VS Code: <reason>`
- `Failed to show file in File Explorer: <reason>`

Missing bridge capabilities do not produce disabled or nonfunctional entries; the unavailable action is omitted.

## Testing

Extend the existing preview-workbench action regression test to verify:

- A loaded `file` tab supplies its server-returned canonical `tab.info.path` to the shared desktop action path.
- A raw file path containing an internal `..` segment is not passed to the desktop bridge.
- A file tab without `info`, including loading and error states, hides both desktop actions.
- A Prompt Diff tab still supplies its resolved active file path.
- Both VS Code and File Explorer menu actions use the shared availability checks and handler.
- Existing ordinary-file actions remain present.
- Attachment and port-relay tabs do not gain these project-file actions through path derivation.

Run the focused Jest suite first, followed by the complete Web test suite, Web TypeScript checking, the production Web build, and `git diff --check`.
