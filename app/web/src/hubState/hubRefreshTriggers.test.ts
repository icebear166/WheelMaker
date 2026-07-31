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
  expect(refresh).toHaveBeenNthCalledWith(1, 'hub-a', ['wheelmakerUpdate'], false);
  expect(refresh).toHaveBeenNthCalledWith(
    2,
    'hub-a',
    ['flickerBridge', 'agentPackages', 'skills', 'fileIndex'],
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
