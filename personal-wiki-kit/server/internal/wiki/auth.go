package wiki

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	argonVersion     = 19
	defaultMemory    = 64 * 1024
	defaultTime      = 3
	defaultThreads   = 2
	defaultKeyLength = 32
)

type argonParameters struct {
	memory  uint32
	time    uint32
	threads uint8
	keyLen  uint32
}

func HashPassword(password string) (string, error) {
	if len(password) < 12 {
		return "", errors.New("password must contain at least 12 characters")
	}
	return hashPassword(password, argonParameters{
		memory: defaultMemory, time: defaultTime, threads: defaultThreads, keyLen: defaultKeyLength,
	})
}

func hashPassword(password string, parameters argonParameters) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, parameters.time, parameters.memory, parameters.threads, parameters.keyLen)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argonVersion,
		parameters.memory,
		parameters.time,
		parameters.threads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func VerifyPassword(encoded, password string) (bool, error) {
	parameters, salt, expected, err := parsePasswordHash(encoded)
	if err != nil {
		return false, err
	}
	actual := argon2.IDKey([]byte(password), salt, parameters.time, parameters.memory, parameters.threads, parameters.keyLen)
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}

func parsePasswordHash(encoded string) (argonParameters, []byte, []byte, error) {
	parts := strings.Split(strings.TrimSpace(encoded), "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return argonParameters{}, nil, nil, errors.New("password hash must use argon2id encoding")
	}
	version, err := strconv.Atoi(strings.TrimPrefix(parts[2], "v="))
	if err != nil || version != argonVersion {
		return argonParameters{}, nil, nil, errors.New("unsupported argon2id version")
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return argonParameters{}, nil, nil, errors.New("invalid argon2id parameters")
	}
	if memory < 8*1024 || memory > 256*1024 || iterations < 1 || iterations > 10 || threads < 1 || threads > 8 {
		return argonParameters{}, nil, nil, errors.New("argon2id parameters are outside safe limits")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return argonParameters{}, nil, nil, errors.New("invalid argon2id salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) < 16 || len(expected) > 64 {
		return argonParameters{}, nil, nil, errors.New("invalid argon2id key")
	}
	return argonParameters{memory: memory, time: iterations, threads: threads, keyLen: uint32(len(expected))}, salt, expected, nil
}

type sessionStore struct {
	mu       sync.Mutex
	sessions map[[32]byte]time.Time
	ttl      time.Duration
	now      func() time.Time
}

func newSessionStore(ttl time.Duration) *sessionStore {
	return &sessionStore{sessions: make(map[[32]byte]time.Time), ttl: ttl, now: time.Now}
}

func (store *sessionStore) create() (string, time.Time, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", time.Time{}, fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	digest := sha256.Sum256([]byte(token))
	expires := store.now().Add(store.ttl)
	store.mu.Lock()
	defer store.mu.Unlock()
	store.removeExpiredLocked()
	store.sessions[digest] = expires
	return token, expires, nil
}

func (store *sessionStore) valid(token string) bool {
	if token == "" {
		return false
	}
	digest := sha256.Sum256([]byte(token))
	store.mu.Lock()
	defer store.mu.Unlock()
	expires, ok := store.sessions[digest]
	if !ok || !expires.After(store.now()) {
		delete(store.sessions, digest)
		return false
	}
	return true
}

func (store *sessionStore) delete(token string) {
	digest := sha256.Sum256([]byte(token))
	store.mu.Lock()
	delete(store.sessions, digest)
	store.mu.Unlock()
}

func (store *sessionStore) removeExpiredLocked() {
	now := store.now()
	for token, expires := range store.sessions {
		if !expires.After(now) {
			delete(store.sessions, token)
		}
	}
}

type attemptLimiter struct {
	mu       sync.Mutex
	attempts map[string]attemptWindow
	maximum  int
	window   time.Duration
	now      func() time.Time
}

type attemptWindow struct {
	started time.Time
	count   int
}

func newAttemptLimiter(maximum int, window time.Duration) *attemptLimiter {
	return &attemptLimiter{attempts: make(map[string]attemptWindow), maximum: maximum, window: window, now: time.Now}
}

func (limiter *attemptLimiter) allowed(key string) (bool, time.Duration) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	entry, ok := limiter.attempts[key]
	if !ok || limiter.now().Sub(entry.started) >= limiter.window {
		return true, 0
	}
	if entry.count < limiter.maximum {
		return true, 0
	}
	return false, limiter.window - limiter.now().Sub(entry.started)
}

func (limiter *attemptLimiter) failed(key string) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	entry, ok := limiter.attempts[key]
	if !ok || limiter.now().Sub(entry.started) >= limiter.window {
		limiter.attempts[key] = attemptWindow{started: limiter.now(), count: 1}
		return
	}
	entry.count++
	limiter.attempts[key] = entry
}

func (limiter *attemptLimiter) reset(key string) {
	limiter.mu.Lock()
	delete(limiter.attempts, key)
	limiter.mu.Unlock()
}
