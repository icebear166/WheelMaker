import React, {useRef, useState} from 'react';
import {
  CHAT_SKIN_OPACITY_MAX,
  CHAT_SKIN_OPACITY_MIN,
  CHAT_SKIN_OFFSET_MAX,
  CHAT_SKIN_OFFSET_MIN,
  CHAT_SKIN_SCALE_MAX,
  CHAT_SKIN_SCALE_MIN,
} from '../chat/chatSkin';

export type ChatSkinSettingsProps = {
  previewUrl: string;
  fileName: string;
  scale: number;
  opacity: number;
  offset: number;
  busy: boolean;
  error: string;
  onSelect: (file: File) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onScaleChange: (value: number) => void;
  onOpacityChange: (value: number) => void;
  onOffsetChange: (value: number) => void;
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
  offset,
  busy,
  error,
  onSelect,
  onRemove,
  onScaleChange,
  onOpacityChange,
  onOffsetChange,
}: ChatSkinSettingsProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [controlsOpen, setControlsOpen] = useState(false);
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

  const handleRemove = () => {
    void runOperation(async () => {
      await onRemove();
      setControlsOpen(false);
    });
  };

  return (
    <div className="chat-skin-settings" aria-label="Chat skin">
      <input
        ref={inputRef}
        className="chat-skin-settings-input"
        type="file"
        accept="image/*"
        disabled={isBusy}
        onChange={handleFileChange}
      />
      <div className="chat-skin-settings-row settings-row">
        <span className="settings-row-label chat-skin-settings-label">
          <span className="chat-skin-settings-title">Chat skin</span>
          <span className="chat-skin-settings-status">
            {hasSkin ? displayFileName : 'Not set'}
          </span>
        </span>
        <span className="chat-skin-settings-actions">
          <button
            type="button"
            className="chat-skin-settings-preview"
            disabled={isBusy}
            aria-label={hasSkin ? 'Replace chat skin image' : 'Choose chat skin image'}
            onClick={() => inputRef.current?.click()}
          >
            {hasSkin ? <img src={previewUrl} alt={`${displayFileName} preview`} /> : 'Choose image'}
          </button>
          {hasSkin ? (
            <>
              <button
                type="button"
                className="chat-skin-settings-remove set-btn set-btn--danger"
                disabled={isBusy}
                aria-label="Remove chat skin"
                onClick={handleRemove}
              >
                Remove
              </button>
              <button
                type="button"
                className="chat-skin-settings-adjust"
                disabled={isBusy}
                aria-expanded={controlsOpen}
                aria-controls="chat-skin-controls"
                onClick={() => setControlsOpen(open => !open)}
              >
                Adjust
              </button>
            </>
          ) : null}
        </span>
      </div>
      {hasSkin && controlsOpen ? (
        <div className="chat-skin-settings-controls" id="chat-skin-controls" aria-label="Chat skin adjustments">
          <label className="chat-skin-settings-control">
            <span>
              <span>Scale</span>
              <output>{Math.round(scale * 100)}%</output>
            </span>
            <input
              type="range"
              min={CHAT_SKIN_SCALE_MIN * 100}
              max={CHAT_SKIN_SCALE_MAX * 100}
              step="1"
              value={Math.round(scale * 100)}
              disabled={isBusy}
              onChange={event => onScaleChange(Number(event.target.value) / 100)}
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
              disabled={isBusy}
              onChange={event => onOpacityChange(Number(event.target.value))}
            />
          </label>
          <label className="chat-skin-settings-control">
            <span>
              <span>Image offset</span>
              <output>{offset > 0 ? `+${Math.round(offset)}` : Math.round(offset)}px</output>
            </span>
            <input
              type="range"
              min={CHAT_SKIN_OFFSET_MIN}
              max={CHAT_SKIN_OFFSET_MAX}
              step="1"
              value={Math.round(offset)}
              disabled={isBusy}
              onChange={event => onOffsetChange(Number(event.target.value))}
            />
          </label>
        </div>
      ) : null}
      {visibleError ? (
        <div className="chat-skin-settings-error" role="alert">
          {visibleError}
        </div>
      ) : null}
    </div>
  );
}
