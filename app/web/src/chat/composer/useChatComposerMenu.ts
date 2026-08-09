import {useCallback, useEffect, useRef, useState} from 'react';
import {MENU_EXIT_MS} from '../sessionlist/menuExit';
import {
  CHAT_COMPOSER_MENU_NONE,
  chatComposerMenuEquals,
  type ChatComposerMenuState,
} from './chatComposerMenu';

export type ChatComposerMenuSetter = (
  next: ChatComposerMenuState | null | ((current: ChatComposerMenuState) => ChatComposerMenuState | null),
) => void;

/**
 * Single source of truth for composer popups: at most one menu is open.
 * Setting null (or {id:'none'}) plays the CSS exit animation first for
 * pointer-opened menus (`.sl-menu-exit` via the returned `exiting` flag).
 * Keyboard-driven slash and file-mention menus close immediately so typing
 * and navigation never wait on motion.
 */
export function useChatComposerMenu() {
  const [menu, setMenuRaw] = useState<ChatComposerMenuState>(CHAT_COMPOSER_MENU_NONE);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cancelExit = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setExiting(false);
  }, []);

  useEffect(() => cancelExit, [cancelExit]);

  const setMenu = useCallback<ChatComposerMenuSetter>(
    next => {
      const resolved =
        (typeof next === 'function' ? next(menuRef.current) : next) ?? CHAT_COMPOSER_MENU_NONE;
      if (resolved.id !== 'none') {
        cancelExit();
        if (!chatComposerMenuEquals(resolved, menuRef.current)) {
          setMenuRaw(resolved);
        }
        return;
      }
      if (menuRef.current.id === 'none') {
        return;
      }
      if (menuRef.current.id === 'slash' || menuRef.current.id === 'file-mention') {
        setMenuRaw(CHAT_COMPOSER_MENU_NONE);
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setMenuRaw(CHAT_COMPOSER_MENU_NONE);
        return;
      }
      if (timerRef.current !== null) {
        return; // exit already in flight
      }
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setExiting(false);
        setMenuRaw(CHAT_COMPOSER_MENU_NONE);
      }, MENU_EXIT_MS);
    },
    [cancelExit],
  );

  return [menu, setMenu, exiting] as const;
}
