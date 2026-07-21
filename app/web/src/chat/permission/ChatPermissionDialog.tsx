import React from 'react';

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
};

export const ChatPermissionDialog = React.memo(function ChatPermissionDialog({
  title,
  detailsText,
  options,
  submittingOptionId,
  error,
  onSelect,
}: ChatPermissionDialogProps) {
  const submitting = !!submittingOptionId;
  const firstOptionRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    firstOptionRef.current?.focus();
  }, []);
  return (
    <div className="chat-permission-overlay">
      <section
        className="chat-permission-dialog"
        role="dialog"
        aria-labelledby="chat-permission-dialog-title"
        aria-describedby={detailsText ? 'chat-permission-dialog-details' : undefined}
      >
        <div className="chat-permission-dialog-kicker">
          <span className="codicon codicon-question" aria-hidden="true" />
          Agent needs your decision
        </div>
        <h2 id="chat-permission-dialog-title" className="chat-permission-dialog-title">{title}</h2>
        {detailsText ? (
          <p id="chat-permission-dialog-details" className="chat-permission-dialog-details">{detailsText}</p>
        ) : null}
        <div className="chat-permission-options">
          {options.map((option, index) => (
            <button
              key={option.optionId}
              ref={index === 0 ? firstOptionRef : undefined}
              type="button"
              className="chat-permission-option"
              disabled={submitting}
              onClick={() => onSelect(option.optionId)}
            >
              <span className="chat-permission-option-name">{option.name}</span>
              {submittingOptionId === option.optionId ? (
                <span className="codicon codicon-loading codicon-modifier-spin" aria-label="Submitting" />
              ) : (
                <span className="codicon codicon-chevron-right" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        {error ? <div className="chat-permission-dialog-error" role="alert">{error}</div> : null}
      </section>
    </div>
  );
});
