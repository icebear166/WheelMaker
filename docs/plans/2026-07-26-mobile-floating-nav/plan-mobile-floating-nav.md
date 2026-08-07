# Mobile Floating Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the mobile floating control into a single docked nav control (collapsed icon button → frosted icon menu card), merge Port Relay into it, and ship the session-list small iteration (relaxed density, dead class cleanup, project sheet Resume entry).

**Architecture:** New presentational `MobileFloatingNav` component + pure `mobileFloatingNavModel` module under `app/web/src/shell/layouts/mobile/`; WorkspaceApp keeps gesture/drag state machines but cleans them (450ms unified threshold, local drag state, dead code removal); relay target picking reuses the `mobile-project-sheet` bottom-sheet language; styles rewritten in `shell.css` on motion tokens.

**Tech Stack:** React 18 + TypeScript, jest + react-test-renderer, plain CSS with design tokens.

**Spec:** [`spec-mobile-floating-nav.md`](../../scope/2026-07-26-mobile-floating-nav.md) (same directory)

**Working directory for all commands:** `app/` inside this worktree (e.g. `cd D:\Code\WheelMaker\.worktree\mobile-floating-nav\app`). Test runner: `npx jest <pattern>`; type check: `npm run tsc:web`.

**Locked design constants** (used across tasks, defined in Task 3):

| Constant | Value | Meaning |
|---|---|---|
| `FLOATING_NAV_BUTTON_SIZE_PX` | 48 | collapsed button size |
| `FLOATING_NAV_ITEM_SIZE_PX` | 44 | menu card item size |
| `FLOATING_NAV_CARD_PADDING_PX` | 4 | card padding |
| `FLOATING_NAV_CARD_HEIGHT_PX` | 6×44 + 2×4 = 272 | card height (content-driven in CSS, mirrored by constant) |
| `FLOATING_NAV_EXPANDED_OVERFLOW_PX` | 272 − 48 = 224 | top reserve so the card never clips |
| `GESTURE_MOVE_LONG_PRESS_MS` | 450 (was 1000) | unified long-press threshold |

Menu card item order (top → bottom, fixed): Preview(`eye`), Terminal(`terminal`), Relay(`radioTower`), Monitor(`activity`), Settings(`settings`), Chat(`messageCircle`). Chat sits at the bottom, adjacent to the collapsed button position; the card expands upward (`bottom: 0` anchored). All icons already exist in `app/web/src/common/Icon.tsx` — no new glyphs needed.

---

### Task 1: Unify long-press threshold to 450ms

**Files:**
- Modify: `web/src/shell/layouts/mobile/gestureNavigation.ts`
- Test: `__tests__/web-gesture-navigation.test.ts`

- [ ] **Step 1: Update the failing test first**

In `__tests__/web-gesture-navigation.test.ts`, replace the two threshold tests:

```ts
  test('uses click movement cancellation and 450ms drag threshold', () => {
    expect(GESTURE_CLICK_CANCEL_PX).toBe(12);
    expect(GESTURE_MOVE_LONG_PRESS_MS).toBe(450);
  });
```

