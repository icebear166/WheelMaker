# Chat Title Preview Toggle Design

## Context

The chat screen already has a right-side preview surface for file content, prompt diffs, attachment previews, and Port Relay web pages. On desktop this renders as `chat-preview-pane`; on mobile it renders as `chat-preview-mobile-overlay`.

The current desktop chat title bar uses a plain `CHAT - <session>` label, while mobile already uses a breadcrumb-style title. The requested change is to make the chat title bar consistent across desktop and mobile, with a fixed preview expand/collapse button on the right.

## Goals

- Use a consistent chat title layout on desktop and mobile.
- Show the current chat context on the left side of the title bar.
- Add a right-side preview toggle button to the chat title bar.
- Let the preview panel open even when no preview content has been selected.
- Preserve the existing preview close/back controls.
- Avoid persisting the preview expanded/collapsed state.

## Non-Goals

- Do not replace the existing preview rendering pipeline.
- Do not redesign the desktop shell layout.
- Do not remove the preview pane's own close/back controls.
- Do not persist an empty preview pane across reloads.
- Do not change file, diff, attachment, or Port Relay preview content behavior beyond the empty state.

## UX

The chat title bar becomes:

- Left: breadcrumb-style chat context using the existing project/session title concept.
- Right: a single preview toggle button.

On desktop, the left title should align conceptually with the current mobile breadcrumb rather than the current uppercase `CHAT - <session>` text. On mobile, the existing breadcrumb remains the model and gains the same right-side preview toggle.

The preview toggle behavior is:

- When the preview is hidden, clicking the button shows the preview surface.
- When the preview is visible, clicking the button hides the preview surface.
- Hiding the preview does not clear the current file, diff, attachment, or web page preview.
- The preview surface's internal Close/Back control remains available and continues to clear or close the current preview content according to existing behavior.
- If there is no current preview content, clicking the title-bar button opens an empty preview surface.

The empty preview surface should not look like a broken render. It should use the same preview chrome as real preview content:

- Title: `Preview`
- Body: `No preview selected`
- Optional icon: a small preview/sidebar-style codicon.

The preview toggle should expose clear accessible text:

- Hidden state: tooltip and aria label `Show preview`
- Visible state: tooltip and aria label `Hide preview`

The icon can use the closest available codicon for a right-side preview/sidebar. If there is no exact "off" icon, use the same icon with the tooltip/pressed state carrying the meaning.

## State Model

Reuse the existing `chatPreviewOpen` concept as the expansion state for the preview surface. Do not add persistence for manual expand/collapse.

The preview content sources remain the existing state:

- Prompt artifact diff preview
- Attachment preview
- File peek preview
- Port Relay chat preview

When `chatPreviewOpen` is true and none of those content states is active, render the empty preview surface.

## Desktop Behavior

Desktop continues to render the preview as the optional third column in `DesktopShell` via `desktopPeek`.

The title-bar toggle opens or hides `chat-preview-pane`. The existing resize handle and preview width behavior remain unchanged. Existing fixed chat width behavior should continue to work with the preview pane.

## Mobile Behavior

Mobile continues to render preview content as `chat-preview-mobile-overlay`.

The title-bar toggle opens or hides the mobile overlay. The overlay hides the floating controls as it does today. Empty preview uses the same mobile overlay and same empty state copy.

## Implementation Notes

- Replace the desktop chat title's `CHAT - <session>` rendering with the same breadcrumb title concept already used on mobile.
- Add a title-bar action container on the right side of the chat block title.
- Add a preview toggle button that changes `chatPreviewOpen` without clearing preview content.
- Add an empty preview viewer/surface that uses the same `chat-preview-toolbar`, `chat-preview-title`, and scroll/body conventions as existing preview viewers.
- Keep preview Close/Back handlers wired to the existing clear/close behavior.
- Add focused tests for:
  - Desktop chat title uses breadcrumb context.
  - The chat title renders a preview toggle.
  - The toggle can open preview with no active content.
  - Empty preview renders `Preview` and `No preview selected`.
  - Existing preview close/back controls are still present.

## Open Decisions

All product decisions from the design discussion are resolved. The exact codicon name may be selected during implementation based on what the current icon set supports.
