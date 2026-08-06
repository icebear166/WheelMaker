import {hubStateRefreshBatches} from './RegistryWorkspaceService';

test('keeps normal Hub refreshes combined', () => {
  expect(hubStateRefreshBatches('normal', ['wheelmakerUpdate', 'gatewayUpdate'])).toEqual([
    ['wheelmakerUpdate', 'gatewayUpdate'],
  ]);
});

test('splits Gateway refreshes for update-only Hubs', () => {
  expect(hubStateRefreshBatches('update_only', ['wheelmakerUpdate', 'gatewayUpdate'])).toEqual([
    ['wheelmakerUpdate'],
    ['gatewayUpdate'],
  ]);
});
