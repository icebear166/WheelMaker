# Chat Inline Composer Capsules Design

## Goal

Improve the chat composer so selected skills and `@` file mentions render as inline capsules instead of ordinary text or attachment-preview chips.

The feature keeps the wire protocol unchanged. The agent still receives prompt text and existing `resource_link` content blocks. Capsules are a frontend editing and rendering affordance only.

## Scope

- Replace the chat textarea editing surface with a lightweight local rich composer.
- Represent the composer draft as ordered `text`, `skill`, and `file` tokens.
- Render `skill` and `file` tokens as inline, non-editable capsules in the input area.
- Delete capsules atomically with Backspace or Delete.
- Insert skill capsules from the existing skill picker and from complete, known slash commands.
- Insert file capsules only from the existing file mention picker.
- Serialize the composer into the existing `session.send` payload shape:
  - one prompt `text` string
  - a `blocks` array containing a text block and deduplicated `resource_link` blocks for file capsules
- Render newly sent `prompt_request` messages with the same inline capsule affordance.
- Keep drag, paste, and upload attachments in the existing attachment preview area.
- Stop showing `@` file mentions in the attachment area.
- Persist unsent drafts as composer tokens so file capsule path bindings survive page refresh.

## Non-Goals

- No protocol changes.
- No server-side changes.
- No migration for old prompt history.
- No compatibility handling for old unsent drafts that stored file mentions outside the text.
- No global or continuous scan of chat history.
- No capsule rendering in agent replies, tool output, code blocks, or markdown content.
- No input-area undo or redo support.
- No large editor dependency such as Lexical, Slate, or ProseMirror.
- No automatic conversion of manually typed `@file` text into a file capsule.
- No editing inside a capsule.

## Current Context

The current composer stores `chatComposerText`, uploaded `chatAttachments`, and `chatFileMentions` separately. Selected `@` files are displayed in the attachment-preview row, then sent as `resource_link` blocks.

Slash skills are currently plain text inserted by `insertChatSlashCommandText`. Attachments are uploaded through the existing session attachment flow, and uploaded files/images are rendered as prompt attachments.

The new behavior keeps upload attachments unchanged and moves only selected `@` file mentions into inline composer capsules.

## Token Model

The composer state is an ordered token array:

```ts
type ComposerToken =
  | { type: 'text'; text: string }
  | { type: 'skill'; id: string; command: string; label: string }
  | { type: 'file'; id: string; path: string; name: string; label: string };
```

Rules:

- The token array is the source of truth.
- The `contenteditable` DOM is only the editing surface.
- Adjacent text tokens are merged when practical.
- Skill token `command` stores the slash command, such as `/grill-me`.
- Skill token `label` stores the display label, such as `Grill Me`.
- File token `path` stores the project-relative path used as `resource_link.uri`.
- File token `name` stores the basename or provided result name.
- File token `label` stores the display and prompt reference label after duplicate-name resolution.
- Each non-text token has a stable `id` for rendering and selection behavior.

## Composer Editing Behavior

The editing surface is a local `contenteditable` component. Capsule spans use `contentEditable=false`.

Behavior:

- Enter sends, Shift+Enter inserts a newline, matching current desktop/mobile platform behavior.
- Selecting a skill inserts a skill capsule at the caret and appends a normal space.
- Selecting a file inserts a file capsule at the caret and appends a normal space.
- Clicking a capsule in the input selects the whole capsule.
- Clicking around a capsule positions the caret before or after it.
- Backspace or Delete at a capsule boundary deletes the whole capsule immediately.
- A capsule cannot be edited internally.
- Voice input inserts ordinary text at the current caret position and never creates capsules.
- IME composition does not trigger automatic token conversion. Conversion waits until composition is committed.
- Copying composer content serializes capsules to prompt text:
  - skill capsule -> `/grill-me`
  - file capsule -> `@fix_drop.py` or `@<my file.ts>`
- Pasting text can convert complete known slash-command tokens into skill capsules.
- Pasting text never converts `@file` text into file capsules because there is no reliable path binding.

## Skill Capsules

Skill capsules preserve the existing command semantics:

- Display uses the friendly label, without the leading slash.
- Serialized text uses the original command, including the slash.
- Skill capsules may appear at the start or in the middle of a prompt.
- Manually typed slash commands can become capsules only when they are known skills and form independent tokens.
- Partial slash input remains ordinary text until it resolves to a complete known command.
- Prompt history only checks prompt text for slash command tokens. It does not inspect agent replies.

Skill parsing is event-driven. It runs for the current composer edit or for a rendered prompt message, not as a background scan.

## File Capsules

