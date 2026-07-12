import React, {type ReactNode, useState} from 'react';
import type {RegistryTerminal} from '../registry/registryTypes';

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
  const active = props.terminals.find(item => terminalKey(item) === props.activeKey);

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

  return (
    <div className={`terminal-workbench ${props.mode}`}>
      <div className="terminal-tabbar" role="tablist" aria-label="Terminals">
        {props.mode === 'mobile' ? (
          <button type="button" className="terminal-back" aria-label="Back to Chat" onClick={props.onCloseSurface}>
            <span className="codicon codicon-chevron-left" aria-hidden="true" />
          </button>
        ) : null}
        <div className="terminal-tabs">
          {props.terminals.map(item => {
            const key = terminalKey(item);
            const unavailable = props.unavailableHubIds[item.hubId] === true;
            return (
              <button key={key} type="button" role="tab" aria-selected={key === props.activeKey}
                className={`terminal-tab${key === props.activeKey ? ' active' : ''}`}
                onClick={() => props.onSelect(key)} title={`${item.hubId} · ${item.projectName} · ${item.initialCwd}`}>
                <span className={`terminal-status ${unavailable ? 'unavailable' : item.status}`} aria-hidden="true" />
                <span className="terminal-tab-label">{item.projectName || item.terminalId}</span>
                <span className="terminal-tab-hub">{item.hubId}</span>
                <span role="button" tabIndex={0} className="terminal-tab-close" aria-label={`Close terminal ${item.projectName || item.terminalId}`}
                  onClick={event => { event.stopPropagation(); props.onRequestClose(item); }}>×</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="terminal-new" aria-label="Create terminal" onClick={props.onCreate}>+</button>
        {active ? (
          <div className="terminal-actions">
            {active.status !== 'running' ? (
              <button type="button" className="terminal-restart" onClick={() => props.onRestart(active)}>Restart</button>
            ) : null}
            <button type="button" className="terminal-fit" aria-label="Fit terminal to this screen" onClick={props.onClaimResize}>
              {props.mode === 'mobile' ? 'Fit' : 'Fit to this screen'}
            </button>
          </div>
        ) : null}
      </div>
      <div className="terminal-content">{props.children ?? <div className="terminal-empty">Create a terminal to begin.</div>}</div>
      {props.mode === 'mobile' ? (
        <div className="terminal-keybar" aria-label="Terminal shortcuts">
          <button type="button" aria-label="Terminal Ctrl modifier" aria-pressed={ctrl} onClick={() => setCtrl(value => !value)}>Ctrl</button>
          <button type="button" aria-label="Terminal Alt modifier" aria-pressed={alt} onClick={() => setAlt(value => !value)}>Alt</button>
          {MOBILE_KEYS.map(key => (
            <button key={key.aria} type="button" aria-label={key.aria} onClick={() => sendSequence(key.sequence)}>{key.label}</button>
          ))}
          <button type="button" aria-label="Terminal Paste" onClick={() => { paste().catch(() => undefined); }}>Paste</button>
        </div>
      ) : null}
    </div>
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
