# File Mention Index Design

## Goal

Add file mentions to the chat composer. A user can type `@`, search project files, select one or more files, and send them to the agent as `resource_link` content blocks.

The first version focuses on manual indexing, fast indexed search, and stable prompt semantics. It does not implement automatic or periodic re-indexing.

## Scope

- Build a project file index on demand from Settings > Update.
- Store the index under WheelMaker local DB storage.
- Search the current chat project's indexed files from the composer.
- Render selected files as composer chips above the textarea.
- Send selected files through existing `blocks` as `resource_link`.
- Preserve selected file chips in the current session composer draft.
- Render sent file mentions in prompt history.

## Non-Goals

- No stale index detection from `gitRev`, `worktreeRev`, or `projectRev`.
- No automatic, periodic, or startup indexing.
- No persistent secondary search index in the first version.
- No inline chips inside the textarea.
- No directory selection. Directory path segments participate in matching, but results are files.
- No cross-project mentions.
- No mobile-specific full-screen picker.

## Index Storage

Each project index is a plain text file:

```text
~/.wheelmaker/db/ext/<safe-project-name>/file-index.txt
```

The safe project name uses the same path-segment sanitizing policy as existing session history storage. Project names are expected to be unique within a Hub, matching the existing project-name-based storage model.

The index format is intentionally minimal:

```text
app/web/src/main.tsx
server/internal/hub/reporter.go
docs/registry-protocol.md
```

Rules:

- One project-relative path per line.
- Slash-separated paths.
- No `./` prefix.
- No blank lines.
- Files only.
- Sorted case-insensitively.
- Deduplicated.
- No metadata header.

Index status is derived from the text file and in-memory task state:

- `indexed`: whether `file-index.txt` exists.
- `count`: number of non-empty path lines.
- `updatedAt`: file mtime.
- `scanning` and `error`: current Hub process memory state.

## Index Rebuild

Rebuild is manual. The Update page triggers it for one project or all projects under a Hub.

For Git projects, scanning uses:

```bash
git ls-files --cached --others --exclude-standard
```

This delegates `.gitignore`, `.git/info/exclude`, and global ignore rules to Git.

If Git is unavailable or the project is not a Git repository, scanning falls back to `WalkDir` and skips common generated directories such as `.git`, `node_modules`, and build output directories. The fallback does not implement a full `.gitignore` parser.

Symlink policy:

- Do not recurse into directory symlinks.
- File symlinks may appear as file paths.
- Sending a symlink path follows the normal project-root file validation described below.

Rebuild behavior:

- Only one rebuild can run for a project at a time.
- Different projects can rebuild concurrently.
- `Scan All` limits concurrency to 2 projects.
- A successful scan writes a temp file and atomically replaces `file-index.txt`.
- A failed scan does not replace the old index file.
- After successful replacement, the Hub refreshes the in-memory index and clears query sessions for that project.
- During scanning, composer search continues using the old in-memory or on-disk index if one exists.

## Registry Methods

### `fs.index.status`

Hub-scoped status query. It avoids Registry-side fan-out across project IDs.

Request:

```json
{
  "method": "fs.index.status",
  "payload": {
    "hubId": "local-hub"
  }
}
```

Response:

```json
{
  "hubId": "local-hub",
  "projects": [
    {
      "projectId": "local-hub:WheelMaker",
      "name": "WheelMaker",
      "path": "D:/Code/WheelMaker",
      "indexed": true,
      "count": 12345,
      "scanning": false,
      "updatedAt": "2026-06-03T10:00:00Z",
      "error": ""
    }
  ]
}
```

### `fs.index.rebuild`

Project-scoped rebuild trigger.

Request:

```json
{
  "method": "fs.index.rebuild",
  "projectId": "local-hub:WheelMaker",
  "payload": {}
}
```

Response:

```json
{
  "projectId": "local-hub:WheelMaker",
  "name": "WheelMaker",
  "scanning": true
}
```

The request starts a background task. The UI polls `fs.index.status` for the owning Hub until the project is no longer scanning.

### `fs.index.search`

Project-scoped indexed search for composer mentions.

Request:

```json
{
  "method": "fs.index.search",
  "projectId": "local-hub:WheelMaker",
  "payload": {
    "querySessionId": "mention-abc",
    "queryId": 12,
    "query": "mi",
    "limit": 20
  }
}
```

Response:

```json
{
  "indexed": true,
  "querySessionId": "mention-abc",
  "queryId": 12,
  "results": [
    {
      "path": "app/web/src/main.tsx",
      "name": "main.tsx",
      "score": 123
    }
  ]
}
```

Routing:

- `fs.index.search`: project-scoped `fs.*`, local read allowed.
- `fs.index.rebuild`: project-scoped `fs.*`, local read allowed. It writes WheelMaker cache only.
- `fs.index.status`: Hub-scoped, routed to the target Hub by `hubId`.

## Search

Search runs in the Hub. The Web app does not download the full index.

