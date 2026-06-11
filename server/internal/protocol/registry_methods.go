package protocol

import "strings"

const (
	RegistryEnvelopeTypeRequest  = "request"
	RegistryEnvelopeTypeResponse = "response"
	RegistryEnvelopeTypeEvent    = "event"
	RegistryEnvelopeTypeError    = "error"
)

type RegistryRole string

const (
	RegistryRoleHub       RegistryRole = "hub"
	RegistryRoleClient    RegistryRole = "client"
	RegistryRoleMonitor   RegistryRole = "monitor"
	RegistryRoleLocalRead RegistryRole = "local_read"
)

type RegistryRouteKind string

const (
	RegistryRouteConnect         RegistryRouteKind = "connect"
	RegistryRouteBatch           RegistryRouteKind = "batch"
	RegistryRouteHubControl      RegistryRouteKind = "hub_control"
	RegistryRouteHubReport       RegistryRouteKind = "hub_report"
	RegistryRouteHubState        RegistryRouteKind = "hub_state"
	RegistryRouteHubSessionEvent RegistryRouteKind = "hub_session_event"
	RegistryRouteProjectCache    RegistryRouteKind = "project_cache"
	RegistryRouteProjectForward  RegistryRouteKind = "project_forward"
	RegistryRouteSessionForward  RegistryRouteKind = "session_forward"
	RegistryRouteHubCommand      RegistryRouteKind = "hub_command"
	RegistryRouteMonitorCache    RegistryRouteKind = "monitor_cache"
	RegistryRouteMonitorForward  RegistryRouteKind = "monitor_forward"
	RegistryRouteRelayControl    RegistryRouteKind = "relay_control"
	RegistryRouteRelayHub        RegistryRouteKind = "relay_hub"
	RegistryRouteSpeech          RegistryRouteKind = "speech"
	RegistryRouteClientEvent     RegistryRouteKind = "client_event"
	RegistryRouteLocalRead       RegistryRouteKind = "local_read"
	RegistryRouteDebug           RegistryRouteKind = "debug"
)

