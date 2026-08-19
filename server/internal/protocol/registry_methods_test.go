package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
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

func TestQwenOAuthUpdateIsHubScopedAndClientCallable(t *testing.T) {
	descriptor, ok := RegistryMethod(RegistryMethodQwenOAuthUpdate)
	if !ok {
		t.Fatal("qwen.oauth.update is not registered")
	}
	if descriptor.Route != RegistryRouteHubState || !descriptor.RequiresHubID {
		t.Fatalf("descriptor=%+v", descriptor)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), descriptor.Method) || RegistryMethodAllowed(string(RegistryRoleHub), descriptor.Method) {
		t.Fatalf("unexpected roles=%v", descriptor.Roles)
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

func TestRegistryShareMethodsAreClientOnly(t *testing.T) {
	for _, method := range []string{
		RegistryMethodShareCreate,
		RegistryMethodShareList,
		RegistryMethodShareDelete,
	} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("RegistryMethod(%q) missing", method)
		}
		if desc.Route != RegistryRouteShare {
			t.Fatalf("%s route=%q, want %q", method, desc.Route, RegistryRouteShare)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("%s should allow client callers", method)
		}
		if RegistryMethodAllowed(string(RegistryRoleHub), method) {
			t.Fatalf("%s should reject hub callers", method)
		}
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

func TestACPImplementedTypesPreserveMeta(t *testing.T) {
	types := []any{
		&InitializeParams{}, &InitializeResult{}, &ClientCapabilities{}, &FSCapabilities{},
		&AgentCapabilities{}, &PromptCapabilities{}, &MCPCapabilities{}, &SessionCapabilities{},
		&SessionListCapability{}, &SessionForkCapability{}, &SessionLifecycleCapability{},
		&AgentInfo{}, &AuthMethodVar{}, &AuthMethod{}, &AvailableCommand{}, &AvailableCommandInput{},
		&SessionNewParams{}, &SessionLoadParams{}, &EnvVariable{}, &HttpHeader{},
		&SessionPromptParams{}, &SessionCancelParams{},
		&SessionForkParams{}, &SessionForkResponse{}, &SessionDeleteParams{}, &SessionDeleteResult{},
		&SessionSteeringParams{}, &SessionSteeringResponse{},
		&PlanEntry{}, &ToolCallLocation{}, &EmbeddedResource{},
		&ToolCallRef{}, &PermissionRequestParams{}, &PermissionOption{},
		&PermissionResult{}, &PermissionResponse{}, &SessionLoadResult{},
		&FSReadTextFileParams{}, &FSReadTextFileResult{}, &FSWriteTextFileParams{},
		&TerminalCreateParams{}, &TerminalCreateResult{}, &TerminalOutputParams{}, &TerminalExitStatus{},
		&TerminalOutputResult{}, &TerminalWaitForExitParams{}, &TerminalWaitForExitResult{},
		&TerminalKillParams{}, &TerminalReleaseParams{}, &SessionListParams{}, &SessionInfo{}, &SessionListResult{},
	}
	for name, test := range map[string]struct {
		raw    string
		target any
	}{
		"SessionNewResult":    {`{"sessionId":"s1","_meta":{"future":{"value":7}}}`, &SessionNewResult{}},
		"SessionPromptResult": {`{"stopReason":"end_turn","_meta":{"future":{"value":7}}}`, &SessionPromptResult{}},
		"MCPServer":           {`{"type":"stdio","name":"local","command":"server","_meta":{"future":{"value":7}}}`, &MCPServer{}},
		"ContentBlock":        {`{"type":"text","text":"hello","_meta":{"future":{"value":7}}}`, &ContentBlock{}},
		"ToolCallContent":     {`{"type":"content","content":{"type":"text","text":"hello"},"_meta":{"future":{"value":7}}}`, &ToolCallContent{}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(test.raw), test.target); err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(test.target)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(raw, []byte(`"_meta":{"future":{"value":7}}`)) {
				t.Fatalf("%T dropped metadata: %s", test.target, raw)
			}
		})
	}
	for _, target := range types {
		t.Run(reflect.TypeOf(target).Elem().Name(), func(t *testing.T) {
			if err := json.Unmarshal([]byte(`{"_meta":{"future":{"value":7}}}`), target); err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(target)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(raw, []byte(`"_meta":{"future":{"value":7}}`)) {
				t.Fatalf("%T dropped metadata: %s", target, raw)
			}
		})
	}
}

