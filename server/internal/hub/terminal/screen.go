package terminal

import (
	"runtime"

	xterm "github.com/gitpod-io/xterm-go"
)

const terminalScrollbackLines = 10000

type Screen interface {
	Write([]byte) (int, error)
	Resize(cols, rows int)
	Snapshot() []byte
	Close()
}

type xtermScreen struct {
	term      *xterm.Terminal
	serialize *xterm.SerializeAddon
}

func newXTermScreen(cols, rows int) Screen {
	options := []xterm.Option{
		xterm.WithCols(cols),
		xterm.WithRows(rows),
		xterm.WithScrollback(terminalScrollbackLines),
	}
	if runtime.GOOS == "windows" {
		// xterm-go currently enables its ConPTY row-growth protection through
		// the legacy compatibility branch. This keeps scrollback rows out of the
		// expanded viewport so ConPTY's subsequent repaint cannot overwrite them.
		options = append(options, xterm.WithWindowsPty(xterm.WindowsPty{Backend: "conpty", BuildNo: 21375}))
	}
	term := xterm.New(options...)
	return &xtermScreen{
		term:      term,
		serialize: xterm.NewSerializeAddon(term),
	}
}

func (s *xtermScreen) Write(data []byte) (int, error) {
	return s.term.Write(data)
}

func (s *xtermScreen) Resize(cols, rows int) {
	s.term.Resize(cols, rows)
}

func (s *xtermScreen) Snapshot() []byte {
	return append([]byte(nil), s.serialize.Serialize(nil)...)
}

func (s *xtermScreen) Close() {
	s.term.Dispose()
}
