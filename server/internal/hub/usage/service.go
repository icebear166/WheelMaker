package usage

import (
	"context"
	"sync"
	"time"
)

const defaultScanInterval = 10 * time.Minute

type SnapshotCollector interface {
	Scan(context.Context) []ProviderSnapshot
}

type HistoryRecorder interface {
	Record(time.Time, []ProviderSnapshot) error
}

type ServiceOptions struct {
	HubID          string
	Collector      SnapshotCollector
	History        HistoryRecorder
	Interval       time.Duration
	After          func(time.Duration) <-chan time.Time
	Now            func() time.Time
	OnSnapshot     func(Snapshot)
	OnHistoryError func(error)
}

type scanRun struct{ done chan struct{} }

type Service struct {
	options ServiceOptions

	startOnce       sync.Once
	mu              sync.RWMutex
	lifecycle       context.Context
	run             *scanRun
	snapshot        Snapshot
	scheduleChanged chan struct{}
}

func NewService(options ServiceOptions) *Service {
	if options.Interval <= 0 {
		options.Interval = defaultScanInterval
	}
	if options.After == nil {
		options.After = time.After
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	return &Service{
		options:         options,
		scheduleChanged: make(chan struct{}, 1),
		snapshot: Snapshot{
			HubID: options.HubID, Status: ScanIdle, Providers: []ProviderSnapshot{},
		},
	}
}

func (s *Service) Start(ctx context.Context) {
	go s.Run(ctx)
}

func (s *Service) Run(ctx context.Context) {
	started := false
	s.startOnce.Do(func() {
		started = true
		s.mu.Lock()
		s.lifecycle = ctx
		s.mu.Unlock()
	})
	if !started {
		return
	}
	if _, err := s.Refresh(ctx); err != nil && ctx.Err() != nil {
		return
	}
	s.consumeScheduleChange()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.options.After(s.options.Interval):
			if s.consumeScheduleChange() {
				continue
			}
			if _, err := s.Refresh(ctx); err != nil && ctx.Err() != nil {
				return
			}
			s.consumeScheduleChange()
		case <-s.scheduleChanged:
		}
	}
}

func (s *Service) Refresh(waitContext context.Context) (Snapshot, error) {
	s.mu.Lock()
	if s.run == nil {
		run := &scanRun{done: make(chan struct{})}
		s.run = run
		now := s.options.Now().UTC()
		s.snapshot.Generation++
		s.snapshot.Status = ScanScanning
		s.snapshot.StartedAt = &now
		s.snapshot.NextScanAt = nil
		s.snapshot.Message = ""
		lifecycle := s.lifecycle
		if lifecycle == nil {
			lifecycle = context.Background()
		}
		started := cloneSnapshot(s.snapshot)
		s.mu.Unlock()
		s.publish(started)
		go s.execute(lifecycle, run)
		return s.wait(waitContext, run)
	}
	run := s.run
	s.mu.Unlock()
	return s.wait(waitContext, run)
}

func (s *Service) wait(ctx context.Context, run *scanRun) (Snapshot, error) {
	select {
	case <-ctx.Done():
		return s.Snapshot(), ctx.Err()
	case <-run.done:
		return s.Snapshot(), nil
	}
}

func (s *Service) execute(ctx context.Context, run *scanRun) {
	providers := []ProviderSnapshot{}
	if s.options.Collector != nil {
		providers = s.options.Collector.Scan(ctx)
	}
	now := s.options.Now().UTC()
	next := now.Add(s.options.Interval)
	if s.options.History != nil {
		if err := s.options.History.Record(now, providers); err != nil && s.options.OnHistoryError != nil {
			s.options.OnHistoryError(err)
		}
	}
	s.mu.Lock()
	s.snapshot.Providers = mergeProviderSnapshots(s.snapshot.Providers, providers)
	s.snapshot.UpdatedAt = &now
	s.snapshot.NextScanAt = &next
	if ctx.Err() != nil {
		s.snapshot.Status, s.snapshot.Message = ScanError, "scan cancelled"
	} else {
		s.snapshot.Status = ScanReady
		s.snapshot.Message = ""
	}
	complete := cloneSnapshot(s.snapshot)
	if s.run == run {
		s.run = nil
	}
	s.signalScheduleChanged()
	close(run.done)
	s.mu.Unlock()
	s.publish(complete)
}

