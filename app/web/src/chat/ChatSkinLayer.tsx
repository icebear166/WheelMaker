import React from 'react';
import {clampChatSkinOpacity, clampChatSkinScale} from './chatSkin';

export type ChatSkinLayerProps = {
  src: string;
  scale: number;
  opacity: number;
};

export function ChatSkinLayer({src, scale, opacity}: ChatSkinLayerProps): React.JSX.Element {
  return (
    <div
      className="chat-skin-layer"
      aria-hidden="true"
      style={{
        '--chat-skin-scale': String(clampChatSkinScale(scale)),
        '--chat-skin-opacity': String(clampChatSkinOpacity(opacity)),
      } as React.CSSProperties}
    >
      <img src={src} alt="" draggable={false} />
    </div>
  );
}
