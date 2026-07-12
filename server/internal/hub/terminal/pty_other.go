//go:build !windows

package terminal

import (
	"context"
	"errors"
)

var errUnsupportedPlatform = errors.New("interactive terminal is supported on Windows only")

type unsupportedPTYFactory struct{}

func NewPlatformPTYFactory() PTYFactory {
	return unsupportedPTYFactory{}
}

func DetectShell(func(string) (string, error)) (string, error) {
	return "", errUnsupportedPlatform
}

func (unsupportedPTYFactory) Start(context.Context, string, string, int, int) (PTY, error) {
	return nil, errUnsupportedPlatform
}
