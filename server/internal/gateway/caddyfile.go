package gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/caddyserver/caddy/v2/caddyconfig"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
)

const syntheticCaddyfileName = "WheelMaker.Gateway.Caddyfile"

type adaptedCandidate struct {
	JSON         []byte
	Source       []byte
	Warnings     []caddyconfig.Warning
	Dependencies []string
}

func compileCaddyfileCandidate(global GlobalConfig, sites []SiteConfig, storageRoot, customRoot string) (adaptedCandidate, error) {
	ordered, err := validatedSites(global, sites)
	if err != nil {
		return adaptedCandidate{}, err
	}
	entrypoints, dependencies, err := customCaddySources(customRoot)
	if err != nil {
		return adaptedCandidate{}, err
	}

	var source bytes.Buffer
	renderManagedGlobalOptions(&source, global, storageRoot)
	for _, site := range ordered {
		renderManagedSite(&source, global, site)
	}
	renderManagedRelay(&source, global, ordered)
	for _, path := range entrypoints {
		fmt.Fprintf(&source, "import %s\n", caddyfileQuote(filepath.ToSlash(path)))
	}

	formatted := caddyfile.Format(source.Bytes())
	importedDependencies, err := validateCustomCaddyBoundaries(formatted, customRoot, global, ordered)
	if err != nil {
		return adaptedCandidate{}, err
	}
	dependencies = mergeSortedPaths(dependencies, importedDependencies)
	adapter := caddyconfig.GetAdapter("caddyfile")
	if adapter == nil {
		return adaptedCandidate{}, fmt.Errorf("embedded Caddyfile adapter is unavailable")
	}
	configJSON, warnings, err := adapter.Adapt(formatted, map[string]any{"filename": syntheticCaddyfileName})
	if err != nil {
		return adaptedCandidate{}, fmt.Errorf("adapt Caddyfile: %w", err)
	}
	formattingWarnings, err := customFormattingWarnings(dependencies)
	if err != nil {
		return adaptedCandidate{}, err
	}
	warnings = append(warnings, formattingWarnings...)
	configJSON, err = canonicalizeManagedServers(configJSON, global, ordered)
	if err != nil {
		return adaptedCandidate{}, err
	}
	if err := validateManagedJSONBoundaries(configJSON, global, ordered, storageRoot); err != nil {
		return adaptedCandidate{}, err
	}
	if err := ValidateJSON(configJSON); err != nil {
		return adaptedCandidate{}, err
	}
	return adaptedCandidate{
		JSON:         configJSON,
		Source:       formatted,
		Warnings:     warnings,
		Dependencies: dependencies,
	}, nil
}

func customFormattingWarnings(dependencies []string) ([]caddyconfig.Warning, error) {
	warnings := make([]caddyconfig.Warning, 0)
	for _, path := range dependencies {
		contents, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("inspect custom Caddy source formatting %s: %w", path, err)
		}
		if warning, different := caddyfile.FormattingDifference(path, contents); different {
			warnings = append(warnings, warning)
		}
	}
	return warnings, nil
}

func validateManagedJSONBoundaries(configJSON []byte, global GlobalConfig, sites []SiteConfig, storageRoot string) error {
	var document map[string]any
	if err := json.Unmarshal(configJSON, &document); err != nil {
		return fmt.Errorf("decode adapted Caddy config: %w", err)
	}
	admin, _ := document["admin"].(map[string]any)
	if admin["listen"] != "127.0.0.1:2019" {
		return fmt.Errorf("adapted Caddy config changed Gateway-owned admin listener")
	}
	if normalizeLogLevel(global.Log.Level) != nestedString(document, "logging", "logs", "default", "level") {
		return fmt.Errorf("adapted Caddy config changed Gateway-owned default log level")
	}
	if storageRoot != "" {
		storage, _ := document["storage"].(map[string]any)
		if storage["module"] != "file_system" || filepath.Clean(nestedString(document, "storage", "root")) != filepath.Clean(storageRoot) {
			return fmt.Errorf("adapted Caddy config changed Gateway-owned storage root")
		}
	}

	servers, _ := deepMap(document, "apps", "http", "servers")
	listeners := make(map[string]bool)
	for _, raw := range servers {
		server, _ := raw.(map[string]any)
		for _, address := range stringSlice(server["listen"]) {
			listeners[address] = true
		}
	}
	wantHTTP := false
	wantHTTPS := false
	for _, site := range sites {
		if site.HTTPS() {
			wantHTTPS = true
			wantHTTP = true
		} else {
			wantHTTP = true
		}
	}
	if wantHTTP && !listeners[":80"] {
		return fmt.Errorf("adapted Caddy config removed Gateway-owned HTTP listener :80")
	}
	if wantHTTPS && !listeners[":443"] {
		return fmt.Errorf("adapted Caddy config removed Gateway-owned HTTPS listener :443")
	}
	if global.Relay.ListenPort > 0 && hasSiteKind(sites, SiteRegistry) && !listeners[fmt.Sprintf(":%d", global.Relay.ListenPort)] {
		return fmt.Errorf("adapted Caddy config removed Gateway-owned Relay listener :%d", global.Relay.ListenPort)
	}
	return nil
}

