package terminal

import (
	"bytes"
	"fmt"
	"testing"
)

func TestXTermScreenSnapshotRestoresExactly(t *testing.T) {
	screen := newXTermScreen(20, 4)
	defer screen.Close()
	_, _ = screen.Write([]byte("normal\r\n\x1b[31mred\x1b[0m\r\n\x1b[?1049halt界\x1b[2;3H!"))
	screen.Resize(30, 6)
	snapshot := screen.Snapshot()

	restored := newXTermScreen(30, 6)
	defer restored.Close()
	_, _ = restored.Write(snapshot)
	if got := restored.Snapshot(); !bytes.Equal(got, snapshot) {
		t.Fatalf("restored snapshot differs\nwant=%q\ngot=%q", snapshot, got)
	}
}

func TestXTermScreenKeepsOnlyConfiguredScrollback(t *testing.T) {
	screen := newXTermScreen(20, 4)
	defer screen.Close()
	for i := 0; i < 10050; i++ {
		_, _ = screen.Write([]byte(fmt.Sprintf("line-%05d\r\n", i)))
	}
	snapshot := screen.Snapshot()
	if bytes.Contains(snapshot, []byte("line-00000")) {
		t.Fatal("snapshot retained a line older than the 10,000-line scrollback")
	}
	if !bytes.Contains(snapshot, []byte("line-10049")) {
		t.Fatal("snapshot omitted the newest line")
	}
}
