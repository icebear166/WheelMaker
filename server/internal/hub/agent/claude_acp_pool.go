package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type claudeACPConnStarter func(name, executable, cwd string, args, env []string) (Conn, error)

type claudeACPInstanceDecorator func(Instance) Instance

type claudeACPRuntimeMetadata struct {
	cwd               string
	launchFingerprint string
}

// claudeACPRuntimePool reuses one claude-agent-acp process for compatible
// WheelMaker sessions. Each session still owns an independently routed Conn.
type claudeACPRuntimePool struct {
	mu      sync.Mutex
	entries map[string]map[claudeACPRuntimeMetadata]*SharedConnPool
	start   claudeACPConnStarter
}

func newClaudeACPRuntimePool(start claudeACPConnStarter) *claudeACPRuntimePool {
	return &claudeACPRuntimePool{
		entries: map[string]map[claudeACPRuntimeMetadata]*SharedConnPool{},
		start:   start,
	}
}

func (p *claudeACPRuntimePool) acquire(
	projectID string,
	providerName string,
	executable string,
	cwd string,
	args []string,
	env []string,
) (Conn, error) {
	if p == nil || p.start == nil {
		return nil, fmt.Errorf("claude ACP runtime pool is not configured")
	}
	metadata := claudeACPRuntimeMetadata{
		cwd:               filepath.Clean(cwd),
		launchFingerprint: claudeACPLaunchFingerprint(executable, args, env),
	}
	connect := func() (Conn, error) {
		return p.start(
			providerName,
			executable,
			cwd,
			append([]string(nil), args...),
			append([]string(nil), env...),
		)
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return NewSharedConnPool(connect).Open()
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	byMetadata := p.entries[projectID]
	if byMetadata == nil {
		byMetadata = map[claudeACPRuntimeMetadata]*SharedConnPool{}
		p.entries[projectID] = byMetadata
	}
	shared := byMetadata[metadata]
	if shared == nil || !shared.Alive() {
		shared = NewSharedConnPool(connect)
		byMetadata[metadata] = shared
	}
	conn, err := shared.Open()
	if err != nil {
		if byMetadata[metadata] == shared {
			delete(byMetadata, metadata)
			if len(byMetadata) == 0 {
				delete(p.entries, projectID)
			}
		}
		return nil, err
	}
	return conn, nil
}

func claudeACPLaunchFingerprint(executable string, args []string, env []string) string {
	hash := sha256.New()
	write := func(value string) {
		_, _ = fmt.Fprintf(hash, "%d:%s", len(value), value)
	}
	write(executable)
	for _, arg := range args {
		write(arg)
	}
	environment := append([]string(nil), env...)
	sort.Strings(environment)
	for _, item := range environment {
		write(item)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func claudeACPInstanceCreator(provider ACPProvider) InstanceCreator {
	return claudeACPInstanceCreatorWithStarter(provider, startOwnedProviderConn, nil)
}

func claudeACPInstanceCreatorWithStarter(
	provider ACPProvider,
	starter claudeACPConnStarter,
	decorate claudeACPInstanceDecorator,
) InstanceCreator {
	pool := newClaudeACPRuntimePool(starter)
	return func(ctx context.Context, cwd string) (Instance, error) {
		executable, args, env, err := provider.Launch()
		if err != nil {
			return nil, err
		}
		conn, err := pool.acquire(
			ProjectNameFromContext(ctx),
			provider.Name(),
			executable,
			cwd,
			args,
			env,
		)
		if err != nil {
			return nil, fmt.Errorf("connect %q: %w", provider.Name(), err)
		}
		instance := NewInstance(provider.Name(), conn)
		if decorate != nil {
			instance = decorate(instance)
		}
		return instance, nil
	}
}

func isClaudeACPProvider(provider ACPProvider) bool {
	configured, ok := provider.(*acpProvider)
	return ok && configured != nil && configured.preset.BinaryName == ClaudeACPProviderPreset.BinaryName
}
