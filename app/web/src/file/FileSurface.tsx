import React, { type ReactNode } from 'react';

export type FileSurfaceProps = {
  children: ReactNode;
};

export function FileSurface({ children }: FileSurfaceProps) {
  return <div className="content">{children}</div>;
}
