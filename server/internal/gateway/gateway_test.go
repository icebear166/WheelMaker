package gateway

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvePathsUsesFixedGatewayHomeLayout(t *testing.T) {
	paths := ResolvePaths(`C:\Users\alice\.wheelmaker\gateway`)

	if paths.Home != `C:\Users\alice\.wheelmaker\gateway` {
		t.Fatalf("Home = %q", paths.Home)
	}
	if paths.ConfigFile != `C:\Users\alice\.wheelmaker\gateway\config.json` {
		t.Fatalf("ConfigFile = %q", paths.ConfigFile)
	}
	if paths.HubConfigFile != `C:\Users\alice\.wheelmaker\config.json` {
		t.Fatalf("HubConfigFile = %q", paths.HubConfigFile)
	}
	if paths.RegistryWebRoot != `C:\Users\alice\.wheelmaker\web` {
		t.Fatalf("RegistryWebRoot = %q", paths.RegistryWebRoot)
	}
	if paths.ReleaseDataRoot != `C:\Users\alice\.wheelmaker\release-server\data` {
		t.Fatalf("ReleaseDataRoot = %q", paths.ReleaseDataRoot)
	}
	if paths.GeneratedConfig != `C:\Users\alice\.wheelmaker\gateway\generated\caddy.json` {
		t.Fatalf("GeneratedConfig = %q", paths.GeneratedConfig)
	}
	if paths.CustomSitesRoot != `C:\Users\alice\.wheelmaker\gateway\sites` {
		t.Fatalf("CustomSitesRoot = %q", paths.CustomSitesRoot)
	}
}

func TestResolvePathsDerivesRuntimeRoots(t *testing.T) {
	paths := ResolvePaths(`C:\Users\alice\.wheelmaker\gateway`)
	if paths.SharePublicRoot != `C:\Users\alice\.wheelmaker\shares\public` {
		t.Fatalf("SharePublicRoot = %q", paths.SharePublicRoot)
	}
}

func TestEnsureHomeCreatesAndPreservesCustomSitesRoot(t *testing.T) {
	home := filepath.Join(t.TempDir(), "gateway")
	paths := ResolvePaths(home)
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(paths.CustomSitesRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Fatalf("CustomSitesRoot is not a directory: %s", paths.CustomSitesRoot)
	}

	sitePath := filepath.Join(paths.CustomSitesRoot, "existing.caddy")
	want := []byte("existing.example.com { respond \"ok\" }\n")
	if err := os.WriteFile(sitePath, want, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(sitePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("existing site bytes = %q, want %q", got, want)
	}
}

func TestValidateSiteRequiresHTTPSCertificatePair(t *testing.T) {
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   "C:\\Users\\alice\\.wheelmaker\\web",
		Upstream:  "http://127.0.0.1:9630",
		TLS:       TLSConfig{CertificateFile: "cert.pem"},
	}

	err := ValidateSite(site)
	if err == nil || !strings.Contains(err.Error(), "certificate") {
		t.Fatalf("ValidateSite error = %v, want certificate pair error", err)
	}
}

func TestValidateSiteAcceptsHTTPSAutomaticCertificate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "web")
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   root,
		Upstream:  "http://127.0.0.1:9630",
	}

	if err := ValidateSite(site); err != nil {
		t.Fatalf("ValidateSite() error = %v", err)
	}
}

func TestValidateSiteRejectsUnsupportedUpstream(t *testing.T) {
	root := filepath.Join(t.TempDir(), "web")
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "http://workspace.example.com",
		WebRoot:   root,
		Upstream:  "https://127.0.0.1:9630",
	}

	err := ValidateSite(site)
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("ValidateSite error = %v, want loopback error", err)
	}
}

func TestCompileConfigIncludesWorkspaceRoutesAndAutomaticTLS(t *testing.T) {
	root := filepath.Join(t.TempDir(), "web")
	global := GlobalConfig{Schema: GlobalSchemaVersion, ACME: ACMEConfig{Email: "ops@example.com"}, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   root,
		Upstream:  "http://127.0.0.1:9630",
	}

	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	if got := deepString(document, "apps", "tls", "automation", "policies", "0", "issuers", "0", "module"); got != "acme" {
		t.Fatalf("TLS issuer module = %q, want acme", got)
	}
	text := string(compiled)
	for _, want := range []string{"workspace.example.com", "127.0.0.1:9630", "file_server", "/ws*", "try_files"} {
		if !strings.Contains(text, want) {
			t.Errorf("compiled config does not contain %q", want)
		}
	}
}

