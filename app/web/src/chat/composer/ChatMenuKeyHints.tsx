import React from 'react';

export type ChatMenuKeyHintsProps = {
  hints: [keys: string, label: string][];
};

export function ChatMenuKeyHints({hints}: ChatMenuKeyHintsProps) {
  return (
    <div className="chat-menu-footer" aria-hidden="true">
      {hints.map(([keys, label]) => (
        <span key={label} className="chat-menu-hint">
          <kbd>{keys}</kbd>
          {label}
        </span>
      ))}
    </div>
  );
}
