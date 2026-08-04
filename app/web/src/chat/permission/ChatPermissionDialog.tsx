import React from 'react';
import {ChatIcon} from '../ChatIcon';

export type ChatPermissionOption = {
  optionId: string;
  name: string;
  kind: string;
};

export type ChatPermissionDialogProps = {
  title: string;
  detailsText: string;
  options: ChatPermissionOption[];
  submittingOptionId: string;
  error: string;
  onSelect: (optionId: string) => void;
  rootRef?: React.Ref<HTMLElement>;
};

export const ChatPermissionDialog = React.memo(function ChatPermissionDialog({
  title,
  detailsText,
  options,
  submittingOptionId,
  error,
  onSelect,
  rootRef,
}: ChatPermissionDialogProps) {
  const submitting = !!submittingOptionId;
  const headline = detailsText || title;
  const context = detailsText && title !== detailsText ? title : '';
  return (
    <section
      ref={rootRef}
      className="chat-permission-dialog"
      role="dialog"
      aria-labelledby="chat-permission-dialog-title"
      aria-describedby={context ? 'chat-permission-dialog-details' : undefined}
    >
      <div className="chat-permission-dialog-kicker">
        <ChatIcon name="help" />
        Agent needs your decision
      </div>
      <h2 id="chat-permission-dialog-title" className="chat-permission-dialog-title">{headline}</h2>
      {context ? (
        <p id="chat-permission-dialog-details" className="chat-permission-dialog-details">{context}</p>
      ) : null}
      <div className="chat-permission-options">
        {options.map(option => (
          <button
            key={option.optionId}
            type="button"
            className="chat-permission-option"
            disabled={submitting}
            onClick={() => onSelect(option.optionId)}
          >
            <span className="chat-permission-option-name">{option.name}</span>
            {submittingOptionId === option.optionId ? (
              <ChatIcon name="loader" spin ariaLabel="Submitting" />
            ) : (
              <ChatIcon name="chevronRight" />
            )}
          </button>
        ))}
      </div>
      {error ? <div className="chat-permission-dialog-error" role="alert">{error}</div> : null}
    </section>
  );
});
