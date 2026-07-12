package terminal

import xterm "github.com/gitpod-io/xterm-go"

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
	term := xterm.New(
		xterm.WithCols(cols),
		xterm.WithRows(rows),
		xterm.WithScrollback(terminalScrollbackLines),
	)
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
