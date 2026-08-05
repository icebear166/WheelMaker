import assert from 'node:assert/strict';
import test from 'node:test';

import {buildRemoteInstallScript} from './remote-install.mjs';

test('remote migration preflights before stopping the legacy service', () => {
  const script = buildRemoteInstallScript();
  const preflight = script.indexOf('preflight_complete=1');
  const stopLegacy = script.indexOf('root_command systemctl stop "$legacy_unit"');
  assert.ok(preflight > 0);
  assert.ok(stopLegacy > preflight);
  assert.match(script, /validate-config --config "\$config_candidate"/);
  assert.match(script, /systemctl --user show-environment/);
  assert.match(script, /sudo -n true/);
});

test('remote migration records and restores service, linger, symlink, unit, and ACL state', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /legacy_active=/);
  assert.match(script, /legacy_enabled=/);
  assert.match(script, /user_active=/);
  assert.match(script, /user_enabled=/);
  assert.match(script, /linger_before=/);
  assert.match(script, /previous_current=/);
  assert.match(script, /getfacl -R -p/);
  assert.match(script, /setfacl --restore=/);
  assert.match(script, /rollback\(\)/);
  assert.match(script, /trap 'rollback \$\?' ERR INT TERM/);
  assert.match(script, /root_command systemctl enable "\$legacy_unit"/);
  assert.match(script, /root_command systemctl start "\$legacy_unit"/);
});

test('remote migration owns only its service and optional semantic site', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /\.wheelmaker\/release-server\/versions/);
  assert.match(script, /\.config\/systemd\/user\/wheelmaker-release-server\.service/);
  assert.match(script, /\.wheelmaker\/gateway\/sites\/release-server\.json/);
  assert.match(script, /gateway_mode.*none.*caddy/s);
  assert.match(script, /http:\/\/127\.0\.0\.1:9680\/healthz/);
  assert.match(script, /"\$public_url\/healthz"/);
  assert.doesNotMatch(script, /wheelmaker-gateway|127\.0\.0\.1:2019|Caddyfile|nginx -t/);
  assert.doesNotMatch(script, /systemctl\s+(start|stop|restart|enable|disable)\s+(nginx|caddy)/i);
});

test('none mode branches before creating Gateway directories', () => {
  const script = buildRemoteInstallScript();
  const branch = script.indexOf('if [ "$gateway_mode" = "caddy" ]; then');
  const directory = script.indexOf('gateway_sites="$deploy_home/.wheelmaker/gateway/sites"');
  assert.ok(branch > 0);
  assert.ok(directory > branch);
});

test('cutover failures stay inside the rollback window', () => {
  const script = buildRemoteInstallScript();
  const armed = script.indexOf('rollback_armed=1');
  const disarmed = script.indexOf('rollback_armed=0');
  assert.ok(armed > 0);
  assert.ok(disarmed > armed);
  for (const marker of [
    'user_systemctl restart "$user_unit"',
    'http://127.0.0.1:9680/healthz',
    '"$public_url/healthz"',
  ]) {
    const position = script.indexOf(marker);
    assert.ok(position > armed, `${marker} must be after rollback_armed=1`);
    assert.ok(position < disarmed, `${marker} must be before rollback_armed=0`);
  }
});
