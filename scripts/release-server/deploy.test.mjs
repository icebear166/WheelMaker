import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
  buildRemoteInstallScript,
  deployReleaseServer,
  parseReleaseServerArgs,
} from './deploy.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

test('release server deploy uses fixed derived SSH defaults', async () => {
  const state = {
    builds: [],
    cleanups: [],
    healthChecks: [],
    installs: [],
    remoteChecks: [],
    uploads: [],
  };
  const dependencies = recordingDependencies(state);

  const result = await deployReleaseServer(dependencies);

  assert.equal(result.host, 'release.wheelmaker.top');
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.deepEqual(state.remoteChecks, [{
    host: 'release.wheelmaker.top',
    identityFile: 'C:\\Users\\tester\\.ssh\\wheelmaker-release-server_ed25519',
    port: 22,
    user: 'root',
  }]);
  assert.equal(state.uploads.length, 1);
  assert.equal(state.uploads[0].files.length, 4);
  assert.deepEqual(
    state.uploads[0].files.map(path => path.split(/[\\/]/).at(-1)).sort(),
    [
      'index.html',
      'release-home.js',
      'wheelmaker-release-server',
      'wheelmaker-release-server.service',
    ],
  );
  assert.equal(
    state.uploads[0].files.some(path => path.endsWith('wheelmaker-release-server_ed25519')),
    false,
  );
  assert.deepEqual(state.healthChecks, ['https://release.wheelmaker.top/healthz']);
  assert.equal(state.cleanups.length, 1);
});

test('release server deploy rejects a dirty tree and always cleans local staging', async () => {
  const state = {cleanups: []};
  const dependencies = recordingDependencies(state, {
    async sourceContext() {
      return {clean: false, sha: SOURCE_SHA};
    },
  });

  await assert.rejects(deployReleaseServer(dependencies), /clean source tree/);

  assert.equal(state.cleanups.length, 1);
});

test('remote install script is idempotent and preserves public releases and config', () => {
  const script = buildRemoteInstallScript();

  assert.match(script, /id -u wheelmaker-release/);
  assert.match(script, /if \[ ! -f \/etc\/wheelmaker-release-server\/config\.json \]/);
  assert.match(script, /127\.0\.0\.1:9680/);
  assert.match(script, /systemctl daemon-reload/);
  assert.match(script, /\/etc\/wheelmaker-gateway\/home/);
  assert.match(script, /run the explicit Gateway deployment first/);
  assert.match(script, /release-server\.json/);
  assert.match(script, /gateway_binary.*validate --home/);
  assert.match(script, /gateway_binary.*render --home/);
  assert.match(script, /gateway_binary paths --home/);
  assert.match(script, /127\.0\.0\.1:2019\/load/);
  assert.match(script, /Gateway is stopped/);
  assert.match(
    script,
    /release-home\.js" \/srv\/wheelmaker-release\/public\/release-home\.js/,
  );
  assert.doesNotMatch(script, /rm -rf[^\n]*public\/releases/);
  assert.doesNotMatch(script, /PRIVATE KEY|wheelmaker-release-server_ed25519/);
  assert.doesNotMatch(script, /Caddyfile|nginx|certbot|apt-get|systemctl\s+(enable|restart)\s+caddy/i);
  assert.doesNotMatch(script, /nginx-bootstrap/);
  assert.doesNotMatch(script, /nginx -t/);
  assert.doesNotMatch(script, /sites-available|sites-enabled/);
});

test('legacy Nginx mode upgrades the Release Server without requiring Gateway', () => {
  const script = buildRemoteInstallScript({legacyNginx: true});

  assert.match(script, /legacy Nginx ingress remains in place/i);
  assert.match(script, /systemctl restart wheelmaker-release-server\.service/);
  assert.doesNotMatch(script, /\/etc\/wheelmaker-gateway\/home/);
  assert.doesNotMatch(script, /release-server\.json/);
  assert.doesNotMatch(script, /gateway_binary/);
  assert.doesNotMatch(script, /setfacl/);
  assert.doesNotMatch(script, /nginx -t|systemctl\s+(stop|disable|restart|reload)\s+nginx/i);
});

