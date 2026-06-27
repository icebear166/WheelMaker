//go:build !windows

package shared

import "os/exec"

// ConfigureBackgroundCommand is a Windows-only window visibility setting.
func ConfigureBackgroundCommand(*exec.Cmd) {}