func TestCXDeepSeekProviderIdentity(t *testing.T) {
	provider, ok := ParseACPProvider(" CX-DeepSeek ")
	if !ok || provider != ACPProviderCXDeepSeek {
		t.Fatalf("ParseACPProvider() = (%q, %v), want (%q, true)", provider, ok, ACPProviderCXDeepSeek)
	}

	count := 0
	for _, name := range ACPProviderNames() {
		if name == string(ACPProviderCXDeepSeek) {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("ACPProviderNames() = %v, want one %q", ACPProviderNames(), ACPProviderCXDeepSeek)
	}
}

func TestCXFlickerProviderIdentity(t *testing.T) {
	provider, ok := ParseACPProvider(" CX-Flicker ")
	if !ok || provider != ACPProviderCXFlicker {
		t.Fatalf("ParseACPProvider() = (%q, %v), want (%q, true)", provider, ok, ACPProviderCXFlicker)
	}

	count := 0
	for _, name := range ACPProviderNames() {
		if name == string(ACPProviderCXFlicker) {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("ACPProviderNames() = %v, want one %q", ACPProviderNames(), ACPProviderCXFlicker)
	}
}

func TestSessionUpdateParams_JSONParity(t *testing.T) {
	in := SessionUpdateParams{SessionID: "s1"}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out SessionUpdateParams
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.SessionID != "s1" {
		t.Fatalf("session id = %q", out.SessionID)
	}
}

func TestSessionUpdate_UsageUpdateFields(t *testing.T) {
	raw := []byte(`{
		"sessionId":"s1",
		"update":{
			"sessionUpdate":"usage_update",
			"size":258400,
			"used":183223
		}
	}`)

	var out SessionUpdateParams
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Update.SessionUpdate != SessionUpdateUsageUpdate {
		t.Fatalf("sessionUpdate=%q, want %q", out.Update.SessionUpdate, SessionUpdateUsageUpdate)
	}
	if out.Update.Size == nil || *out.Update.Size != 258400 {
		t.Fatalf("size=%v, want 258400", out.Update.Size)
	}
	if out.Update.Used == nil || *out.Update.Used != 183223 {
		t.Fatalf("used=%v, want 183223", out.Update.Used)
	}
}

func TestPermissionRequestParamsDecodeToolCallTextContent(t *testing.T) {
	raw := []byte(`{
		"sessionId":"sess-1",
		"toolCall":{
			"toolCallId":"call-1",
			"title":"Choose how to continue",
			"content":[
				{"type":"content","content":{"type":"text","text":"Which path should I take?"}},
				{"type":"diff","path":"secret.txt","newText":"do not retain"}
			],
			"rawInput":{"provider":"private"},
			"rawOutput":{"answer":"private"}
		},
		"options":[{"optionId":"continue","name":"Continue","kind":"allow_once"}]
	}`)

	var params PermissionRequestParams
	if err := json.Unmarshal(raw, &params); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if params.SessionID != "sess-1" || params.ToolCall.ToolCallID != "call-1" {
		t.Fatalf("permission identity = %#v", params)
	}
	if len(params.ToolCall.Content) != 2 {
		t.Fatalf("content count = %d, want 2", len(params.ToolCall.Content))
	}
	text := params.ToolCall.Content[0].Content
	if text == nil || text.Type != ContentBlockTypeText || text.Text != "Which path should I take?" {
		t.Fatalf("text content = %#v", text)
	}
	encoded, err := json.Marshal(params.ToolCall)
	if err != nil {
		t.Fatalf("marshal toolCall: %v", err)
	}
	if string(encoded) == "" || containsAny(string(encoded), "rawInput", "rawOutput", "provider", "answer") {
		t.Fatalf("toolCall retained private raw fields: %s", encoded)
	}
}

func TestPermissionTurnPayloadSerialization(t *testing.T) {
	requestJSON, err := json.Marshal(SessionTurnPermissionRequest{
		PermissionID: "perm-1",
		Title:        "Choose",
		DetailsText:  "Details",
		Options: []SessionTurnPermissionOption{{
			OptionID: "continue",
			Name:     "Continue",
			Kind:     "allow_once",
		}},
		CreatedAt: "2026-07-21T10:00:00Z",
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	for _, want := range []string{`"permissionId":"perm-1"`, `"detailsText":"Details"`, `"optionId":"continue"`} {
		if !containsAny(string(requestJSON), want) {
			t.Fatalf("request JSON %s missing %s", requestJSON, want)
		}
	}

	responseJSON, err := json.Marshal(SessionTurnPermissionResponse{
		PermissionID:     "perm-1",
		RequestTurnIndex: 20,
		Outcome:          "selected",
		OptionID:         "continue",
		OptionName:       "Continue",
		RespondedAt:      "2026-07-21T10:01:00Z",
	})
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	for _, forbidden := range []string{"detailsText", "options", `"title"`} {
		if containsAny(string(responseJSON), forbidden) {
			t.Fatalf("response JSON retained request field %q: %s", forbidden, responseJSON)
		}
	}
}

func TestSessionUpdateMetaMessagePhase(t *testing.T) {
	for _, phase := range []string{SessionMessagePhaseCommentary, SessionMessagePhaseFinalAnswer} {
		meta := BuildSessionUpdateMetaMessagePhase(phase)
		if got := SessionUpdateMetaMessagePhase(meta); got != phase {
			t.Fatalf("phase = %q, want %q; meta=%s", got, phase, meta)
		}
	}
	if meta := BuildSessionUpdateMetaMessagePhase("future_phase"); len(meta) != 0 {
		t.Fatalf("unknown phase meta = %s, want empty", meta)
	}
	if got := SessionUpdateMetaMessagePhase(json.RawMessage(`{"wm":{"messagePhase":"future_phase"}}`)); got != "" {
		t.Fatalf("unknown phase = %q, want empty", got)
	}
}

func TestSessionUpdateMetaRoundTripPreservesUnknownFields(t *testing.T) {
	original := json.RawMessage(`{"wm":{"messagePhase":"commentary"},"thirdParty":{"trace":"opaque"}}`)
	raw, err := json.Marshal(SessionUpdate{
		SessionUpdate: SessionUpdateAgentMessageChunk,
		Meta:          original,
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded SessionUpdate
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	var want, got any
	if err := json.Unmarshal(original, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(decoded.Meta, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("meta = %#v, want %#v", got, want)
	}
}

func TestMergeSessionUpdateMetaDeepMergesLifecycleAndUnknownFields(t *testing.T) {
	base := json.RawMessage(`{"wm":{"messagePhase":"commentary","nested":{"left":1}},"vendor":{"trace":"keep","array":[1]}}`)
	incoming := json.RawMessage(`{"wm":{"messagePhase":"final_answer","messageComplete":true,"nested":{"right":2}},"vendor":{"array":[2]}}`)
	merged, err := MergeSessionUpdateMeta(base, incoming)
	if err != nil {
		t.Fatal(err)
	}
	want := json.RawMessage(`{"wm":{"messagePhase":"final_answer","messageComplete":true,"nested":{"left":1,"right":2}},"vendor":{"trace":"keep","array":[2]}}`)
	if !jsonEqual(merged, want) {
		t.Fatalf("merged=%s, want %s", merged, want)
	}
	if phase := SessionUpdateMetaMessagePhase(merged); phase != SessionMessagePhaseFinalAnswer {
		t.Fatalf("phase=%q", phase)
	}
	if !SessionUpdateMetaMessageComplete(merged) {
		t.Fatal("messageComplete=false")
	}
}

func TestBuildSessionUpdateMetaLifecyclePreservesSteered(t *testing.T) {
	meta := BuildSessionUpdateMetaLifecycle("", true, true)
	if SessionUpdateMetaMessagePhase(meta) != "" || !SessionUpdateMetaMessageComplete(meta) || !SessionUpdateMetaSteered(meta) {
		t.Fatalf("meta=%s", meta)
	}
}

func TestWithoutSessionUpdateLifecyclePreservesOtherMetadata(t *testing.T) {
	meta := json.RawMessage(`{"wm":{"messagePhase":"commentary","messageComplete":true,"steered":true,"future":7},"vendor":{"trace":"keep"}}`)
	got := WithoutSessionUpdateLifecycle(meta)
	want := json.RawMessage(`{"wm":{"future":7},"vendor":{"trace":"keep"}}`)
	if !jsonEqual(got, want) {
		t.Fatalf("metadata=%s, want %s", got, want)
	}
}

func TestSessionCapabilitiesRoundTripPreservesStandardLifecycleFields(t *testing.T) {
	raw := []byte(`{"sessionCapabilities":{"fork":{},"delete":{},"resume":{},"close":{},"additionalDirectories":{}}}`)
	var capabilities AgentCapabilities
	if err := json.Unmarshal(raw, &capabilities); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(capabilities)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"\"fork\"", "\"delete\"", "\"resume\"", "\"close\"", "\"additionalDirectories\""} {
		if !bytes.Contains(encoded, []byte(field)) {
			t.Fatalf("encoded capabilities=%s, missing %s", encoded, field)
		}
	}
}

func TestAgentCapabilitiesRoundTripPreservesUnknownFields(t *testing.T) {
	raw := []byte(`{"loadSession":true,"providers":{"list":{}},"sessionCapabilities":{"fork":{},"futureLifecycle":{"mode":"future"}}}`)
	var capabilities AgentCapabilities
	if err := json.Unmarshal(raw, &capabilities); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(capabilities)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"\"providers\"", "\"futureLifecycle\""} {
		if !bytes.Contains(encoded, []byte(field)) {
			t.Fatalf("encoded capabilities=%s, missing %s", encoded, field)
		}
	}
}

func TestSessionActionsExposeStandardCurrentForkAndLegacyHistoricalFork(t *testing.T) {
	var standard AgentCapabilities
	if err := json.Unmarshal([]byte(`{"sessionCapabilities":{"fork":{}}}`), &standard); err != nil {
		t.Fatal(err)
	}
	standard.LoadSession = true
	standardActions := SessionActionsFromAgentCapabilities(standard)
	if !standardActions.Fork.Supported || !standardActions.Fork.CurrentSession || standardActions.Fork.HistoricalTurn {
		t.Fatalf("standard fork actions=%#v, want current-only", standardActions.Fork)
	}

	verified := standard
	verified.Meta = BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		SessionActions: WMSessionActionCapabilities{CurrentSession: true},
	})
	verifiedActions := SessionActionsFromAgentCapabilities(verified)
	if !verifiedActions.Fork.Supported || !verifiedActions.Fork.CurrentSession || verifiedActions.Fork.HistoricalTurn {
		t.Fatalf("verified standard fork actions=%#v, want current-only", verifiedActions.Fork)
	}

	codex := AgentCapabilities{
		LoadSession:         true,
		SessionCapabilities: &SessionCapabilities{Fork: &SessionForkCapability{}},
		Meta: BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
			SessionActions: WMSessionActionCapabilities{Fork: true},
		}),
	}
	codexActions := SessionActionsFromAgentCapabilities(codex)
	if !codexActions.Fork.Supported || !codexActions.Fork.CurrentSession || !codexActions.Fork.HistoricalTurn {
		t.Fatalf("codex fork actions=%#v, want current and historical", codexActions.Fork)
	}

	legacy := AgentCapabilities{Meta: BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		SessionActions: WMSessionActionCapabilities{Fork: true},
	})}
	legacyJSON, err := json.Marshal(SessionActionsFromAgentCapabilities(legacy))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(legacyJSON, []byte(`"historicalTurn":true`)) {
		t.Fatalf("legacy fork actions=%s, want historicalTurn=true", legacyJSON)
	}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if len(needle) > 0 && len(value) >= len(needle) {
			for index := 0; index+len(needle) <= len(value); index++ {
				if value[index:index+len(needle)] == needle {
					return true
				}
			}
		}
	}
	return false
}