test('release server deployment accepts only the explicit legacy Nginx flag', () => {
  assert.deepEqual(parseReleaseServerArgs([]), {legacyNginx: false});
  assert.deepEqual(parseReleaseServerArgs(['--legacy-nginx']), {legacyNginx: true});
  assert.throws(() => parseReleaseServerArgs(['--unknown']), /unknown release server option/);
});

test('templates enforce non-root loopback service', async () => {
  const unit = await readFile(new URL('./wheelmaker-release-server.service', import.meta.url), 'utf8');

  assert.match(unit, /^User=wheelmaker-release$/m);
  assert.match(unit, /^Group=wheelmaker-release$/m);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadWritePaths=\/srv\/wheelmaker-release/);
  assert.doesNotMatch(unit, /caddy|nginx/i);
});

test('release homepage resolves the latest same-origin client downloads', async () => {
  const homepage = await loadReleaseHomepage();
  const clients = homepage.resolveLatestClients({
    androidApk: {
      path: '/releases/v1.4/WheelMakerAndroid.apk',
      size: 2_369_931,
      version: 'v1.4',
    },
    desktopExe: {
      path: '/releases/v1.3/WheelMakerDesktop.exe',
      version: 'v1.3',
    },
  }, 'https://release.wheelmaker.top/');

  assert.deepEqual(plainJSON(clients), {
    android: {
      href: 'https://release.wheelmaker.top/releases/v1.4/WheelMakerAndroid.apk',
      size: '2.3 MB',
      version: 'v1.4',
    },
    desktop: {
      href: 'https://release.wheelmaker.top/releases/v1.3/WheelMakerDesktop.exe',
      version: 'v1.3',
    },
  });
  assert.throws(
    () => homepage.resolveLatestClients({
      desktopExe: {
        path: 'https://downloads.example/WheelMakerDesktop.exe',
        version: 'v1.3',
      },
    }, 'https://release.wheelmaker.top/'),
    /Desktop download path is invalid/,
  );
});

test('release homepage fetches stable metadata and renders both client actions', async () => {
  const homepage = await loadReleaseHomepage();
  const page = fakeReleaseHomepageDocument();
  const requests = [];

  await homepage.initialize({
    document: page.document,
    fetchImpl: async (url, options) => {
      requests.push({options, url});
      return {
        ok: true,
        async json() {
          return {
            androidApk: {
              path: '/releases/v1.4/WheelMakerAndroid.apk',
              size: 2_369_931,
              version: 'v1.4',
            },
            desktopExe: {
              path: '/releases/v1.3/WheelMakerDesktop.exe',
              version: 'v1.3',
            },
          };
        },
      };
    },
    locationHref: 'https://release.wheelmaker.top/',
  });

  assert.deepEqual(plainJSON(requests), [{
    options: {cache: 'no-store'},
    url: 'https://release.wheelmaker.top/stable.json',
  }]);
  assert.equal(page.elements['android-client'].hidden, false);
  assert.equal(page.elements['android-version'].textContent, 'v1.4');
  assert.equal(page.elements['android-size'].textContent, '2.3 MB');
  assert.equal(
    page.elements['android-download'].href,
    'https://release.wheelmaker.top/releases/v1.4/WheelMakerAndroid.apk',
  );
  assert.equal(page.elements['desktop-client'].hidden, false);
  assert.equal(page.elements['desktop-version'].textContent, 'v1.3');
  assert.equal(
    page.elements['desktop-download'].href,
    'https://release.wheelmaker.top/releases/v1.3/WheelMakerDesktop.exe',
  );
  assert.equal(page.elements['clients-status'].hidden, true);
});

test('release homepage keeps install commands usable when client metadata fails', async () => {
  const homepage = await loadReleaseHomepage();
  const page = fakeReleaseHomepageDocument();

  await homepage.initialize({
    document: page.document,
    fetchImpl: async () => ({ok: false, status: 503}),
    locationHref: 'https://release.wheelmaker.top/',
  });

  assert.equal(page.elements['android-client'].hidden, true);
  assert.equal(page.elements['desktop-client'].hidden, true);
  assert.equal(page.elements['clients-status'].hidden, false);
  assert.equal(page.elements['clients-status'].dataset.state, 'error');
  assert.match(page.elements['clients-status'].textContent, /temporarily unavailable/i);
});

