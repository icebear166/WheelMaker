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
	RegistryRoleHub    RegistryRole = "hub"
	RegistryRoleClient RegistryRole = "client"
)

type RegistryRouteKind string

const (
	RegistryRouteConnect                RegistryRouteKind = "connect"
	RegistryRouteHubControl             RegistryRouteKind = "hub_control"
	RegistryRouteHubReport              RegistryRouteKind = "hub_report"
	RegistryRouteHubState               RegistryRouteKind = "hub_state"
	RegistryRouteHubReleaseNotify       RegistryRouteKind = "hub_release_notify"
	RegistryRouteHubDebugWebTransfer    RegistryRouteKind = "hub_debug_web_transfer"
	RegistryRouteHubSessionEvent        RegistryRouteKind = "hub_session_event"
	RegistryRouteProjectCache           RegistryRouteKind = "project_cache"
	RegistryRouteProjectForward         RegistryRouteKind = "project_forward"
	RegistryRouteSessionForward         RegistryRouteKind = "session_forward"
	RegistryRouteHubCommand             RegistryRouteKind = "hub_command"
	RegistryRouteRelayControl           RegistryRouteKind = "relay_control"
	RegistryRouteRelayHub               RegistryRouteKind = "relay_hub"
	RegistryRouteSpeech                 RegistryRouteKind = "speech"
	RegistryRouteTTS                    RegistryRouteKind = "tts"
	RegistryRouteClientEvent            RegistryRouteKind = "client_event"
	RegistryRouteDebug                  RegistryRouteKind = "debug"
	RegistryRouteSecuritySession        RegistryRouteKind = "security_session"
	RegistryRouteServerData             RegistryRouteKind = "server_data"
	RegistryRouteTerminalProjectRequest RegistryRouteKind = "terminal_project_request"
	RegistryRouteTerminalHubRequest     RegistryRouteKind = "terminal_hub_request"
	RegistryRouteTerminalClientEvent    RegistryRouteKind = "terminal_client_event"
	RegistryRouteTerminalHubEvent       RegistryRouteKind = "terminal_hub_event"
)