func TestDecodeSessionUpdateIgnoresUnknownRootFields(t *testing.T) {
	for _, raw := range []string{
		`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"},"contentBlocks":[]}`,
		`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"},"clientMessageId":"m1"}`,
		`{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"x"},"steered":true}`,
		`{"sessionUpdate":"tool_call_update","toolCallId":"c","toolCallContent":[]}`,
		`{"sessionUpdate":"usage_update","size":10,"used":2,"updatedAt":"2026-08-02T00:00:00Z"}`,
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := DecodeSessionUpdate(json.RawMessage(raw)); err != nil {
				t.Fatalf("DecodeSessionUpdate(%s): %v", raw, err)
			}
		})
	}
	if _, err := DecodeSessionUpdate(json.RawMessage(`{"sessionUpdate":"current_mode_update","modeId":"plan"}`)); err == nil {
		t.Fatal("legacy mode update without currentModeId succeeded")
	}
}

func TestDecodeSessionUpdateUsesStrictVariants(t *testing.T) {
	tests := []struct {
		raw      string
		wantType any
	}{
		{`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1"}`, MessageChunkUpdate{}},
		{`{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking"}}`, MessageChunkUpdate{}},
		{`{"sessionUpdate":"tool_call","toolCallId":"c1","title":"Read","kind":"read","status":"pending","content":[],"locations":[],"rawInput":{},"rawOutput":{}}`, ToolCallUpdate{}},
		{`{"sessionUpdate":"tool_call_update","toolCallId":"c1","status":"completed","content":[{"type":"content","content":{"type":"text","text":"done"}}]}`, ToolCallUpdate{}},
		{`{"sessionUpdate":"current_mode_update","currentModeId":"code"}`, CurrentModeUpdate{}},
		{`{"sessionUpdate":"usage_update","size":128000,"used":42}`, UsageUpdate{}},
	}
	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			got, err := DecodeSessionUpdate(json.RawMessage(tt.raw))
			if err != nil {
				t.Fatal(err)
			}
			if reflect.TypeOf(got) != reflect.TypeOf(tt.wantType) {
				t.Fatalf("type=%T, want %T", got, tt.wantType)
			}
		})
	}
}

