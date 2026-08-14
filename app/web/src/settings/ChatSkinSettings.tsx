import React, {useRef, useState} from 'react';
import {
  CHAT_SKIN_OPACITY_MAX,
  CHAT_SKIN_OPACITY_MIN,
  CHAT_SKIN_SCALE_MAX,
  CHAT_SKIN_SCALE_MIN,
} from '../chat/chatSkin';

export type ChatSkinSettingsProps = {
  previewUrl: string;
  fileName: string;
  scale: number;
  opacity: number;
  busy: boolean;
  error: string;
  onSelect: (file: File) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onScaleChange: (value: number) => void;
  onOpacityChange: (value: number) => void;
};

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') {
    return 'Local storage is full. The current skin was kept; remove it or free browser storage, then try again.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Could not update the chat skin. Try another image or try again.';
}

export function ChatSkinSettings({
  previewUrl,
  fileName,
  scale,
  opacity,
  busy,
  error,
  onSelect,
  onRemove,
  onScaleChange,
  onOpacityChange,
}: ChatSkinSettingsProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const hasSkin = Boolean(previewUrl);
  const displayFileName = fileName || 'Selected image';
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
          <img src={previewUrl} alt={`${displayFileName} preview`} />
          <span className="chat-skin-settings-name">{displayFileName}</span>
        </div>
      ) : (
        <div className="chat-skin-settings-empty">No image selected</div>
      )}
      <div className="chat-skin-settings-controls">
        <label className="chat-skin-settings-control">
          <span>
            <span>Scale</span>
            <output>{Math.round(scale * 100)}%</output>
          </span>
          <input
            type="range"
            min={CHAT_SKIN_SCALE_MIN}
            max={CHAT_SKIN_SCALE_MAX}
            step="0.05"
            value={scale}
            disabled={isBusy || !hasSkin}
            onChange={event => onScaleChange(Number(event.target.value))}
          />
        </label>
        <label className="chat-skin-settings-control">
          <span>
            <span>Opacity</span>
            <output>{Math.round(opacity * 100)}%</output>
          </span>
          <input
            type="range"
            min={CHAT_SKIN_OPACITY_MIN}
            max={CHAT_SKIN_OPACITY_MAX}
            step="0.01"
            value={opacity}
            disabled={isBusy || !hasSkin}
            onChange={event => onOpacityChange(Number(event.target.value))}
          />
        </label>
      </div>
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
