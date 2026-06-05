package protocol

import "testing"

func TestRegistryDefaultProtocolVersionIs25(t *testing.T) {
	if DefaultProtocolVersion != "2.5" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.5", DefaultProtocolVersion)
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
	if !RegistryClientForwardMethod(RegistryMethodSessionSend) {
		t.Fatal("session.send should be a client forward method")
	}
	if RegistryHubCommandMethod("cmd.skills") {
		t.Fatal("cmd.skills should not be a public hub command method")
	}
	if !RegistryLocalReadMethodAllowed(RegistryMethodProjectFSRead) {
		t.Fatal("project.fs.read should be allowed on local read")
	}
	if RegistryHubCommandMethod("fs.index.status") {
		t.Fatal("fs.index.status should not be a public hub command method")
	}
	if !RegistryLocalReadMethodAllowed(RegistryMethodProjectFSIndexSearch) {
		t.Fatal("project.fs.index.search should be allowed on local read")
	}
	if RegistryLocalReadMethodAllowed("fs.index.rebuild") {
		t.Fatal("fs.index.rebuild should not be allowed on local read")
	}
	syncCheck, ok := RegistryMethod(RegistryMethodProjectSyncCheck)
	if !ok {
		t.Fatal("project.sync.check should be registered")
	}
	if syncCheck.Route != RegistryRouteProjectCache {
		t.Fatalf("project.sync.check route=%q, want %q", syncCheck.Route, RegistryRouteProjectCache)
	}
	if !syncCheck.RequiresProjectID {
		t.Fatal("project.sync.check should require projectId")
	}
	if !syncCheck.LocalRead {
		t.Fatal("project.sync.check should be allowed on local read")
	}
	if RegistryLocalReadMethodAllowed(RegistryMethodSessionList) {
		t.Fatal("session.list should not be allowed on local read")
	}
}

func TestRegistryProtocolDomainTargetMethods(t *testing.T) {
	targets := []string{
		"connect.close",
		"connect.localRead.proof",
		"hub.report.projects",
		"hub.report.project",
		"registry.project.list",
		"registry.project.report",
		"project.sync.check",
		"project.fs.list",
		"project.fs.info",
		"project.fs.read",
		"project.fs.search",
		"project.fs.grep",
		"project.fs.index.search",
		"project.git.refs",
		"project.git.log",
		"project.git.commit.files",
		"project.git.commit.fileDiff",
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
}

func TestRegistryProtocolDomainOldMethodsAreRemoved(t *testing.T) {
	oldMethods := []string{
		"connection.closing",
		"local_read.proof",
		"registry.reportProjects",
		"registry.updateProject",
		"registry.session.updated",
		"registry.session.message",
		"project.list",
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
		"relay.status",
		"relay.enable",
		"relay.disable",
		"relay.regenerateAccessCode",
		"relay.open",
		"relay.close",
	}
	for _, method := range oldMethods {
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
		if !desc.Batchable {
			t.Fatalf("%s should be batchable", method)
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
