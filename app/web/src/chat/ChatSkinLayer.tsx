import React from 'react';
import {
  clampChatSkinOffset,
  clampChatSkinOpacity,
  clampChatSkinScale,
} from './chatSkin';

export type ChatSkinLayerProps = {
  src: string;
  scale: number;
  opacity: number;
  anchorRight: number;
  anchorBottom: number;
  offset: number;
};

export function ChatSkinLayer({
  src,
  scale,
  opacity,
  anchorRight,
  anchorBottom,
  offset,
}: ChatSkinLayerProps): React.JSX.Element {
  const normalizedScale = clampChatSkinScale(scale);
  const normalizedAnchorRight = Number.isFinite(anchorRight) ? Math.round(anchorRight) : 0;
  const normalizedAnchorBottom = Number.isFinite(anchorBottom) ? Math.round(anchorBottom) : 0;
  return (
    <img
      className="chat-skin-layer"
      aria-hidden="true"
      style={{
        '--chat-skin-scale': `${normalizedScale * 100}%`,
        '--chat-skin-opacity': String(clampChatSkinOpacity(opacity)),
        '--chat-skin-anchor-right': `${normalizedAnchorRight}px`,
        '--chat-skin-anchor-bottom': `${normalizedAnchorBottom}px`,
        '--chat-skin-offset': `${clampChatSkinOffset(offset)}px`,
      } as React.CSSProperties}
      src={src}
      alt=""
      draggable={false}
    />
  );
}
