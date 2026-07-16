# Prompt Diff Desktop File Actions Design

## Goal

Let a WheelMaker Desktop user choose a file in the right-side Changed Files diff preview and open that file in Visual Studio Code or reveal it in Windows File Explorer.

## Scope

This feature applies only to `prompt-diff` tabs opened from a completed prompt's Changed Files artifact. The actions appear only when the Workspace Web UI is hosted by WheelMaker Desktop on Windows. Browser and mobile clients do not render unavailable actions.

The implementation does not change the Registry protocol or its version. It extends the existing WheelMaker Desktop native bridge and the existing preview-workbench actions menu.

## Interaction Design

Each prompt-diff tab stores an `activeFilePath` in addition to its list of diff files.

- Opening a specific Changed Files row makes that row's path active.
- Opening the Changed Files summary makes the first diff file active.
- If restored or refreshed metadata no longer contains the active path, the first available file becomes active.
- Clicking a file header inside the diff makes that file active and preserves the existing expand/collapse toggle.
- The active file header has a subtle selected treatment that does not replace the expanded treatment.

For an active prompt-diff tab hosted by WheelMaker Desktop, the existing top-right ellipsis menu adds:

- **Open with VS Code**
- **Show in File Explorer**

Both actions target `activeFilePath`. The actions are omitted if there is no active file or the desktop bridge does not expose the corresponding native methods.

## Web Architecture

`PromptDiffPreviewTab` owns `activeFilePath` so selection remains scoped to its tab and survives switching among preview tabs. Prompt artifact construction and reload logic initialize or preserve the field alongside the existing expanded flags.

The prompt-diff viewer receives the active path and marks the matching file section. Its existing file-header callback continues to toggle expansion and also updates the active path.

The preview-workbench action renderer resolves the active tab's project path from the project collection. It calls the desktop bridge with two separate values:

1. the project root path;
2. the active file's project-relative path.

The web layer does not create a shell command or an external-protocol URL. It closes the actions menu immediately and reports rejected native calls through the existing application error surface.

## Desktop Bridge

The desktop runtime adds two trusted-remote-page bindings and exposes them through `window.WheelMakerDesktop`:

- `openProjectFileInVSCode(projectRoot, relativePath)`
- `showProjectFileInFolder(projectRoot, relativePath)`

The bootstrap page cannot call these bindings. The existing committed-navigation and exact configured Base URL checks remain mandatory for the trusted remote page.

Before launching either fixed executable, native code:

1. requires an absolute project root;
2. cleans the root and relative path with Windows filepath rules;
3. rejects absolute file-path input;
4. rejects empty, `.` and traversal results outside the project root;
5. verifies that the project root is a directory.

Commands are launched directly with argument arrays. No user-controlled value is interpolated into PowerShell, `cmd.exe`, or another shell.

## Native Actions

### Open with VS Code

The target file must exist and must not be a directory. WheelMaker Desktop locates VS Code in this order:

1. `Code.exe` available through PATH;
2. the current user's standard Visual Studio Code installation;
3. the standard 64-bit or 32-bit Program Files installation.

It launches the resolved executable with the target file path. If VS Code or the file is unavailable, the bridge returns a concise error for the web UI.

### Show in File Explorer

If the target file exists, WheelMaker Desktop launches `explorer.exe` with `/select,` and the target path. If the diff represents a deleted file, it opens the nearest existing parent directory, bounded by the validated project root. If no usable parent exists, it returns an error.

## Error Handling

The menu closes after either action is selected. Native validation, executable discovery, and launch errors reject the bridge promise. The web UI catches the rejection and displays an action-specific message without changing the selected file, expanded diff state, or open preview tabs.

No success toast is required because VS Code or File Explorer opening is the visible success signal.

## Testing

Web tests cover:

- prompt-diff tabs initialize and preserve `activeFilePath`;
- clicking a diff file header selects that file while toggling expansion;
- the two menu items are rendered only for a desktop-hosted prompt-diff tab with a resolvable active path;
- each menu action passes project root and relative path separately;
- rejected native calls reach the application error surface.

Go tests cover:

- bootstrap and untrusted pages cannot invoke the new actions;
- trusted committed pages can invoke them;
- absolute relative-path input and traversal outside the project root are rejected;
- missing files fail the VS Code action;
- deleted files reveal an existing parent within the project root;
- VS Code discovery order and direct command arguments;
- File Explorer uses fixed executable and argument values.

Verification includes the focused Jest suites, web TypeScript checking, focused WheelMaker Desktop Go tests, the broader affected test suites, and production builds for the web app and Windows desktop command.

## Out of Scope

- Opening files from ordinary browser or mobile sessions.
- Opening all changed files at once.
- Choosing a different editor.
- Synchronizing remote project files to the desktop machine.
- Adding Registry methods or changing the protocol version.
