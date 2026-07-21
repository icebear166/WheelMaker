package usage

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestCollectorReturnsStableProviderOrder(t *testing.T) {
	collector := Collector{Scanners: []ProviderScanner{
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderZAI} }),
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderFlicker} }),
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderCodex} }),
	}}
	got := collector.Scan(context.Background())
	if got[0].ID != ProviderCodex || got[1].ID != ProviderFlicker || got[2].ID != ProviderZAI {
		t.Fatalf("provider order=%v", []ProviderID{got[0].ID, got[1].ID, got[2].ID})
	}
}

func TestLimitKeepsFullUTCTimestamp(t *testing.T) {
	reset := time.Date(2027, 1, 1, 0, 5, 0, 0, time.UTC)
	limit := Limit{ID: "5h", RemainingPercent: 77, ResetsAt: &reset}
	raw, err := json.Marshal(limit)
	if err != nil || !bytes.Contains(raw, []byte("2027-01-01T00:05:00Z")) {
		t.Fatalf("limit json=%s err=%v", raw, err)
	}
}
