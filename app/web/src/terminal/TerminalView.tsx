import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';

export type TerminalViewHandle = {
  resetAndWrite(data: Uint8Array): Promise<void>;
  write(data: Uint8Array): void;
  focus(): void;
  fit(): {cols: number; rows: number} | null;
};

export type TerminalViewProps = {
  active: boolean;
  resizeEnabled: boolean;
  cols: number;
  rows: number;
  onInput: (data: Uint8Array) => void;
  onResize: (cols: number, rows: number) => void;
};

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  {active, resizeEnabled, cols, rows, onInput, onResize},
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const activeRef = useRef(active);
  const resizeEnabledRef = useRef(resizeEnabled);
  const resizeFrameRef = useRef<number | null>(null);
  const lastSizeRef = useRef('');
  inputRef.current = onInput;
  resizeRef.current = onResize;
  activeRef.current = active;
  resizeEnabledRef.current = resizeEnabled;

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
    const terminal = new Terminal({
      scrollback: 10000,
      cols,
      rows,
      convertEol: false,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      theme: {background: '#101214'},
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData(data => inputRef.current(new TextEncoder().encode(data)));
    const binaryDisposable = terminal.onBinary(data => {
      const bytes = new Uint8Array(data.length);
      for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index) & 0xff;
      inputRef.current(bytes);
    });
    const reportFit = () => {
      resizeFrameRef.current = null;
      const size = fit();
      if (!size || !activeRef.current || !resizeEnabledRef.current) return;
      const key = `${size.cols}x${size.rows}`;
      if (key === lastSizeRef.current) return;
      lastSizeRef.current = key;
      resizeRef.current(size.cols, size.rows);
    };
    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(reportFit);
    });
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
      }
      if (touchScroll.axis !== 'vertical') return;
      event.preventDefault();
      event.stopPropagation();
      const rowHeight = container.clientHeight / terminal.rows;
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
    observer.observe(container);
    if (resizeEnabledRef.current) fitAddon.fit();

    return () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      observer.disconnect();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', resetTouchScroll);
      dataDisposable.dispose();
      binaryDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    if (resizeEnabled) fit();
    terminalRef.current?.focus();
  }, [active, resizeEnabled]);

  useEffect(() => {
    if (!resizeEnabled && cols > 0 && rows > 0) terminalRef.current?.resize(cols, rows);
  }, [cols, resizeEnabled, rows]);

  return <div ref={containerRef} className="terminal-xterm-host" />;
});
