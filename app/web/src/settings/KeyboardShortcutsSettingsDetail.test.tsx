import React, {useState} from 'react';
import {act, create, type ReactTestInstance, type ReactTestRenderer} from 'react-test-renderer';

import type {ShortcutOverrides} from '../shortcuts/keyboardShortcuts';
import {KeyboardShortcutsSettingsDetail} from './KeyboardShortcutsSettingsDetail';

function Harness({initial = {}}: {initial?: ShortcutOverrides}) {
  const [overrides, setOverrides] = useState(initial);
  return (
    <KeyboardShortcutsSettingsDetail
      platform="windows"
      overrides={overrides}
      onChange={setOverrides}
    />
  );
}

function textOf(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
}

const keyEvent = (overrides: Record<string, unknown> = {}) => ({
  key: 'k',
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  defaultPrevented: false,
  preventDefault: jest.fn(),
  stopPropagation: jest.fn(),
  ...overrides,
});

async function renderHarness(initial?: ShortcutOverrides): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer;
  await act(async () => {
    tree = create(<Harness initial={initial} />);
  });
  return tree!;
}

describe('KeyboardShortcutsSettingsDetail', () => {
  test('renders grouped commands, platform keycaps, and customization counts', async () => {
    const tree = await renderHarness({
      toggleSessions: null,
      toggleTerminal: {alt: true, key: 'F8'},
    });

    expect(tree.root.findByProps({'aria-label': 'Navigation shortcuts'})).toBeDefined();
    expect(tree.root.findByProps({'aria-label': 'Workbench shortcuts'})).toBeDefined();
    expect(tree.root.findByProps({'aria-label': 'Search shortcuts'})).toBeDefined();
    expect(textOf(tree.root.findByProps({className: 'keyboard-shortcuts-summary'}))).toContain('8 commands');
    expect(textOf(tree.root.findByProps({className: 'keyboard-shortcuts-summary'}))).toContain('2 customized');
    expect(tree.root.findAllByType('kbd').some(keycap => textOf(keycap) === 'Ctrl')).toBe(true);
    expect(tree.root.findByProps({'aria-label': 'Record Toggle Sessions shortcut'}).children).toEqual(['Unassigned']);
  });

  test('records modifier preview, applies a legal binding immediately, and cancels with Escape', async () => {
    const tree = await renderHarness();
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}).props.onClick();
    });
    const recorder = tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Preview'});
    expect(recorder.props.autoFocus).toBe(true);

    await act(async () => {
      recorder.props.onKeyDown(keyEvent({key: 'Control'}));
    });
    expect(textOf(tree.root.findByProps({className: 'keyboard-shortcut-recorder-keys'}))).toContain('Ctrl');

    await act(async () => {
      tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Preview'}).props.onKeyDown(keyEvent());
    });
    expect(textOf(tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}))).toContain('Ctrl+K');

    await act(async () => {
      tree.root.findByProps({'aria-label': 'Record Toggle Terminal shortcut'}).props.onClick();
    });
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Terminal'}).props.onKeyDown(
        keyEvent({key: 'Escape', ctrlKey: false}),
      );
    });
    expect(tree.root.findAllByProps({'aria-label': 'Recording shortcut for Toggle Terminal'})).toHaveLength(0);
    expect(textOf(tree.root.findByProps({'aria-label': 'Record Toggle Terminal shortcut'}))).toContain('Ctrl+`');
  });

  test('keeps blocked input unsaved and saves warning-only browser combinations', async () => {
    const tree = await renderHarness();
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}).props.onClick();
    });
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Preview'}).props.onKeyDown(
        keyEvent({key: 'r'}),
      );
    });
    expect(textOf(tree.root.findByProps({className: 'keyboard-shortcut-feedback is-error'}))).toContain('refreshes the page');
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Preview'}).props.onKeyDown(
        keyEvent({key: 'Escape', ctrlKey: false}),
      );
    });
    expect(textOf(tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}))).toContain('Ctrl+2');

    await act(async () => {
      tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}).props.onClick();
    });
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Preview'}).props.onKeyDown(
        keyEvent({key: 'l'}),
      );
    });
    expect(textOf(tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}))).toContain('Ctrl+L');
    expect(textOf(tree.root.findByProps({className: 'keyboard-shortcut-feedback is-warning'}))).toContain('browser');
  });

  test('requires confirmation before replacing a conflicting binding', async () => {
    const tree = await renderHarness();
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}).props.onClick();
    });
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Preview'}).props.onKeyDown(
        keyEvent({key: '1'}),
      );
    });

    expect(textOf(tree.root.findByProps({className: 'keyboard-shortcut-conflict'}))).toContain('Toggle Sessions');
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Replace Toggle Sessions binding'}).props.onClick();
    });
    expect(textOf(tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}))).toContain('Ctrl+1');
    expect(tree.root.findByProps({'aria-label': 'Record Toggle Sessions shortcut'}).children).toEqual(['Unassigned']);
  });

  test('clears, restores, and resets overrides only after confirmation', async () => {
    const tree = await renderHarness({toggleTerminal: {alt: true, key: 'F8'}});
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Clear Toggle Terminal shortcut'}).props.onClick();
    });
    expect(tree.root.findByProps({'aria-label': 'Record Toggle Terminal shortcut'}).children).toEqual(['Unassigned']);

    await act(async () => {
      tree.root.findByProps({'aria-label': 'Restore Toggle Terminal default'}).props.onClick();
    });
    expect(textOf(tree.root.findByProps({'aria-label': 'Record Toggle Terminal shortcut'}))).toContain('Ctrl+`');

    await act(async () => {
      tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}).props.onClick();
    });
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Recording shortcut for Toggle Preview'}).props.onKeyDown(keyEvent());
    });
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Reset all shortcuts'}).props.onClick();
    });
    expect(tree.root.findByProps({className: 'keyboard-shortcuts-reset-confirm'})).toBeDefined();
    await act(async () => {
      tree.root.findByProps({'aria-label': 'Confirm reset all shortcuts'}).props.onClick();
    });
    expect(textOf(tree.root.findByProps({className: 'keyboard-shortcuts-summary'}))).toContain('0 customized');
    expect(textOf(tree.root.findByProps({'aria-label': 'Record Toggle Preview shortcut'}))).toContain('Ctrl+2');
  });

  test('announces recording and validation feedback accessibly', async () => {
    const tree = await renderHarness();
    const liveRegion = tree.root.findByProps({className: 'keyboard-shortcuts-live-region'});
    expect(liveRegion.props['aria-live']).toBe('polite');
    expect(liveRegion.props.role).toBe('status');
  });
});
