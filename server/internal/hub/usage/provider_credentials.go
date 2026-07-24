package usage

import "strings"

type ProviderCredentialSource struct {
	LocalID    string
	Label      string
	Credential string
}

func uniqueCredentialSources(sources []ProviderCredentialSource) []ProviderCredentialSource {
	unique := make([]ProviderCredentialSource, 0, len(sources))
	seen := make(map[string]struct{}, len(sources))
	for _, source := range sources {
		source.Credential = strings.TrimSpace(source.Credential)
		if source.Credential == "" {
			continue
		}
		if _, exists := seen[source.Credential]; exists {
			continue
		}
		seen[source.Credential] = struct{}{}
		unique = append(unique, source)
	}
	return unique
}
