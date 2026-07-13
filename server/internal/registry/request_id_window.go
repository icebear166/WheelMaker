package registry

const maxSeenRequestIDs = 1024

type requestIDWindow struct {
	capacity int
	ring     []int64
	next     int
	set      map[int64]struct{}
}

func newRequestIDWindow(capacity int) *requestIDWindow {
	if capacity <= 0 {
		capacity = 1
	}
	return &requestIDWindow{
		capacity: capacity,
		ring:     make([]int64, 0, capacity),
		set:      make(map[int64]struct{}, capacity),
	}
}

func (w *requestIDWindow) Add(id int64) bool {
	if _, exists := w.set[id]; exists {
		return true
	}
	if len(w.ring) < w.capacity {
		w.ring = append(w.ring, id)
		w.set[id] = struct{}{}
		return false
	}
	delete(w.set, w.ring[w.next])
	w.ring[w.next] = id
	w.next = (w.next + 1) % w.capacity
	w.set[id] = struct{}{}
	return false
}

func (w *requestIDWindow) Len() int {
	return len(w.set)
}
