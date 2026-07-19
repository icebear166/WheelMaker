import { createWorkspaceUiState } from './workspaceUiState';

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
