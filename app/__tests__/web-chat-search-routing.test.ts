import {
  resolveSessionSearchExpansion,
  resolveWorkspaceSearchShortcutTarget,
} from '../web/src/chat/search/searchRouting';

describe('workspace search shortcut routing', () => {
  test('opens current chat for an unshifted shortcut outside Preview', () => {
    expect(resolveWorkspaceSearchShortcutTarget(
      {key: 'f', ctrlKey: true},
      {previewFocused: false, previewSearchable: false},
    )).toBe('current');
  });

  test('opens Preview for an unshifted shortcut inside searchable Preview', () => {
    expect(resolveWorkspaceSearchShortcutTarget(
      {key: 'F', metaKey: true},
      {previewFocused: true, previewSearchable: true},
    )).toBe('preview');
  });

  test('falls back to current chat when focused Preview cannot be searched', () => {
    expect(resolveWorkspaceSearchShortcutTarget(
      {key: 'f', ctrlKey: true},
      {previewFocused: true, previewSearchable: false},
    )).toBe('current');
  });

  test('opens Sessions for the shifted shortcut from any focus', () => {
    expect(resolveWorkspaceSearchShortcutTarget(
      {key: 'f', ctrlKey: true, shiftKey: true},
      {previewFocused: true, previewSearchable: true},
    )).toBe('sessions');
  });

  test('ignores unrelated modifier combinations', () => {
    expect(resolveWorkspaceSearchShortcutTarget(
      {key: 'f', altKey: true},
      {previewFocused: false, previewSearchable: false},
    )).toBeNull();
    expect(resolveWorkspaceSearchShortcutTarget(
      {key: 'k', ctrlKey: true},
      {previewFocused: false, previewSearchable: false},
    )).toBeNull();
  });
});

describe('session search expansion', () => {
  test('opens the slide-out only when no Sessions panel is visible', () => {
    expect(resolveSessionSearchExpansion({sessionPanelPinned: true, slideOutOpen: false})).toBe('focus-only');
    expect(resolveSessionSearchExpansion({sessionPanelPinned: false, slideOutOpen: true})).toBe('focus-only');
    expect(resolveSessionSearchExpansion({sessionPanelPinned: false, slideOutOpen: false})).toBe('open-slideout');
  });
});
