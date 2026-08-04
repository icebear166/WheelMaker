import React from 'react';

/**
 * Measures the floating permission dialog's rendered height so the chat turn
 * list can reserve matching bottom space and keep the latest turns visible
 * instead of being covered by the dialog. Reports 0 while no dialog is open.
 */
export function useChatPermissionDialogHeight(): {
  dialogRef: React.RefCallback<HTMLElement>;
  height: number;
} {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const [height, setHeight] = React.useState(0);

  React.useLayoutEffect(() => {
    if (!node) {
      setHeight(0);
      return undefined;
    }
    const update = () => setHeight(node.offsetHeight);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const dialogRef = React.useCallback((next: HTMLElement | null) => {
    setNode(current => (current === next ? current : next));
  }, []);

  return {dialogRef, height};
}