const (
	RegistryMethodConnectInit               = "connect.init"
	RegistryMethodConnectClose              = "connect.close"
	RegistryMethodHubPing                   = "hub.ping"
	RegistryMethodHubStateGet               = "hub.state.get"
	RegistryMethodHubStateRefresh           = "hub.state.refresh"
	RegistryMethodHubStateAction            = "hub.state.action"
	RegistryMethodHubStateUpdated           = "hub.state.updated"
	RegistryMethodHubReleaseNotify          = "hub.release.notify"
	RegistryMethodHubReleaseApply           = "hub.release.apply"
	RegistryMethodHubDebugWebTransferStart  = "hub.debugWeb.transfer.start"
	RegistryMethodHubDebugWebTransferChunk  = "hub.debugWeb.transfer.chunk"
	RegistryMethodHubDebugWebTransferFinish = "hub.debugWeb.transfer.finish"
	RegistryMethodHubDebugWebTransferAbort  = "hub.debugWeb.transfer.abort"
	RegistryMethodHubDebugWebReceiveStart   = "hub.debugWeb.receive.start"
	RegistryMethodHubDebugWebReceiveChunk   = "hub.debugWeb.receive.chunk"
	RegistryMethodHubDebugWebReceiveFinish  = "hub.debugWeb.receive.finish"
	RegistryMethodHubDebugWebReceiveAbort   = "hub.debugWeb.receive.abort"
	RegistryMethodDebugUploadLog            = "debug.uploadLog"

	RegistryMethodHubReportProjects             = "hub.report.projects"
	RegistryMethodHubReportProject              = "hub.report.project"
	RegistryMethodRegistryProjectList           = "registry.project.list"
	RegistryMethodRegistryProjectReport         = "registry.project.report"
	RegistryMethodProjectFSList                 = "project.fs.list"
	RegistryMethodProjectFSInfo                 = "project.fs.info"
	RegistryMethodProjectFSRead                 = "project.fs.read"
	RegistryMethodProjectFSExternalInfo         = "project.fs.external.info"
	RegistryMethodProjectFSExternalRead         = "project.fs.external.read"
	RegistryMethodProjectFSSearch               = "project.fs.search"
	RegistryMethodProjectFSGrep                 = "project.fs.grep"
	RegistryMethodProjectFSIndexSearch          = "project.fs.index.search"
	RegistryMethodProjectGitRev                 = "project.git.rev"
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

	RegistryMethodSecuritySessionList              = "security.session.list"
	RegistryMethodSecuritySessionRevoke            = "security.session.revoke"
	RegistryMethodSecuritySessionRevokeAll         = "security.session.revokeAll"
	RegistryMethodServerConfigGet                  = "server.config.get"
	RegistryMethodServerConfigUpdate               = "server.config.update"
	RegistryMethodServerAndroidSpeechCredentialGet = "server.androidSpeechCredential.get"

	RegistryMethodSessionList                = "session.list"
	RegistryMethodSessionRead                = "session.read"
	RegistryMethodSessionSearch              = "session.search"
	RegistryMethodSessionCreate              = "session.create"
	RegistryMethodSessionResumeList          = "session.resume.list"
	RegistryMethodSessionResumeImport        = "session.resume.import"
	RegistryMethodSessionReload              = "session.reload"
	RegistryMethodSessionArchive             = "session.archive"
	RegistryMethodSessionArchiveList         = "session.archive.list"
	RegistryMethodSessionArchiveRead         = "session.archive.read"
	RegistryMethodSessionArchiveRestore      = "session.archive.restore"
	RegistryMethodSessionArtifactRead        = "session.artifact.read"
	RegistryMethodSessionDelete              = "session.delete"
	RegistryMethodSessionRename              = "session.rename"
	RegistryMethodSessionPin                 = "session.pin"
	RegistryMethodSessionSend                = "session.send"
	RegistryMethodSessionCancel              = "session.cancel"
	RegistryMethodSessionMarkRead            = "session.markRead"
	RegistryMethodSessionConfig              = "session.config"
	RegistryMethodSessionStatus              = "session.status"
	RegistryMethodSessionCompact             = "session.compact"
	RegistryMethodSessionFork                = "session.fork"
	RegistryMethodSessionPermissionRespond   = "session.permission.respond"
	RegistryMethodSessionAttachmentStart     = "session.attachment.start"
	RegistryMethodSessionAttachmentChunk     = "session.attachment.chunk"
	RegistryMethodSessionAttachmentFinish    = "session.attachment.finish"
	RegistryMethodSessionAttachmentCancel    = "session.attachment.cancel"
	RegistryMethodSessionAttachmentDelete    = "session.attachment.delete"
	RegistryMethodSessionAttachmentThumbnail = "session.attachment.thumbnail"
	RegistryMethodSessionAttachmentRead      = "session.attachment.read"

	RegistryMethodRegistryRelayEnable               = "registry.relay.enable"
	RegistryMethodRegistryRelayDisable              = "registry.relay.disable"
	RegistryMethodRegistryRelayStatus               = "registry.relay.status"
	RegistryMethodRegistryRelayRegenerateAccessCode = "registry.relay.regenerateAccessCode"
	RegistryMethodHubRelayOpen                      = "hub.relay.open"
	RegistryMethodHubRelayClose                     = "hub.relay.close"

	RegistryMethodSpeechStart   = "speech.start"
	RegistryMethodSpeechChunk   = "speech.chunk"
	RegistryMethodSpeechFinish  = "speech.finish"
	RegistryMethodSpeechCancel  = "speech.cancel"
	RegistryMethodTTSSynthesize = "tts.synthesize"

	RegistryMethodTerminalList    = "terminal.list"
	RegistryMethodTerminalCreate  = "terminal.create"
	RegistryMethodTerminalGet     = "terminal.get"
	RegistryMethodTerminalResize  = "terminal.resize"
	RegistryMethodTerminalClose   = "terminal.close"
	RegistryMethodTerminalRestart = "terminal.restart"
	RegistryMethodTerminalInput   = "terminal.input"
	RegistryMethodTerminalOutput  = "terminal.output"
	RegistryMethodTerminalChanged = "terminal.changed"

	LegacyRegistryMethodChatSend = "chat.send"
)

