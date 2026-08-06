// Package security contains security boundaries shared by WheelMaker services.
package security

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

const registryTokenBytes = 32

const LegacyRegistryToken = "wheelmaker-local-token"

var ErrUnsafeRegistryToken = errors.New("token must be a non-default value")

// NewRegistryToken returns a 256-bit Base64URL token from source.
func NewRegistryToken(source io.Reader) (string, error) {
	raw := make([]byte, registryTokenBytes)
	if _, err := io.ReadFull(source, raw); err != nil {
		return "", fmt.Errorf("generate registry token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// ValidateRegistryToken rejects missing and publicly known legacy credentials.
func ValidateRegistryToken(token string) error {
	if strings.TrimSpace(token) == "" || token == LegacyRegistryToken {
		return ErrUnsafeRegistryToken
	}
	return nil
}
