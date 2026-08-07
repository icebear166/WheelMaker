# Remove File/Git Tabs and Refactor Chat Search Plan

**Goal:** Remove the top-level File and Git workspace surfaces while preserving Preview Workbench file capabilities and backend registry APIs; extract chat search, fix archived-session search and prompt highlighting, and centralize session ordering.

**Scope boundary:** The Preview Workbench file tree, file peek/preview, preview search, prompt artifact preview, unified diff parsing, syntax rendering, and Registry filesystem/Git service contracts stay intact. Only the top-level File/Git navigation, page components, page-specific state/effects, and page-only frontend helpers are removed.

## Task 1: Lock the File/Git removal boundary with tests

1. Add/update source-boundary tests that require a chat-only top-level workspace.
2. Assert that top-level File/Git imports, branches, navigation actions, and page-only modules are absent.
3. Assert that Preview Workbench still renders `FileExplorerTree` and retains preview file open/search/diff code.
4. Assert that Registry filesystem/Git methods and types remain available.
5. Run the focused test and confirm it fails before production changes.

## Task 2: Remove top-level File/Git frontend code

1. Remove File/Git tab values, navigation UI, page branches, sidebar branches, shortcuts, and persisted tab values.
2. Remove File-page state, effects, callbacks, persistence data, and page-only components.
3. Remove Git-page state, effects, callbacks, persistence data, and page-only components/helpers.
4. Remove the Preview action that attempted to jump into the deleted File tab, without changing Preview file selection or rendering.
5. Delete orphaned File/Git page modules and their obsolete tests.
6. Run focused boundary, Preview, persistence, and TypeScript checks.

## Task 3: Extract chat search and fix search behavior

1. Add failing tests for archived-session message source selection and prompt character highlighting.
2. Extract chat-search state/navigation/source selection into a focused chat search module/hook.
3. Feed the controller the active message source (live or archived) instead of always using live messages.
4. Pass the active query through structured prompt text rendering so character-level `<mark>` highlighting is reachable.
5. Run focused chat search and chat turn tests.

## Task 4: Centralize session ordering and merging

1. Add failing tests covering robust timestamp ordering, stable ties, metadata-preserving merge, and list merge behavior.
2. Add one session ordering module backed by the shared timestamp comparator.
3. Replace local WorkspaceApp, chat index, and mobile quick-switch comparators/merge implementations with the shared module.
4. Run focused session index, session ordering, and mobile quick-switch tests.

## Task 5: Verify and deliver

1. Search for removed top-level File/Git references while excluding build output.
2. Run the complete frontend test suite, TypeScript check, and web build.
3. Review the diff for accidental Preview/backend changes.
4. Run the repository completion gate: stage all changes, commit, and push `main`.
