package tools

// dedupCredentialEntry is one discovered credential before dedup.
type dedupCredentialEntry struct {
	Provider string
	Alias    string
	Key      string
	Source   string
}

// dedupCredentialsByHash removes entries that share an identical API key
// (after trim). First occurrence wins. The plaintext key is retained here
// (this stays inside the hub); only sha256 leaves the hub in payloads.
func dedupCredentialsByHash(in []dedupCredentialEntry) []dedupCredentialEntry {
	out := make([]dedupCredentialEntry, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, e := range in {
		fp := sha256Fingerprint(e.Key)
		if _, dup := seen[fp]; dup {
			continue
		}
		seen[fp] = struct{}{}
		out = append(out, e)
	}
	return out
}

// streamingScanner produces one provider's result. The context and config are
// captured in the closure by the caller.
type streamingScanner func() tokenProviderScanResult

// streamDriver runs scanners in parallel and invokes publish for each
// completed provider, in completion order. Results are collected and returned.
type streamDriver struct {
	scanners []streamingScanner
}

func (d *streamDriver) add(sc streamingScanner) { d.scanners = append(d.scanners, sc) }

// run launches all scanners concurrently, collects results in completion order,
// and invokes publish (if non-nil) for each one. Returns all results.
func (d *streamDriver) run(publish func(tokenProviderScanResult)) []tokenProviderScanResult {
	if len(d.scanners) == 0 {
		return nil
	}
	ch := make(chan tokenProviderScanResult, len(d.scanners))
	for _, sc := range d.scanners {
		sc := sc
		go func() { ch <- sc() }()
	}
	results := make([]tokenProviderScanResult, 0, len(d.scanners))
	for range d.scanners {
		r := <-ch
		results = append(results, r)
		if publish != nil {
			publish(r)
		}
	}
	return results
}