func nestedString(document map[string]any, path ...string) string {
	var current any = document
	for _, part := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = object[part]
	}
	result, _ := current.(string)
	return result
}

func stringSlice(value any) []string {
	items, _ := value.([]any)
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func hasSiteKind(sites []SiteConfig, kind SiteKind) bool {
	for _, site := range sites {
		if site.Kind == kind {
			return true
		}
	}
	return false
}

func validateCustomCaddyBoundaries(source []byte, customRoot string, global GlobalConfig, sites []SiteConfig) ([]string, error) {
	if customRoot == "" {
		return nil, nil
	}
	blocks, err := caddyfile.Parse(syntheticCaddyfileName, source)
	if err != nil {
		return nil, fmt.Errorf("parse Caddyfile: %w", err)
	}
	dependencySet := make(map[string]struct{})
	managedHosts := make(map[string]SiteKind, len(sites))
	for _, site := range sites {
		managedHosts[strings.ToLower(site.Host())] = site.Kind
	}
	reservedPorts := map[string]string{
		"2019": "Gateway admin",
		"9630": "WheelMaker Registry",
		"9680": "WheelMaker Release",
	}
	if global.Relay.ListenPort > 0 {
		reservedPorts[strconv.Itoa(global.Relay.ListenPort)] = "WheelMaker Relay"
	}

	for _, block := range blocks {
		for _, token := range blockTokens(block) {
			if token.File == syntheticCaddyfileName {
				continue
			}
			inside, err := pathWithinRoot(token.File, customRoot)
			if err != nil {
				return nil, sourceTokenError(token, "resolve imported Caddy source: %v", err)
			}
			if !inside {
				return nil, sourceTokenError(token, "imported Caddy source %q resolves outside custom sites root %q", token.File, customRoot)
			}
			absolute, err := filepath.Abs(token.File)
			if err != nil {
				return nil, sourceTokenError(token, "resolve imported Caddy source: %v", err)
			}
			dependencySet[filepath.Clean(absolute)] = struct{}{}
		}

		if len(block.Keys) == 0 {
			if token, ok := firstCustomToken(block, customRoot); ok {
				return nil, sourceTokenError(token, "custom global options are not allowed; Gateway owns global Caddy configuration")
			}
			continue
		}
		for _, key := range block.Keys {
			inside, err := pathWithinRoot(key.File, customRoot)
			if err != nil || !inside {
				continue
			}
			if strings.HasPrefix(key.Text, "(") || strings.HasPrefix(key.Text, "&(") {
				continue
			}
			address, err := httpcaddyfile.ParseAddress(key.Text)
			if err != nil {
				return nil, sourceTokenError(key, "parse custom site address %q: %v", key.Text, err)
			}
			address = address.Normalize()
			if owner, exists := managedHosts[strings.ToLower(address.Host)]; exists {
				return nil, sourceTokenError(key, "custom hostname %q conflicts with WheelMaker-managed %s hostname %q", address.Host, owner, address.Host)
			}
			port := effectiveCaddyPort(address)
			if address.Host == "" && (port == "80" || port == "443") {
				return nil, sourceTokenError(key, "custom catch-all listener :%s overlaps the WheelMaker-managed public listener", port)
			}
			if owner, reserved := reservedPorts[port]; reserved {
				return nil, sourceTokenError(key, "custom listener port %s is reserved by %s", port, owner)
			}
		}
	}
	dependencies := make([]string, 0, len(dependencySet))
	for path := range dependencySet {
		dependencies = append(dependencies, path)
	}
	sort.Strings(dependencies)
	return dependencies, nil
}

func mergeSortedPaths(groups ...[]string) []string {
	unique := make(map[string]struct{})
	for _, group := range groups {
		for _, path := range group {
			unique[filepath.Clean(path)] = struct{}{}
		}
	}
	result := make([]string, 0, len(unique))
	for path := range unique {
		result = append(result, path)
	}
	sort.Strings(result)
	return result
}

func blockTokens(block caddyfile.ServerBlock) []caddyfile.Token {
	result := append([]caddyfile.Token(nil), block.Keys...)
	for _, segment := range block.Segments {
		result = append(result, segment...)
	}
	return result
}

func firstCustomToken(block caddyfile.ServerBlock, customRoot string) (caddyfile.Token, bool) {
	for _, token := range blockTokens(block) {
		inside, err := pathWithinRoot(token.File, customRoot)
		if err == nil && inside {
			return token, true
		}
	}
	return caddyfile.Token{}, false
}

func pathWithinRoot(path, root string) (bool, error) {
	if path == "" || path == syntheticCaddyfileName || root == "" {
		return false, nil
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return false, err
	}
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return false, err
	}
	resolvedRoot, err := filepath.EvalSymlinks(absoluteRoot)
	if err != nil {
		return false, err
	}
	resolvedPath, err := filepath.EvalSymlinks(absolutePath)
	if err != nil {
		return false, err
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedPath)
	if err != nil {
		return false, err
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative), nil
}

