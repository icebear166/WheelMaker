# Gateway Config and Release Server Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the special Nginx-to-Caddy bridge with one `--gateway=none|caddy` configuration selector, keep Gateway lifecycle explicit, and safely migrate Release Server from the legacy system service to the SSH login user's Home and user systemd service.

**Architecture:** Workspace and Release Server deployments only own semantic site files below the actual deployment user's `~/.wheelmaker/gateway/sites`; they never manage Nginx or Gateway runtime. Release Server local orchestration derives the host from the release channel and lets SSH configuration select the login user, while a generated remote Bash transaction stages the user service, preserves the legacy Token, switches data access and service ownership, verifies loopback/public health, and rolls the old service back on failure.

**Tech Stack:** Node.js ESM and `node:test`, generated Bash for Linux/amd64 deployment, Go Release Server CLI, user-level systemd, OpenSSH/SCP, PowerShell wrappers.

---

## File structure

- `scripts/deploy/gateway-config.mjs`: parse the unified selector and atomically own only `workspace.json`.
- `scripts/deploy/deploy.mjs`: enforce that Gateway configuration flags are valid only for a full deployment.
- `scripts/deploy/deploy-core.mjs`: prompt/select Workspace configuration without implicitly installing Gateway.
- `scripts/deploy/gateway-install.mjs`: resolve explicit Gateway lifecycle operations from the actual user Home.
- `scripts/deploy/gateway-runtime.mjs`: keep explicit runtime registration but stop publishing host-level Home metadata.
- `scripts/release-server/deploy.mjs`: own local build/upload orchestration and SSH target selection.
- `scripts/release-server/remote-install.mjs`: new focused generator for the remote user-service migration transaction.
- `scripts/release-server/wheelmaker-release-server.service`: user unit template using `%h` and `/srv/wheelmaker-release`.
- `server/cmd/wheelmaker-release-server/main.go`: expose config-only validation for pre-cutover migration checks.
- `scripts/release/publisher-config.mjs`: initialize the publishing Token through the same SSH user and user service.
- `scripts/security_acceptance.{sh,ps1}`: enforce the new Home/user-service boundary and absence of proxy lifecycle actions.
- `README.md`, `INSTALL.md`, `docs/self-hosted-release-server-design.md`, and `scripts/release-server/deployment*.md`: replace the retired bridge instructions with the unified flow.
- Delete `bootstrap-release-gateway.bat` and `scripts/release-server/bootstrap-gateway*.mjs`.

### Task 1: Commit the approved design baseline

**Files:**
- Create: `docs/scope/2026-08-05-gateway-config-and-release-server-migration/spec-gateway-config-and-release-server-migration.md`
- Create: `docs/scope/2026-08-05-gateway-config-and-release-server-migration/plan-gateway-config-and-release-server-migration.md`
- Modify: `docs/wiki/architecture/gateway.md`
- Modify: `docs/wiki/release-and-build/release.md`

- [ ] **Step 1: Verify the approved documents have valid wiki headers and no placeholders**

Run:

```powershell
Get-Content docs/wiki/architecture/gateway.md -TotalCount 2
Get-Content docs/wiki/release-and-build/release.md -TotalCount 2
$placeholderPatterns = @('T' + 'BD', 'TO' + 'DO', 'implement' + ' later', '待' + '定', '以后' + '再说')
rg -n ($placeholderPatterns -join '|') docs/scope/2026-08-05-gateway-config-and-release-server-migration docs/wiki/architecture/gateway.md docs/wiki/release-and-build/release.md
```

Expected: both wiki files start with `> 摘要：` followed by a title; `rg` exits 1 with no match.

- [ ] **Step 2: Check and commit the design baseline**

Run:

```powershell
git diff --check
git add docs/scope/2026-08-05-gateway-config-and-release-server-migration docs/wiki/architecture/gateway.md docs/wiki/release-and-build/release.md
git commit -m "docs: define gateway compatibility migration"
```

Expected: whitespace check passes and the commit contains only the approved spec, plan, and wiki updates.

### Task 2: Replace Workspace Gateway flags with one selector

**Files:**
- Modify: `scripts/deploy/gateway-config.test.mjs`
- Modify: `scripts/deploy/gateway-config.mjs`
- Modify: `scripts/deploy/deploy.test.mjs`
- Modify: `scripts/deploy/deploy.mjs`

- [ ] **Step 1: Write failing parser and file-ownership tests**

Replace the retired option test and add no-op/reuse coverage in `scripts/deploy/gateway-config.test.mjs`:

