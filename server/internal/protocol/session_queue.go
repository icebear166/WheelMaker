package protocol

const (
	SessionQueueActionEnqueue    = "enqueue"
	SessionQueueActionCancel     = "cancel"
	SessionQueueActionPrioritize = "prioritize"
	SessionQueueActionSteer      = "steer"

	SessionQueueItemKindPrompt  = "prompt"
	SessionQueueItemKindCompact = "compact"

	SessionQueueItemStatusQueued     = "queued"
	SessionQueueItemStatusRunning    = "running"
	SessionQueueItemStatusCancelling = "cancelling"
	SessionQueueItemStatusSteering   = "steering"
)

type SessionQueueEnqueueItem struct {
	ItemID    string         `json:"itemId"`
	Kind      string         `json:"kind"`
	CreatedAt string         `json:"createdAt"`
	Blocks    []ContentBlock `json:"blocks,omitempty"`
}

type SessionQueueRequest struct {
	SessionID string                   `json:"sessionId"`
	Action    string                   `json:"action"`
	ItemID    string                   `json:"itemId,omitempty"`
	Item      *SessionQueueEnqueueItem `json:"item,omitempty"`
}

type SessionQueueItem struct {
	ItemID          string         `json:"itemId"`
	Kind            string         `json:"kind"`
	Status          string         `json:"status"`
	CreatedAt       string         `json:"createdAt"`
	Blocks          []ContentBlock `json:"blocks,omitempty"`
	CancelSupported bool           `json:"cancelSupported"`
}

type SessionQueueSnapshot struct {
	Generation   string             `json:"generation"`
	Revision     uint64             `json:"revision"`
	ActiveKind   string             `json:"activeKind,omitempty"`
	WaitingCount int                `json:"waitingCount"`
	ActiveItem   *SessionQueueItem  `json:"activeItem,omitempty"`
	WaitingItems []SessionQueueItem `json:"waitingItems,omitempty"`
}
