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
	store, err := newDefaultDesktopConfigStore()
	if err != nil {
		return err
	}
	return runDesktopApp(context.Background(), newWebView2Launcher(), store, newDefaultDesktopBaseURLProber())
}