test('release homepage shows an empty state before any client is published', async () => {
  const homepage = await loadReleaseHomepage();
  const page = fakeReleaseHomepageDocument();

  await homepage.initialize({
    document: page.document,
    fetchImpl: async () => ({
      ok: true,
      async json() { return {}; },
    }),
    locationHref: 'https://release.wheelmaker.top/',
  });

  assert.equal(page.elements['android-client'].hidden, true);
  assert.equal(page.elements['desktop-client'].hidden, true);
  assert.equal(page.elements['clients-status'].hidden, false);
  assert.equal(page.elements['clients-status'].dataset.state, 'empty');
  assert.match(page.elements['clients-status'].textContent, /not been published/i);
});

test('release homepage declares direct downloads and Desktop update command', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(html, /id="android-download"[^>]*>Download APK</);
  assert.match(html, /id="desktop-download"[^>]*>Download EXE</);
  assert.match(html, /data-copy="cmd-desktop-update"/);
  assert.match(html, /deploy\.mjs[^<]*desktop-update/);
  assert.match(html, /src="\/release-home\.js"/);
});

test('release homepage copy feedback restores each button label', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(html, /var originalLabel = button\.textContent/);
  assert.match(html, /button\.textContent = originalLabel/);
});

test('release homepage hidden states override layout display rules', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('release homepage constrains long install commands on mobile', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(
    html,
    /\.commands\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
  );
  assert.match(html, /\.panel\s*\{[^}]*min-width:\s*0/s);
});

test('release homepage removes redundant explanatory sections', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, />Latest clients</);
  assert.doesNotMatch(html, />What happens</);
  assert.match(
    html,
    /<section class="latest-clients" aria-label="Client downloads">/,
  );
});

test('release homepage keeps install commands stacked on desktop', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(
    html,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(html, /\.client-card\s*\{[^}]*min-height:\s*168px/s);
});

test('release homepage uses WheelMaker blue accent colors', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(html, /--accent:\s*#1478ba;/);
  assert.match(html, /--accent-hover:\s*#0d6ca9;/);
  assert.match(
    html,
    /@media \(prefers-color-scheme: dark\)[\s\S]*?--accent:\s*#29a8ff;[\s\S]*?--accent-hover:\s*#48c1ff;[\s\S]*?--accent-text:\s*#021331;/,
  );
  assert.doesNotMatch(
    html,
    /#047857|#065f46|#34d399|#6ee7b7|#062e1f/i,
  );
});

async function loadReleaseHomepage() {
  const source = await readFile(
    new URL('./release-home.js', import.meta.url),
    'utf8',
  );
  const context = {};
  vm.runInNewContext(source, context, {filename: 'release-home.js'});
  return context.WheelMakerReleaseHome;
}

function fakeReleaseHomepageDocument() {
  const elements = Object.fromEntries([
    'android-client',
    'android-download',
    'android-size',
    'android-version',
    'clients-status',
    'desktop-client',
    'desktop-download',
    'desktop-version',
  ].map(id => [id, {dataset: {}, hidden: true, href: '', textContent: ''}]));
  return {
    document: {
      getElementById(id) {
        return elements[id] ?? null;
      },
    },
    elements,
  };
}

function plainJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function recordingDependencies(state, overrides = {}) {
  return {
    channel: {baseUrl: 'https://release.wheelmaker.top'},
    homeDirectory: 'C:\\Users\\tester',
    repoRoot: 'D:\\Code\\WheelMaker',
    async sourceContext() {
      return {clean: true, sha: SOURCE_SHA};
    },
    async ensureTools() {},
    async checkRemote(remote) {
      state.remoteChecks ??= [];
      state.remoteChecks.push(remote);
      return {architecture: 'amd64', operatingSystem: 'Linux'};
    },
    async build(options) {
      state.builds ??= [];
      state.builds.push(options);
    },
    async upload(options) {
      state.uploads ??= [];
      state.uploads.push(options);
    },
    async install(options) {
      state.installs ??= [];
      state.installs.push(options);
    },
    async health(url) {
      state.healthChecks ??= [];
      state.healthChecks.push(url);
    },
    async cleanup(path) {
      state.cleanups ??= [];
      state.cleanups.push(path);
    },
    write() {},
    ...overrides,
  };
}
