package protocol

import (
	"encoding/json"
	"strings"
)

const (
	DefaultProtocolVersion = "2.6"

	CodeUnauthorized    = "UNAUTHORIZED"
	CodeInvalidArgument = "INVALID_ARGUMENT"
	CodeForbidden       = "FORBIDDEN"
	CodeNotFound        = "NOT_FOUND"
	CodeConflict        = "CONFLICT"
	CodeUnavailable     = "UNAVAILABLE"
	CodeRateLimited     = "RATE_LIMITED"
	CodeInternal        = "INTERNAL"
	CodeTimeout         = "TIMEOUT"
)

type ProjectGitState struct {
	Branch      string `json:"branch"`
	HeadSHA     string `json:"headSha"`
	Dirty       bool   `json:"dirty"`
	GitRev      string `json:"gitRev"`
	WorktreeRev string `json:"worktreeRev"`
}

type ProjectAgentProfile struct {
	Name   string   `json:"name"`
	Skills []string `json:"skills,omitempty"`
}

type ProjectInfo struct {
	Name          string                `json:"name"`
	Path          string                `json:"path"`
	Online        bool                  `json:"online"`
	Agent         string                `json:"agent"`
	Agents        []string              `json:"agents,omitempty"`
	AgentProfiles []ProjectAgentProfile `json:"agentProfiles,omitempty"`
	ProjectRev    string                `json:"projectRev"`
	Git           ProjectGitState       `json:"git"`
}

type HubSnapshot struct {
	HubID           string        `json:"hubId"`
	ConnectionEpoch int64         `json:"connectionEpoch"`
	Projects        []ProjectInfo `json:"projects"`
	UpdatedAt       string        `json:"updatedAt"`
}

type Envelope struct {
	RequestID int64           `json:"requestId,omitempty"`
	Type      string          `json:"type"`
	Method    string          `json:"method,omitempty"`
	HubID     string          `json:"hubId,omitempty"`
	ProjectID string          `json:"projectId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type ErrorPayload struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

type ConnectInitPayload struct {
	ClientName      string `json:"clientName"`
	ClientVersion   string `json:"clientVersion"`
	ProtocolVersion string `json:"protocolVersion"`
	Role            string `json:"role"`
	HubID           string `json:"hubId,omitempty"`
	Token           string `json:"token"`
	TS              int64  `json:"ts,omitempty"`
	Nonce           string `json:"nonce,omitempty"`
}

type ConnectPrincipal struct {
	Role            string `json:"role"`
	HubID           string `json:"hubId,omitempty"`
	ConnectionEpoch int64  `json:"connectionEpoch"`
}

type ConnectServerInfo struct {
	ServerVersion   string `json:"serverVersion"`
	ProtocolVersion string `json:"protocolVersion"`
}

type ConnectFeatures struct {
	HubReportProjects       bool `json:"hubReportProjects"`
	PushHint                bool `json:"pushHint"`
	PingPong                bool `json:"pingPong"`
	SupportsHashNegotiation bool `json:"supportsHashNegotiation"`
}

type ConnectInitResponsePayload struct {
	OK             bool              `json:"ok"`
	Principal      ConnectPrincipal  `json:"principal"`
	ServerInfo     ConnectServerInfo `json:"serverInfo"`
	Features       ConnectFeatures   `json:"features"`
	HashAlgorithms []string          `json:"hashAlgorithms"`
}

type HubReportProjectsPayload struct {
	HubID           string        `json:"hubId"`
	ConnectionEpoch int64         `json:"connectionEpoch"`
	Projects        []ProjectInfo `json:"projects"`
}

type HubUpdateProjectPayload struct {
	HubID           string      `json:"hubId"`
	ConnectionEpoch int64       `json:"connectionEpoch"`
	Seq             int64       `json:"seq"`
	Project         ProjectInfo `json:"project"`
	ChangedDomains  []string    `json:"changedDomains,omitempty"`
	UpdatedAt       string      `json:"updatedAt"`
}

type DebugUploadLogPayload struct {
	Source string `json:"source"`
	Text   string `json:"text"`
}

type ProjectGitRevResponsePayload struct {
	GitRev      string `json:"gitRev"`
	WorktreeRev string `json:"worktreeRev"`
}

type DebugUploadLogResponsePayload struct {
	OK       bool   `json:"ok"`
	FileName string `json:"fileName"`
}

type RegistryDeviceSession struct {
	DeviceID          string `json:"deviceId"`
	DeviceName        string `json:"deviceName"`
	BasePath          string `json:"basePath"`
	LastLoginIP       string `json:"lastLoginIp"`
	LastLoginLocation string `json:"lastLoginLocation"`
	CreatedAt         string `json:"createdAt"`
	LastSeenAt        string `json:"lastSeenAt"`
	ExpiresAt         string `json:"expiresAt"`
	Current           bool   `json:"current"`
}

type RegistryDeviceSessionListResponse struct {
	Sessions []RegistryDeviceSession `json:"sessions"`
}

type RegistryDeviceSessionRevokePayload struct {
	DeviceID string `json:"deviceId"`
}

type RegistryDeviceSessionRevokeResponse struct {
	DeviceID string `json:"deviceId"`
	Revoked  bool   `json:"revoked"`
}

type RegistryDeviceSessionRevokeAllResponse struct {
	Revoked int `json:"revoked"`
}

type ServerFeatureConfig struct {
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

type ServerVoiceInputConfig struct {
	ServerFeatureConfig
	Model string `json:"model"`
}

type ServerTextToSpeechConfig struct {
	ServerFeatureConfig
	Model string `json:"model"`
	Voice string `json:"voice"`
}

type ServerConfigResponse struct {
	VoiceInput   ServerVoiceInputConfig   `json:"voiceInput"`
	TextToSpeech ServerTextToSpeechConfig `json:"textToSpeech"`
	DeepSeek     ServerFeatureConfig      `json:"deepSeek"`
}

type ServerConfigUpdatePayload struct {
	Section string `json:"section"`
	Field   string `json:"field"`
	Action  string `json:"action"`
	Value   string `json:"value,omitempty"`
}

type AndroidSpeechCredentialResponse struct {
	AccessToken string `json:"accessToken"`
	Version     string `json:"version"`
	Model       string `json:"model"`
}

type TTSSynthesizePayload struct {
	Model string `json:"model"`
	Voice string `json:"voice"`
	Text  string `json:"text"`
}

type TTSSynthesizeResponse struct {
	AudioBase64 string `json:"audioBase64"`
	Format      string `json:"format"`
}

type ProjectListItem struct {
	ProjectID     string                `json:"projectId"`
	Name          string                `json:"name"`
	Path          string                `json:"path"`
	Online        bool                  `json:"online"`
	Agent         string                `json:"agent"`
	Agents        []string              `json:"agents,omitempty"`
	AgentProfiles []ProjectAgentProfile `json:"agentProfiles,omitempty"`
	ProjectRev    string                `json:"projectRev"`
	Git           ProjectGitState       `json:"git"`
}

type HubListItem struct {
	HubID string `json:"hubId"`
}

func ProjectID(hubID, projectName string) string {
	hubID = strings.TrimSpace(hubID)
	projectName = strings.TrimSpace(projectName)
	if hubID == "" {
		return projectName
	}
	if projectName == "" {
		return hubID + ":"
	}
	return hubID + ":" + projectName
}

func MustRaw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
