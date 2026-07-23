import {useCallback, useEffect, useRef, useState} from 'react';

export const MENU_EXIT_MS = 100;

/**
 * Wraps a "close menu" setter so the menu first renders with an `exiting`
 * flag (CSS exit animation) and only unmounts after MENU_EXIT_MS.
 * `setMenu` receives null to close; the current menu value must be an object.
 */
export function useMenuExit<T extends object>(setMenu: (value: T | null) => void) {
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

  const closeWithExit = useCallback(
    (current: T | null) => {
      if (!current) {
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setMenu(null);
        return;
      }
      if (timerRef.current !== null) {
        return; // exit already in flight
      }
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setExiting(false);
        setMenu(null);
      }, MENU_EXIT_MS);
    },
    [setMenu],
  );

  return {exiting, closeWithExit, cancelExit};
}

/**
 * useState drop-in for menu/popover state: setting null plays the CSS exit
 * animation first (`.sl-menu-exit` via the returned `exiting` flag); setting a
 * non-null value cancels any in-flight exit.
 */
export function useMenuExitState<T extends object>() {
  const [value, setValueRaw] = useState<T | null>(null);
  const valueRef = useRef<T | null>(null);
  valueRef.current = value;
  const {exiting, closeWithExit, cancelExit} = useMenuExit(setValueRaw);

  const setValue = useCallback(
    (next: T | null | ((current: T | null) => T | null)) => {
      if (next === null) {
        closeWithExit(valueRef.current);
        return;
      }
      cancelExit();
      setValueRaw(next);
    },
    [closeWithExit, cancelExit],
  );

  return [value, setValue, exiting] as const;
}

