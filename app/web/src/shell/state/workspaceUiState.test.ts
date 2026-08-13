import { createWorkspaceUiState, workspaceUiReducer } from './workspaceUiState';

describe('createWorkspaceUiState desktop defaults', () => {
  it('defaults sidebarCollapsed to true when no persisted value exists', () => {
    expect(createWorkspaceUiState().desktop.sidebarCollapsed).toBe(true);
  });

  it('defaults sidebarCollapsed to true when persisted value is not a boolean', () => {
    expect(createWorkspaceUiState({ sidebarCollapsed: 'yes' }).desktop.sidebarCollapsed).toBe(true);
  });

  it('keeps an explicitly persisted sidebarCollapsed value', () => {
    expect(createWorkspaceUiState({ sidebarCollapsed: false }).desktop.sidebarCollapsed).toBe(false);
    expect(createWorkspaceUiState({ sidebarCollapsed: true }).desktop.sidebarCollapsed).toBe(true);
  });

  it('opens the fixed session panel when the persisted pin preference is enabled', () => {
    expect(createWorkspaceUiState({ sessionPanelPinned: true }).desktop.sidebarCollapsed).toBe(false);
    expect(createWorkspaceUiState({ sessionPanelPinned: false }).desktop.sidebarCollapsed).toBe(true);
  });
});

describe('chat column width tiers', () => {
  it('defaults chatColumnWidth to 800 when no persisted value exists', () => {
    expect(createWorkspaceUiState().desktop.chatColumnWidth).toBe(800);
  });

  it('defaults chatColumnWidth to 800 when the persisted value is not a supported tier', () => {
    expect(createWorkspaceUiState({ chatColumnWidth: 999 }).desktop.chatColumnWidth).toBe(800);
    expect(createWorkspaceUiState({ chatColumnWidth: '1200' }).desktop.chatColumnWidth).toBe(800);
  });

  it('keeps a persisted 1200 chatColumnWidth', () => {
    expect(createWorkspaceUiState({ chatColumnWidth: 1200 }).desktop.chatColumnWidth).toBe(1200);
  });

  it('sets chatColumnWidth via desktop/setChatColumnWidth', () => {
    const state = createWorkspaceUiState();
    const next = workspaceUiReducer(state, { type: 'desktop/setChatColumnWidth', next: 1200 });
    expect(next.desktop.chatColumnWidth).toBe(1200);
  });

  it('sanitizes unsupported chatColumnWidth values back to 800', () => {
    const state = createWorkspaceUiState({ chatColumnWidth: 1200 });
    const next = workspaceUiReducer(state, { type: 'desktop/setChatColumnWidth', next: 1000 });
    expect(next.desktop.chatColumnWidth).toBe(800);
  });
});
