import React, { type ReactNode } from 'react';

export type GitSurfaceProps = {
  children: ReactNode;
};

export function GitSurface({ children }: GitSurfaceProps) {
  return <div className="content">{children}</div>;
}
