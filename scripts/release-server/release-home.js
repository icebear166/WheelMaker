(function (root) {
  'use strict';

  var VERSION_PATTERN = /^v1\.(0|[1-9]\d*)$/;

  function releaseOrigin(locationHref) {
    if (typeof locationHref !== 'string') {
      throw new Error('Release page location is invalid');
    }
    var match = /^(https:\/\/[^/?#]+)(?:[/?#]|$)/.exec(locationHref);
    if (!match) {
      throw new Error('Release page must use HTTPS');
    }
    return match[1];
  }

  function resolveDownloadPath(path, fileName, label, origin) {
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      path.includes('?') ||
      path.includes('#') ||
      !path.endsWith('/' + fileName)
    ) {
      throw new Error(label + ' download path is invalid');
    }
    return origin + path;
  }

  function requireVersion(pointer, label) {
    if (!VERSION_PATTERN.test(pointer && pointer.version || '')) {
      throw new Error(label + ' version is invalid');
    }
    return pointer.version;
  }

  function formatFileSize(size) {
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new Error('Android download size is invalid');
    }
    if (size < 1024 * 1024) {
      return (size / 1024).toFixed(1) + ' KB';
    }
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function resolveLatestClients(stable, locationHref) {
    if (!stable || typeof stable !== 'object' || Array.isArray(stable)) {
      throw new Error('Stable release metadata is invalid');
    }
    var origin = releaseOrigin(locationHref);
    var clients = {android: null, desktop: null};
    if (stable.androidApk !== undefined) {
      clients.android = {
        href: resolveDownloadPath(
          stable.androidApk.path,
          'WheelMakerAndroid.apk',
          'Android',
          origin
        ),
        size: formatFileSize(stable.androidApk.size),
        version: requireVersion(stable.androidApk, 'Android'),
      };
    }
    if (stable.desktopExe !== undefined) {
      clients.desktop = {
        href: resolveDownloadPath(
          stable.desktopExe.path,
          'WheelMakerDesktop.exe',
          'Desktop',
          origin
        ),
        version: requireVersion(stable.desktopExe, 'Desktop'),
      };
    }
    return clients;
  }

  function showClient(documentValue, name, client) {
    var card = documentValue.getElementById(name + '-client');
    var version = documentValue.getElementById(name + '-version');
    var download = documentValue.getElementById(name + '-download');
    if (!card || !version || !download) {
      throw new Error('Release page client elements are missing');
    }
    version.textContent = client.version;
    download.href = client.href;
    if (name === 'android') {
      var size = documentValue.getElementById('android-size');
      if (!size) throw new Error('Release page Android size element is missing');
      size.textContent = client.size;
    }
    card.hidden = false;
  }

  async function initialize(options) {
    var documentValue = options.document;
    var status = documentValue.getElementById('clients-status');
    var loading = documentValue.getElementById('clients-loading');
    if (!status) throw new Error('Release page client status element is missing');
    try {
      var origin = releaseOrigin(options.locationHref);
      var response = await options.fetchImpl(origin + '/stable.json', {
        cache: 'no-store',
      });
      if (!response || !response.ok) {
        throw new Error('Stable release request failed');
      }
      var clients = resolveLatestClients(
        await response.json(),
        options.locationHref
      );
      if (clients.android) showClient(documentValue, 'android', clients.android);
      if (clients.desktop) showClient(documentValue, 'desktop', clients.desktop);
      if (!clients.android && !clients.desktop) {
        status.dataset.state = 'empty';
        status.textContent = 'Client downloads have not been published yet.';
        status.hidden = false;
      } else {
        status.textContent = '';
        status.hidden = true;
      }
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = 'Latest clients are temporarily unavailable. Try again later.';
      status.hidden = false;
    } finally {
      if (loading) loading.hidden = true;
    }
  }

  root.WheelMakerReleaseHome = {
    initialize: initialize,
    resolveLatestClients: resolveLatestClients,
  };

  if (
    typeof root.document !== 'undefined' &&
    typeof root.fetch === 'function' &&
    root.location &&
    typeof root.location.href === 'string'
  ) {
    initialize({
      document: root.document,
      fetchImpl: root.fetch.bind(root),
      locationHref: root.location.href,
    });
  }
})(globalThis);