```js
test('Gateway config validates and writes only the Workspace site', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const result = await configureWorkspaceSite({
    home: root,
    mode: 'caddy',
    publicUrl: 'https://workspace.example.com',
    webRoot: join(root, 'web'),
  });
  assert.equal(result.written, true);
  assert.equal(
    JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8')).kind,
    'workspace',
  );
  await assert.rejects(
    () => access(gatewayConfigPaths(root).releaseServer),
    {code: 'ENOENT'},
  );
});

test('Gateway options accept only none or caddy and default to none', () => {
  assert.deepEqual(parseGatewayOptions([]), {
    commandArgs: [],
    explicit: false,
    mode: 'none',
    publicUrl: undefined,
  });
  assert.equal(parseGatewayOptions(['--gateway=none']).mode, 'none');
  assert.deepEqual(
    parseGatewayOptions([
      '--gateway=caddy',
      '--gateway-public-url=https://workspace.example.com',
    ]),
    {
      commandArgs: [],
      explicit: true,
      mode: 'caddy',
      publicUrl: 'https://workspace.example.com',
    },
  );
  assert.throws(() => parseGatewayOptions(['--gateway=nginx']), /none or caddy/);
  assert.throws(() => parseGatewayOptions(['--gateway=caddy', '--gateway=none']), /only be specified once/);
  assert.throws(
    () => parseGatewayOptions(['--gateway=none', '--gateway-public-url=https://example.com']),
    /only valid with --gateway=caddy/,
  );
});

test('none mode does not read or create Gateway files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-none-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const missingHome = join(root, 'missing', 'gateway');
  assert.deepEqual(
    await configureWorkspaceSite({home: missingHome, mode: 'none'}),
    {written: false},
  );
  await assert.rejects(() => access(missingHome), {code: 'ENOENT'});
  const existingHome = join(root, 'existing', 'gateway');
  const paths = gatewayConfigPaths(existingHome);
  await mkdir(paths.sites, {recursive: true});
  await writeFile(paths.workspace, 'not-json\n');
  const before = await readFile(paths.workspace, 'utf8');
  assert.deepEqual(
    await configureWorkspaceSite({home: existingHome, mode: 'none'}),
    {written: false},
  );
  assert.equal(await readFile(paths.workspace, 'utf8'), before);
});

test('caddy mode reuses or explicitly replaces only Workspace publicUrl', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-caddy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const webRoot = join(root, 'web');
  await configureWorkspaceSite({
    home: root,
    mode: 'caddy',
    publicUrl: 'https://old.example.com',
    webRoot,
  });
  await configureWorkspaceSite({home: root, mode: 'caddy', webRoot});
  let site = JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8'));
  assert.equal(site.publicUrl, 'https://old.example.com');
  await configureWorkspaceSite({
    home: root,
    mode: 'caddy',
    publicUrl: 'https://new.example.com',
    webRoot,
  });
  site = JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8'));
  assert.equal(site.publicUrl, 'https://new.example.com');
  assert.equal(site.webRoot, resolve(webRoot));
  assert.equal(site.upstream, 'http://127.0.0.1:9630');
  assert.deepEqual(site.tls, {certificateFile: '', keyFile: ''});
});

test('Workspace writes do not validate or replace another component site', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-owner-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);
  await mkdir(paths.sites, {recursive: true});
  await writeFile(paths.releaseServer, '{"ownedBy":"release-server"}\n');
  const before = await readFile(paths.releaseServer, 'utf8');
  await configureWorkspaceSite({
    home: root,
    mode: 'caddy',
    publicUrl: 'https://workspace.example.com',
    webRoot: join(root, 'web'),
  });
  assert.equal(await readFile(paths.releaseServer, 'utf8'), before);
});
```

Delete the old `promptWorkspaceSite` test/import and update imports to include `access`, `mkdir`, `resolve`, and `writeFile`. In `scripts/deploy/deploy.test.mjs`, replace the old command test with:

```js
test('Gateway configuration selector is valid only for a full deployment', () => {
  assert.deepEqual(parseDeployArgs(['gateway']), ['gateway']);
  assert.deepEqual(parseDeployArgs(['gateway-update']), ['gateway-update']);
  assert.deepEqual(parseDeployArgs(['--gateway=none']), ['--gateway=none']);
  assert.deepEqual(
    parseDeployArgs(['--gateway=caddy', '--gateway-public-url=https://workspace.example.com']),
    ['--gateway=caddy', '--gateway-public-url=https://workspace.example.com'],
  );
  assert.throws(() => parseDeployArgs(['update', '--gateway=none']), /only valid for a full deployment/);
  assert.throws(() => parseDeployArgs(['gateway', '--gateway=caddy']), /only valid for a full deployment/);
  assert.throws(() => parseDeployArgs(['--gateway-write']), /unknown deploy command/);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/deploy.test.mjs
```

Expected: FAIL because the parser still recognizes `write/skip`, `none` still reads configuration, and retired flags remain accepted.

- [ ] **Step 3: Implement the unified parser and isolated Workspace writer**

In `scripts/deploy/gateway-config.mjs`:

