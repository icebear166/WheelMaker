# Release Server Home Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** Make ordinary Release Server deployment a user-Home-only installation with no /srv, www-data, ACL, or implicit legacy migration, while documenting a one-time manual cutover for old machines.

**Architecture:** The remote installer owns only the SSH login user's ~/.wheelmaker/release-server tree and its user-level systemd unit. Release data lives under release-server/data, Gateway configuration is an optional semantic file under the same user's Gateway Home, and old systemd/Nginx state is handled only by an operator-run migration procedure after the normal installer is ready.

**Tech Stack:** Node.js ESM deployment scripts, Bash over SSH, Linux user-level systemd, Go Release Server config validation, Node node:test, Go tests, Markdown documentation.

---

### Task 1: Move the user service unit's writable root to Home

**Files:**
- Modify: scripts/release-server/wheelmaker-release-server.service
- Test: scripts/release-server/deploy.test.mjs

- [ ] **Step 1: Write the failing unit-path assertions**

Replace the existing /srv assertion in the hardened user-unit test with:

~~~js
assert.match(unit, /^WorkingDirectory=%h\/\.wheelmaker\/release-server\/data$/m);
assert.match(
  unit,
  /^ExecStart=%h\/\.wheelmaker\/release-server\/current\/wheelmaker-release-server serve --config %h\/\.wheelmaker\/release-server\/config\.json$/m,
);
assert.match(unit, /^ReadWritePaths=%h\/\.wheelmaker\/release-server\/data$/m);
assert.doesNotMatch(unit, /\/srv\/wheelmaker-release|www-data|\/etc\/wheelmaker-release-server/);
~~~

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

~~~powershell
node --test scripts/release-server/deploy.test.mjs
~~~

Expected: FAIL because WorkingDirectory and ReadWritePaths still reference /srv/wheelmaker-release.

- [ ] **Step 3: Update the unit**

Change only the service paths; retain every existing hardening option:

~~~ini
[Service]
Type=simple
WorkingDirectory=%h/.wheelmaker/release-server/data
ExecStart=%h/.wheelmaker/release-server/current/wheelmaker-release-server serve --config %h/.wheelmaker/release-server/config.json
Restart=on-failure
RestartSec=3s
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=%h/.wheelmaker/release-server/data
~~~

- [ ] **Step 4: Re-run the focused test**

Run node --test scripts/release-server/deploy.test.mjs. Expected: the unit-path assertions pass.

- [ ] **Step 5: Commit the unit contract**

~~~powershell
git add scripts/release-server/wheelmaker-release-server.service scripts/release-server/deploy.test.mjs
git commit -m "refactor: root release server user unit in home"
~~~

### Task 2: Replace migration-oriented remote tests with ordinary-install tests

**Files:**
- Modify: scripts/release-server/remote-install.test.mjs
- Modify: scripts/release-server/deploy.test.mjs

- [ ] **Step 1: Replace legacy and ACL assertions**

Replace the migration tests in remote-install.test.mjs with tests covering the ordinary contract:

~~~js
test('ordinary installer uses the login user Home and no ACL or legacy service', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /release_home="[$]deploy_home\/[.]wheelmaker\/release-server"/);
  assert.match(script, /data_root="[$]release_home\/data"/);
  assert.match(script, /public_root="[$]data_root\/public"/);
  assert.match(script, /staging_root="[$]data_root\/staging"/);
  assert.doesNotMatch(script, /getfacl|setfacl|www-data|\/srv\/wheelmaker-release/);
  assert.doesNotMatch(script, /legacy_unit|legacy_active|legacy_enabled|systemctl cat/);
});

test('ordinary installer only checks loopback health', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /poll_health http:\/\/127[.]0[.]0[.]1:9680\/healthz/);
  assert.doesNotMatch(script, /poll_health "[$]public_url\/healthz"/);
});

test('caddy mode writes the Home public root and none mode never creates Gateway paths', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /if \[ "[$]gateway_mode" = "caddy" \]; then/);
  assert.match(script, /gateway_site_path="[$]deploy_home\/[.]wheelmaker\/gateway\/sites\/release-server[.]json"/);
  assert.match(script, /publicRoot.*[$]public_root/s);
  assert.ok(script.indexOf('if [ "$gateway_mode" = "caddy" ]; then') < script.indexOf('gateway_sites='));
});

