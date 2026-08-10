package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestTokenStatsUpdateMethodIsRemoved(t *testing.T) {
	if descriptor, ok := RegistryMethod("tokenStats.update"); ok {
		t.Fatalf("removed tokenStats.update method is still registered: %+v", descriptor)
	}
}

func TestProjectProtocolTypesHaveNoLegacyProfileField(t *testing.T) {
	for _, value := range []any{ProjectInfo{}, ProjectListItem{}} {
		if _, ok := reflect.TypeOf(value).FieldByName("Agent" + "Profiles"); ok {
			t.Fatalf("%T still exposes the legacy profile field", value)
		}
	}
}

func TestHubStateUpdatedAllowsHubOrigin(t *testing.T) {
	descriptor, ok := RegistryMethod(RegistryMethodHubStateUpdated)
	if !ok {
		t.Fatal("hub.state.updated is not registered")
	}
	if !RegistryMethodAllowed(string(RegistryRoleHub), descriptor.Method) {
		t.Fatal("hub role must be allowed to publish hub.state.updated")
	}
	if descriptor.Route != RegistryRouteClientEvent {
		t.Fatalf("route=%q", descriptor.Route)
	}
}

func TestReleasePublishMethodsAreRegisteredInProtocol27(t *testing.T) {
	for _, method := range []string{
		RegistryMethodReleasePublishStart,
		RegistryMethodReleasePublishGet,
		RegistryMethodReleasePublishUpdated,
	} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("%s is not registered", method)
		}
		if !desc.RequiresHubID {
			t.Fatalf("%s must require hubId", method)
		}
	}
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("protocol version = %q, want 2.7", DefaultProtocolVersion)
	}
}