File capsules are created only by selecting a result from the file mention picker.

Behavior:

- Manually typed `@fix_drop.py` remains ordinary text.
- Display omits the `@` prefix.
- Serialized prompt text includes the `@` prefix.
- If the label contains whitespace, serialized text uses angle brackets: `@<my file.ts>`.
- Clicking a file capsule in the input selects the capsule.
- Clicking a file capsule in sent prompt history opens the file surface and selects/previews the file.
- Deleting a file capsule removes the corresponding pending `resource_link` from serialization.

## Duplicate File Names

File capsule labels are computed within one prompt.

Rules:

- If a basename is unique in the prompt, use the basename.
- If multiple referenced files share a basename, use the shortest unique slash-separated suffix.
- Full paths are never placed in prompt text unless the full project-relative path is the shortest unique suffix.
- The true path remains in `resource_link.uri`.

Example:

```text
app/web/src/chat/fix_drop.py
server/chat/fix_drop.py
```

Prompt labels become:

```text
@web/src/chat/fix_drop.py
@server/chat/fix_drop.py
```

## Serialization

Sending a prompt converts tokens into the existing payload shape.

Example composer:

```text
[Grill Me] in [fix_drop.py] please
```

Serialized prompt:

```ts
{
  text: "/grill-me in @fix_drop.py please",
  blocks: [
    { type: "text", text: "/grill-me in @fix_drop.py please" },
    { type: "resource_link", uri: "app/path/fix_drop.py", name: "fix_drop.py" }
  ]
}
```

Rules:

- The text block contains the complete prompt text.
- File capsules are serialized into the text as `@label` or `@<label with spaces>`.
- `resource_link` blocks are deduplicated by path.
- Repeated references to the same file stay repeated in text but produce one `resource_link`.
- Deduplicated `resource_link` order follows first capsule occurrence.
- Skill capsules do not create content blocks beyond the prompt text block.
- Uploaded attachments continue using the existing upload and attachment block flow.

## Prompt Rendering

Only user prompt messages are enhanced:

- `prompt_request`
- pending local prompt previews that represent `prompt_request`

Rendering does not process agent replies, tool output, code blocks, or generic markdown.

Prompt rendering uses the message's existing `contentBlocks`:

- Extract the prompt text from the text block or prompt text field.
- Extract project file links from `resource_link` blocks.
- Match `@label` and `@<label>` occurrences in prompt text to resource links.
- Render matched occurrences as inline file capsules.
- Render known slash command tokens as inline skill capsules.
- Leave unmatched text unchanged.

This is not a history migration. Old messages that do not contain the new prompt text shape are rendered as ordinary text, except their project-file resource links are not forced into the attachment area.

## Attachment Area

The attachment area keeps its current behavior for uploaded files and images.

Rules:

- Uploaded, pasted, and dragged attachments still appear in the attachment preview area.
- Project file mentions created with `@` do not appear in the attachment preview area.
- Sent prompt attachment chips continue to represent real uploaded attachments.
- Project file mention `resource_link` blocks are excluded from prompt attachment chips.

This preserves the existing "code attachments stay in the attachment area" behavior while making `@` file mentions read as inline references.

## Draft Persistence

Unsent composer drafts persist token arrays instead of only a text string plus separate file mentions.

Rules:

- Draft persistence stores `text`, `skill`, and `file` tokens.
- Uploaded attachment drafts continue through the existing attachment draft mechanism.
- Old draft compatibility is not required.
- Sent session messages still store only the existing prompt protocol data.

## Implementation Plan Shape

The implementation should be split into small units:

- `chatComposerTokens`: token normalization, insertion, deletion, labels, and serialization.
- `ChatRichComposer`: local `contenteditable` UI for token editing.
- `WorkspaceApp` wiring: draft state, menus, voice input, attachments, and sending.
- `ChatTurnView` prompt rendering: inline prompt capsules and attachment filtering.

The design intentionally avoids adding a third-party rich editor package.

## Testing

Add focused tests for:

- Token serialization to prompt text and `resource_link` blocks.
- Duplicate basename shortest-unique-suffix labels.
- Whitespace labels using `@<...>` syntax.
- Repeated file references deduplicating `resource_link` blocks.
- Skill insertion and known slash command tokenization.
- Manual `@file` text staying ordinary text.
- `@` file mentions being excluded from prompt attachment chips.
- Uploaded attachments still rendering in the attachment area.
- Prompt request rendering from new-format text plus `resource_link` blocks.
- Composer key handling for capsule deletion.
- IME composition not triggering automatic conversion.

Verification commands:

```bash
npm test
npm run tsc:web
```