func effectiveCaddyPort(address httpcaddyfile.Address) string {
	if address.Port != "" {
		return address.Port
	}
	if address.Scheme == "http" {
		return "80"
	}
	return "443"
}

func sourceTokenError(token caddyfile.Token, format string, args ...any) error {
	return fmt.Errorf("%s:%d: %s", token.File, token.Line, fmt.Sprintf(format, args...))
}

func validatedSites(global GlobalConfig, sites []SiteConfig) ([]SiteConfig, error) {
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
		left := strings.ToLower(ordered[i].Host())
		right := strings.ToLower(ordered[j].Host())
		if left == right {
			return ordered[i].Kind < ordered[j].Kind
		}
		return left < right
	})
	return ordered, nil
}

func customCaddySources(root string) ([]string, []string, error) {
	if root == "" {
		return nil, nil, nil
	}
	info, err := os.Stat(root)
	if os.IsNotExist(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("inspect custom Caddy sites %s: %w", root, err)
	}
	if !info.IsDir() {
		return nil, nil, fmt.Errorf("custom Caddy sites root %s is not a directory", root)
	}

	var entrypoints []string
	var dependencies []string
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".caddy") {
			return nil
		}
		absolute, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		dependencies = append(dependencies, filepath.Clean(absolute))
		if filepath.Clean(filepath.Dir(path)) == filepath.Clean(root) {
			entrypoints = append(entrypoints, filepath.Clean(absolute))
		}
		return nil
	})
	if err != nil {
		return nil, nil, fmt.Errorf("enumerate custom Caddy sites %s: %w", root, err)
	}
	sort.Strings(entrypoints)
	sort.Strings(dependencies)
	return entrypoints, dependencies, nil
}

func renderManagedGlobalOptions(target *bytes.Buffer, global GlobalConfig, storageRoot string) {
	target.WriteString("{\n")
	target.WriteString("\tadmin 127.0.0.1:2019\n")
	if storageRoot != "" {
		target.WriteString("\tstorage file_system {\n")
		fmt.Fprintf(target, "\t\troot %s\n", caddyfileQuote(filepath.ToSlash(storageRoot)))
		target.WriteString("\t}\n")
	}
	target.WriteString("\tlog default {\n")
	fmt.Fprintf(target, "\t\tlevel %s\n", normalizeLogLevel(global.Log.Level))
	target.WriteString("\t}\n")
	target.WriteString("}\n\n")
}

func renderManagedSite(target *bytes.Buffer, global GlobalConfig, site SiteConfig) {
	fmt.Fprintf(target, "%s {\n", managedAddress(site, 0))
	renderManagedTLS(target, global, site)
	switch site.Kind {
	case SiteRelease:
		renderReleaseSite(target, site)
	case SiteShare:
		renderShareSite(target, site)
	default:
		renderRegistrySite(target, site)
	}
	target.WriteString("}\n\n")

	if site.HTTPS() {
		fmt.Fprintf(target, "http://%s {\n", caddyHost(site.Host()))
		fmt.Fprintf(target, "\tredir %s 308\n", caddyfileQuote(strings.TrimSuffix(site.PublicURL, "/")+"{uri}"))
		target.WriteString("}\n\n")
	}
}

