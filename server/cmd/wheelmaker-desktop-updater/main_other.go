//go:build !windows

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "WheelMaker Desktop updater is supported on Windows only")
	os.Exit(1)
}
