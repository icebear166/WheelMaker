# Update Page Visual Hierarchy Design

## Goal

Make Settings > Update read like a focused maintenance surface: APK update first, release/package summary second, hub details third.

## Scope

- Keep the existing update protocols and native Android install flow unchanged.
- Keep the Android APK card visible only when the Android bridge is available.
- Move the hub-wide `Update All Hubs` action into a summary bar instead of leaving it as a standalone top button.
- Preserve the existing hub release action and NPM package foldout behavior.

## Layout

1. Android APK card stays at the top. It gets a clearer heading, compact metadata grid, status pill, and action row.
2. Summary bar appears below the APK card and above hub cards. It shows hub count, release updates, npm updates, scan state, and the `Update All Hubs` action.
3. Each hub card keeps the hub tag at the top, then makes `Release` the primary row.
4. NPM package updates remain a secondary disclosure section inside each hub card.

## Visual Direction

The page remains a dense operational settings view. The update surface uses restrained borders, status pills, compact metrics, and stable responsive grids. It avoids dashboard-style decorative cards and keeps mobile rows from wrapping important action text into cramped columns.

## Testing

Source-structure tests cover the new hierarchy:

- APK card remains above the summary.
- Summary bar appears before hub cards.
- `Update All Hubs` is rendered from the summary bar.
- CSS includes the summary and APK hierarchy classes.
