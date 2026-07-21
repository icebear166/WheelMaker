import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-markdown', () => {
  const ReactModule = require('react') as typeof React;
  return {
    __esModule: true,
    default: ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../web/src/code/markdownPreview', () => ({
  useMarkdownCapabilityPlugins: () => ({pending: false, remarkPlugins: [], rehypePlugins: []}),
}));

import {ChatTurnView} from '../web/src/chat/ChatTurnView';
import type {ChatPermissionRecord} from '../web/src/chat/permission/chatPermissionState';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

const request: RegistryChatMessage = {
  sessionId: 'sess-1',
  turnIndex: 2,
  method: 'permission_request',
  param: {permissionId: 'perm-1', title: 'Choose'},
  finished: true,
};

async function renderPermission(permissionRecord: ChatPermissionRecord) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <ChatTurnView
        message={request}
        permissionRecord={permissionRecord}
        markdownComponents={{}}
        markdownUrlTransform={value => value}
      />,
    );
  });
  return renderer!;
}

describe('request permission history row', () => {
  test('renders one compact selected summary without option buttons', async () => {
    const renderer = await renderPermission({
      permissionId: 'perm-1', requestTurnIndex: 2, request, status: 'selected', optionId: 'allow', optionName: 'Allow',
    });
    expect(renderer.root.findByProps({className: 'chat-permission-history-summary'}).children.join(' ')).toContain('Allow');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
  });

  test('renders the terminal reason for unanswered requests', async () => {
    const renderer = await renderPermission({
      permissionId: 'perm-1', requestTurnIndex: 2, request, status: 'unanswered', unansweredReason: 'failed',
    });
    expect(renderer.root.findByProps({className: 'chat-permission-history-summary'}).children.join(' ')).toContain('Failed');
  });
});
