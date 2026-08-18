package shared

import (
	"path/filepath"
	"strings"
	"sync"
)

var configProcessLocks sync.Map

func configProcessMutex(path string) *sync.Mutex {
	key := filepath.Clean(path)
	if filepath.Separator == '\\' {
		key = strings.ToLower(key)
	}
	if value, ok := configProcessLocks.Load(key); ok {
		return value.(*sync.Mutex)
	}
	created := &sync.Mutex{}
	actual, _ := configProcessLocks.LoadOrStore(key, created)
	return actual.(*sync.Mutex)
}
