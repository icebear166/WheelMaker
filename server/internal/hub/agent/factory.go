package agent

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

// InstanceCreator creates one runtime instance.
// The cwd parameter is the project working directory; providers that
// need the subprocess to start in the project directory should use it.
// Providers that ignore cwd can receive an empty string.
type InstanceCreator func(ctx context.Context, cwd string) (Instance, error)

type SessionActionSupport struct {
	Status  bool
	Compact bool
	Steer   bool
	Fork    bool
	Goal    bool
}

// ACPFactoryOptions contains one Hub's local provider configuration.
type ACPFactoryOptions struct {
	StateDir       string
	DeepSeekAPIKey string
	KimiAPIKey     string
	QwenAPIKey     string
	ZAIAPIKey      string
	FlickerAPIKey  string
	// FlickerModelStore,when set,suppliesthe cc-flicker provider's model
	// catalog. It is refreshedonce when the managed bridge reportshealthy.
	FlickerModelStore *FlickerModelStore
}

type projectNameContextKey struct{}

func WithProjectName(ctx context.Context, projectName string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	projectName = strings.TrimSpace(projectName)
	if projectName == "" {
		return ctx
	}
	return context.WithValue(ctx, projectNameContextKey{}, projectName)
}

func ProjectNameFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	value, _ := ctx.Value(projectNameContextKey{}).(string)
	return strings.TrimSpace(value)
}

// ACPFactory resolves one provider enum to one instance creator.
// A creator map contains both default built-ins and optional overrides.
type ACPFactory struct {
	mu             sync.RWMutex
	creators       map[protocol.ACPProvider]InstanceCreator
	sessionActions map[protocol.ACPProvider]SessionActionSupport
}

var (
	defaultACPFactoryOnce sync.Once
	defaultACPFactory     *ACPFactory
)

// DefaultACPFactory returns the singleton ACP factory.
func DefaultACPFactory() *ACPFactory {
	defaultACPFactoryOnce.Do(func() {
		defaultACPFactory = newACPFactoryWithDefaults()
	})
	return defaultACPFactory
}

// NewConfiguredACPFactory creates an ACP factory using one Hub's local keys.
// Provider availability is evaluated once during construction.
func NewConfiguredACPFactory(options ACPFactoryOptions) *ACPFactory {
	return newACPFactoryWithOptions(options, isProviderAvailable)
}

// NewACPFactory returns an empty ACP factory with no providers registered.
// Use Register to bind only the providers you need. Tests use this to build a
// deterministic registry independent of which CLIs happen to be installed on
// the host (DefaultACPFactory / Clone carry host-specific providers).
func NewACPFactory() *ACPFactory {
	return &ACPFactory{
		creators:       map[protocol.ACPProvider]InstanceCreator{},
		sessionActions: map[protocol.ACPProvider]SessionActionSupport{},
	}
}

func newACPFactoryWithDefaults() *ACPFactory {
	return newACPFactoryWithOptions(ACPFactoryOptions{}, isProviderAvailable)
}