func TestHubStateSectionWireShape(t *testing.T) {
	raw, err := json.Marshal(HubStateSection{
		Availability: HubStateAvailabilityReady,
		UpdateStatus: HubStateUpdateIdle,
		Revision:     4,
		Data:         map[string]any{"ok": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"availability":"ready"`, `"updateStatus":"idle"`, `"revision":4`} {
		if !bytes.Contains(raw, []byte(field)) {
			t.Fatalf("section missing %s: %s", field, raw)
		}
	}
}

func TestHubReleaseNotifyAllowsOnlyHubOriginInProtocol27(t *testing.T) {
	descriptor, ok := RegistryMethod(RegistryMethodHubReleaseNotify)
	if !ok {
		t.Fatal("hub.release.notify is not registered")
	}
	if descriptor.Route != RegistryRouteHubReleaseNotify {
		t.Fatalf("route=%q, want %q", descriptor.Route, RegistryRouteHubReleaseNotify)
	}
	if !RegistryMethodAllowed(string(RegistryRoleHub), descriptor.Method) {
		t.Fatal("hub role must be allowed to publish hub.release.notify")
	}
	if RegistryMethodAllowed(string(RegistryRoleClient), descriptor.Method) {
		t.Fatal("client role must not be allowed to publish hub.release.notify")
	}
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.7", DefaultProtocolVersion)
	}
}

func TestHubDebugWebTransferAllowsOnlyHubOrigin(t *testing.T) {
	for _, method := range []string{RegistryMethodHubDebugWebTransferStart, RegistryMethodHubDebugWebTransferChunk, RegistryMethodHubDebugWebTransferFinish, RegistryMethodHubDebugWebTransferAbort} {
		descriptor, ok := RegistryMethod(method)
		if !ok || descriptor.Route != RegistryRouteHubDebugWebTransfer || !descriptor.RequiresHubID {
			t.Fatalf("descriptor for %q = %#v", method, descriptor)
		}
		if !RegistryMethodAllowed(string(RegistryRoleHub), method) || RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("unexpected roles for %q", method)
		}
	}
}

func TestRegistryDeviceSessionMethods(t *testing.T) {
	methods := []string{
		RegistryMethodSecuritySessionList,
		RegistryMethodSecuritySessionRevoke,
		RegistryMethodSecuritySessionRevokeAll,
	}
	for _, method := range methods {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("method %q is not registered", method)
		}
		if desc.Route != RegistryRouteSecuritySession {
			t.Fatalf("method %q route=%q, want %q", method, desc.Route, RegistryRouteSecuritySession)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("method %q should allow client", method)
		}
		if RegistryMethodAllowed(string(RegistryRoleHub), method) || RegistryMethodAllowed("monitor", method) {
			t.Fatalf("method %q allowed a non-client role", method)
		}
	}
}

func TestServerConfigMethodsAndSerializationAreSetOnly(t *testing.T) {
	for _, method := range []string{RegistryMethodServerConfigGet, RegistryMethodServerConfigUpdate, RegistryMethodServerAndroidSpeechCredentialGet, RegistryMethodCodexRadarEfficiencyGet} {
		desc, ok := RegistryMethod(method)
		if !ok || desc.Route != RegistryRouteServerData || !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("server data method %q descriptor=%+v ok=%v", method, desc, ok)
		}
		if RegistryMethodAllowed(string(RegistryRoleHub), method) {
			t.Fatalf("server data method %q allowed hub", method)
		}
	}
	for _, method := range []string{"security.secret.status", "security.secret.update"} {
		if _, ok := RegistryMethod(method); ok {
			t.Fatalf("legacy method remains: %s", method)
		}
	}
	encoded, err := json.Marshal(ServerConfigResponse{
		VoiceInput:   ServerVoiceInputConfig{ServerFeatureConfig: ServerFeatureConfig{Configured: true, UpdatedAt: "2026-07-13T00:00:00Z"}, Model: "doubao-streaming-asr-2.0"},
		TextToSpeech: ServerTextToSpeechConfig{Model: "mimo-v2.5-tts", Voice: "Mia"},
		DeepSeek:     ServerFeatureConfig{Configured: true},
	})
	if err != nil {
		t.Fatalf("Marshal(): %v", err)
	}
	for _, forbidden := range []string{`"value"`, "apiKey", "accessToken", "digest", "configPath"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("server config contains %q: %s", forbidden, encoded)
		}
	}
}

func TestTTSMethodIsClientOnly(t *testing.T) {
	desc, ok := RegistryMethod(RegistryMethodTTSSynthesize)
	if !ok || desc.Route != RegistryRouteTTS || !RegistryMethodAllowed(string(RegistryRoleClient), desc.Method) {
		t.Fatalf("tts descriptor=%+v ok=%v", desc, ok)
	}
	if RegistryMethodAllowed(string(RegistryRoleHub), desc.Method) {
		t.Fatal("hub can call client TTS method")
	}
}

func TestMonitorMethodsRemoved(t *testing.T) {
	prefix := "monitor."
	for _, method := range []string{prefix + "listHub", prefix + "status", prefix + "log", prefix + "db", prefix + "action", prefix + "restart"} {
		if desc, ok := RegistryMethod(method); ok {
			t.Fatalf("removed monitor method %q still registered as %+v", method, desc)
		}
	}
	if RegistryMethodAllowed("monitor", RegistryMethodRegistryProjectList) {
		t.Fatal("removed monitor role can still list projects")
	}
}

func TestRegistryDeviceSessionListSerializationExcludesCredentials(t *testing.T) {
	payload := RegistryDeviceSessionListResponse{Sessions: []RegistryDeviceSession{{
		DeviceID:   "device-public-id",
		DeviceName: "Work Laptop",
		BasePath:   "/wheelmaker/",
		CreatedAt:  "2026-07-13T12:00:00Z",
		LastSeenAt: "2026-07-13T12:01:00Z",
		ExpiresAt:  "2027-01-09T12:01:00Z",
		Current:    true,
	}}}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal(): %v", err)
	}
	for _, forbidden := range []string{"token", "cookie", "digest", "csrf", "fingerprint"} {
		if bytes.Contains(bytes.ToLower(encoded), []byte(forbidden)) {
			t.Fatalf("serialized sessions contain %q: %s", forbidden, encoded)
		}
	}
}

func TestRegistryDefaultProtocolVersionIs27(t *testing.T) {
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.7", DefaultProtocolVersion)
	}
}

func TestFileDownloadMethodsAreAdditiveWithoutVersionChange(t *testing.T) {
	prepare, ok := RegistryMethod("file.download.prepare")
	if !ok {
		t.Fatal("file.download.prepare is not registered")
	}
	if prepare.Route != RegistryRouteKind("file_download") || !prepare.RequiresProjectID {
		t.Fatalf("prepare descriptor=%+v", prepare)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), prepare.Method) || RegistryMethodAllowed(string(RegistryRoleHub), prepare.Method) {
		t.Fatalf("unexpected prepare roles=%v", prepare.Roles)
	}

	for _, method := range []string{"file.download.open", "file.download.read", "file.download.close"} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("%s is not registered", method)
		}
		if desc.Route != RegistryRouteProjectForward || !desc.RequiresProjectID || len(desc.Roles) != 0 {
			t.Fatalf("%s descriptor=%+v", method, desc)
		}
		if RegistryMethodAllowed(string(RegistryRoleClient), method) || RegistryMethodAllowed(string(RegistryRoleHub), method) {
			t.Fatalf("%s must remain internal", method)
		}
	}

	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.7", DefaultProtocolVersion)
	}
}

func TestSessionPermissionRespondIsClientProjectForwardWithoutVersionChange(t *testing.T) {
	descriptor, ok := RegistryMethod(RegistryMethodSessionPermissionRespond)
	if !ok {
		t.Fatal("session.permission.respond is not registered")
	}
	if descriptor.Route != RegistryRouteSessionForward || !descriptor.RequiresProjectID {
		t.Fatalf("descriptor=%+v", descriptor)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), descriptor.Method) {
		t.Fatal("client role cannot respond to permission")
	}
	if RegistryMethodAllowed(string(RegistryRoleHub), descriptor.Method) {
		t.Fatal("hub role can invoke session.permission.respond")
	}
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.7", DefaultProtocolVersion)
	}
}

func TestSessionPinIsClientProjectForwardWithoutVersionChange(t *testing.T) {
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.7", DefaultProtocolVersion)
	}
	descriptor, ok := RegistryMethod(RegistryMethodSessionPin)
	if !ok {
		t.Fatal("session.pin is not registered")
	}
	if descriptor.Route != RegistryRouteSessionForward || !descriptor.RequiresProjectID {
		t.Fatalf("descriptor=%+v", descriptor)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), descriptor.Method) {
		t.Fatal("client role cannot pin a session")
	}
	if RegistryMethodAllowed(string(RegistryRoleHub), descriptor.Method) {
		t.Fatal("hub role can invoke session.pin")
	}
}

func TestSessionMarkIsClientProjectForwardWithoutVersionChange(t *testing.T) {
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.7", DefaultProtocolVersion)
	}
	descriptor, ok := RegistryMethod(RegistryMethodSessionMark)
	if !ok {
		t.Fatal("session.mark is not registered")
	}
	if descriptor.Route != RegistryRouteSessionForward || !descriptor.RequiresProjectID {
		t.Fatalf("descriptor=%+v", descriptor)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), descriptor.Method) {
		t.Fatal("client role cannot mark a session")
	}
	if RegistryMethodAllowed(string(RegistryRoleHub), descriptor.Method) {
		t.Fatal("hub role can invoke session.mark")
	}
}

func TestRegistrySessionActionMethods(t *testing.T) {
	for _, method := range []string{RegistryMethodSessionStatus, RegistryMethodSessionQueue, RegistryMethodSessionFork} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("method %q is not registered", method)
		}
		if desc.Route != RegistryRouteSessionForward || !desc.RequiresProjectID {
			t.Fatalf("method %q descriptor=%+v", method, desc)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("method %q should allow client", method)
		}
	}
}

func TestRegistrySessionQueueReplacesLegacyMethods(t *testing.T) {
	desc, ok := RegistryMethod(RegistryMethodSessionQueue)
	if !ok {
		t.Fatal("session.queue descriptor missing")
	}
	if !desc.RequiresProjectID || desc.Route != RegistryRouteSessionForward {
		t.Fatalf("session.queue descriptor = %+v", desc)
	}
	for _, removed := range []string{"session.send", "session.compact", "session.cancel", "session.steer"} {
		if _, exists := RegistryMethod(removed); exists {
			t.Fatalf("%s must not remain registered", removed)
		}
	}
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("protocol version = %q, want 2.7", DefaultProtocolVersion)
	}
}

func TestRegistryGoalMethodsAreProjectScopedSessionForwards(t *testing.T) {
	methods := []string{
		RegistryMethodSessionGoalCreate,
		RegistryMethodSessionGoalGet,
		RegistryMethodSessionGoalUpdate,
		RegistryMethodSessionGoalStop,
		RegistryMethodSessionGoalClear,
	}
	for _, method := range methods {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("RegistryMethod(%q) missing", method)
		}
		if desc.Route != RegistryRouteSessionForward || !desc.RequiresProjectID {
			t.Fatalf("%s descriptor = %#v", method, desc)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("%s should allow client", method)
		}
	}
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("protocol version = %q, want 2.7", DefaultProtocolVersion)
	}
}

func TestRegistryTerminalMethods(t *testing.T) {
	tests := []struct {
		method    string
		role      RegistryRole
		route     RegistryRouteKind
		projectID bool
		hubID     bool
	}{
		{RegistryMethodTerminalList, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalCreate, RegistryRoleClient, RegistryRouteTerminalProjectRequest, true, false},
		{RegistryMethodTerminalGet, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalResize, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalClose, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalRestart, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalInput, RegistryRoleClient, RegistryRouteTerminalClientEvent, false, true},
		{RegistryMethodTerminalOutput, RegistryRoleHub, RegistryRouteTerminalHubEvent, false, true},
		{RegistryMethodTerminalChanged, RegistryRoleHub, RegistryRouteTerminalHubEvent, false, true},
	}
	for _, tt := range tests {
		desc, ok := RegistryMethod(tt.method)
		if !ok {
			t.Fatalf("method %q is not registered", tt.method)
		}
		if desc.Route != tt.route || desc.RequiresProjectID != tt.projectID || desc.RequiresHubID != tt.hubID {
			t.Fatalf("method %q descriptor=%+v", tt.method, desc)
		}
		if !RegistryMethodAllowed(string(tt.role), tt.method) {
			t.Fatalf("method %q should allow %q", tt.method, tt.role)
		}
	}
}

func TestTerminalDataPayloadValidation(t *testing.T) {
	valid := base64.StdEncoding.EncodeToString([]byte{0, 3, 0xff})
	decoded, err := DecodeTerminalData(valid)
	if err != nil || !bytes.Equal(decoded, []byte{0, 3, 0xff}) {
		t.Fatalf("DecodeTerminalData()=%v,%v", decoded, err)
	}
	if _, err := DecodeTerminalData("not-base64"); err == nil {
		t.Fatal("invalid base64 should fail")
	}
	oversized := base64.StdEncoding.EncodeToString(make([]byte, MaxTerminalEventBytes+1))
	if _, err := DecodeTerminalData(oversized); err == nil {
		t.Fatal("oversized decoded payload should fail")
	}
}

func TestRegistryMethodDescriptorsAreSelfConsistent(t *testing.T) {
	for key, desc := range RegistryMethodDescriptors {
		if key == "" {
			t.Fatal("registry method descriptor has empty key")
		}
		if desc.Method != key {
			t.Fatalf("descriptor key=%q method=%q, want same value", key, desc.Method)
		}
		if desc.Route == "" {
			t.Fatalf("descriptor %q has empty route", key)
		}
	}
}

func TestRegistryMethodRolesAndRoutes(t *testing.T) {
	hubReport, ok := RegistryMethod(RegistryMethodHubReportProjects)
	if !ok {
		t.Fatal("hub.report.projects should be registered")
	}
	if hubReport.Route != RegistryRouteHubReport {
		t.Fatalf("hub.report.projects route=%q, want %q", hubReport.Route, RegistryRouteHubReport)
	}
	if !hubReport.RequiresHubID {
		t.Fatal("hub.report.projects should require hubId")
	}
	if !RegistryMethodAllowed(string(RegistryRoleHub), RegistryMethodHubReportProjects) {
		t.Fatal("hub should be allowed to report projects")
	}
	if RegistryMethodAllowed(string(RegistryRoleClient), RegistryMethodHubReportProjects) {
		t.Fatal("client should not be allowed to report projects")
	}
	if !RegistryClientForwardMethod(RegistryMethodSessionQueue) {
		t.Fatal("session.queue should be a client forward method")
	}
	if !RegistryClientForwardMethod(RegistryMethodSessionArtifactRead) {
		t.Fatalf("%s should be forwarded to the hub session route", RegistryMethodSessionArtifactRead)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), RegistryMethodSessionArtifactRead) {
		t.Fatalf("%s should allow client callers", RegistryMethodSessionArtifactRead)
	}
	if _, ok := RegistryMethod("cmd.skills"); ok {
		t.Fatal("cmd.skills should not be a public hub command method")
	}
	if _, ok := RegistryMethod("fs.index.status"); ok {
		t.Fatal("fs.index.status should not be a public hub command method")
	}
	gitRev, ok := RegistryMethod(RegistryMethodProjectGitRev)
	if !ok {
		t.Fatal("project.git.rev should be registered")
	}
	if gitRev.Route != RegistryRouteProjectForward {
		t.Fatalf("project.git.rev route=%q, want %q", gitRev.Route, RegistryRouteProjectForward)
	}
	if !gitRev.RequiresProjectID {
		t.Fatal("project.git.rev should require projectId")
	}
}

func TestRegistryProtocolDomainTargetMethods(t *testing.T) {
	targets := []string{
		"connect.close",
		"hub.report.projects",
		"hub.report.project",
		"registry.project.list",
		"registry.project.report",
		"project.fs.list",
		"project.fs.info",
		"project.fs.read",
		"project.fs.external.info",
		"project.fs.external.read",
		"project.fs.search",
		"project.fs.grep",
		"project.fs.index.search",
		"project.git.rev",
		"project.git.refs",
		"project.git.log",
		"project.git.commit.files",
		"project.git.commit.fileDiff",
		"project.git.commit.diff",
		"project.git.diff",
		"project.git.diff.fileDiff",
		"project.git.status",
		"project.git.workingTree.fileDiff",
		"session.create",
		"session.config",
		"session.message",
		"session.updated",
		"registry.relay.status",
		"registry.relay.enable",
		"registry.relay.disable",
		"registry.relay.regenerateAccessCode",
		"hub.relay.open",
		"hub.relay.close",
	}
	for _, method := range targets {
		if _, ok := RegistryMethod(method); !ok {
			t.Fatalf("%s should be registered", method)
		}
	}
	if _, ok := RegistryMethod("connect.localRead.proof"); ok {
		t.Fatal("connect.localRead.proof should be removed")
	}
	for _, method := range []string{
		RegistryMethodProjectFSExternalInfo,
		RegistryMethodProjectFSExternalRead,
	} {
		descriptor, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("%s should be registered", method)
		}
		if descriptor.Route != RegistryRouteProjectForward || !descriptor.RequiresProjectID {
			t.Fatalf("%s descriptor=%+v, want project forward with projectId", method, descriptor)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("%s should allow client callers", method)
		}
	}
}

func removedRegistryProtocolMethods() []string {
	return []string{
		"connection.closing",
		"local_read.proof",
		"registry.reportProjects",
		"registry.updateProject",
		"registry.session.updated",
		"registry.session.message",
		"project.list",
		"project.sync.check",
		"project.syncCheck",
		"project.online",
		"project.offline",
		"session.new",
		"session.setConfig",
		"session.token.providers",
		"session.token.deepseek.stats",
		"session.token.scan",
		"fs.list",
		"fs.info",
		"fs.read",
		"fs.search",
		"fs.grep",
		"fs.index.status",
		"fs.index.rebuild",
		"fs.index.search",
		"git.refs",
		"git.branches",
		"git.log",
		"git.commit.files",
		"git.commit.fileDiff",
		"git.diff",
		"git.diff.fileDiff",
		"git.status",
		"git.workingTree.fileDiff",
		"cmd.npm",
		"cmd.update",
		"cmd.skills",
		"cmd.token",
		"batch",
		"relay.status",
		"relay.enable",
		"relay.disable",
		"relay.regenerateAccessCode",
		"relay.open",
		"relay.close",
	}
}

func TestRegistryProtocolDomainOldMethodsAreRemoved(t *testing.T) {
	for _, method := range removedRegistryProtocolMethods() {
		if _, ok := RegistryMethod(method); ok {
			t.Fatalf("%s should not be registered", method)
		}
	}
}

func TestRegistryProtocolDomainOldMethodLiteralsDoNotReappear(t *testing.T) {
	files := []string{
		"registry_methods.go",
		filepath.Join("..", "registry", "server.go"),
	}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		source := string(raw)
		for _, method := range removedRegistryProtocolMethods() {
			if strings.Contains(source, `"`+method+`"`) || strings.Contains(source, "`"+method+"`") {
				t.Fatalf("%s contains removed public method literal %q", file, method)
			}
		}
	}
}

func TestRegistryHubSessionEventMapping(t *testing.T) {
	method, ok := RegistryHubSessionEventMethod(RegistryMethodSessionMessage)
	if !ok {
		t.Fatal("session.message should map to a client event")
	}
	if method != RegistryMethodSessionMessage {
		t.Fatalf("client event method=%q, want %q", method, RegistryMethodSessionMessage)
	}
}

func TestRegistryHubStateMethodsRequireHubID(t *testing.T) {
	methods := []string{
		RegistryMethodHubStateGet,
		RegistryMethodHubStateRefresh,
		RegistryMethodHubStateAction,
		RegistryMethodHubConfigGet,
		RegistryMethodHubConfigUpdate,
		RegistryMethodUsageHistoryGet,
		RegistryMethodDeepSeekUsageGet,
	}
	for _, method := range methods {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("method %q is not registered", method)
		}
		if desc.Route != RegistryRouteHubState {
			t.Fatalf("%s route=%q, want %q", method, desc.Route, RegistryRouteHubState)
		}
		if !desc.RequiresHubID {
			t.Fatalf("%s should require hubId", method)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("%s should allow client role", method)
		}
	}

	updated, ok := RegistryMethod(RegistryMethodHubStateUpdated)
	if !ok {
		t.Fatal("hub.state.updated is not registered")
	}
	if updated.Route != RegistryRouteClientEvent {
		t.Fatalf("hub.state.updated route=%q, want client event", updated.Route)
	}
}

func TestDeepSeekUsageGetDescriptor(t *testing.T) {
	got, ok := RegistryMethod(RegistryMethodDeepSeekUsageGet)
	if !ok || got.Route != RegistryRouteHubState || !got.RequiresHubID {
		t.Fatalf("descriptor=%+v ok=%v", got, ok)
	}
}

func TestSessionActionStatusResultSessionLocalJSON(t *testing.T) {
	encoded, err := json.Marshal(SessionActionStatusResult{
		OK:        true,
		SessionID: "sess-1",
		AgentType: "codex",
		Limits:    []SessionActionRateLimit{},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"agentType":"codex"`)) {
		t.Fatalf("expected agentType in json, got %s", encoded)
	}
	if !bytes.Contains(encoded, []byte(`"limits":[]`)) {
		t.Fatalf("expected empty limits array, got %s", encoded)
	}
	if bytes.Contains(encoded, []byte(`"account"`)) {
		t.Fatalf("expected account to be omitted, got %s", encoded)
	}

	var decoded SessionActionStatusResult
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.AgentType != "codex" {
		t.Fatalf("agentType=%q, want codex", decoded.AgentType)
	}
}

func TestReleaseStorageMethodsAreRegisteredWithoutVersionChange(t *testing.T) {
	for _, method := range []string{
		RegistryMethodReleaseStorageGet,
		RegistryMethodReleaseStoragePrune,
	} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("%s is not registered", method)
		}
		if !desc.RequiresHubID {
			t.Fatalf("%s must require hubId", method)
		}
		if desc.Route != RegistryRouteReleasePublish {
			t.Fatalf("%s route=%q, want %q", method, desc.Route, RegistryRouteReleasePublish)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("%s must allow client role", method)
		}
	}
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("protocol version = %q, want 2.7", DefaultProtocolVersion)
	}
}
