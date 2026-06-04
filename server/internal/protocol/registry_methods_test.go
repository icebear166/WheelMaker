package protocol

import "testing"

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
	if !RegistryMethodAllowed(string(RegistryRoleHub), RegistryMethodRegistryReportProjects) {
		t.Fatal("hub should be allowed to report projects")
	}
	if RegistryMethodAllowed(string(RegistryRoleClient), RegistryMethodRegistryReportProjects) {
		t.Fatal("client should not be allowed to report projects")
	}
	if !RegistryClientForwardMethod(RegistryMethodSessionSend) {
		t.Fatal("session.send should be a client forward method")
	}
	if !RegistryHubCommandMethod(RegistryMethodCmdSkills) {
		t.Fatal("cmd.skills should be a hub command method")
	}
	if !RegistryLocalReadMethodAllowed(RegistryMethodFSRead) {
		t.Fatal("fs.read should be allowed on local read")
	}
	if !RegistryHubCommandMethod(RegistryMethodFSIndexStatus) {
		t.Fatal("fs.index.status should be a hub command method")
	}
	if !RegistryLocalReadMethodAllowed(RegistryMethodFSIndexSearch) {
		t.Fatal("fs.index.search should be allowed on local read")
	}
	if !RegistryLocalReadMethodAllowed(RegistryMethodFSIndexRebuild) {
		t.Fatal("fs.index.rebuild should be allowed on local read")
	}
	if RegistryLocalReadMethodAllowed(RegistryMethodSessionList) {
		t.Fatal("session.list should not be allowed on local read")
	}
}

func TestRegistryHubSessionEventMapping(t *testing.T) {
	method, ok := RegistryHubSessionEventMethod(RegistryMethodRegistrySessionMessage)
	if !ok {
		t.Fatal("registry.session.message should map to a client event")
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