func newACPFactoryWithOptions(options ACPFactoryOptions, available func(ACPProvider) bool) *ACPFactory {
	f := &ACPFactory{
		creators:       map[protocol.ACPProvider]InstanceCreator{},
		sessionActions: map[protocol.ACPProvider]SessionActionSupport{},
	}
	if available == nil {
		available = isProviderAvailable
	}
	codexProvider := NewCodexProvider()
	if available(codexProvider) {
		f.Register(protocol.ACPProviderCodex, codexappInstanceCreator(codexProvider))
		f.RegisterSessionActions(protocol.ACPProviderCodex, SessionActionSupport{Status: true, Compact: true, Steer: true, Fork: true, Goal: true})
	}
	candidates := []struct {
		provider protocol.ACPProvider
		build    func() ACPProvider
	}{
		{provider: protocol.ACPProviderClaude, build: func() ACPProvider { return NewClaudeProvider() }},
		{provider: protocol.ACPProviderCopilot, build: func() ACPProvider { return NewCopilotProvider() }},
		{provider: protocol.ACPProviderOpenCode, build: func() ACPProvider { return NewOpenCodeProvider() }},
		{provider: protocol.ACPProviderMimo, build: func() ACPProvider { return NewMimoProvider() }},
		{provider: protocol.ACPProviderCodeBuddy, build: func() ACPProvider { return NewCodeBuddyProvider() }},
		{provider: protocol.ACPProviderFlicker, build: func() ACPProvider { return NewFlickerProvider() }},
		{provider: protocol.ACPProviderKimi, build: func() ACPProvider { return NewKimiProvider() }},
	}
	for _, candidate := range candidates {
		prov := candidate.build()
		if !available(prov) {
			continue
		}
		if candidate.provider == protocol.ACPProviderFlicker {
			f.Register(candidate.provider, flickerInstanceCreator(prov))
			continue
		}
		f.Register(candidate.provider, providerInstanceCreator(prov))
	}
	if deepseekKey := strings.TrimSpace(options.DeepSeekAPIKey); deepseekKey != "" {
		registerConfiguredProvider(f, protocol.ACPProviderCCDeepSeek, NewCCDeepSeekProvider(options.StateDir, deepseekKey), available)
	}
	if kimiKey := strings.TrimSpace(options.KimiAPIKey); kimiKey != "" {
		registerConfiguredProvider(f, protocol.ACPProviderCCKimi, NewCCKimiProvider(options.StateDir, kimiKey), available)
	}
	if qwenKey := strings.TrimSpace(options.QwenAPIKey); qwenKey != "" {
		registerConfiguredProvider(f, protocol.ACPProviderCCQwen, NewCCQwenProvider(options.StateDir, qwenKey), available)
	}
	if zaiKey := strings.TrimSpace(options.ZAIAPIKey); zaiKey != "" {
		registerConfiguredProvider(f, protocol.ACPProviderCCGLM, NewCCGLMProvider(options.StateDir, zaiKey), available)
	}
	if flickerKey := strings.TrimSpace(options.FlickerAPIKey); flickerKey != "" {
		registerConfiguredProvider(f, protocol.ACPProviderCCFlicker, NewCCFlickerProvider(options.StateDir, flickerKey, options.FlickerModelStore), available)
	}
	if len(f.Names()) == 0 {
		agentLogger().Warn("no available ACP providers detected")
	}
	return f
}

func registerConfiguredProvider(f *ACPFactory, provider protocol.ACPProvider, configured ACPProvider, available func(ACPProvider) bool) {
	if !available(configured) {
		return
	}
	f.Register(provider, providerInstanceCreator(configured))
}

// Clone returns a shallow copy of the creator registry.
func (f *ACPFactory) Clone() *ACPFactory {
	if f == nil {
		return nil
	}
	f.mu.RLock()
	defer f.mu.RUnlock()
	cp := &ACPFactory{
		creators:       make(map[protocol.ACPProvider]InstanceCreator, len(f.creators)),
		sessionActions: make(map[protocol.ACPProvider]SessionActionSupport, len(f.sessionActions)),
	}
	for provider, creator := range f.creators {
		cp.creators[provider] = creator
	}
	for provider, actions := range f.sessionActions {
		cp.sessionActions[provider] = actions
	}
	return cp
}

// ReplaceFrom atomically replaces this factory's provider registry while
// preserving the factory pointer shared by Hub clients and sessions.
func (f *ACPFactory) ReplaceFrom(replacement *ACPFactory) {
	if f == nil || replacement == nil || f == replacement {
		return
	}
	snapshot := replacement.Clone()
	if snapshot == nil {
		return
	}
	f.mu.Lock()
	f.creators = snapshot.creators
	f.sessionActions = snapshot.sessionActions
	f.mu.Unlock()
}

