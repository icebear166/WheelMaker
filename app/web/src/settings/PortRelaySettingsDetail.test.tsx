// @ts-nocheck
import React from 'react';
import {act, create} from 'react-test-renderer';

import {PortRelaySettingsDetail} from './PortRelaySettingsDetail';

test('displays the Registry-owned Relay port as read-only', async () => {
  let tree;
  await act(async () => {
    tree = create(
      <PortRelaySettingsDetail
        hubIds={['hub-local']}
        portRelaySnapshot={{ok: true, enabled: false, status: 'Disabled', listenPort: 28810, listenPortManaged: true}}
        portRelayError=""
        portRelayLoading={false}
        portRelayListenPort="29999"
        setPortRelayListenPort={jest.fn()}
        persistPortRelaySettings={jest.fn()}
        portRelayAccessCodeUnknown={false}
        portRelayAccessCode="123456"
        regeneratePortRelayAccessCode={jest.fn(async () => undefined)}
        copyPortRelayAccessCode={jest.fn(async () => undefined)}
        clearPortRelaySiteData={jest.fn(async () => undefined)}
        portRelayCodeCopied={false}
        portRelayTargets={[{hubId: 'hub-local', targetPort: 80}]}
        selectedPortRelayTarget={{hubId: 'hub-local', targetPort: 80}}
        selectPortRelayTarget={jest.fn(async () => undefined)}
        deletePortRelayTarget={jest.fn(async () => undefined)}
        portRelayDraftHubId=""
        setPortRelayDraftHubId={jest.fn()}
        portRelayDraftPort="80"
        setPortRelayDraftPort={jest.fn()}
        commitPortRelayDraftTarget={jest.fn(() => null)}
        enablePortRelay={jest.fn(async () => undefined)}
        disablePortRelay={jest.fn(async () => undefined)}
      />,
    );
  });

  const labels = tree.root.findAllByProps({className: 'set-field-label'}).map(item => item.children.join(''));
  expect(labels).toContain('Server Listen Port');
  expect(labels).not.toContain('Listen Port');
  expect(tree.root.findAllByType('input').some(input => input.props.value === '29999')).toBe(false);
  expect(JSON.stringify(tree.toJSON())).toContain('28810');
  tree.unmount();
});

test('allows a client-managed Relay port when Gateway is absent', async () => {
  let tree;
  await act(async () => {
    tree = create(
      <PortRelaySettingsDetail
        hubIds={['hub-local']}
        portRelaySnapshot={{ok: true, enabled: false, status: 'Disabled', listenPortManaged: false}}
        portRelayError=""
        portRelayLoading={false}
        portRelayListenPort="29999"
        setPortRelayListenPort={jest.fn()}
        persistPortRelaySettings={jest.fn()}
        portRelayAccessCodeUnknown={false}
        portRelayAccessCode="123456"
        regeneratePortRelayAccessCode={jest.fn(async () => undefined)}
        copyPortRelayAccessCode={jest.fn(async () => undefined)}
        clearPortRelaySiteData={jest.fn(async () => undefined)}
        portRelayCodeCopied={false}
        portRelayTargets={[]}
        selectedPortRelayTarget={null}
        selectPortRelayTarget={jest.fn(async () => undefined)}
        deletePortRelayTarget={jest.fn(async () => undefined)}
        portRelayDraftHubId=""
        setPortRelayDraftHubId={jest.fn()}
        portRelayDraftPort="80"
        setPortRelayDraftPort={jest.fn()}
        commitPortRelayDraftTarget={jest.fn(() => null)}
        enablePortRelay={jest.fn(async () => undefined)}
        disablePortRelay={jest.fn(async () => undefined)}
      />,
    );
  });

  const portInput = tree.root.findAllByProps({value: '29999'})[0];
  expect(portInput.props['aria-label']).toBe('Port relay server listen port');
  expect(portInput.props.readOnly).not.toBe(true);
  expect(tree.root.findAllByProps({className: 'set-field-label'}).map(item => item.children.join(''))).toContain('Listen Port');
  tree.unmount();
});
