package usage

import (
	"context"
	"sort"
	"sync"
)

type ProviderScanner interface {
	Scan(context.Context) ProviderSnapshot
}

type ScannerFunc func(context.Context) ProviderSnapshot

func (fn ScannerFunc) Scan(ctx context.Context) ProviderSnapshot { return fn(ctx) }

type Collector struct {
	Scanners []ProviderScanner
}

func (c Collector) Scan(ctx context.Context) []ProviderSnapshot {
	results := make([]ProviderSnapshot, len(c.Scanners))
	var wg sync.WaitGroup
	for index, scanner := range c.Scanners {
		wg.Add(1)
		go func(index int, scanner ProviderScanner) {
			defer wg.Done()
			if scanner == nil {
				return
			}
			results[index] = scanner.Scan(ctx)
		}(index, scanner)
	}
	wg.Wait()
	sort.SliceStable(results, func(left, right int) bool {
		return providerOrder(results[left].ID) < providerOrder(results[right].ID)
	})
	return results
}

func providerOrder(id ProviderID) int {
	switch id {
	case ProviderCodex:
		return 0
	case ProviderKimi:
		return 1
	case ProviderZAI:
		return 2
	case ProviderDeepSeek:
		return 3
	default:
		return 4
	}
}
