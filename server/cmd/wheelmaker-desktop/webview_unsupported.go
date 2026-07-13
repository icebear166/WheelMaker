//go:build !windows

package main

type unsupportedLauncher struct{}

func newWebView2Launcher() desktopLauncher {
	return unsupportedLauncher{}
}

func (unsupportedLauncher) Launch(_ desktopLaunchTarget, _ desktopWindowOptions) error {
	return errWebView2Unavailable
}
