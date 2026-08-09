import {useCallback, useEffect, useRef, useState} from 'react';

export const MENU_EXIT_MS = 120;

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

/**
 * useState<boolean> drop-in for popup state: setting false plays the CSS exit
 * animation first (`.sl-menu-exit` via the returned `exiting` flag) and only
 * flips to false after MENU_EXIT_MS; setting true cancels any in-flight exit.
 * A functional toggle during the exit window reopens instead of double-closing.
 */
export function useMenuExitFlag() {
  const [open, setOpenRaw] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cancelExit = useCallback(() => {
    if (timerRef.current !== null) {
      if (typeof window.clearTimeout === 'function') {
        window.clearTimeout(timerRef.current);
      } else {
        clearTimeout(timerRef.current);
      }
      timerRef.current = null;
    }
    setExiting(false);
  }, []);

  useEffect(() => cancelExit, [cancelExit]);

  const setOpen = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(openRef.current) : next;
      if (resolved) {
        cancelExit();
        setOpenRaw(true);
        return;
      }
      if (!openRef.current) {
        return;
      }
      const reducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        setOpenRaw(false);
        return;
      }
      if (timerRef.current !== null) {
        if (typeof next === 'function') {
          cancelExit(); // toggle during exit reopens
        }
        return; // repeated plain close keeps the single in-flight timer
      }
      setExiting(true);
      const onExitDone = () => {
        timerRef.current = null;
        setExiting(false);
        setOpenRaw(false);
      };
      timerRef.current =
        typeof window.setTimeout === 'function'
          ? window.setTimeout(onExitDone, MENU_EXIT_MS)
          : (setTimeout(onExitDone, MENU_EXIT_MS) as unknown as number);
    },
    [cancelExit],
  );

  return [open, setOpen, exiting] as const;
}

