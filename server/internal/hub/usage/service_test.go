package usage

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type blockingCollector struct {
	calls   atomic.Int64
	started chan struct{}
	release chan struct{}
	once    sync.Once
	results []ProviderSnapshot
}

func newBlockingCollector() *blockingCollector {
	return &blockingCollector{started: make(chan struct{}), release: make(chan struct{})}
}

func (c *blockingCollector) Scan(ctx context.Context) []ProviderSnapshot {
	c.calls.Add(1)
	c.once.Do(func() { close(c.started) })
	select {
	case <-c.release:
		return append([]ProviderSnapshot(nil), c.results...)
	case <-ctx.Done():
		return nil
	}
}

func TestServiceScansImmediatelyThenTenMinutesAfterCompletion(t *testing.T) {
	after := make(chan time.Duration, 1)
	collector := newBlockingCollector()
	service := NewService(ServiceOptions{
		Collector: collector,
		Interval:  10 * time.Minute,
		After: func(duration time.Duration) <-chan time.Time {
			after <- duration
			return make(chan time.Time)
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go service.Run(ctx)
	select {
	case <-collector.started:
	case <-time.After(time.Second):
		t.Fatal("collector did not start immediately")
	}
	close(collector.release)
	if got := <-after; got != 10*time.Minute {
		t.Fatalf("interval=%v", got)
	}
}

func TestRefreshJoinsRunningScan(t *testing.T) {
	collector := newBlockingCollector()
	service := NewService(ServiceOptions{Collector: collector})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	select {
	case <-collector.started:
	case <-time.After(time.Second):
		t.Fatal("collector did not start")
	}
	doneA, doneB := make(chan struct{}), make(chan struct{})
	go func() { _, _ = service.Refresh(context.Background()); close(doneA) }()
	go func() { _, _ = service.Refresh(context.Background()); close(doneB) }()
	time.Sleep(10 * time.Millisecond)
	if got := collector.calls.Load(); got != 1 {
		t.Fatalf("collector calls=%d, want 1", got)
	}
	close(collector.release)
	select {
	case <-doneA:
	case <-time.After(time.Second):
		t.Fatal("first refresh did not join")
	}
	select {
	case <-doneB:
	case <-time.After(time.Second):
		t.Fatal("second refresh did not join")
	}
}

type immediateCollector struct{ calls atomic.Int64 }

func (c *immediateCollector) Scan(context.Context) []ProviderSnapshot {
	c.calls.Add(1)
	return nil
}

type sequenceCollector struct {
	results [][]ProviderSnapshot
	index   int
}

func (c *sequenceCollector) Scan(context.Context) []ProviderSnapshot {
	if c.index >= len(c.results) {
		return nil
	}
	result := c.results[c.index]
	c.index++
	return result
}

func TestServiceKeepsPreviousProviderWhenRefreshFails(t *testing.T) {
	collector := &sequenceCollector{results: [][]ProviderSnapshot{
		{{
			ID: ProviderKimi, Name: "Kimi", Status: ProviderOK,
			Accounts: []Account{{
				LocalID: "opencode", Status: ProviderOK,
				Limits: []Limit{{ID: "week", RemainingPercent: 66}},
			}},
		}},
		{{
			ID: ProviderKimi, Name: "Kimi", Status: ProviderError,
			Accounts: []Account{{
				LocalID: "opencode", Status: ProviderError,
				Limits: []Limit{},
			}},
		}},
	}}
	service := NewService(ServiceOptions{Collector: collector})

	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("second refresh: %v", err)
	}

	if len(got.Providers) != 1 || len(got.Providers[0].Accounts) != 1 {
		t.Fatalf("providers=%+v, want previous provider and account", got.Providers)
	}
	if len(got.Providers[0].Accounts[0].Limits) != 1 {
		t.Fatalf("limits=%+v, want previous successful limit", got.Providers[0].Accounts[0].Limits)
	}
	if got.Providers[0].Accounts[0].Limits[0].RemainingPercent != 66 {
		t.Fatalf("limits=%+v, want previous successful limit", got.Providers[0].Accounts[0].Limits)
	}
}

func TestServiceKeepsPreviousAccountWhenOneAccountRefreshFails(t *testing.T) {
	collector := &sequenceCollector{results: [][]ProviderSnapshot{
		{{
			ID: ProviderDeepSeek, Name: "DeepSeek", Status: ProviderOK,
			Accounts: []Account{
				{LocalID: "one", Status: ProviderOK, Limits: []Limit{{ID: "week", RemainingPercent: 80}}},
				{LocalID: "two", Status: ProviderOK, Limits: []Limit{{ID: "week", RemainingPercent: 60}}},
			},
		}},
		{{
			ID: ProviderDeepSeek, Name: "DeepSeek", Status: ProviderOK,
			Accounts: []Account{
				{LocalID: "one", Status: ProviderOK, Limits: []Limit{{ID: "week", RemainingPercent: 70}}},
				{LocalID: "two", Status: ProviderError, Limits: []Limit{}},
			},
		}},
	}}
	service := NewService(ServiceOptions{Collector: collector})

	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("second refresh: %v", err)
	}

	accounts := got.Providers[0].Accounts
	if len(accounts) != 2 {
		t.Fatalf("accounts=%+v, want two accounts", accounts)
	}
	if len(accounts[0].Limits) != 1 || len(accounts[1].Limits) != 1 {
		t.Fatalf("accounts=%+v, want one limit per account", accounts)
	}
	if accounts[0].Limits[0].RemainingPercent != 70 || accounts[1].Limits[0].RemainingPercent != 60 {
		t.Fatalf("accounts=%+v, want refreshed account plus previous failed account", accounts)
	}
}

func TestManualRefreshRestartsAutomaticInterval(t *testing.T) {
	afterCalls := make(chan time.Duration, 2)
	collector := &immediateCollector{}
	service := NewService(ServiceOptions{
		Collector: collector,
		Interval:  10 * time.Minute,
		After: func(duration time.Duration) <-chan time.Time {
			afterCalls <- duration
			return make(chan time.Time)
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go service.Run(ctx)
	if got := <-afterCalls; got != 10*time.Minute {
		t.Fatalf("initial interval=%v", got)
	}
	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("manual refresh: %v", err)
	}
	select {
	case got := <-afterCalls:
		if got != 10*time.Minute {
			t.Fatalf("reset interval=%v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("manual refresh did not restart the automatic interval")
	}
	if got := collector.calls.Load(); got != 2 {
		t.Fatalf("collector calls=%d, want 2", got)
	}
}

func TestCloneSnapshotPreservesEmptyCollectionsAsJSONArrays(t *testing.T) {
	snapshot := cloneSnapshot(Snapshot{Providers: []ProviderSnapshot{
		{
			ID: ProviderDeepSeek, Name: "DeepSeek", Status: ProviderOK,
			Accounts: []Account{{LocalID: "opencode", Status: ProviderOK, Limits: []Limit{}}},
		},
		{ID: ProviderKimi, Name: "Kimi", Status: ProviderUnavailable, Accounts: []Account{}},
	}})
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	for _, expected := range []string{`"limits":[]`, `"accounts":[]`} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf("snapshot JSON must contain %s: %s", expected, raw)
		}
	}
	emptyRaw, err := json.Marshal(cloneSnapshot(Snapshot{Providers: []ProviderSnapshot{}}))
	if err != nil {
		t.Fatalf("marshal empty snapshot: %v", err)
	}
	if !strings.Contains(string(emptyRaw), `"providers":[]`) {
		t.Fatalf("empty providers must remain an array: %s", emptyRaw)
	}
}