func (f *ACPFactory) RegisterSessionActions(provider protocol.ACPProvider, actions SessionActionSupport) {
	if f == nil {
		return
	}
	f.mu.Lock()
	if f.sessionActions == nil {
		f.sessionActions = map[protocol.ACPProvider]SessionActionSupport{}
	}
	f.sessionActions[provider] = actions
	f.mu.Unlock()
}

func (f *ACPFactory) SessionActions(provider protocol.ACPProvider) SessionActionSupport {
	if f == nil {
		return SessionActionSupport{}
	}
	f.mu.RLock()
	actions := f.sessionActions[provider]
	f.mu.RUnlock()
	return actions
}

// Register binds a provider to a creator. Existing binding is replaced.
func (f *ACPFactory) Register(provider protocol.ACPProvider, creator InstanceCreator) {
	if f == nil || creator == nil {
		return
	}
	f.mu.Lock()
	if f.creators == nil {
		f.creators = map[protocol.ACPProvider]InstanceCreator{}
	}
	f.creators[provider] = creator
	f.mu.Unlock()
	agentLogger().Info("registered provider=%s", provider)
}

// Creator returns a creator by provider enum.
func (f *ACPFactory) Creator(provider protocol.ACPProvider) InstanceCreator {
	if f == nil {
		return nil
	}
	f.mu.RLock()
	creator := f.creators[provider]
	f.mu.RUnlock()
	return creator
}

// CreatorByName resolves provider name then returns its creator.
func (f *ACPFactory) CreatorByName(name string) InstanceCreator {
	provider, ok := protocol.ParseACPProvider(strings.ToLower(strings.TrimSpace(name)))
	if !ok {
		return nil
	}
	return f.Creator(provider)
}

// Names returns provider names in stable order.
func (f *ACPFactory) Names() []string {
	if f == nil {
		return nil
	}
	f.mu.RLock()
	names := make([]string, 0, len(f.creators))
	for provider := range f.creators {
		names = append(names, string(provider))
	}
	f.mu.RUnlock()
	sort.Strings(names)
	return names
}

// PreferredName returns the preferred available provider name.
func (f *ACPFactory) PreferredName() string {
	if f == nil {
		return ""
	}
	ordered := []protocol.ACPProvider{
		protocol.ACPProviderCodex,
		protocol.ACPProviderClaude,
		protocol.ACPProviderCopilot,
		protocol.ACPProviderOpenCode,
		protocol.ACPProviderMimo,
		protocol.ACPProviderCodeBuddy,
		protocol.ACPProviderFlicker,
	}
	f.mu.RLock()
	defer f.mu.RUnlock()
	for _, provider := range ordered {
		if f.creators[provider] != nil {
			return string(provider)
		}
	}
	return ""
}

// CreateInstance creates one runtime instance by provider enum.
func (f *ACPFactory) CreateInstance(ctx context.Context, provider protocol.ACPProvider) (Instance, error) {
	creator := f.Creator(provider)
	if creator == nil {
		return nil, fmt.Errorf("unknown provider: %q", provider)
	}
	return creator(ctx, "")
}

func providerInstanceCreator(provider ACPProvider) InstanceCreator {
	return func(_ context.Context, cwd string) (Instance, error) {
		conn, err := NewOwnedProviderConn(provider, cwd)
		if err != nil {
			return nil, fmt.Errorf("connect %q: %w", provider.Name(), err)
		}
		return NewInstance(provider.Name(), conn), nil
	}
}

func NewOwnedProviderConn(provider ACPProvider, cwd string) (Conn, error) {
	exe, args, env, err := provider.Launch()
	if err != nil {
		return nil, err
	}
	raw := NewACPProcess(provider.Name(), exe, env, args...)
	raw.SetDir(cwd)
	if err := raw.Start(); err != nil {
		return nil, err
	}
	return NewOwnedConn(raw), nil
}

func isProviderAvailable(provider ACPProvider) bool {
	if provider == nil {
		return false
	}
	_, _, _, err := provider.Launch()
	if err != nil {
		agentLogger().Warn("skip provider=%s reason=%v", provider.Name(), err)
		return false
	}
	return true
}
