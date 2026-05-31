# Settings Navigation Unification Design

## Goal

Use one Settings navigation model for desktop and mobile so peer pages, child pages, UI back, and mobile system back behave consistently.

## Page Classes

- Root: `Settings`.
- Peer pages: `Update`, `Skills`, `Port Relay`, `Token Stats`, `CC Switch`.
- Child pages: `Connection Status`, `Database`, `Logs`.

## Rules

- Peer pages are parallel to Settings root. They are not children of Settings root.
- Child pages are entered from Settings root and return to Settings root.
- Desktop and mobile expose the same peer set. Desktop adds a `CC Switch` activity entry.
- Desktop peer order is `Settings`, `Update`, `Skills`, `Port Relay`, `Token Stats`, `CC Switch`; desktop `Refresh` remains outside Settings peers.
- Mobile peer order is `Settings`, `Update`, `Skills`, `Port Relay`, `Token Stats`, `CC Switch`.
- Desktop clicking the active peer/root closes Settings. Mobile clicking the active bottom shortcut is a no-op.
- Switching to any non-Port Relay peer/root closes the Port Relay frame.
- Desktop peer pages hide the detail back header. Desktop child pages show the detail back header and return to root.
- Mobile top back closes root/peer and returns child to root. Android/browser back uses the same root/peer/child outcomes, only on mobile.

## Implementation

- Add `app/web/src/settings/settingsNavigation.ts` for page classification and shortcut indexes.
- Update `mobileSettingsHistory.ts` to use page classification instead of hard-coded `detail !== null`.
- Add unified open/close helpers in `main.tsx` for root, peer, child, and close.
- Replace direct child detail setters with `openSettingsChild`.
- Reorder desktop activity entries and add `CC Switch`.

## Testing

- Unit tests cover root/peer/child classification and shortcut index.
- Mobile history tests cover peer close, child return-to-root, root close, and state write behavior.
- Source-structure tests verify desktop/mobile peer parity, PC active peer close wiring, child entry wiring, and peer header hiding.
