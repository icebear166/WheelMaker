import React, {useRef, useState} from 'react';

export type ChatSkinSettingsProps = {
  previewUrl: string;
  fileName: string;
  busy: boolean;
  error: string;
  onSelect: (file: File) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Could not update the chat skin. Try another image or try again.';
}

export function ChatSkinSettings({
  previewUrl,
  fileName,
  busy,
  error,
  onSelect,
  onRemove,
}: ChatSkinSettingsProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const hasSkin = Boolean(previewUrl && fileName);
  const isBusy = busy || operationBusy;
  const visibleError = operationError || error;

  const runOperation = async (operation: () => void | Promise<void>) => {
    setOperationError('');
    setOperationBusy(true);
    try {
      await operation();
    } catch (operationFailure) {
      setOperationError(errorMessage(operationFailure));
    } finally {
      setOperationBusy(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void runOperation(() => onSelect(file));
  };

  return (
    <div className="chat-skin-settings" aria-label="Chat skin">
      <div className="chat-skin-settings-copy">
        <div className="chat-skin-settings-title">Chat skin</div>
        <div className="chat-skin-settings-description">
          A subtle local image behind the current chat.
        </div>
      </div>
      {hasSkin ? (
        <div className="chat-skin-settings-preview">
          <img src={previewUrl} alt={`${fileName} preview`} />
          <span className="chat-skin-settings-name">{fileName}</span>
        </div>
      ) : (
        <div className="chat-skin-settings-empty">No image selected</div>
      )}
      <div className="chat-skin-settings-actions">
        <input
          ref={inputRef}
          className="chat-skin-settings-input"
          type="file"
          accept="image/*"
          disabled={isBusy}
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="set-btn set-btn--primary chat-skin-settings-action"
          disabled={isBusy}
          onClick={() => inputRef.current?.click()}
        >
          {hasSkin ? 'Replace' : 'Choose image'}
        </button>
        {hasSkin ? (
          <button
            type="button"
            className="set-btn set-btn--danger chat-skin-settings-action"
            disabled={isBusy}
            onClick={() => { void runOperation(onRemove); }}
          >
            Remove
          </button>
        ) : null}
      </div>
      {visibleError ? (
        <div className="chat-skin-settings-error" role="alert">
          {visibleError}
        </div>
      ) : null}
    </div>
  );
}
