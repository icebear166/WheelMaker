package usage

import (
	"context"
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
