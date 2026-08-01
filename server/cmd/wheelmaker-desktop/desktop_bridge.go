package main

import "strconv"

const (
	desktopResourceIconID     uint = 1
	desktopTitleBarThemeColor      = "#1e1e1e"

	desktopBootstrapGetStateBinding       = "__wheelMakerBootstrapGetState"
	desktopBootstrapSaveBinding           = "__wheelMakerBootstrapSaveBaseURL"
	desktopBootstrapRetryBinding          = "__wheelMakerBootstrapRetry"
	desktopBootstrapResetBinding          = "__wheelMakerBootstrapReset"
	desktopGetDeviceNameBinding           = "__wheelMakerDesktopGetDeviceName"
	desktopStartDragBinding               = "__wheelMakerDesktopStartDrag"
	desktopMinimizeBinding                = "__wheelMakerDesktopMinimize"
	desktopToggleMaximizeBinding          = "__wheelMakerDesktopToggleMaximize"
	desktopCloseBinding                   = "__wheelMakerDesktopClose"
	desktopRequestServerBinding           = "__wheelMakerDesktopRequestServerChange"
	desktopOpenProjectFileInVSCodeBinding = "__wheelMakerDesktopOpenProjectFileInVSCode"
	desktopShowProjectFileInFolderBinding = "__wheelMakerDesktopShowProjectFileInFolder"
	desktopOpenFileInVSCodeBinding        = "__wheelMakerDesktopOpenFileInVSCode"
	desktopShowFileInFolderBinding        = "__wheelMakerDesktopShowFileInFolder"
	desktopCopyFileToClipboardBinding     = "__wheelMakerDesktopCopyFileToClipboard"
	desktopBeginHTMLFileClipboardBinding  = "__wheelMakerDesktopBeginHTMLFileClipboard"
	desktopAppendHTMLFileClipboardBinding = "__wheelMakerDesktopAppendHTMLFileClipboard"
	desktopCommitHTMLFileClipboardBinding = "__wheelMakerDesktopCommitHTMLFileClipboard"
	desktopCancelHTMLFileClipboardBinding = "__wheelMakerDesktopCancelHTMLFileClipboard"
	desktopGetUpdateInfoBinding           = "__wheelMakerDesktopGetUpdateInfo"
	desktopRequestUpdateBinding           = "__wheelMakerDesktopRequestUpdate"
	desktopDeepSeekLoginBinding           = "__wheelMakerDesktopDeepSeekLogin"
	desktopEnterLocalDevBinding           = "__wheelMakerDesktopEnterLocalDev"
	desktopGetLocalDevStateBinding        = "__wheelMakerDesktopGetLocalDevState"
	desktopSaveLocalDevSourceBinding      = "__wheelMakerDesktopSaveLocalDevSource"
	desktopRunLocalDevBinding             = "__wheelMakerDesktopRunLocalDev"
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
		requestLocalDevMode: invoke('` + desktopEnterLocalDevBinding + `'),
		openProjectFileInVSCode: invoke('` + desktopOpenProjectFileInVSCodeBinding + `'),
		showProjectFileInFolder: invoke('` + desktopShowProjectFileInFolderBinding + `'),
		openFileInVSCode: invoke('` + desktopOpenFileInVSCodeBinding + `'),
		showFileInFolder: invoke('` + desktopShowFileInFolderBinding + `'),
		copyFileToClipboard: invoke('` + desktopCopyFileToClipboardBinding + `'),
		beginHtmlFileClipboard: invoke('` + desktopBeginHTMLFileClipboardBinding + `'),
		appendHtmlFileClipboard: invoke('` + desktopAppendHTMLFileClipboardBinding + `'),
		commitHtmlFileClipboard: invoke('` + desktopCommitHTMLFileClipboardBinding + `'),
		cancelHtmlFileClipboard: invoke('` + desktopCancelHTMLFileClipboardBinding + `'),
		getDesktopUpdateInfo: invoke('` + desktopGetUpdateInfoBinding + `'),
		requestDesktopUpdate: invoke('` + desktopRequestUpdateBinding + `'),
		deepSeekLogin: invoke('` + desktopDeepSeekLoginBinding + `'),
    });
	return;
	}
  if (location.protocol === 'http:' && location.hostname === '127.0.0.1' && location.port === '4173') {
		window.WheelMakerDesktop = Object.freeze({
			enabled: true,
			getDeviceName: invoke('` + desktopGetDeviceNameBinding + `'),
			startDrag: invoke('` + desktopStartDragBinding + `'),
			minimize: invoke('` + desktopMinimizeBinding + `'),
			toggleMaximize: invoke('` + desktopToggleMaximizeBinding + `'),
			close: invoke('` + desktopCloseBinding + `'),
			localDev: Object.freeze({
				getState: invoke('` + desktopGetLocalDevStateBinding + `'),
				saveSource: invoke('` + desktopSaveLocalDevSourceBinding + `'),
				run: invoke('` + desktopRunLocalDevBinding + `'),
			}),
		});
  }
})();`
}
