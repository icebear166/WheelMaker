# Chat File Peek Viewer Design

## Goal

When a user clicks a file link inside a chat message, open a contextual code viewer without leaving the chat. The viewer should feel like a quick reference surface: desktop shows it as a right-side third column, and mobile shows it as a full-screen overlay with a back button.

## Confirmed Scope

- Runtime target: `app/web/` only.
- Trigger only from chat message file links resolved by the existing chat markdown link handling.
- Keep the main tab on `chat` when a chat file link is clicked.
- Desktop opens a right-side code peek column; mobile opens a full-screen code viewer overlay.
- Ordinary file browsing remains unchanged:
  - file tree clicks
  - pinned file clicks
  - existing File tab search
  - existing File tab go-to-line
- The peek viewer is read-only.
- The peek viewer has a small toolbar:
  - close on desktop
  - back on mobile
  - current file path/title
  - open current file in the full File tab
- The peek viewer uses global code display settings for font, line height, wrapping, and line numbers.

## Non-Goals

- No editor features in the peek viewer.
- No pinning from the peek viewer.
- No search or go-to-line tools in the peek viewer.
- No replacement of the full File tab.
- No change to normal File tab selected file or scroll memory when a chat file link opens the peek viewer.
- No new persistent workspace schema is required in this phase.

## Desktop Behavior

Clicking a chat file link opens a third column on the right side of the desktop shell.

The left sidebar is not affected:
- If the sidebar is visible, the layout becomes left list, middle chat, right code.
- If the sidebar was collapsed, it stays collapsed and the layout becomes middle chat plus right code.

The right peek column:
- defaults to `520px`
- can be resized by dragging its left edge
- has a minimum width of `360px`
- has an effective maximum of `min(760px, 55vw)`
- must leave at least `420px` for the middle chat column
- remembers the resized width for the current browser session
- closes when the user clicks the close button

When the viewer is already open and the user clicks another chat file link, reuse the existing column. Do not reset the width or replay a disruptive open transition; replace the content and jump directly to the new target.

## Mobile Behavior

Clicking a chat file link opens a full-screen code viewer overlay.

The overlay:
- covers the chat screen
- has a top back button
- closes on the top back button
- closes first when the user triggers browser/system back while it is open
- hides the floating navigation and chat quick switch menu while open
- closes an open drawer before showing the viewer
- closes the mobile Port Relay full-screen frame before showing the viewer

When the mobile viewer is already open and the user clicks another chat file link, reuse the overlay and replace the content.

## File Selection And State Model

The peek viewer uses independent state from the full File tab:
- peek file path
- optional target line
- loaded content
- loading state
- error state
- desktop width

Opening a chat file link must not update the normal File tab `selectedFile`, File tab scroll memory, or File tab preview toggles.

The only intentional bridge to the full File tab is the viewer toolbar action `Open in File tab`. That action:
- switches to the `file` tab
- selects the current peek file in the full File tab
- applies the same immediate line jump behavior
- closes the peek viewer

## Link Targeting

The existing chat file link resolver continues to decide whether a link is a workspace file link and whether it includes a target line.

Supported target line sources remain:
- `path/to/file.ts:42`
- `path/to/file.ts#L42`
- link text with a trailing line number when the href does not include one

If a line is present, the peek viewer stores it as the active target. If no line is present, the viewer opens at the top.

## Direct Jump Behavior

The current smooth scrolling behavior is removed for chat file link jumps.

For source code views:
- assign `scrollTop` synchronously or on the first frame where layout is measurable
- center the target line when possible
- clamp naturally at the top and bottom of the scroll range
- if the exact line DOM node is not available, estimate with configured line height and line number

The same direct jump helper should be reused by:
- chat peek source view
- explicit `Open in File tab`
- any existing File tab path that needs immediate line targeting from a chat link

Normal File tab user tools may keep their existing behavior unless they are part of the explicit chat-link handoff.

