import type {KeyboardEvent as ReactKeyboardEvent} from 'react';

function enabledMenuItems(container: HTMLElement | null): HTMLButtonElement[] {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
}

export function focusFirstMenuItem(container: HTMLElement | null): void {
  enabledMenuItems(container)[0]?.focus();
}

export function handleMenuKeyDown(
  event: ReactKeyboardEvent,
  container: HTMLElement | null,
): void {
  const items = enabledMenuItems(container);
  if (items.length === 0) return;

  let nextIndex: number | null = null;
  if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const activeElement = container?.ownerDocument.activeElement;
    const activeIndex = items.indexOf(activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    nextIndex = activeIndex < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (activeIndex + direction + items.length) % items.length;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  items[nextIndex]?.focus();
}
