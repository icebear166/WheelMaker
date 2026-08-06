import React, {useEffect, useRef} from 'react';
import {focusFirstMenuItem, handleMenuKeyDown} from '../common/menuKeyboardNavigation';

type PreviewTabContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
};

export function PreviewTabContextMenu({x, y, onClose, children}: PreviewTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    focusFirstMenuItem(menuRef.current);
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handleClose = () => onClose();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="preview-tab-context-menu"
      style={{left: x, top: y}}
      role="menu"
      aria-label="Preview tab actions"
      onKeyDown={event => handleMenuKeyDown(event, menuRef.current)}
    >
      {children}
    </div>
  );
}
