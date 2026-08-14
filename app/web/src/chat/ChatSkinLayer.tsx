import React from 'react';
import {clampChatSkinOpacity, clampChatSkinScale} from './chatSkin';

export type ChatSkinLayerProps = {
  src: string;
  scale: number;
  opacity: number;
};

export function ChatSkinLayer({src, scale, opacity}: ChatSkinLayerProps): React.JSX.Element {
  const normalizedScale = clampChatSkinScale(scale);
  return (
    <img
      className="chat-skin-layer"
      aria-hidden="true"
      style={{
        '--chat-skin-scale': `${normalizedScale * 100}%`,
        '--chat-skin-opacity': String(clampChatSkinOpacity(opacity)),
      } as React.CSSProperties}
      src={src}
      alt=""
      draggable={false}
    />
  );
}
