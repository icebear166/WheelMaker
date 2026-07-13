package main

import "strconv"

const (
	desktopResourceIconID     uint = 1
	desktopTitleBarThemeColor      = "#1e1e1e"

	desktopBootstrapGetStateBinding = "__wheelMakerBootstrapGetState"
	desktopBootstrapSaveBinding     = "__wheelMakerBootstrapSaveBaseURL"
	desktopBootstrapRetryBinding    = "__wheelMakerBootstrapRetry"
	desktopBootstrapResetBinding    = "__wheelMakerBootstrapReset"
	desktopGetDeviceNameBinding     = "__wheelMakerDesktopGetDeviceName"
	desktopStartDragBinding         = "__wheelMakerDesktopStartDrag"
	desktopMinimizeBinding          = "__wheelMakerDesktopMinimize"
	desktopToggleMaximizeBinding    = "__wheelMakerDesktopToggleMaximize"
	desktopCloseBinding             = "__wheelMakerDesktopClose"
	desktopRequestServerBinding     = "__wheelMakerDesktopRequestServerChange"
)

func desktopRuntimeInitScript() string {
	bootstrapDocumentURL := strconv.Quote(desktopBootstrapDocumentURL())
	return `(() => {
  if (window !== window.top) return;
  const invoke = name => (...args) => {
    const fn = window[name];
    if (typeof fn !== 'function') return Promise.reject(new Error('Native bridge unavailable'));
    return fn(...args);
  };
	if (location.href === 'about:blank' || location.href === ` + bootstrapDocumentURL + `) {
    window.wheelMakerBootstrap = Object.freeze({
      getState: invoke('` + desktopBootstrapGetStateBinding + `'),
      saveBaseUrl: invoke('` + desktopBootstrapSaveBinding + `'),
      retry: invoke('` + desktopBootstrapRetryBinding + `'),
      reset: invoke('` + desktopBootstrapResetBinding + `'),
		getDeviceName: invoke('` + desktopGetDeviceNameBinding + `'),
      startDrag: invoke('` + desktopStartDragBinding + `'),
      minimize: invoke('` + desktopMinimizeBinding + `'),
      toggleMaximize: invoke('` + desktopToggleMaximizeBinding + `'),
      close: invoke('` + desktopCloseBinding + `'),
    });
    return;
  }
  if (location.protocol === 'https:') {
    window.WheelMakerDesktop = Object.freeze({
      enabled: true,
		getDeviceName: invoke('` + desktopGetDeviceNameBinding + `'),
      startDrag: invoke('` + desktopStartDragBinding + `'),
      minimize: invoke('` + desktopMinimizeBinding + `'),
      toggleMaximize: invoke('` + desktopToggleMaximizeBinding + `'),
      close: invoke('` + desktopCloseBinding + `'),
      requestServerChange: invoke('` + desktopRequestServerBinding + `'),
    });
  }
})();`
}
