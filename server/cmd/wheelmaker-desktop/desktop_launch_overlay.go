package main

import (
	_ "embed"
	"strings"
)

//go:embed launch_overlay.js
var desktopLaunchOverlayJS string

// desktopLaunchOverlayScript returns the document-start script that injects
// the brand launch overlay on app pages. It is inert on bootstrap/local pages
// because the overlay gates itself on the https protocol.
func desktopLaunchOverlayScript() string {
	return strings.TrimSpace(desktopLaunchOverlayJS) + "\n"
}
