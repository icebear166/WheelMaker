import React, { type ReactNode } from 'react';

export type ChatSessionNavProps = {
  className: string;
  dataSessionListDensity?: string;
  children: ReactNode;
};

export function ChatSessionNav({ className, dataSessionListDensity, children }: ChatSessionNavProps) {
  return (
    <div className={className} data-session-list-density={dataSessionListDensity}>
      {children}
    </div>
  );
}
