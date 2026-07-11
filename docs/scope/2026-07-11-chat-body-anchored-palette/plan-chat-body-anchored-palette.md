# Chat Body Anchored Runtime Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat body content plane the dominant runtime neutral and eliminate the blue-gray split between content, navigation, title bars and composer surfaces.

**Architecture:** Preserve the existing semantic token vocabulary and component structure. Revalue the dark and light `surface-*`, neutral text, border and shadow tokens into graphite families, then make the final Chat overrides use the body-anchored layers for the composer and selected session rows. Blue remains limited to narrow selection markers, primary actions and low-intensity focus feedback.

**Tech Stack:** React, TypeScript, vanilla CSS, Jest, webpack.

---

## Files and responsibilities

- `app/web/src/styles/tokens.css`: defines the dark and light graphite-neutral token ramps; keeps `--surface-workspace-content` as the chat/Preview/Auto-code anchor.
- `app/web/src/styles/chat.css`: controls the final composer focus treatment and session-list selection override without changing dimensions or mobile layout.
- `app/__tests__/web-ui-design-system.test.ts`: locks the body-anchored token values and preserves the semantic-token contract.
- `app/__tests__/web-chat-ui.test.ts`: locks the neutral selected-row background, blue marker and restrained composer focus formula.

### Task 1: Add failing contracts for the body-anchored palette

**Files:**

- Modify: `app/__tests__/web-ui-design-system.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: Write the dark/light graphite token contract.**

  Add a test to `web-ui-design-system.test.ts` that reads `tokens.css` and requires these exact token declarations:

  ```ts
  test('anchors neutral runtime surfaces to the chat body palette', () => {
    const tokens = read('web/src/styles/tokens.css');

    expect(tokens).toContain('--surface-workspace-content: #1e1e1e;');
    expect(tokens).toContain('--surface-canvas: #1b1b1b;');
    expect(tokens).toContain('--surface-sidebar: #202020;');
    expect(tokens).toContain('--surface-panel: #242424;');
    expect(tokens).toContain('--surface-raised: #292929;');
    expect(tokens).toContain('--surface-overlay: #2e2e2e;');
    expect(tokens).toContain('--surface-workspace-content: #ffffff;');
    expect(tokens).toContain('--surface-canvas: #f3f3f3;');
    expect(tokens).toContain('--surface-sidebar: #f7f7f7;');
    expect(tokens).toContain('--surface-panel: #fafafa;');
    expect(tokens).toContain('--surface-raised: #f0f0f0;');
    expect(tokens).toContain('--surface-overlay: #ffffff;');
  });
  ```

- [x] **Step 2: Write the failing Chat selection and focus contracts.**

  Replace the existing semantic selection assertion at the end of `web-chat-ui.test.ts` with contracts for the final override rules:

  ```ts
  expect(stylesCss).toMatch(
    /\.wide-session-row\.selected \{[\s\S]*border-color: color-mix\(in srgb, var\(--border-subtle\) 88%, transparent\);[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 52%, var\(--surface-sidebar\)\);[\s\S]*\}/,
  );
  expect(stylesCss).toMatch(/\.wide-session-row\.selected::before \{[\s\S]*background: var\(--accent-primary\);[\s\S]*\}/);
  expect(stylesCss).toMatch(
    /\.chat-composer:focus-within \.chat-composer-frame \{[\s\S]*border-color: color-mix\(in srgb, var\(--accent-primary\) 36%, var\(--border-subtle\)\);[\s\S]*0 0 0 1px color-mix\(in srgb, var\(--accent-primary\) 6%, transparent\);[\s\S]*\}/,
  );
  ```

- [x] **Step 3: Run the focused contracts and verify they fail.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-ui-design-system.test.ts web-chat-ui.test.ts
  ```

  Expected: FAIL because the current theme still defines cool blue-gray surface tokens, selection uses a blue surface mix, and the composer focus border uses 56% accent.

