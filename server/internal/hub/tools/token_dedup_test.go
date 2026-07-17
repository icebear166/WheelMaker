package tools

import (
	"testing"
)

func TestDedupCredentialsByKey(t *testing.T) {
	in := []dedupCredentialEntry{
		{Provider: "kimi", Alias: "a", Key: "key-1", Source: "s1"},
		{Provider: "kimi", Alias: "b", Key: "key-1", Source: "s2"}, // dup
		{Provider: "zai", Alias: "c", Key: "key-2", Source: "s3"},
	}
	got := dedupCredentialsByHash(in)
	if len(got) != 2 {
		t.Fatalf("got %d entries, want 2 (key-1 deduped)", len(got))
	}
	seen := map[string]bool{}
	for _, e := range got {
		seen[e.Key] = true
	}
	if !seen["key-1"] || !seen["key-2"] {
		t.Errorf("missing keys after dedup: %+v", seen)
	}
}

func TestStreamDriverRunsScannersAndPublishes(t *testing.T) {
	driver := &streamDriver{}
	driver.add(func() tokenProviderScanResult {
		return tokenProviderScanResult{ID: "codex", Name: "Codex"}
	})
	driver.add(func() tokenProviderScanResult {
		return tokenProviderScanResult{ID: "kimi", Name: "Kimi"}
	})
	var published []string
	results := driver.run(func(r tokenProviderScanResult) {
		published = append(published, r.ID)
	})
	if len(results) != 2 {
		t.Fatalf("results=%d, want 2", len(results))
	}
	if len(published) != 2 {
		t.Fatalf("published=%d, want 2", len(published))
	}
	providerSeen := map[string]bool{}
	for _, id := range published {
		providerSeen[id] = true
	}
	if !providerSeen["codex"] || !providerSeen["kimi"] {
		t.Errorf("missing providers: %+v", providerSeen)
	}
}
