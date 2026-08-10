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
}

func TestResolvePathsDerivesRuntimeRoots(t *testing.T) {
	paths := ResolvePaths(`C:\Users\alice\.wheelmaker\gateway`)
	if paths.SharePublicRoot != `C:\Users\alice\.wheelmaker\shares\public` {
		t.Fatalf("SharePublicRoot = %q", paths.SharePublicRoot)
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
	routes, ok := deepValue(document, "apps", "http", "servers", "https", "routes", "0", "handle", "0", "routes").([]any)
	if !ok || len(routes) != 2 {
		t.Fatalf("share routes = %#v, want exact route plus generic 404", routes)
	}
	route := routes[0]
	if got := deepString(route, "match", "0", "path_regexp", "pattern"); got != `^/s/[A-Za-z0-9_-]{43}$` {
		t.Fatalf("share matcher = %q", got)
	}
	if got := deepString(route, "match", "0", "method", "0"); got != "GET" {
		t.Fatalf("share method matcher = %q", got)
	}
	if got := deepString(route, "handle", "1", "root"); got != site.WebRoot {
		t.Fatalf("share root = %q", got)
	}
	if got := deepString(routes[1], "handle", "0", "handler"); got != "static_response" {
		t.Fatalf("share fallback handler = %q", got)
	}
	if got := deepValue(routes[1], "handle", "0", "status_code"); got != float64(404) {
		t.Fatalf("share fallback status = %#v", got)
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
	if err := os.WriteFile(paths.ConfigFile, []byte(`{"schema":1,"registry":{"tls":{"certificateFile":"","keyFile":""}},"release":{"publicUrl":""},"share":{"tls":{"certificateFile":"","keyFile":""}}}`), 0o600); err != nil {
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
	routes, ok := deepValue(document, "apps", "http", "servers", "https", "routes", "0", "handle", "0", "routes").([]any)
	if !ok || len(routes) < 4 {
		t.Fatalf("workspace routes = %#v, want websocket, immutable, static, and fallback routes", routes)
	}

	if containsHandler(routes[0], "encode") {
		t.Fatal("WebSocket route must not install the encode handler")
	}
	immutable := routes[1]
	if !containsHandler(immutable, "encode") {
		t.Fatal("immutable asset route must install the encode handler")
	}
	encodings, ok := deepValue(immutable, "handle", "2", "encodings").(map[string]any)
	if !ok || len(encodings) != 2 {
		t.Fatalf("immutable encodings = %#v, want zstd and gzip", encodings)
	}
	for _, name := range []string{"zstd", "gzip"} {
		if _, ok := encodings[name]; !ok {
			t.Errorf("immutable encodings missing %q", name)
		}
	}
	if got := deepString(immutable, "match", "0", "path_regexp", "pattern"); got == "" {
		t.Fatal("immutable asset route must match hashed asset paths")
	}
	if got := deepString(immutable, "handle", "1", "response", "set", "Cache-Control", "0"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("immutable Cache-Control = %q", got)
	}

	static := routes[2]
	if !containsHandler(static, "encode") {
		t.Fatal("static route must install the encode handler")
	}
	if got := deepString(static, "handle", "1", "response", "set", "Cache-Control", "0"); got != "no-cache" {
		t.Fatalf("static Cache-Control = %q, want no-cache", got)
	}
	fallback := routes[len(routes)-1]
	if !containsHandler(fallback, "encode") {
		t.Fatal("SPA fallback route must install the encode handler")
	}
	if got := deepString(fallback, "handle", "1", "response", "set", "Cache-Control", "0"); got != "no-cache" {
		t.Fatalf("fallback Cache-Control = %q, want no-cache", got)
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
	routes, ok := deepValue(document, "apps", "http", "servers", "https", "routes", "0", "handle", "0", "routes").([]any)
	if !ok || len(routes) != 1 {
		t.Fatalf("release server routes = %#v, want one route", routes)
	}
	if !containsHandler(routes[0], "encode") {
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
		`{"schema":1,"log":{"level":"INFO"}}`,
		`{"schema":1,"relay":{"listenPort":28810}}`,
		`{"schema":1,"registry":{"publicUrl":"https://registry.example.com"}}`,
		`{"schema":1,"share":{"publicUrl":"https://share.example.com"}}`,
	} {
		if _, err := LoadGlobal(strings.NewReader(input)); err == nil {
			t.Fatalf("LoadGlobal(%s) accepted Gateway duplicate field", input)
		}
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
	relayRoute := deepValue(relay, "routes", "0", "handle", "0", "routes", "0")
	deleteMarker := deepValue(relayRoute, "handle", "0")
	if !containsString(deepValue(deleteMarker, "request", "delete"), "X-WheelMaker-Relay") {
		t.Fatal("relay must delete an incoming marker before setting its own marker")
	}
	requestHeaders := deepValue(relayRoute, "handle", "1")
	if got := deepString(requestHeaders, "request", "set", "X-WheelMaker-Relay", "0"); got != "1" {
		t.Fatalf("relay marker=%q, want 1", got)
	}
	proxy := deepValue(relayRoute, "handle", "2")
	if got := deepString(proxy, "upstreams", "0", "dial"); got != "127.0.0.1:9630" {
		t.Fatalf("relay upstream=%q", got)
	}
	if got := deepString(requestHeaders, "request", "set", "X-Forwarded-Proto", "0"); got != "{http.request.scheme}" {
		t.Fatalf("relay forwarded proto=%q", got)
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
	global, err := LoadGlobal(strings.NewReader(`{"schema":1,"acme":{"email":"ops@example.com"}}`))
	if err != nil {
		t.Fatalf("LoadGlobal() error = %v", err)
	}
	if global.Log.Level != "INFO" {
		t.Fatalf("LogLevel = %q, want INFO", global.Log.Level)
	}
}

func TestLoadConfigRejectsTrailingJSON(t *testing.T) {
	if _, err := LoadGlobal(strings.NewReader(`{"schema":1} {"schema":1}`)); err == nil {
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
