//go:build !windows

package shared

import "os/exec"

func ConfigureBackgroundCommand(_ *exec.Cmd) {}