func TestSessionUpdateVariantMetaRoundTripPreservesUnknownFields(t *testing.T) {
	original := json.RawMessage(`{"wm":{"messagePhase":"commentary","future":{"flag":true}},"thirdParty":{"trace":"opaque"}}`)
	update := MessageChunkUpdate{
		SessionUpdate: SessionUpdateAgentMessageChunk,
		Content:       ContentBlock{Type: ContentBlockTypeText, Text: "hello"},
		MessageID:     "m1",
		Meta:          original,
	}
	raw, err := json.Marshal(update)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeSessionUpdate(raw)
	if err != nil {
		t.Fatal(err)
	}
	got := decoded.(MessageChunkUpdate).Meta
	var wantValue, gotValue any
	if err := json.Unmarshal(original, &wantValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("meta=%s, want %s", got, original)
	}
}

func TestSessionUpdateParamsWireMarshalsACPFieldNames(t *testing.T) {
	raw, err := json.Marshal(SessionUpdateParamsWire{
		SessionID: "s1",
		Update: MessageChunkUpdate{
			SessionUpdate: SessionUpdateAgentMessageChunk,
			Content:       ContentBlock{Type: ContentBlockTypeText, Text: "hello"},
			MessageID:     "m1",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1"}}` {
		t.Fatalf("raw=%s", raw)
	}
	if _, err := DecodeSessionUpdateParams(raw); err != nil {
		t.Fatalf("strict decode: %v", err)
	}
}

func TestSessionPromptResultIgnoresUnknownFieldsAndRejectsInvalidStopReason(t *testing.T) {
	var result SessionPromptResult
	if err := json.Unmarshal([]byte(`{"stopReason":"end_turn","message":"private"}`), &result); err != nil {
		t.Fatalf("forward-compatible result: %v", err)
	}
	if result.StopReason != "end_turn" {
		t.Fatalf("stopReason=%q, want end_turn", result.StopReason)
	}
	if err := json.Unmarshal([]byte(`{"stopReason":"failed"}`), &result); err == nil {
		t.Fatal("invalid failed stopReason succeeded")
	}
	var outcome PromptOutcome
	if err := json.Unmarshal([]byte(`{"stopReason":"refusal","_meta":{"wm":{"message":"declined"}}}`), &outcome); err != nil {
		t.Fatal(err)
	}
	if outcome.Message != "declined" {
		t.Fatalf("message=%q", outcome.Message)
	}
}

func TestStrictNestedUnionsRejectCrossVariantFields(t *testing.T) {
	contentCases := []string{
		`{"type":"text","text":"hello","data":"not-text"}`,
		`{"type":"image","mimeType":"image/png","data":"abc","text":"not-image"}`,
		`{"type":"resource_link","uri":"file:///x","name":"x","resource":{"uri":"file:///x","text":"x"}}`,
	}
	for _, raw := range contentCases {
		if err := ValidateContentBlockJSON(json.RawMessage(raw)); err == nil {
			t.Fatalf("ValidateContentBlockJSON(%s) succeeded", raw)
		}
	}
	toolCases := []string{
		`{"type":"content","content":{"type":"text","text":"x"},"path":"x"}`,
		`{"type":"diff","path":"x","newText":"y","terminalId":"term"}`,
	}
	for _, raw := range toolCases {
		if err := ValidateToolCallContentJSON(json.RawMessage(raw)); err == nil {
			t.Fatalf("ValidateToolCallContentJSON(%s) succeeded", raw)
		}
	}
	if _, err := json.Marshal(ContentBlock{Type: ContentBlockTypeText, Text: "hello", Data: "not-text"}); err == nil {
		t.Fatal("invalid ContentBlock marshal succeeded")
	}
	if _, err := json.Marshal(ToolCallContent{Type: "terminal", TerminalID: "term", Path: "not-terminal"}); err == nil {
		t.Fatal("invalid ToolCallContent marshal succeeded")
	}
}

func TestInboundNestedUnionsIgnoreUnknownFields(t *testing.T) {
	var content ContentBlock
	if err := json.Unmarshal([]byte(`{"type":"text","text":"hello","data":"not-text","future":true}`), &content); err != nil {
		t.Fatalf("content: %v", err)
	}
	if content.Type != ContentBlockTypeText || content.Text != "hello" || content.Data != "" {
		t.Fatalf("content=%#v", content)
	}

	var toolContent ToolCallContent
	if err := json.Unmarshal([]byte(`{"type":"content","content":{"type":"text","text":"done"},"path":"ignored","future":true}`), &toolContent); err != nil {
		t.Fatalf("tool content: %v", err)
	}
	if toolContent.Type != "content" || toolContent.Content == nil || toolContent.Path != "" {
		t.Fatalf("toolContent=%#v", toolContent)
	}

	var server MCPServer
	if err := json.Unmarshal([]byte(`{"type":"stdio","name":"local","command":"server","args":[],"env":[],"url":"https://ignored.example","future":true}`), &server); err != nil {
		t.Fatalf("mcp server: %v", err)
	}
	if server.Type != "stdio" || server.Command != "server" || server.URL != "" {
		t.Fatalf("server=%#v", server)
	}
}

func TestSessionUpdateVariantMarshalHasExactRootFields(t *testing.T) {
	raw, err := json.Marshal(MessageChunkUpdate{
		SessionUpdate: SessionUpdateAgentMessageChunk,
		Content:       ContentBlock{Type: ContentBlockTypeText, Text: "hello"},
		MessageID:     "m1",
		Meta:          json.RawMessage(`{"wm":{"messageComplete":true}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"sessionUpdate": true, "content": true, "messageId": true, "_meta": true}
	for key := range object {
		if !allowed[key] {
			t.Fatalf("unexpected root field %q in %s", key, raw)
		}
	}
}

func TestSessionConfigOptionStrictVariants(t *testing.T) {
	selectRaw := json.RawMessage(`{"id":"model","name":"Model","category":"model","type":"select","currentValue":"fast","options":[{"value":"fast","name":"Fast","_meta":{"vendor":1}}],"_meta":{"wm":{"x":1}}}`)
	option, err := DecodeSessionConfigOption(selectRaw)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := option.Variant.(SessionConfigSelect); !ok {
		t.Fatalf("variant=%T, want SessionConfigSelect", option.Variant)
	}
	encoded, err := json.Marshal(option)
	if err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(encoded, selectRaw) {
		t.Fatalf("encoded=%s, want %s", encoded, selectRaw)
	}

	booleanRaw := json.RawMessage(`{"id":"fast","name":"Fast mode","type":"boolean","currentValue":true}`)
	option, err = DecodeSessionConfigOption(booleanRaw)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := option.Variant.(SessionConfigBoolean); !ok {
		t.Fatalf("variant=%T, want SessionConfigBoolean", option.Variant)
	}
	option, err = DecodeSessionConfigOption(json.RawMessage(`{"id":"fast","name":"Fast mode","type":"boolean","currentValue":true,"options":[],"future":true}`))
	if err != nil {
		t.Fatalf("forward-compatible boolean option: %v", err)
	}

	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"id":"bad","name":"Bad","type":"select","currentValue":"x"}`),
		json.RawMessage(`{"id":"bad","name":"Bad","type":"future","currentValue":"x"}`),
	} {
		if _, err := DecodeSessionConfigOption(raw); err == nil {
			t.Fatalf("DecodeSessionConfigOption(%s) succeeded", raw)
		}
	}
}

func TestSetSessionConfigOptionStrictValueAndWrappedResponse(t *testing.T) {
	valueID, err := DecodeSetSessionConfigOptionRequest(json.RawMessage(`{"sessionId":"s1","configId":"model","value":"fast","_meta":{"trace":1}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := valueID.Variant.(SetSessionConfigValueID); !ok {
		t.Fatalf("variant=%T, want SetSessionConfigValueID", valueID.Variant)
	}
	boolean, err := DecodeSetSessionConfigOptionRequest(json.RawMessage(`{"sessionId":"s1","configId":"fast","type":"boolean","value":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := boolean.Variant.(SetSessionConfigBoolean); !ok {
		t.Fatalf("variant=%T, want SetSessionConfigBoolean", boolean.Variant)
	}
	if _, err := DecodeSetSessionConfigOptionRequest(json.RawMessage(`{"sessionId":"s1","configId":"fast","value":true}`)); err == nil {
		t.Fatal("boolean value without type succeeded")
	}
	if _, err := DecodeSetSessionConfigOptionResponse(json.RawMessage(`[]`)); err == nil {
		t.Fatal("bare config option array response succeeded")
	}
	if _, err := DecodeSetSessionConfigOptionResponse(json.RawMessage(`{"configOptions":[],"future":true}`)); err != nil {
		t.Fatal(err)
	}
}

func TestAvailableCommandInputUsesHintShape(t *testing.T) {
	valid := json.RawMessage(`{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"review","description":"Review changes","input":{"hint":"path","_meta":{"x":1}}}]}`)
	if _, err := DecodeSessionUpdate(valid); err != nil {
		t.Fatal(err)
	}
	forwardCompatible := json.RawMessage(`{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"review","description":"Review changes","input":{"hint":"path","type":"future"}}]}`)
	if _, err := DecodeSessionUpdate(forwardCompatible); err != nil {
		t.Fatalf("forward-compatible command input: %v", err)
	}
}

func TestMCPServerStrictVariants(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"type":"stdio","name":"local","command":"server","args":[],"env":[]}`),
		json.RawMessage(`{"type":"http","name":"remote","url":"https://example.test/mcp","headers":[]}`),
		json.RawMessage(`{"type":"sse","name":"events","url":"https://example.test/sse","headers":[]}`),
	} {
		if err := ValidateMCPServerJSON(raw); err != nil {
			t.Fatalf("ValidateMCPServerJSON(%s): %v", raw, err)
		}
	}
	if err := ValidateMCPServerJSON(json.RawMessage(`{"type":"stdio","name":"bad","command":"server","args":[],"env":[],"url":"https://example.test"}`)); err == nil {
		t.Fatal("cross-variant MCP fields succeeded")
	}
	if _, err := json.Marshal(MCPServer{Type: "stdio", Name: "bad", Command: "server", URL: "https://example.test"}); err == nil {
		t.Fatal("cross-variant MCP marshal succeeded")
	}
}

func jsonEqual(left, right []byte) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func TestNegotiateWMExtensionsRequiresVersionIntersection(t *testing.T) {
	client := BuildWMClientCapabilitiesMeta(json.RawMessage(`{"vendor":{"keep":true}}`))
	agent := BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		MessageLifecycle: true,
		GoalLifecycle:    true,
		SessionActions: WMSessionActionCapabilities{
			Steer: true, Compact: true, Goal: true, Fork: true, Archive: true,
		},
	})
	got := NegotiateWMExtensions(client, agent)
	if !got.MessageLifecycle || !got.GoalLifecycle || !got.SessionActions.Steer || !got.SessionActions.Archive {
		t.Fatalf("negotiated=%#v", got)
	}
	if got := NegotiateWMExtensions(nil, agent); got.MessageLifecycle || got.SessionActions.Steer {
		t.Fatalf("agent-only capabilities negotiated: %#v", got)
	}
}

func TestWMActionRPCErrorCarriesStableDataCode(t *testing.T) {
	err := NewWMActionRPCError(WMActionErrorBusy, "turn already running")
	code, ok := WMActionErrorCode(err)
	if !ok || code != WMActionErrorBusy {
		t.Fatalf("WMActionErrorCode() = %q, %v", code, ok)
	}
	var data WMActionErrorData
	if decodeErr := json.Unmarshal(err.Data, &data); decodeErr != nil || data.Message != "turn already running" {
		t.Fatalf("error data = %s, err=%v", err.Data, decodeErr)
	}
}

func TestSessionActionsProjectOnlyNegotiatedAgentCapabilities(t *testing.T) {
	capabilities := AgentCapabilities{Meta: BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		SessionActions: WMSessionActionCapabilities{Compact: true, Goal: true},
	})}
	actions := SessionActionsFromAgentCapabilities(capabilities)
	if !actions.Status.Supported || !actions.Compact.Supported || !actions.Goal.Supported {
		t.Fatalf("negotiated actions=%#v", actions)
	}
	if actions.Steer.Supported || actions.Fork.Supported {
		t.Fatalf("unadvertised actions=%#v", actions)
	}
	unnegotiated := SessionActionsFromAgentCapabilities(AgentCapabilities{})
	if !unnegotiated.Status.Supported || unnegotiated.Compact.Supported || unnegotiated.Goal.Supported {
		t.Fatalf("unnegotiated actions=%#v", unnegotiated)
	}
}

func TestSessionActionsCompactFromAdvertisedCommand(t *testing.T) {
	tests := []struct {
		name      string
		commands  []AvailableCommand
		supported bool
	}{
		{name: "bare compact", commands: []AvailableCommand{{Name: "compact"}}, supported: true},
		{name: "slash compact", commands: []AvailableCommand{{Name: "/compact"}}, supported: true},
		{name: "case insensitive", commands: []AvailableCommand{{Name: "/CoMpAcT"}}, supported: true},
		{name: "unrelated", commands: []AvailableCommand{{Name: "review"}}},
		{name: "prefix is not compact", commands: []AvailableCommand{{Name: "compact-now"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actions := SessionActionsFromState(SessionCapabilityState{Commands: tt.commands})
			if actions.Compact.Supported != tt.supported {
				t.Fatalf("compact support = %t, want %t; actions=%#v", actions.Compact.Supported, tt.supported, actions)
			}
		})
	}
}

func TestDecodeWMGoalNotificationValidatesEventShape(t *testing.T) {
	valid := []string{
		`{"sessionId":"s1","event":"updated","goal":{"sessionId":"s1","objective":"ship","status":"active","tokenBudget":null,"tokensUsed":0,"timeUsedSeconds":0,"createdAt":1,"updatedAt":1},"_meta":{"vendor":{"keep":true}}}`,
		`{"sessionId":"s1","event":"cleared"}`,
		`{"sessionId":"s1","event":"turn_started","turnId":"t1"}`,
		`{"sessionId":"s1","event":"turn_completed","turnId":"t1"}`,
	}
	for _, raw := range valid {
		if _, err := DecodeWMGoalNotification(json.RawMessage(raw)); err != nil {
			t.Fatalf("valid %s: %v", raw, err)
		}
	}
	invalid := []string{
		`{"sessionId":"s1","event":"updated"}`,
		`{"sessionId":"s1","event":"cleared","goal":{"sessionId":"s1"}}`,
		`{"sessionId":"s1","event":"turn_started"}`,
		`{"sessionId":"s1","event":"future"}`,
		`{"sessionId":"s1","event":"cleared","private":true}`,
	}
	for _, raw := range invalid {
		if _, err := DecodeWMGoalNotification(json.RawMessage(raw)); err == nil {
			t.Fatalf("invalid %s accepted", raw)
		}
	}
}

func TestWMExtensionMethodsUseReservedNamespace(t *testing.T) {
	methods := []string{
		MethodWMSessionSteer, MethodWMSessionCompact, MethodWMSessionGoalSet,
		MethodWMSessionGoalGet, MethodWMSessionGoalClear, MethodWMSessionForkResolve,
		MethodWMSessionFork, MethodWMSessionArchive, MethodWMSessionGoal,
	}
	for _, method := range methods {
		if len(method) < 4 || method[:4] != "_wm/" {
			t.Fatalf("method=%q", method)
		}
	}
}

func TestWMSessionForkExtensionUsesStablePromptFieldNames(t *testing.T) {
	turnIndex := int64(7)
	meta := BuildWMSessionForkMeta(nil, WMSessionForkExtension{
		Ref:       "turn-7",
		TurnIndex: &turnIndex,
		Prompts: []SessionForkPrompt{{
			DoneTurnIndex: 7,
			ContentBlocks: []ContentBlock{{Type: ContentBlockTypeText, Text: "follow up"}},
		}},
	})
	if !bytes.Contains(meta, []byte(`"doneTurnIndex":7`)) || !bytes.Contains(meta, []byte(`"contentBlocks"`)) {
		t.Fatalf("fork metadata=%s, want stable prompt field names", meta)
	}
	decoded, ok := WMSessionForkExtensionFromMeta(meta)
	if !ok || decoded.Ref != "turn-7" || decoded.TurnIndex == nil || *decoded.TurnIndex != 7 || len(decoded.Prompts) != 1 {
		t.Fatalf("decoded fork extension=%#v, ok=%v", decoded, ok)
	}
	if decoded.Prompts[0].DoneTurnIndex != 7 || len(decoded.Prompts[0].ContentBlocks) != 1 {
		t.Fatalf("decoded prompts=%#v", decoded.Prompts)
	}
}

func TestWMSessionForkResultExtensionRoundTripsWithoutDiscardingBaseMeta(t *testing.T) {
	meta := BuildWMSessionForkResultMeta(json.RawMessage(`{"vendor":{"keep":true}}`), WMSessionForkResultExtension{
		Title: "Forked thread",
		ForkPoints: map[int64]SessionForkPoint{
			3: {Provider: "codex", Ref: "target-turn-1"},
		},
	})
	if !bytes.Contains(meta, []byte(`"vendor":{"keep":true}`)) {
		t.Fatalf("fork result metadata=%s, base metadata was discarded", meta)
	}
	decoded, ok := WMSessionForkResultExtensionFromMeta(meta)
	if !ok || decoded.Title != "Forked thread" || decoded.ForkPoints[3].Ref != "target-turn-1" {
		t.Fatalf("decoded fork result extension=%#v, ok=%v", decoded, ok)
	}
}

func TestProjectACPUpdateProducesTypedAgentEvent(t *testing.T) {
	receivedAt := time.Date(2026, 8, 2, 1, 2, 3, 0, time.UTC)
	params, err := DecodeSessionUpdateParams(json.RawMessage(`{
		"sessionId":"s1",
		"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1","_meta":{"wm":{"messagePhase":"commentary"},"vendor":{"trace":1}}},
		"_meta":{"envelope":{"sequence":9}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	event, err := ProjectSessionUpdate(params, receivedAt)
	if err != nil {
		t.Fatal(err)
	}
	message, ok := event.Update.(AgentMessageEvent)
	if !ok {
		t.Fatalf("update=%T, want AgentMessageEvent", event.Update)
	}
	if event.SessionID != "s1" || message.MessageID != "m1" || message.Content.Text != "hello" || !message.ReceivedAt.Equal(receivedAt) {
		t.Fatalf("event=%#v", event)
	}
	if string(message.Meta) != `{"wm":{"messagePhase":"commentary"},"vendor":{"trace":1}}` {
		t.Fatalf("meta=%s", message.Meta)
	}
}

func TestDecodeSessionUpdateParamsIgnoresUnknownEnvelopeAndRejectsInvalidUpdate(t *testing.T) {
	valid := json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"},"status":"streaming"},"private":true}`)
	if _, err := DecodeSessionUpdateParams(valid); err != nil {
		t.Fatalf("forward-compatible update: %v", err)
	}
	invalid := json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"future_update"}}`)
	if _, err := DecodeSessionUpdateParams(invalid); err == nil {
		t.Fatalf("DecodeSessionUpdateParams(%s) succeeded", invalid)
	}
}

func TestProjectToolUpdatePreservesRichFields(t *testing.T) {
	params, err := DecodeSessionUpdateParams(json.RawMessage(`{
		"sessionId":"s1",
		"update":{
			"sessionUpdate":"tool_call_update",
			"toolCallId":"call-1",
			"title":"Run",
			"kind":"execute",
			"status":"completed",
			"content":[{"type":"terminal","terminalId":"term-1","_meta":{"vendor":1}}],
			"locations":[{"path":"main.go","line":4,"_meta":{"vendor":2}}],
			"rawInput":{"command":"go test"},
			"rawOutput":{"exitCode":0},
			"_meta":{"vendor":{"trace":"abc"}}
		}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	event, err := ProjectSessionUpdate(params, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	tool, ok := event.Update.(AgentToolEvent)
	if !ok {
		t.Fatalf("update=%T, want AgentToolEvent", event.Update)
	}
	if len(tool.Content) != 1 || len(tool.Locations) != 1 || len(tool.RawInput) == 0 || len(tool.RawOutput) == 0 || len(tool.Meta) == 0 {
		t.Fatalf("tool=%#v", tool)
	}
}

func TestSessionQueueRequestRoundTrip(t *testing.T) {
	raw := []byte(`{"sessionId":"sess-1","action":"enqueue","item":{"itemId":"item-1","kind":"prompt","createdAt":"2026-07-31T10:00:00Z","blocks":[{"type":"text","text":"hello"}]}}`)
	var got SessionQueueRequest
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != "sess-1" || got.Action != SessionQueueActionEnqueue || got.Item == nil ||
		got.Item.ItemID != "item-1" || got.Item.Kind != SessionQueueItemKindPrompt ||
		len(got.Item.Blocks) != 1 || got.Item.Blocks[0].Text != "hello" {
		t.Fatalf("request = %#v", got)
	}
}

func TestSessionQueueSnapshotRoundTrip(t *testing.T) {
	snapshot := SessionQueueSnapshot{
		Generation:   "generation-1",
		Revision:     4,
		ActiveKind:   SessionQueueItemKindPrompt,
		WaitingCount: 1,
		ActiveItem: &SessionQueueItem{
			ItemID:          "active-1",
			Kind:            SessionQueueItemKindPrompt,
			Status:          SessionQueueItemStatusRunning,
			CreatedAt:       "2026-07-31T10:00:00Z",
			CancelSupported: true,
		},
		WaitingItems: []SessionQueueItem{{
			ItemID:          "waiting-1",
			Kind:            SessionQueueItemKindCompact,
			Status:          SessionQueueItemStatusQueued,
			CreatedAt:       "2026-07-31T10:01:00Z",
			CancelSupported: true,
		}},
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var got SessionQueueSnapshot
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Generation != snapshot.Generation || got.Revision != snapshot.Revision ||
		got.ActiveItem == nil || got.ActiveItem.Status != SessionQueueItemStatusRunning ||
		len(got.WaitingItems) != 1 || got.WaitingItems[0].Kind != SessionQueueItemKindCompact {
		t.Fatalf("snapshot = %#v", got)
	}
}