```js
export function parseGatewayOptions(args) {
  const options = {
    commandArgs: [],
    explicit: false,
    mode: 'none',
    publicUrl: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token.startsWith('--gateway=')) {
      if (options.explicit) throw new Error('--gateway may only be specified once');
      const mode = token.slice('--gateway='.length);
      if (!['none', 'caddy'].includes(mode)) {
        throw new Error('--gateway must be none or caddy');
      }
      options.explicit = true;
      options.mode = mode;
      continue;
    }
    if (token === '--gateway-public-url' || token.startsWith('--gateway-public-url=')) {
      if (options.publicUrl !== undefined) {
        throw new Error('--gateway-public-url may only be specified once');
      }
      if (token.includes('=')) {
        options.publicUrl = token.slice(token.indexOf('=') + 1);
      } else {
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error('--gateway-public-url requires a value');
        }
        options.publicUrl = value;
        index += 1;
      }
      continue;
    }
    options.commandArgs.push(token);
  }
  if (options.publicUrl !== undefined && options.mode !== 'caddy') {
    throw new Error('--gateway-public-url is only valid with --gateway=caddy');
  }
  return options;
}

export async function configureWorkspaceSite({
  home,
  mode = 'none',
  publicUrl,
  webRoot,
  upstream = 'http://127.0.0.1:9630',
  ask,
} = {}) {
  if (mode === 'none') return {written: false};
  if (mode !== 'caddy') throw new Error(`unsupported Gateway mode ${mode}`);
  const paths = gatewayConfigPaths(home);
  const existingValue = await readJsonIfPresent(paths.workspace);
  const existing = existingValue === null
    ? null
    : validateGatewaySite(existingValue, {kind: WORKSPACE_SITE_KIND});
  let selectedPublicUrl = publicUrl ?? existing?.publicUrl;
  if (!selectedPublicUrl && ask) {
    selectedPublicUrl = await ask('Workspace public URL', 'https://workspace.example.com');
  }
  if (!selectedPublicUrl) {
    throw new Error('first non-interactive Caddy deployment requires --gateway-public-url');
  }
  const site = workspaceSiteCandidate({
    publicUrl: selectedPublicUrl,
    webRoot,
    upstream,
  });
  await writeWorkspaceSite(home, site);
  return {existing, paths, site, written: true};
}
```

Delete `promptWorkspaceSite`, the `write/skip` branches, and the web root/upstream/TLS option flags. Keep site validation and atomic writing unchanged. In `scripts/deploy/deploy.mjs`, use `gateway.commandArgs` to reject any selector combined with a command and return the original flag list only when it represents a full deployment.

- [ ] **Step 4: Run the focused tests and commit**

Run:

```powershell
node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/deploy.test.mjs
git add scripts/deploy/gateway-config.mjs scripts/deploy/gateway-config.test.mjs scripts/deploy/deploy.mjs scripts/deploy/deploy.test.mjs
git commit -m "refactor: unify gateway configuration selector"
```

Expected: all focused tests pass; commit removes every retired Workspace Gateway flag.

### Task 3: Decouple normal deployment from Gateway lifecycle

**Files:**
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy.mjs`
- Modify: `scripts/deploy/gateway-config.mjs`
- Modify: `scripts/deploy/gateway-install.mjs`
- Modify: `scripts/deploy/gateway-runtime.test.mjs`
- Modify: `scripts/deploy/gateway-runtime.mjs`

- [ ] **Step 1: Add failing full-deployment, update-isolation, and Home tests**

Add tests that run `installFixture` through a full deployment with an explicit temporary `userHome`:

```js
test('full deployment writes Caddy config without installing Gateway', async (t) => {
  const fixture = await installFixture(t);
  const userHome = join(dirname(fixture.home), 'login-home');
  fixture.deps.userHome = userHome;
  fixture.deps.interactive = false;
  fixture.deps.trustedStable.gateway = {version: 'invalid-implicit-pointer'};
  await runCore([
    '--gateway=caddy',
    '--gateway-public-url=https://workspace.example.com',
  ], fixture.deps);
  const sitePath = join(userHome, '.wheelmaker', 'gateway', 'sites', 'workspace.json');
  const site = JSON.parse(await readFile(sitePath, 'utf8'));
  assert.equal(site.publicUrl, 'https://workspace.example.com');
  assert.equal(site.webRoot, join(fixture.home, 'web'));
});

test('noninteractive default and update leave Gateway Home absent', async (t) => {
  for (const args of [[], ['update']]) {
    const fixture = await installFixture(t);
    const userHome = join(dirname(fixture.home), args.length === 0 ? 'full-home' : 'update-home');
    fixture.deps.userHome = userHome;
    fixture.deps.interactive = false;
    await runCore(args, fixture.deps);
    await assert.rejects(
      () => access(join(userHome, '.wheelmaker', 'gateway')),
      {code: 'ENOENT'},
    );
  }
});
```

Update the `node:path` import in `deploy-core.test.mjs` to import both `dirname` and `join`.

Update the Linux runtime expectation in `scripts/deploy/gateway-runtime.test.mjs` so the first calls are `loginctl` and `setcap`, and add:

```js
const flattenedCalls = calls
  .flatMap(({command, args}) => [command, ...args])
  .join(' ');
