package terminal

import (
	"bytes"
	"time"
)

const (
	maxConPTYResizeRepaintBytes = 1024 * 1024
	conPTYResizeRepaintArmTTL   = 2 * time.Second
)

var (
	conPTYResizeRepaintStart = []byte("\x1b[?25l\x1b[H")
	conPTYResizeRepaintEnd   = []byte("\x1b[?25h")
)

type conPTYResizeRepaintFilter struct {
	pending   int
	dropping  bool
	buffer    []byte
	expiresAt time.Time
}

func (f *conPTYResizeRepaintFilter) Arm() {
	f.pending++
	f.expiresAt = time.Now().Add(conPTYResizeRepaintArmTTL)
}

func (f *conPTYResizeRepaintFilter) Cancel() {
	if f.pending > 0 {
		f.pending--
	}
	if f.pending == 0 {
		f.expiresAt = time.Time{}
	}
}

func (f *conPTYResizeRepaintFilter) Filter(data []byte) []byte {
	if f.pending > 0 && !f.dropping && !f.expiresAt.IsZero() && time.Now().After(f.expiresAt) {
		f.pending = 0
		f.expiresAt = time.Time{}
	}
	f.buffer = append(f.buffer, data...)
	var output []byte
	for len(f.buffer) > 0 {
		if f.dropping {
			if len(f.buffer) > maxConPTYResizeRepaintBytes {
				output = append(output, f.buffer...)
				f.reset()
				break
			}
			if index := bytes.Index(f.buffer, conPTYResizeRepaintEnd); index >= 0 {
				f.buffer = f.buffer[index+len(conPTYResizeRepaintEnd):]
				f.pending--
				if f.pending == 0 {
					f.expiresAt = time.Time{}
				}
				f.dropping = false
				continue
			}
			break
		}

		if f.pending == 0 {
			output = append(output, f.buffer...)
			f.buffer = f.buffer[:0]
			break
		}
		if index := bytes.Index(f.buffer, conPTYResizeRepaintStart); index >= 0 {
			output = append(output, f.buffer[:index]...)
			f.buffer = append([]byte(nil), f.buffer[index:]...)
			f.dropping = true
			continue
		}
		keep := suffixPrefixLength(f.buffer, conPTYResizeRepaintStart)
		output = append(output, f.buffer[:len(f.buffer)-keep]...)
		f.buffer = append([]byte(nil), f.buffer[len(f.buffer)-keep:]...)
		break
	}
	return output
}

func (f *conPTYResizeRepaintFilter) Flush() []byte {
	output := append([]byte(nil), f.buffer...)
	f.reset()
	return output
}

func (f *conPTYResizeRepaintFilter) reset() {
	f.pending = 0
	f.dropping = false
	f.buffer = f.buffer[:0]
	f.expiresAt = time.Time{}
}

func suffixPrefixLength(data, pattern []byte) int {
	for size := min(len(data), len(pattern)-1); size > 0; size-- {
		if bytes.Equal(data[len(data)-size:], pattern[:size]) {
			return size
		}
	}
	return 0
}
