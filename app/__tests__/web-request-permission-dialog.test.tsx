import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ChatPermissionDialog} from '../web/src/chat/permission/ChatPermissionDialog';

describe('request permission dialog', () => {
  test('shows request details and submits the exact option id', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPermissionDialog
          title="Choose how to continue"
          detailsText="The specification is missing."
          options={[
            {optionId: 'q0_opt_0', name: 'Continue with the plan', kind: 'allow_once'},
            {optionId: 'q0_opt_1', name: 'Stop here', kind: 'reject_once'},
          ]}
          submittingOptionId=""
          error=""
          onSelect={onSelect}
        />,
      );
    });

    expect(renderer!.root.findByProps({className: 'chat-permission-dialog-title'}).children).toContain('Choose how to continue');
    expect(renderer!.root.findAllByProps({className: 'chat-permission-option'})).toHaveLength(2);
    await ReactTestRenderer.act(() => {
      renderer!.root.findAllByProps({className: 'chat-permission-option'})[1].props.onClick();
    });
    expect(onSelect).toHaveBeenCalledWith('q0_opt_1');
  });

  test('has no close control and disables choices while submitting', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPermissionDialog
          title="Approval required"
          detailsText=""
          options={[{optionId: 'allow', name: 'Allow', kind: 'allow_once'}]}
          submittingOptionId="allow"
          error=""
          onSelect={() => undefined}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({'aria-label': 'Close'})).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'chat-permission-option'}).props.disabled).toBe(true);
  });
});
