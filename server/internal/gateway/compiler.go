package gateway

import "strings"

const (
	immutableCacheControl = "public, max-age=31536000, immutable"
	noCacheControl        = "no-cache"
	immutableAssetRegexp  = `^/.+\.[0-9a-fA-F]{8,}\.(js|css|woff2?|ttf|eot|svg|ico|png|jpe?g|gif|webp|avif|wasm)$`
	shareTokenRegexp      = `^/s/[A-Za-z0-9_-]{43}$`
)

func CompileConfig(global GlobalConfig, sites []SiteConfig) ([]byte, error) {
	return CompileConfigAt(global, sites, "")
}

func CompileConfigAt(global GlobalConfig, sites []SiteConfig, storageRoot string) ([]byte, error) {
	candidate, err := compileCaddyfileCandidate(global, sites, storageRoot, "")
	if err != nil {
		return nil, err
	}
	return candidate.JSON, nil
}

func tlsConnectionPolicies(sites []SiteConfig) []any {
	policies := make([]any, 0, len(sites))
	for _, site := range sites {
		if site.HTTPS() {
			policies = append(policies, map[string]any{
				"match": map[string]any{
					"sni": []string{site.Host()},
				},
			})
		}
	}
	return policies
}

func normalizeLogLevel(level string) string {
	return strings.ToUpper(level)
}
