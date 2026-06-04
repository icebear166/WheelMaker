import React, { type ReactNode } from 'react';

export type FilePreviewPaneProps = {
  children: ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: React.UIEventHandler<HTMLDivElement>;
};

export function FilePreviewPane({
  children,
  scrollRef,
  onScroll,
}: FilePreviewPaneProps) {
  return (
    <div
      ref={scrollRef}
      className="scroll-panel"
      onScroll={onScroll}
    >
      {children}
    </div>
  );
}
