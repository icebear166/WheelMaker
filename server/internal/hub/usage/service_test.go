package usage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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

type historyRecorderStub struct {
	at        []time.Time
	providers [][]ProviderSnapshot
	err       error
}

func (s *historyRecorderStub) Record(at time.Time, providers []ProviderSnapshot) error {
	s.at = append(s.at, at)
	s.providers = append(s.providers, append([]ProviderSnapshot(nil), providers...))
	return s.err
}

func TestServiceRecordsRawHistoryBeforePreservingFailedSnapshot(t *testing.T) {
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
				LocalID: "opencode", Status: ProviderError, Limits: []Limit{},
			}},
		}},
	}}
	recorder := &historyRecorderStub{}
	service := NewService(ServiceOptions{Collector: collector, History: recorder})

	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(recorder.providers) != 2 || recorder.providers[1][0].Accounts[0].Status != ProviderError {
		t.Fatalf("recorded providers=%+v", recorder.providers)
	}
	if got.Providers[0].Accounts[0].Status != ProviderOK || got.Providers[0].Accounts[0].Limits[0].RemainingPercent != 66 {
		t.Fatalf("visible snapshot=%+v", got.Providers)
	}
}

func TestServiceHistoryWriteFailureDoesNotFailLimitsScan(t *testing.T) {
	collector := &sequenceCollector{results: [][]ProviderSnapshot{{{
		ID: ProviderKimi, Name: "Kimi", Status: ProviderOK, Accounts: []Account{},
	}}}}
	recorder := &historyRecorderStub{err: errors.New("disk full")}
	var historyErr error
	service := NewService(ServiceOptions{
		Collector: collector, History: recorder,
		OnHistoryError: func(err error) { historyErr = err },
	})

	got, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("refresh error=%v", err)
	}
	if got.Status != ScanReady || len(recorder.providers) != 1 || historyErr == nil || historyErr.Error() != "disk full" {
		t.Fatalf("snapshot=%+v recorder=%+v historyErr=%v", got, recorder, historyErr)
	}
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

func TestHistoryStoreRecordsCompactSamplesAndReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "usage-history.json")
	store := NewHistoryStore(path)
	reset := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	at := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)
	if err := store.Record(at, []ProviderSnapshot{{
		ID: ProviderCodex, Status: ProviderOK,
		Accounts: []Account{{
			LocalID: "current", Status: ProviderOK,
			Limits: []Limit{{
				ID: "week", Label: "Week", RemainingPercent: 82.4,
				WindowKind: WindowFixed, WindowDurationMins: 10080, ResetsAt: &reset,
			}},
		}},
	}}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`[1785200400000,82.4]`)) {
		t.Fatalf("history is not compact: %s", raw)
	}
	got, err := NewHistoryStore(path).Query(HistoryQuery{
		ProviderID: ProviderCodex, AccountLocalID: "current", Now: at,
	})
	if err != nil || len(got.Limits) != 1 || len(got.Limits[0].Samples) != 1 {
		t.Fatalf("query=%+v err=%v", got, err)
	}
}