func renderManagedTLS(target *bytes.Buffer, global GlobalConfig, site SiteConfig) {
	if !site.HTTPS() {
		return
	}
	if site.TLS.CertificateFile != "" {
		fmt.Fprintf(target, "\ttls %s %s\n", caddyfileQuote(filepath.ToSlash(site.TLS.CertificateFile)), caddyfileQuote(filepath.ToSlash(site.TLS.KeyFile)))
		return
	}
	if global.ACME.Email != "" {
		target.WriteString("\ttls {\n")
		target.WriteString("\t\tissuer acme {\n")
		fmt.Fprintf(target, "\t\t\temail %s\n", caddyfileQuote(global.ACME.Email))
		target.WriteString("\t\t}\n")
		target.WriteString("\t}\n")
	}
}

func renderRegistrySite(target *bytes.Buffer, site SiteConfig) {
	fmt.Fprintf(target, "\troot * %s\n", caddyfileQuote(filepath.ToSlash(site.StaticRoot())))
	target.WriteString("\troute {\n")
	target.WriteString("\t\t@wm_ws path /ws*\n")
	target.WriteString("\t\thandle @wm_ws {\n")
	fmt.Fprintf(target, "\t\t\treverse_proxy %s\n", site.UpstreamAddress())
	target.WriteString("\t\t}\n")
	target.WriteString("\t\t@wm_immutable {\n")
	fmt.Fprintf(target, "\t\t\tpath_regexp wm_immutable %s\n", immutableAssetRegexp)
	target.WriteString("\t\t\tfile {\n")
	target.WriteString("\t\t\t\ttry_files {path}\n")
	target.WriteString("\t\t\t}\n")
	target.WriteString("\t\t}\n")
	target.WriteString("\t\thandle @wm_immutable {\n")
	renderRegistryHeaders(target, immutableCacheControl, 3)
	renderEncode(target, 3)
	target.WriteString("\t\t\tfile_server\n")
	target.WriteString("\t\t}\n")
	target.WriteString("\t\t@wm_existing file {\n")
	target.WriteString("\t\t\ttry_files {path}\n")
	target.WriteString("\t\t}\n")
	target.WriteString("\t\thandle @wm_existing {\n")
	renderRegistryHeaders(target, noCacheControl, 3)
	renderEncode(target, 3)
	target.WriteString("\t\t\tfile_server\n")
	target.WriteString("\t\t}\n")
	target.WriteString("\t\thandle {\n")
	renderRegistryHeaders(target, noCacheControl, 3)
	renderEncode(target, 3)
	target.WriteString("\t\t\trewrite * /index.html\n")
	target.WriteString("\t\t\tfile_server\n")
	target.WriteString("\t\t}\n")
	target.WriteString("\t}\n")
}

func renderRegistryHeaders(target *bytes.Buffer, cacheControl string, indent int) {
	prefix := strings.Repeat("\t", indent)
	fmt.Fprintf(target, "%sheader {\n", prefix)
	fmt.Fprintf(target, "%s\tX-Content-Type-Options nosniff\n", prefix)
	fmt.Fprintf(target, "%s\tReferrer-Policy no-referrer\n", prefix)
	fmt.Fprintf(target, "%s\tCache-Control %s\n", prefix, caddyfileQuote(cacheControl))
	fmt.Fprintf(target, "%s}\n", prefix)
}

func renderEncode(target *bytes.Buffer, indent int) {
	prefix := strings.Repeat("\t", indent)
	fmt.Fprintf(target, "%sencode zstd gzip {\n", prefix)
	fmt.Fprintf(target, "%s\tminimum_length 512\n", prefix)
	fmt.Fprintf(target, "%s}\n", prefix)
}

func renderReleaseSite(target *bytes.Buffer, site SiteConfig) {
	target.WriteString("\troute {\n")
	renderEncode(target, 2)
	fmt.Fprintf(target, "\t\treverse_proxy %s\n", site.UpstreamAddress())
	target.WriteString("\t}\n")
}