assert.equal(flattenedCalls.includes('/etc/wheelmaker-gateway/home'), false);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
node --test scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-runtime.test.mjs scripts/deploy/gateway-install.test.mjs
```

Expected: FAIL because a full deployment still installs Gateway, derives its Home from the Hub install directory, and writes host-level metadata.

- [ ] **Step 3: Implement configuration-only full deployment**

In `executeDeployment` inside `scripts/deploy/deploy-core.mjs`, replace the current Gateway block with:

```js
if (!internalUpdate) {
  const gatewayOptions = deps.gatewayOptions ?? parseGatewayOptions([]);
  let mode = gatewayOptions.mode;
  let questioner;
  try {
    if (!gatewayOptions.explicit && deps.interactive) {
      if (!deps.gatewayQuestion) questioner = createGatewayQuestioner();
      const ask = deps.gatewayQuestion ?? questioner.ask;
      const answer = String(
        await ask('Write Workspace Caddy configuration? [y/N]', 'n'),
      ).trim().toLowerCase();
      mode = ['y', 'yes'].includes(answer) ? 'caddy' : 'none';
    }
    if (mode === 'caddy') {
      const result = await configureWorkspaceSite({
        ask: deps.gatewayQuestion ?? questioner?.ask,
        home: deps.gatewayHome ?? gatewayHome({userHome: deps.userHome ?? homedir()}),
        mode,
        publicUrl: gatewayOptions.publicUrl,
        upstream: 'http://127.0.0.1:9630',
        webRoot: join(home, 'web'),
      });
      if (result.written) deps.reportStatus?.('Workspace Caddy configuration written');
    }
  } finally {
    questioner?.close();
  }
}
```

Delete the `installGatewayFromStable` call from normal deployment. Keep `executeGatewayDeployment` unchanged except for resolving its default Home with `gatewayHome({userHome: deps.userHome ?? homedir()})`. Remove `gatewayEnabled` from the launcher dependency object. In `gateway-config.mjs`, simplify `gatewayHome` to explicit `home` or `resolve(userHome, '.wheelmaker', 'gateway')`; remove `installDirectory` from the call in `gateway-install.mjs`.

In `gateway-runtime.mjs`, delete only the `/etc/wheelmaker-gateway` directory creation and metadata write. Keep linger, low-port capability, user unit installation, enable, and start for explicit Gateway lifecycle commands.

- [ ] **Step 4: Run focused tests and commit**

Run:

```powershell
node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs
git add scripts/deploy/deploy-core.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/deploy.mjs scripts/deploy/gateway-config.mjs scripts/deploy/gateway-install.mjs scripts/deploy/gateway-runtime.mjs scripts/deploy/gateway-runtime.test.mjs
git commit -m "refactor: keep gateway lifecycle explicit"
```

Expected: normal full/update deployments never call the Gateway installer; explicit Gateway tests still pass and use the login user's Home.

### Task 4: Add Release Server config preflight validation

**Files:**
- Modify: `server/cmd/wheelmaker-release-server/main_test.go`
- Modify: `server/cmd/wheelmaker-release-server/main.go`

- [ ] **Step 1: Write failing CLI tests**

Add:

```go
func TestRunValidateConfigChecksWithoutStartingServer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := releaseserver.Config{
		Schema:   1,
		Listen:   "127.0.0.1:9680",
		DataRoot: filepath.Join(t.TempDir(), "data"),
	}
	if err := releaseserver.WriteConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"validate-config", "--config", path}, &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
		t.Fatalf("run() error = %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"schema":1,"listen":"0.0.0.0:9680","dataRoot":"/srv/wheelmaker-release","tokenSha256":""}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"validate-config", "--config", path}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
		t.Fatal("run() error = nil")
	}
}
```

Extend the unknown-command table with an invalid `validate-config` invocation lacking `--config`.

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
Push-Location server
go test ./cmd/wheelmaker-release-server
Pop-Location
```

Expected: FAIL with unknown command `validate-config`.

- [ ] **Step 3: Implement config-only validation**

Add this switch branch before `configure-token`:

```go
	case "validate-config":
		flags := flag.NewFlagSet("validate-config", flag.ContinueOnError)
		flags.SetOutput(stderr)
		configPath := flags.String("config", "", "release server config path")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *configPath == "" || flags.NArg() != 0 {
			return errors.New("validate-config requires exactly --config")
		}
		_, err := releaseserver.LoadConfig(*configPath)
		return err
```

Update the no-command message to list `serve`, `validate-config`, and `configure-token`.

- [ ] **Step 4: Run the test and commit**

Run:

```powershell
Push-Location server
go test ./cmd/wheelmaker-release-server ./internal/releaseserver
Pop-Location
git add server/cmd/wheelmaker-release-server/main.go server/cmd/wheelmaker-release-server/main_test.go
git commit -m "feat: validate release server config before migration"
```

Expected: both Go packages pass.

### Task 5: Move Release Server orchestration to the SSH login user

**Files:**
- Create: `scripts/release-server/remote-install.mjs`
- Modify: `scripts/release-server/deploy.test.mjs`
- Modify: `scripts/release-server/deploy.mjs`
- Modify: `scripts/release-server/wheelmaker-release-server.service`

- [ ] **Step 1: Write failing option, SSH target, and user-unit tests**

In `scripts/release-server/deploy.test.mjs`, update the orchestration assertions and option test:

