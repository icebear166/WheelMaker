import fs from 'fs';
import path from 'path';

import { installDesktopZoomGuard } from '../web/src/shell/desktopZoomGuard';

type ListenerEntry = {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: AddEventListenerOptions | boolean;
};

class RecordingEventTarget {
  entries: ListenerEntry[] = [];

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.entries.push({type, listener, options});
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ): void {
    this.entries = this.entries.filter(entry =>
      entry.type !== type || entry.listener !== listener || entry.options !== options,
    );
  }

  dispatch(type: string, event: Event): void {
    for (const entry of this.entries.filter(item => item.type === type)) {
      if (typeof entry.listener === 'function') {
        entry.listener(event);
      } else {
        entry.listener.handleEvent(event);
      }
    }
  }
}

function createModifierEvent(input: {ctrlKey?: boolean; metaKey?: boolean; key?: string}): Event {
  let prevented = false;
  return {
    ctrlKey: input.ctrlKey === true,
    metaKey: input.metaKey === true,
    key: input.key ?? '',
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as Event;
}

function readWorkspaceApp(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

describe('desktop viewport zoom guard', () => {
  test('prevents browser zoom wheel gestures without blocking normal scrolling', () => {
    const target = new RecordingEventTarget();
    const uninstall = installDesktopZoomGuard(target);

    expect(target.entries.find(entry => entry.type === 'wheel')?.options).toMatchObject({
      passive: false,
      capture: true,
    });

    const normalWheel = createModifierEvent({});
    target.dispatch('wheel', normalWheel);
    expect(normalWheel.defaultPrevented).toBe(false);

    const ctrlWheel = createModifierEvent({ctrlKey: true});
    target.dispatch('wheel', ctrlWheel);
    expect(ctrlWheel.defaultPrevented).toBe(true);

    const metaWheel = createModifierEvent({metaKey: true});
    target.dispatch('wheel', metaWheel);
    expect(metaWheel.defaultPrevented).toBe(true);

    uninstall();
    expect(target.entries).toHaveLength(0);
  });

  test('prevents browser zoom keyboard shortcuts without blocking unrelated shortcuts', () => {
    const target = new RecordingEventTarget();
    installDesktopZoomGuard(target);

    for (const key of ['+', '=', '-', '0']) {
      const event = createModifierEvent({ctrlKey: true, key});
      target.dispatch('keydown', event);
      expect(event.defaultPrevented).toBe(true);
    }

    const unrelatedShortcut = createModifierEvent({ctrlKey: true, key: 's'});
    target.dispatch('keydown', unrelatedShortcut);
    expect(unrelatedShortcut.defaultPrevented).toBe(false);
  });

  test('installs the desktop zoom guard during web startup', () => {
    const main = readWorkspaceApp();

    expect(main).toContain("import { installDesktopZoomGuard } from '../shell/desktopZoomGuard';");
    expect(main).toContain('installDesktopZoomGuard(window);');
  });
});
