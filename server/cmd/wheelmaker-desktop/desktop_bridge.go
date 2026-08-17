package main

import "strconv"

const (
	desktopResourceIconID      uint = 1
	desktopTitleBarThemeColor       = "#1e1e1e"
	desktopBootstrapReadyEvent      = "__wheelMakerDesktopBootstrapReady"

	desktopBootstrapGetStateBinding        = "__wheelMakerBootstrapGetState"
	desktopBootstrapSaveBinding            = "__wheelMakerBootstrapSaveBaseURL"
	desktopBootstrapSelectLocalhostBinding = "__wheelMakerBootstrapSelectLocalhost"
	desktopBootstrapRetryBinding           = "__wheelMakerBootstrapRetry"
	desktopBootstrapResetBinding           = "__wheelMakerBootstrapReset"
	desktopGetDeviceNameBinding            = "__wheelMakerDesktopGetDeviceName"
	desktopStartDragBinding                = "__wheelMakerDesktopStartDrag"
	desktopMinimizeBinding                 = "__wheelMakerDesktopMinimize"
	desktopToggleMaximizeBinding           = "__wheelMakerDesktopToggleMaximize"
	desktopCloseBinding                    = "__wheelMakerDesktopClose"
	desktopRequestServerBinding            = "__wheelMakerDesktopRequestServerChange"
	desktopOpenProjectFileInVSCodeBinding  = "__wheelMakerDesktopOpenProjectFileInVSCode"
	desktopShowProjectFileInFolderBinding  = "__wheelMakerDesktopShowProjectFileInFolder"
	desktopOpenFileInVSCodeBinding         = "__wheelMakerDesktopOpenFileInVSCode"
	desktopShowFileInFolderBinding         = "__wheelMakerDesktopShowFileInFolder"
	desktopCopyFileToClipboardBinding      = "__wheelMakerDesktopCopyFileToClipboard"
	desktopBeginHTMLFileClipboardBinding   = "__wheelMakerDesktopBeginHTMLFileClipboard"
	desktopAppendHTMLFileClipboardBinding  = "__wheelMakerDesktopAppendHTMLFileClipboard"
	desktopCommitHTMLFileClipboardBinding  = "__wheelMakerDesktopCommitHTMLFileClipboard"
	desktopCancelHTMLFileClipboardBinding  = "__wheelMakerDesktopCancelHTMLFileClipboard"
	desktopGetUpdateInfoBinding            = "__wheelMakerDesktopGetUpdateInfo"
	desktopRequestUpdateBinding            = "__wheelMakerDesktopRequestUpdate"
	desktopDeepSeekLoginBinding            = "__wheelMakerDesktopDeepSeekLogin"
	desktopEnterLocalDevBinding            = "__wheelMakerDesktopEnterLocalDev"
	desktopGetLocalDevStateBinding         = "__wheelMakerDesktopGetLocalDevState"
	desktopSaveLocalDevSourceBinding       = "__wheelMakerDesktopSaveLocalDevSource"
	desktopRunLocalDevBinding              = "__wheelMakerDesktopRunLocalDev"
	desktopShowNotificationBinding         = "__wheelMakerDesktopShowNotification"
	desktopOpenPreviewWindowBinding        = "__wheelMakerDesktopOpenPreviewWindow"
	desktopFocusPreviewWindowBinding       = "__wheelMakerDesktopFocusPreviewWindow"
	desktopDockPreviewWindowBinding        = "__wheelMakerDesktopDockPreviewWindow"
)

func desktopRuntimeInitScript(localhostURLs ...string) string {
	return desktopRuntimeInitScriptWithPreviewChannel("", localhostURLs...)
}

