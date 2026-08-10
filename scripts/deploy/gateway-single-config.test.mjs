import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {gatewayConfigPaths, readGatewayConfiguration} from './deploy-core.mjs';

test('Gateway deployment reads one config file for Gateway-owned route settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-single-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);
  await writeFile(paths.config, JSON.stringify({
    schema: 2,
    acme: {email: ''},
    wm_sites: {
      tls: {certificateFile: '', keyFile: ''},
      registry: {urlMode: 'sync_hub'},
      release: {
        publicUrl: '',
        listen: '127.0.0.1:9680',
        dataRoot: join(root, 'release-server', 'data'),
        tokenSha256: '',
      },
      share: {urlMode: 'sync_hub'},
    },
  }));

  const result = await readGatewayConfiguration(root);
  assert.deepEqual(result.wmSites.tls, {certificateFile: '', keyFile: ''});
  assert.deepEqual(result.registry, {urlMode: 'sync_hub'});
  assert.equal(result.release.listen, '127.0.0.1:9680');
  assert.deepEqual(result.share, {urlMode: 'sync_hub'});
  assert.equal(await readFile(paths.config, 'utf8').then(Boolean), true);
});
