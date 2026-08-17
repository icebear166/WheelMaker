const fs = require('fs');
const path = require('path');
const {createHash} = require('crypto');

function loadWebpackConfig(projectRoot, mode = 'production') {
  const webpackConfigPath = path.join(projectRoot, 'web', 'webpack.config.js');
  jest.resetModules();
  const loadedConfig = require(webpackConfigPath);
  if (typeof loadedConfig === 'function') {
    return loadedConfig({}, {mode});
  }
  return loadedConfig;
}

describe('web runtime setup', () => {
  test('defines web script and pure React web entrypoints', () => {
    const projectRoot = path.join(__dirname, '..');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    );

    expect(packageJson.scripts?.web).toBeDefined();
    expect(
      fs.existsSync(path.join(projectRoot, 'web', 'webpack.config.js')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, 'web', 'src', 'main.tsx')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, 'web', 'public', 'runtime-config.js'),
      ),
    ).toBe(false);
  });

  test('includes pwa foundation modules and runtime integration', () => {
    const projectRoot = path.join(__dirname, '..');
    expect(
      fs.existsSync(path.join(projectRoot, 'web', 'src', 'platform', 'pwa', 'index.ts')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, 'web', 'src', 'platform', 'pwa', 'capabilities.ts'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, 'web', 'src', 'platform', 'pwa', 'storage.ts')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, 'web', 'src', 'platform', 'pwa', 'connection.ts'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, 'web', 'src', 'platform', 'pwa', 'push.ts')),
    ).toBe(true);

    const workspaceAppTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    expect(workspaceAppTsx).toMatch(
      /import\s+\{\s*initializePWAFoundation\s*\}\s+from\s+'\.\.\/platform\/pwa';/,
    );
    expect(workspaceAppTsx).toContain('initializePWAFoundation();');
  });

  test('service worker handles push and demo notification messages', () => {
    const projectRoot = path.join(__dirname, '..');
    const sw = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'service-worker.js'),
      'utf8',
    );
    expect(sw).toContain("self.addEventListener('push'");
    expect(sw).toContain("self.addEventListener('notificationclick'");
    expect(sw).toContain("event.data?.type === 'WM_PWA_DEMO_NOTIFY'");
    expect(sw).toContain("event.data?.type === 'WM_PWA_NOTIFY'");
  });

  test('service worker does not persist the app shell', () => {
    const projectRoot = path.join(__dirname, '..');
    const sw = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'service-worker.js'),
      'utf8',
    );

    expect(sw).not.toContain("const SHELL = ['/', '/index.html'");
    expect(sw).not.toContain('cache.addAll(SHELL)');
    expect(sw).toContain("const ICON_ASSETS = ['/icons/icon.svg', '/icons/icon-192.png', '/icons/badge-96.png']");
    expect(sw).not.toContain("'/bundle.js'");
    expect(sw).not.toContain("'/bundle.css'");
    expect(sw).toContain("event.data?.type === 'WM_PWA_NOTIFY'");
    expect(sw).toContain("if (req.mode === 'navigate')");
    expect(sw).toContain('isImmutableBuildAsset');
    expect(sw).not.toContain('codicon');
    expect(sw).toContain("event.respondWith(cacheFirst(req));");
  });

  test('service worker cache-firsts immutable build assets but not navigation or service worker updates', () => {
    const projectRoot = path.join(__dirname, '..');
    const sw = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'service-worker.js'),
      'utf8',
    );

    expect(sw).toContain('function isImmutableBuildAsset(url)');
    expect(sw).toContain('/\\.[0-9a-f]{8,}\\./.test(url.pathname)');
    expect(sw).toContain("['.js', '.css', '.woff', '.woff2', '.ttf', '.svg']");
    expect(sw).toContain("if (req.mode === 'navigate')");
    expect(sw).toContain("if (url.pathname.endsWith('/service-worker.js')) return;");
    expect(sw).not.toContain("cache.addAll(['/', '/index.html']");
  });

  test('uses the current WheelMaker brand icon for PWA without hard-linking the shell favicon', () => {
    const projectRoot = path.join(__dirname, '..');
    const iconPath = path.join(projectRoot, 'web', 'public', 'icons', 'icon.svg');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'web', 'public', 'manifest.webmanifest'), 'utf8'),
    );
    const icon = fs.readFileSync(iconPath);
    const serviceWorker = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'service-worker.js'),
      'utf8',
    );
    const indexHtml = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'index.html'),
      'utf8',
    );

    expect(manifest.icons?.[0]).toMatchObject({
      src: '/icons/icon.svg',
      sizes: '1536x1536',
      type: 'image/svg+xml',
      purpose: 'any maskable',
    });
    expect(manifest).toMatchObject({
      background_color: '#1b1b1b',
      theme_color: '#1b1b1b',
    });
    const iconText = icon.toString('utf8');
    expect(iconText).toContain('<svg');
    expect(iconText).toContain('viewBox="0 0 1536 1536"');
    expect(serviceWorker).toContain('/icons/icon.svg');
    expect(serviceWorker).not.toContain('/icons/icon.png');
    expect(indexHtml).not.toContain('href="/icons/icon.svg"');
    expect(indexHtml).not.toContain('href="/icons/icon.png"');
    expect(indexHtml).not.toContain('rel="icon"');
    expect(indexHtml).not.toContain('rel="apple-touch-icon"');
    expect(indexHtml).toContain('<meta name="theme-color" content="#1b1b1b" />');
  });

  test('does not load the retired Codicon font runtime', () => {
    const projectRoot = path.join(__dirname, '..');
    const indexHtml = fs.readFileSync(
      path.join(projectRoot, 'web', 'public', 'index.html'),
      'utf8',
    );
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'main.tsx'),
      'utf8',
    );
    const packageJson = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8');
    const packageLock = fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8');

    expect(mainTsx).not.toContain('codicon');
    expect(indexHtml).not.toContain('codicon');
    expect(packageJson).not.toContain('@vscode/codicons');
    expect(packageLock).not.toContain('@vscode/codicons');
  });

  test('runtime source no longer references Codicon classes or glyphs', () => {
    const sourceRoot = path.join(__dirname, '..', 'web', 'src');
    const sourceFiles = [];
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
          continue;
        }
        if (
          /\.(?:css|ts|tsx)$/.test(entry.name) &&
          !entry.name.includes('.test.')
        ) {
          sourceFiles.push(absolutePath);
        }
      }
    };
    visit(sourceRoot);

    const offenders = sourceFiles
      .filter(filePath => fs.readFileSync(filePath, 'utf8').toLowerCase().includes('codicon'))
      .map(filePath => path.relative(sourceRoot, filePath));

    expect(offenders).toEqual([]);
  });

  test('webpack emits font assets through the standard hashed path', () => {
    const projectRoot = path.join(__dirname, '..');
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');
    const assetRule = webpackConfig.module.rules.find(rule => String(rule.test) === String(/\.(woff2?|ttf|eot|svg)$/));

    expect(assetRule.generator.filename).toBe('[hash][ext][query]');
  });

  test('webpack output path can be redirected for desktop staging', () => {
    const projectRoot = path.join(__dirname, '..');
    const target = path.join(projectRoot, '..', 'server', 'cmd', 'wheelmaker-desktop', 'webroot');
    const previous = process.env.WHEELMAKER_WEB_TARGET;

    process.env.WHEELMAKER_WEB_TARGET = target;
    const redirected = loadWebpackConfig(projectRoot);

    if (previous === undefined) {
      delete process.env.WHEELMAKER_WEB_TARGET;
    } else {
      process.env.WHEELMAKER_WEB_TARGET = previous;
    }
    const normal = loadWebpackConfig(projectRoot);

    expect(redirected.output.path).toBe(path.resolve(target));
    expect(normal.output.path).toBe(path.join(require('os').homedir(), '.wheelmaker', 'web'));
  });

  test('webpack does not emit bundle size performance warnings for local PWA releases', () => {
    const projectRoot = path.join(__dirname, '..');
    const webpackConfig = loadWebpackConfig(projectRoot);

    expect(webpackConfig.performance).toEqual({hints: false});
  });

  test('production webpack releases use low-memory defaults', () => {
    const projectRoot = path.join(__dirname, '..');
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');

    expect(webpackConfig.devtool).toBe(false);
    expect(webpackConfig.optimization.minimizer[0].options.parallel).toBe(false);
  });

  test('webpack persists build cache outside node_modules and isolates worktrees', () => {
    const projectRoot = path.join(__dirname, '..');
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');
    const worktreeKey = createHash('sha256')
      .update(path.resolve(projectRoot, '..'))
      .digest('hex')
      .slice(0, 12);

    expect(webpackConfig.cache).toEqual({
      type: 'filesystem',
      cacheDirectory: path.join(
        require('os').homedir(),
        '.wheelmaker',
        'cache',
        'webpack',
        worktreeKey,
      ),
      buildDependencies: {
        config: [
          path.join(projectRoot, 'web', 'webpack.config.js'),
          path.join(projectRoot, 'package-lock.json'),
          path.join(projectRoot, '..', 'scripts', 'release', 'channel.json'),
        ],
      },
    });
  });

  test('webpack honors an explicit cache directory for release builds', () => {
    const projectRoot = path.join(__dirname, '..');
    const explicitCache = path.join(projectRoot, '.release-cache');
    const previous = process.env.WHEELMAKER_WEBPACK_CACHE;

    process.env.WHEELMAKER_WEBPACK_CACHE = explicitCache;
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');

    if (previous === undefined) {
      delete process.env.WHEELMAKER_WEBPACK_CACHE;
    } else {
      process.env.WHEELMAKER_WEBPACK_CACHE = previous;
    }

    expect(webpackConfig.cache.cacheDirectory).toBe(explicitCache);
  });

  test('production webpack keeps chat startup on the app entry instead of automatic initial chunks', () => {
    const projectRoot = path.join(__dirname, '..');
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');

    expect(webpackConfig.optimization.runtimeChunk).toBeUndefined();
    expect(webpackConfig.optimization.splitChunks).toBeUndefined();
    expect(webpackConfig.optimization.minimizer[0].options.parallel).toBe(false);
  });

  test('production webpack source maps are disabled by default and can be enabled', () => {
    const projectRoot = path.join(__dirname, '..');
    const previousEnable = process.env.WHEELMAKER_WEB_ENABLE_SOURCEMAP;

    delete process.env.WHEELMAKER_WEB_ENABLE_SOURCEMAP;
    const defaultConfig = loadWebpackConfig(projectRoot, 'production');
    process.env.WHEELMAKER_WEB_ENABLE_SOURCEMAP = '1';
    const enabledConfig = loadWebpackConfig(projectRoot, 'production');

    if (previousEnable === undefined) {
      delete process.env.WHEELMAKER_WEB_ENABLE_SOURCEMAP;
    } else {
      process.env.WHEELMAKER_WEB_ENABLE_SOURCEMAP = previousEnable;
    }

    expect(defaultConfig.devtool).toBe(false);
    expect(enabledConfig.devtool).toBe('source-map');
  });

  test('webpack release cache can be redirected into the unified work root', () => {
    const projectRoot = path.join(__dirname, '..');
    const releaseCache = path.join(projectRoot, '..', '.release-work', 'cache', 'webpack');
    const previous = process.env.WHEELMAKER_WEBPACK_CACHE;

    process.env.WHEELMAKER_WEBPACK_CACHE = releaseCache;
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');
    if (previous === undefined) {
      delete process.env.WHEELMAKER_WEBPACK_CACHE;
    } else {
      process.env.WHEELMAKER_WEBPACK_CACHE = previous;
    }

    expect(webpackConfig.cache.cacheDirectory).toBe(path.resolve(releaseCache));
  });

  test('production webpack extracts css instead of injecting it through javascript', () => {
    const projectRoot = path.join(__dirname, '..');
    const webpackConfig = loadWebpackConfig(projectRoot, 'production');
    const indexHtml = fs.readFileSync(path.join(projectRoot, 'web', 'public', 'index.html'), 'utf8');
    const cssRule = webpackConfig.module.rules.find(rule => String(rule.test) === String(/\.css$/));
    const cssUses = cssRule.use.map(item => (typeof item === 'string' ? item : item?.loader));
    const pluginNames = webpackConfig.plugins.map(plugin => plugin.constructor.name);
    const cssPlugin = webpackConfig.plugins.find(plugin => plugin.constructor.name === 'MiniCssExtractPlugin');
    expect(typeof webpackConfig.output.filename).toBe('function');
    expect(typeof webpackConfig.output.chunkFilename).toBe('function');
    expect(typeof cssPlugin.options.filename).toBe('function');
    expect(typeof cssPlugin.options.chunkFilename).toBe('function');
    const bundleJsName = webpackConfig.output.filename({chunk: {name: 'bundle'}});
    const asyncJsName = webpackConfig.output.chunkFilename({chunk: {name: 'settings'}});
    const bundleCssName = cssPlugin.options.filename({chunk: {name: 'bundle'}});
    const asyncCssName = cssPlugin.options.chunkFilename({chunk: {name: 'settings'}});

    expect(cssUses.some(item => item.includes('mini-css-extract-plugin'))).toBe(true);
    expect(cssUses).not.toContain('style-loader');
    expect(pluginNames).toContain('MiniCssExtractPlugin');
    expect(bundleJsName).toBe('bundle.[contenthash].js');
    expect(asyncJsName).toBe('[name].[contenthash].js');
    expect(webpackConfig.entry).toEqual({bundle: path.resolve(projectRoot, 'web', 'src/main.tsx')});
    expect(bundleCssName).toBe('bundle.[contenthash].css');
    expect(asyncCssName).toBe('[name].[contenthash].css');
    const htmlPlugins = webpackConfig.plugins.filter(plugin => plugin.constructor.name === 'HtmlWebpackPlugin');
    expect(htmlPlugins.map(plugin => plugin.options.filename)).toEqual(['index.html', 'local-index.html']);
    for (const htmlPlugin of htmlPlugins) {
      expect(htmlPlugin.options.inject).toBe('body');
      expect(htmlPlugin.options.chunks).toEqual(['bundle']);
    }
    expect(indexHtml).not.toContain('htmlWebpackPlugin.files.css');
    expect(indexHtml).not.toContain('htmlWebpackPlugin.files.js');
    expect(indexHtml).not.toContain("file.includes('/bundle')");
    expect(indexHtml).not.toContain('href="/bundle.css"');
    expect(indexHtml).not.toContain('src="/bundle.js"');
  });
});
