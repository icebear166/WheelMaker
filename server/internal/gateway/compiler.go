package gateway

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

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
	if err := ValidateGlobal(global); err != nil {
		return nil, err
	}
	ordered := append([]SiteConfig(nil), sites...)
	seenHosts := make(map[string]SiteKind, len(ordered))
	for _, site := range ordered {
		if err := ValidateSite(site); err != nil {
			return nil, fmt.Errorf("site %q: %w", site.Kind, err)
		}
		host := strings.ToLower(site.Host())
		if previous, ok := seenHosts[host]; ok {
			return nil, fmt.Errorf("duplicate hostname %q for %q and %q", host, previous, site.Kind)
		}
		seenHosts[host] = site.Kind
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].Host() == ordered[j].Host() {
			return ordered[i].Kind < ordered[j].Kind
		}
		return ordered[i].Host() < ordered[j].Host()
	})

	document := map[string]any{
		"admin": map[string]any{
			"listen": "127.0.0.1:2019",
		},
		"apps": map[string]any{
			"http": compileHTTPApp(global, ordered),
			"tls":  compileTLSApp(global, ordered),
		},
		"logging": map[string]any{
			"logs": map[string]any{
				"default": map[string]any{
					"level": normalizeLogLevel(global.Log.Level),
				},
			},
		},
	}
	if storageRoot != "" {
		document["storage"] = map[string]any{
			"module": "file_system",
			"root":   storageRoot,
		}
	}
	return json.MarshalIndent(document, "", "  ")
}

