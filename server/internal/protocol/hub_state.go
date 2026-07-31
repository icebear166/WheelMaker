package protocol

type HubStateAvailability string
type HubStateUpdateStatus string

const (
	HubStateAvailabilityEmpty HubStateAvailability = "empty"
	HubStateAvailabilityReady HubStateAvailability = "ready"
	HubStateUpdateIdle        HubStateUpdateStatus = "idle"
	HubStateUpdateQueued      HubStateUpdateStatus = "queued"
	HubStateUpdateUpdating    HubStateUpdateStatus = "updating"
)

type HubStateSection struct {
	Availability  HubStateAvailability `json:"availability"`
	UpdateStatus  HubStateUpdateStatus `json:"updateStatus"`
	Revision      uint64               `json:"revision"`
	UpdatedAt     string               `json:"updatedAt,omitempty"`
	LastAttemptAt string               `json:"lastAttemptAt,omitempty"`
	LastError     string               `json:"lastError,omitempty"`
	Data          any                  `json:"data,omitempty"`
}

type HubState struct {
	HubID      string                     `json:"hubId"`
	InstanceID string                     `json:"instanceId"`
	Sections   map[string]HubStateSection `json:"sections"`
}

type HubStateUpdateAck struct {
	Section  string `json:"section"`
	UpdateID string `json:"updateId"`
	Status   string `json:"status"`
}

type HubStateRefreshResponse struct {
	Accepted bool                `json:"accepted"`
	Updates  []HubStateUpdateAck `json:"updates"`
	State    HubState            `json:"state"`
}

type HubStateActionResponse struct {
	Accepted  bool `json:"accepted,omitempty"`
	Result    any  `json:"result,omitempty"`
	Operation any  `json:"operation,omitempty"`
}