### Task 2: Revalue the semantic token family around the chat body

**Files:**

- Modify: `app/web/src/styles/tokens.css:1-95`
- Modify: `app/__tests__/web-ui-design-system.test.ts`

- [x] **Step 1: Replace the dark neutral ramp with graphite values.**

  In `:root`, retain the existing accent and state tokens, but set the neutral values exactly as follows:

  ```css
  --surface-canvas: #1b1b1b;
  --surface-workspace-content: #1e1e1e;
  --surface-sidebar: #202020;
  --surface-panel: #242424;
  --surface-raised: #292929;
  --surface-overlay: #2e2e2e;
  --text-primary: #dedede;
  --text-secondary: #a3a3a3;
  --text-tertiary: #787878;
  --border-subtle: #363636;
  --border-strong: #4a4a4a;
  --shadow-floating: 0 8px 24px rgb(0 0 0 / 22%);
  --shadow-overlay: 0 16px 40px rgb(0 0 0 / 34%);
  --chat-message-text: #e0e0e0;
  ```

  Do not alter `--accent-primary`, `--accent-hover`, any `--state-*` value, compatibility aliases, radius tokens or motion tokens.

- [x] **Step 2: Replace the light neutral ramp with equivalent neutral grays.**

  In `.theme-light`, set the non-status neutral values exactly as follows:

  ```css
  --surface-canvas: #f3f3f3;
  --surface-workspace-content: #ffffff;
  --surface-sidebar: #f7f7f7;
  --surface-panel: #fafafa;
  --surface-raised: #f0f0f0;
  --surface-overlay: #ffffff;
  --text-primary: #242424;
  --text-secondary: #6f6f6f;
  --text-tertiary: #8a8a8a;
  --border-subtle: #dedede;
  --border-strong: #c2c2c2;
  --shadow-floating: 0 8px 24px rgb(0 0 0 / 12%);
  --shadow-overlay: 0 16px 40px rgb(0 0 0 / 18%);
  --chat-message-text: #2b2b2b;
  ```

  Keep the blue accent and all state colors untouched so interactive and operational semantics do not change.

- [x] **Step 3: Run the token design-system suite.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-ui-design-system.test.ts
  ```

  Expected: PASS. The Chat/Preview/Auto-code anchor remains `#1e1e1e`, and both themes expose the same semantic family.

- [x] **Step 4: Commit the token-ramp update.**

  ```powershell
  git add app/web/src/styles/tokens.css app/__tests__/web-ui-design-system.test.ts
  git commit -m "style(web): anchor runtime palette to chat body"
  ```

### Task 3: Soften the composer and session-list interaction layers

**Files:**

- Modify: `app/web/src/styles/chat.css:671-673`
- Modify: `app/web/src/styles/chat.css:5000-5007`
- Modify: `app/web/src/styles/chat.css:5169-5195`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: Replace blue-filled generic and wide selected rows with neutral surfaces.**

  Keep hover and row dimensions unchanged. Change both `.item.selected` and `.wide-session-row.selected` to the neutral selection fill below; preserve `.wide-session-row.selected::before` as the only solid blue selection marker:

  ```css
  .item.selected {
    background: color-mix(in srgb, var(--surface-panel) 52%, var(--surface-sidebar));
  }

  .wide-session-row.selected {
    border-color: color-mix(in srgb, var(--border-subtle) 88%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 52%, var(--surface-sidebar));
    color: var(--text-primary);
  }

  .wide-session-row.selected::before {
    background: var(--accent-primary);
  }
  ```