## Preview Behavior

Markdown, HTML, and image files automatically enter preview mode inside the peek viewer.

Markdown:
- render with the existing Markdown preview pipeline
- if a target line is present, scroll to the preview element whose source position contains or is nearest to that source line
- briefly highlight the matched preview block
- if no source mapping is available, fall back to a proportional scroll estimate

HTML:
- render with the existing HTML preview iframe model
- if a target line is present, scroll the iframe to the element whose source position contains or is nearest to that source line
- briefly highlight the matched preview element when possible
- if no source mapping is available, fall back to a proportional scroll estimate inside the iframe

Images:
- render with the existing image preview style
- ignore line targets because images have no source line mapping

Other text files:
- render as highlighted source code using the existing Shiki code path
- jump directly to the target line when present

## Error Handling

If reading the target file fails, still open the peek viewer. Show:
- the target path in the title
- a loading-to-error state transition
- a concise file load failure message
- the close/back control

Do not switch to the File tab and do not rely only on a chat-level toast. The user should see exactly which requested file failed to open.

## Architecture And Touch Points

- `app/web/src/main.tsx`
  - replace chat file link click behavior so it opens peek viewer state instead of switching to `file`
  - keep existing file-link parsing behavior
  - add independent peek file loading state
  - add desktop and mobile peek viewer render paths
  - wire `Open in File tab`
  - wire mobile back handling while the overlay is open

- `app/web/src/shell/ResponsiveShell.tsx`
  - extend desktop shell with an optional right-side peek slot
  - extend mobile shell with an optional full-screen overlay slot if keeping overlay outside `main` is cleaner

- `app/web/src/styles.css`
  - add desktop third-column layout styles
  - add resize handle styles
  - add mobile full-screen viewer styles
  - add preview target highlight styles
  - ensure the middle chat column keeps its minimum width while the peek column is visible

- `app/web/src/services/shikiRenderer.ts`
  - reuse existing line number metadata for source-code jump targeting
  - avoid introducing a separate syntax renderer

Optional extraction is allowed if `main.tsx` becomes too dense:
- a small `chatFilePeek` helper for state normalization and target calculation
- a small preview line-mapping helper for Markdown and HTML source positions

## Testing Strategy

Follow the existing test style in `app/__tests__`, which currently includes many source-structure and behavior tests around `main.tsx` and CSS.

Add focused coverage for:
- chat file link click opens peek viewer instead of calling `setTab('file')`
- normal file tree/pinned/file-tab paths are unchanged
- desktop shell supports a third right-side peek slot
- desktop CSS defines the right peek column, resize handle, width limits, and middle chat minimum
- mobile overlay renders above chat and hides floating controls while open
- mobile back handling closes the peek viewer first
- `Open in File tab` explicitly switches to `file`, selects the path, applies immediate target-line jump, and closes the peek viewer
- direct jump code does not use smooth scroll for chat-link jumps
- Markdown/HTML/image files use preview mode in the peek viewer
- load failures render inside the viewer with the target path

Run the existing web validation commands after implementation:
- `npm run tsc:web`
- relevant Jest tests under `app/__tests__`
- a manual desktop/mobile browser check if a local web server is available

## Risks And Mitigations

- Risk: Markdown and HTML preview source-line mapping may be approximate.
  - Mitigation: define success as nearest source element, then fall back to proportional scroll when exact mapping is unavailable.
- Risk: adding a third desktop column could compress chat too far on medium-width screens.
  - Mitigation: enforce the `420px` middle chat minimum and clamp the peek width dynamically.
- Risk: duplicating File tab rendering logic could increase maintenance cost.
  - Mitigation: reuse existing Shiki, Markdown, HTML, and image preview components where practical, while keeping peek state independent.
- Risk: mobile overlay back handling could conflict with existing settings/drawer history behavior.
  - Mitigation: make peek viewer the top-priority mobile back target only while it is open, then delegate to existing handlers.
