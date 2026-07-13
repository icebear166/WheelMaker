package portrelay

import (
	"sync"
	"time"
)

const (
	relaySourceBurst         = 5
	relayGenerationBurst     = 20
	relayLoginRefillInterval = 30 * time.Second
	relayLoginMaxSources     = 4096
	relayLoginSourceTTL      = time.Hour
)

type relayLoginBucket struct {
	tokens       int
	capacity     int
	lastRefill   time.Time
	lastActivity time.Time
}

type loginGuard struct {
	mu         sync.Mutex
	now        func() time.Time
	generation int64
	global     relayLoginBucket
	sources    map[string]*relayLoginBucket
}

func newLoginGuard(now func() time.Time) *loginGuard {
	if now == nil {
		now = time.Now
	}
	return &loginGuard{now: now, sources: make(map[string]*relayLoginBucket)}
}

func (g *loginGuard) reset(generation int64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.generation = generation
	g.global = newRelayLoginBucket(relayGenerationBurst, now)
	g.sources = make(map[string]*relayLoginBucket)
}

func (g *loginGuard) recordFailure(source string, generation int64) (bool, time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if generation != g.generation {
		g.generation = generation
		g.global = newRelayLoginBucket(relayGenerationBurst, now)
		g.sources = make(map[string]*relayLoginBucket)
	}
	g.pruneSources(now)
	bucket := g.sources[source]
	if bucket == nil {
		g.evictOldestSource()
		created := newRelayLoginBucket(relaySourceBurst, now)
		bucket = &created
		g.sources[source] = bucket
	}
	sourceReady, sourceRetry := consumeRelayLoginToken(bucket, now)
	globalReady, globalRetry := consumeRelayLoginToken(&g.global, now)
	if sourceReady && globalReady {
		return false, 0
	}
	if globalRetry > sourceRetry {
		return true, globalRetry
	}
	return true, sourceRetry
}

func (g *loginGuard) recordSuccess(source string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.sources, source)
}

func newRelayLoginBucket(capacity int, now time.Time) relayLoginBucket {
	return relayLoginBucket{
		tokens:       capacity,
		capacity:     capacity,
		lastRefill:   now,
		lastActivity: now,
	}
}

func consumeRelayLoginToken(bucket *relayLoginBucket, now time.Time) (bool, time.Duration) {
	if bucket.capacity == 0 {
		*bucket = newRelayLoginBucket(relayGenerationBurst, now)
	}
	if now.After(bucket.lastRefill) {
		intervals := int(now.Sub(bucket.lastRefill) / relayLoginRefillInterval)
		if intervals > 0 {
			bucket.tokens = min(bucket.capacity, bucket.tokens+intervals)
			bucket.lastRefill = bucket.lastRefill.Add(time.Duration(intervals) * relayLoginRefillInterval)
		}
	}
	bucket.lastActivity = now
	if bucket.tokens > 0 {
		bucket.tokens--
		return true, 0
	}
	retry := relayLoginRefillInterval - now.Sub(bucket.lastRefill)
	if retry <= 0 {
		retry = relayLoginRefillInterval
	}
	return false, retry
}

func (g *loginGuard) pruneSources(now time.Time) {
	for source, bucket := range g.sources {
		if now.Sub(bucket.lastActivity) > relayLoginSourceTTL {
			delete(g.sources, source)
		}
	}
}

func (g *loginGuard) evictOldestSource() {
	if len(g.sources) < relayLoginMaxSources {
		return
	}
	oldestSource := ""
	var oldestActivity time.Time
	for source, bucket := range g.sources {
		if oldestSource == "" || bucket.lastActivity.Before(oldestActivity) {
			oldestSource = source
			oldestActivity = bucket.lastActivity
		}
	}
	delete(g.sources, oldestSource)
}