```js
test('release server deploy derives host and lets SSH choose the login user', async () => {
  const state = {builds: [], cleanups: [], installs: [], remoteChecks: [], uploads: []};
  const result = await deployReleaseServer(recordingDependencies(state, {gateway: 'caddy'}));
  assert.equal(result.host, 'release.wheelmaker.top');
  assert.deepEqual(state.remoteChecks, [{
    host: 'release.wheelmaker.top',
    identityFile: 'C:\\Users\\tester\\.ssh\\wheelmaker-release-server_ed25519',
    port: 22,
  }]);
  assert.equal(state.installs[0].gateway, 'caddy');
  assert.equal('user' in state.remoteChecks[0], false);
});

test('release server deployment accepts only the unified Gateway selector', () => {
  assert.deepEqual(parseReleaseServerArgs([]), {gateway: 'none'});
  assert.deepEqual(parseReleaseServerArgs(['--gateway=none']), {gateway: 'none'});
  assert.deepEqual(parseReleaseServerArgs(['--gateway=caddy']), {gateway: 'caddy'});
  assert.throws(() => parseReleaseServerArgs(['--gateway=nginx']), /none or caddy/);
  assert.throws(() => parseReleaseServerArgs(['--legacy-nginx']), /unknown release server option/);
});

test('Release Server template is a hardened user unit rooted in Home', async () => {
  const unit = await readFile(new URL('./wheelmaker-release-server.service', import.meta.url), 'utf8');
  assert.match(unit, /^ExecStart=%h\/.wheelmaker\/release-server\/current\/wheelmaker-release-server serve --config %h\/.wheelmaker\/release-server\/config\.json$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.match(unit, /^ProtectHome=read-only$/m);
  assert.doesNotMatch(unit, /^User=|^Group=|\/opt\/|\/etc\/wheelmaker-release-server/m);
});
```

In the default dependency tests, inspect SSH/SCP targets and require the exact host without `root@`.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```powershell
node --test scripts/release-server/deploy.test.mjs
```

Expected: FAIL because `--legacy-nginx`, `remote.user`, root paths, and the system unit still exist.

- [ ] **Step 3: Implement local orchestration and user unit**

Use this parser:

```js
export function parseReleaseServerArgs(args) {
  let gateway = 'none';
  let seenGateway = false;
  for (const arg of args) {
    if (arg.startsWith('--gateway=')) {
      if (seenGateway) throw new Error('--gateway may only be specified once');
      gateway = arg.slice('--gateway='.length);
      if (!['none', 'caddy'].includes(gateway)) {
        throw new Error('--gateway must be none or caddy');
      }
      seenGateway = true;
      continue;
    }
    throw new Error(`unknown release server option: ${arg}`);
  }
  return {gateway};
}
```

Import `buildRemoteInstallScript` from `./remote-install.mjs`. Build `remote` with only `host`, `identityFile`, and `port`; every SSH/SCP invocation must use `remote.host`, allowing the user's SSH config to supply the username. Pass `gateway` as the fourth safe argument to `bash -s --`, and remove the informational local public-health catch because the remote transaction performs both health checks before committing.

Replace the unit template with:

```ini
[Unit]
Description=WheelMaker Release Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/srv/wheelmaker-release
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
ReadWritePaths=/srv/wheelmaker-release

[Install]
WantedBy=default.target
```

- [ ] **Step 4: Run the orchestration checkpoint**

Run:

```powershell
node --test scripts/release-server/deploy.test.mjs
```

Expected: orchestration tests pass. Keep these changes uncommitted until Task 6 completes the imported remote transaction, so no commit contains a nonfunctional deployment path.

### Task 6: Implement the transactional remote migration

**Files:**
- Create: `scripts/release-server/remote-install.test.mjs`
- Modify: `scripts/release-server/remote-install.mjs`
- Modify: `scripts/release-server/deploy.test.mjs`

- [ ] **Step 1: Write structural and failure-path tests**

Create `scripts/release-server/remote-install.test.mjs` with assertions for all transaction boundaries:

```js
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
```

