package main

import (
	"context"
	"fmt"
	"os"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "WheelMakerDesktop: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	localDev := false
	for _, arg := range os.Args[1:] {
		if arg != "--local-dev" {
			return fmt.Errorf("unsupported argument: %s", arg)
		}
		localDev = true
	}
	store, err := newDefaultDesktopConfigStore()
	if err != nil {
		return err
	}
	return runDesktopAppWithMode(context.Background(), newWebView2Launcher(), store, newDefaultDesktopBaseURLProber(), localDev)
}