and rename `'enters gesture movement after a one second hold'` → `'enters gesture movement after a 450ms hold'` (body unchanged).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web-gesture-navigation -t "450ms"`
Expected: FAIL — `Expected: 450, Received: 1000`

- [ ] **Step 3: Change the constant**

In `web/src/shell/layouts/mobile/gestureNavigation.ts`:

```ts
export const GESTURE_CLICK_CANCEL_PX = 12;
export const GESTURE_MOVE_LONG_PRESS_MS = 450;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web-gesture-navigation -t "threshold"`
Expected: PASS (the source-text assertion tests in this file still reference the old design; they are rewritten in Task 5 — leave failures there untouched for now, but this file must fully pass after Task 5).

- [ ] **Step 5: Commit**

```bash
git add app/web/src/shell/layouts/mobile/gestureNavigation.ts app/__tests__/web-gesture-navigation.test.ts
git commit -m "feat: unify floating nav long-press threshold to 450ms"
```

---

### Task 2: Reserve expansion headroom in dock bounds

**Files:**
- Modify: `web/src/shell/layouts/mobile/floatingControls.ts`
- Test: `__tests__/web-responsive-ui-state.test.ts`

- [ ] **Step 1: Write the failing tests**

In `__tests__/web-responsive-ui-state.test.ts`, find the `describe` block covering `resolveFloatingControlDefaultBounds` (around line 80) and add:

```ts
    test('reserves expanded overflow above the docked control', () => {
      const withoutOverflow = resolveFloatingControlDefaultBounds({
        viewportHeight: 800,
        stackHeight: 48,
        safeAreaTopInset: 20,
        safeAreaBottomInset: 0,
        defaultComposerTop: null,
      });
      const withOverflow = resolveFloatingControlDefaultBounds({
        viewportHeight: 800,
        stackHeight: 48,
        safeAreaTopInset: 20,
        safeAreaBottomInset: 0,
        defaultComposerTop: null,
        expandedOverflowPx: 224,
      });
      expect(withOverflow.minTop).toBe(withoutOverflow.minTop + 224);
      expect(withOverflow.maxTop).toBe(withoutOverflow.maxTop);
    });

    test('never lets a negative overflow shrink the minimum top', () => {
      const bounds = resolveFloatingControlDefaultBounds({
        viewportHeight: 800,
        stackHeight: 48,
        safeAreaTopInset: 20,
        safeAreaBottomInset: 0,
        defaultComposerTop: null,
        expandedOverflowPx: -10,
      });
      expect(bounds.minTop).toBe(26);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest web-responsive-ui-state -t "overflow"`
Expected: FAIL — `expandedOverflowPx` is not a known property / minTop unchanged.

- [ ] **Step 3: Implement**

In `web/src/shell/layouts/mobile/floatingControls.ts`, change `resolveFloatingControlDefaultBounds`:

```ts
export function resolveFloatingControlDefaultBounds({
  viewportHeight,
  stackHeight,
  safeAreaTopInset,
  safeAreaBottomInset,
  defaultComposerTop,
  composerGap = FLOATING_CONTROL_COMPOSER_GAP_PX,
  expandedOverflowPx = 0,
}: {
  viewportHeight: number;
  stackHeight: number;
  safeAreaTopInset: number;
  safeAreaBottomInset: number;
  defaultComposerTop: number | null;
  composerGap?: number;
  /** Extra headroom above the collapsed control reserved for its expanded card. */
  expandedOverflowPx?: number;
}): FloatingControlVerticalBounds {
  const minTop = Math.max(safeAreaTopInset + 6, 6) + Math.max(0, expandedOverflowPx);
  const bottomInset = Math.max(safeAreaBottomInset + 6, 6);
  const viewportMaxTop = viewportHeight - stackHeight - bottomInset;
  const composerMaxTop = defaultComposerTop === null
    ? viewportMaxTop
    : defaultComposerTop - stackHeight - composerGap;
  return {
    minTop,
    maxTop: Math.max(minTop, Math.min(viewportMaxTop, composerMaxTop)),
  };
}
```

`resolveFloatingControlAvoidanceBounds` needs no change — it already inherits `defaultBounds.minTop`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest web-responsive-ui-state`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add app/web/src/shell/layouts/mobile/floatingControls.ts app/__tests__/web-responsive-ui-state.test.ts
git commit -m "feat: reserve expanded card headroom in floating dock bounds"
```

---

### Task 3: Floating nav model (pure logic)

**Files:**
- Create: `web/src/shell/layouts/mobile/mobileFloatingNavModel.ts`
- Test: `__tests__/web-mobile-floating-nav.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `__tests__/web-mobile-floating-nav.test.tsx`:

```tsx
import {
  FLOATING_NAV_CARD_HEIGHT_PX,
  FLOATING_NAV_EXPANDED_OVERFLOW_PX,
  FLOATING_NAV_ITEMS,
  resolveFloatingNavCurrent,
  resolveFloatingNavRelayState,
} from '../web/src/shell/layouts/mobile/mobileFloatingNavModel';

describe('mobile floating nav model', () => {
  test('lists destinations in fixed order with lucide icons', () => {
    expect(FLOATING_NAV_ITEMS.map(item => item.id)).toEqual([
      'preview', 'terminal', 'relay', 'monitor', 'settings', 'chat',
    ]);
    expect(FLOATING_NAV_ITEMS.map(item => item.icon)).toEqual([
      'eye', 'terminal', 'radioTower', 'activity', 'settings', 'messageCircle',
    ]);
  });

  test('card geometry reserves overflow above the collapsed button', () => {
    expect(FLOATING_NAV_CARD_HEIGHT_PX).toBe(272);
    expect(FLOATING_NAV_EXPANDED_OVERFLOW_PX).toBe(224);
  });

  test('resolves the current surface by priority', () => {
    const all = {relayFrameOpen: false, settingsOpen: false, usageOpen: false, terminalOpen: false, previewOpen: false};
    expect(resolveFloatingNavCurrent(all)).toBe('chat');
    expect(resolveFloatingNavCurrent({...all, previewOpen: true})).toBe('preview');
    expect(resolveFloatingNavCurrent({...all, previewOpen: true, terminalOpen: true})).toBe('terminal');
    expect(resolveFloatingNavCurrent({...all, terminalOpen: true, usageOpen: true})).toBe('monitor');
    expect(resolveFloatingNavCurrent({...all, usageOpen: true, settingsOpen: true})).toBe('settings');
    expect(resolveFloatingNavCurrent({...all, settingsOpen: true, relayFrameOpen: true})).toBe('relay');
  });

  test('relay item mirrors bubble visibility and target availability', () => {
    expect(resolveFloatingNavRelayState({ready: false, frameUrl: 'http://x', hasTarget: true, frameOpen: false}))
      .toEqual({visible: false, frameOpen: false, enabled: true, active: false});
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: '', hasTarget: true, frameOpen: false}).visible).toBe(false);
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: 'http://x', hasTarget: false, frameOpen: false}))
      .toEqual({visible: true, frameOpen: false, enabled: false, active: false});
    expect(resolveFloatingNavRelayState({ready: true, frameUrl: 'http://x', hasTarget: true, frameOpen: true}))
      .toEqual({visible: true, frameOpen: true, enabled: true, active: true});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web-mobile-floating-nav`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the model**

Create `web/src/shell/layouts/mobile/mobileFloatingNavModel.ts`:

```ts
import type {IconName} from '../../../common/Icon';

export type FloatingNavDestination =
  | 'preview'
  | 'terminal'
  | 'relay'
  | 'monitor'
  | 'settings'
  | 'chat';

export type FloatingNavItem = {
  id: FloatingNavDestination;
  icon: IconName;
  label: string;
};

// Fixed top-to-bottom order inside the expanded card. Chat stays at the
// bottom, adjacent to where the collapsed button rests.
export const FLOATING_NAV_ITEMS: ReadonlyArray<FloatingNavItem> = [
  {id: 'preview', icon: 'eye', label: 'Preview'},
  {id: 'terminal', icon: 'terminal', label: 'Terminal'},
  {id: 'relay', icon: 'radioTower', label: 'Relay'},
  {id: 'monitor', icon: 'activity', label: 'Monitor'},
  {id: 'settings', icon: 'settings', label: 'Settings'},
  {id: 'chat', icon: 'messageCircle', label: 'Chat'},
];

export const FLOATING_NAV_BUTTON_SIZE_PX = 48;
export const FLOATING_NAV_ITEM_SIZE_PX = 44;
export const FLOATING_NAV_CARD_PADDING_PX = 4;
export const FLOATING_NAV_CARD_HEIGHT_PX =
  FLOATING_NAV_ITEMS.length * FLOATING_NAV_ITEM_SIZE_PX + FLOATING_NAV_CARD_PADDING_PX * 2;
export const FLOATING_NAV_EXPANDED_OVERFLOW_PX =
  FLOATING_NAV_CARD_HEIGHT_PX - FLOATING_NAV_BUTTON_SIZE_PX;

export type FloatingNavSurfaceFlags = {
  relayFrameOpen: boolean;
  settingsOpen: boolean;
  usageOpen: boolean;
  terminalOpen: boolean;
  previewOpen: boolean;
};

export function resolveFloatingNavCurrent(flags: FloatingNavSurfaceFlags): FloatingNavDestination {
  if (flags.relayFrameOpen) return 'relay';
  if (flags.settingsOpen) return 'settings';
  if (flags.usageOpen) return 'monitor';
  if (flags.terminalOpen) return 'terminal';
  if (flags.previewOpen) return 'preview';
  return 'chat';
}

export type FloatingNavRelayState = {
  /** Mirrors the legacy bubble: only shown when the relay is up with a frame URL. */
  visible: boolean;
  frameOpen: boolean;
  /** Tappable: a target exists or the frame is already open (tap closes it). */
  enabled: boolean;
  active: boolean;
};

export function resolveFloatingNavRelayState({
  ready,
  frameUrl,
  hasTarget,
  frameOpen,
}: {
  ready: boolean;
  frameUrl: string;
  hasTarget: boolean;
  frameOpen: boolean;
}): FloatingNavRelayState {
  return {
    visible: ready && frameUrl !== '',
    frameOpen,
    enabled: hasTarget || frameOpen,
    active: frameOpen,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web-mobile-floating-nav`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/shell/layouts/mobile/mobileFloatingNavModel.ts app/__tests__/web-mobile-floating-nav.test.tsx
git commit -m "feat: add floating nav model with surface and relay resolvers"
```

---

### Task 4: MobileFloatingNav component

**Files:**
- Create: `web/src/shell/layouts/mobile/MobileFloatingNav.tsx`
- Test: `__tests__/web-mobile-floating-nav.test.tsx` (append)

- [ ] **Step 1: Append failing component tests**

Append to `__tests__/web-mobile-floating-nav.test.tsx`:

```tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {MobileFloatingNav} from '../web/src/shell/layouts/mobile/MobileFloatingNav';

const relayOff = {visible: false, frameOpen: false, enabled: false, active: false};
const relayOn = {visible: true, frameOpen: false, enabled: true, active: false};

function renderNav(extra?: Partial<React.ComponentProps<typeof MobileFloatingNav>>) {
  const props: React.ComponentProps<typeof MobileFloatingNav> = {
    expanded: false,
    current: 'chat',
    previewActive: false,
    terminalActive: false,
    monitorActive: false,
    chatUnread: false,
    relay: relayOff,
    onSelect: jest.fn(),
    onCurrentSelect: jest.fn(),
    onButtonPointerDown: jest.fn(),
    ...extra,
  };
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<MobileFloatingNav {...props} />);
  });
  return {tree: tree!, props};
}

