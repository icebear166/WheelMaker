package terminal

import "context"

type PTY interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
	Resize(cols, rows int) error
	Wait() (int, error)
	Kill() error
	Close() error
}

type PTYFactory interface {
	Start(ctx context.Context, shell, cwd string, cols, rows int) (PTY, error)
}
