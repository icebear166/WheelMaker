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

// zcodeappRuntimePool reuses one zcode app-server process across sessions of the
// same WheelMaker project. Mirrors codexappRuntimePool; the only difference is
// routing key is ZCode sessionId instead of Codex threadId.
type zcodeappRuntimeStarter func(context.Context, string, string) (*zcodeappRuntime, error)

type zcodeappRuntimeMetadata struct {
	cwd               string
	launchFingerprint string
}

type zcodeappPooledRuntime struct {
	runtime *zcodeappRuntime
	refs    int
}

type zcodeappRuntimePool struct {
	mu      sync.Mutex
	entries map[string]map[zcodeappRuntimeMetadata]*zcodeappPooledRuntime
	start   zcodeappRuntimeStarter
}

type zcodeappRuntimeLease struct {
	pool      *zcodeappRuntimePool
	projectID string
	metadata  zcodeappRuntimeMetadata
	runtime   *zcodeappRuntime
	exclusive bool
	release   sync.Once
}

func newZcodeappRuntimePool(start zcodeappRuntimeStarter) *zcodeappRuntimePool {
	return &zcodeappRuntimePool{
		entries: map[string]map[zcodeappRuntimeMetadata]*zcodeappPooledRuntime{},
		start:   start,
	}
}

func (p *zcodeappRuntimePool) acquire(ctx context.Context, projectID string, cwd string, launchFingerprint string) (*zcodeappRuntimeLease, error) {
	if p == nil || p.start == nil {
		return nil, fmt.Errorf("zcodeapp runtime pool is not configured")
	}
	metadata := zcodeappRuntimeMetadata{
		cwd:               filepath.Clean(cwd),
		launchFingerprint: launchFingerprint,
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		runtime, err := p.start(ctx, cwd, projectID)
		if err != nil {
			return nil, err
		}
		return &zcodeappRuntimeLease{pool: p, metadata: metadata, runtime: runtime, exclusive: true}, nil
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	byMetadata := p.entries[projectID]
	if byMetadata == nil {
		byMetadata = map[zcodeappRuntimeMetadata]*zcodeappPooledRuntime{}
		p.entries[projectID] = byMetadata
	}
	if pooled := byMetadata[metadata]; pooled != nil && pooled.runtime != nil && pooled.runtime.alive() {
		pooled.refs++
		return &zcodeappRuntimeLease{pool: p, projectID: projectID, metadata: metadata, runtime: pooled.runtime}, nil
	}
	runtime, err := p.start(ctx, cwd, projectID)
	if err != nil {
		return nil, err
	}
	p.configureRuntimeStop(projectID, metadata, runtime)
	byMetadata[metadata] = &zcodeappPooledRuntime{runtime: runtime, refs: 1}
	return &zcodeappRuntimeLease{pool: p, projectID: projectID, metadata: metadata, runtime: runtime}, nil
}

func (p *zcodeappRuntimePool) configureRuntimeStop(projectID string, metadata zcodeappRuntimeMetadata, runtime *zcodeappRuntime) {
	if runtime == nil {
		return
	}
	runtime.setOnStop(func(stopped *zcodeappRuntime) {
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

func (l *zcodeappRuntimeLease) Runtime() *zcodeappRuntime {
	if l == nil {
		return nil
	}
	return l.runtime
}

func (l *zcodeappRuntimeLease) Release() error {
	if l == nil {
		return nil
	}
	var closeRuntime *zcodeappRuntime
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

func zcodeappLaunchFingerprint(executable string, args []string, env []string) string {
	hash := sha256.New()
	write := func(value string) {
		_, _ = fmt.Fprintf(hash, "%d:%s", len(value), value)
	}
	write(executable)
	for _, arg := range args {
		write(arg)
	}
	for _, e := range env {
		write(e)
	}
	return hex.EncodeToString(hash.Sum(nil))
}
