globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;
console.error = (...args) => {
  const firstArg = args[0];
  if (
    typeof firstArg === 'string' &&
    firstArg.includes('react-test-renderer is deprecated')
  ) {
    return;
  }
  if (
    typeof firstArg === 'string' &&
    firstArg.includes('not wrapped in act')
  ) {
    return;
  }
  originalConsoleError(...args);
};

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

if (typeof globalThis.window.requestAnimationFrame !== 'function') {
  globalThis.window.requestAnimationFrame = callback =>
    setTimeout(() => callback(Date.now()), 0);
}

if (typeof globalThis.window.cancelAnimationFrame !== 'function') {
  globalThis.window.cancelAnimationFrame = id => clearTimeout(id);
}

if (typeof globalThis.window.navigator === 'undefined') {
  globalThis.window.navigator = globalThis.navigator ?? {userAgent: 'node'};
}

if (typeof globalThis.window.location === 'undefined') {
  globalThis.window.location = {origin: 'http://localhost'};
}

if (typeof globalThis.window.addEventListener !== 'function') {
  globalThis.window.addEventListener = () => undefined;
}

if (typeof globalThis.window.removeEventListener !== 'function') {
  globalThis.window.removeEventListener = () => undefined;
}
