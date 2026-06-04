import React, { type ReactNode } from 'react';

export type ChatSessionNavProps = {
  className: string;
  children: ReactNode;
};

export function ChatSessionNav({ className, children }: ChatSessionNavProps) {
  return <div className={className}>{children}</div>;
}
