export type WindowsWorkspaceShortcut = 'sessions' | 'preview' | 'terminal';

export type WorkspaceShortcutEvent = Pick<
  KeyboardEvent,
  'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'isComposing' | 'defaultPrevented'
>;

export function resolveWindowsWorkspaceShortcut(
  event: WorkspaceShortcutEvent,
  environment: {isWindows: boolean; isWide: boolean},
): WindowsWorkspaceShortcut | null {
  if (
    !environment.isWindows ||
    !environment.isWide ||
    event.defaultPrevented ||
    event.isComposing ||
    !event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.metaKey
  ) {
    return null;
  }
  if (event.code === 'Digit1') return 'sessions';
  if (event.code === 'Digit2') return 'preview';
  if (event.code === 'Backquote') return 'terminal';
  return null;
}
