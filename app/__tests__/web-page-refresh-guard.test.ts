import fs from 'fs';
import path from 'path';

import { installPageRefreshGuard } from '../web/src/shell/pageRefreshGuard';

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

function createKeyboardEvent(input: {ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; key?: string}): Event {
  let prevented = false;
  return {
    ctrlKey: input.ctrlKey === true,
    metaKey: input.metaKey === true,
    shiftKey: input.shiftKey === true,
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

describe('page refresh guard', () => {
  test('prevents browser refresh keyboard shortcuts without blocking unrelated shortcuts', () => {
    const target = new RecordingEventTarget();
    const uninstall = installPageRefreshGuard(target);

    expect(target.entries.find(entry => entry.type === 'keydown')?.options).toMatchObject({
      capture: true,
    });

    for (const event of [
      createKeyboardEvent({key: 'F5'}),
      createKeyboardEvent({key: 'F5', shiftKey: true}),
      createKeyboardEvent({ctrlKey: true, key: 'r'}),
      createKeyboardEvent({ctrlKey: true, shiftKey: true, key: 'R'}),
      createKeyboardEvent({metaKey: true, key: 'r'}),
    ]) {
      target.dispatch('keydown', event);
      expect(event.defaultPrevented).toBe(true);
    }

    const plainR = createKeyboardEvent({key: 'r'});
    target.dispatch('keydown', plainR);
    expect(plainR.defaultPrevented).toBe(false);

    const saveShortcut = createKeyboardEvent({ctrlKey: true, key: 's'});
    target.dispatch('keydown', saveShortcut);
    expect(saveShortcut.defaultPrevented).toBe(false);

    uninstall();
    expect(target.entries).toHaveLength(0);
  });

  test('installs the page refresh guard during web startup', () => {
    const main = readWorkspaceApp();

    expect(main).toContain("import { installPageRefreshGuard } from '../shell/pageRefreshGuard';");
    expect(main).toContain('installPageRefreshGuard(window);');
  });
});