func TestCompileConfigIncludesExactShareStaticRoute(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteShare,
		PublicURL: "https://share.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "shares", "public"),
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatal(err)
	}
	shareRoute := findRouteWithMatchValue(document, shareTokenRegexp)
	if shareRoute == nil || !containsDeepString(shareRoute["match"], "GET") || !containsDeepString(shareRoute["match"], "HEAD") {
		t.Fatalf("share token/method route is missing: %s", compiled)
	}
	if !containsHandler(shareRoute, "file_server") || !containsDeepString(shareRoute, filepath.ToSlash(site.WebRoot)) {
		t.Fatalf("share route does not serve the configured root: %#v", shareRoute)
	}
	fallback := findHandlerWithValue(document, "static_response", float64(404))
	if fallback == nil || fallback["status_code"] != float64(404) {
		t.Fatalf("share fallback = %#v, want status 404", fallback)
	}
	for _, want := range []string{"text/html; charset=utf-8", "inline", "no-store", "noindex, nofollow, noarchive", "no-referrer", "nosniff"} {
		if !strings.Contains(string(compiled), want) {
			t.Errorf("share route missing %q", want)
		}
	}
	if strings.Contains(string(compiled), "content_security_policy") || strings.Contains(string(compiled), "reverse_proxy") {
		t.Fatal("share route must not install CSP or reverse proxy")
	}
}