func (s *Service) signalScheduleChanged() {
	select {
	case s.scheduleChanged <- struct{}{}:
	default:
	}
}

func (s *Service) consumeScheduleChange() bool {
	select {
	case <-s.scheduleChanged:
		return true
	default:
		return false
	}
}

func (s *Service) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSnapshot(s.snapshot)
}

func (s *Service) publish(snapshot Snapshot) {
	if s.options.OnSnapshot != nil {
		s.options.OnSnapshot(snapshot)
	}
}

func mergeProviderSnapshots(previous, current []ProviderSnapshot) []ProviderSnapshot {
	previousByID := make(map[ProviderID]ProviderSnapshot, len(previous))
	for _, provider := range previous {
		previousByID[provider.ID] = provider
	}

	merged := make([]ProviderSnapshot, 0, len(current)+len(previous))
	seen := make(map[ProviderID]struct{}, len(current))
	for _, provider := range current {
		if provider.Remove {
			seen[provider.ID] = struct{}{}
			continue
		}
		previousProvider, hasPrevious := previousByID[provider.ID]
		provider, keep := mergeProviderSnapshot(previousProvider, provider, hasPrevious)
		if !keep {
			continue
		}
		merged = append(merged, provider)
		seen[provider.ID] = struct{}{}
	}
	for _, provider := range previous {
		if _, exists := seen[provider.ID]; !exists {
			merged = append(merged, provider)
		}
	}
	return merged
}

func mergeProviderSnapshot(previous, current ProviderSnapshot, hasPrevious bool) (ProviderSnapshot, bool) {
	if !hasPrevious {
		return current, current.Status != ProviderError
	}
	if current.ID == ProviderQwen {
		if current.Status == ProviderUnavailable && len(current.Accounts) == 0 {
			previous.Status = ProviderError
			previous.Message = current.Message
			previous.Authenticated = current.Authenticated
			return previous, true
		}
		return current, true
	}
	if current.Status == ProviderUnavailable || len(current.Accounts) == 0 {
		return previous, true
	}

	previousByLocalID := make(map[string]Account, len(previous.Accounts))
	for _, account := range previous.Accounts {
		previousByLocalID[account.LocalID] = account
	}
	accounts := make([]Account, 0, len(current.Accounts))
	for _, account := range current.Accounts {
		if account.Status == ProviderOK {
			accounts = append(accounts, account)
			continue
		}
		if previousAccount, exists := previousByLocalID[account.LocalID]; exists {
			accounts = append(accounts, previousAccount)
		}
	}
	if len(accounts) == 0 {
		return previous, true
	}

	current.Accounts = accounts
	current.Status = providerStatus(accounts)
	current.Message = ""
	return current, true
}
func cloneSnapshot(snapshot Snapshot) Snapshot {
	copySnapshot := snapshot
	copySnapshot.Providers = append([]ProviderSnapshot{}, snapshot.Providers...)
	for index := range copySnapshot.Providers {
		copySnapshot.Providers[index].Accounts = append([]Account{}, snapshot.Providers[index].Accounts...)
		for accountIndex := range copySnapshot.Providers[index].Accounts {
			copySnapshot.Providers[index].Accounts[accountIndex].Limits = append([]Limit{}, snapshot.Providers[index].Accounts[accountIndex].Limits...)
			copySnapshot.Providers[index].Accounts[accountIndex].Qwen = cloneQwenUsageData(snapshot.Providers[index].Accounts[accountIndex].Qwen)
		}
	}
	return copySnapshot
}
