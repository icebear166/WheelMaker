import React from 'react';

export type ChatSkinLayerProps = {
  src: string;
  bottomOffset: number;
};

export function ChatSkinLayer({src, bottomOffset}: ChatSkinLayerProps): React.JSX.Element {
  return (
    <div
      className="chat-skin-layer"
      aria-hidden="true"
      style={{'--chat-skin-bottom-offset': `${Math.max(0, bottomOffset)}px`} as React.CSSProperties}
    >
      <img src={src} alt="" draggable={false} />
    </div>
  );
}
