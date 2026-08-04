import React, {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Terminal, type ITheme} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {Icon} from '../common/Icon';

export type TerminalThemeMode = 'dark' | 'light';

const TERMINAL_THEMES: Record<TerminalThemeMode, ITheme> = {
  dark: {
    background: '#1e1e1e',
    foreground: '#dedede',
    cursor: '#dedede',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    selectionInactiveBackground: '#3a3d41',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
  },
  light: {
    background: '#ffffff',
    foreground: '#242424',
    cursor: '#242424',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    selectionInactiveBackground: '#e5ebf1',
    black: '#000000',
    red: '#cd3131',
    green: '#008000',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  },
};

export type TerminalViewHandle = {
  resetAndWrite(data: Uint8Array): Promise<void>;
  write(data: Uint8Array): void;
  focus(): void;
  fit(): {cols: number; rows: number} | null;
};

export type TerminalViewProps = {
  themeMode?: TerminalThemeMode;
  active: boolean;
  resizeEnabled: boolean;
  cols: number;
  rows: number;
  shell?: string;
  initialCwd?: string;
  onInput: (data: Uint8Array) => void;
  onResize: (cols: number, rows: number) => void;
  onAutoResize?: (cols: number, rows: number) => void;
  onCopy?: () => void;
};

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  {
    themeMode = 'dark',
    active,
    resizeEnabled,
    cols,
    rows,
    shell = '',
    initialCwd = '',
    onInput,
    onResize,
    onAutoResize,
    onCopy,
  },
  ref,
) {
  const [copyMenu, setCopyMenu] = useState<{left: number; top: number; text: string} | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const copyMenuRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const autoResizeRef = useRef(onAutoResize);
  const activeRef = useRef(active);
  const resizeEnabledRef = useRef(resizeEnabled);
  const colsRef = useRef(cols);
  const rowsRef = useRef(rows);
  const previousResizeEnabledRef = useRef(resizeEnabled);
  const resizeFrameRef = useRef<number | null>(null);
  const lastSizeRef = useRef('');
  inputRef.current = onInput;
  resizeRef.current = onResize;
  autoResizeRef.current = onAutoResize;
  activeRef.current = active;
  resizeEnabledRef.current = resizeEnabled;
  colsRef.current = cols;
  rowsRef.current = rows;

  const fit = (): {cols: number; rows: number} | null => {
    const terminal = terminalRef.current;
    const addon = fitAddonRef.current;
    if (!terminal || !addon) return null;
    addon.fit();
    return {cols: terminal.cols, rows: terminal.rows};
  };

  useImperativeHandle(ref, () => ({
    resetAndWrite(data: Uint8Array) {
      const terminal = terminalRef.current;
      if (!terminal) return Promise.resolve();
      terminal.reset();
      return new Promise<void>(resolve => terminal.write(data, resolve));
    },
    write(data: Uint8Array) {
      terminalRef.current?.write(data);
    },
    focus() {
      terminalRef.current?.focus();
    },
    fit,
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const windowsTerminal = /^[a-z]:[\\/]/i.test(shell) || /^[a-z]:[\\/]/i.test(initialCwd);
    const terminal = new Terminal({
      scrollback: 10000,
      cols,
      rows,
      convertEol: false,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      theme: {...TERMINAL_THEMES[themeMode]},
      ...(windowsTerminal ? {windowsPty: {backend: 'conpty' as const}} : {}),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.attachCustomKeyEventHandler(event => {
      const isClipboardShortcut = (
        event.type === 'keydown' &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey)
      );
      const isCopyShortcut = (
        isClipboardShortcut &&
        event.key.toLowerCase() === 'c'
      );
      const isPasteShortcut = isClipboardShortcut && event.key.toLowerCase() === 'v';
      return !((isCopyShortcut && terminal.hasSelection()) || isPasteShortcut);
    });
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData(data => inputRef.current(new TextEncoder().encode(data)));
    const binaryDisposable = terminal.onBinary(data => {
      const bytes = new Uint8Array(data.length);
      for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index) & 0xff;
      inputRef.current(bytes);
    });
    const isForegroundActive = () => (
      activeRef.current &&
      (typeof document === 'undefined' || document.visibilityState === 'visible')
    );
    const reportFit = () => {
      resizeFrameRef.current = null;
      if (!isForegroundActive()) return;
      const proposed = fitAddon.proposeDimensions();
      if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
      if (!resizeEnabledRef.current) {
        if (proposed.cols === colsRef.current && proposed.rows === rowsRef.current) return;
        autoResizeRef.current?.(proposed.cols, proposed.rows);
        return;
      }
      if (proposed.cols === terminal.cols && proposed.rows === terminal.rows) return;
      fitAddon.fit();
      const size = {cols: terminal.cols, rows: terminal.rows};
      const key = `${size.cols}x${size.rows}`;
      if (key === lastSizeRef.current) return;
      lastSizeRef.current = key;
      resizeRef.current(size.cols, size.rows);
    };
    const scheduleFitReport = () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(reportFit);
    };
    const observer = new ResizeObserver(scheduleFitReport);
    const onFocusIn = () => {
      scheduleFitReport();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleFitReport();
    };
    let touchScroll: {
      startX: number;
      startY: number;
      lastY: number;
      remainder: number;
      axis: 'pending' | 'horizontal' | 'vertical';
    } | null = null;
    const resetTouchScroll = () => { touchScroll = null; };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        resetTouchScroll();
        return;
      }
      const touch = event.touches[0];
      touchScroll = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        remainder: 0,
        axis: 'pending',
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touchScroll || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touchScroll.axis === 'pending') {
        const deltaX = Math.abs(touch.clientX - touchScroll.startX);
        const deltaY = Math.abs(touch.clientY - touchScroll.startY);
        if (Math.max(deltaX, deltaY) < 6) return;
        touchScroll.axis = deltaY > deltaX ? 'vertical' : 'horizontal';
        if (touchScroll.axis === 'vertical') terminal.clearSelection();
      }
      if (touchScroll.axis !== 'vertical') return;
      event.preventDefault();
      event.stopPropagation();
      const screenHeight = container.querySelector?.('.xterm-screen')?.getBoundingClientRect().height ?? 0;
      const rowHeight = (screenHeight > 0 ? screenHeight : container.clientHeight) / terminal.rows;
      if (!(rowHeight > 0)) return;
      const pixelDelta = touchScroll.lastY - touch.clientY + touchScroll.remainder;
      touchScroll.lastY = touch.clientY;
      const lines = Math.trunc(pixelDelta / rowHeight);
      touchScroll.remainder = pixelDelta - lines * rowHeight;
      if (lines !== 0) terminal.scrollLines(lines);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) resetTouchScroll();
    };
    container.addEventListener('touchstart', onTouchStart, {passive: true});
    container.addEventListener('touchmove', onTouchMove, {passive: false});
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', resetTouchScroll);
    container.addEventListener('focusin', onFocusIn);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
    const visualViewport = typeof window === 'undefined' ? null : window.visualViewport;
    visualViewport?.addEventListener('resize', scheduleFitReport);
    visualViewport?.addEventListener('scroll', scheduleFitReport);
    observer.observe(container);

    return () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      observer.disconnect();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', resetTouchScroll);
      container.removeEventListener('focusin', onFocusIn);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
      visualViewport?.removeEventListener('resize', scheduleFitReport);
      visualViewport?.removeEventListener('scroll', scheduleFitReport);
      dataDisposable.dispose();
      binaryDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = {...TERMINAL_THEMES[themeMode]};
  }, [themeMode]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || cols <= 0 || rows <= 0) return;
    if (terminal.cols !== cols || terminal.rows !== rows) terminal.resize(cols, rows);
    lastSizeRef.current = `${cols}x${rows}`;
  }, [cols, rows]);

  useEffect(() => {
    const gainedResizeOwnership = resizeEnabled && !previousResizeEnabledRef.current;
    previousResizeEnabledRef.current = resizeEnabled;
    if (!active) return;
    if (gainedResizeOwnership &&
      (typeof document === 'undefined' || document.visibilityState === 'visible')) {
      const size = fit();
      if (size) {
        lastSizeRef.current = `${size.cols}x${size.rows}`;
        if (size.cols !== colsRef.current || size.rows !== rowsRef.current) {
          resizeRef.current(size.cols, size.rows);
        }
      }
    }
    terminalRef.current?.focus();
  }, [active, resizeEnabled]);

  useEffect(() => {
    if (!copyMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && copyMenuRef.current?.contains(event.target)) return;
      setCopyMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCopyMenu(null);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [copyMenu]);

  const openCopyMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const terminal = terminalRef.current;
    if (!terminal?.hasSelection()) {
      setCopyMenu(null);
      return;
    }
    const text = terminal.getSelection();
    if (!text) return;
    event.preventDefault();
    setCopyMenu({left: event.clientX, top: event.clientY, text});
  };

  const copySelection = async () => {
    const text = copyMenu?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onCopy?.();
    } catch {
      // Clipboard failures do not produce a success notification.
    } finally {
      setCopyMenu(null);
      terminalRef.current?.focus();
    }
  };

  const handleCopy = () => {
    if (terminalRef.current?.hasSelection()) onCopy?.();
  };

  return (
    <div className="terminal-xterm-surface" onContextMenu={openCopyMenu} onCopy={handleCopy}>
      <div
        ref={containerRef}
        className="terminal-xterm-host"
        style={{'--wm-terminal-bg': TERMINAL_THEMES[themeMode].background} as React.CSSProperties}
      />
      {copyMenu ? (
        <div
          ref={copyMenuRef}
          className="terminal-copy-context-menu"
          role="menu"
          style={{left: copyMenu.left, top: copyMenu.top}}
        >
          <button type="button" role="menuitem" onClick={copySelection}>
            <Icon name="copy" />
            <span>Copy</span>
          </button>
        </div>
      ) : null}
    </div>
  );
});
