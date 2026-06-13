export type DesktopZoomGuardTarget = {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ): void;
};

const WHEEL_OPTIONS: AddEventListenerOptions = {passive: false, capture: true};
const KEY_OPTIONS: AddEventListenerOptions = {capture: true};
const ZOOM_KEYS = new Set(['+', '=', '-', '0']);

function hasZoomModifier(event: Event): boolean {
  const input = event as KeyboardEvent | WheelEvent;
  return input.ctrlKey === true || input.metaKey === true;
}

function isZoomKey(event: KeyboardEvent): boolean {
  return hasZoomModifier(event) && ZOOM_KEYS.has(event.key);
}

export function installDesktopZoomGuard(target: DesktopZoomGuardTarget): () => void {
  const preventZoomWheel = (event: Event) => {
    if (hasZoomModifier(event)) {
      event.preventDefault();
    }
  };
  const preventZoomKey = (event: Event) => {
    if (isZoomKey(event as KeyboardEvent)) {
      event.preventDefault();
    }
  };

  target.addEventListener('wheel', preventZoomWheel, WHEEL_OPTIONS);
  target.addEventListener('keydown', preventZoomKey, KEY_OPTIONS);

  return () => {
    target.removeEventListener('wheel', preventZoomWheel, WHEEL_OPTIONS);
    target.removeEventListener('keydown', preventZoomKey, KEY_OPTIONS);
  };
}
