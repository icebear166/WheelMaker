package main

import (
	_ "embed"
	"encoding/base64"
)

//go:embed bootstrap/index.html
var desktopBootstrapHTML string

func desktopBootstrapDocumentURL() string {
	return "data:text/html;charset=utf-8;base64," + base64.StdEncoding.EncodeToString([]byte(desktopBootstrapHTML))
}

func isDesktopBootstrapDocumentURL(rawURL string) bool {
	return rawURL == "about:blank" || rawURL == desktopBootstrapDocumentURL()
}
