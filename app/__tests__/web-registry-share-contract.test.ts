import {RegistryMethods} from '../web/src/registry/registryMethods';

test('registry exposes public share methods', () => {
  expect(RegistryMethods.ShareCreate).toBe('share.create');
  expect(RegistryMethods.ShareList).toBe('share.list');
  expect(RegistryMethods.ShareDelete).toBe('share.delete');
});