const (
	RegistryMethodConnectInit           = "connect.init"
	RegistryMethodConnectClose          = "connect.close"
	RegistryMethodConnectLocalReadProof = "connect.localRead.proof"
	RegistryMethodBatch                 = "batch"
	RegistryMethodHubPing               = "hub.ping"
	RegistryMethodHubStateGet           = "hub.state.get"
	RegistryMethodHubStateRefresh       = "hub.state.refresh"
	RegistryMethodHubStateAction        = "hub.state.action"
	RegistryMethodHubStateUpdated       = "hub.state.updated"
	RegistryMethodDebugUploadLog        = "debug.uploadLog"

	RegistryMethodHubReportProjects             = "hub.report.projects"
	RegistryMethodHubReportProject              = "hub.report.project"
	RegistryMethodRegistryProjectList           = "registry.project.list"
	RegistryMethodRegistryProjectReport         = "registry.project.report"
	RegistryMethodProjectSyncCheck              = "project.sync.check"
	RegistryMethodProjectFSList                 = "project.fs.list"
	RegistryMethodProjectFSInfo                 = "project.fs.info"
	RegistryMethodProjectFSRead                 = "project.fs.read"
	RegistryMethodProjectFSSearch               = "project.fs.search"
	RegistryMethodProjectFSGrep                 = "project.fs.grep"
	RegistryMethodProjectFSIndexSearch          = "project.fs.index.search"
	RegistryMethodProjectGitRefs                = "project.git.refs"
	RegistryMethodProjectGitLog                 = "project.git.log"
	RegistryMethodProjectGitCommitFiles         = "project.git.commit.files"
	RegistryMethodProjectGitCommitFileDiff      = "project.git.commit.fileDiff"
	RegistryMethodProjectGitDiff                = "project.git.diff"
	RegistryMethodProjectGitDiffFileDiff        = "project.git.diff.fileDiff"
	RegistryMethodProjectGitStatus              = "project.git.status"
	RegistryMethodProjectGitWorkingTreeFileDiff = "project.git.workingTree.fileDiff"

	RegistryMethodSessionUpdated = "session.updated"
	RegistryMethodSessionMessage = "session.message"

	RegistryMethodSessionList             = "session.list"
	RegistryMethodSessionRead             = "session.read"
	RegistryMethodSessionSearch           = "session.search"
	RegistryMethodSessionCreate           = "session.create"
	RegistryMethodSessionResumeList       = "session.resume.list"
	RegistryMethodSessionResumeImport     = "session.resume.import"
	RegistryMethodSessionReload           = "session.reload"
	RegistryMethodSessionArchive          = "session.archive"
	RegistryMethodSessionArchiveList      = "session.archive.list"
	RegistryMethodSessionArchiveRead      = "session.archive.read"
	RegistryMethodSessionArchiveRestore   = "session.archive.restore"
	RegistryMethodSessionArtifactRead     = "session.artifact.read"
	RegistryMethodSessionDelete           = "session.delete"
	RegistryMethodSessionRename           = "session.rename"
	RegistryMethodSessionSend             = "session.send"
	RegistryMethodSessionCancel           = "session.cancel"
	RegistryMethodSessionMarkRead         = "session.markRead"
	RegistryMethodSessionConfig           = "session.config"
	RegistryMethodSessionAttachmentStart  = "session.attachment.start"
	RegistryMethodSessionAttachmentChunk  = "session.attachment.chunk"
	RegistryMethodSessionAttachmentFinish = "session.attachment.finish"
	RegistryMethodSessionAttachmentCancel = "session.attachment.cancel"
	RegistryMethodSessionAttachmentDelete = "session.attachment.delete"

	RegistryMethodMonitorListHub = "monitor.listHub"
	RegistryMethodMonitorStatus  = "monitor.status"
	RegistryMethodMonitorLog     = "monitor.log"
	RegistryMethodMonitorDB      = "monitor.db"
	RegistryMethodMonitorAction  = "monitor.action"

	RegistryMethodRegistryRelayEnable               = "registry.relay.enable"
	RegistryMethodRegistryRelayDisable              = "registry.relay.disable"
	RegistryMethodRegistryRelayStatus               = "registry.relay.status"
	RegistryMethodRegistryRelayRegenerateAccessCode = "registry.relay.regenerateAccessCode"
	RegistryMethodHubRelayOpen                      = "hub.relay.open"
	RegistryMethodHubRelayClose                     = "hub.relay.close"

	RegistryMethodSpeechStart  = "speech.start"
	RegistryMethodSpeechChunk  = "speech.chunk"
	RegistryMethodSpeechFinish = "speech.finish"
	RegistryMethodSpeechCancel = "speech.cancel"

	LegacyRegistryMethodChatSend = "chat.send"
)

type RegistryMethodDescriptor struct {
	Method            string
	Route             RegistryRouteKind
	Roles             []RegistryRole
	RequiresProjectID bool
	RequiresHubID     bool
	Batchable         bool
	LocalRead         bool
	ClientEventMethod string
}

