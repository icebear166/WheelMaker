//go:build windows

package terminal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"

	ptylib "github.com/aymanbagabas/go-pty"
)

var defaultLookPath = exec.LookPath

type platformPTYFactory struct{}

type windowsPTY struct {
	pty ptylib.Pty
	cmd *ptylib.Cmd

	closeOnce sync.Once
	closeErr  error
}

func NewPlatformPTYFactory() PTYFactory {
	return platformPTYFactory{}
}

func DetectShell(lookPath func(string) (string, error)) (string, error) {
	for _, name := range []string{"pwsh.exe", "powershell.exe", "cmd.exe"} {
		if path, err := lookPath(name); err == nil {
			return path, nil
		}
	}
	return "", errors.New("no supported Windows shell found")
}

func (platformPTYFactory) Start(ctx context.Context, shell, cwd string, cols, rows int) (PTY, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	p, err := ptylib.New()
	if err != nil {
		return nil, fmt.Errorf("create ConPTY: %w", err)
	}
	if err := p.Resize(cols, rows); err != nil {
		_ = p.Close()
		return nil, fmt.Errorf("resize ConPTY: %w", err)
	}
	cmd := p.Command(shell)
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		_ = p.Close()
		return nil, fmt.Errorf("start shell: %w", err)
	}
	return &windowsPTY{pty: p, cmd: cmd}, nil
}

func (p *windowsPTY) Read(data []byte) (int, error) {
	return p.pty.Read(data)
}

func (p *windowsPTY) Write(data []byte) (int, error) {
	return p.pty.Write(data)
}

func (p *windowsPTY) Resize(cols, rows int) error {
	return p.pty.Resize(cols, rows)
}

func (p *windowsPTY) Wait() (int, error) {
	err := p.cmd.Wait()
	exitCode := -1
	if p.cmd.ProcessState != nil {
		exitCode = p.cmd.ProcessState.ExitCode()
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitCode, nil
	}
	return exitCode, err
}

func (p *windowsPTY) Kill() error {
	p.closeOnce.Do(func() {
		var killErr error
		if p.cmd.Process != nil {
			killErr = p.cmd.Process.Kill()
			if errors.Is(killErr, os.ErrProcessDone) {
				killErr = nil
			}
		}
		p.closeErr = errors.Join(killErr, p.pty.Close())
	})
	return p.closeErr
}

func (p *windowsPTY) Close() error {
	p.closeOnce.Do(func() {
		p.closeErr = p.pty.Close()
	})
	return p.closeErr
}
