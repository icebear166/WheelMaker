import React from 'react';
import {act, create, type ReactTestInstance, type ReactTestRenderer} from 'react-test-renderer';

import type {SettingsDetail} from './settingsNavigation';
import {SettingsDesktopSplit} from './SettingsSurface';

type SplitProps = {
  detail?: SettingsDetail | null;
  detailExiting?: boolean;
  onCloseDetail?: () => void;
};

function textOf(node: ReactTestInstance): string {
  return node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
}

function hasClass(node: ReactTestInstance, className: string): boolean {
  const value = node.props.className;
  return typeof value === 'string' && value.split(' ').includes(className);
}

function findByClass(root: ReactTestInstance, className: string): ReactTestInstance[] {
  return root.findAll(node => hasClass(node, className));
}

async function renderSplit(props: SplitProps = {}): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SettingsDesktopSplit
        detail={props.detail ?? null}
        detailExiting={props.detailExiting ?? false}
        renderRoot={() => <div>ROOT_CONTENT</div>}
        renderDetail={detail => <div>{`DETAIL_${detail}`}</div>}
        onCloseDetail={props.onCloseDetail ?? (() => undefined)}
      />,
    );
  });
  return tree!;
}

describe('SettingsDesktopSplit', () => {
  test('renders only the root pane when no detail is selected', async () => {
    const tree = await renderSplit({detail: null});

    expect(textOf(tree.root)).toContain('ROOT_CONTENT');
    expect(findByClass(tree.root, 'settings-desktop-detail-pane')).toHaveLength(0);
  });

  test('renders root and detail side by side with a pane header and close button', async () => {
    const onCloseDetail = jest.fn();
    const tree = await renderSplit({detail: 'database', onCloseDetail});

    expect(textOf(tree.root)).toContain('ROOT_CONTENT');
    const panes = findByClass(tree.root, 'settings-desktop-detail-pane');
    expect(panes).toHaveLength(1);
    expect(textOf(panes[0])).toContain('Database');
    expect(textOf(panes[0])).toContain('DETAIL_database');

    const closeButton = panes[0].findByProps({'aria-label': 'Close detail'});
    await act(async () => {
      closeButton.props.onClick();
    });
    expect(onCloseDetail).toHaveBeenCalledTimes(1);
  });

  test('keeps the pane mounted with an exiting marker while closing', async () => {
    const tree = await renderSplit({detail: 'database', detailExiting: true});

    const panes = findByClass(tree.root, 'settings-desktop-detail-pane');
    expect(panes).toHaveLength(1);
    expect(hasClass(panes[0], 'is-exiting')).toBe(true);
  });

  test('swaps detail content in place without remounting the pane', async () => {
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <SettingsDesktopSplit
          detail="database"
          detailExiting={false}
          renderRoot={() => <div>ROOT_CONTENT</div>}
          renderDetail={detail => <div>{`DETAIL_${detail}`}</div>}
          onCloseDetail={() => undefined}
        />,
      );
    });
    const paneBefore = findByClass(tree!.root, 'settings-desktop-detail-pane')[0];

    await act(async () => {
      tree!.update(
        <SettingsDesktopSplit
          detail="deviceSessions"
          detailExiting={false}
          renderRoot={() => <div>ROOT_CONTENT</div>}
          renderDetail={detail => <div>{`DETAIL_${detail}`}</div>}
          onCloseDetail={() => undefined}
        />,
      );
    });

    const paneAfter = findByClass(tree!.root, 'settings-desktop-detail-pane')[0];
    expect(paneAfter).toBe(paneBefore);
    expect(textOf(paneAfter)).toContain('Devices');
    expect(textOf(paneAfter)).toContain('DETAIL_deviceSessions');
  });
});
