package protocol

const (
	SessionQueueActionEnqueue    = "enqueue"
	SessionQueueActionCancel     = "cancel"
	SessionQueueActionPrioritize = "prioritize"
	SessionQueueActionSteer      = "steer"
	SessionQueueActionRetry      = "retry"

	SessionQueueItemKindPrompt  = "prompt"
	SessionQueueItemKindCompact = "compact"

	SessionQueueItemStatusQueued     = "queued"
	SessionQueueItemStatusRunning    = "running"
	SessionQueueItemStatusCancelling = "cancelling"
	SessionQueueItemStatusSteering   = "steering"
	SessionQueueItemStatusFailed     = "failed"
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
	Error           string         `json:"error,omitempty"`
}

type SessionQueueSnapshot struct {
	Generation   string             `json:"generation"`
	Revision     uint64             `json:"revision"`
	Paused       bool               `json:"paused"`
	ActiveKind   string             `json:"activeKind,omitempty"`
	WaitingCount int                `json:"waitingCount"`
	ActiveItem   *SessionQueueItem  `json:"activeItem,omitempty"`
	WaitingItems []SessionQueueItem `json:"waitingItems,omitempty"`
}