Extend `deploy.test.mjs` to assert the install call receives channel `publicUrl`, upload directory, source SHA, and the selected Gateway value.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test scripts/release-server/remote-install.test.mjs scripts/release-server/deploy.test.mjs
```

Expected: FAIL until the remote transaction contains every preflight, rollback, health, and ownership boundary.

- [ ] **Step 3: Implement the remote script generator**

`buildRemoteInstallScript()` must return one static Bash program with the following concrete state and helper contract:

```js
export function buildRemoteInstallScript() {
  return String.raw`#!/usr/bin/env bash
set -Eeuo pipefail

source_sha="$1"
public_url="$2"
upload_dir="$3"
gateway_mode="$4"
legacy_unit="wheelmaker-release-server.service"
user_unit="wheelmaker-release-server.service"
deploy_user="$(id -un)"
deploy_group="$(id -gn)"
deploy_uid="$(id -u)"
deploy_home="$(getent passwd "$deploy_user" | cut -d: -f6)"
release_home="$deploy_home/.wheelmaker/release-server"
versions_home="$release_home/versions"
current_link="$release_home/current"
config_path="$release_home/config.json"
unit_home="$deploy_home/.config/systemd/user"
unit_path="$unit_home/$user_unit"
data_root="/srv/wheelmaker-release"
legacy_config="/etc/wheelmaker-release-server/config.json"
preflight_complete=0
rollback_armed=0
legacy_exists=0
legacy_active=inactive
legacy_enabled=disabled
user_active=inactive
user_enabled=disabled
linger_before=no
previous_current=""
unit_backup=""
acl_backup=""

root_command() {
  if [ "$deploy_uid" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

user_systemctl() {
  XDG_RUNTIME_DIR="/run/user/$deploy_uid" systemctl --user "$@"
}

restore_boolean_service_state() {
  manager="$1"
  enabled="$2"
  active="$3"
  unit="$4"
  if [ "$manager" = root ]; then
    if [ "$enabled" = enabled ]; then root_command systemctl enable "$unit"; else root_command systemctl disable "$unit"; fi
    if [ "$active" = active ]; then root_command systemctl start "$unit"; else root_command systemctl stop "$unit"; fi
  else
    if [ "$enabled" = enabled ]; then user_systemctl enable "$unit"; else user_systemctl disable "$unit"; fi
    if [ "$active" = active ]; then user_systemctl start "$unit"; else user_systemctl stop "$unit"; fi
  fi
}

rollback() {
  status="$1"
  trap - ERR INT TERM
  set +e
  if [ "$rollback_armed" -eq 1 ]; then
    user_systemctl stop "$user_unit"
    if [ -n "$previous_current" ]; then
      ln -sfn "$previous_current" "$current_link.next"
      mv -Tf "$current_link.next" "$current_link"
    else
      rm -f "$current_link"
    fi
    if [ -n "$unit_backup" ] && [ -f "$unit_backup" ]; then
      cp -f "$unit_backup" "$unit_path"
    fi
    user_systemctl daemon-reload
    restore_boolean_service_state user "$user_enabled" "$user_active" "$user_unit"
    if [ -n "$acl_backup" ] && [ -f "$acl_backup" ]; then
      root_command setfacl --restore="$acl_backup"
    fi
    if [ "$legacy_exists" -eq 1 ]; then
      restore_boolean_service_state root "$legacy_enabled" "$legacy_active" "$legacy_unit"
    fi
    if [ "$linger_before" != yes ]; then
      root_command loginctl disable-linger "$deploy_user"
    fi
  fi
  exit "$status"
}

trap 'rollback $?' ERR INT TERM
`;
}
```

Continue the same returned string, in this exact phase order:

1. Validate the four arguments, SHA, clean HTTPS origin, exact upload path, `gateway_mode`, Linux/amd64, non-empty absolute login Home, and uploaded files.
2. Require `curl`, `getent`, `systemctl`, `loginctl`, `getfacl`, and `setfacl`; when non-root, run `sudo -n true`; export `XDG_RUNTIME_DIR=/run/user/$deploy_uid` and require `user_systemctl show-environment` before any stop.
3. Stage `versions/$source_sha/wheelmaker-release-server`, candidate config, user unit, `index.html`, and `release-home.js` below the login user's Home. Copy the legacy config through `root_command cat` only when the user config does not exist, otherwise generate exactly `{"schema":1,"listen":"127.0.0.1:9680","dataRoot":"/srv/wheelmaker-release","tokenSha256":""}`. Run the staged binary's `validate-config` against the candidate before setting `preflight_complete=1`.
4. Record system/user active and enabled states, linger, current symlink target, existing unit backup, and `getfacl -R -p /srv/wheelmaker-release` when the data root exists.
5. Set `rollback_armed=1`; enable linger; stop/disable only the legacy system unit when present; create or grant the login user access to `/srv/wheelmaker-release`, keeping `public` group `www-data` and setgid so the unchanged Nginx can read future `0640` assets.
6. Atomically install the user config, unit, and `current` symlink; run `user_systemctl daemon-reload`, `enable`, and `restart`.
7. Poll `http://127.0.0.1:9680/healthz`, then `$public_url/healthz`. Either timeout triggers the trap while rollback remains armed.
8. Install the public homepage assets. Only for `caddy`, atomically write this document to the login user's Gateway Home:

```json
{
  "schema": 1,
  "kind": "release-server",
  "publicUrl": "https://release.wheelmaker.top",
  "publicRoot": "/srv/wheelmaker-release/public",
  "upstream": "http://127.0.0.1:9680",
  "tls": {"certificateFile": "", "keyFile": ""}
}
```

9. Set `rollback_armed=0`, remove temporary backups/upload directory, and leave the legacy unit/files/user present but disabled.

Do not add Gateway/Caddy validation, rendering, admin API calls, or any Nginx command. Use `printf` with the already validated channel origin and an atomic temporary file for the site.

- [ ] **Step 4: Add explicit rollback-order assertions**

For each cutover failure surface, assert that it occurs after `rollback_armed=1` and before `rollback_armed=0`:

```js
for (const marker of [
  'user_systemctl restart "$user_unit"',
  'http://127.0.0.1:9680/healthz',
  '"$public_url/healthz"',
]) {
  const position = script.indexOf(marker);
  assert.ok(position > script.indexOf('rollback_armed=1'));
  assert.ok(position < script.indexOf('rollback_armed=0'));
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test scripts/release-server/remote-install.test.mjs scripts/release-server/deploy.test.mjs
git add scripts/release-server/remote-install.mjs scripts/release-server/remote-install.test.mjs scripts/release-server/deploy.mjs scripts/release-server/deploy.test.mjs scripts/release-server/wheelmaker-release-server.service
git commit -m "feat: migrate release server with rollback"
```

Expected: tests prove preflight precedes stop, every health failure remains inside the rollback window, `none` cannot create Gateway paths, and no proxy lifecycle command is generated.

### Task 7: Move first-publish Token initialization to the user service

**Files:**
- Modify: `scripts/release/publisher-config.test.mjs`
- Modify: `scripts/release/publisher-config.mjs`

- [ ] **Step 1: Write a failing SSH command test**