func renderShareSite(target *bytes.Buffer, site SiteConfig) {
	target.WriteString("\troute {\n")
	target.WriteString("\t\t@wm_share {\n")
	target.WriteString("\t\t\tmethod GET HEAD\n")
	fmt.Fprintf(target, "\t\t\tpath_regexp wm_share %s\n", shareTokenRegexp)
	target.WriteString("\t\t}\n")
	target.WriteString("\t\thandle @wm_share {\n")
	target.WriteString("\t\t\theader {\n")
	target.WriteString("\t\t\t\tContent-Type \"text/html; charset=utf-8\"\n")
	target.WriteString("\t\t\t\tContent-Disposition inline\n")
	target.WriteString("\t\t\t\tCache-Control no-store\n")
	target.WriteString("\t\t\t\tX-Robots-Tag \"noindex, nofollow, noarchive\"\n")
	target.WriteString("\t\t\t\tReferrer-Policy no-referrer\n")
	target.WriteString("\t\t\t\tX-Content-Type-Options nosniff\n")
	target.WriteString("\t\t\t}\n")
	fmt.Fprintf(target, "\t\t\troot * %s\n", caddyfileQuote(filepath.ToSlash(site.StaticRoot())))
	target.WriteString("\t\t\tfile_server\n")
	target.WriteString("\t\t}\n")
	target.WriteString("\t\trespond 404\n")
	target.WriteString("\t}\n")
}

func renderManagedRelay(target *bytes.Buffer, global GlobalConfig, sites []SiteConfig) {
	if global.Relay.ListenPort == 0 {
		return
	}
	for _, site := range sites {
		if site.Kind != SiteRegistry {
			continue
		}
		fmt.Fprintf(target, "%s {\n", managedAddress(site, global.Relay.ListenPort))
		renderManagedTLS(target, global, site)
		target.WriteString("\troute {\n")
		target.WriteString("\t\trequest_header -X-WheelMaker-Relay\n")
		target.WriteString("\t\trequest_header X-WheelMaker-Relay 1\n")
		fmt.Fprintf(target, "\t\treverse_proxy %s\n", site.UpstreamAddress())
		target.WriteString("\t}\n")
		target.WriteString("}\n\n")
		return
	}
}

func managedAddress(site SiteConfig, port int) string {
	scheme := "http"
	if site.HTTPS() {
		scheme = "https"
	}
	host := caddyHost(site.Host())
	if port != 0 {
		host = net.JoinHostPort(site.Host(), strconv.Itoa(port))
	}
	return scheme + "://" + host
}

func caddyHost(host string) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return "[" + host + "]"
	}
	return host
}

func caddyfileQuote(value string) string {
	return strconv.Quote(value)
}

func canonicalizeManagedServers(configJSON []byte, global GlobalConfig, sites []SiteConfig) ([]byte, error) {
	var document map[string]any
	if err := json.Unmarshal(configJSON, &document); err != nil {
		return nil, fmt.Errorf("decode adapted Caddy config: %w", err)
	}
	servers, _ := deepMap(document, "apps", "http", "servers")
	if servers == nil {
		return json.MarshalIndent(document, "", "  ")
	}
	for currentName, raw := range servers {
		server, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		listen, _ := server["listen"].([]any)
		if len(listen) != 1 {
			continue
		}
		address, _ := listen[0].(string)
		name := ""
		switch address {
		case ":80":
			name = "http"
		case ":443":
			name = "https"
		case fmt.Sprintf(":%d", global.Relay.ListenPort):
			if global.Relay.ListenPort > 0 {
				name = "relay"
			}
		}
		if name != "" && name != currentName {
			if _, exists := servers[name]; !exists {
				servers[name] = raw
				delete(servers, currentName)
			}
		}
	}
	ensureManagedTLSPolicies(servers, sites, global.Relay.ListenPort)
	return json.MarshalIndent(document, "", "  ")
}

func ensureManagedTLSPolicies(servers map[string]any, sites []SiteConfig, relayPort int) {
	if server, ok := servers["https"].(map[string]any); ok {
		server["tls_connection_policies"] = tlsConnectionPolicies(sites)
	}
	if relayPort == 0 {
		return
	}
	for _, site := range sites {
		if site.Kind == SiteRegistry && site.HTTPS() {
			if server, ok := servers["relay"].(map[string]any); ok {
				server["tls_connection_policies"] = tlsConnectionPolicies([]SiteConfig{site})
			}
			return
		}
	}
}

func deepMap(document map[string]any, path ...string) (map[string]any, bool) {
	var current any = document
	for _, part := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = object[part]
		if !ok {
			return nil, false
		}
	}
	result, ok := current.(map[string]any)
	return result, ok
}
