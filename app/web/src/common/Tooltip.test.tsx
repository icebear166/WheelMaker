/**
 * @jest-environment jsdom
 */
import React, {act} from 'react';
import {createRoot, Root} from 'react-dom/client';
import {GlobalTooltip} from './Tooltip';
import {shellTransientSurfaceStore} from '../shell/shellSurfaceCoordinator';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

function mountAnchor(attrs = 'data-tooltip="Copy code"'): {anchor: Element} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = `<button id="anchor" ${attrs}>btn</button>`;
  return {anchor: host.querySelector('#anchor')!};
}

function mockTouchOnlyMatchMedia(): void {
  (window as unknown as {matchMedia: (query: string) => MediaQueryList}).matchMedia = (query: string) => ({
    matches: query === '(hover: none)',
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

describe('GlobalTooltip', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    document.body.innerHTML = '';
    shellTransientSurfaceStore.reset();
    delete (window as unknown as {matchMedia?: unknown}).matchMedia;
    jest.useRealTimers();
  });

  const render = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<GlobalTooltip />));
  };
  const tooltip = () => document.body.querySelector('.sl-tooltip');
  const fire = (el: Element | Document, event: Event) => {
    act(() => {
      el.dispatchEvent(event);
    });
  };

  test('shows anchor text only after the hover intent delay', () => {
    const {anchor} = mountAnchor();
    render();
    fire(anchor, new MouseEvent('mouseover', {bubbles: true}));
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(tooltip()).toBeNull();
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(tooltip()?.textContent).toBe('Copy code');
  });

  test('shows immediately on keyboard focus and hides on Escape', () => {
    const {anchor} = mountAnchor();
    render();
    fire(anchor, new FocusEvent('focusin', {bubbles: true}));
    expect(tooltip()?.textContent).toBe('Copy code');
    fire(document, new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    // The exit transition keeps the node mounted briefly before unmounting.
    expect(tooltip()).not.toBeNull();
    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(tooltip()).toBeNull();
  });

  test('does not show for empty tooltip text', () => {
    const {anchor} = mountAnchor('data-tooltip=""');
    render();
    fire(anchor, new MouseEvent('mouseover', {bubbles: true}));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(tooltip()).toBeNull();
  });

  test('hides when the pointer leaves the anchor', () => {
    const {anchor} = mountAnchor();
    render();
    fire(anchor, new MouseEvent('mouseover', {bubbles: true}));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(tooltip()).not.toBeNull();
    fire(anchor, new MouseEvent('mouseout', {bubbles: true, relatedTarget: document.body}));
    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(tooltip()).toBeNull();
  });

  test('stays inactive on touch-only devices', () => {
    mockTouchOnlyMatchMedia();
    const {anchor} = mountAnchor();
    render();
    fire(anchor, new MouseEvent('mouseover', {bubbles: true}));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(tooltip()).toBeNull();
  });

  test('unmounts immediately when a shell surface opens', () => {
    const {anchor} = mountAnchor();
    render();
    fire(anchor, new FocusEvent('focusin', {bubbles: true}));
    expect(tooltip()).not.toBeNull();

    act(() => {
      shellTransientSurfaceStore.open({kind: 'app-menu', drawerPolicy: 'close'});
    });

    expect(tooltip()).toBeNull();
  });
});
