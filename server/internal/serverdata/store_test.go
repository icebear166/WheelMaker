package serverdata

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStoreDefaultsAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "server-data.json")
	store := New(path)

	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.VoiceInput.Configured || snapshot.TextToSpeech.Configured || snapshot.DeepSeek.Configured {
		t.Fatalf("default snapshot=%+v", snapshot)
	}
	if snapshot.VoiceInput.Model != VoiceInputModelDoubaoStreamingASR2 {
		t.Fatalf("voice model=%q", snapshot.VoiceInput.Model)
	}
	if snapshot.TextToSpeech.Model != TTSModelMiMoV25 || snapshot.TextToSpeech.Voice != TTSVoiceMia {
		t.Fatalf("tts defaults=%+v", snapshot.TextToSpeech)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("missing store should not create a file: %v", err)
	}

	now := time.Date(2026, 7, 14, 1, 2, 3, 0, time.UTC)
	if err := store.UpdateSecret(SecretVolcengineASR, "set", "speech-key", now); err != nil {
		t.Fatal(err)
	}
	value, version, err := store.Secret(SecretVolcengineASR)
	if err != nil || value != "speech-key" || version != now.Format(time.RFC3339) {
		t.Fatalf("secret=%q version=%q err=%v", value, version, err)
	}
	if err := store.UpdateSecret(SecretVolcengineASR, "clear", "", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	value, version, err = store.Secret(SecretVolcengineASR)
	if err != nil || value != "" || version != "" {
		t.Fatalf("cleared secret=%q version=%q err=%v", value, version, err)
	}
}

func TestStoreRejectsUnknownFieldsWithoutOverwriting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server-data.json")
	want := []byte(`{"version":1,"unexpected":true}`)
	if err := os.WriteFile(path, want, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := New(path).Snapshot(); err == nil || !strings.Contains(err.Error(), `unknown field "unexpected"`) {
		t.Fatalf("Snapshot() error=%v, want unknown field rejection", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("malformed source changed: got %q want %q", got, want)
	}
}

func TestStoreRejectsOversizedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server-data.json")
	if err := os.WriteFile(path, bytes.Repeat([]byte("x"), 64*1024+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(path).Snapshot(); err == nil || !strings.Contains(err.Error(), "64 KiB") {
		t.Fatalf("Snapshot() error=%v, want size limit", err)
	}
}

func TestStoreWriteFailurePreservesExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server-data.json")
	store := New(path)
	now := time.Date(2026, 7, 14, 1, 2, 3, 0, time.UTC)
	if err := store.UpdateSecret(SecretDeepSeek, "set", "old-key", now); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	store.write = func(string, []byte) error { return errors.New("disk full") }

	if err := store.UpdateSecret(SecretDeepSeek, "set", "new-key", now.Add(time.Minute)); err == nil || !strings.Contains(err.Error(), "disk full") {
		t.Fatalf("UpdateSecret() error=%v, want injected write error", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("source changed after failed write: got %q want %q", got, want)
	}
}

func TestStoreUpdatesModelAndVoiceWithoutReturningSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server-data.json")
	store := New(path)
	now := time.Date(2026, 7, 14, 1, 2, 3, 0, time.UTC)
	for kind, value := range map[SecretKind]string{
		SecretDeepSeek:      "deep-secret",
		SecretVolcengineASR: "speech-secret",
		SecretMiMoTTS:       "tts-secret",
	} {
		if err := store.UpdateSecret(kind, "set", value, now); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.UpdateVoiceInputModel(VoiceInputModelDoubaoStreamingASR2, now); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateTTS(TTSModelMiMoV25, TTSVoiceMia, now); err != nil {
		t.Fatal(err)
	}

	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.VoiceInput.Configured || !snapshot.TextToSpeech.Configured || !snapshot.DeepSeek.Configured {
		t.Fatalf("configured snapshot=%+v", snapshot)
	}
	if snapshot.VoiceInput.UpdatedAt != now.Format(time.RFC3339) || snapshot.TextToSpeech.Model != TTSModelMiMoV25 || snapshot.TextToSpeech.Voice != TTSVoiceMia {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	encoded := strings.Join([]string{
		snapshot.VoiceInput.Model,
		snapshot.VoiceInput.UpdatedAt,
		snapshot.TextToSpeech.Model,
		snapshot.TextToSpeech.Voice,
		snapshot.TextToSpeech.UpdatedAt,
		snapshot.DeepSeek.UpdatedAt,
	}, "|")
	for _, secret := range []string{"deep-secret", "speech-secret", "tts-secret"} {
		if strings.Contains(encoded, secret) {
			t.Fatalf("snapshot leaked %q", secret)
		}
	}
}

func TestStoreWritesPrivateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "server-data.json")
	if err := New(path).UpdateSecret(SecretDeepSeek, "set", "short", time.Now()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode=%#o, want 0600", info.Mode().Perm())
	}
}

func TestStoreSerializesConcurrentUpdates(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "server-data.json"))
	now := time.Date(2026, 7, 14, 1, 2, 3, 0, time.UTC)
	for iteration := 0; iteration < 25; iteration++ {
		if err := store.UpdateSecret(SecretDeepSeek, "clear", "", now); err != nil {
			t.Fatal(err)
		}
		if err := store.UpdateSecret(SecretMiMoTTS, "clear", "", now); err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			if err := store.UpdateSecret(SecretDeepSeek, "set", "deep-key", now); err != nil {
				t.Errorf("deepseek update: %v", err)
			}
		}()
		go func() {
			defer wg.Done()
			<-start
			if err := store.UpdateSecret(SecretMiMoTTS, "set", "tts-key", now); err != nil {
				t.Errorf("tts update: %v", err)
			}
		}()
		close(start)
		wg.Wait()
		snapshot, err := store.Snapshot()
		if err != nil {
			t.Fatal(err)
		}
		if !snapshot.DeepSeek.Configured || !snapshot.TextToSpeech.Configured {
			t.Fatalf("iteration %d lost an update: %+v", iteration, snapshot)
		}
	}
}

func TestStoreValidatesInputs(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "server-data.json"))
	now := time.Now()
	tests := []struct {
		name string
		run  func() error
	}{
		{"unknown secret", func() error { return store.UpdateSecret("unknown", "set", "key", now) }},
		{"unknown action", func() error { return store.UpdateSecret(SecretDeepSeek, "replace", "key", now) }},
		{"empty set", func() error { return store.UpdateSecret(SecretDeepSeek, "set", "", now) }},
		{"oversized secret", func() error { return store.UpdateSecret(SecretDeepSeek, "set", strings.Repeat("x", 16*1024+1), now) }},
		{"unknown voice model", func() error { return store.UpdateVoiceInputModel("other", now) }},
		{"unknown tts model", func() error { return store.UpdateTTS("other", TTSVoiceMia, now) }},
		{"unknown tts voice", func() error { return store.UpdateTTS(TTSModelMiMoV25, "Other", now) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.run(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
