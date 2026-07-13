package registry

import (
	"sync"
	"time"
)

const (
	sourceLoginBurst = 5
	globalLoginBurst = 20
	loginTokenRefill = 30 * time.Second
	maxLoginSources  = 2048
)

type loginBucket struct {
	tokens     int
	capacity   int
	lastRefill time.Time
	lastUsed   time.Time
}

type loginLimiter struct {
	mu      sync.Mutex
	sources map[string]loginBucket
	global  loginBucket
	now     func() time.Time
}

func newLoginLimiter(now func() time.Time) *loginLimiter {
	current := now()
	return &loginLimiter{
		sources: make(map[string]loginBucket),
		global:  newLoginBucket(globalLoginBurst, current),
		now:     now,
	}
}

func (l *loginLimiter) Allow(source string) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.global.refill(now)
	bucket, ok := l.sources[source]
	if !ok {
		if len(l.sources) >= maxLoginSources {
			l.removeOldestSourceLocked()
		}
		bucket = newLoginBucket(sourceLoginBurst, now)
	}
	bucket.refill(now)
	bucket.lastUsed = now
	if bucket.tokens == 0 || l.global.tokens == 0 {
		l.sources[source] = bucket
		retry := bucket.retryAfter(now)
		if globalRetry := l.global.retryAfter(now); globalRetry > retry {
			retry = globalRetry
		}
		return false, retry
	}
	bucket.tokens--
	l.global.tokens--
	l.sources[source] = bucket
	return true, 0
}

func (l *loginLimiter) Success(source string) {
	l.mu.Lock()
	delete(l.sources, source)
	l.mu.Unlock()
}

func newLoginBucket(capacity int, now time.Time) loginBucket {
	return loginBucket{tokens: capacity, capacity: capacity, lastRefill: now, lastUsed: now}
}

func (b *loginBucket) refill(now time.Time) {
	if !now.After(b.lastRefill) || b.tokens >= b.capacity {
		return
	}
	count := int(now.Sub(b.lastRefill) / loginTokenRefill)
	if count < 1 {
		return
	}
	b.tokens = min(b.capacity, b.tokens+count)
	b.lastRefill = b.lastRefill.Add(time.Duration(count) * loginTokenRefill)
}

func (b loginBucket) retryAfter(now time.Time) time.Duration {
	if b.tokens > 0 {
		return 0
	}
	retry := loginTokenRefill - now.Sub(b.lastRefill)
	if retry <= 0 {
		return time.Second
	}
	return retry
}

func (l *loginLimiter) removeOldestSourceLocked() {
	oldestKey := ""
	var oldest time.Time
	for key, bucket := range l.sources {
		if oldest.IsZero() || bucket.lastUsed.Before(oldest) {
			oldestKey = key
			oldest = bucket.lastUsed
		}
	}
	delete(l.sources, oldestKey)
}
