package main

import (
	"context"
	"errors"
	"fmt"
)

var errWebView2Unavailable = errors.New("Microsoft Edge WebView2 Runtime is required to run WheelMaker Desktop")

type desktopBootstrapState struct {
	BaseURL string `json:"baseUrl"`
	Error   string `json:"error"`
	Busy    bool   `json:"busy"`
}

type desktopLaunchTarget struct {
	HTML string
	URL  string
}

type desktopWindowOptions struct {
	Title          string
	Width          uint
	Height         uint
	IconID         uint
	CustomTitleBar bool
	ThemeColor     string
	BootstrapState desktopBootstrapState
	Runtime        *desktopRuntime
}

type desktopLauncher interface {
	Launch(target desktopLaunchTarget, opts desktopWindowOptions) error
}

type desktopBaseURLProber interface {
	Probe(ctx context.Context, baseURL string) error
}

func runDesktopApp(ctx context.Context, launcher desktopLauncher, store desktopConfigStore, prober desktopBaseURLProber) error {
	config, err := store.Load()
	if err != nil {
		return fmt.Errorf("load desktop config: %w", err)
	}

	target := desktopLaunchTarget{HTML: desktopBootstrapHTML}
	state := desktopBootstrapState{BaseURL: config.BaseURL}
	if config.BaseURL != "" {
		normalized, normalizeErr := normalizeDesktopBaseURL(config.BaseURL)
		if normalizeErr != nil {
			state.Error = "Invalid server address. Enter an HTTPS URL."
		} else {
			if normalized != config.BaseURL {
				config.BaseURL = normalized
				state.BaseURL = normalized
				if err := store.Save(config); err != nil {
					return fmt.Errorf("save normalized desktop config: %w", err)
				}
			}
			if err := prober.Probe(ctx, normalized); err != nil {
				state.Error = fmt.Sprintf("Unable to connect securely: %v", err)
			} else {
				target = desktopLaunchTarget{URL: normalized}
			}
		}
	}

	opts := defaultDesktopWindowOptions()
	opts.BootstrapState = state
	mode := desktopBootstrapPage
	if target.URL != "" {
		mode = desktopTrustedRemotePage
	}
	securityState, err := newDesktopWebViewSecurityState(target.URL, mode)
	if err != nil {
		return err
	}
	opts.Runtime = newDesktopRuntime(store, prober, config, state, securityState)
	if err := launcher.Launch(target, opts); err != nil {
		if errors.Is(err, errWebView2Unavailable) {
			return fmt.Errorf("%w. Install it from https://developer.microsoft.com/microsoft-edge/webview2/", err)
		}
		return err
	}
	return nil
}

func defaultDesktopWindowOptions() desktopWindowOptions {
	return desktopWindowOptions{
		Title:          "WheelMaker",
		Width:          1280,
		Height:         840,
		IconID:         desktopResourceIconID,
		CustomTitleBar: true,
		ThemeColor:     desktopTitleBarThemeColor,
	}
}
