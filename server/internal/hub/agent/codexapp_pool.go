package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
)

type codexappRuntimeStarter func(context.Context, string, string) (*codexappRuntime, error)

type codexappRuntimeMetadata struct {
	cwd               string
	launchFingerprint string
}

type codexappPooledRuntime struct {
	runtime *codexappRuntime
	refs    int
}

type codexappRuntimePool struct {
	mu      sync.Mutex
	entries map[string]map[codexappRuntimeMetadata]*codexappPooledRuntime
	start   codexappRuntimeStarter
}

type codexappRuntimeLease struct {
	pool      *codexappRuntimePool
	projectID string
	metadata  codexappRuntimeMetadata
	runtime   *codexappRuntime
	exclusive bool
	release   sync.Once
}

func newCodexappRuntimePool(start codexappRuntimeStarter) *codexappRuntimePool {
	return &codexappRuntimePool{
		entries: map[string]map[codexappRuntimeMetadata]*codexappPooledRuntime{},
		start:   start,
	}
}

func (p *codexappRuntimePool) acquire(ctx context.Context, projectID string, cwd string, launchFingerprint string) (*codexappRuntimeLease, error) {
	if p == nil || p.start == nil {
		return nil, fmt.Errorf("codexapp runtime pool is not configured")
	}
	metadata := codexappRuntimeMetadata{
		cwd:               filepath.Clean(cwd),
		launchFingerprint: launchFingerprint,
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		runtime, err := p.start(ctx, cwd, projectID)
		if err != nil {
			return nil, err
		}
		return &codexappRuntimeLease{pool: p, metadata: metadata, runtime: runtime, exclusive: true}, nil
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	byMetadata := p.entries[projectID]
	if byMetadata == nil {
		byMetadata = map[codexappRuntimeMetadata]*codexappPooledRuntime{}
		p.entries[projectID] = byMetadata
	}
	if pooled := byMetadata[metadata]; pooled != nil && pooled.runtime != nil && pooled.runtime.alive() {
		pooled.refs++
		return &codexappRuntimeLease{pool: p, projectID: projectID, metadata: metadata, runtime: pooled.runtime}, nil
	}
	runtime, err := p.start(ctx, cwd, projectID)
	if err != nil {
		return nil, err
	}
	p.configureRuntimeStop(projectID, metadata, runtime)
	byMetadata[metadata] = &codexappPooledRuntime{runtime: runtime, refs: 1}
	return &codexappRuntimeLease{pool: p, projectID: projectID, metadata: metadata, runtime: runtime}, nil
}

func (p *codexappRuntimePool) configureRuntimeStop(projectID string, metadata codexappRuntimeMetadata, runtime *codexappRuntime) {
	if runtime == nil {
		return
	}
	runtime.setOnStop(func(stopped *codexappRuntime) {
		p.mu.Lock()
		defer p.mu.Unlock()
		byMetadata := p.entries[projectID]
		if pooled := byMetadata[metadata]; pooled != nil && pooled.runtime == stopped {
			delete(byMetadata, metadata)
			if len(byMetadata) == 0 {
				delete(p.entries, projectID)
			}
		}
	})
}

func (l *codexappRuntimeLease) Runtime() *codexappRuntime {
	if l == nil {
		return nil
	}
	return l.runtime
}

func (l *codexappRuntimeLease) Release() error {
	if l == nil {
		return nil
	}
	var closeRuntime *codexappRuntime
	l.release.Do(func() {
		if l.exclusive {
			closeRuntime = l.runtime
			return
		}
		if l.pool == nil {
			return
		}
		l.pool.mu.Lock()
		byMetadata := l.pool.entries[l.projectID]
		if pooled := byMetadata[l.metadata]; pooled != nil && pooled.runtime == l.runtime {
			pooled.refs--
			if pooled.refs == 0 {
				delete(byMetadata, l.metadata)
				if len(byMetadata) == 0 {
					delete(l.pool.entries, l.projectID)
				}
				closeRuntime = pooled.runtime
			}
		}
		l.pool.mu.Unlock()
	})
	if closeRuntime != nil {
		return closeRuntime.close()
	}
	return nil
}

func (r *codexappRuntime) initialize(ctx context.Context, send func(context.Context) error) error {
	if r == nil {
		return fmt.Errorf("codexapp runtime is not ready")
	}
	r.initializeMu.Lock()
	if r.initialized {
		r.initializeMu.Unlock()
		return nil
	}
	if attempt := r.initializeAttempt; attempt != nil {
		r.initializeMu.Unlock()
		select {
		case <-attempt.done:
			return attempt.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	attempt := &codexappInitializeAttempt{done: make(chan struct{})}
	r.initializeAttempt = attempt
	r.initializeMu.Unlock()

	err := send(ctx)
	r.initializeMu.Lock()
	if err == nil {
		r.initialized = true
	}
	attempt.err = err
	r.initializeAttempt = nil
	close(attempt.done)
	r.initializeMu.Unlock()
	return err
}

func codexappLaunchFingerprint(executable string, args, env []string) string {
	hash := sha256.New()
	write := func(value string) {
		_, _ = fmt.Fprintf(hash, "%d:%s", len(value), value)
	}
	write(executable)
	for _, arg := range args {
		write(arg)
	}
	for _, value := range env {
		write(value)
	}
	return hex.EncodeToString(hash.Sum(nil))
}
