import React, {type ReactNode, useEffect, useRef, useState} from 'react';
import {Icon} from '../common/Icon';
import type {RegistryTerminal} from '../registry/registryTypes';
import {WorkbenchChrome} from '../shell/workbench/WorkbenchChrome';

export type TerminalWorkbenchProps = {
  mode: 'desktop' | 'mobile';
  terminals: RegistryTerminal[];
  activeKey: string;
  unavailableHubIds: Record<string, true>;
  onSelect: (key: string) => void;
  onCreate: () => void;
  onRequestClose: (terminal: RegistryTerminal) => void;
  onRestart: (terminal: RegistryTerminal) => void;
  onClaimResize: () => void;
  onSendBytes: (data: Uint8Array) => void;
  onCloseSurface?: () => void;
  mobileFullscreen?: boolean;
  onMobileFullscreenChange?: (fullscreen: boolean) => void;
  children?: ReactNode;
};

const MOBILE_KEYS: Array<{label: string; aria: string; sequence: string}> = [
  {label: 'Esc', aria: 'Terminal Escape', sequence: '\x1b'},
  {label: 'Tab', aria: 'Terminal Tab', sequence: '\t'},
  {label: 'Enter', aria: 'Terminal Enter', sequence: '\r'},
  {label: '←', aria: 'Terminal Arrow Left', sequence: '\x1b[D'},
  {label: '↑', aria: 'Terminal Arrow Up', sequence: '\x1b[A'},
  {label: '↓', aria: 'Terminal Arrow Down', sequence: '\x1b[B'},
  {label: '→', aria: 'Terminal Arrow Right', sequence: '\x1b[C'},
  {label: 'Ctrl+C', aria: 'Terminal Ctrl+C', sequence: '\x03'},
  {label: 'Ctrl+D', aria: 'Terminal Ctrl+D', sequence: '\x04'},
];

export function TerminalWorkbench(props: TerminalWorkbenchProps) {
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const active = props.terminals.find(item => terminalKey(item) === props.activeKey);
  const activeTitle = active?.projectName || active?.terminalId || 'Terminal';

  const sendSequence = (sequence: string) => {
    props.onSendBytes(new TextEncoder().encode(applyModifiers(sequence, ctrl, alt)));
    setCtrl(false);
    setAlt(false);
  };
  const paste = async () => {
    const text = await globalThis.navigator?.clipboard?.readText?.();
    if (text) props.onSendBytes(new TextEncoder().encode(text));
    setCtrl(false);
    setAlt(false);
  };

  useEffect(() => {
    setActionsMenuOpen(false);
  }, [props.activeKey]);

  useEffect(() => {
    if (!actionsMenuOpen) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || !actionsMenuRef.current?.contains(target)) setActionsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionsMenuOpen]);

  const actions = (
    <>
      <button
        type="button"
        className="terminal-toolbar-action"
        aria-label="Create terminal"
        data-tooltip="Create terminal"
        onClick={props.onCreate}
      >
        <Icon name="plus" />
        <span>New</span>
      </button>
      {active ? (
        <button
          type="button"
          className="terminal-toolbar-action terminal-fit"
          aria-label="Fit terminal to this screen"
          data-tooltip="Fit terminal to this screen"
          onClick={props.onClaimResize}
        >
          <Icon name="maximize" />
          <span>Fit</span>
        </button>
      ) : null}
      {active && active.status !== 'running' ? (
        <div ref={actionsMenuRef} className="terminal-more">
          <button
            type="button"
            className="workbench-chrome-icon-button"
            aria-label="Terminal actions"
            data-tooltip="Terminal actions"
            aria-haspopup="menu"
            aria-expanded={actionsMenuOpen}
            onClick={() => setActionsMenuOpen(open => !open)}
          >
            <Icon name="ellipsis" />
          </button>
          {actionsMenuOpen ? (
            <div className="terminal-actions-menu" role="menu" aria-label="Terminal actions">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActionsMenuOpen(false);
                  props.onRestart(active);
                }}
              >
                <Icon name="refreshCw" />
                Restart
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const keybar = props.mode === 'mobile' ? (
    <div className="terminal-keybar" aria-label="Terminal shortcuts">
      <button type="button" aria-label="Terminal Ctrl modifier" aria-pressed={ctrl} onClick={() => setCtrl(value => !value)}>Ctrl</button>
      <button type="button" aria-label="Terminal Alt modifier" aria-pressed={alt} onClick={() => setAlt(value => !value)}>Alt</button>
      {MOBILE_KEYS.map(key => (
        <button key={key.aria} type="button" aria-label={key.aria} onClick={() => sendSequence(key.sequence)}>{key.label}</button>
      ))}
      <button type="button" aria-label="Terminal Paste" onClick={() => { paste().catch(() => undefined); }}>Paste</button>
    </div>
  ) : null;

  return (
    <WorkbenchChrome
      mode={props.mode}
      surfaceClassName="terminal-workbench"
      ariaLabel="Terminal workbench"
      title={activeTitle}
      titleTooltip={active ? `${active.hubId} · ${active.initialCwd}` : 'Terminal'}
      closeLabel={props.mode === 'mobile' ? 'Back to Chat' : 'Close terminal panel'}
      onClose={() => props.onCloseSurface?.()}
      actions={actions}
      tabsAriaLabel="Terminals"
      tabsClassName="terminal-tabs"
      tabs={props.terminals.map(item => {
        const key = terminalKey(item);
        const unavailable = props.unavailableHubIds[item.hubId] === true;
        const label = item.projectName || item.terminalId || 'Terminal';
        return (
          <div key={key} className={`terminal-tab${key === props.activeKey ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={key === props.activeKey}
              className="terminal-tab-open"
              onClick={() => props.onSelect(key)}
              data-tooltip={`${item.hubId} · ${item.initialCwd}`}
            >
              <span className={`terminal-status ${unavailable ? 'unavailable' : item.status}`} aria-hidden="true" />
              <span className="terminal-tab-label">{label}</span>
            </button>
            <button
              type="button"
              className="terminal-tab-close"
              aria-label={`Close terminal ${label}`}
              data-tooltip={`Close terminal ${label}`}
              onClick={event => {
                event.stopPropagation();
                props.onRequestClose(item);
              }}
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })}
      mobileFullscreen={props.mobileFullscreen}
      onMobileFullscreenChange={props.onMobileFullscreenChange}
      bodyClassName="terminal-content"
      footer={keybar}
    >
      {props.children ?? <div className="terminal-empty">Create a terminal to begin.</div>}
    </WorkbenchChrome>
  );
}

function terminalKey(terminal: RegistryTerminal): string {
  return `${terminal.hubId}:${terminal.terminalId}`;
}

function applyModifiers(sequence: string, ctrl: boolean, alt: boolean): string {
  const arrow = /^\x1b\[([ABCD])$/.exec(sequence);
  if (arrow && (ctrl || alt)) {
    const modifier = ctrl && alt ? 7 : ctrl ? 5 : 3;
    return `\x1b[1;${modifier}${arrow[1]}`;
  }
  let result = sequence;
  if (ctrl && result.length === 1) result = String.fromCharCode(result.toUpperCase().charCodeAt(0) & 0x1f);
  if (alt) result = `\x1b${result}`;
  return result;
}
