package security

import (
	"crypto/rand"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestNewRegistryTokenCreatesIndependentValues(t *testing.T) {
	first, err := NewRegistryToken(rand.Reader)
	if err != nil {
		t.Fatalf("NewRegistryToken(first): %v", err)
	}
	second, err := NewRegistryToken(rand.Reader)
	if err != nil {
		t.Fatalf("NewRegistryToken(second): %v", err)
	}
	if len(first) != 43 || len(second) != 43 {
		t.Fatalf("token lengths=%d/%d, want 43/43", len(first), len(second))
	}
	if first == second {
		t.Fatal("independent token generations returned the same value")
	}
}

func TestNewRegistryTokenReturnsRandomSourceFailure(t *testing.T) {
	want := errors.New("random source unavailable")
	_, err := NewRegistryToken(errorReader{err: want})
	if !errors.Is(err, want) {
		t.Fatalf("NewRegistryToken() error=%v, want wrapped %v", err, want)
	}
}

type errorReader struct {
	err error
}

func (r errorReader) Read([]byte) (int, error) {
	return 0, r.err
}

var _ io.Reader = errorReader{}

func TestValidateRegistryTokenRejectsUnsafeValues(t *testing.T) {
	for _, token := range []string{"", "   ", "wheelmaker-local-token"} {
		err := ValidateRegistryToken(token)
		if err == nil {
			t.Fatalf("ValidateRegistryToken(%q) succeeded, want rejection", token)
		}
		if err.Error() != "token must be a non-default value" {
			t.Fatalf("ValidateRegistryToken(%q) error=%q, want top-level token field", token, err)
		}
	}
}

func TestValidateRegistryTokenAcceptsGeneratedAndShortCustomValues(t *testing.T) {
	for _, token := range []string{strings.Repeat("a", 43), "short-custom"} {
		if err := ValidateRegistryToken(token); err != nil {
			t.Fatalf("ValidateRegistryToken(%q) error=%v", token, err)
		}
	}
}
