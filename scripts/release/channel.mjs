export function validateReleaseChannel(channel) {
  if (
    !channel ||
    typeof channel !== 'object' ||
    Array.isArray(channel) ||
    Object.keys(channel).sort().join(',') !== 'baseUrl'
  ) {
    throw new Error('release channel must contain only baseUrl');
  }
  let base;
  try {
    base = new URL(channel.baseUrl);
  } catch {
    throw new Error('release channel baseUrl must be a clean HTTPS origin');
  }
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    channel.baseUrl !== base.origin
  ) {
    throw new Error('release channel baseUrl must be a clean HTTPS origin');
  }
  return {baseUrl: base.origin};
}

export function releasePublicUrl(channel, path) {
  const {baseUrl} = validateReleaseChannel(channel);
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('release path must be root-relative');
  }
  if (path.startsWith('//')) {
    throw new Error('release path must stay on the same origin');
  }
  const resolved = new URL(path, `${baseUrl}/`);
  if (resolved.origin !== baseUrl) {
    throw new Error('release path must stay on the same origin');
  }
  return resolved.href;
}

export function versionAssetPath(version, name) {
  if (
    !/^v1\.(0|[1-9]\d*)$/.test(version) ||
    !/^[A-Za-z0-9._-]+$/.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error('invalid release asset path');
  }
  return `/releases/${version}/${name}`;
}