func TestHistoryStoreReplacesDuplicateTimestampAndKeepsFlatSamples(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	store := NewHistoryStore(path)
	reset := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	providers := func(remaining float64) []ProviderSnapshot {
		return []ProviderSnapshot{{
			ID: ProviderCodex, Status: ProviderOK,
			Accounts: []Account{{
				LocalID: "current", Status: ProviderOK,
				Limits: []Limit{{
					ID: "week", Label: "Week", RemainingPercent: remaining,
					WindowKind: WindowFixed, WindowDurationMins: 10080, ResetsAt: &reset,
				}},
			}},
		}}
	}
	first := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)
	if err := store.Record(first, providers(82.4)); err != nil {
		t.Fatal(err)
	}
	if err := store.Record(first, providers(81.9)); err != nil {
		t.Fatal(err)
	}
	if err := store.Record(first.Add(10*time.Minute), providers(81.9)); err != nil {
		t.Fatal(err)
	}
	got, err := store.Query(HistoryQuery{
		ProviderID: ProviderCodex, AccountLocalID: "current", Now: first.Add(10 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	samples := got.Limits[0].Samples
	if len(samples) != 2 || samples[0].RemainingPercent != 81.9 || samples[1].RemainingPercent != 81.9 {
		t.Fatalf("samples=%+v", samples)
	}
}

func TestHistoryStoreSkipsFailedRawAccounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	store := NewHistoryStore(path)
	at := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)
	if err := store.Record(at, []ProviderSnapshot{{
		ID: ProviderKimi, Status: ProviderError,
		Accounts: []Account{{
			LocalID: "opencode", Status: ProviderError,
			Limits: []Limit{{ID: "week", RemainingPercent: 66}},
		}},
	}}); err != nil {
		t.Fatal(err)
	}
	got, err := store.Query(HistoryQuery{ProviderID: ProviderKimi, AccountLocalID: "opencode", Now: at})
	if err != nil || len(got.Limits) != 0 {
		t.Fatalf("query=%+v err=%v", got, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("failed sample created history file: %v", err)
	}
}

func TestHistoryStoreQueryReturnsRecentWeekAcrossCurrentWindowStart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	raw := `{"version":1,"series":[{"providerId":"codex","accountLocalId":"current","limitId":"week","limitLabel":"Week","windowKind":"fixed","windowDurationMins":10080,"resetAt":"2026-08-03T00:00:00Z","samples":[[1784851200000,95],[1785110400000,90],[1785283200000,80]]}]}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := NewHistoryStore(path).Query(HistoryQuery{
		ProviderID:     ProviderCodex,
		AccountLocalID: "current",
		Now:            time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Limits) != 1 || len(got.Limits[0].Samples) != 3 {
		t.Fatalf("query=%+v", got)
	}
	if got.Limits[0].Samples[0].ObservedAtMillis != 1784851200000 {
		t.Fatalf("samples=%+v", got.Limits[0].Samples)
	}
}

func TestHistoryStoreDeletesUnsupportedOrCorruptFile(t *testing.T) {
	for _, content := range []string{`{"version":99,"series":[]}`, `{not-json`} {
		t.Run(content, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "usage-history.json")
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			got, err := NewHistoryStore(path).Query(HistoryQuery{
				ProviderID: ProviderCodex, AccountLocalID: "current", Now: time.Now(),
			})
			if err != nil || len(got.Limits) != 0 {
				t.Fatalf("query=%+v err=%v", got, err)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("invalid file was not deleted: %v", err)
			}
		})
	}
}

func TestHistoryStoreRetainsCurrentAndPreviousWindows(t *testing.T) {
	tests := []struct {
		name       string
		windowKind WindowKind
		duration   int64
		reset      time.Time
		samples    []HistorySample
		wantFirst  int64
	}{
		{
			name: "fixed week", windowKind: WindowFixed, duration: 10080,
			reset: time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC),
			samples: []HistorySample{
				{ObservedAtMillis: time.Date(2026, 7, 19, 23, 59, 0, 0, time.UTC).UnixMilli(), RemainingPercent: 100},
				{ObservedAtMillis: time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli(), RemainingPercent: 99},
				{ObservedAtMillis: time.Date(2026, 7, 28, 0, 0, 0, 0, time.UTC).UnixMilli(), RemainingPercent: 80},
			},
			wantFirst: time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC).UnixMilli(),
		},
		{
			name: "calendar month", windowKind: WindowCalendarMonth,
			reset: time.Date(2026, 8, 1, 0, 0, 0, 0, shanghaiLocation),
			samples: []HistorySample{
				{ObservedAtMillis: time.Date(2026, 5, 31, 23, 59, 0, 0, shanghaiLocation).UnixMilli(), RemainingPercent: 100},
				{ObservedAtMillis: time.Date(2026, 6, 1, 0, 0, 0, 0, shanghaiLocation).UnixMilli(), RemainingPercent: 99},
				{ObservedAtMillis: time.Date(2026, 7, 28, 0, 0, 0, 0, shanghaiLocation).UnixMilli(), RemainingPercent: 80},
			},
			wantFirst: time.Date(2026, 6, 1, 0, 0, 0, 0, shanghaiLocation).UnixMilli(),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "usage-history.json")
			fixture := historyFile{Version: historyFileVersion, Series: []historySeries{{
				ProviderID: ProviderCodex, AccountLocalID: "current", LimitID: "limit",
				LimitLabel: "Limit", WindowKind: test.windowKind,
				WindowDurationMins: test.duration, ResetAt: &test.reset, Samples: test.samples,
			}}}
			raw, err := json.Marshal(fixture)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			store := NewHistoryStore(path)
			if err := store.Record(test.reset.Add(-time.Hour), []ProviderSnapshot{{
				ID: ProviderCodex, Status: ProviderOK,
				Accounts: []Account{{
					LocalID: "current", Status: ProviderOK,
					Limits: []Limit{{
						ID: "limit", Label: "Limit", RemainingPercent: 70,
						WindowKind: test.windowKind, WindowDurationMins: test.duration, ResetsAt: &test.reset,
					}},
				}},
			}}); err != nil {
				t.Fatal(err)
			}
			persisted, err := store.loadLocked()
			if err != nil {
				t.Fatal(err)
			}
			if got := persisted.Series[0].Samples[0].ObservedAtMillis; got != test.wantFirst {
				t.Fatalf("first sample=%d want=%d samples=%+v", got, test.wantFirst, persisted.Series[0].Samples)
			}
		})
	}
}

func TestHistoryStoreCapsSeriesAtTenThousandPoints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage-history.json")
	reset := time.Date(2026, 8, 1, 0, 0, 0, 0, shanghaiLocation)
	start := time.Date(2026, 7, 20, 0, 0, 0, 0, shanghaiLocation)
	samples := make([]HistorySample, 10_001)
	for index := range samples {
		samples[index] = HistorySample{
			ObservedAtMillis: start.Add(time.Duration(index) * time.Minute).UnixMilli(),
			RemainingPercent: 100 - float64(index%100),
		}
	}
	fixture := historyFile{Version: historyFileVersion, Series: []historySeries{{
		ProviderID: ProviderFlicker, AccountLocalID: "account", LimitID: "month",
		LimitLabel: "Month", WindowKind: WindowCalendarMonth, ResetAt: &reset, Samples: samples,
	}}}
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewHistoryStore(path)
	if err := store.Record(start.Add(10_001*time.Minute), []ProviderSnapshot{{
		ID: ProviderFlicker, Status: ProviderOK,
		Accounts: []Account{{
			LocalID: "account", Status: ProviderOK,
			Limits: []Limit{{
				ID: "month", Label: "Month", RemainingPercent: 50,
				WindowKind: WindowCalendarMonth, ResetsAt: &reset,
			}},
		}},
	}}); err != nil {
		t.Fatal(err)
	}
	persisted, err := store.loadLocked()
	if err != nil {
		t.Fatal(err)
	}
	got := persisted.Series[0].Samples
	if len(got) != 10_000 || got[0].ObservedAtMillis != samples[2].ObservedAtMillis {
		t.Fatalf("len=%d first=%d wantFirst=%d", len(got), got[0].ObservedAtMillis, samples[2].ObservedAtMillis)
	}
}