test('ordinary cutover rolls back only user-owned state', () => {
  const script = buildRemoteInstallScript();
  assert.match(script, /previous_current=/);
  assert.match(script, /user_active=/);
  assert.match(script, /user_enabled=/);
  assert.match(script, /rollback[(][)]/);
  assert.match(script, /trap 'rollback [$][?] ERR INT TERM/);
  assert.doesNotMatch(script, /ACL|acl_backup|root_command systemctl/);
});
~~~

Update the deploy test's unit assertion to the Home paths from Task 1 and change the recorded progress expectation from Migrating Release Server to Installing Release Server.

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run:

~~~powershell
node --test scripts/release-server/remote-install.test.mjs scripts/release-server/deploy.test.mjs
~~~

Expected: FAIL because remote-install.mjs still contains legacy probes, ACL commands, /srv paths, and the external health poll.

- [ ] **Step 3: Commit the failing-test contract**

~~~powershell
git add scripts/release-server/remote-install.test.mjs scripts/release-server/deploy.test.mjs
git commit -m "test: define home-only release server deployment"
~~~

### Task 3: Implement the Home-only remote transaction

**Files:**
- Modify: scripts/release-server/remote-install.mjs
- Modify: scripts/release-server/deploy.mjs

- [ ] **Step 1: Replace the remote script with a normal-install transaction**

Keep buildRemoteInstallScript() as the exported API, but replace its template with a normal-only Bash transaction. Its opening contract must be:

~~~bash
#!/usr/bin/env bash
set -Eeuo pipefail

source_sha="$1"
public_url="$2"
upload_dir="$3"
gateway_mode="$4"
user_unit="wheelmaker-release-server.service"
deploy_user="$(id -un)"
deploy_uid="$(id -u)"
deploy_home="$HOME"
case "$deploy_home" in /*) ;; *) echo "login Home is not absolute" >&2; exit 1 ;; esac
release_home="$deploy_home/.wheelmaker/release-server"
versions_home="$release_home/versions"
data_root="$release_home/data"
public_root="$data_root/public"
staging_root="$data_root/staging"
config_path="$release_home/config.json"
current_link="$release_home/current"
unit_home="$deploy_home/.config/systemd/user"
unit_path="$unit_home/$user_unit"

user_systemctl() {
  XDG_RUNTIME_DIR="/run/user/$deploy_uid" systemctl --user "$@"
}
~~~

The implementation must:

1. Validate the SHA, HTTPS origin, upload directory, and none|caddy selector.
2. Require only curl, systemctl, and loginctl. Verify systemctl --user show-environment before changing state. Do not preflight sudo, getfacl, setfacl, www-data, /srv, or a legacy service.
3. Create release_home, versions_home, data_root, public_root, staging_root, and unit_home with user-owned 0700 permissions. Stage the binary, candidate unit, and homepage in that Home tree.
4. Copy an existing Home config or write this exact schema with the absolute Home data root:

   ~~~bash
   printf '{"schema":1,"listen":"127.0.0.1:9680","dataRoot":"%s","tokenSha256":""}\n' "$data_root" > "$config_candidate"
   ~~~

   Set the candidate config to 0600 and run stage_binary validate-config --config "$config_candidate".
5. Record only the previous user service state, current target, user unit, config, homepage files, Gateway site, and linger state. Arm rollback before enabling linger or restarting the user service. Rollback stops/disables only the new user unit, restores those user-owned files, reloads the user manager, restores the previous user service state, restores/removes the optional Gateway site, and undoes linger only if this transaction enabled it.
6. Atomically install the config and unit, switch current, reload/enable/restart the user unit, and poll only http://127.0.0.1:9680/healthz. Do not require external HTTPS health because Gateway/Nginx is outside ordinary deployment.
7. Replace index.html and release-home.js under data/public with mode 0640, preserving previous files for rollback. Do not recursively change ownership or permissions of the data tree.
8. For gateway_mode=caddy, atomically write ~/.wheelmaker/gateway/sites/release-server.json with publicRoot set to the derived absolute public_root, upstream set to http://127.0.0.1:9680, publicUrl set to the channel URL, and empty TLS certificate fields. none must not create or read Gateway directories.
9. Disarm rollback, remove candidate/backup files, and remove the uploaded /tmp directory. The local deploy.mjs finally cleanup remains a second cleanup guard.

Use a Bash JSON-escape helper for public_url and public_root before writing the Gateway site; never interpolate the old literal /srv/wheelmaker-release/public.

- [ ] **Step 2: Change the local progress message**

In deploy.mjs replace the migration wording with:

~~~js
dependencies.write(
  'Installing Release Server in the SSH user Home (Gateway: ' + gateway + ')',
);
~~~

Keep SSH user selection, channel-derived host, identity file, upload cleanup, and unified gateway parsing unchanged.

- [ ] **Step 3: Run the focused tests**

Run:

~~~powershell
node --test scripts/release-server/remote-install.test.mjs scripts/release-server/deploy.test.mjs
~~~

Expected: PASS, with no ordinary-installer source match for /srv/wheelmaker-release, www-data, getfacl, setfacl, or legacy service probes.

- [ ] **Step 4: Commit the installer rewrite**

~~~powershell
git add scripts/release-server/remote-install.mjs scripts/release-server/deploy.mjs
git commit -m "refactor: install release server entirely in user home"
~~~

### Task 4: Align deployment guides and the approved Wiki updates

**Files:**
- Modify: scripts/release-server/deployment.md
- Modify: scripts/release-server/deployment.zh-CN.md
- Modify: docs/wiki/architecture/gateway.md
- Modify: docs/wiki/release-and-build/release.md

- [ ] **Step 1: Replace the deployment-guide migration contract**

Both deployment guides must state:

~~~text
Normal Release Server deployment:
  ~/.wheelmaker/release-server/{config.json,versions,current,data/{public,staging}}
  ~/.config/systemd/user/wheelmaker-release-server.service
  no /srv, www-data, getfacl, setfacl, legacy service detection, or Gateway lifecycle

Old host migration:
  manual SSH operation only; copy token/data/assets from /etc and /srv,
  adjust only the Release Server Nginx static root, start/check the user unit,
  then disable the old system unit after success; preserve old files for rollback.
~~~

Remove instructions that ordinary deployment automatically migrates the old system unit, backs up ACLs, requires noninteractive sudo for /srv, or checks external Gateway health.

- [ ] **Step 2: Verify the approved Wiki changes**

Confirm gateway.md documents the Home publicRoot, same-user ownership, no ACL/www-data dependency, and one-time Nginx adjustment. Confirm release.md documents the Home layout, manual migration, and gateway behavior. Keep the source link to docs/scope/2026-08-05-release-home-deployment/spec-release-home-deployment.md.

- [ ] **Step 3: Run documentation checks**

Run:

~~~powershell
git diff --check
powershell -NoProfile -File scripts/test_security_docs.ps1
~~~

Expected: exit code 0; every modified Wiki page still starts with > 摘要： and has a matching title.

- [ ] **Step 4: Commit the documentation contract**

~~~powershell
git add scripts/release-server/deployment.md scripts/release-server/deployment.zh-CN.md docs/wiki/architecture/gateway.md docs/wiki/release-and-build/release.md
git commit -m "docs: describe home-only release server deployment"
~~~

### Task 5: Run the full local verification and static boundary checks

**Files:**
- Test: scripts/release-server/deploy.test.mjs
- Test: scripts/release-server/remote-install.test.mjs
- Test: server/** Go tests

- [ ] **Step 1: Run all Release Server Node tests**

~~~powershell
node --test scripts/release-server/*.test.mjs
~~~

Expected: all Release Server Node tests pass.

- [ ] **Step 2: Run the Go test suite**

~~~powershell
go test ./...
~~~

Expected: all Go packages pass.

- [ ] **Step 3: Run the ordinary-installer boundary scan**

~~~powershell
$targets = @(
  'scripts/release-server/remote-install.mjs',
  'scripts/release-server/wheelmaker-release-server.service'
)
$forbidden = '/srv/wheelmaker-release|www-data|getfacl|setfacl|legacy_unit|legacy_active|legacy_enabled'
if (Select-String -Path $targets -Pattern $forbidden -Quiet) {
  throw 'ordinary installer contains a legacy/ACL boundary'
}
~~~

Expected: no match. References to /srv are allowed only in manual-migration documentation and the approved historical spec.

- [ ] **Step 4: Check the tree**

Run git diff --check and git status --short --branch. Expected: no generated staging files, no whitespace errors, and only intended feature/spec/plan/Wiki changes.

### Task 6: Perform the one-time old-host migration manually after code review

**Files:**
- No migration script is created.
- Operational target: release.wheelmaker.top over the configured SSH alias.

- [ ] **Step 1: Capture read-only state before changing the host**

Run through the SSH alias and save the output locally before stopping anything:

~~~powershell
ssh -o BatchMode=yes release.wheelmaker.top 'id -un; systemctl is-active wheelmaker-release-server.service; systemctl is-enabled wheelmaker-release-server.service; systemctl show wheelmaker-release-server.service -p User -p Group -p ExecStart --no-pager; find /etc/nginx -type f -print 2>/dev/null | sort; grep -RIl "/srv/wheelmaker-release/public" /etc/nginx 2>/dev/null || true'
~~~

Inspect the matching Nginx file and make a timestamped backup before editing it. Do not proceed if the SSH user, old unit, or Nginx root differs from the expected host.

- [ ] **Step 2: Back up old config and data to a validated Home path**

Use a timestamped directory under the login user's Home. Validate that the source paths are exactly /etc/wheelmaker-release-server/config.json and /srv/wheelmaker-release, and copy the old data before stopping the service. Extract only the old token hash and write the new config with the Home dataRoot; do not copy the old /srv path into the new config.

- [ ] **Step 3: Stop the old service, install the new user unit, and adjust only the Release Server Nginx root**

After the backup, stop the old system unit, copy the staged data/assets into ~/.wheelmaker/release-server/data, install the new unit and current link, and change the matching Nginx root/alias from /srv/wheelmaker-release/public to the Home data/public. Use ordinary owner/group/mode permissions for Nginx read/traverse access; do not install ACL packages or alter unrelated sites.

- [ ] **Step 4: Start and validate the user service**

Run the same user-level commands as the installer, then check both endpoints:

~~~powershell
ssh -o BatchMode=yes release.wheelmaker.top 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user daemon-reload && XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user enable --now wheelmaker-release-server.service && curl --fail --silent http://127.0.0.1:9680/healthz && curl --fail --silent https://release.wheelmaker.top/healthz'
~~~

Expected: both health responses contain {"ok":true}. If either check fails, stop the user service, restore the Nginx backup, and start the old system service; leave all old files intact.

- [ ] **Step 5: Complete the cutover only after both health checks pass**

Disable the old system unit without deleting it, confirm the user unit is active/enabled, and record the backup path and final Home layout. Do not run this step during ordinary deployments or as part of the Node installer.

### Task 7: Final integration handoff

- [ ] **Step 1: Rebase the feature branch before final commit**

~~~powershell
git fetch origin
git rebase origin/main
~~~

Resolve only mechanical conflicts automatically; stop for user direction if the spec, Wiki, or deployment behavior conflicts with new main changes.

- [ ] **Step 2: Run the complete verification set again**

~~~powershell
node --test scripts/release-server/*.test.mjs
go test ./...
git diff --check
git status --short --branch
~~~

Expected: all tests pass, no whitespace errors, and only the intended feature/spec/plan/Wiki changes are present.

- [ ] **Step 3: Commit, push, merge, and clean up according to Git preferences**

~~~powershell
git add docs/scope/2026-08-05-release-home-deployment docs/wiki scripts/release-server
git commit -m "refactor: separate home deployment from legacy migration"
git push -u origin release-home-deployment
git switch main
git pull --ff-only origin main
git merge --ff-only release-home-deployment
git push origin main
git worktree remove .worktree/release-home-deployment
git branch -d release-home-deployment
git push origin --delete release-home-deployment
~~~

The manual migration in Task 6 is an operational step, not part of the Git merge; record health results separately and never commit credentials or host backups.
