import {HubRefreshTriggers} from './hubRefreshTriggers';

const ack = () => ({
  accepted: true,
  updates: [],
  state: {hubId: 'hub-a', instanceId: 'instance-a', sections: {}},
});

test('menu and hub expansion refresh only on opening edges', async () => {
  const refresh = jest.fn(async () => ack());
  const triggers = new HubRefreshTriggers(refresh);
  await triggers.setMenuOpen(true, ['hub-a']);
  await triggers.setMenuOpen(true, ['hub-a']);
  await triggers.setHubExpanded('hub-a', true);
  await triggers.setHubExpanded('hub-a', true);
  expect(refresh).toHaveBeenNthCalledWith(1, 'hub-a', ['wheelmakerUpdate', 'gatewayUpdate'], false);
  expect(refresh).toHaveBeenNthCalledWith(
    2,
    'hub-a',
    ['flickerBridge', 'agentPackages', 'skills', 'fileIndex', 'mcp'],
    false,
  );
});

test('closing and reopening creates a new menu edge', async () => {
  const refresh = jest.fn(async () => ack());
  const triggers = new HubRefreshTriggers(refresh);
  await triggers.setMenuOpen(true, ['hub-a']);
  await triggers.setMenuOpen(false, ['hub-a']);
  await triggers.setMenuOpen(true, ['hub-a']);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test('refreshes Hubs that appear after the menu is already open', async () => {
  const refresh = jest.fn(async () => ack());
  const triggers = new HubRefreshTriggers(refresh);
  await triggers.setMenuOpen(true, []);

  await triggers.setMenuOpen(true, ['hub-a']);
  await triggers.setMenuOpen(true, ['hub-a', 'hub-b']);

  expect(refresh).toHaveBeenNthCalledWith(1, 'hub-a', ['wheelmakerUpdate', 'gatewayUpdate'], false);
  expect(refresh).toHaveBeenNthCalledWith(2, 'hub-b', ['wheelmakerUpdate', 'gatewayUpdate'], false);
});

test('treats visibly expanded Hubs as expansion edges on each menu opening', async () => {
  const refresh = jest.fn(async () => ack());
  const triggers = new HubRefreshTriggers(refresh);
  await triggers.setMenuOpen(true, ['hub-a'], ['hub-a']);
  await triggers.setMenuOpen(false, ['hub-a'], ['hub-a']);

  await triggers.setMenuOpen(true, ['hub-a'], ['hub-a']);

  expect(refresh).toHaveBeenCalledTimes(4);
  expect(refresh).toHaveBeenNthCalledWith(
    2,
    'hub-a',
    ['flickerBridge', 'agentPackages', 'skills', 'fileIndex', 'mcp'],
    false,
  );
  expect(refresh).toHaveBeenNthCalledWith(
    4,
    'hub-a',
    ['flickerBridge', 'agentPackages', 'skills', 'fileIndex', 'mcp'],
    false,
  );
});

test('contains refresh failures so UI edge effects do not create unhandled rejections', async () => {
  const refresh = jest.fn(async () => {
    throw new Error('offline');
  });
  const triggers = new HubRefreshTriggers(refresh);

  await expect(triggers.setMenuOpen(true, ['hub-a'])).resolves.toBeUndefined();
  await expect(triggers.setHubExpanded('hub-a', true)).resolves.toBeUndefined();
});