- [x] **Step 2: Reduce the final composer frame’s surface and focus intensity.**

  Edit the final `workspace-ui-targeted-evolution: composer` rules, which override the earlier composer declarations. Keep its dimensions, padding, radius and transition list. Replace only its surface and focus values with:

  ```css
  .chat-composer-frame {
    border: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--surface-panel) 64%, var(--surface-workspace-content));
    box-shadow: 0 4px 14px rgb(0 0 0 / 12%);
  }

  .chat-composer:focus-within .chat-composer-frame {
    border-color: color-mix(in srgb, var(--accent-primary) 36%, var(--border-subtle));
    box-shadow: 0 4px 16px rgb(0 0 0 / 14%), 0 0 0 1px color-mix(in srgb, var(--accent-primary) 6%, transparent);
  }

  .chat-composer.config-menu-open .chat-composer-frame,
  .chat-composer.trigger-menu-open .chat-composer-frame {
    border-color: color-mix(in srgb, var(--accent-primary) 32%, var(--border-subtle));
    box-shadow: 0 8px 22px rgb(0 0 0 / 18%);
  }
  ```

  Do not modify drag-over, send, voice, cancellation or mobile sizing rules; those are active state semantics or established interaction constraints.

- [x] **Step 3: Run Chat and responsive behavior tests.**

  Run:

  ```powershell
  npm --prefix app test -- --runInBand web-chat-ui.test.ts web-responsive-shell.test.ts web-session-search-ui.test.ts web-chat-composer-status.test.ts
  ```

  Expected: PASS. The mobile composer retains its two-row structure, 36px primary controls and `max-width: calc(100vw - 24px)`.

- [x] **Step 4: Commit the interaction-layer refinement.**

  ```powershell
  git add app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
  git commit -m "style(web): soften chat interaction surfaces"
  ```

### Task 4: Verify the unified runtime palette

**Files:**

- Modify: `docs/scope/2026-07-11-chat-body-anchored-palette/plan-chat-body-anchored-palette.md`

- [x] **Step 1: Run the complete automated verification.**

  Run:

  ```powershell
  npm --prefix app run tsc:web
  npm --prefix app test -- --runInBand
  npm --prefix app run build:web
  ```

  Expected: TypeScript exits with code 0, every Jest suite passes, and webpack compiles successfully. The existing bundle-size warning is non-blocking.

- [ ] **Step 2: Inspect the palette in a live workspace.**

  At wide desktop, narrow desktop and portrait mobile widths, check both themes:

  ```text
  1. Chat body and Chat Preview/Auto code share the content anchor.
  2. Session sidebar, title bar, composer, settings and Port Relay use neutral graphite or neutral light-gray layers with no blue-gray cast.
  3. The selected session uses a narrow blue marker over a neutral row.
  4. Composer focus is visible but restrained; no large bright-blue rectangle appears.
  5. File/Git, explicit code themes, HTML preview, QR canvas and state colors remain unchanged.
  ```

- [x] **Step 3: Mark the plan, then commit and push through the repository completion gate.**

  Mark completed checkboxes, then run:

  ```powershell
  git diff --check
  git status --short
  git add -A
  git commit -m "style(web): unify chat-body palette"
  git push origin main
  ```

  Expected: no whitespace errors, a clean worktree after the commit, and all palette commits present on `origin/main`.

## Plan self-review

- Spec coverage: Task 1 locks the specified graphite hierarchy and the visible chat interaction treatment; Task 2 implements the body-anchored token ramps; Task 3 limits CSS changes to selection and composer focus; Task 4 covers automated and live-workspace verification.
- Placeholder scan: the plan contains exact token values, selectors, test assertions and commands; no deferred implementation markers remain.
- Type consistency: every stylesheet continues to use the existing `surface-*`, `text-*`, `border-*` and `accent-*` token names; no new runtime token is introduced.
- Scope: File/Git independent pages, code-content colors, layout, mobile dimensions, icons, routes and state colors are explicitly excluded.

## Execution record

- Completed RED→GREEN contracts for the graphite token ramp, neutral session selection and restrained composer focus.
- Verified TypeScript, all 160 Jest suites (790 tests), and the production Web build.
- Live-workspace visual inspection remains open because this environment only exposes the connection screen; it must be completed in dark/light themes at wide desktop, narrow desktop and portrait mobile sizes.
