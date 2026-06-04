import React, { type ReactNode } from 'react';

export type ChatSurfaceProps = {
  children: ReactNode;
};

export function ChatSurface({ children }: ChatSurfaceProps) {
  return <div className="content">{children}</div>;
}
