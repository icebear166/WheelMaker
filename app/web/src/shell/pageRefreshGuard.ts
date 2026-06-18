export type PageRefreshGuardTarget = {
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

const KEY_OPTIONS: AddEventListenerOptions = {capture: true};

function isRefreshKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return key === 'f5' || ((event.ctrlKey === true || event.metaKey === true) && key === 'r');
}

export function installPageRefreshGuard(target: PageRefreshGuardTarget): () => void {
  const preventPageRefresh = (event: Event) => {
    if (isRefreshKey(event as KeyboardEvent)) {
      event.preventDefault();
    }
  };

  target.addEventListener('keydown', preventPageRefresh, KEY_OPTIONS);

  return () => {
    target.removeEventListener('keydown', preventPageRefresh, KEY_OPTIONS);
  };
}