The first query for a project loads `file-index.txt` and builds an in-memory searchable structure. The persisted file stays minimal.

The matcher is `github.com/sahilm/fuzzy`.

Result rules:

- The UI limit is 20.
- Candidate rows display the full relative file path.
- No highlight positions are returned in the first version.
- Empty query after `@` returns 20 default candidates.
- Default candidates are ranked by lightweight path heuristics, not by file order alone.

Query sessions:

- The Web app creates a `querySessionId` for one active `@...` interaction.
- Each request also carries a monotonically increasing `queryId`.
- Responses echo both fields.
- The Web app accepts only the newest query result for the current mention interaction.
- The Hub stores a per-project, per-session working set with 30 seconds idle TTL.
- Prefix expansion such as `m` to `mi` narrows the previous working set.
- The working set cap is 5000 paths.
- The Hub can fall back to a full in-memory scan when the query is not a prefix expansion, the working set is empty, or a longer query needs a completeness refresh.
- Successful index rebuild clears query sessions for that project.

## Composer UX

Trigger rules:

- `@` triggers only at the start of the current token: line start or after whitespace.
- Spaces end the mention query.
- `Esc`, outside click, project/session switch, or selecting a file closes the menu.
- The file mention menu is mutually exclusive with the slash skill menu.
- File mention handling has priority while the `@` menu is open.

Selection behavior:

- Selecting a candidate removes the trigger token from the textarea.
- The selected file appears as a chip above the textarea.
- Chips show only the file name.
- Chip hover/title shows the full relative path.
- Duplicate paths are ignored.
- There is no hard limit on the number of file chips.
- Chips are saved in the current session composer draft.

Keyboard behavior:

- `ArrowDown` and `ArrowUp` move through candidates.
- `Enter` selects the active candidate.
- `Tab` selects the active candidate.
- `Esc` closes the menu.
- If the menu has no active candidate, `Enter` keeps the existing send behavior.

Empty states:

- Indexed but no matches: `No files found`.
- Missing index: `File index not built`.
- Search error: `File search failed`.
- Request in flight: `Searching...`.

Mobile:

- The first version uses the same menu with responsive width and max height.
- No separate mobile sheet is included.

## Prompt Blocks

The send payload keeps using existing `blocks`. No new `fileMentions` field is added.

Project file mentions are represented as relative-path `resource_link` blocks:

```json
[
  {
    "type": "text",
    "text": "Look at this error"
  },
  {
    "type": "resource_link",
    "uri": "app/web/src/main.tsx",
    "name": "main.tsx"
  }
]
```

The server interprets a `resource_link.uri` with no scheme as a project-relative file mention:

1. Normalize and resolve the path against the target project's root.
2. Reject paths that escape the project root.
3. Reject missing paths and directories.
4. Convert the block to `file://<absolute-path>` before prompting the agent.

The server does not require the path to exist in `file-index.txt`. The index is a search source, not a send whitelist.

Uploaded attachments keep the existing `file://...` `resource_link` validation path.

## Prompt History

Sent file mentions remain visible in the prompt history. Existing prompt attachment/resource-link rendering should be reused where possible.

Display:

- User text renders normally.
- Mentioned files render as chips below the prompt.
- Chip label is the file name.
- Chip title is the relative path.

Opening a mentioned file from history is not required in the first version.

## Update Page

Settings > Update keeps the current Hub card structure. Each Hub card gains a Project fold alongside the existing NPM fold.

Header:

```text
Projects - N projects - M indexed
```

Expanded rows:

- Project name.
- Short path.
- Index status.
- `Scan` button.

Header action:

- `Scan All` scans online projects under that Hub with concurrency 2.

Status labels:

- `Not scanned`
- `Scanning...`
- `Indexed N files`
- `Scan failed`

The Update page polls `fs.index.status(hubId)` only while scans are running. The normal Refresh action also reloads file index status.

## Testing

Server tests should cover:

- Git scanner uses `git ls-files --cached --others --exclude-standard`.
- Fallback scanner skips generated directories and directory symlinks.
- Index file is sorted, deduplicated, and slash-normalized.
- Failed scan keeps the previous index.
- Status derives count and mtime from `file-index.txt`.
- Same-project rebuild deduplication.
- `fs.index.search` returns top 20 and echoes query IDs.
- Query session narrowing and TTL behavior.
- Relative `resource_link` conversion to file URI.
- Relative `resource_link` rejects path escape, missing path, and directory.
- Uploaded attachment `file://` behavior remains unchanged.

Web tests should cover:

- Update page renders Project fold under each Hub card.
- Scan and Scan All call the expected registry methods.
- Status polling starts while scanning and stops when scanning finishes.
- Composer opens `@` menu only for token-start triggers.
- Search requests include query session and query ID.
- Stale search responses are ignored.
- Candidate selection removes the trigger token and adds a file chip.
- File chips are deduplicated and persisted in drafts.
- Sending includes text and `resource_link` blocks.
- Sent prompt history renders file mention chips.
