package shared

import "sync"

// Windows file locking is not reliably exclusive between handles owned by
// the same process, so serialize in-process callers in addition to the OS
// lock used by each platform implementation.
var configProcessLock sync.Mutex
