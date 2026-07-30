import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {RetryToast} from './RetryToast';

test('keeps an error visible and exposes retry and dismiss actions', async () => {
  const onRetry = jest.fn();
  const onDismiss = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <RetryToast
        message="Skill update failed"
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );
  });

  expect(renderer.root.findByProps({className: 'app-retry-toast-message'}).children)
    .toEqual(['Skill update failed']);
  act(() => renderer.root.findByProps({'aria-label': 'Retry Skill action'}).props.onClick());
  act(() => renderer.root.findByProps({'aria-label': 'Dismiss Skill error'}).props.onClick());
  expect(onRetry).toHaveBeenCalled();
  expect(onDismiss).toHaveBeenCalled();
});

test('can remain part of the Hub interaction surface while retrying a Hub skill action', async () => {
  const props = {
    message: 'Skill update failed',
    onRetry: () => undefined,
    onDismiss: () => undefined,
    preserveChatHubMenu: true,
  } as React.ComponentProps<typeof RetryToast> & {preserveChatHubMenu: boolean};
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<RetryToast {...props} />);
  });

  expect(renderer.root.findByProps({className: 'app-retry-toast'}).props)
    .toMatchObject({'data-chat-hub-owned-overlay': 'true'});
});