var RegistryMethodDescriptors = map[string]RegistryMethodDescriptor{
	RegistryMethodConnectInit:           registryMethod(RegistryMethodConnectInit, RegistryRouteConnect, nil),
	RegistryMethodConnectClose:          registryClientEventMethod(RegistryMethodConnectClose),
	RegistryMethodConnectLocalReadProof: registryMethod(RegistryMethodConnectLocalReadProof, RegistryRouteLocalRead, []RegistryRole{RegistryRoleLocalRead}),
	RegistryMethodBatch:                 registryMethod(RegistryMethodBatch, RegistryRouteBatch, []RegistryRole{RegistryRoleClient, RegistryRoleMonitor}),
	RegistryMethodHubPing:               registryMethod(RegistryMethodHubPing, RegistryRouteHubControl, []RegistryRole{RegistryRoleHub}),
	RegistryMethodHubStateGet:           registryHubStateMethod(RegistryMethodHubStateGet),
	RegistryMethodHubStateRefresh:       registryHubStateMethod(RegistryMethodHubStateRefresh),
	RegistryMethodHubStateAction:        registryHubStateMethod(RegistryMethodHubStateAction),
	RegistryMethodHubStateUpdated:       registryClientEventMethod(RegistryMethodHubStateUpdated),
	RegistryMethodDebugUploadLog:        registryMethod(RegistryMethodDebugUploadLog, RegistryRouteDebug, []RegistryRole{RegistryRoleClient}),

	RegistryMethodHubReportProjects:     registryHubReportMethod(RegistryMethodHubReportProjects),
	RegistryMethodHubReportProject:      registryHubReportMethod(RegistryMethodHubReportProject),
	RegistryMethodRegistryProjectList:   registryLocalReadMethod(RegistryMethodRegistryProjectList, RegistryRouteProjectCache, []RegistryRole{RegistryRoleClient, RegistryRoleMonitor}),
	RegistryMethodRegistryProjectReport: registryClientEventMethod(RegistryMethodRegistryProjectReport),
	RegistryMethodProjectSyncCheck:      registryLocalReadProjectCacheMethod(RegistryMethodProjectSyncCheck, []RegistryRole{RegistryRoleClient}),

	RegistryMethodProjectFSList:                 registryLocalReadProjectMethod(RegistryMethodProjectFSList),
	RegistryMethodProjectFSInfo:                 registryLocalReadProjectMethod(RegistryMethodProjectFSInfo),
	RegistryMethodProjectFSRead:                 registryLocalReadProjectMethod(RegistryMethodProjectFSRead),
	RegistryMethodProjectFSSearch:               registryLocalReadProjectMethod(RegistryMethodProjectFSSearch),
	RegistryMethodProjectFSGrep:                 registryLocalReadProjectMethod(RegistryMethodProjectFSGrep),
	RegistryMethodProjectFSIndexSearch:          registryLocalReadProjectMethod(RegistryMethodProjectFSIndexSearch),
	RegistryMethodProjectGitRefs:                registryLocalReadProjectMethod(RegistryMethodProjectGitRefs),
	RegistryMethodProjectGitLog:                 registryLocalReadProjectMethod(RegistryMethodProjectGitLog),
	RegistryMethodProjectGitCommitFiles:         registryLocalReadProjectMethod(RegistryMethodProjectGitCommitFiles),
	RegistryMethodProjectGitCommitFileDiff:      registryLocalReadProjectMethod(RegistryMethodProjectGitCommitFileDiff),
	RegistryMethodProjectGitDiff:                registryLocalReadProjectMethod(RegistryMethodProjectGitDiff),
	RegistryMethodProjectGitDiffFileDiff:        registryLocalReadProjectMethod(RegistryMethodProjectGitDiffFileDiff),
	RegistryMethodProjectGitStatus:              registryLocalReadProjectMethod(RegistryMethodProjectGitStatus),
	RegistryMethodProjectGitWorkingTreeFileDiff: registryLocalReadProjectMethod(RegistryMethodProjectGitWorkingTreeFileDiff),
	RegistryMethodSessionUpdated:                registryHubSessionEventMethod(RegistryMethodSessionUpdated, RegistryMethodSessionUpdated),
	RegistryMethodSessionMessage:                registryHubSessionEventMethod(RegistryMethodSessionMessage, RegistryMethodSessionMessage),

	RegistryMethodSessionList:             registryProjectMethod(RegistryMethodSessionList, RegistryRouteSessionForward),
	RegistryMethodSessionRead:             registryProjectMethod(RegistryMethodSessionRead, RegistryRouteSessionForward),
	RegistryMethodSessionSearch:           registryProjectMethod(RegistryMethodSessionSearch, RegistryRouteSessionForward),
	RegistryMethodSessionCreate:           registryProjectMethod(RegistryMethodSessionCreate, RegistryRouteSessionForward),
	RegistryMethodSessionResumeList:       registryProjectMethod(RegistryMethodSessionResumeList, RegistryRouteSessionForward),
	RegistryMethodSessionResumeImport:     registryProjectMethod(RegistryMethodSessionResumeImport, RegistryRouteSessionForward),
	RegistryMethodSessionReload:           registryProjectMethod(RegistryMethodSessionReload, RegistryRouteSessionForward),
	RegistryMethodSessionArchive:          registryProjectMethod(RegistryMethodSessionArchive, RegistryRouteSessionForward),
	RegistryMethodSessionArchiveList:      registryProjectMethod(RegistryMethodSessionArchiveList, RegistryRouteSessionForward),
	RegistryMethodSessionArchiveRead:      registryProjectMethod(RegistryMethodSessionArchiveRead, RegistryRouteSessionForward),
	RegistryMethodSessionArchiveRestore:   registryProjectMethod(RegistryMethodSessionArchiveRestore, RegistryRouteSessionForward),
	RegistryMethodSessionArtifactRead:     registryProjectMethod(RegistryMethodSessionArtifactRead, RegistryRouteSessionForward),
	RegistryMethodSessionDelete:           registryProjectMethod(RegistryMethodSessionDelete, RegistryRouteSessionForward),
	RegistryMethodSessionRename:           registryProjectMethod(RegistryMethodSessionRename, RegistryRouteSessionForward),
	RegistryMethodSessionSend:             registryProjectMethod(RegistryMethodSessionSend, RegistryRouteSessionForward),
	RegistryMethodSessionCancel:           registryProjectMethod(RegistryMethodSessionCancel, RegistryRouteSessionForward),
	RegistryMethodSessionMarkRead:         registryProjectMethod(RegistryMethodSessionMarkRead, RegistryRouteSessionForward),
	RegistryMethodSessionConfig:           registryProjectMethod(RegistryMethodSessionConfig, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentStart:  registryProjectMethod(RegistryMethodSessionAttachmentStart, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentChunk:  registryProjectMethod(RegistryMethodSessionAttachmentChunk, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentFinish: registryProjectMethod(RegistryMethodSessionAttachmentFinish, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentCancel: registryProjectMethod(RegistryMethodSessionAttachmentCancel, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentDelete: registryProjectMethod(RegistryMethodSessionAttachmentDelete, RegistryRouteSessionForward),

	RegistryMethodMonitorListHub: registryMethod(RegistryMethodMonitorListHub, RegistryRouteMonitorCache, []RegistryRole{RegistryRoleMonitor}),
	RegistryMethodMonitorStatus:  registryMethod(RegistryMethodMonitorStatus, RegistryRouteMonitorForward, []RegistryRole{RegistryRoleMonitor}),
	RegistryMethodMonitorLog:     registryMethod(RegistryMethodMonitorLog, RegistryRouteMonitorForward, []RegistryRole{RegistryRoleMonitor}),
	RegistryMethodMonitorDB:      registryMethod(RegistryMethodMonitorDB, RegistryRouteMonitorForward, []RegistryRole{RegistryRoleMonitor}),
	RegistryMethodMonitorAction:  registryMethod(RegistryMethodMonitorAction, RegistryRouteMonitorForward, []RegistryRole{RegistryRoleMonitor}),

	RegistryMethodRegistryRelayEnable:               registryMethod(RegistryMethodRegistryRelayEnable, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodRegistryRelayDisable:              registryMethod(RegistryMethodRegistryRelayDisable, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodRegistryRelayStatus:               registryMethod(RegistryMethodRegistryRelayStatus, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodRegistryRelayRegenerateAccessCode: registryMethod(RegistryMethodRegistryRelayRegenerateAccessCode, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodHubRelayOpen:                      registryMethod(RegistryMethodHubRelayOpen, RegistryRouteRelayHub, nil),
	RegistryMethodHubRelayClose:                     registryMethod(RegistryMethodHubRelayClose, RegistryRouteRelayHub, nil),

	RegistryMethodSpeechStart:  registrySpeechMethod(RegistryMethodSpeechStart),
	RegistryMethodSpeechChunk:  registrySpeechMethod(RegistryMethodSpeechChunk),
	RegistryMethodSpeechFinish: registrySpeechMethod(RegistryMethodSpeechFinish),
	RegistryMethodSpeechCancel: registrySpeechMethod(RegistryMethodSpeechCancel),
}

func registryMethod(method string, route RegistryRouteKind, roles []RegistryRole) RegistryMethodDescriptor {
	return RegistryMethodDescriptor{Method: method, Route: route, Roles: roles}
}

func registryProjectMethod(method string, route RegistryRouteKind) RegistryMethodDescriptor {
	desc := registryMethod(method, route, []RegistryRole{RegistryRoleClient})
	desc.RequiresProjectID = true
	desc.Batchable = true
	return desc
}

func registryLocalReadMethod(method string, route RegistryRouteKind, roles []RegistryRole) RegistryMethodDescriptor {
	desc := registryMethod(method, route, roles)
	desc.LocalRead = true
	desc.Batchable = true
	return desc
}

func registryHubReportMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubReport, []RegistryRole{RegistryRoleHub})
	desc.RequiresHubID = true
	return desc
}

func registryLocalReadProjectCacheMethod(method string, roles []RegistryRole) RegistryMethodDescriptor {
	desc := registryLocalReadMethod(method, RegistryRouteProjectCache, roles)
	desc.RequiresProjectID = true
	return desc
}

func registryLocalReadProjectMethod(method string) RegistryMethodDescriptor {
	desc := registryProjectMethod(method, RegistryRouteProjectForward)
	desc.LocalRead = true
	return desc
}

func registryHubCommandMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubCommand, []RegistryRole{RegistryRoleClient})
	desc.RequiresHubID = true
	desc.Batchable = true
	return desc
}

func registryHubStateMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubState, []RegistryRole{RegistryRoleClient})
	desc.RequiresHubID = true
	desc.Batchable = true
	return desc
}

func registrySpeechMethod(method string) RegistryMethodDescriptor {
	return registryMethod(method, RegistryRouteSpeech, []RegistryRole{RegistryRoleClient})
}

func registryHubSessionEventMethod(method string, clientEventMethod string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubSessionEvent, []RegistryRole{RegistryRoleHub})
	desc.RequiresProjectID = true
	desc.ClientEventMethod = clientEventMethod
	return desc
}

func registryClientEventMethod(method string) RegistryMethodDescriptor {
	return registryMethod(method, RegistryRouteClientEvent, nil)
}

func RegistryMethod(method string) (RegistryMethodDescriptor, bool) {
	desc, ok := RegistryMethodDescriptors[strings.TrimSpace(method)]
	return desc, ok
}

func RegistryMethodAllowed(role string, method string) bool {
	desc, ok := RegistryMethod(method)
	if !ok {
		return false
	}
	want := RegistryRole(strings.TrimSpace(role))
	for _, allowed := range desc.Roles {
		if allowed == want {
			return true
		}
	}
	return false
}

func RegistryMethodHasRoute(method string, route RegistryRouteKind) bool {
	desc, ok := RegistryMethod(method)
	return ok && desc.Route == route
}

func RegistryClientForwardMethod(method string) bool {
	desc, ok := RegistryMethod(method)
	return ok && (desc.Route == RegistryRouteSessionForward || desc.Route == RegistryRouteProjectForward)
}

func RegistrySessionForwardMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteSessionForward)
}

func RegistryHubCommandMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteHubCommand)
}

func RegistryHubStateMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteHubState)
}

func RegistryMonitorForwardMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteMonitorForward)
}

func RegistryRelayControlMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteRelayControl)
}

func RegistryRelayHubMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteRelayHub)
}

func RegistrySpeechMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteSpeech)
}

func RegistryLocalReadMethodAllowed(method string) bool {
	desc, ok := RegistryMethod(method)
	return ok && desc.LocalRead
}

func RegistryHubSessionEventMethod(method string) (string, bool) {
	desc, ok := RegistryMethod(method)
	if !ok || desc.Route != RegistryRouteHubSessionEvent || strings.TrimSpace(desc.ClientEventMethod) == "" {
		return "", false
	}
	return desc.ClientEventMethod, true
}