func TestLoadBundleReadsHubConfigAndIgnoresLegacySiteFiles(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	legacySitePath := filepath.Join(home, "sites", "workspace.json")
	if err := os.MkdirAll(filepath.Dir(legacySitePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{"schema":2,"wm_sites":{"tls":{"certificateFile":"","keyFile":""},"registry":{"urlMode":"sync_hub"},"release":{"publicUrl":""},"share":{"urlMode":"sync_hub"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	workspace := `{"schema":1,"kind":"workspace","publicUrl":"https://workspace.example.com","webRoot":"` + filepath.ToSlash(filepath.Join(root, "web")) + `","upstream":"http://127.0.0.1:9630","tls":{"certificateFile":"","keyFile":""}}`
	if err := os.WriteFile(legacySitePath, []byte(workspace), 0o600); err != nil {
		t.Fatal(err)
	}
	hubConfig := filepath.Join(filepath.Dir(home), "config.json")
	if err := os.WriteFile(hubConfig, []byte(`{"publicUrl":"https://registry.example.com","registry":{"listen":true,"share":{"publicUrl":"https://share.example.com"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 2 || bundle.Sites[0].Kind != SiteRegistry || bundle.Sites[1].Kind != SiteShare {
		t.Fatalf("LoadBundle() sites = %+v, want Hub registry/share sites", bundle.Sites)
	}
}

func TestSemanticFingerprintTracksHubConfig(t *testing.T) {
	paths := ResolvePaths(filepath.Join(t.TempDir(), "gateway"))
	siblingAppConfig := filepath.Join(filepath.Dir(paths.Home), "config.json")
	if err := os.MkdirAll(filepath.Dir(siblingAppConfig), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(siblingAppConfig, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	first := semanticFingerprint(paths)
	if err := os.WriteFile(siblingAppConfig, []byte(`{"share":{"publicUrl":"https://share.example.com"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	second := semanticFingerprint(paths)
	if first == second {
		t.Fatalf("semanticFingerprint did not change for Hub config: %q", first)
	}
}

func TestCompileConfigAddsCompressionAndCacheHeadersToWorkspaceAssets(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	workspace := deepValue(document, "apps", "http", "servers", "https")
	wsRoute := findRouteWithMatchValue(workspace, "/ws*")
	if wsRoute == nil || !containsHandler(wsRoute, "reverse_proxy") {
		t.Fatalf("WebSocket route is missing: %s", compiled)
	}
	if containsHandler(wsRoute, "encode") {
		t.Fatal("WebSocket route must not install the encode handler")
	}
	immutable := findRouteWithMatchValue(workspace, immutableAssetRegexp)
	if immutable == nil {
		t.Fatalf("immutable asset route is missing: %s", compiled)
	}
	if !containsHandler(immutable, "encode") {
		t.Fatal("immutable asset route must install the encode handler")
	}
	encodings, ok := findHandler(immutable, "encode")["encodings"].(map[string]any)
	if !ok || len(encodings) != 2 {
		t.Fatalf("immutable encodings = %#v, want zstd and gzip", encodings)
	}
	for _, name := range []string{"zstd", "gzip"} {
		if _, ok := encodings[name]; !ok {
			t.Errorf("immutable encodings missing %q", name)
		}
	}
	if !containsDeepString(immutable, immutableCacheControl) {
		t.Fatalf("immutable Cache-Control is missing: %#v", immutable)
	}
	if handlerCount(workspace, "encode") < 3 || strings.Count(string(compiled), `"no-cache"`) < 2 {
		t.Fatalf("static and SPA routes must be compressed with no-cache: %s", compiled)
	}
}

func TestCompileConfigAddsCompressionToReleaseServerResponses(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRelease,
		PublicURL: "https://release.example.com",
		Upstream:  "http://127.0.0.1:9680",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	server := deepValue(document, "apps", "http", "servers", "https")
	if !containsHandler(server, "encode") || !containsHandler(server, "reverse_proxy") {
		t.Fatal("release server route must install the encode handler")
	}
}

func TestCompileConfigProducesCaddyValidHTTPSDocument(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, ACME: ACMEConfig{Email: "ops@example.com"}, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRelease,
		PublicURL: "https://release.example.com",
		Upstream:  "http://127.0.0.1:9680",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}
	if strings.Contains(string(compiled), "file_server") || !strings.Contains(string(compiled), "reverse_proxy") {
		t.Fatalf("Release Server route must be proxy-only: %s", compiled)
	}
}

func TestCompileConfigStripsExternalPortFromHostMatchers(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com:8443",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatal(err)
	}
	if got := deepString(document, "apps", "http", "servers", "https", "routes", "0", "match", "0", "host", "0"); got != "workspace.example.com" {
		t.Fatalf("HTTPS host matcher = %q", got)
	}
	if got := deepString(document, "apps", "http", "servers", "http", "routes", "0", "handle", "0", "routes", "0", "handle", "0", "headers", "Location", "0"); got != "https://workspace.example.com:8443{http.request.uri}" {
		t.Fatalf("redirect Location = %q", got)
	}
}

func TestLoadGlobalRejectsSharedRuntimeFields(t *testing.T) {
	for _, input := range []string{
		`{"schema":2,"log":{"level":"INFO"}}`,
		`{"schema":2,"relay":{"listenPort":28810}}`,
		`{"schema":2,"registry":{"publicUrl":"https://registry.example.com"}}`,
		`{"schema":2,"release":{"publicUrl":"https://release.example.com"}}`,
		`{"schema":2,"share":{"publicUrl":"https://share.example.com"}}`,
	} {
		if _, err := LoadGlobal(strings.NewReader(input)); err == nil {
			t.Fatalf("LoadGlobal(%s) accepted Gateway duplicate field", input)
		}
	}
}

func TestLoadGlobalRejectsSchemaOne(t *testing.T) {
	input := `{"schema":1,"registry":{"tls":{"certificateFile":"","keyFile":""}},"release":{"publicUrl":""},"share":{"tls":{"certificateFile":"","keyFile":""}}}`
	if _, err := LoadGlobal(strings.NewReader(input)); err == nil || !strings.Contains(err.Error(), "schema 1") {
		t.Fatalf("LoadGlobal(schema 1) error = %v, want unsupported schema", err)
	}
}

func TestLoadGlobalDefaultsSyncHubURLModes(t *testing.T) {
	global, err := LoadGlobal(strings.NewReader(`{"schema":2,"wm_sites":{"tls":{},"registry":{},"release":{},"share":{}}}`))
	if err != nil {
		t.Fatalf("LoadGlobal() error = %v", err)
	}
	raw, err := json.Marshal(global)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	for _, site := range []string{"registry", "share"} {
		if got := deepString(document, "wm_sites", site, "urlMode"); got != "sync_hub" {
			t.Errorf("wm_sites.%s.urlMode = %q, want sync_hub", site, got)
		}
	}
}

func TestLoadGlobalRejectsUnsupportedURLMode(t *testing.T) {
	input := `{"schema":2,"wm_sites":{"tls":{},"registry":{"urlMode":"manual"},"release":{},"share":{"urlMode":"sync_hub"}}}`
	if _, err := LoadGlobal(strings.NewReader(input)); err == nil || !strings.Contains(err.Error(), "urlMode") {
		t.Fatalf("LoadGlobal(manual urlMode) error = %v, want rejection", err)
	}
}

func TestValidateGlobalRejectsReservedRelayPorts(t *testing.T) {
	for _, port := range []int{80, 443, 9630, 9680, 2019, -1, 65536} {
		err := ValidateGlobal(GlobalConfig{
			Schema: GlobalSchemaVersion,
			Relay:  RelayConfig{ListenPort: port},
			Log:    LogConfig{Level: "INFO"},
		})
		if err == nil {
			t.Fatalf("ValidateGlobal(port=%d)=nil, want rejection", port)
		}
	}
}

func TestCompileConfigAddsFixedHTTPRelayServer(t *testing.T) {
	global := GlobalConfig{
		Schema: GlobalSchemaVersion,
		Relay:  RelayConfig{ListenPort: 28810},
		Log:    LogConfig{Level: "INFO"},
	}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "http://workspace.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig(): %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON(): %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	relay := deepValue(document, "apps", "http", "servers", "relay")
	if relay == nil {
		t.Fatalf("fixed relay server is missing from HTTP app: %s", compiled)
	}
	if got := deepString(relay, "listen", "0"); got != ":28810" {
		t.Fatalf("relay listen=%q, want :28810", got)
	}
	if got := deepString(relay, "routes", "0", "match", "0", "host", "0"); got != "workspace.example.com" {
		t.Fatalf("relay host matcher=%q", got)
	}
	deleteHeaders := findHandlerWithValue(relay, "headers", "X-WheelMaker-Relay")
	if deleteHeaders == nil || !containsString(deepValue(deleteHeaders, "request", "delete"), "X-WheelMaker-Relay") {
		t.Fatal("relay must delete an incoming marker before setting its own marker")
	}
	requestHeaders := findHandlerWithValue(relay, "headers", "1")
	if requestHeaders == nil {
		t.Fatal("relay must set its trusted marker")
	}
	if got := headerValue(requestHeaders, "request", "set", "X-WheelMaker-Relay"); got != "1" {
		t.Fatalf("relay marker=%q, want 1: %#v", got, requestHeaders)
	}
	proxy := findHandler(relay, "reverse_proxy")
	if got := deepString(proxy, "upstreams", "0", "dial"); got != "127.0.0.1:9630" {
		t.Fatalf("relay upstream=%q", got)
	}
	if containsHandler(relay, "file_server") {
		t.Fatal("fixed relay server must not contain Workspace static-file handlers")
	}
}

func TestCompileConfigAddsFixedHTTPSRelayServerWithTLSPolicy(t *testing.T) {
	global := GlobalConfig{
		Schema: GlobalSchemaVersion,
		Relay:  RelayConfig{ListenPort: 28810},
		Log:    LogConfig{Level: "INFO"},
	}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig(): %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON(): %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	relay := deepValue(document, "apps", "http", "servers", "relay")
	if relay == nil {
		t.Fatalf("fixed relay server is missing from HTTPS Workspace config: %s", compiled)
	}
	if got := deepString(relay, "listen", "0"); got != ":28810" {
		t.Fatalf("relay listen=%q, want :28810", got)
	}
	if got := deepString(relay, "tls_connection_policies", "0", "match", "sni", "0"); got != "workspace.example.com" {
		t.Fatalf("relay TLS SNI=%q, want workspace.example.com", got)
	}
	if got := deepString(document, "apps", "http", "servers", "https", "tls_connection_policies", "0", "match", "sni", "0"); got != "workspace.example.com" {
		t.Fatalf("Workspace TLS SNI=%q, want workspace.example.com", got)
	}
}

func TestCompileConfigDoesNotAddRelayWithoutWorkspaceSite(t *testing.T) {
	global := GlobalConfig{
		Schema: GlobalSchemaVersion,
		Relay:  RelayConfig{ListenPort: 28810},
		Log:    LogConfig{Level: "INFO"},
	}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRelease,
		PublicURL: "https://release.example.com",
		Upstream:  "http://127.0.0.1:9680",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig(): %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	servers, ok := deepValue(document, "apps", "http", "servers").(map[string]any)
	if !ok {
		t.Fatalf("HTTP servers=%#v, want server map", deepValue(document, "apps", "http", "servers"))
	}
	if _, ok := servers["relay"]; ok {
		t.Fatal("fixed relay server must require a Workspace site")
	}
}

func TestCompileConfigRejectsDuplicateHostnames(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	sites := []SiteConfig{
		{Schema: SiteSchemaVersion, Kind: SiteRegistry, PublicURL: "https://SAME.example.com", WebRoot: filepath.Join(t.TempDir(), "web"), Upstream: "http://127.0.0.1:9630"},
		{Schema: SiteSchemaVersion, Kind: SiteRelease, PublicURL: "https://same.example.com", Upstream: "http://127.0.0.1:9680"},
	}
	if _, err := CompileConfig(global, sites); err == nil || !strings.Contains(err.Error(), "duplicate hostname") {
		t.Fatalf("CompileConfig() error = %v", err)
	}
}

func TestCompileConfigIsDeterministic(t *testing.T) {
	webRoot := filepath.Join(t.TempDir(), "web")
	global := GlobalConfig{Schema: GlobalSchemaVersion, ACME: ACMEConfig{Email: "ops@example.com"}, Log: LogConfig{Level: "INFO"}}
	sites := []SiteConfig{
		{Schema: SiteSchemaVersion, Kind: SiteRelease, PublicURL: "https://release.example.com", Upstream: "http://127.0.0.1:9680"},
		{Schema: SiteSchemaVersion, Kind: SiteRegistry, PublicURL: "https://workspace.example.com", WebRoot: webRoot, Upstream: "http://127.0.0.1:9630"},
	}

	first, err := CompileConfig(global, sites)
	if err != nil {
		t.Fatalf("first CompileConfig() error = %v", err)
	}
	second, err := CompileConfig(global, sites)
	if err != nil {
		t.Fatalf("second CompileConfig() error = %v", err)
	}
	if string(first) != string(second) {
		t.Fatalf("CompileConfig() is not deterministic\nfirst: %s\nsecond: %s", first, second)
	}
}

func TestLoadGlobalMissingUsesDefaults(t *testing.T) {
	global, err := LoadGlobal(strings.NewReader(`{"schema":2,"acme":{"email":"ops@example.com"},"wm_sites":{"registry":{},"release":{},"share":{}}}`))
	if err != nil {
		t.Fatalf("LoadGlobal() error = %v", err)
	}
	if global.Log.Level != "INFO" {
		t.Fatalf("LogLevel = %q, want INFO", global.Log.Level)
	}
}

func TestLoadConfigRejectsTrailingJSON(t *testing.T) {
	if _, err := LoadGlobal(strings.NewReader(`{"schema":2} {"schema":2}`)); err == nil {
		t.Fatal("LoadGlobal accepted trailing JSON")
	}
	if _, err := LoadSite(strings.NewReader(`{"schema":1} {"schema":1}`)); err == nil {
		t.Fatal("LoadSite accepted trailing JSON")
	}
}

func TestWriteGeneratedReplacesConfigAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "generated", "caddy.json")
	if err := WriteGenerated(path, []byte(`{"version":1}`)); err != nil {
		t.Fatalf("first WriteGenerated() error = %v", err)
	}
	if err := WriteGenerated(path, []byte(`{"version":2}`)); err != nil {
		t.Fatalf("second WriteGenerated() error = %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(data) != `{"version":2}` {
		t.Fatalf("generated config = %q", data)
	}
}

func TestValidateJSONRejectsMalformedGeneratedConfig(t *testing.T) {
	if err := ValidateJSON([]byte(`{"apps":{"http":{"servers":{"bad":{"routes":[{"handle":[{"handler":"not-a-real-handler"}]}]}}}}}`)); err == nil {
		t.Fatal("ValidateJSON() accepted an unknown Caddy handler")
	}
}

func deepString(value any, path ...string) string {
	value = deepValue(value, path...)
	result, _ := value.(string)
	return result
}

func deepValue(value any, path ...string) any {
	for _, part := range path {
		switch current := value.(type) {
		case map[string]any:
			value = current[part]
		case []any:
			var index int
			if err := parseIndex(part, &index); err != nil || index < 0 || index >= len(current) {
				return nil
			}
			value = current[index]
		default:
			return nil
		}
	}
	return value
}

func containsHandler(value any, want string) bool {
	switch current := value.(type) {
	case map[string]any:
		if handler, ok := current["handler"].(string); ok && handler == want {
			return true
		}
		for _, child := range current {
			if containsHandler(child, want) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if containsHandler(child, want) {
				return true
			}
		}
	}
	return false
}

func findHandler(value any, want string) map[string]any {
	switch current := value.(type) {
	case map[string]any:
		if current["handler"] == want {
			return current
		}
		for _, child := range current {
			if found := findHandler(child, want); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findHandler(child, want); found != nil {
				return found
			}
		}
	}
	return nil
}

func findHandlerWithValue(value any, handler string, want any) map[string]any {
	switch current := value.(type) {
	case map[string]any:
		if current["handler"] == handler && containsDeepValue(current, want) {
			return current
		}
		for _, child := range current {
			if found := findHandlerWithValue(child, handler, want); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findHandlerWithValue(child, handler, want); found != nil {
				return found
			}
		}
	}
	return nil
}

func handlerCount(value any, want string) int {
	count := 0
	switch current := value.(type) {
	case map[string]any:
		if current["handler"] == want {
			count++
		}
		for _, child := range current {
			count += handlerCount(child, want)
		}
	case []any:
		for _, child := range current {
			count += handlerCount(child, want)
		}
	}
	return count
}

func findRouteWithMatchValue(value any, want string) map[string]any {
	switch current := value.(type) {
	case map[string]any:
		if _, ok := current["match"]; ok && containsDeepString(current["match"], want) {
			return current
		}
		for _, child := range current {
			if found := findRouteWithMatchValue(child, want); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findRouteWithMatchValue(child, want); found != nil {
				return found
			}
		}
	}
	return nil
}

func containsDeepString(value any, want string) bool {
	switch current := value.(type) {
	case string:
		return current == want
	case map[string]any:
		for _, child := range current {
			if containsDeepString(child, want) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if containsDeepString(child, want) {
				return true
			}
		}
	}
	return false
}

func containsDeepValue(value any, want any) bool {
	switch current := value.(type) {
	case string:
		return current == want
	case float64:
		return current == want
	case bool:
		return current == want
	}
	switch current := value.(type) {
	case map[string]any:
		for _, child := range current {
			if containsDeepValue(child, want) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if containsDeepValue(child, want) {
				return true
			}
		}
	}
	return false
}

func containsString(value any, want string) bool {
	values, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range values {
		if item == want {
			return true
		}
	}
	return false
}

func headerValue(value any, pathOne, pathTwo, wantName string) string {
	headers, _ := deepValue(value, pathOne, pathTwo).(map[string]any)
	for name, raw := range headers {
		if strings.EqualFold(name, wantName) {
			values, _ := raw.([]any)
			if len(values) > 0 {
				result, _ := values[0].(string)
				return result
			}
		}
	}
	return ""
}

func parseIndex(value string, target *int) (err error) {
	if value == "" {
		return errors.New("empty index")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return errors.New("invalid index")
		}
		*target = *target*10 + int(char-'0')
	}
	return nil
}
