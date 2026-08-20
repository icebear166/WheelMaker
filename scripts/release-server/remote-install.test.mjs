import assert from 'node:assert/strict';
import test from 'node:test';

import {buildRemoteInstallScript} from './remote-install.mjs';

test('ordinary installer uses the login user Home and no ACL or legacy service', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /release_home="\$deploy_home\/\.wheelmaker\/release-server"/);
  assert.match(script, /data_root="\$release_home\/data"/);
  assert.match(script, /public_root="\$data_root\/public"/);
  assert.match(script, /staging_root="\$data_root\/staging"/);
  assert.match(script, /systemctl --user show-environment/);
  assert.doesNotMatch(script, /getfacl|setfacl|www-data|\/srv\/wheelmaker-release/);
  assert.doesNotMatch(script, /legacy_unit|legacy_active|legacy_enabled|systemctl cat/);
});

test('ordinary installer only checks loopback health', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /poll_health http:\/\/127\.0\.0\.1:9680\/healthz/);
  assert.doesNotMatch(script, /poll_health "\$public_url\/healthz"/);
});

test('ordinary installer publishes and rolls back both public AI deployment guides', () => {
  const script = buildRemoteInstallScript();
  for (const name of ['deployment.md', 'deployment.zh-CN.md']) {
    assert.match(script, new RegExp(`\\[ -f "\\$upload_dir/${name}" \\]`));
    assert.match(script, new RegExp(`\\$public_root/${name}`));
  }
  assert.match(script, /\$release_home\/\.deployment-\$source_sha\.candidate/);
  assert.match(script, /\$release_home\/\.deployment-zh-CN-\$source_sha\.candidate/);
  assert.match(script, /deployment_zh_backup_exists=/);
});

test('ordinary installer publishes and rolls back the Personal Wiki guide', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /\[ -f "\$upload_dir\/personal-wiki\.zh-CN\.md" \]/);
  assert.match(script, /\$release_home\/\.personal-wiki-zh-CN-\$source_sha\.candidate/);
  assert.match(script, /\$public_root\/personal-wiki\.zh-CN\.md/);
  assert.match(script, /personal_wiki_zh_backup_exists=/);
});

test('health retries suppress transient curl errors', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /curl --fail --silent "\$health_url" >\/dev\/null 2>&1/);
  assert.doesNotMatch(script, /curl --fail --silent --show-error "\$health_url"/);
});

test('remote installer does not depend on upload transport executable bits', () => {
  const script = buildRemoteInstallScript();
  const uploadedBinary = script.indexOf('[ -f "$upload_dir/wheelmaker-release-server" ]');
  const stagedBinary = script.indexOf(
    'install -m 0755 "$upload_dir/wheelmaker-release-server" "$stage_binary"',
  );

  assert.ok(uploadedBinary > 0);
  assert.ok(stagedBinary > uploadedBinary);
  assert.doesNotMatch(script, /\[ -x "\$upload_dir\/wheelmaker-release-server" \]/);
});

test('installer provisions schema 2 wm_sites.release in Gateway config instead of a site file', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /gateway_home="\$deploy_home\/\.wheelmaker\/gateway"/);
  assert.match(script, /gateway_config_path="\$gateway_home\/config\.json"/);
  assert.match(script, /"schema":2/);
  assert.match(script, /"wm_sites":\{"tls":\{"certificateFile":"","keyFile":""\},"registry":\{"urlMode":"sync_hub"\},"release":\{"publicUrl"/);
  assert.match(script, /"share":\{"urlMode":"sync_hub"\}/);
  assert.doesNotMatch(script, /"schema":1/);
  assert.match(script, /configure-public-url --config "\$gateway_config_candidate" --public-url "\$public_url"/);
  assert.match(script, /validate-config --config "\$gateway_config_candidate"/);
  assert.doesNotMatch(script, /release-server\/config\.json|gateway\/sites\/release-server\.json/);
});

test('ordinary cutover rolls back only user-owned state', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /previous_current=/);
  assert.match(script, /user_active=/);
  assert.match(script, /user_enabled=/);
  assert.match(script, /linger_before=/);
  assert.match(script, /rollback\(\)/);
  assert.match(script, /trap 'rollback \$\?' ERR INT TERM/);
  assert.doesNotMatch(script, /ACL|acl_backup|root_command systemctl/);
});

test('remote installer owns only its user service and wm_sites.release', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /versions_home="\$release_home\/versions"/);
  assert.match(script, /unit_home="\$deploy_home\/\.config\/systemd\/user"/);
  assert.match(script, /unit_path="\$unit_home\/\$user_unit"/);
  assert.match(script, /gateway_config_path="\$gateway_home\/config\.json"/);
  assert.doesNotMatch(script, /gateway_mode.*none.*caddy/s);
  assert.match(script, /http:\/\/127\.0\.0\.1:9680\/healthz/);
  assert.doesNotMatch(script, /wheelmaker-gateway|127\.0\.0\.1:2019|Caddyfile|nginx -t/);
  assert.doesNotMatch(script, /systemctl\s+(start|stop|restart|enable|disable)\s+(nginx|caddy)/i);
});

test('cutover failures stay inside the user rollback window', () => {
  const script = buildRemoteInstallScript();
  const armed = script.indexOf('rollback_armed=1');
  const disarmed = script.lastIndexOf('rollback_armed=0');
  assert.ok(armed > 0);
  assert.ok(disarmed > armed);
  for (const marker of [
    'user_systemctl restart "$user_unit"',
    'http://127.0.0.1:9680/healthz',
  ]) {
    const position = script.indexOf(marker);
    assert.ok(position > armed, `${marker} must be after rollback_armed=1`);
    assert.ok(position < disarmed, `${marker} must be before rollback_armed=0`);
  }
});