func desktopRuntimeInitScriptWithPreviewChannel(previewChannelName string, localhostURLs ...string) string {
	bootstrapDocumentURL := strconv.Quote(desktopBootstrapDocumentURL())
	quotedPreviewChannelName := strconv.Quote(previewChannelName)
	trustedLocalhostURL := ""
	if len(localhostURLs) > 0 {
		if policy, err := newDesktopLocalhostWebViewPolicy(localhostURLs[0]); err == nil {
			trustedLocalhostURL = policy.baseURL.String()
		}
	}
	return `(() => {
  if (window !== window.top) return;
  const invoke = name => (...args) => {
    const fn = window[name];
    if (typeof fn !== 'function') return Promise.reject(new Error('Native bridge unavailable'));
    return fn(...args);
  };
	const desktopBootstrapReady = new Promise(resolve => {
		window.addEventListener('` + desktopBootstrapReadyEvent + `', resolve, {once: true});
	});
	if (location.href === 'about:blank' || location.href === ` + bootstrapDocumentURL + `) {
    window.wheelMakerBootstrap = Object.freeze({
		ready: desktopBootstrapReady,
      getState: invoke('` + desktopBootstrapGetStateBinding + `'),
      saveBaseUrl: invoke('` + desktopBootstrapSaveBinding + `'),
      selectLocalhost: invoke('` + desktopBootstrapSelectLocalhostBinding + `'),
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
  const installTrustedDesktopBridge = () => {
	window.WheelMakerDesktop = Object.freeze({
    enabled: true,
		previewChannelName: ` + quotedPreviewChannelName + `,
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
		openPreviewWindow: invoke('` + desktopOpenPreviewWindowBinding + `'),
		focusPreviewWindow: invoke('` + desktopFocusPreviewWindowBinding + `'),
		dockPreviewWindow: invoke('` + desktopDockPreviewWindowBinding + `'),
		deepSeekLogin: invoke('` + desktopDeepSeekLoginBinding + `'),
		showNotification: invoke('` + desktopShowNotificationBinding + `'),
    });
	};
  if (location.protocol === 'https:') {
	installTrustedDesktopBridge();
	return;
	}
  const trustedLocalhostURL = ` + strconv.Quote(trustedLocalhostURL) + `;
  if (trustedLocalhostURL !== '') {
	const trustedLocalhostBase = new URL(trustedLocalhostURL);
	if (location.protocol === 'http:' &&
		location.origin === trustedLocalhostBase.origin &&
		location.search === '' && location.hash === '' &&
		(location.pathname === trustedLocalhostBase.pathname ||
			location.pathname.startsWith(trustedLocalhostBase.pathname))) {
		installTrustedDesktopBridge();
		return;
	}
  }
  if (location.protocol === 'http:' && location.hostname === '127.0.0.1' && location.port === '4173') {
		window.WheelMakerDesktop = Object.freeze({
			enabled: true,
			previewChannelName: ` + quotedPreviewChannelName + `,
			getDeviceName: invoke('` + desktopGetDeviceNameBinding + `'),
			startDrag: invoke('` + desktopStartDragBinding + `'),
			minimize: invoke('` + desktopMinimizeBinding + `'),
			toggleMaximize: invoke('` + desktopToggleMaximizeBinding + `'),
			close: invoke('` + desktopCloseBinding + `'),
			showNotification: invoke('` + desktopShowNotificationBinding + `'),
			localDev: Object.freeze({
				getState: invoke('` + desktopGetLocalDevStateBinding + `'),
				saveSource: invoke('` + desktopSaveLocalDevSourceBinding + `'),
				run: invoke('` + desktopRunLocalDevBinding + `'),
			}),
		});
  }
})();` + "\n" + desktopLaunchOverlayScript()
}

func desktopBootstrapReadySignalScript() string {
	return `window.dispatchEvent(new Event(` + strconv.Quote(desktopBootstrapReadyEvent) + `));`
}

func desktopCompanionRuntimeInitScript(previewChannelName string) string {
	return `(() => {
  if (window !== window.top) return;
  window.__wheelmakerPreviewChannelName = ` + strconv.Quote(previewChannelName) + `;
})();` + "\n" + desktopLaunchOverlayScript()
}
