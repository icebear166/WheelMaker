import channel from '../../../../scripts/release/channel.json';

let base: URL;
try {
  base = new URL(channel.baseUrl);
} catch {
  throw new Error('Invalid WheelMaker release channel.');
}
if (
  base.protocol !== 'https:' ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash ||
  channel.baseUrl !== base.origin
) {
  throw new Error('Invalid WheelMaker release channel.');
}

export const WHEELMAKER_RELEASE_BASE_URL = base.origin;

export function wheelMakerReleaseUrl(path: string): string {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    throw new Error('Invalid WheelMaker release path.');
  }
  const url = new URL(path, `${WHEELMAKER_RELEASE_BASE_URL}/`);
  if (url.origin !== base.origin) {
    throw new Error('Invalid WheelMaker release origin.');
  }
  return url.href;
}
