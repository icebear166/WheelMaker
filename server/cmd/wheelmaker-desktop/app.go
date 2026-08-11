package main

import (
	"context"
	"errors"
	"fmt"
)

var errWebView2Unavailable = errors.New("Microsoft Edge WebView2 Runtime is required to run WheelMaker Desktop")

const desktopLocalDevURL = "http://127.0.0.1:4173/"

type desktopBootstrapState struct {
	ConnectionMode    desktopConnectionMode `json:"connectionMode,omitempty"`
	BaseURL           string                `json:"baseUrl"`
	SupportsLocalhost bool                  `json:"supportsLocalhost"`
	Error             string                `json:"error"`
	Busy              bool                  `json:"busy"`
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

type desktopLocalhostRuntimeEdge interface {
	Start(ctx context.Context) (string, error)
	Close() error
	DeleteState() error
}

type desktopLocalhostEdgeFactory func() (desktopLocalhostRuntimeEdge, error)

type desktopAppDependencies struct {
	LocalhostEdgeFactory desktopLocalhostEdgeFactory
}

func runDesktopApp(ctx context.Context, launcher desktopLauncher, store desktopConfigStore, prober desktopBaseURLProber) error {
	return runDesktopAppWithMode(ctx, launcher, store, prober, false)
}

func runDesktopAppWithMode(ctx context.Context, launcher desktopLauncher, store desktopConfigStore, prober desktopBaseURLProber, localDev bool) error {
	return runDesktopAppWithDependencies(ctx, launcher, store, prober, localDev, desktopAppDependencies{
		LocalhostEdgeFactory: newDefaultDesktopLocalhostEdge,
	})
}

func runDesktopAppWithDependencies(
	ctx context.Context,
	launcher desktopLauncher,
	store desktopConfigStore,
	prober desktopBaseURLProber,
	localDev bool,
	dependencies desktopAppDependencies,
) error {
	config, err := store.Load()
	if err != nil {
		return fmt.Errorf("load desktop config: %w", err)
	}

	target := desktopLaunchTarget{HTML: desktopBootstrapHTML}
	state := desktopBootstrapState{SupportsLocalhost: true}
	normalizedConfig, changed, normalizeErr := normalizeDesktopConfig(config)
	if normalizeErr != nil {
		state.ConnectionMode = config.ConnectionMode
		state.BaseURL = config.BaseURL
		state.Error = "Invalid saved Desktop connection. Choose a connection again."
		config = desktopConfig{}
	} else {
		config = normalizedConfig
		state.ConnectionMode = config.ConnectionMode
		state.BaseURL = config.BaseURL
		if changed {
			if err := store.Save(config); err != nil {
				return fmt.Errorf("save migrated desktop config: %w", err)
			}
		}
	}
	var localhostEdge desktopLocalhostRuntimeEdge
	localhostURL := ""
	if localDev {
		target = desktopLaunchTarget{URL: desktopLocalDevURL}
	} else {
		switch config.ConnectionMode {
		case desktopConnectionGateway:
			target = desktopLaunchTarget{URL: config.BaseURL}
		case desktopConnectionLocalhost:
			if dependencies.LocalhostEdgeFactory == nil {
				state.Error = "Unable to start Localhost: Desktop Localhost is unavailable."
				break
			}
			localhostEdge, err = dependencies.LocalhostEdgeFactory()
			if err == nil {
				localhostURL, err = localhostEdge.Start(ctx)
			}
			if err != nil {
				state.Error = "Unable to start Localhost: " + err.Error()
				break
			}
			target = desktopLaunchTarget{URL: localhostURL}
		}
	}

	opts := defaultDesktopWindowOptions()
	opts.BootstrapState = state
	mode := desktopBootstrapPage
	if localDev {
		mode = desktopTrustedLocalDevPage
	} else if config.ConnectionMode == desktopConnectionLocalhost && target.URL != "" {
		mode = desktopTrustedLocalhostPage
	} else if config.ConnectionMode == desktopConnectionGateway && target.URL != "" {
		mode = desktopTrustedRemotePage
	}
	securityState, err := newDesktopWebViewSecurityState(target.URL, mode)
	if err != nil {
		return err
	}
	opts.Runtime = newDesktopRuntimeWithOptions(store, prober, config, state, securityState, desktopRuntimeOptions{
		LocalhostEdgeFactory: dependencies.LocalhostEdgeFactory,
		LocalhostEdge:        localhostEdge,
		LocalhostURL:         localhostURL,
	})
	if err := launcher.Launch(target, opts); err != nil {
		_ = opts.Runtime.Close()
		if errors.Is(err, errWebView2Unavailable) {
			return fmt.Errorf("%w. Install it from https://developer.microsoft.com/microsoft-edge/webview2/", err)
		}
		return err
	}
	return opts.Runtime.Close()
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