type RegistryMethodDescriptor struct {
	Method            string
	Route             RegistryRouteKind
	Roles             []RegistryRole
	RequiresProjectID bool
	RequiresHubID     bool
	ClientEventMethod string
}

var RegistryMethodDescriptors = map[string]RegistryMethodDescriptor{
	RegistryMethodConnectInit:                      registryMethod(RegistryMethodConnectInit, RegistryRouteConnect, nil),
	RegistryMethodConnectClose:                     registryClientEventMethod(RegistryMethodConnectClose),
	RegistryMethodHubPing:                          registryMethod(RegistryMethodHubPing, RegistryRouteHubControl, []RegistryRole{RegistryRoleHub}),
	RegistryMethodHubStateGet:                      registryHubStateMethod(RegistryMethodHubStateGet),
	RegistryMethodHubStateRefresh:                  registryHubStateMethod(RegistryMethodHubStateRefresh),
	RegistryMethodHubStateAction:                   registryHubStateMethod(RegistryMethodHubStateAction),
	RegistryMethodHubStateUpdated:                  registryMethod(RegistryMethodHubStateUpdated, RegistryRouteClientEvent, []RegistryRole{RegistryRoleHub}),
	RegistryMethodHubReleaseNotify:                 registryHubReleaseNotifyMethod(RegistryMethodHubReleaseNotify),
	RegistryMethodHubDebugWebTransferStart:         registryHubDebugWebTransferMethod(RegistryMethodHubDebugWebTransferStart),
	RegistryMethodHubDebugWebTransferChunk:         registryHubDebugWebTransferMethod(RegistryMethodHubDebugWebTransferChunk),
	RegistryMethodHubDebugWebTransferFinish:        registryHubDebugWebTransferMethod(RegistryMethodHubDebugWebTransferFinish),
	RegistryMethodHubDebugWebTransferAbort:         registryHubDebugWebTransferMethod(RegistryMethodHubDebugWebTransferAbort),
	RegistryMethodDebugUploadLog:                   registryMethod(RegistryMethodDebugUploadLog, RegistryRouteDebug, []RegistryRole{RegistryRoleClient}),
	RegistryMethodSecuritySessionList:              registryMethod(RegistryMethodSecuritySessionList, RegistryRouteSecuritySession, []RegistryRole{RegistryRoleClient}),
	RegistryMethodSecuritySessionRevoke:            registryMethod(RegistryMethodSecuritySessionRevoke, RegistryRouteSecuritySession, []RegistryRole{RegistryRoleClient}),
	RegistryMethodSecuritySessionRevokeAll:         registryMethod(RegistryMethodSecuritySessionRevokeAll, RegistryRouteSecuritySession, []RegistryRole{RegistryRoleClient}),
	RegistryMethodServerConfigGet:                  registryMethod(RegistryMethodServerConfigGet, RegistryRouteServerData, []RegistryRole{RegistryRoleClient}),
	RegistryMethodServerConfigUpdate:               registryMethod(RegistryMethodServerConfigUpdate, RegistryRouteServerData, []RegistryRole{RegistryRoleClient}),
	RegistryMethodServerAndroidSpeechCredentialGet: registryMethod(RegistryMethodServerAndroidSpeechCredentialGet, RegistryRouteServerData, []RegistryRole{RegistryRoleClient}),

	RegistryMethodHubReportProjects:     registryHubReportMethod(RegistryMethodHubReportProjects),
	RegistryMethodHubReportProject:      registryHubReportMethod(RegistryMethodHubReportProject),
	RegistryMethodRegistryProjectList:   registryMethod(RegistryMethodRegistryProjectList, RegistryRouteProjectCache, []RegistryRole{RegistryRoleClient}),
	RegistryMethodRegistryProjectReport: registryClientEventMethod(RegistryMethodRegistryProjectReport),

	RegistryMethodProjectFSList:                 registryProjectMethod(RegistryMethodProjectFSList, RegistryRouteProjectForward),
	RegistryMethodProjectFSInfo:                 registryProjectMethod(RegistryMethodProjectFSInfo, RegistryRouteProjectForward),
	RegistryMethodProjectFSRead:                 registryProjectMethod(RegistryMethodProjectFSRead, RegistryRouteProjectForward),
	RegistryMethodProjectFSExternalInfo:         registryProjectMethod(RegistryMethodProjectFSExternalInfo, RegistryRouteProjectForward),
	RegistryMethodProjectFSExternalRead:         registryProjectMethod(RegistryMethodProjectFSExternalRead, RegistryRouteProjectForward),
	RegistryMethodProjectFSSearch:               registryProjectMethod(RegistryMethodProjectFSSearch, RegistryRouteProjectForward),
	RegistryMethodProjectFSGrep:                 registryProjectMethod(RegistryMethodProjectFSGrep, RegistryRouteProjectForward),
	RegistryMethodProjectFSIndexSearch:          registryProjectMethod(RegistryMethodProjectFSIndexSearch, RegistryRouteProjectForward),
	RegistryMethodProjectGitRev:                 registryProjectMethod(RegistryMethodProjectGitRev, RegistryRouteProjectForward),
	RegistryMethodProjectGitRefs:                registryProjectMethod(RegistryMethodProjectGitRefs, RegistryRouteProjectForward),
	RegistryMethodProjectGitLog:                 registryProjectMethod(RegistryMethodProjectGitLog, RegistryRouteProjectForward),
	RegistryMethodProjectGitCommitFiles:         registryProjectMethod(RegistryMethodProjectGitCommitFiles, RegistryRouteProjectForward),
	RegistryMethodProjectGitCommitFileDiff:      registryProjectMethod(RegistryMethodProjectGitCommitFileDiff, RegistryRouteProjectForward),
	RegistryMethodProjectGitDiff:                registryProjectMethod(RegistryMethodProjectGitDiff, RegistryRouteProjectForward),
	RegistryMethodProjectGitDiffFileDiff:        registryProjectMethod(RegistryMethodProjectGitDiffFileDiff, RegistryRouteProjectForward),
	RegistryMethodProjectGitStatus:              registryProjectMethod(RegistryMethodProjectGitStatus, RegistryRouteProjectForward),
	RegistryMethodProjectGitWorkingTreeFileDiff: registryProjectMethod(RegistryMethodProjectGitWorkingTreeFileDiff, RegistryRouteProjectForward),
	RegistryMethodSessionUpdated:                registryHubSessionEventMethod(RegistryMethodSessionUpdated, RegistryMethodSessionUpdated),
	RegistryMethodSessionMessage:                registryHubSessionEventMethod(RegistryMethodSessionMessage, RegistryMethodSessionMessage),

	RegistryMethodSessionList:                registryProjectMethod(RegistryMethodSessionList, RegistryRouteSessionForward),
	RegistryMethodSessionRead:                registryProjectMethod(RegistryMethodSessionRead, RegistryRouteSessionForward),
	RegistryMethodSessionSearch:              registryProjectMethod(RegistryMethodSessionSearch, RegistryRouteSessionForward),
	RegistryMethodSessionCreate:              registryProjectMethod(RegistryMethodSessionCreate, RegistryRouteSessionForward),
	RegistryMethodSessionResumeList:          registryProjectMethod(RegistryMethodSessionResumeList, RegistryRouteSessionForward),
	RegistryMethodSessionResumeImport:        registryProjectMethod(RegistryMethodSessionResumeImport, RegistryRouteSessionForward),
	RegistryMethodSessionReload:              registryProjectMethod(RegistryMethodSessionReload, RegistryRouteSessionForward),
	RegistryMethodSessionArchive:             registryProjectMethod(RegistryMethodSessionArchive, RegistryRouteSessionForward),
	RegistryMethodSessionArchiveList:         registryProjectMethod(RegistryMethodSessionArchiveList, RegistryRouteSessionForward),
	RegistryMethodSessionArchiveRead:         registryProjectMethod(RegistryMethodSessionArchiveRead, RegistryRouteSessionForward),
	RegistryMethodSessionArchiveRestore:      registryProjectMethod(RegistryMethodSessionArchiveRestore, RegistryRouteSessionForward),
	RegistryMethodSessionArtifactRead:        registryProjectMethod(RegistryMethodSessionArtifactRead, RegistryRouteSessionForward),
	RegistryMethodSessionDelete:              registryProjectMethod(RegistryMethodSessionDelete, RegistryRouteSessionForward),
	RegistryMethodSessionRename:              registryProjectMethod(RegistryMethodSessionRename, RegistryRouteSessionForward),
	RegistryMethodSessionPin:                 registryProjectMethod(RegistryMethodSessionPin, RegistryRouteSessionForward),
	RegistryMethodSessionSend:                registryProjectMethod(RegistryMethodSessionSend, RegistryRouteSessionForward),
	RegistryMethodSessionCancel:              registryProjectMethod(RegistryMethodSessionCancel, RegistryRouteSessionForward),
	RegistryMethodSessionMarkRead:            registryProjectMethod(RegistryMethodSessionMarkRead, RegistryRouteSessionForward),
	RegistryMethodSessionConfig:              registryProjectMethod(RegistryMethodSessionConfig, RegistryRouteSessionForward),
	RegistryMethodSessionStatus:              registryProjectMethod(RegistryMethodSessionStatus, RegistryRouteSessionForward),
	RegistryMethodSessionCompact:             registryProjectMethod(RegistryMethodSessionCompact, RegistryRouteSessionForward),
	RegistryMethodSessionFork:                registryProjectMethod(RegistryMethodSessionFork, RegistryRouteSessionForward),
	RegistryMethodSessionPermissionRespond:   registryProjectMethod(RegistryMethodSessionPermissionRespond, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentStart:     registryProjectMethod(RegistryMethodSessionAttachmentStart, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentChunk:     registryProjectMethod(RegistryMethodSessionAttachmentChunk, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentFinish:    registryProjectMethod(RegistryMethodSessionAttachmentFinish, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentCancel:    registryProjectMethod(RegistryMethodSessionAttachmentCancel, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentDelete:    registryProjectMethod(RegistryMethodSessionAttachmentDelete, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentThumbnail: registryProjectMethod(RegistryMethodSessionAttachmentThumbnail, RegistryRouteSessionForward),
	RegistryMethodSessionAttachmentRead:      registryProjectMethod(RegistryMethodSessionAttachmentRead, RegistryRouteSessionForward),

	RegistryMethodRegistryRelayEnable:               registryMethod(RegistryMethodRegistryRelayEnable, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodRegistryRelayDisable:              registryMethod(RegistryMethodRegistryRelayDisable, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodRegistryRelayStatus:               registryMethod(RegistryMethodRegistryRelayStatus, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodRegistryRelayRegenerateAccessCode: registryMethod(RegistryMethodRegistryRelayRegenerateAccessCode, RegistryRouteRelayControl, []RegistryRole{RegistryRoleClient}),
	RegistryMethodHubRelayOpen:                      registryMethod(RegistryMethodHubRelayOpen, RegistryRouteRelayHub, nil),
	RegistryMethodHubRelayClose:                     registryMethod(RegistryMethodHubRelayClose, RegistryRouteRelayHub, nil),

	RegistryMethodSpeechStart:   registrySpeechMethod(RegistryMethodSpeechStart),
	RegistryMethodSpeechChunk:   registrySpeechMethod(RegistryMethodSpeechChunk),
	RegistryMethodSpeechFinish:  registrySpeechMethod(RegistryMethodSpeechFinish),
	RegistryMethodSpeechCancel:  registrySpeechMethod(RegistryMethodSpeechCancel),
	RegistryMethodTTSSynthesize: registryMethod(RegistryMethodTTSSynthesize, RegistryRouteTTS, []RegistryRole{RegistryRoleClient}),

	RegistryMethodTerminalList:    registryTerminalHubMethod(RegistryMethodTerminalList, RegistryRoleClient, RegistryRouteTerminalHubRequest),
	RegistryMethodTerminalCreate:  registryProjectMethod(RegistryMethodTerminalCreate, RegistryRouteTerminalProjectRequest),
	RegistryMethodTerminalGet:     registryTerminalHubMethod(RegistryMethodTerminalGet, RegistryRoleClient, RegistryRouteTerminalHubRequest),
	RegistryMethodTerminalResize:  registryTerminalHubMethod(RegistryMethodTerminalResize, RegistryRoleClient, RegistryRouteTerminalHubRequest),
	RegistryMethodTerminalClose:   registryTerminalHubMethod(RegistryMethodTerminalClose, RegistryRoleClient, RegistryRouteTerminalHubRequest),
	RegistryMethodTerminalRestart: registryTerminalHubMethod(RegistryMethodTerminalRestart, RegistryRoleClient, RegistryRouteTerminalHubRequest),
	RegistryMethodTerminalInput:   registryTerminalHubMethod(RegistryMethodTerminalInput, RegistryRoleClient, RegistryRouteTerminalClientEvent),
	RegistryMethodTerminalOutput:  registryTerminalHubMethod(RegistryMethodTerminalOutput, RegistryRoleHub, RegistryRouteTerminalHubEvent),
	RegistryMethodTerminalChanged: registryTerminalHubMethod(RegistryMethodTerminalChanged, RegistryRoleHub, RegistryRouteTerminalHubEvent),
}

func registryMethod(method string, route RegistryRouteKind, roles []RegistryRole) RegistryMethodDescriptor {
	return RegistryMethodDescriptor{Method: method, Route: route, Roles: roles}
}

func registryProjectMethod(method string, route RegistryRouteKind) RegistryMethodDescriptor {
	desc := registryMethod(method, route, []RegistryRole{RegistryRoleClient})
	desc.RequiresProjectID = true
	return desc
}

func registryHubReportMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubReport, []RegistryRole{RegistryRoleHub})
	desc.RequiresHubID = true
	return desc
}

func registryHubCommandMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubCommand, []RegistryRole{RegistryRoleClient})
	desc.RequiresHubID = true
	return desc
}

func registryHubStateMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubState, []RegistryRole{RegistryRoleClient})
	desc.RequiresHubID = true
	return desc
}

func registryHubReleaseNotifyMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubReleaseNotify, []RegistryRole{RegistryRoleHub})
	desc.RequiresHubID = true
	return desc
}

func registryHubDebugWebTransferMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubDebugWebTransfer, []RegistryRole{RegistryRoleHub})
	desc.RequiresHubID = true
	return desc
}

func registrySpeechMethod(method string) RegistryMethodDescriptor {
	return registryMethod(method, RegistryRouteSpeech, []RegistryRole{RegistryRoleClient})
}

func registryTerminalHubMethod(method string, role RegistryRole, route RegistryRouteKind) RegistryMethodDescriptor {
	desc := registryMethod(method, route, []RegistryRole{role})
	desc.RequiresHubID = true
	return desc
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

func RegistryRelayControlMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteRelayControl)
}

func RegistryRelayHubMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteRelayHub)
}

func RegistrySpeechMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteSpeech)
}

func RegistryTTSMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteTTS)
}

func RegistrySecuritySessionMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteSecuritySession)
}

func RegistryServerDataMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteServerData)
}

func RegistryHubSessionEventMethod(method string) (string, bool) {
	desc, ok := RegistryMethod(method)
	if !ok || desc.Route != RegistryRouteHubSessionEvent || strings.TrimSpace(desc.ClientEventMethod) == "" {
		return "", false
	}
	return desc.ClientEventMethod, true
}
