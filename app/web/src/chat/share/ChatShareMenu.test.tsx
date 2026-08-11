/** @jest-environment jsdom */

import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

import {
  ChatShareMenu,
  type ChatShareAction,
} from './ChatShareMenu';

type RenderedMenu = {
  container: HTMLDivElement;
  root: Root;
  onSelect: jest.Mock<void, [ChatShareAction]>;
  onOpenChange: jest.Mock<void, [boolean]>;
};

const mountedRoots: Root[] = [];

async function renderMenu(extra: Partial<React.ComponentProps<typeof ChatShareMenu>> = {}): Promise<RenderedMenu> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  const onSelect = jest.fn<void, [ChatShareAction]>();
  const onOpenChange = jest.fn<void, [boolean]>();
  await act(async () => {
    root.render(
      <ChatShareMenu
        mode="popover"
        responseDisabled={false}
        sessionDisabled={false}
        onSelect={onSelect}
        onOpenChange={onOpenChange}
        {...extra}
      />,
    );
  });
  return {container, root, onSelect, onOpenChange};
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', {bubbles: true}));
  });
}

async function openMenu(rendered: RenderedMenu): Promise<HTMLElement> {
  const trigger = rendered.container.querySelector<HTMLButtonElement>('[aria-label="Share response or session"]');
  if (!trigger) throw new Error('missing share trigger');
  await click(trigger);
  const menu = document.body.querySelector<HTMLElement>('[role="menu"][aria-label="Share response or session"]');
  if (!menu) throw new Error('missing share menu');
  return menu;
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = '';
});

describe('ChatShareMenu', () => {
  test('exposes one trigger and six direct grouped actions in popover mode', async () => {
    const rendered = await renderMenu();
    const trigger = rendered.container.querySelector<HTMLButtonElement>('[aria-label="Share response or session"]')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    const menu = await openMenu(rendered);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(menu.querySelectorAll('.chat-share-menu-group-label')).map(node => node.textContent)).toEqual([
      'Current response',
      'Full session',
    ]);
    expect(Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).map(node => node.textContent?.trim())).toEqual([
      'Image', 'HTML file', 'Public URL',
      'Image', 'HTML file', 'Public URL',
    ]);

    await click(menu.querySelector<HTMLButtonElement>('[aria-label="Share current response as HTML file"]')!);
    expect(rendered.onSelect).toHaveBeenCalledWith({scope: 'response', format: 'html'});
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  test('uses the shared mobile sheet hierarchy with the same actions', async () => {
    const rendered = await renderMenu({mode: 'sheet'});
    const menu = await openMenu(rendered);

    expect(document.body.querySelector('.sl-sheet-overlay.chat-share-sheet-overlay')).toBeTruthy();
    expect(menu.className).toContain('sl-sheet');
    expect(menu.querySelector('.mobile-project-sheet-grip')).toBeTruthy();
    expect(menu.querySelector('.wide-project-action-title-main')?.textContent).toBe('Share');
    expect(menu.querySelector('[aria-label="Close share menu"]')).toBeTruthy();
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(6);
  });

  test('keeps the other scope usable when one scope is disabled', async () => {
    const rendered = await renderMenu({responseDisabled: true});
    const menu = await openMenu(rendered);
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

    expect(items.slice(0, 3).every(item => item.disabled)).toBe(true);
    expect(items.slice(3).every(item => !item.disabled)).toBe(true);
    await click(menu.querySelector<HTMLButtonElement>('[aria-label="Share full session as public URL"]')!);
    expect(rendered.onSelect).toHaveBeenCalledWith({scope: 'session', format: 'public_url'});
  });

  test('supports menu keyboard navigation and restores trigger focus on Escape', async () => {
    const rendered = await renderMenu();
    const trigger = rendered.container.querySelector<HTMLButtonElement>('[aria-label="Share response or session"]')!;
    const menu = await openMenu(rendered);
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

    expect(document.activeElement).toBe(items[0]);
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true})));
    expect(document.activeElement).toBe(items[5]);
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true})));
    expect(document.activeElement).toBe(items[0]);
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})));
    expect(document.activeElement).toBe(items[1]);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})));
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test.each(['outside', 'scroll', 'resize'])('closes a popover on %s', async reason => {
    const rendered = await renderMenu();
    await openMenu(rendered);

    await act(async () => {
      if (reason === 'outside') {
        rendered.container.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true}));
      } else {
        window.dispatchEvent(new Event(reason));
      }
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });
});
