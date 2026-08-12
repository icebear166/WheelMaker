import {
  resolveSessionSearchExpansion,
  resolveWorkspaceSearchTarget,
} from '../web/src/chat/search/searchRouting';

describe('workspace search context routing', () => {
  test('opens current chat outside Preview', () => {
    expect(resolveWorkspaceSearchTarget({
      previewFocused: false,
      previewSearchable: false,
    })).toBe('current');
  });

  test('opens Preview inside searchable Preview', () => {
    expect(resolveWorkspaceSearchTarget({
      previewFocused: true,
      previewSearchable: true,
    })).toBe('preview');
  });

  test('falls back to current chat when focused Preview cannot be searched', () => {
    expect(resolveWorkspaceSearchTarget({
      previewFocused: true,
      previewSearchable: false,
    })).toBe('current');
  });
});

describe('session search expansion', () => {
  test('opens the slide-out only when no Sessions panel is visible', () => {
    expect(resolveSessionSearchExpansion({sessionPanelPinned: true, slideOutOpen: false})).toBe('focus-only');
    expect(resolveSessionSearchExpansion({sessionPanelPinned: false, slideOutOpen: true})).toBe('focus-only');
    expect(resolveSessionSearchExpansion({sessionPanelPinned: false, slideOutOpen: false})).toBe('open-slideout');
  });
});
