export type ChatComposerMenuId =
  | 'slash'
  | 'file-mention'
  | 'attachment-tray'
  | 'context-usage'
  | 'core-config'
  | 'config-overflow'
  | 'config-value';

export type ChatComposerMenuState =
  | {id: 'none'}
  | {id: Exclude<ChatComposerMenuId, 'config-value'>}
  | {id: 'config-value'; optionId: string};

export const CHAT_COMPOSER_MENU_NONE: ChatComposerMenuState = {id: 'none'};

export function chatComposerMenuEquals(a: ChatComposerMenuState, b: ChatComposerMenuState): boolean {
  if (a.id !== b.id) {
    return false;
  }
  if (a.id === 'config-value' && b.id === 'config-value') {
    return a.optionId === b.optionId;
  }
  return true;
}