func compileHTTPApp(global GlobalConfig, sites []SiteConfig) map[string]any {
	httpsRoutes := make([]any, 0, len(sites))
	httpRoutes := make([]any, 0, len(sites))
	registry := (*SiteConfig)(nil)
	for _, site := range sites {
		if site.Kind == SiteRegistry && registry == nil {
			copy := site
			registry = &copy
		}
		httpsRoute := hostRoute(site, siteRoutes(site))
		if site.HTTPS() {
			httpsRoutes = append(httpsRoutes, httpsRoute)
			httpRoutes = append(httpRoutes, hostRoute(site, []any{map[string]any{
				"handle": []any{httpsRedirectHandler(site)},
			}}))
		} else {
			httpRoutes = append(httpRoutes, httpsRoute)
		}
	}
	servers := map[string]any{}
	if len(httpRoutes) > 0 {
		servers["http"] = map[string]any{
			"listen": []string{":80"},
			"routes": httpRoutes,
		}
	}
	if len(httpsRoutes) > 0 {
		httpsServer := map[string]any{
			"listen": []string{":443"},
			"routes": httpsRoutes,
		}
		policies := tlsConnectionPolicies(sites)
		if len(policies) > 0 {
			httpsServer["tls_connection_policies"] = policies
		}
		servers["https"] = httpsServer
	}
	if global.Relay.ListenPort > 0 && registry != nil {
		relayServer := map[string]any{
			"listen": []string{fmt.Sprintf(":%d", global.Relay.ListenPort)},
			"routes": []any{hostRoute(*registry, []any{
				map[string]any{
					"handle": []any{
						relayDeleteMarkerHandler(),
						relaySetHeadersHandler(),
						relayReverseProxyHandler(registry.UpstreamAddress()),
					},
				},
			})},
		}
		if registry.HTTPS() {
			relayServer["tls_connection_policies"] = tlsConnectionPolicies([]SiteConfig{*registry})
		} else {
			relayServer["automatic_https"] = map[string]any{
				"disable": true,
			}
		}
		servers["relay"] = relayServer
	}
	return map[string]any{"servers": servers}
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

func compileTLSApp(global GlobalConfig, sites []SiteConfig) map[string]any {
	policies := make([]any, 0)
	loadFiles := make([]any, 0)
	for _, site := range sites {
		if !site.HTTPS() {
			continue
		}
		if site.TLS.CertificateFile != "" {
			loadFiles = append(loadFiles, map[string]any{
				"certificate": []string{site.TLS.CertificateFile},
				"key":         site.TLS.KeyFile,
			})
			continue
		}
		issuer := map[string]any{"module": "acme"}
		if global.ACME.Email != "" {
			issuer["email"] = global.ACME.Email
		}
		policies = append(policies, map[string]any{
			"subjects": []string{site.Host()},
			"issuers":  []any{issuer},
		})
	}
	certificates := map[string]any{}
	if len(loadFiles) > 0 {
		certificates["load_files"] = loadFiles
	}
	automation := map[string]any{}
	if len(policies) > 0 {
		automation["policies"] = policies
	}
	tls := map[string]any{}
	if len(certificates) > 0 {
		tls["certificates"] = certificates
	}
	if len(automation) > 0 {
		tls["automation"] = automation
	}
	return tls
}

func hostRoute(site SiteConfig, routes []any) map[string]any {
	return map[string]any{
		"match": []any{map[string]any{"host": []string{site.Host()}}},
		"handle": []any{map[string]any{
			"handler": "subroute",
			"routes":  routes,
		}},
		"terminal": true,
	}
}

func siteRoutes(site SiteConfig) []any {
	if site.Kind == SiteRelease {
		return releaseServerRoutes(site)
	}
	if site.Kind == SiteShare {
		return shareRoutes(site)
	}
	return registryRoutes(site)
}

func shareRoutes(site SiteConfig) []any {
	return []any{
		map[string]any{
			"match": []any{map[string]any{
				"method":      []string{"GET", "HEAD"},
				"path_regexp": map[string]any{"name": "share-token", "pattern": shareTokenRegexp},
			}},
			"handle": []any{
				shareHeadersHandler(),
				fileServerHandler(site.StaticRoot()),
			},
		},
		map[string]any{
			"handle": []any{map[string]any{
				"handler":     "static_response",
				"status_code": 404,
			}},
		},
	}
}

func registryRoutes(site SiteConfig) []any {
	root := site.StaticRoot()
	return []any{
		map[string]any{
			"match":  []any{map[string]any{"path": []string{"/ws*"}}},
			"handle": []any{reverseProxyHandler(site.UpstreamAddress())},
		},
		map[string]any{
			"match": []any{map[string]any{
				"file":        fileMatcher(root),
				"path_regexp": map[string]any{"name": "immutable-assets", "pattern": immutableAssetRegexp},
			}},
			"handle": []any{
				securityHeadersHandler(),
				cacheHeadersHandler(immutableCacheControl),
				encodeHandler(),
				fileServerHandler(root),
			},
		},
		map[string]any{
			"match": []any{map[string]any{"file": fileMatcher(root)}},
			"handle": []any{
				securityHeadersHandler(),
				cacheHeadersHandler(noCacheControl),
				encodeHandler(),
				fileServerHandler(root),
			},
		},
		map[string]any{
			"handle": []any{
				securityHeadersHandler(),
				cacheHeadersHandler(noCacheControl),
				encodeHandler(),
				map[string]any{"handler": "rewrite", "uri": "/index.html"},
				fileServerHandler(root),
			},
		},
	}
}

func releaseServerRoutes(site SiteConfig) []any {
	return []any{
		map[string]any{
			"handle": []any{encodeHandler(), reverseProxyHandler(site.UpstreamAddress())},
		},
	}
}

func fileMatcher(root string) map[string]any {
	return map[string]any{
		"root":      root,
		"try_files": []string{"{http.request.uri.path}"},
	}
}

func reverseProxyHandler(upstream string) map[string]any {
	return map[string]any{
		"handler": "reverse_proxy",
		"upstreams": []any{map[string]any{
			"dial": upstream,
		}},
		"headers": map[string]any{
			"request": map[string]any{
				"set": map[string]any{
					"X-Forwarded-Proto": []string{"{http.request.scheme}"},
				},
			},
		},
	}
}

func relayReverseProxyHandler(upstream string) map[string]any {
	return map[string]any{
		"handler": "reverse_proxy",
		"upstreams": []any{map[string]any{
			"dial": upstream,
		}},
	}
}

func relayDeleteMarkerHandler() map[string]any {
	return map[string]any{
		"handler": "headers",
		"request": map[string]any{
			"delete": []string{"X-WheelMaker-Relay"},
		},
	}
}

func relaySetHeadersHandler() map[string]any {
	return map[string]any{
		"handler": "headers",
		"request": map[string]any{
			"set": map[string]any{
				"X-WheelMaker-Relay": []string{"1"},
				"X-Forwarded-Proto":  []string{"{http.request.scheme}"},
			},
		},
	}
}

func fileServerHandler(root string) map[string]any {
	return map[string]any{
		"handler": "file_server",
		"root":    root,
	}
}

func encodeHandler() map[string]any {
	return map[string]any{
		"handler": "encode",
		"encodings": map[string]any{
			"gzip": map[string]any{},
			"zstd": map[string]any{},
		},
		"prefer":         []string{"zstd", "gzip"},
		"minimum_length": 512,
	}
}

func cacheHeadersHandler(value string) map[string]any {
	return map[string]any{
		"handler": "headers",
		"response": map[string]any{
			"set": map[string]any{
				"Cache-Control": []string{value},
			},
		},
	}
}

func securityHeadersHandler() map[string]any {
	return map[string]any{
		"handler": "headers",
		"response": map[string]any{
			"set": map[string]any{
				"X-Content-Type-Options": []string{"nosniff"},
				"Referrer-Policy":        []string{"no-referrer"},
			},
		},
	}
}

func shareHeadersHandler() map[string]any {
	return map[string]any{
		"handler": "headers",
		"response": map[string]any{
			"set": map[string]any{
				"Content-Type":           []string{"text/html; charset=utf-8"},
				"Content-Disposition":    []string{"inline"},
				"Cache-Control":          []string{"no-store"},
				"X-Robots-Tag":           []string{"noindex, nofollow, noarchive"},
				"Referrer-Policy":        []string{"no-referrer"},
				"X-Content-Type-Options": []string{"nosniff"},
			},
		},
	}
}

func httpsRedirectHandler(site SiteConfig) map[string]any {
	return map[string]any{
		"handler":     "static_response",
		"status_code": 308,
		"headers": map[string]any{
			"Location": []string{strings.TrimSuffix(site.PublicURL, "/") + "{http.request.uri}"},
		},
	}
}

func normalizeLogLevel(level string) string {
	return strings.ToUpper(level)
}