describe('MobileFloatingNav', () => {
  test('collapsed shows the current surface icon and optional unread dot', () => {
    const {tree} = renderNav({current: 'terminal', chatUnread: true});
    const button = tree.root.findByProps({className: 'floating-nav-button'});
    expect(button.findByType('svg').props['data-icon-name']).toBe('terminal');
    expect(button.findAllByProps({className: 'floating-nav-unread-dot'})).toHaveLength(1);
  });

  test('expanded renders one card item per destination, hiding relay when not visible', () => {
    const {tree} = renderNav({expanded: true});
    const items = tree.root.findAllByProps({className: 'floating-nav-card-item'});
    expect(items).toHaveLength(5);
    const withRelay = renderNav({expanded: true, relay: relayOn});
    expect(withRelay.tree.root.findAllByProps({className: 'floating-nav-card-item'})).toHaveLength(6);
  });

  test('relay item is disabled without a target and shows a status dot', () => {
    const {tree} = renderNav({expanded: true, relay: {visible: true, frameOpen: false, enabled: false, active: false}});
    const relayItem = tree.root.findByProps({title: 'Relay'});
    expect(relayItem.props.disabled).toBe(true);
    expect(relayItem.findAllByProps({className: 'floating-nav-relay-dot'})).toHaveLength(1);
  });

  test('selecting a destination forwards the callback; current item closes', () => {
    const onSelect = jest.fn();
    const onCurrentSelect = jest.fn();
    const {tree} = renderNav({expanded: true, current: 'chat', onSelect, onCurrentSelect});
    act(() => {
      tree.root.findByProps({title: 'Terminal'}).props.onClick();
    });
    expect(onSelect).toHaveBeenCalledWith('terminal');
    act(() => {
      tree.root.findByProps({title: 'Close navigation'}).props.onClick();
    });
    expect(onCurrentSelect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web-mobile-floating-nav`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `web/src/shell/layouts/mobile/MobileFloatingNav.tsx`:

```tsx
import React from 'react';
import {Icon} from '../../../common/Icon';
import {
  FLOATING_NAV_ITEMS,
  type FloatingNavDestination,
  type FloatingNavRelayState,
} from './mobileFloatingNavModel';

export type MobileFloatingNavProps = {
  expanded: boolean;
  current: FloatingNavDestination;
  previewActive: boolean;
  terminalActive: boolean;
  monitorActive: boolean;
  chatUnread: boolean;
  relay: FloatingNavRelayState;
  onSelect: (destination: FloatingNavDestination) => void;
  onCurrentSelect: () => void;
  onButtonPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
};

export function MobileFloatingNav({
  expanded,
  current,
  previewActive,
  terminalActive,
  monitorActive,
  chatUnread,
  relay,
  onSelect,
  onCurrentSelect,
  onButtonPointerDown,
}: MobileFloatingNavProps) {
  if (!expanded) {
    const currentItem = FLOATING_NAV_ITEMS.find(item => item.id === current)
      ?? FLOATING_NAV_ITEMS[FLOATING_NAV_ITEMS.length - 1];
    return (
      <button
        type="button"
        className="floating-nav-button"
        data-current={current}
        onPointerDown={onButtonPointerDown}
        onClick={onCurrentSelect}
        title="Open navigation"
        aria-label="Open navigation"
        aria-haspopup="menu"
        aria-expanded={false}
      >
        <Icon name={currentItem.icon} size={20} />
        {chatUnread ? <span className="floating-nav-unread-dot" aria-hidden="true" /> : null}
      </button>
    );
  }
  return (
    <div
      className="floating-nav-card"
      role="menu"
      aria-label="Navigate"
      onPointerDown={onButtonPointerDown}
    >
      {FLOATING_NAV_ITEMS.map(item => {
        if (item.id === 'relay' && !relay.visible) {
          return null;
        }
        const isCurrent = item.id === current;
        const active = item.id === 'preview'
          ? previewActive
          : item.id === 'terminal'
            ? terminalActive
            : item.id === 'monitor'
              ? monitorActive
              : item.id === 'relay'
                ? relay.active
                : isCurrent;
        const disabled = item.id === 'relay' && !relay.enabled;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="floating-nav-card-item"
            data-active={active}
            disabled={disabled}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => {
              if (isCurrent) {
                onCurrentSelect();
                return;
              }
              onSelect(item.id);
            }}
            title={isCurrent ? 'Close navigation' : item.label}
            aria-label={isCurrent ? 'Close navigation' : item.label}
            aria-pressed={active}
          >
            <Icon name={item.icon} size={20} />
            {item.id === 'chat' && chatUnread ? (
              <span className="floating-nav-unread-dot" aria-hidden="true" />
            ) : null}
            {item.id === 'relay' ? (
              <span className="floating-nav-relay-dot" data-on={relay.active} aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web-mobile-floating-nav`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/shell/layouts/mobile/MobileFloatingNav.tsx app/__tests__/web-mobile-floating-nav.test.tsx
git commit -m "feat: add MobileFloatingNav collapsed button and icon menu card"
```

---

### Task 5: Rewrite floating nav styles

**Files:**
- Modify: `web/src/styles/shell.css` (replace the floating-control section, lines ~364-647; remove the `.gesture-nav-button` override at ~1586 and the idle rule at ~1562-1570)
- Modify: `web/src/styles/portRelay.css` (remove `.port-relay-floating-bubble` and `.port-relay-target-switch-*` rules)
- Test: `__tests__/web-gesture-navigation.test.ts` (rewrite style/structure assertions)

- [ ] **Step 1: Rewrite the failing source-text tests**

In `__tests__/web-gesture-navigation.test.ts`, delete these tests entirely (they pin the old design): `'wires gesture navigation as the only mobile floating controls scheme'`, `'styles gesture navigation as a collapsed pill and expanded vertical capsules'`, `'shows preview capsule state and respects reduced motion'`, `'keeps chat centered between preview and settings when the gesture pill expands'`. Keep the persistence test, the threshold tests, and `'suppresses chat click expansion after movement cancellation'` / `'does not restart the gesture press when the expanded chat button is clicked'` (updated in Task 6). Add:

```ts
  test('renders the floating nav through the MobileFloatingNav component', () => {
    const main = readMain();

    expect(main).toContain("from '../shell/layouts/mobile/MobileFloatingNav';");
    expect(main).toContain('<MobileFloatingNav');
    expect(main).not.toContain('className="gesture-nav-control"');
    expect(main).not.toContain('className="gesture-nav-pill"');
    expect(main).not.toContain('gesture-nav-capsule');
    expect(main).not.toContain('<PortRelayFloatingButton');
    expect(main).not.toContain('codicon-comment-discussion');
    expect(main).not.toContain('codicon-layout-sidebar-right');
    expect(main).not.toContain('codicon-settings-gear');
    expect(main).not.toContain('codicon-radio-tower');
    expect(main).not.toContain('data-idle=');
    expect(main).not.toContain('floatingControlsIdle');
  });

  test('styles the floating nav button and card on motion tokens', () => {
    const styles = readStyles();

    expect(styles).toContain('.floating-nav-button');
    expect(styles).toContain('.floating-nav-card');
    expect(styles).toContain('.floating-nav-card-item');
    expect(styles).toContain('.floating-nav-unread-dot');
    expect(styles).toContain('.floating-nav-relay-dot');
    expect(styles).not.toContain('.gesture-nav-pill');
    expect(styles).not.toContain('.gesture-nav-capsule');
    expect(styles).not.toContain('.port-relay-floating-bubble');
    expect(styles).not.toContain('.port-relay-target-switch-menu');
    expect(styles).not.toContain("data-idle='true'");
    // No stray hardcoded durations inside the floating nav rules.
    const navSection = styles.match(/\.floating-nav-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(navSection).toContain('var(--motion-');
    expect(navSection).not.toMatch(/\d+ms/);
    // Expanded card uses the frosted overlay material; collapsed stays light.
    const cardBlock = styles.match(/\.floating-nav-card \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(cardBlock).toContain('blur(12px) saturate(1.1)');
    expect(cardBlock).toContain('var(--shadow-overlay)');
    // Reduced motion covers the card entrance.
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.floating-nav-card[\s\S]*animation: none;[\s\S]*\}/,
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest web-gesture-navigation`
Expected: FAIL on the two new tests.

- [ ] **Step 3: Rewrite the CSS**

In `web/src/styles/shell.css`:

1. Delete `.gesture-nav-pill` block, `.gesture-nav-control` blocks (incl. `[data-expanded]` variants), `.gesture-nav-button` blocks (incl. hover/focus-visible/current/capsule variants), `@keyframes gesture-capsule-fade-in`, `.drawer-toggle-bubble` blocks (both, incl. hover/active/data-active), and the old `.floating-nav-unread-dot` block. **Keep** `.floating-control-stack-layer`, `.floating-control-drag-backdrop`, `.floating-control-dock-rail`, `.floating-control-stack` blocks, but in `.floating-control-stack` replace the transition with token-based values:

```css
.floating-control-stack {
  position: absolute;
  z-index: 1;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  transition: top var(--motion-standard) var(--ease-standard),
    transform var(--motion-standard) var(--ease-standard),
    filter var(--motion-standard) var(--ease-standard);
}

.floating-control-stack[data-drag-state='dragging'] {
  transform: scale(1.06);
  filter: drop-shadow(0 14px 30px rgba(0, 0, 0, 0.28));
  transition: top 0ms linear,
    transform var(--motion-fast) var(--ease-standard),
    filter var(--motion-standard) var(--ease-standard);
}
```

(Remove the `gap: 8px` — single child now; remove the `drag-ready`/`gesture-open` transition overrides and the `opacity` transitions.)

2. Also tokenize the backdrop/rail transitions: in `.floating-control-drag-backdrop` and `.floating-control-dock-rail` replace `160ms ease` with `var(--motion-fast) var(--ease-standard)`; in the `data-side-pulse` rule replace `animation: floatingDockRailPulse 160ms ease-out` with `animation: floatingDockRailPulse var(--motion-fast) var(--ease-out)`.

3. Add the new nav styles (place after `.floating-control-stack` rules):

```css
.floating-nav-button {
  position: relative;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-panel) 38%, transparent);
  backdrop-filter: blur(6px) saturate(1.1);
  -webkit-backdrop-filter: blur(6px) saturate(1.1);
  box-shadow: 0 4px 14px rgb(0 0 0 / 10%);
  color: var(--text-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-standard) var(--ease-standard),
    border-color var(--motion-standard) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.floating-nav-button:active {
  transform: scale(0.96);
}

.floating-nav-card {
  position: absolute;
  bottom: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px;
  border: 1px solid var(--border-faint);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  box-shadow: var(--shadow-overlay);
  animation: floating-nav-card-in var(--motion-standard) var(--ease-out);
}

.floating-control-stack[data-side='left'] .floating-nav-card {
  right: auto;
  left: 0;
}

@keyframes floating-nav-card-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.floating-nav-card-item {
  position: relative;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.floating-nav-card-item:hover {
  background: var(--hover);
  color: var(--text-primary);
}

.floating-nav-card-item[data-active='true'] {
  background: var(--accent-soft-bg);
  color: color-mix(in srgb, var(--accent-primary) 88%, var(--text-primary));
}

.floating-nav-card-item:disabled {
  opacity: 0.35;
  cursor: default;
}

.floating-nav-unread-dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--state-success);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--surface-panel) 78%, transparent),
    0 0 10px color-mix(in srgb, var(--state-success) 34%, transparent);
  pointer-events: none;
}

.floating-nav-relay-dot {
  position: absolute;
  bottom: 7px;
  right: 7px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--text-tertiary);
  pointer-events: none;
}

.floating-nav-relay-dot[data-on='true'] {
  background: var(--state-success);
  box-shadow: 0 0 8px color-mix(in srgb, var(--state-success) 40%, transparent);
}
```

4. Delete the idle rule (`.floating-control-stack[data-idle='true'] .drawer-toggle-bubble, ...` at ~1562-1570) and the stray `.gesture-nav-button` override at ~1586.

5. Update the existing `@media (prefers-reduced-motion: reduce)` block that referenced `.gesture-nav-pill, .gesture-nav-capsule, ...`:

```css
@media (prefers-reduced-motion: reduce) {
  .floating-nav-card,
  .floating-nav-button,
  .floating-nav-card-item,
  .floating-control-drag-backdrop,
  .floating-control-dock-rail,
  .floating-control-stack {
    animation: none;
    transition: none;
  }
}
```

6. In `web/src/styles/portRelay.css`: delete `.port-relay-floating-bubble` and all `.port-relay-target-switch-*` rules (the menu is replaced by the bottom-sheet in Task 7).

7. Check `--accent-soft-bg`, `--border-faint`, `--shadow-overlay`, `--hover`, `--state-success` exist in `tokens.css` (they are used elsewhere per visual-language; if `--accent-soft-bg` is missing, use `color-mix(in srgb, var(--accent-primary) 16%, transparent)` instead in both the CSS and the test expectation).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest web-gesture-navigation -t "styles the floating nav"`
Expected: PASS for the styles test; the component-wiring test passes after Task 7 — note it as pending.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/styles/shell.css app/web/src/styles/portRelay.css app/__tests__/web-gesture-navigation.test.ts
git commit -m "feat: restyle floating nav as light button and frosted icon card"
```

---

### Task 6: Clean up the gesture/drag state machines in WorkspaceApp

**Files:**
- Modify: `web/src/app/WorkspaceApp.tsx` (state types ~754-780, handlers ~6684-7246)
- Modify: `web/src/shell/state/workspaceUiState.ts` (remove `floatingDragState` slice: lines 48, 68, 137, 172, 312 and the `WorkspaceFloatingDragState` type)
- Test: `__tests__/web-gesture-navigation.test.ts` (update the two kept tests)

- [ ] **Step 1: Update the failing tests**

In `__tests__/web-gesture-navigation.test.ts`:

1. In `'suppresses chat click expansion after movement cancellation'`, replace the two-ref assertions with the merged single ref:

```ts
    expect(main).toContain('const gestureNavigationSuppressClickUntilRef = useRef(0);');
    expect(main).not.toContain('gestureNavigationSuppressClickRef');
    expect(currentSelectBody).toContain('Date.now() <= gestureNavigationSuppressClickUntilRef.current');
    expect(currentSelectBody).toContain('floatingClickCooldownUntilRef.current > Date.now()');
    expect(currentSelectBody).toContain("gestureNavStateRef.current?.phase === 'expanded'");
    expect(currentSelectBody).toContain('setDrawerOpen(false);');
    expect(pointerMoveBody).toContain('shouldCancelGestureClick({');
    expect(pointerMoveBody).toContain('clearGestureMoveLongPressTimer();');
    expect(pointerMoveBody).toContain('gestureNavigationSuppressClickUntilRef.current');
    expect(pointerMoveBody).not.toContain("intent === 'expand'");
```

2. Add a new test pinning the local drag state and the removed store slice:

```ts
  test('keeps floating drag state local and out of the workspace store', () => {
    const main = readMain();
    const uiState = fs.readFileSync(
      path.join(projectRoot(), 'web', 'src', 'shell', 'state', 'workspaceUiState.ts'),
      'utf8',
    );

    expect(main).toContain('useState<FloatingDragState | null>(null)');
    expect(main).not.toContain('transient.setFloatingDragState');
    expect(main).not.toContain('transient.floatingDragState');
    expect(uiState).not.toContain('floatingDragState');
    expect(uiState).not.toContain('WorkspaceFloatingDragState');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest web-gesture-navigation -t "suppresses"`
Expected: FAIL (still two refs / store-backed drag state).

- [ ] **Step 3: Rework the state types and handlers**

In `web/src/app/WorkspaceApp.tsx`:

1. Replace the `FloatingDragState` and `GestureNavigationState` types (~754-780):

```ts
type FloatingDragState = {
  pointerId: number;
  originY: number;
  startSide: PersistedFloatingControlSide;
  startTop: number;
  currentTop: number;
};
type GestureNavigationState =
  | {
      phase: 'pressing' | 'neutral';
      pointerId: number;
      originX: number;
      originY: number;
      currentX: number;
      currentY: number;
      startedAt: number;
    }
  | {phase: 'expanded'};
```

2. Replace the drag-state plumbing (~2841, 2877-2882, 5617-5618):

```ts
  const [floatingDragState, setFloatingDragState] = useState<FloatingDragState | null>(null);
  const floatingDragStateRef = useRef<FloatingDragState | null>(null);
```

(delete the old `workspaceUiState.transient.floatingDragState` read at ~2790, the `setFloatingDragState` dispatch wrapper at ~2877-2882, and keep the existing sync effect `floatingDragStateRef.current = floatingDragState;`.) Delete `gestureNavigationSuppressClickRef` (~2845), keep `gestureNavigationSuppressClickUntilRef`.

3. In `web/src/shell/state/workspaceUiState.ts`: delete the `WorkspaceFloatingDragState` type, the `floatingDragState` fields (transient type line 48, input line 68, default line 137, resolve line 172), and the `'transient/setFloatingDragState'` reducer case (line ~312). Grep the repo for `setFloatingDragState`/`floatingDragState` afterwards — only `WorkspaceApp.tsx` local usages may remain.

4. Simplify drag finish/cancel (replace `finishFloatingDrag` and `cancelFloatingDrag`, ~6939-7011):

```ts
  const finishFloatingDrag = useCallback(
    (pointerId: number) => {
      const current = floatingDragStateRef.current;
      if (!current || current.pointerId !== pointerId) {
        return;
      }
      const snappedTop = clampFloatingTop(
        current.currentTop,
        floatingBounds.minTop,
        floatingBounds.maxTop,
      );
      const nextYRatio = floatingControlYRatioFromTop(
        snappedTop,
        floatingBaseBounds.minTop,
        floatingBaseBounds.maxTop,
      );
      const nextSide = floatingControlSideRef.current;
      floatingClickCooldownUntilRef.current = Date.now() + 120;
      setFloatingControlYRatio(nextYRatio);
      setFloatingControlSide(nextSide);
      workspaceStore.rememberGlobalState({floatingControlYRatio: nextYRatio, floatingControlSide: nextSide});
      try {
        window.localStorage.setItem(PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY, String(nextYRatio));
        window.localStorage.setItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY, nextSide);
      } catch {
        // Ignore local storage failures in private or restricted contexts.
      }
      setFloatingDragState(null);
    },
    [
      floatingBaseBounds.maxTop,
      floatingBaseBounds.minTop,
      floatingBounds.maxTop,
      floatingBounds.minTop,
      setFloatingControlSide,
      setFloatingControlYRatio,
    ],
  );
  const cancelFloatingDrag = useCallback((pointerId: number) => {
    const current = floatingDragStateRef.current;
    if (!current || current.pointerId !== pointerId) {
      return;
    }
    floatingClickCooldownUntilRef.current = Date.now() + 120;
    setFloatingDragState(null);
  }, []);
```

Delete `clearFloatingCooldownState` (~6857-6876) and `floatingCooldownTimerRef`; remove their remaining call sites (in `cancelGestureNavigation` and the deleted code paths — `cancelGestureNavigation` keeps only the cooldown timestamp assignment `floatingClickCooldownUntilRef.current = Date.now() + 120;`).

5. Simplify `handleFloatingPointerMove` (~6877-6938): drop the `!current.active` ghost branch and the mid-drag persistence; drag state now only exists while active:

```ts
  const handleFloatingPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const current = floatingDragStateRef.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const deltaY = event.clientY - current.originY;
      const currentSide = floatingControlSideRef.current;
      const nextSide = resolveFloatingControlDragSide(
        currentSide,
        event.clientX,
        windowWidth,
      );
      if (nextSide !== currentSide) {
        floatingControlSideRef.current = nextSide;
        setFloatingControlSide(nextSide);
        closeMobileDrawerCompanionOverlays();
        triggerMobileHaptic();
        pulseFloatingControlSide(nextSide);
      }
      setFloatingDragState({
        ...current,
        currentTop: clampFloatingTop(
          current.startTop + deltaY,
          floatingBounds.minTop,
          floatingBounds.maxTop,
        ),
      });
    },
    [
      closeMobileDrawerCompanionOverlays,
      floatingBounds.maxTop,
      floatingBounds.minTop,
      pulseFloatingControlSide,
      setFloatingControlSide,
      windowWidth,
    ],
  );
```

6. Update `openGestureNavigationActions` (~7012-7030) for the union type and the single suppress ref:

```ts
  const openGestureNavigationActions = useCallback(() => {
    clearGestureMoveLongPressTimer();
    const nextState: GestureNavigationState = {phase: 'expanded'};
    gestureNavStateRef.current = nextState;
    setGestureNavState(nextState);
    setDrawerOpen(true);
  }, [clearGestureMoveLongPressTimer, setDrawerOpen]);
```

7. Update `handleGestureNavigationCurrentSelect` (~7031-7056): replace the two-ref suppress check with `Date.now() <= gestureNavigationSuppressClickUntilRef.current` then reset `gestureNavigationSuppressClickUntilRef.current = 0;` (drop all `gestureNavigationSuppressClickRef` references).

8. Update `beginGestureNavigationPress` (~7057-7123): drop the `gestureNavigationSuppressClickRef` resets (keep `gestureNavigationSuppressClickUntilRef.current = 0;`), and fix the long-press timer body to construct the slim drag state:

```ts
      gestureMoveLongPressTimerRef.current = window.setTimeout(() => {
        const current = gestureNavStateRef.current;
        gestureMoveLongPressTimerRef.current = null;
        if (!current || current.phase === 'expanded' || current.pointerId !== event.pointerId) {
          return;
        }
        if (!shouldStartGestureMove({
          elapsedMs: Date.now() - current.startedAt,
        })) {
          return;
        }
        gestureNavigationSuppressClickUntilRef.current = 0;
        gestureNavStateRef.current = null;
        setGestureNavState(null);
        closeMobileDrawerCompanionOverlays();
        setDrawerOpen(false);
        triggerMobileHaptic();
        setFloatingDragState({
          pointerId: current.pointerId,
          originY: current.currentY,
          startSide: floatingControlSide,
          startTop: floatingControlTop,
          currentTop: floatingControlTop,
        });
      }, GESTURE_MOVE_LONG_PRESS_MS);
```

9. Update `handleGestureNavigationPointerMove` (~7140-7178): guard the union and cancel the long-press timer when the gesture goes neutral:

```ts
      const current = gestureNavStateRef.current;
      if (!current || current.phase === 'expanded' || current.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - current.originX;
      const deltaY = event.clientY - current.originY;
      const distancePx = Math.hypot(deltaX, deltaY);
      const nextCurrent = {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
      };
      if (shouldCancelGestureClick({distancePx}) && current.phase !== 'neutral') {
        clearGestureMoveLongPressTimer();
        gestureNavigationSuppressClickUntilRef.current =
          Date.now() + GESTURE_NAV_CANCELLED_CLICK_SUPPRESS_MS;
        const nextState = {...nextCurrent, phase: 'neutral' as const};
        gestureNavStateRef.current = nextState;
        setGestureNavState(nextState);
        return;
      }
      if (current.currentX !== event.clientX || current.currentY !== event.clientY) {
        gestureNavStateRef.current = nextCurrent;
        setGestureNavState(nextCurrent);
      }
```

(deps: `[clearGestureMoveLongPressTimer, handleFloatingPointerMove]`)

10. Update `finishGestureNavigation` (~7179-7195) and `cancelGestureNavigation` (~7196-7215): drop `gestureNavigationSuppressClickRef` references; in `cancelGestureNavigation` remove the `clearFloatingCooldownState(cooldownUntil)` call (deleted) and keep `floatingClickCooldownUntilRef.current = Date.now() + 120;`.

11. Update `floatingDragVisualState` (~6815-6822) — remove the `pressing`-era `drag-ready` state since pressing no longer scales (the timer arms invisibly until drag starts), and delete `floatingControlsIdle` (~6823-6826):

```ts
  const floatingDragVisualState =
    floatingDragState !== null
      ? 'dragging'
      : gestureNavigationExpanded
        ? 'nav-open'
        : 'idle';
```

12. Update the height-measure effect (~5826-5838): replace `?? 184` with `?? FLOATING_NAV_BUTTON_SIZE_PX` (import from `mobileFloatingNavModel`) and remove `gestureNavigationExpanded` from its deps.

13. Update `floatingBaseBounds` (~6684-6702): add `expandedOverflowPx: FLOATING_NAV_EXPANDED_OVERFLOW_PX` to the `resolveFloatingControlDefaultBounds` call and to the memo deps.

- [ ] **Step 4: Run tests and type check**

Run: `npx jest web-gesture-navigation web-responsive-ui-state web-responsive-shell`
Expected: PASS (except the Task-7 wiring test).
Run: `npm run tsc:web`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/shell/state/workspaceUiState.ts app/__tests__/web-gesture-navigation.test.ts
git commit -m "refactor: localize floating drag state and simplify gesture machine"
```

---

### Task 7: Integrate MobileFloatingNav and merge Relay

**Files:**
- Modify: `web/src/app/WorkspaceApp.tsx` (stack JSX ~19183-19352, relay handlers ~7290-7363 & ~12546-12642, stack-height/ports state ~3020-3021, sheet render near ~20326)
- Modify: `web/src/portRelay/PortRelayFrameSurface.tsx` (delete `PortRelayFloatingButton`, migrate chrome icons)
- Test: `__tests__/web-mobile-floating-nav.test.tsx` (append wiring assertions)

- [ ] **Step 1: Append failing wiring tests**

Append to `__tests__/web-mobile-floating-nav.test.tsx`:

```ts
import fs from 'fs';
import path from 'path';

function readMain(): string {
  return fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

describe('floating nav wiring', () => {
  test('resolves current surface and relay state through the model', () => {
    const main = readMain();

    expect(main).toContain('resolveFloatingNavCurrent({');
    expect(main).toContain('relayFrameOpen: mobilePortRelayFrameOpen');
    expect(main).toContain('resolveFloatingNavRelayState({');
    expect(main).toContain('ready: portRelayReady');
    expect(main).toContain('frameUrl: portRelayFrameUrl');
    expect(main).toContain('expandedOverflowPx: FLOATING_NAV_EXPANDED_OVERFLOW_PX');
  });

  test('merges relay into the nav and drops the standalone bubble', () => {
    const main = readMain();

    expect(main).not.toContain('PortRelayFloatingButton');
    expect(main).not.toContain('handlePortRelayFloatingPointerDown');
    expect(main).not.toContain('finishPortRelayFloatingPress');
    expect(main).not.toContain('PORT_RELAY_TARGET_MENU_LONG_PRESS_MS');
    expect(main).not.toContain('portRelayTargetMenuOpen');
    expect(main).not.toContain("mobilePortRelayFrameOpen ? null : (");
    expect(main).toContain('handleFloatingNavSelect');
    expect(main).toContain('mobileRelayTargetSheet');
    expect(main).toContain('useMenuExitState');
  });

  test('relay frame chrome uses lucide icons', () => {
    const surface = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'portRelay', 'PortRelayFrameSurface.tsx'),
      'utf8',
    );

    expect(surface).not.toContain('codicon');
    expect(surface).not.toContain('PortRelayFloatingButton');
    expect(surface).toContain("from '../common/Icon'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest web-mobile-floating-nav web-gesture-navigation`
Expected: FAIL on the new wiring tests and the Task-5 component test.

- [ ] **Step 3: Rework the relay state and handlers**

In `web/src/app/WorkspaceApp.tsx`:

1. Add imports: `MobileFloatingNav`, `FLOATING_NAV_BUTTON_SIZE_PX`, `FLOATING_NAV_EXPANDED_OVERFLOW_PX`, `resolveFloatingNavCurrent`, `resolveFloatingNavRelayState`, `FloatingNavDestination` from `../shell/layouts/mobile/MobileFloatingNav` / `mobileFloatingNavModel`; add `portRelayTargetKey` to the existing `../portRelay/portRelayTargets` import. Remove `PortRelayFloatingButton` from the `PortRelayFrameSurface` import.

2. Delete: `portRelayTargetMenuOpen`/`setPortRelayTargetMenuOpen` state (~3020), `portRelayTargetMenuPressRef`, `portRelayTargetMenuTimerRef`, `clearPortRelayTargetMenuTimer`, `handlePortRelayFloatingPointerDown`, `handlePortRelayFloatingPointerMove`, `finishPortRelayFloatingPress` (~7290-7363), the `PORT_RELAY_TARGET_MENU_LONG_PRESS_MS` constant (~951), the outside-close effect for `portRelayTargetMenuOpen` (~3215-3236), and `handlePortRelayFloatingToggle` (~12625-12642).

3. Add the target sheet state near the other sheet state (~3398):

```ts
  const [mobileRelayTargetSheet, setMobileRelayTargetSheet, mobileRelayTargetSheetExiting] =
    useMenuExitState<{open: true}>();
```

4. Add the nav resolvers (near `floatingDragVisualState`):

```ts
  const floatingNavCurrent = resolveFloatingNavCurrent({
    relayFrameOpen: mobilePortRelayFrameOpen,
    settingsOpen: sidebarSettingsOpen,
    usageOpen: mobileUsageOpen,
    terminalOpen: terminalOpen,
    previewOpen: chatPreviewOpen && !mobilePortRelayFrameOpen,
  });
  const floatingNavRelayState = resolveFloatingNavRelayState({
    ready: portRelayReady,
    frameUrl: portRelayFrameUrl,
    hasTarget: (activePortRelayTarget ?? selectedPortRelayTarget) !== null,
    frameOpen: mobilePortRelayFrameOpen,
  });
```

5. Add the select handlers:

```ts
  const handleFloatingNavRelayOpen = useCallback(() => {
    if (mobilePortRelayFrameOpen) {
      closePortRelayFrameFromChrome();
      return;
    }
    const target = activePortRelayTarget ?? selectedPortRelayTarget;
    if (!target) {
      return; // Relay item renders disabled in this state.
    }
    if (portRelayTargetMenuTargets.length > 1) {
      setMobileRelayTargetSheet({open: true});
      return;
    }
    openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'floating'}).catch(() => undefined);
  }, [
    activePortRelayTarget,
    mobilePortRelayFrameOpen,
    closePortRelayFrameFromChrome,
    openPortRelayWorkbenchTab,
    portRelayFramePath,
    portRelayTargetMenuTargets.length,
    selectedPortRelayTarget,
    setMobileRelayTargetSheet,
  ]);
  const handleFloatingNavSelect = useCallback(
    (destination: FloatingNavDestination) => {
      cancelGestureNavigation();
      if (destination === 'relay') {
        handleFloatingNavRelayOpen();
        return;
      }
      if (destination === 'preview') {
        toggleChatPreviewFromTitle();
        return;
      }
      setMobileUsageOpen(false);
      closeChatPreview();
      setSidebarSettingsOpen(false);
      setTerminalOpen(false);
      if (destination === 'terminal') {
        setTerminalOpen(true);
      } else if (destination === 'monitor') {
        setMobileUsageOpen(true);
      } else if (destination === 'settings') {
        openSettingsRoot();
      }
      // 'chat' falls through: every overlay above is closed.
    },
    [
      cancelGestureNavigation,
      closeChatPreview,
      handleFloatingNavRelayOpen,
      openSettingsRoot,
      setSidebarSettingsOpen,
      toggleChatPreviewFromTitle,
    ],
  );
```

Note: `closePortRelayFrameFromChrome` is defined at ~17385, after these handlers — move its definition above `handleFloatingNavRelayOpen` or convert `handleFloatingNavRelayOpen`/`handleFloatingNavSelect` declarations to sit after it (place the new handlers right after `closePortRelayFrameFromChrome` at ~17395; `cancelGestureNavigation` etc. are all defined earlier, so this ordering works).

6. Replace the whole `floatingControlStack` JSX (~19183-19352):

```tsx
  const floatingControlStack = !isWide ? (
    <div
      className="floating-control-stack-layer"
      data-drag-state={floatingDragVisualState}
      data-side={floatingControlSide}
      data-side-pulse={floatingSidePulse}
    >
      <div className="floating-control-drag-backdrop" aria-hidden="true" />
      <div className="floating-control-dock-rail left" aria-hidden="true" />
      <div className="floating-control-dock-rail right" aria-hidden="true" />
      <div
        ref={floatingControlStackRef}
        className="floating-control-stack"
        data-drag-state={floatingDragVisualState}
        data-side={floatingControlSide}
        style={effectiveFloatingControlStackStyle}
        onPointerMove={handleGestureNavigationPointerMove}
        onPointerUp={event => {
          floatingIgnoreLostCaptureRef.current = true;
          if (floatingDragStateRef.current?.pointerId === event.pointerId) {
            finishFloatingDrag(event.pointerId);
            return;
          }
          finishGestureNavigation(event.pointerId);
        }}
        onPointerCancel={event => {
          floatingIgnoreLostCaptureRef.current = true;
          if (floatingDragStateRef.current?.pointerId === event.pointerId) {
            cancelFloatingDrag(event.pointerId);
            return;
          }
          cancelGestureNavigation(event.pointerId);
        }}
        onLostPointerCapture={event => {
          if (floatingIgnoreLostCaptureRef.current) {
            floatingIgnoreLostCaptureRef.current = false;
            return;
          }
          if (floatingDragStateRef.current?.pointerId === event.pointerId) {
            cancelFloatingDrag(event.pointerId);
            return;
          }
          cancelGestureNavigation(event.pointerId);
        }}
      >
        <MobileFloatingNav
          expanded={gestureNavigationExpanded}
          current={floatingNavCurrent}
          previewActive={chatPreviewOpen && !mobilePortRelayFrameOpen}
          terminalActive={terminalOpen}
          monitorActive={mobileUsageOpen}
          chatUnread={hasCompletedUnreadChatSessionIndicator}
          relay={floatingNavRelayState}
          onSelect={handleFloatingNavSelect}
          onCurrentSelect={handleGestureNavigationCurrentSelect}
          onButtonPointerDown={handleGestureNavigationPillPointerDown}
        />
      </div>
    </div>
  ) : null;
```

(The stack stays mounted while the relay frame is open — the `mobilePortRelayFrameOpen ? null :` gate is gone, fixing the "cannot drag while frame open" issue.)

7. Add the relay target sheet next to the project sheet render (search for `renderMobileProjectActionSheet`'s call site and place beside it):

```tsx
  const mobileRelayTargetSheetNode = !isWide && mobileRelayTargetSheet ? (
    <>
      <div
        className="mobile-project-sheet-overlay"
        onClick={() => setMobileRelayTargetSheet(null)}
        aria-hidden="true"
      />
      <div
        className={`mobile-project-sheet${mobileRelayTargetSheetExiting ? ' sl-menu-exit' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Port Relay targets"
      >
        <div className="mobile-project-sheet-grip" aria-hidden="true" />
        <div className="mobile-project-sheet-header">
          <SessionIcon name="radioTower" className="mobile-project-sheet-icon" />
          <span className="mobile-project-sheet-title-copy">
            <span className="mobile-project-sheet-title">Relay target</span>
            <span className="mobile-project-sheet-subtitle">
              {activePortRelayTarget
                ? `${activePortRelayTarget.hubId}:${activePortRelayTarget.targetPort}`
                : 'Select a target'}
            </span>
          </span>
          <button
            type="button"
            className="mobile-project-sheet-close"
            onClick={() => setMobileRelayTargetSheet(null)}
            aria-label="Close"
            title="Close"
          >
            <SessionIcon name="x" />
          </button>
        </div>
        <div className="mobile-project-sheet-body">
          {portRelayTargetMenuTargets.map(target => {
            const selected = samePortRelayTarget(activePortRelayTarget, target);
            const switching = samePortRelayTarget(portRelayMenuSwitchingTarget, target);
            return (
              <button
                key={portRelayTargetKey(target)}
                type="button"
                className="wide-project-action-menu-item mobile-project-sheet-item"
                onClick={() => {
                  setMobileRelayTargetSheet(null);
                  handlePortRelayFloatingTargetSelect(target);
                }}
              >
                <SessionIcon name={switching ? 'loader' : selected ? 'check' : 'radioTower'} spin={switching} />
                <span className="mobile-project-sheet-item-label">
                  {`${target.hubId}:${target.targetPort}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  ) : null;
```

Render `{mobileRelayTargetSheetNode}` where the project sheet is rendered. `useMenuExitState`'s setter already routes `null` through the exit animation; verify `samePortRelayTarget` and `SessionIcon` are imported (they are — used elsewhere in the file).

8. In `web/src/portRelay/PortRelayFrameSurface.tsx`: delete `PortRelayFloatingButton` and its props type; in `PortRelayFrameSurface` replace codicons with the shared icon:

```tsx
import React from 'react';
import {Icon} from '../common/Icon';
```

```tsx
      {chrome ? (
        <div className="chat-preview-toolbar">
          <button
            type="button"
            className="chat-preview-icon-button"
            onClick={onCloseChrome}
            title={mode === 'mobile' ? 'Back' : 'Close preview'}
            aria-label={mode === 'mobile' ? 'Back' : 'Close preview'}
          >
            <Icon name={mode === 'mobile' ? 'arrowLeft' : 'x'} size={16} />
          </button>
          <div className="chat-preview-title" title={url}>{url}</div>
          <button
            type="button"
            className="chat-preview-icon-button"
            onClick={onOpenInBrowser}
            title="Open relay page in browser"
            aria-label="Open relay page in browser"
          >
            <Icon name="externalLink" size={16} />
          </button>
        </div>
      ) : null}
```

Also remove the now-unused `portRelayTargetKey`/`samePortRelayTarget` imports from this file.

9. Grep cleanup: `grep -rn "portRelayTargetMenuOpen\|PortRelayFloatingButton\|PORT_RELAY_TARGET_MENU_LONG_PRESS_MS\|drawer-toggle-bubble" web/src` — expected: no hits.

- [ ] **Step 4: Run tests and type check**

Run: `npx jest web-mobile-floating-nav web-gesture-navigation web-responsive-ui-state web-responsive-shell`
Expected: PASS.
Run: `npm run tsc:web`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/portRelay/PortRelayFrameSurface.tsx app/__tests__/web-mobile-floating-nav.test.tsx
git commit -m "feat: merge relay into the floating nav menu card"
```

---

### Task 8: Session list — relaxed density + dead class cleanup

**Files:**
- Modify: `web/src/chat/sessionListDensity.ts`
- Modify: `web/src/chat/sessionlist/SessionRow.tsx` (remove `mobile` prop — only feeds dead classes at lines 22, 42, 56, 100, 116, 125)
- Modify: `web/src/chat/sessionlist/ProjectSection.tsx` (remove `mobile` prop, `sfx` helper, dead classes at lines 45, 47, 50, 74, 118; keep `mobile-project-session-error` at 112 — it has real styles)
- Modify: `web/src/chat/sessionlist/SessionListView.tsx` (stop passing `mobile` to SessionRow/ProjectSection; drop `mobile-session-row` at line 203; keep the `mobile ? 'mobile-project' : 'wide-project'` key prefix at 154)
- Modify: `web/src/app/WorkspaceApp.tsx:6662` (drop `mobile-project-actions` suffix in the hidden-projects row) and `web/src/styles/shell.css` (delete the no-op `.mobile-project-actions { opacity: 1 }` rule at ~1299-1301)
- Test: `__tests__/web-chat-view-width-settings.test.ts`, `web/src/chat/sessionlist/SessionRow.test.tsx`, `ProjectSection.test.tsx`, `SessionListView.test.tsx`

- [ ] **Step 1: Update failing tests**

1. `__tests__/web-chat-view-width-settings.test.ts:33` — change to `expect(density.MOBILE_SESSION_LIST_DENSITY).toBe('relaxed');`
2. Add to the same file (near the existing dead-class assertions at lines 51-52):

```ts
    expect(sessionRowTsx).not.toContain('mobile-session-row');
    expect(projectSectionTsx).not.toContain('mobile-project-section');
    expect(projectSectionTsx).not.toContain('mobile-project-row');
    expect(projectSectionTsx).not.toContain('mobile-project-toggle');
    expect(projectSectionTsx).not.toContain('mobile-project-session-list');
```

(add `const sessionRowTsx`/`projectSectionTsx` readers mirroring the existing `readWebSource` helpers in that file.)
3. Grep `SessionRow.test.tsx` / `ProjectSection.test.tsx` / `SessionListView.test.tsx` for `mobile` props or `mobile-session-row` assertions and remove them (e.g. `mobile: false` props become unnecessary; delete those prop entries).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest web-chat-view-width-settings sessionlist`
Expected: FAIL (density still 'compact', dead classes still emitted).

- [ ] **Step 3: Implement**

1. `web/src/chat/sessionListDensity.ts`:

```ts
export const MOBILE_SESSION_LIST_DENSITY: SessionListDensity = 'relaxed';
```

2. `SessionRow.tsx`: delete the `mobile?: boolean;` prop declarations (both components), the `mobile = false,` destructures, and the `${mobile ? ' mobile-session-row' : ''}` fragments.
3. `ProjectSection.tsx`: delete the `mobile` prop, the `sfx` helper, and every `sfx(...)` call (class strings become plain `` `wide-project-section${active ? ...` `` etc.).
4. `SessionListView.tsx`: remove `mobile={mobile}` from `<SessionRow>`/`<ProjectSection>` usages; change line 203's class to `` `wide-session-row session-older-toggle` ``.
5. `WorkspaceApp.tsx:6662`: `` className="wide-project-actions" `` (drop the mobile suffix).
6. `shell.css`: delete the `.mobile-project-actions { opacity: 1 }` rule.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest web-chat-view-width-settings sessionlist web-chat-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/sessionListDensity.ts app/web/src/chat/sessionlist app/web/src/app/WorkspaceApp.tsx app/web/src/styles/shell.css app/__tests__/web-chat-view-width-settings.test.ts
git commit -m "feat: unify mobile session list density and drop dead mobile classes"
```

---

### Task 9: Project long-press sheet gains Resume entry

**Files:**
- Modify: `web/src/app/WorkspaceApp.tsx` (sheet actions phase ~16017-16030)
- Test: `__tests__/web-chat-ui.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/web-chat-ui.test.ts`:

```ts
describe('mobile project action sheet resume entry', () => {
  test('offers resume from the actions phase reusing the existing resume flow', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const actionsStart = main.indexOf("sheetMenu.kind === 'actions' ? (");
    const actionsEnd = main.indexOf("sheetMenu.phase === 'agents'", actionsStart);
    const actionsBody = main.slice(actionsStart, actionsEnd);

    expect(actionsBody).toContain("'Resume session'");
    expect(actionsBody).toContain('SessionIcon name="import"');
    expect(actionsBody).toContain("openMobileProjectActionMenu(sheetMenu.projectId, 'resume')");
  });
});
```

(The file already imports `fs`/`path`; if it doesn't, add the imports at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web-chat-ui -t "resume entry"`
Expected: FAIL.

- [ ] **Step 3: Add the entry**

In `web/src/app/WorkspaceApp.tsx`, inside the sheet body `sheetMenu.kind === 'actions' ? (` branch (~16017), render a fragment with both entries:

```tsx
            {sheetMenu.kind === 'actions' ? (
              <>
                <button
                  type="button"
                  className="wide-project-action-menu-item mobile-project-sheet-item"
                  onClick={() => {
                    openMobileProjectActionMenu(sheetMenu.projectId, 'resume');
                  }}
                >
                  <SessionIcon name="import" />
                  <span className="mobile-project-sheet-item-label">Resume session</span>
                </button>
                <button
                  type="button"
                  className="wide-project-action-menu-item mobile-project-sheet-item"
                  onClick={() => {
                    togglePinnedProject(sheetMenu.projectId);
                    setMobileProjectActionMenu(null);
                  }}
                >
                  <SessionIcon name="pin" />
                  <span className="mobile-project-sheet-item-label">
                    {pinnedProjectIds.includes(sheetMenu.projectId) ? 'Unpin Project' : 'Pin Project'}
                  </span>
                </button>
              </>
            ) : sheetMenu.phase === 'agents' ? (
```

(`openMobileProjectActionMenu` switches kind `'actions'` → `'resume'` with `phase: 'agents'`, reusing the existing agent → session-list → import flow; it does not toggle closed because the kind differs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web-chat-ui -t "resume entry"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-ui.test.ts
git commit -m "feat: add resume entry to mobile project action sheet"
```

---

### Task 10: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx jest`
Expected: PASS. Fix any stragglers (likely candidates: `web-chat-ui.test.ts` assertions pinning `.drawer-toggle-bubble` or `data-idle`, `web-responsive-shell.test.ts` floating markup) by updating the assertions to the new design.

- [ ] **Step 2: Type check and build**

Run: `npm run tsc:web && npm run build:web`
Expected: no type errors; webpack build succeeds.

- [ ] **Step 3: Manual smoke checklist** (dev server `npm run web`, narrow viewport ≤900px or device emulation)

- Collapsed button: translucent, icon clearly visible over chat content; no idle dimming.
- Tap → frosted card with 5-6 icons; current highlighted; card fully visible even after dragging the control to the topmost allowed position.
- Relay: hidden when relay down; disabled when no target; single target tap opens frame; multi target opens the bottom-sheet; frame open → control still draggable, Relay item active, tap closes frame.
- Long-press 450ms → drag; rails show; side switch haptic/pulse; release persists position across reload.
- Press then move >12px → no tap, no surprise drag after 450ms.
- Session list: mobile rows same height as PC relaxed; project long-press sheet shows Resume session → agent → session list → import.
- `prefers-reduced-motion`: no card entrance animation.

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "test: update floating nav assertions for the merged design" || true
git push origin mobile-floating-nav
```

---

## Self-review notes (already applied)

- **Spec coverage:** menu-card form (T3-5, T7), materials (T5), expansion-in-bounds (T2, T6.13), relay merge + multi-target sheet + disabled state (T7), draggable while frame open (T7.6), 450ms unification (T1), cancel-on-move timer fix (T6.9), local drag state + persist-on-finish (T6.3-5), Lucide migration incl. relay chrome (T4, T7.8), motion tokens + reduced-motion (T5), session density + dead classes (T8), sheet Resume (T9), A1 preserved (no task touches drawer coupling). Out-of-scope items untouched.
- **Type consistency:** `FloatingNavDestination`, `FloatingNavRelayState`, `resolveFloatingNavCurrent`, `resolveFloatingNavRelayState`, `FLOATING_NAV_*` constants, `useMenuExitState`, `handleFloatingNavSelect`, `handleFloatingNavRelayOpen`, `mobileRelayTargetSheet(Exiting)` are used identically across tasks.
- **Known risk:** Task 7.5 places new handlers after `closePortRelayFrameFromChrome` (~17395) — follow that note to avoid use-before-declaration.
