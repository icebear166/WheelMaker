const fs = require('fs');
const path = require('path');
const os = require('os');
const {createHash} = require('crypto');

function loadWebpackConfig(projectRoot, mode = 'production') {
  const webpackConfigPath = path.join(projectRoot, 'web', 'webpack.config.js');
  jest.resetModules();
  const loadedConfig = require(webpackConfigPath);
  return typeof loadedConfig === 'function' ? loadedConfig({}, {mode}) : loadedConfig;
}

function withEnv(name, value, run) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe('web runtime setup', () => {
  const projectRoot = path.join(__dirname, '..');

  test('defines the web entrypoint and initializes the PWA foundation', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const workspaceApp = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(packageJson.scripts?.web).toBeDefined();
    expect(fs.existsSync(path.join(projectRoot, 'web', 'webpack.config.js'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'web', 'src', 'main.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'web', 'src', 'platform', 'pwa', 'index.ts'))).toBe(true);
    expect(workspaceApp).toContain("import { initializePWAFoundation } from '../platform/pwa';");
    expect(workspaceApp).toContain('initializePWAFoundation();');
    expect(fs.existsSync(path.join(projectRoot, 'web', 'public', 'runtime-config.js'))).toBe(false);
  });

  test('keeps service-worker notifications and immutable asset caching without an app shell', () => {
    const sw = fs.readFileSync(path.join(projectRoot, 'web', 'public', 'service-worker.js'), 'utf8');
    expect(sw).toContain("self.addEventListener('push'");
    expect(sw).toContain("self.addEventListener('notificationclick'");
    expect(sw).toContain("event.data?.type === 'WM_PWA_DEMO_NOTIFY'");
    expect(sw).toContain("event.data?.type === 'WM_PWA_NOTIFY'");
    expect(sw).toContain('function isImmutableBuildAsset(url)');
    expect(sw).toContain('/\\.[0-9a-f]{8,}\\./.test(url.pathname)');
    expect(sw).toContain("if (req.mode === 'navigate')");
    expect(sw).toContain("if (url.pathname.endsWith('/service-worker.js')) return;");
    expect(sw).not.toContain("cache.addAll(['/', '/index.html']");
    expect(sw).not.toContain('codicon');
  });

  test('publishes the current standalone WheelMaker icon contract', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'web', 'public', 'manifest.webmanifest'), 'utf8'));
    const icon = fs.readFileSync(path.join(projectRoot, 'web', 'public', 'icons', 'icon.svg'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(projectRoot, 'web', 'public', 'index.html'), 'utf8');

    expect(manifest).toMatchObject({
      display: 'standalone',
      background_color: '#1b1b1b',
      theme_color: '#1b1b1b',
      icons: [{src: '/icons/icon.svg', sizes: '1536x1536', type: 'image/svg+xml', purpose: 'any maskable'}],
    });
    expect(icon).toMatch(/<svg[\s\S]*viewBox="0 0 1254 1254"/);
    expect(indexHtml).not.toMatch(/rel="(?:icon|apple-touch-icon)"/);
    expect(indexHtml).toContain('<meta name="theme-color" content="#1b1b1b" />');
  });

  test('does not ship the retired Codicon runtime', () => {
    const sourceRoot = path.join(projectRoot, 'web', 'src');
    const sourceFiles = [];
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolutePath);
        else if (/\.(?:css|ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) sourceFiles.push(absolutePath);
      }
    };
    visit(sourceRoot);
    expect(fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8').toLowerCase()).not.toContain('codicon');
    expect(fs.readFileSync(path.join(projectRoot, 'web', 'public', 'index.html'), 'utf8').toLowerCase()).not.toContain('codicon');
    expect(sourceFiles.filter(file => fs.readFileSync(file, 'utf8').toLowerCase().includes('codicon'))).toEqual([]);
  });

  test('keeps production webpack output, assets, CSS extraction, and release defaults stable', () => {
    const config = loadWebpackConfig(projectRoot);
    const cssRule = config.module.rules.find(rule => String(rule.test) === String(/\.css$/));
    const assetRule = config.module.rules.find(rule => String(rule.test) === String(/\.(woff2?|ttf|eot|svg)$/));
    const cssPlugin = config.plugins.find(plugin => plugin.constructor.name === 'MiniCssExtractPlugin');
    const cssUses = cssRule.use.map(item => (typeof item === 'string' ? item : item?.loader));

    expect(config.entry).toEqual({bundle: path.resolve(projectRoot, 'web', 'src/main.tsx')});
    expect(config.performance).toEqual({hints: false});
    expect(config.optimization.runtimeChunk).toBeUndefined();
    expect(config.optimization.splitChunks).toBeUndefined();
    expect(config.optimization.minimizer[0].options.parallel).toBe(false);
    expect(config.devtool).toBe(false);
    expect(assetRule.generator.filename).toBe('[hash][ext][query]');
    expect(cssUses.some(item => String(item).includes('mini-css-extract-plugin'))).toBe(true);
    expect(cssUses).not.toContain('style-loader');
    expect(typeof cssPlugin.options.filename).toBe('function');
    expect(config.output.filename({chunk: {name: 'bundle'}})).toBe('bundle.[contenthash].js');
    expect(cssPlugin.options.filename({chunk: {name: 'bundle'}})).toBe('bundle.[contenthash].css');
  });

  test('isolates webpack cache and honors staging, release-cache, and source-map overrides', () => {
    const worktreeKey = createHash('sha256').update(path.resolve(projectRoot, '..')).digest('hex').slice(0, 12);
    const normal = withEnv('WHEELMAKER_WEB_TARGET', undefined, () =>
      withEnv('WHEELMAKER_WEBPACK_CACHE', undefined, () => loadWebpackConfig(projectRoot)),
    );
    expect(normal.output.path).toBe(path.join(os.homedir(), '.wheelmaker', 'web'));
    expect(normal.cache.cacheDirectory).toBe(path.join(os.homedir(), '.wheelmaker', 'cache', 'webpack', worktreeKey));

    const target = path.join(projectRoot, '..', 'server', 'cmd', 'wheelmaker-desktop', 'webroot');
    expect(withEnv('WHEELMAKER_WEB_TARGET', target, () => loadWebpackConfig(projectRoot)).output.path).toBe(path.resolve(target));
    const explicitCache = path.join(projectRoot, '.release-cache');
    expect(withEnv('WHEELMAKER_WEBPACK_CACHE', explicitCache, () => loadWebpackConfig(projectRoot)).cache.cacheDirectory).toBe(explicitCache);
    expect(withEnv('WHEELMAKER_WEB_ENABLE_SOURCEMAP', '1', () => loadWebpackConfig(projectRoot).devtool)).toBe('source-map');
  });
});
