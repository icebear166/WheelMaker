# File Mention Index Implementation Plan

**Goal:** Add the first version of project file mentions: manual project index rebuilds from Settings > Update, fast indexed fuzzy search, and chat composer `@` selection that sends project-relative file links to the agent.

**Architecture:** Hub owns the on-disk index at `~/.wheelmaker/db/ext/<safe-project-name>/file-index.txt` and exposes Registry methods for status, rebuild, and search. Web keeps the UI state thin: Update polls rebuild status, chat debounces `@` queries, and selected files become `resource_link` content blocks with project-relative URIs. The Hub client resolves those relative links to safe absolute `file://` URIs before agent prompting.

## Task 1: Hub Index Model

- Extend Registry method descriptors with `fs.index.status`, `fs.index.rebuild`, and `fs.index.search`.
- Add a Hub file index manager that:
  - writes one relative file path per line,
  - uses `git ls-files --cached --others --exclude-standard` when possible,
  - falls back to `WalkDir` without recursing symlink directories,
  - keeps the previous index searchable during rebuild,
  - deduplicates concurrent rebuilds per project,
  - supports fuzzy searches with `github.com/sahilm/fuzzy`,
  - uses query-session narrowing for incremental queries.
- Add Hub tests for method routing, atomic index file path, ignored file exclusion, fuzzy filename/path results, and concurrent rebuild state.

## Task 2: Prompt File Links

- Normalize `resource_link` blocks with no URI scheme in `client.HandleSessionRequest`.
- Validate relative paths against the current project root with existing safe path rules.
- Convert valid project files to absolute `file://` URIs before `PromptToSession`.
- Preserve existing uploaded attachment validation for attachment `file://` blocks.

## Task 3: Web Services And Update UI

- Add typed repository/workspace methods for index status, rebuild, and search.
- Extend Settings > Update hub cards with a Project fold:
  - summary shows project count and indexed count,
  - each row shows project path/status and a Scan button,
  - Scan All runs with UI concurrency 2,
  - status polling runs while any scan is active.
- Add focused source tests for service method names and Update UI structure.

## Task 4: Chat Composer Mentions

- Add composer draft state for file mention chips.
- Detect `@` at token start, debounce indexed search, and render keyboard-selectable candidates.
- Remove the trigger token on selection, dedupe by path, show filename chips with full path hover, and send selected files as `resource_link` blocks.
- Keep prompt history rendering through existing resource-link attachment chip support.

## Verification

- Run focused Go tests under `server/internal/hub` and `server/internal/protocol`.
- Run focused Web Jest tests for Update, chat UI, and repository/service changes.
- Run broader `go test ./...` or the largest practical subset if focused tests pass and time permits.