Add assertions to the first-publish test:

```js
const [configure, restart] = deps.state.sshCalls;
assert.equal(configure.includes('root@release.wheelmaker.top'), false);
assert.equal(restart.includes('root@release.wheelmaker.top'), false);
assert.equal(configure.includes('release.wheelmaker.top'), true);
assert.equal(
  configure.includes('$HOME/.wheelmaker/release-server/current/wheelmaker-release-server'),
  true,
);
assert.equal(
  configure.includes('$HOME/.wheelmaker/release-server/config.json'),
  true,
);
assert.deepEqual(restart.slice(-4), [
  'systemctl',
  '--user',
  'restart',
  'wheelmaker-release-server.service',
]);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
node --test scripts/release/publisher-config.test.mjs
```

Expected: FAIL on root target, `/opt`, `/etc`, and system-service assertions.

- [ ] **Step 3: Update remote commands without changing Token persistence**

Build the prefix and calls as:

```js
const sshPrefix = [
  '-i',
  deps.identityFile,
  '-p',
  '22',
  deps.host,
];
await deps.configureRemote([
  ...sshPrefix,
  '$HOME/.wheelmaker/release-server/current/wheelmaker-release-server',
  'configure-token',
  '--config',
  '$HOME/.wheelmaker/release-server/config.json',
  '--sha256',
  tokenHash,
]);
await deps.restartRemote([
  ...sshPrefix,
  'systemctl',
  '--user',
  'restart',
  'wheelmaker-release-server.service',
]);
```

Do not change pending Token generation, protected atomic writes, GitHub Secret stdin, or health promotion.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
node --test scripts/release/publisher-config.test.mjs scripts/release/release-server-api.test.mjs
git add scripts/release/publisher-config.mjs scripts/release/publisher-config.test.mjs
git commit -m "fix: configure publisher through user service"
```

Expected: publisher tests and the old-server request omission regression pass.

### Task 8: Remove the retired bridge and update active operational guidance

**Files:**
- Delete: `bootstrap-release-gateway.bat`
- Delete: `scripts/release-server/bootstrap-gateway.mjs`
- Delete: `scripts/release-server/bootstrap-gateway.test.mjs`
- Modify: `scripts/release-server/deployment.md`
- Modify: `scripts/release-server/deployment.zh-CN.md`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `docs/self-hosted-release-server-design.md`
- Modify: `scripts/security_acceptance.sh`
- Modify: `scripts/security_acceptance.ps1`
- Modify: `scripts/test_security_acceptance_ps1.ps1`

- [ ] **Step 1: Update security gates first and verify they fail on stale code**

Make both acceptance entries read `scripts/release-server/deploy.mjs` and `remote-install.mjs`, then require:

```text
"listen":"127.0.0.1:9680"
$deploy_home/.wheelmaker/release-server
$deploy_home/.wheelmaker/gateway/sites
systemctl --user
release-server.json
```

Forbid these active-source strings/behaviors:

```text
root@release.wheelmaker.top
/etc/wheelmaker-gateway/home
/srv/wheelmaker-release/gateway
--legacy-nginx
bootstrap-release-gateway
gateway_binary validate
gateway_binary render
127.0.0.1:2019/load
systemctl start|stop|restart|enable|disable nginx|caddy
```

Keep the existing credential/private-key upload checks. Update `scripts/test_security_acceptance_ps1.ps1` to require the new Home and user-service gates in both acceptance entrypoints.

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_acceptance_ps1.ps1
```

Expected: FAIL until stale bridge code and old acceptance requirements are removed.

- [ ] **Step 2: Delete the one-time bridge artifacts**

Use `apply_patch` to delete the three files. Do not delete `scripts/disable-nginx.sh`, `scripts/disable-nginx.ps1`, or `scripts/disable-nginx.test.mjs`; they remain independent operational tools.

- [ ] **Step 3: Rewrite active documentation around the unified flow**

Document these exact commands and outcomes in both languages:

```text
deploy-release-server.bat --gateway=none
  Deploy/migrate the Release Server and do not touch Gateway files.

deploy-release-server.bat --gateway=caddy
  Perform the same deploy/migration and atomically write
  ~/.wheelmaker/gateway/sites/release-server.json.
```

Replace root SSH requirements with “the SSH config chooses the login user; the same user must deploy Workspace and Release Server when colocated.” State that the login user needs noninteractive sudo for `/srv`, legacy system-service state, ACL restoration, and linger. Describe automatic legacy Token/service migration and rollback, the unchanged Nginx paths/upstream, actual Home/user-unit paths, and mandatory loopback/public health checks. Preserve the independent Nginx disable scripts and explicit Gateway lifecycle instructions.

In `docs/self-hosted-release-server-design.md`, replace the old path block with:

```text
~/.wheelmaker/release-server/config.json
~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
~/.wheelmaker/release-server/current
~/.config/systemd/user/wheelmaker-release-server.service
~/.wheelmaker/gateway/sites/release-server.json  # only --gateway=caddy
/srv/wheelmaker-release                         # stable data root
```

- [ ] **Step 4: Prove no retired active references remain**

Run:

```powershell
rg -n --glob '!docs/scope/**' 'root@release\.wheelmaker\.top|/etc/wheelmaker-gateway/home|/srv/wheelmaker-release/gateway|--legacy-nginx|bootstrap-release-gateway|gateway-write|gateway-skip|gateway-config=' README.md INSTALL.md docs/self-hosted-release-server-design.md scripts
```

Expected: exit 1 with no matches.

- [ ] **Step 5: Run documentation/security tests and commit**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_docs.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_acceptance_ps1.ps1
git add README.md INSTALL.md docs/self-hosted-release-server-design.md scripts/security_acceptance.sh scripts/security_acceptance.ps1 scripts/test_security_acceptance_ps1.ps1 scripts/release-server/deployment.md scripts/release-server/deployment.zh-CN.md
git add -u bootstrap-release-gateway.bat scripts/release-server
git commit -m "docs: retire nginx gateway bridge"
```

Expected: both PowerShell checks pass and the commit deletes only the obsolete bridge artifacts.

### Task 9: Run cross-component regression and acceptance checks

**Files:**
- Modify only files found incorrect by the checks above; do not broaden scope.

- [ ] **Step 1: Run all release/deployment Node tests**

Run:

```powershell
$nodeTests = @(
  Get-ChildItem scripts/release-server -Filter '*.test.mjs' -File
  Get-ChildItem scripts/release -Filter '*.test.mjs' -File
  Get-ChildItem scripts/deploy -Filter '*.test.mjs' -File
  Get-Item scripts/disable-nginx.test.mjs
) | ForEach-Object FullName
node --test $nodeTests
```

Expected: all tests pass, including the regression that omits `withGateway` for old Release Server requests.

- [ ] **Step 2: Run the full Go suite**

Run:

```powershell
Push-Location server
go test ./...
Pop-Location
```

Expected: all Go packages pass without a protocol version change.

- [ ] **Step 3: Run script acceptance and whitespace checks**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_docs.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_acceptance_ps1.ps1
git diff --check
git status --short
```

Expected: checks pass; status contains only intentional feature changes.

- [ ] **Step 4: Inspect the final architectural invariants**

Run:

```powershell
rg -n --glob '!docs/scope/**' 'root@release\.wheelmaker\.top|/etc/wheelmaker-gateway/home|/srv/wheelmaker-release/gateway|--legacy-nginx|bootstrap-release-gateway|gateway-write|gateway-skip|gateway-config=' README.md INSTALL.md docs/self-hosted-release-server-design.md scripts
rg -n 'systemctl\s+(start|stop|restart|enable|disable)\s+(nginx|caddy)|127\.0\.0\.1:2019/load|gateway_binary.*(validate|render)' scripts/release-server scripts/release/publisher-config.mjs
```

Expected: both searches exit 1. Historical specs are excluded intentionally; active code and docs contain no retired migration path or proxy lifecycle action.

- [ ] **Step 5: Commit any verification-only corrections**

If Step 1–4 required corrections, run:

```powershell
git add scripts/deploy scripts/release-server scripts/release server/cmd/wheelmaker-release-server README.md INSTALL.md docs/self-hosted-release-server-design.md
git commit -m "test: close gateway migration regressions"
```

Expected: no commit is created when no corrections were needed; otherwise the commit contains only regression fixes identified by the verification commands.

### Task 10: Perform the real legacy-host deployment acceptance

**Files:**
- No repository files should change.

- [ ] **Step 1: Record old machine state before deployment**

Run through the same SSH alias/user used by `deploy-release-server.bat`:

```powershell
ssh -i "$HOME/.ssh/wheelmaker-release-server_ed25519" release.wheelmaker.top "id; systemctl is-active wheelmaker-release-server.service; systemctl is-enabled wheelmaker-release-server.service; curl --fail --silent http://127.0.0.1:9680/healthz; curl --fail --silent https://release.wheelmaker.top/healthz"
```

Expected: the login identity is the intended shared deployment user, the legacy service state is recorded, and both health endpoints are currently usable.

- [ ] **Step 2: Deploy Caddy configuration while Nginx remains active**

Run from a clean committed source tree:

```powershell
.\deploy-release-server.bat --gateway=caddy
```

Expected: deployment succeeds without Caddy installed or started because Nginx continues serving the unchanged public root/upstream.

- [ ] **Step 3: Verify migrated state and dormant site configuration**

Run:

```powershell
ssh -i "$HOME/.ssh/wheelmaker-release-server_ed25519" release.wheelmaker.top 'systemctl --user is-active wheelmaker-release-server.service; systemctl --user is-enabled wheelmaker-release-server.service; systemctl is-enabled wheelmaker-release-server.service || true; test -x "$HOME/.wheelmaker/release-server/current/wheelmaker-release-server"; test -r "$HOME/.wheelmaker/release-server/config.json"; test -r "$HOME/.wheelmaker/gateway/sites/release-server.json"; curl --fail --silent http://127.0.0.1:9680/healthz; curl --fail --silent https://release.wheelmaker.top/healthz'
```

Expected: user service is active/enabled, old system service is disabled, both health checks pass through existing Nginx, and Caddy site JSON exists without any Gateway lifecycle change.

- [ ] **Step 4: Confirm source tree remains clean**

Run:

```powershell
git status --short --branch
```

Expected: clean feature branch; remote deployment produced no local files.
